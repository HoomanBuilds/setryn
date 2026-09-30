import { PublicApiError } from "@/lib/public-api/errors";
import { publicRoute } from "@/lib/public-api/handler";
import { chainContext, loadOrder } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute<{ orderHash: string }>({ scope: "read" }, async ({ params }) => {
  const orderHash = parseBytes32(params.orderHash, "orderHash");
  const context = await chainContext();
  const order = await loadOrder(context, orderHash);
  if (!order) throw new PublicApiError(404, "NOT_FOUND", "No registered order on an onchain market has that hash.");
  return { data: order };
});
