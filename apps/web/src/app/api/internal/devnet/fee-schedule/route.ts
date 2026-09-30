import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";
import {
  bpsArgument,
  feeChangeJob,
  FeeScheduleChangeError,
  runningFeeChangeJob,
  startFeeScheduleChange,
} from "@/lib/treasury/fee-schedule-admin";
import { localRequestRefusal } from "@/lib/treasury/local-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function refused(request: Request): Response | null {
  const refusal = localRequestRefusal(request);
  return refusal ? Response.json({ error: "LOCAL_ONLY", message: refusal }, { status: 403, headers: NO_STORE }) : null;
}

/**
 * Local network only: starts a fee schedule change with the requested maker and taker rates (basis points). The change
 * runs the contracts' fee update script, which registers and activates the next fee schedule version and re-versions
 * every market and series onto it; the response is the running job, which GET reports until it settles. Any other
 * network changes fees through governance, and this route refuses it.
 */
export async function POST(request: Request) {
  const blocked = refused(request);
  if (blocked) return blocked;
  try {
    const body = (await request.json().catch(() => ({}))) as { makerBps?: unknown; takerBps?: unknown };
    const makerBps = bpsArgument(body.makerBps, "Maker fee");
    const takerBps = bpsArgument(body.takerBps, "Taker fee");
    const setryn = await readLocalRuntime().catch(() => null);
    if (!setryn || setryn.chainId !== 31337) {
      throw new FeeScheduleChangeError(403, "GOVERNANCE_ONLY", "Fee schedule changes on this network go through governance.");
    }
    const liquidityUrl = new URL("/api/internal/devnet/liquidity", request.url);
    const job = startFeeScheduleChange({ makerBps, takerBps }, (settled) => {
      // Every market now trades a new series version with its own book, so the maker re-quotes all of them.
      if (settled.status !== "SUCCEEDED") return;
      void fetch(liquidityUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
    });
    return Response.json(job, { status: 202, headers: NO_STORE });
  } catch (error) {
    if (error instanceof FeeScheduleChangeError) {
      return Response.json({ error: error.code, message: error.message, job: runningFeeChangeJob() }, { status: error.status, headers: NO_STORE });
    }
    const message = error instanceof Error ? error.message.split("\n")[0] : "FEE_SCHEDULE_CHANGE_FAILED";
    return Response.json({ error: "FEE_SCHEDULE_CHANGE_FAILED", message }, { status: 503, headers: NO_STORE });
  }
}

/** The state of one fee change job (`?job=`), or the running one (else `{ status: "IDLE" }`) when no id is given. */
export async function GET(request: Request) {
  const blocked = refused(request);
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get("job");
  if (!id) return Response.json(runningFeeChangeJob() ?? { status: "IDLE" }, { headers: NO_STORE });
  const job = feeChangeJob(id);
  if (!job) return Response.json({ error: "NOT_FOUND", message: "No such fee schedule change." }, { status: 404, headers: NO_STORE });
  return Response.json(job, { headers: NO_STORE });
}
