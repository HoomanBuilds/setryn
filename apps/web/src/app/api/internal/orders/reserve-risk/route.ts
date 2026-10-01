import { isHex, type Hex } from "viem";
import { signerUnavailableResponse } from "@/lib/internal-gateway/operator-signer";
import { parsePublicOrder, type SerializedPublicOrder } from "@/lib/internal-gateway/protocol";
import { reserveOrderRisk, RiskAdmissionRefusal } from "@/lib/internal-gateway/risk-admission";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

interface ReservationBody {
  order?: SerializedPublicOrder;
  signature?: unknown;
  orderHash?: unknown;
}

/** Operator-side portfolio risk admission for one signed order (lib/internal-gateway/risk-admission.ts). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReservationBody;
    const order = parsePublicOrder(body.order);
    if (
      typeof body.signature !== "string" ||
      !isHex(body.signature, { strict: true }) ||
      typeof body.orderHash !== "string" ||
      !isHex(body.orderHash, { strict: true }) ||
      body.orderHash.length !== 66
    ) {
      return Response.json({ error: "Invalid signed order" }, { status: 400, headers: NO_STORE });
    }
    const setryn = await readRuntime();
    const result = await reserveOrderRisk(setryn, order, body.signature as Hex, body.orderHash as Hex);
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RiskAdmissionRefusal) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    const unavailable = signerUnavailableResponse(error);
    if (unavailable) return unavailable;
    // The client sees a stable message; the cause (revert name, RPC failure) stays in the server log.
    console.error("[reserve-risk]", error instanceof Error ? error.message.split("\n").slice(0, 6).join(" ") : error);
    return Response.json({ error: "Risk reservation failed" }, { status: 422, headers: NO_STORE });
  }
}
