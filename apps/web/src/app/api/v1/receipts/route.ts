import { paginate, publicRoute } from "@/lib/public-api/handler";
import { chainContext, loadAccountActivity } from "@/lib/public-api/chain";
import { accountFromQuery } from "@/lib/public-api/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute({ scope: "read" }, async ({ url }) => {
  const context = await chainContext();
  const activity = await loadAccountActivity(context, await accountFromQuery(context, url));
  return paginate(activity.receipts, url);
});
