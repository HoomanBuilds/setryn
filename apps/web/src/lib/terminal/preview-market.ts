import type { PackageMarket } from "./types";

export interface PreviewStreamState {
  marketId: string;
  tick: number;
  offsetTicks: number;
}

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

export function initialPreviewStream(marketId: string): PreviewStreamState {
  return { marketId, tick: 0, offsetTicks: 0 };
}

export function advancePreviewStream(
  marketId: string,
  current: PreviewStreamState,
): PreviewStreamState {
  const nextTick = current.marketId === marketId ? current.tick + 1 : 1;
  const currentOffset = current.marketId === marketId ? current.offsetTicks : 0;

  let direction: -1 | 1;
  if (currentOffset >= 7) direction = -1;
  else if (currentOffset <= -7) direction = 1;
  else direction = (hash(`${marketId}:${nextTick}`) & 1) === 0 ? -1 : 1;

  return {
    marketId,
    tick: nextTick,
    offsetTicks: currentOffset + direction,
  };
}

export function derivePreviewMarket(
  market: PackageMarket,
  stream: PreviewStreamState,
): PackageMarket {
  if (stream.marketId !== market.id || stream.offsetTicks === 0) {
    return stream.marketId === market.id && market.snapshotAgeSeconds !== 0
      ? { ...market, snapshotAgeSeconds: 0 }
      : market;
  }

  const delta = stream.offsetTicks * market.tickSize;
  const shift = (price: number) => round(price + delta, market.priceDecimals);

  return {
    ...market,
    netPrice: shift(market.netPrice),
    bestBid: shift(market.bestBid),
    bestAsk: shift(market.bestAsk),
    snapshotAgeSeconds: 0,
    book: market.book.map((row) => ({ ...row, price: shift(row.price) })),
    routes: market.routes.map((route) => ({
      ...route,
      enterPrice: shift(route.enterPrice),
      exitPrice: shift(route.exitPrice),
    })),
  };
}
