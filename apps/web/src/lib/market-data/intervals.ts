import type { ChartInterval, MarketCandle } from "./types";

/** Bar length of every chart interval, in seconds. */
export const INTERVAL_SECONDS: Record<ChartInterval, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1_800,
  "1h": 3_600,
  "2h": 7_200,
  "4h": 14_400,
  "6h": 21_600,
  "12h": 43_200,
  "1d": 86_400,
  "1w": 604_800,
};

/** Most bars a candles response carries per interval. */
export const MAX_BARS: Record<ChartInterval, number> = {
  "1m": 1_440,
  "3m": 960,
  "5m": 864,
  "15m": 672,
  "30m": 672,
  "1h": 720,
  "2h": 540,
  "4h": 540,
  "6h": 480,
  "12h": 400,
  "1d": 400,
  "1w": 156,
};

/** 1970-01-05 was a Monday; weekly bars open on Monday 00:00 UTC. */
const WEEK_ANCHOR = 4 * 86_400;

export function isChartInterval(value: unknown): value is ChartInterval {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INTERVAL_SECONDS, value);
}

/** Opening time of the bar that contains `epochSeconds`. */
export function barOpenTime(epochSeconds: number, interval: ChartInterval): number {
  const seconds = INTERVAL_SECONDS[interval];
  const anchor = interval === "1w" ? WEEK_ANCHOR : 0;
  return Math.floor((epochSeconds - anchor) / seconds) * seconds + anchor;
}

/** One price observation: a fill (with lots) or a reference reading (zero lots). */
export interface PricePoint {
  time: number;
  price: number;
  lots: number;
}

/**
 * OHLCV bars from time-ordered observations. A bar opens at the previous bar's close only when observations exist in
 * it; intervals with no observation produce no bar, so the chart never draws a print that did not happen.
 */
export function aggregateCandles(points: readonly PricePoint[], interval: ChartInterval): MarketCandle[] {
  const bars: MarketCandle[] = [];
  for (const point of points) {
    const time = barOpenTime(point.time, interval);
    const current = bars[bars.length - 1];
    if (!current || current.time !== time) {
      bars.push({ time, open: point.price, high: point.price, low: point.price, close: point.price, volume: point.lots });
      continue;
    }
    current.high = Math.max(current.high, point.price);
    current.low = Math.min(current.low, point.price);
    current.close = point.price;
    current.volume += point.lots;
  }
  return bars.slice(-MAX_BARS[interval]);
}

/**
 * Bars for a step series such as a Chainlink aggregator, whose answer holds until the next round: each observation
 * opens at its own time, and every interval between two observations carries the answer then in force (it did not
 * change). Bars run from the first observation to `until`.
 */
export function stepCandles(points: readonly PricePoint[], interval: ChartInterval, until: number): MarketCandle[] {
  if (points.length === 0) return [];
  const step = INTERVAL_SECONDS[interval];
  const firstBar = Math.max(barOpenTime(points[0].time, interval), barOpenTime(until, interval) - (MAX_BARS[interval] - 1) * step);
  const bars: MarketCandle[] = [];
  let index = 0;
  let inForce = points[0].price;
  // Readings before the first visible bar only set the value in force when it opens.
  while (index < points.length && points[index].time < firstBar) {
    inForce = points[index].price;
    index += 1;
  }
  for (let time = firstBar; time <= until; time += step) {
    const bar: MarketCandle = { time, open: inForce, high: inForce, low: inForce, close: inForce, volume: 0 };
    while (index < points.length && points[index].time < time + step) {
      const price = points[index].price;
      bar.high = Math.max(bar.high, price);
      bar.low = Math.min(bar.low, price);
      bar.close = price;
      inForce = price;
      index += 1;
    }
    bars.push(bar);
  }
  return bars;
}
