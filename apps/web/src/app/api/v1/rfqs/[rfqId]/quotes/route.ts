import { paginate, publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";
import { getRfqForKey, solicitQuotes } from "@/lib/public-api/rfqs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quotes on an RFQ, best price for the requester first. */
export const GET = publicRoute<{ rfqId: string }>({ scope: "read" }, async ({ key, params, url }) => {
  const rfqId = parseBytes32(params.rfqId, "rfqId");
  const context = await chainContext();
  const rfq = await getRfqForKey(context, key, rfqId);
  return paginate(rfq.quotes, url);
});

/** Invites the eligible solvers to quote an RFQ that is collecting. */
export const POST = publicRoute<{ rfqId: string }>({ scope: "trade", write: true }, async ({ key, params, url }) => {
  const rfqId = parseBytes32(params.rfqId, "rfqId");
  const context = await chainContext();
  return { data: await solicitQuotes(context, key, rfqId, url.origin) };
});
