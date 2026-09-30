import { parseJsonBody, publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { prepareExit } from "@/lib/public-api/exits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Builds the full lifecycle exit of a position and its opposite closing position, with the counterparty's consent and
 * the actor's EIP-712 typed data. Nothing is sent onchain.
 */
export const POST = publicRoute({ scope: "trade", write: true }, async ({ key, body }) => {
  const context = await chainContext();
  return { data: await prepareExit(context, key, parseJsonBody(body)) };
});
