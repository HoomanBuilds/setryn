import { parseJsonBody, publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";
import { prepareAcceptance } from "@/lib/public-api/rfqs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Builds the unsigned selection of one quote as EIP-712 typed data. Nothing is sent onchain. */
export const POST = publicRoute<{ rfqId: string }>({ scope: "trade", write: true }, async ({ key, params, body }) => {
  const rfqId = parseBytes32(params.rfqId, "rfqId");
  const context = await chainContext();
  return { data: await prepareAcceptance(context, key, rfqId, parseJsonBody(body)) };
});
