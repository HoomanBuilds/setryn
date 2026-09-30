import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";
import { paginate, publicRoute } from "@/lib/public-api/handler";
import { catalog, marketDeployment, projectMarket } from "@/lib/public-api/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute({ scope: "read" }, async ({ url }) => {
  const deployment = await marketDeployment(await readLocalRuntime().catch(() => null));
  const execution = url.searchParams.get("execution");
  const markets = catalog()
    .map((market) => projectMarket(market, deployment))
    .filter((market) => !execution || market.execution === execution);
  return paginate(markets, url);
});
