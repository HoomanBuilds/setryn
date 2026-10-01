import type { NextRequest } from "next/server";
import { isChartInterval } from "@/lib/market-data/intervals";
import { readMarketCandles } from "@/lib/market-data/server";
import { CATALOG_MARKETS } from "@/lib/terminal/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * OHLCV bars for one listed market: its onchain fills, or, while it has none, the Chainlink history of its underlying,
 * labelled `REFERENCE`. `?market=<key>&interval=<1m|3m|5m|15m|30m|1h|2h|4h|6h|12h|1d|1w>`.
 */
export async function GET(request: NextRequest) {
  const marketKey = request.nextUrl.searchParams.get("market")?.trim() ?? "";
  const interval = request.nextUrl.searchParams.get("interval") ?? "15m";
  const entry = CATALOG_MARKETS.get(marketKey);
  if (!entry) return Response.json({ error: "UNKNOWN_MARKET" }, { status: 404, headers: NO_STORE });
  if (!isChartInterval(interval)) return Response.json({ error: "INVALID_INTERVAL" }, { status: 400, headers: NO_STORE });
  try {
    const candles = await readMarketCandles(marketKey, interval, entry.underlying);
    return Response.json(candles, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "CANDLES_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
