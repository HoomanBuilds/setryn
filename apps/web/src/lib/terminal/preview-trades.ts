import type { PackageMarket } from "./types";

export interface PreviewTrade {
  id: string;
  /** Epoch seconds. */
  time: number;
  price: number;
  lots: number;
  /** Aggressor side: a buy lifts the offer, a sell hits the bid. */
  side: "BUY" | "SELL";
}

export const PREVIEW_TRADE_LIMIT = 80;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** Lot sizes skew small with occasional block prints, like a real tape. */
function printLots(seed: number): number {
  const bucket = seed % 100;
  if (bucket < 55) return 1 + (seed % 4);
  if (bucket < 85) return 4 + (seed % 9);
  if (bucket < 97) return 12 + (seed % 20);
  return 40 + (seed % 60);
}

/**
 * Prints that led into the current mark. They stay inside one tick of the live price and finish exactly on it,
 * so the tape, the last candle, and the book mid agree from the first render.
 */
export function seedPreviewTrades(market: PackageMarket, epochSeconds: number): PreviewTrade[] {
  const trades: PreviewTrade[] = [];
  let price = market.netPrice;
  for (let index = 0; index < 36; index += 1) {
    const seed = hash(`${market.id}:seed:${index}`);
    const step = ((seed >>> 8) % 3) - 1;
    const previous = round(price - step * market.tickSize, market.priceDecimals);
    trades.push({
      id: `${market.id}:seed:${index}`,
      time: epochSeconds - index * (2 + (seed % 7)),
      price,
      lots: printLots(seed),
      side: step > 0 ? "BUY" : step < 0 ? "SELL" : (seed & 1) === 0 ? "BUY" : "SELL",
    });
    price = previous;
  }
  return trades;
}

/** One print at the new mark produced by a preview tick. */
export function nextPreviewTrade(
  market: PackageMarket,
  tick: number,
  previousPrice: number,
  epochSeconds: number,
): PreviewTrade {
  const seed = hash(`${market.id}:tick:${tick}`);
  const side =
    market.netPrice > previousPrice
      ? "BUY"
      : market.netPrice < previousPrice
        ? "SELL"
        : (seed & 1) === 0
          ? "BUY"
          : "SELL";
  return {
    id: `${market.id}:tick:${tick}`,
    time: epochSeconds,
    price: market.netPrice,
    lots: printLots(seed),
    side,
  };
}
