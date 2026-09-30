import { PublicApiError } from "@/lib/public-api/errors";
import { paginate, publicRoute } from "@/lib/public-api/handler";
import { chainContext, loadTrades, onchainMarket } from "@/lib/public-api/chain";
import { findCatalogMarket, previewTape } from "@/lib/public-api/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute<{ marketId: string }>({ scope: "read" }, async ({ params, url }) => {
  const market = findCatalogMarket(params.marketId);
  if (!market) throw new PublicApiError(404, "NOT_FOUND", "No market has that id.");
  const context = await chainContext();
  const onchain = onchainMarket(context.setryn, market.id);
  if (!onchain) {
    const tape = previewTape(market, Number(context.chainTime)).map((trade) => ({ ...trade, source: "PREVIEW_TAPE" as const }));
    return paginate(tape, url);
  }
  const trades = (await loadTrades(context, onchain)).map((trade) => ({ ...trade, source: "ONCHAIN_FILL" as const }));
  return paginate(trades, url);
});
