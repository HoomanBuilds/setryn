import { parseJsonBody, publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { prepareOrder } from "@/lib/public-api/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Builds an unsigned order with chain-time deadlines and its EIP-712 typed data. Nothing is sent onchain. */
export const POST = publicRoute({ scope: "trade", write: true }, async ({ key, body }) => {
  const context = await chainContext();
  return { data: await prepareOrder(context, key, parseJsonBody(body)) };
});
