import { PublicApiError } from "@/lib/public-api/errors";
import { publicRoute } from "@/lib/public-api/handler";
import { ONCHAIN_MARKET_ID, chainContext, loadPublicBook } from "@/lib/public-api/chain";
import { findCatalogMarket, previewDepth } from "@/lib/public-api/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute<{ marketId: string }>({ scope: "read" }, async ({ params }) => {
  const market = findCatalogMarket(params.marketId);
  if (!market) throw new PublicApiError(404, "NOT_FOUND", "No market has that id.");
  if (market.id !== ONCHAIN_MARKET_ID) {
    const depth = previewDepth(market);
    return {
      data: {
        marketId: market.id,
        source: "PREVIEW_DEPTH",
        executable: false,
        bids: depth.bids,
        asks: depth.asks,
        note: "Preview depth from the platform's market catalog snapshot. It is not an onchain book and cannot be traded through the API.",
      },
    };
  }
  const context = await chainContext();
  const book = await loadPublicBook(context);
  return {
    data: {
      marketId: market.id,
      source: "ONCHAIN_PUBLIC_BOOK",
      executable: true,
      bookId: book.bookId,
      headBlock: context.headBlock.toString(),
      chainTime: new Date(Number(context.chainTime) * 1000).toISOString(),
      bids: book.bids,
      asks: book.asks,
      orders: book.orders,
    },
  };
});
