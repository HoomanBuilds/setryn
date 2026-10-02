import { refreshMakerLiquidity } from "@/lib/internal-gateway/maker-liquidity";
import { MakerPricingError } from "@/lib/internal-gateway/maker-pricing";
import { signerUnavailableResponse } from "@/lib/internal-gateway/operator-signer";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Serverless hosts stop a request at this many seconds; the refresh budget below stays well inside it. */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
/** Markets are only started inside this budget; each takes a few seconds per side, so the request ends in time. */
const FULL_REFRESH_BUDGET_MS = 30_000;
const MARKET_REFRESH_BUDGET_MS = 30_000;
/** How long a finished refresh answers further requests for the same scope. */
const REUSE_MS = 10_000;

/**
 * The designated maker's quotes (lib/internal-gateway/maker-liquidity.ts). The connected trading application asks for a
 * full refresh when a wallet connects and on its polling timer, and for one market when a taker finds that book empty.
 * Concurrent requests for the same scope in this process share one run and a just-finished run answers again; every
 * transaction runs under the maker lock, which also spans server instances when the database is configured. A full
 * refresh that runs out of budget reports the markets it did not reach as `pending`, and the next request starts there.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { marketId?: unknown };
  const marketId = typeof body.marketId === "string" && body.marketId.length > 0 ? body.marketId : null;
  const shared = sharedRun(marketId ?? "*");
  if (shared.running) return (await shared.running).clone();
  if (shared.last && Date.now() - shared.last.at < REUSE_MS) return shared.last.response.clone();
  shared.running = refresh(marketId)
    .then((response) => {
      // Only a successful run answers again; a failed one (a busy lock, an RPC error) is retried by the next request.
      shared.last = response.ok ? { at: Date.now(), response: response.clone() } : null;
      return response;
    })
    .finally(() => {
      shared.running = null;
    });
  return (await shared.running).clone();
}

const SHARED_KEY = Symbol.for("setryn.maker-liquidity.shared");

interface SharedRun {
  running: Promise<Response> | null;
  last: { at: number; response: Response } | null;
}

function sharedRun(scope: string): SharedRun {
  const holder = globalThis as unknown as Record<symbol, Map<string, SharedRun> | undefined>;
  holder[SHARED_KEY] ??= new Map();
  let run = holder[SHARED_KEY].get(scope);
  if (!run) {
    run = { running: null, last: null };
    holder[SHARED_KEY].set(scope, run);
  }
  return run;
}

async function refresh(marketId: string | null): Promise<Response> {
  try {
    const setryn = await readRuntime();
    if (marketId !== null && !setryn.markets.some((market) => market.marketKey === marketId)) {
      return Response.json({ error: "MARKET_NOT_ONCHAIN_ENABLED" }, { status: 404, headers: NO_STORE });
    }
    const result = await refreshMakerLiquidity(
      setryn,
      marketId === null ? null : [marketId],
      marketId === null ? FULL_REFRESH_BUDGET_MS : MARKET_REFRESH_BUDGET_MS,
    );
    // Every requested market failing is a failed refresh; a partial or budget-limited one returns what it did.
    const attempted = result.markets.length + result.failed.length;
    const status = attempted > 0 && result.markets.length === 0 && result.pending.length === 0 ? 422 : 200;
    return Response.json(
      { ...result, ...(status === 422 ? { error: result.failed[0]?.error ?? "MAKER_LIQUIDITY_FAILED" } : {}) },
      { status, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof MakerPricingError) {
      return Response.json({ error: error.code, message: error.detail }, { status: error.status, headers: NO_STORE });
    }
    const unavailable = signerUnavailableResponse(error);
    if (unavailable) return unavailable;
    const message = error instanceof Error ? error.message.split("\n")[0] : "MAKER_LIQUIDITY_FAILED";
    const status = message === "MARKET_NOT_ONCHAIN_ENABLED" ? 404 : message === "MAKER_BUSY" ? 409 : 422;
    return Response.json({ error: message }, { status, headers: NO_STORE });
  }
}
