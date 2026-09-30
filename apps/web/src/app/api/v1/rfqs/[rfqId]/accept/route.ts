import { parseJsonBody, publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";
import { acceptQuote } from "@/lib/public-api/rfqs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verifies a signed quote selection and returns the transactions the requester must send. */
export const POST = publicRoute<{ rfqId: string }>({ scope: "trade", write: true }, async ({ key, params, body }) => {
  const rfqId = parseBytes32(params.rfqId, "rfqId");
  const context = await chainContext();
  return { data: await acceptQuote(context, key, rfqId, parseJsonBody(body)) };
});
