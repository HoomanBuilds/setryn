import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";

export type ChartInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

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
  "5m": 300,
  "15m": 900,
  "30m": 1_800,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
};

const HISTORY_POINTS: Record<ChartInterval, number> = {
  "1m": 2_880,
  "5m": 2_016,
  "15m": 2_016,
  "30m": 1_440,
  "1h": 1_080,
  "4h": 360,
  "1d": 60,
};

const HISTORY_MINUTES = 60 * 24 * 60;

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

const minuteHistoryCache = new Map<string, PreviewCandle[]>();

/**
 * Deterministic minute history for a preview market. Returns follow a volatility-clustering process with rare
 * jumps and session-dependent activity, so candles and volume read like a traded market. The path is pinned as a
 * bridge from the prior close to the current package price, so the last print always equals the live mark.
 */
export function buildPreviewMinuteHistory(market: PackageMarket): PreviewCandle[] {
  const key = `${market.id}:${market.netPrice}:${market.priorNetPrice}:${market.priceDecimals}:${market.tickSize}`;
  const cached = minuteHistoryCache.get(key);
  if (cached) return cached;

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

  const terminalDeviation = raw[count - 1];
  const candles: PreviewCandle[] = [];
  let previousClose = market.priorNetPrice;

  for (let index = 0; index < count; index += 1) {
    const elapsed = index / (count - 1);
    const trend = market.priorNetPrice + (market.netPrice - market.priorNetPrice) * elapsed;
    const close = round(trend + raw[index] - terminalDeviation * elapsed, market.priceDecimals);
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
  if (minuteHistoryCache.size > 32) minuteHistoryCache.clear();
  minuteHistoryCache.set(key, candles);
  return candles;
}

function aggregate(candles: PreviewCandle[], seconds: number): PreviewCandle[] {
  const result: PreviewCandle[] = [];

  for (const candle of candles) {
    const time = Math.floor(candle.time / seconds) * seconds;
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

export function buildPreviewHistory(
  minuteHistory: PreviewCandle[],
  interval: ChartInterval,
): PreviewCandle[] {
  const aggregated = aggregate(minuteHistory, INTERVAL_SECONDS[interval]);
  return aggregated.slice(-HISTORY_POINTS[interval]);
}

export function candleAtPrice(
  previous: PreviewCandle,
  epochSeconds: number,
  price: number,
  interval: ChartInterval,
  tradedLots = 0,
): PreviewCandle {
  const time = Math.floor(epochSeconds / INTERVAL_SECONDS[interval]) * INTERVAL_SECONDS[interval];

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
