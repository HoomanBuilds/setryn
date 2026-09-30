import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";
import { readTreasury } from "@/lib/treasury/revenue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The protocol fee account, the active fee schedule and its history, and revenue rebuilt from the fee ledger. */
export async function GET() {
  try {
    const setryn = await readLocalRuntime();
    return Response.json(await readTreasury(setryn), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "TREASURY_UNAVAILABLE";
    return Response.json({ error: "TREASURY_UNAVAILABLE", message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
