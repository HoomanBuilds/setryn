import { PublicApiError } from "@/lib/public-api/errors";
import { publicRoute } from "@/lib/public-api/handler";
import { chainContext, loadPublicBook, onchainMarket } from "@/lib/public-api/chain";
import { priceOffset } from "@/lib/internal-gateway/runtime-markets";
import { findCatalogMarket } from "@/lib/public-api/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The live direct book of a market's active series. Only markets the deployment lists onchain have one. */
export const GET = publicRoute<{ marketId: string }>({ scope: "read" }, async ({ params }) => {
  const market = findCatalogMarket(params.marketId);
  if (!market) throw new PublicApiError(404, "NOT_FOUND", "No market has that id.");
  const context = await chainContext();
  const onchain = onchainMarket(context.setryn, market.id);
  if (!onchain) throw new PublicApiError(409, "MARKET_NOT_ONCHAIN", `${market.id} is not listed on this deployment, so it has no book.`);
  const book = await loadPublicBook(context, onchain);
  return {
    data: {
      marketId: market.id,
      source: "ONCHAIN_PUBLIC_BOOK",
      executable: true,
      seriesId: onchain.seriesId,
      bookId: book.bookId,
      priceScale: onchain.priceScale,
      priceOffset: priceOffset(onchain),
      headBlock: context.headBlock.toString(),
      chainTime: new Date(Number(context.chainTime) * 1000).toISOString(),
      bids: book.bids,
      asks: book.asks,
      orders: book.orders,
    },
  };
});
