import { parseJsonBody, publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { prepareRfq } from "@/lib/public-api/rfqs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Builds an unsigned private RFQ: the taker order and the request bound to it, as EIP-712 typed data. Nothing is sent onchain. */
export const POST = publicRoute({ scope: "trade", write: true }, async ({ key, body }) => {
  const context = await chainContext();
  return { data: await prepareRfq(context, key, parseJsonBody(body)) };
});
