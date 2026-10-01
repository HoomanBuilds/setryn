import { readRuntime } from "@/lib/internal-gateway/runtime-server";
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
const GOVERNANCE_MESSAGE =
  "Fee schedule changes on this network go through the governance timelock (RegistryStatusController); the platform cannot change fees directly.";

function refused(request: Request): Response | null {
  const refusal = localRequestRefusal(request);
  return refusal ? Response.json({ error: "LOCAL_ONLY", message: refusal }, { status: 403, headers: NO_STORE }) : null;
}

async function isLocal(): Promise<boolean> {
  const setryn = await readRuntime().catch(() => null);
  return setryn?.network === "local";
}

/**
 * Local chain only: starts a fee schedule change with the requested maker and taker rates (basis points). The change
 * runs the contracts' fee update script, which registers and activates the next fee schedule version and re-versions
 * every market and series onto it; the response is the running job, which GET reports until it settles. Any other
 * network changes fees through the governance timelock, and this route refuses it.
 */
export async function POST(request: Request) {
  if (!(await isLocal())) {
    return Response.json({ error: "GOVERNANCE_TIMELOCK_REQUIRED", message: GOVERNANCE_MESSAGE }, { status: 403, headers: NO_STORE });
  }
  const blocked = refused(request);
  if (blocked) return blocked;
  try {
    const body = (await request.json().catch(() => ({}))) as { makerBps?: unknown; takerBps?: unknown };
    const makerBps = bpsArgument(body.makerBps, "Maker fee");
    const takerBps = bpsArgument(body.takerBps, "Taker fee");
    const liquidityUrl = new URL("/api/internal/operator/liquidity", request.url);
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

/**
 * The state of one fee change job (`?job=`), or the running one (else `{ status: "IDLE" }`) when no id is given. On a
 * network no job ever runs here, so the answer is always IDLE with the governance note.
 */
export async function GET(request: Request) {
  if (!(await isLocal())) {
    return Response.json({ status: "IDLE", governance: "GOVERNANCE_TIMELOCK", message: GOVERNANCE_MESSAGE }, { headers: NO_STORE });
  }
  const blocked = refused(request);
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get("job");
  if (!id) return Response.json(runningFeeChangeJob() ?? { status: "IDLE" }, { headers: NO_STORE });
  const job = feeChangeJob(id);
  if (!job) return Response.json({ error: "NOT_FOUND", message: "No such fee schedule change." }, { status: 404, headers: NO_STORE });
  return Response.json(job, { headers: NO_STORE });
}
