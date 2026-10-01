import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { withMakerLock } from "@/lib/internal-gateway/maker-lock";
import { invalidateFeeScheduleCache } from "@/lib/internal-gateway/fee-schedule";

/*
 * Local network fee control. A fee change is one onchain sequence with a single implementation, the contracts'
 * `scripts/update-devnet-fees.mjs`: it registers the next fee schedule version with the requested maker and taker
 * rates, installs its rule witness, swaps the active pointer, then registers a successor version of every market pinned
 * to the new fee version and of every series pinned to the new market version, and rewrites the local runtime from what
 * it reads back onchain. A fee-only swap would close every market for new risk (each market pins an exact fee version),
 * so this module never sends a registry transaction itself; it runs that script and reports its one-line JSON result.
 *
 * The script can compile contracts first, which takes minutes, so a change runs as a background job the page polls. It
 * broadcasts as the operator, so the job holds the maker lock: the local designated maker's quoting (also the operator)
 * waits rather than racing the script's nonces. Every other network changes fees through the governance timelock.
 */

const JOBS_KEY = Symbol.for("setryn.treasury.fee-change-jobs");
/** Basis points with at most two decimals: the only argument shape ever passed to the script. */
const BPS_PATTERN = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/;
const JOB_TIMEOUT_MS = 20 * 60_000;
const STDERR_TAIL = 4_000;

export class FeeScheduleChangeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A request rate as the script's argument: a JSON number of basis points, at most two decimals, below 10,000. */
export function bpsArgument(value: unknown, label: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new FeeScheduleChangeError(400, "INVALID_RATE", `${label} must be a non-negative number of basis points.`);
  }
  const text = String(Number(value.toFixed(2)));
  if (Math.abs(Number(text) - value) > 1e-9 || !BPS_PATTERN.test(text)) {
    throw new FeeScheduleChangeError(400, "INVALID_RATE", `${label} accepts at most two decimals (0.01 bp is the smallest step) and must be below 10,000 bp.`);
  }
  return text;
}

export interface FeeChangeMarket {
  marketKey: string;
  marketId: string;
  marketVersion: number;
  seriesId: string;
  seriesVersion: number;
}

export interface FeeChangeResult {
  changed: boolean;
  feeScheduleId: string;
  previousFeeScheduleVersion: number;
  feeScheduleVersion: number;
  makerFeeRatePpm: number;
  takerFeeRatePpm: number;
  markets: FeeChangeMarket[];
}

export interface FeeChangeJob {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  makerBps: string;
  takerBps: string;
  startedAt: string;
  finishedAt: string | null;
  result: FeeChangeResult | null;
  error: { code: string; message: string } | null;
}

function jobs(): Map<string, FeeChangeJob> {
  const holder = globalThis as unknown as Record<symbol, Map<string, FeeChangeJob> | undefined>;
  holder[JOBS_KEY] ??= new Map();
  return holder[JOBS_KEY];
}

function repositoryRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith("/apps/web") ? resolve(/*turbopackIgnore: true*/ cwd, "../..") : resolve(/*turbopackIgnore: true*/ cwd);
}

export function feeChangeJob(id: string): FeeChangeJob | null {
  return jobs().get(id) ?? null;
}

export function runningFeeChangeJob(): FeeChangeJob | null {
  for (const job of jobs().values()) if (job.status === "RUNNING") return job;
  return null;
}

/** The script's exit codes, as stable job error codes when its JSON line does not name one. */
const EXIT_CODES: Record<number, string> = {
  1: "UNEXPECTED",
  2: "USAGE",
  3: "REFUSED_ENVIRONMENT",
  4: "BUSY",
  5: "UPDATE_FAILED",
  6: "INCONSISTENT_STATE",
  7: "RUNTIME_WRITE_FAILED",
};

function parseResult(line: string): { ok: true; value: FeeChangeResult } | { ok: false; code: string; message: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.ok === false) {
    const error = (record.error ?? {}) as { code?: unknown; message?: unknown };
    return { ok: false, code: typeof error.code === "string" ? error.code : "UPDATE_FAILED", message: typeof error.message === "string" ? error.message : "The fee update failed." };
  }
  if (record.ok !== true) return null;
  const number = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) ? value : 0);
  const markets = Array.isArray(record.markets) ? (record.markets as Record<string, unknown>[]) : [];
  return {
    ok: true,
    value: {
      changed: record.changed === true,
      feeScheduleId: typeof record.feeScheduleId === "string" ? record.feeScheduleId : "",
      previousFeeScheduleVersion: number(record.previousFeeScheduleVersion),
      feeScheduleVersion: number(record.feeScheduleVersion),
      makerFeeRatePpm: number(record.makerFeeRatePpm),
      takerFeeRatePpm: number(record.takerFeeRatePpm),
      markets: markets.map((market) => ({
        marketKey: String(market.marketKey ?? ""),
        marketId: String(market.marketId ?? ""),
        marketVersion: number(market.marketVersion),
        seriesId: String(market.seriesId ?? ""),
        seriesVersion: number(market.seriesVersion),
      })),
    },
  };
}

/**
 * Starts the fee update as a background job and returns it at once. Only numeric basis-point arguments reach the
 * script, which itself refuses any chain but the local one (31337) on a loopback RPC. `onSettled` runs after the job
 * ends either way, for cache refreshes.
 */
export function startFeeScheduleChange(input: { makerBps: string; takerBps: string }, onSettled?: (job: FeeChangeJob) => void): FeeChangeJob {
  if (!BPS_PATTERN.test(input.makerBps) || !BPS_PATTERN.test(input.takerBps)) {
    throw new FeeScheduleChangeError(400, "INVALID_RATE", "Rates must be basis points with at most two decimals.");
  }
  const running = runningFeeChangeJob();
  if (running) throw new FeeScheduleChangeError(409, "BUSY", "A fee schedule change is already running.");
  const root = repositoryRoot();
  const script = resolve(/*turbopackIgnore: true*/ root, "scripts/update-devnet-fees.mjs");
  if (!existsSync(script)) {
    throw new FeeScheduleChangeError(503, "UPDATE_SCRIPT_MISSING", "The fee update script is not installed in this deployment.");
  }
  const job: FeeChangeJob = {
    id: crypto.randomUUID(),
    status: "RUNNING",
    makerBps: input.makerBps,
    takerBps: input.takerBps,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs().set(job.id, job);

  void withMakerLock(() => new Promise<void>((release) => runScript(job, script, root, input, release, onSettled)));
  return job;
}

function runScript(
  job: FeeChangeJob,
  script: string,
  root: string,
  input: { makerBps: string; takerBps: string },
  release: () => void,
  onSettled?: (job: FeeChangeJob) => void,
): void {
  const child = spawn(process.execPath, [script, "--maker-bps", input.makerBps, "--taker-bps", input.takerBps], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL);
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), JOB_TIMEOUT_MS);
  const finish = (code: number | null, spawnError?: Error) => {
    clearTimeout(timer);
    if (job.status !== "RUNNING") return;
    const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
    const parsed = parseResult(line);
    job.finishedAt = new Date().toISOString();
    // The script reports forge's detail on stderr; its last error line makes a failed job diagnosable.
    const detail = stderr.split("\n").map((entry) => entry.trim()).filter((entry) => /error|revert/i.test(entry)).at(-1)?.slice(0, 300) ?? null;
    if (parsed?.ok) {
      job.status = "SUCCEEDED";
      job.result = parsed.value;
    } else {
      job.status = "FAILED";
      job.error = parsed && !parsed.ok
        ? { code: parsed.code, message: detail ? `${parsed.message} (${detail})` : parsed.message }
        : {
            code: spawnError ? "SPAWN_FAILED" : EXIT_CODES[code ?? 1] ?? "UNEXPECTED",
            message: spawnError?.message ?? (stderr.trim().split("\n").at(-1) || "The fee update ended without a result."),
          };
    }
    invalidateFeeScheduleCache();
    release();
    onSettled?.(job);
  };
  child.on("error", (error) => finish(null, error));
  child.on("close", (code) => finish(code));
}
