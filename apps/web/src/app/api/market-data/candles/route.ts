import type { NextRequest } from "next/server";
import { isChartInterval } from "@/lib/market-data/intervals";
import { readMarketCandles } from "@/lib/market-data/server";
import { CATALOG_MARKETS } from "@/lib/terminal/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Chart data for one listed market: OHLC bars of its own modeled mark (always, before and after trades), its fills as
 * markers with the lots traded per bar as volume, the Chainlink spot as a separate line, and the floor and cap.
 * `?market=<key>&interval=<1m|3m|5m|15m|30m|1h|2h|4h|6h|12h|1d|1w>`.
 */
export async function GET(request: NextRequest) {
  const marketKey = request.nextUrl.searchParams.get("market")?.trim() ?? "";
  const interval = request.nextUrl.searchParams.get("interval") ?? "15m";
  const entry = CATALOG_MARKETS.get(marketKey);
  if (!entry) return Response.json({ error: "UNKNOWN_MARKET" }, { status: 404, headers: NO_STORE });
  if (!isChartInterval(interval)) return Response.json({ error: "INVALID_INTERVAL" }, { status: 400, headers: NO_STORE });
  try {
    const candles = await readMarketCandles(marketKey, interval, {
      underlying: entry.underlying,
      floor: entry.floor,
      cap: entry.cap,
      expiryAt: entry.expiryAt,
      tickSize: entry.tickPrice,
      priceDecimals: entry.priceDecimals,
    });
    return Response.json(candles, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "CANDLES_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
