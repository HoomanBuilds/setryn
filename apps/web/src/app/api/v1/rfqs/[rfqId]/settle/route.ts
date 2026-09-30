import { publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";
import { settleRfq } from "@/lib/public-api/rfqs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hands a submitted RFQ to its permitted executor for atomic clearing and returns the fill. */
export const POST = publicRoute<{ rfqId: string }>({ scope: "trade", write: true }, async ({ key, params, url }) => {
  const rfqId = parseBytes32(params.rfqId, "rfqId");
  const context = await chainContext();
  return { data: await settleRfq(context, key, rfqId, url.origin) };
});
