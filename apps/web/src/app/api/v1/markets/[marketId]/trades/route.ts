import { PublicApiError } from "@/lib/public-api/errors";
import { paginate, publicRoute } from "@/lib/public-api/handler";
import { chainContext, loadTrades, onchainMarket } from "@/lib/public-api/chain";
import { findCatalogMarket } from "@/lib/public-api/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Onchain direct-book fills of a market's series, newest first. A market not listed onchain has no tape. */
export const GET = publicRoute<{ marketId: string }>({ scope: "read" }, async ({ params, url }) => {
  const market = findCatalogMarket(params.marketId);
  if (!market) throw new PublicApiError(404, "NOT_FOUND", "No market has that id.");
  const context = await chainContext();
  const onchain = onchainMarket(context.setryn, market.id);
  if (!onchain) throw new PublicApiError(409, "MARKET_NOT_ONCHAIN", `${market.id} is not listed on this deployment, so it has no trades.`);
  const trades = (await loadTrades(context, onchain)).map((trade) => ({ ...trade, source: "ONCHAIN_FILL" as const }));
  return paginate(trades, url);
});
