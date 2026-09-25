import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";

export type ChartInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

export interface PreviewCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
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

export function buildPreviewMinuteHistory(market: PackageMarket): PreviewCandle[] {
  const count = HISTORY_MINUTES + 1;
  const end = Math.floor(Date.parse(SCENARIO_CLOCK_ISO) / 60_000) * 60;
  const random = seeded(seedFrom(market.id));
  const raw = new Float64Array(count);
  const moveScale = Math.max(
    market.tickSize * 1.4,
    Math.abs(market.netPrice - market.priorNetPrice) / 520,
    Math.abs(market.netPrice) * 0.000025,
  );

  let walk = 0;
  for (let index = 0; index < count; index += 1) {
    const cycle = Math.sin(index / 187) * moveScale * 0.08;
    walk += (random() - 0.5) * moveScale + cycle;
    raw[index] = walk;
  }

  const terminalDeviation = raw[count - 1];
  const candles: PreviewCandle[] = [];
  let previousClose = market.priorNetPrice;

  for (let index = 0; index < count; index += 1) {
    const elapsed = index / (count - 1);
    const trend =
      market.priorNetPrice + (market.netPrice - market.priorNetPrice) * elapsed;
    const close = round(
      trend + raw[index] - terminalDeviation * elapsed,
      market.priceDecimals,
    );
    const open = index === 0 ? close : previousClose;
    const wick = moveScale * (0.18 + random() * 0.42);

    candles.push({
      time: end - (count - 1 - index) * 60,
      open,
      high: round(Math.max(open, close) + wick, market.priceDecimals),
      low: round(Math.min(open, close) - wick, market.priceDecimals),
      close,
    });
    previousClose = close;
  }

  const final = candles[candles.length - 1];
  final.close = market.netPrice;
  final.high = Math.max(final.high, final.open, final.close);
  final.low = Math.min(final.low, final.open, final.close);
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
): PreviewCandle {
  const time = Math.floor(epochSeconds / INTERVAL_SECONDS[interval]) * INTERVAL_SECONDS[interval];

  if (time === previous.time) {
    return {
      ...previous,
      high: Math.max(previous.high, price),
      low: Math.min(previous.low, price),
      close: price,
    };
  }

  return {
    time,
    open: previous.close,
    high: Math.max(previous.close, price),
    low: Math.min(previous.close, price),
    close: price,
  };
}
