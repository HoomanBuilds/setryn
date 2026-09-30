import { publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";
import { prepareRfqCancel } from "@/lib/public-api/rfqs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prepares the cancellation of an unselected (or expired) RFQ for its requester to execute. */
export const POST = publicRoute<{ rfqId: string }>({ scope: "trade", write: true }, async ({ key, params }) => {
  const rfqId = parseBytes32(params.rfqId, "rfqId");
  const context = await chainContext();
  return { data: await prepareRfqCancel(context, key, rfqId) };
});
