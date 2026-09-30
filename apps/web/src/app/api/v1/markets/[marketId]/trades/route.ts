import { PublicApiError } from "@/lib/public-api/errors";
import { paginate, publicRoute } from "@/lib/public-api/handler";
import { ONCHAIN_MARKET_ID, chainContext, loadTrades } from "@/lib/public-api/chain";
import { findCatalogMarket, previewTape } from "@/lib/public-api/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute<{ marketId: string }>({ scope: "read" }, async ({ params, url }) => {
  const market = findCatalogMarket(params.marketId);
  if (!market) throw new PublicApiError(404, "NOT_FOUND", "No market has that id.");
  const context = await chainContext();
  if (market.id !== ONCHAIN_MARKET_ID) {
    const tape = previewTape(market, Number(context.chainTime)).map((trade) => ({ ...trade, source: "PREVIEW_TAPE" as const }));
    return paginate(tape, url);
  }
  const trades = (await loadTrades(context)).map((trade) => ({ ...trade, source: "ONCHAIN_FILL" as const }));
  return paginate(trades, url);
});
