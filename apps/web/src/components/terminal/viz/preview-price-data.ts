import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";

export type ChartInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "12h"
  | "1d"
  | "1w";

export interface PreviewCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Traded lots in the candle. Preview volume comes from the same stream as the prices. */
  volume: number;
}

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

const HISTORY_POINTS: Record<ChartInterval, number> = {
  "1m": 2_880,
  "3m": 2_400,
  "5m": 2_016,
  "15m": 2_016,
  "30m": 1_440,
  "1h": 2_200,
  "2h": 2_200,
  "4h": 1_080,
  "6h": 1_080,
  "12h": 900,
  "1d": 600,
  "1w": 104,
};

const HISTORY_MINUTES = 60 * 24 * 60;
/** Hourly history before the minute window, so daily and weekly charts have two years of bars. */
const PREHISTORY_HOURS = 24 * (730 - 60);
/** 1970-01-05 was a Monday; weekly bars open on Monday 00:00 UTC. */
const WEEK_ANCHOR = 4 * 86_400;

/** Opening time of the bar that contains `epochSeconds`. */
export function barOpenTime(epochSeconds: number, interval: ChartInterval): number {
  const seconds = INTERVAL_SECONDS[interval];
  const anchor = interval === "1w" ? WEEK_ANCHOR : 0;
  return Math.floor((epochSeconds - anchor) / seconds) * seconds + anchor;
}

export interface PreviewSeries {
  /** Hourly bars before the minute window. */
  hours: PreviewCandle[];
  /** Minute bars ending at the scenario clock. */
  minutes: PreviewCandle[];
}

function seedFrom(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** Relative trading activity by UTC hour: Asia open, the London and New York overlap, and a quiet late session. */
function sessionActivity(epochSeconds: number): number {
  const hour = (epochSeconds / 3_600) % 24;
  const london = Math.exp(-(((hour - 9.5) / 3) ** 2));
  const newYork = Math.exp(-(((hour - 15) / 2.6) ** 2)) * 1.35;
  const asia = Math.exp(-(((hour - 2) / 2.5) ** 2)) * 0.6;
  return 0.35 + london + newYork + asia;
}

const seriesCache = new Map<string, PreviewSeries>();

/** `PackageMarket.priceHistory` spans the last 48 hours in evenly spaced samples. */
const HISTORY_SPAN_MINUTES = 48 * 60;

function historyAnchors(market: PackageMarket, count: number): { index: number; value: number }[] {
  const last = count - 1;
  const anchors = [{ index: 0, value: market.priorNetPrice }];
  const samples = market.priceHistory ?? [];
  const step = samples.length > 0 ? Math.round(HISTORY_SPAN_MINUTES / samples.length) : 0;
  samples.forEach((value, sample) => {
    const index = last - (samples.length - 1 - sample) * step;
    if (index > anchors[anchors.length - 1].index) anchors.push({ index, value });
  });
  if (anchors[anchors.length - 1].index === last) anchors[anchors.length - 1].value = market.netPrice;
  else anchors.push({ index: last, value: market.netPrice });
  return anchors;
}

/**
 * Minute history for a index market. Returns follow a volatility-clustering process with rare jumps and
 * session-dependent activity, so candles and volume read like a traded market.
 */
function buildMinuteHistory(market: PackageMarket): PreviewCandle[] {
  const count = HISTORY_MINUTES + 1;
  const end = Math.floor(Date.parse(SCENARIO_CLOCK_ISO) / 60_000) * 60;
  const random = seeded(seedFrom(market.id));
  const normal = () => {
    const u = Math.max(1e-12, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const moveScale = Math.max(
    market.tickSize * 1.1,
    Math.abs(market.netPrice - market.priorNetPrice) / 900,
    Math.abs(market.netPrice) * 0.00002,
  );
  const baseLots = Math.max(1, market.openInterestLots / 2_400);

  const raw = new Float64Array(count);
  const activity = new Float64Array(count);
  const range = new Float64Array(count);
  let walk = 0;
  let variance = 1;
  for (let index = 0; index < count; index += 1) {
    const time = end - (count - 1 - index) * 60;
    const session = sessionActivity(time);
    const shock = normal();
    const jump = random() < 0.0009 ? normal() * 7 : 0;
    const sigma = Math.sqrt(variance) * (0.55 + session * 0.3);
    const change = (shock * sigma + jump) * moveScale * 0.5;
    variance = 0.03 + 0.1 * shock * shock * variance + 0.87 * variance;
    walk += change;
    raw[index] = walk;
    activity[index] = session * (0.45 + Math.abs(change) / moveScale) * (0.55 + random() * 0.9);
    range[index] = Math.abs(normal()) * sigma * moveScale * 0.35;
  }

  // The path is a chain of bridges through anchors: the prior close at the start of the window, then every sample
  // of the market's 48-hour history (the series the markets board draws), ending on the current package price. The
  // chart therefore passes through the same points as every sparkline of this market.
  const anchors = historyAnchors(market, count);
  const candles: PreviewCandle[] = [];
  let previousClose = market.priorNetPrice;
  let segment = 0;

  for (let index = 0; index < count; index += 1) {
    while (segment < anchors.length - 2 && index > anchors[segment + 1].index) segment += 1;
    const from = anchors[segment];
    const to = anchors[segment + 1];
    const span = to.index - from.index;
    const elapsed = span > 0 ? (index - from.index) / span : 1;
    const trend = from.value + (to.value - from.value) * elapsed;
    const drift = raw[from.index] + (raw[to.index] - raw[from.index]) * elapsed;
    const close = round(trend + raw[index] - drift, market.priceDecimals);
    const open = index === 0 ? close : previousClose;
    candles.push({
      time: end - (count - 1 - index) * 60,
      open,
      high: round(Math.max(open, close) + range[index], market.priceDecimals),
      low: round(Math.min(open, close) - range[index] * (0.6 + random() * 0.8), market.priceDecimals),
      close,
      volume: Math.max(1, Math.round(baseLots * activity[index])),
    });
    previousClose = close;
  }

  const final = candles[candles.length - 1];
  final.close = market.netPrice;
  final.high = Math.max(final.high, final.open, final.close);
  final.low = Math.min(final.low, final.open, final.close);
  return candles;
}

/**
 * Hourly bars that end where the minute history begins. The path is generated backwards from the first minute open
 * with the same volatility-clustering process, so the seam between the two resolutions is continuous.
 */
function buildHourlyPrehistory(market: PackageMarket, firstMinute: PreviewCandle): PreviewCandle[] {
  const random = seeded(seedFrom(`${market.id}:hours`));
  const normal = () => {
    const u = Math.max(1e-12, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  // Matches the minute process scaled to an hour (sqrt(60) minute moves per bar).
  const hourScale =
    Math.max(
      market.tickSize * 1.1,
      Math.abs(market.netPrice - market.priorNetPrice) / 900,
      Math.abs(market.netPrice) * 0.00002,
    ) * 3.9;
  const baseLots = Math.max(1, market.openInterestLots / 40);
  const candles: PreviewCandle[] = new Array(PREHISTORY_HOURS);
  const firstHour = Math.floor(firstMinute.time / 3_600) * 3_600;
  let close = firstMinute.open;
  let variance = 1;
  // Walk backwards: each bar's close is the next bar's open.
  for (let index = PREHISTORY_HOURS - 1; index >= 0; index -= 1) {
    const time = firstHour - (PREHISTORY_HOURS - index) * 3_600;
    const session = sessionActivity(time);
    const shock = normal();
    const jump = random() < 0.004 ? normal() * 5 : 0;
    const sigma = Math.sqrt(variance) * (0.6 + session * 0.25);
    const change = (shock * sigma + jump) * hourScale;
    variance = 0.04 + 0.1 * shock * shock * variance + 0.86 * variance;
    const open = round(close - change, market.priceDecimals);
    const wick = Math.abs(normal()) * sigma * hourScale * 0.45;
    candles[index] = {
      time,
      open,
      high: round(Math.max(open, close) + wick, market.priceDecimals),
      low: round(Math.min(open, close) - wick * (0.6 + random() * 0.8), market.priceDecimals),
      close,
      volume: Math.max(1, Math.round(baseLots * session * (0.45 + Math.abs(change) / hourScale) * (0.55 + random() * 0.9))),
    };
    close = open;
  }
  return candles;
}

/**
 * Deterministic preview history for a market: two years of hourly bars followed by sixty days of minute bars. The
 * minute path is pinned as a bridge from the prior close to the current package price, so the last print always
 * equals the live mark.
 */
export function buildPreviewSeries(market: PackageMarket): PreviewSeries {
  const key = `${market.id}:${market.netPrice}:${market.priorNetPrice}:${market.priceDecimals}:${market.tickSize}`;
  const cached = seriesCache.get(key);
  if (cached) return cached;
  const minutes = buildMinuteHistory(market);
  const series = { hours: buildHourlyPrehistory(market, minutes[0]), minutes };
  if (seriesCache.size > 32) seriesCache.clear();
  seriesCache.set(key, series);
  return series;
}

function aggregate(candles: PreviewCandle[], interval: ChartInterval, result: PreviewCandle[] = []): PreviewCandle[] {
  for (const candle of candles) {
    const time = barOpenTime(candle.time, interval);
    const current = result[result.length - 1];

    if (!current || current.time !== time) {
      result.push({ ...candle, time });
      continue;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  }

  return result;
}

export function buildPreviewHistory(series: PreviewSeries, interval: ChartInterval): PreviewCandle[] {
  const aggregated =
    INTERVAL_SECONDS[interval] >= 3_600
      ? aggregate(series.minutes, interval, aggregate(series.hours, interval))
      : aggregate(series.minutes, interval);
  return aggregated.slice(-HISTORY_POINTS[interval]);
}

export function candleAtPrice(
  previous: PreviewCandle,
  epochSeconds: number,
  price: number,
  interval: ChartInterval,
  tradedLots = 0,
): PreviewCandle {
  const time = barOpenTime(epochSeconds, interval);

  if (time === previous.time) {
    return {
      ...previous,
      high: Math.max(previous.high, price),
      low: Math.min(previous.low, price),
      close: price,
      volume: previous.volume + tradedLots,
    };
  }

  return {
    time,
    open: previous.close,
    high: Math.max(previous.close, price),
    low: Math.min(previous.close, price),
    close: price,
    volume: tradedLots,
  };
}
