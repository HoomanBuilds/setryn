import { readRuntime } from "@/lib/internal-gateway/runtime-server";
import { PublicApiError } from "@/lib/public-api/errors";
import { publicRoute } from "@/lib/public-api/handler";
import { findCatalogMarket, marketDeployment, projectMarket } from "@/lib/public-api/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute<{ marketId: string }>({ scope: "read" }, async ({ params }) => {
  const market = findCatalogMarket(params.marketId);
  if (!market) throw new PublicApiError(404, "NOT_FOUND", "No market has that id.");
  const deployment = await marketDeployment(await readRuntime().catch(() => null));
  return { data: projectMarket(market, deployment) };
});
