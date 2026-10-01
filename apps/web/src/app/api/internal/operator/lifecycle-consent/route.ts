import type { Hex } from "viem";
import { MakerConsentRefusal, signMakerConsent } from "@/lib/internal-gateway/maker-consent";
import { makerSigner, signerUnavailableResponse } from "@/lib/internal-gateway/operator-signer";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const HASH = /^0x[0-9a-fA-F]{64}$/;

interface ConsentBody {
  actionId?: unknown;
  accountId?: unknown;
  nonce?: unknown;
  deadline?: unknown;
  salt?: unknown;
  allowsPackageBreak?: unknown;
  positionIds?: unknown;
}

/**
 * The designated maker's counterparty consent for a full exit. It consents only for positions it is the counterparty
 * of (`positionIds`), on terms that add no liability or collateral; any other position answers 409
 * COUNTERPARTY_CONSENT_REQUIRED, since only its real counterparty can consent.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConsentBody;
    if (
      typeof body.actionId !== "string" || !HASH.test(body.actionId) ||
      typeof body.accountId !== "string" || !HASH.test(body.accountId) ||
      typeof body.nonce !== "string" || !/^\d+$/.test(body.nonce) ||
      typeof body.deadline !== "string" || !/^\d+$/.test(body.deadline) ||
      typeof body.salt !== "string" || !HASH.test(body.salt) ||
      !Array.isArray(body.positionIds) || body.positionIds.length === 0 || body.positionIds.length > 8 ||
      !body.positionIds.every((positionId) => typeof positionId === "string" && HASH.test(positionId))
    ) {
      return Response.json({ error: "Invalid lifecycle consent" }, { status: 400, headers: NO_STORE });
    }
    if (body.allowsPackageBreak === true) {
      return Response.json({ error: "MAKER_CONSENT_TERMS_REFUSED" }, { status: 403, headers: NO_STORE });
    }
    const setryn = await readRuntime();
    const maker = await makerSigner(setryn);
    const signature = await signMakerConsent(
      setryn,
      {
        actionId: body.actionId as Hex,
        accountId: body.accountId as Hex,
        signer: maker.address,
        nonce: BigInt(body.nonce),
        deadline: BigInt(body.deadline),
        maximumLiabilityIncreaseBaseUnits: BigInt(0),
        maximumCollateralIncreaseBaseUnits: BigInt(0),
        allowsPackageBreak: false,
        salt: body.salt as Hex,
      },
      body.positionIds as Hex[],
    );
    return Response.json({ signature, signer: maker.address }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MakerConsentRefusal) {
      return Response.json({ error: error.message, message: error.detail }, { status: error.status, headers: NO_STORE });
    }
    // Without a designated maker there is no counterparty the platform can consent for.
    const unavailable = signerUnavailableResponse(error);
    if (unavailable) return Response.json({ error: "COUNTERPARTY_CONSENT_REQUIRED", message: "No designated maker can consent on this network." }, { status: 409, headers: NO_STORE });
    const message = error instanceof Error ? error.message.split("\n")[0] : "LIFECYCLE_CONSENT_FAILED";
    return Response.json({ error: message }, { status: 503, headers: NO_STORE });
  }
}
