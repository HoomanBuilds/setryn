import { publicRoute } from "@/lib/public-api/handler";
import { chainContext } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";
import { getRfqForKey } from "@/lib/public-api/rfqs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute<{ rfqId: string }>({ scope: "read" }, async ({ key, params }) => {
  const rfqId = parseBytes32(params.rfqId, "rfqId");
  const context = await chainContext();
  return { data: await getRfqForKey(context, key, rfqId) };
});
