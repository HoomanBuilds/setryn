#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_RUNTIME = join(process.cwd(), "deployments", "arbitrum-sepolia", "runtime.json");
const DEFAULT_STATE_PATH = "/var/lib/setryn/maker-refresh.cursor";
const REQUEST_TIMEOUT_MS = 55_000;

function logAndExit(payload, code) {
  console.log(JSON.stringify(payload));
  process.exit(code);
}

function fail(error, extra = {}) {
  logAndExit({ ok: false, error, ...extra }, 1);
}

const runtimePath = process.env.SETRYN_RUNTIME_PATH && process.env.SETRYN_RUNTIME_PATH.length > 0
  ? process.env.SETRYN_RUNTIME_PATH
  : DEFAULT_RUNTIME;
const originRaw = process.env.SETRYN_PUBLIC_ORIGIN ?? "";
const origin = originRaw.trim();
const statePath = process.env.SETRYN_MAKER_REFRESH_STATE_PATH && process.env.SETRYN_MAKER_REFRESH_STATE_PATH.length > 0
  ? process.env.SETRYN_MAKER_REFRESH_STATE_PATH
  : DEFAULT_STATE_PATH;

if (origin.length === 0) {
  fail("MISSING_SETRYN_PUBLIC_ORIGIN");
}

let runtime;
try {
  runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
} catch {
  fail("RUNTIME_READ_FAILED", { runtimePath });
}

const markets = Array.isArray(runtime?.markets) ? runtime.markets : null;
if (!markets) {
  fail("RUNTIME_MARKETS_MISSING", { runtimePath });
}

const nowSec = Math.floor(Date.now() / 1000);
const byUnderlying = new Map();
for (const market of markets) {
  const underlying = typeof market?.underlying === "string" ? market.underlying : "";
  const marketKey = typeof market?.marketKey === "string" ? market.marketKey : "";
  const expiryAt = Number(market?.expiryAt);
  const lastTradingAt = Number(market?.lastTradingAt);
  if (underlying.length === 0 || marketKey.length === 0) continue;
  if (!Number.isFinite(expiryAt) || !Number.isFinite(lastTradingAt)) continue;
  if (!(expiryAt > nowSec && lastTradingAt > nowSec)) continue;
  const current = byUnderlying.get(underlying);
  if (
    !current ||
    expiryAt < current.expiryAt ||
    (expiryAt === current.expiryAt && marketKey < current.marketKey)
  ) {
    byUnderlying.set(underlying, { underlying, marketKey, expiryAt });
  }
}

const selections = [...byUnderlying.values()].sort((a, b) => {
  if (a.underlying < b.underlying) return -1;
  if (a.underlying > b.underlying) return 1;
  if (a.marketKey < b.marketKey) return -1;
  if (a.marketKey > b.marketKey) return 1;
  return 0;
});

if (selections.length === 0) {
  fail("NO_TRADABLE_MARKETS", { runtimePath });
}

let index = 0;
try {
  const raw = readFileSync(statePath, "utf8").trim();
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed)) {
    index = ((parsed % selections.length) + selections.length) % selections.length;
  }
} catch {
  index = 0;
}

const selected = selections[index];
const next = (index + 1) % selections.length;
try {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${next}\n`, "utf8");
} catch {
  fail("CURSOR_WRITE_FAILED", { marketId: selected.marketKey, statePath });
}

const url = `${origin.replace(/\/+$/, "")}/api/internal/operator/liquidity`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
let response;
try {
  response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ marketId: selected.marketKey }),
    cache: "no-store",
    signal: controller.signal,
  });
} catch (error) {
  clearTimeout(timer);
  const reason = error instanceof Error ? error.name : "FETCH_FAILED";
  fail(reason, { marketId: selected.marketKey, underlying: selected.underlying });
} finally {
  clearTimeout(timer);
}

const status = response.status;
let body = null;
try {
  body = await response.json();
} catch {
  body = null;
}

if (!response.ok) {
  const code = body && typeof body.error === "string" ? body.error : `HTTP_${status}`;
  fail(code, { marketId: selected.marketKey, underlying: selected.underlying, status });
}

const failed = body && Array.isArray(body.failed) ? body.failed : null;
const pending = body && Array.isArray(body.pending) ? body.pending : null;
const refreshed = body && Array.isArray(body.markets) ? body.markets : null;
if (!failed || !pending || !refreshed) {
  fail("MALFORMED_LIQUIDITY_RESPONSE", { marketId: selected.marketKey, underlying: selected.underlying, status });
}
if (failed.length > 0) {
  const detail = failed[0] && typeof failed[0].error === "string" ? failed[0].error : "MAKER_FAILED";
  fail(detail, { marketId: selected.marketKey, underlying: selected.underlying, status });
}
if (pending.length > 0) {
  fail("MARKET_PENDING", { marketId: selected.marketKey, underlying: selected.underlying, status });
}
if (!refreshed.some((entry) => entry && entry.marketId === selected.marketKey)) {
  fail("MARKET_MISSING", { marketId: selected.marketKey, underlying: selected.underlying, status });
}

logAndExit(
  { ok: true, marketId: selected.marketKey, underlying: selected.underlying, status },
  0,
);
