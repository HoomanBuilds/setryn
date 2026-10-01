import { readMarketDataSnapshot } from "@/lib/market-data/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The market-data feed: every listed market's onchain book, fills, open interest, and series status at one block,
 * with the Chainlink references. An unreachable chain is reported in `chain`, never replaced with other numbers.
 */
export async function GET() {
  try {
    return Response.json(await readMarketDataSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "MARKET_DATA_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
