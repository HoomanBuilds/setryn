import { publicRoute } from "@/lib/public-api/handler";
import { chainContext, loadAccount } from "@/lib/public-api/chain";
import { parseBytes32 } from "@/lib/public-api/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute<{ accountId: string }>({ scope: "read" }, async ({ params }) => {
  const accountId = parseBytes32(params.accountId, "accountId");
  const context = await chainContext();
  return { data: await loadAccount(context, accountId) };
});
