import { paginate, publicRoute } from "@/lib/public-api/handler";
import { chainContext, loadAccountActivity } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute<{ accountId: string }>({ scope: "read" }, async ({ params, url }) => {
  const accountId = parseBytes32(params.accountId, "accountId");
  const context = await chainContext();
  const activity = await loadAccountActivity(context, accountId);
  return paginate(activity.positions, url);
});
