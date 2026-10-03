import type { MarketCandle } from "@/lib/market-data/types";

export type IndicatorId = "volume" | "ma7" | "ma25" | "ma99" | "ema21" | "vwap" | "bb" | "rsi" | "macd" | "atr";

/** Overlays draw on the price scale, `volume` draws in the bottom of the price pane, and panes stack below it. */
export type IndicatorPlacement = "overlay" | "volume" | "pane";

export interface IndicatorLine {
  key: string;
  label: string;
  color: string;
  kind: "line" | "histogram";
  /** Dashed guide lines drawn on oscillator panes (for example RSI 30 and 70). */
  dashed?: boolean;
}

export interface IndicatorSpec {
  id: IndicatorId;
  label: string;
  describe: string;
  placement: IndicatorPlacement;
  lines: IndicatorLine[];
  /** Fixed horizontal guides for oscillator panes. */
  guides?: number[];
}

const HIST_UP = "rgba(63, 217, 164, 0.55)";
const HIST_DOWN = "rgba(255, 93, 122, 0.55)";

export const INDICATORS: IndicatorSpec[] = [
  {
    id: "volume",
    label: "Volume",
    describe: "Traded lots per bar",
    placement: "volume",
    lines: [{ key: "value", label: "Vol", color: "#78746e", kind: "histogram" }],
  },
  {
    id: "ma7",
    label: "MA 7",
    describe: "Simple moving average of 7 closes",
    placement: "overlay",
    lines: [{ key: "value", label: "MA 7", color: "#e8c268", kind: "line" }],
  },
  {
    id: "ma25",
    label: "MA 25",
    describe: "Simple moving average of 25 closes",
    placement: "overlay",
    lines: [{ key: "value", label: "MA 25", color: "#b79cff", kind: "line" }],
  },
  {
    id: "ma99",
    label: "MA 99",
    describe: "Simple moving average of 99 closes",
    placement: "overlay",
    lines: [{ key: "value", label: "MA 99", color: "#6ea8fe", kind: "line" }],
  },
  {
    id: "ema21",
    label: "EMA 21",
    describe: "Exponential moving average of 21 closes",
    placement: "overlay",
    lines: [{ key: "value", label: "EMA 21", color: "#5fd4e0", kind: "line" }],
  },
  {
    id: "vwap",
    label: "VWAP",
    describe: "Volume-weighted average price, reset each UTC day",
    placement: "overlay",
    lines: [{ key: "value", label: "VWAP", color: "#f1e1d4", kind: "line" }],
  },
  {
    id: "bb",
    label: "BB 20 2",
    describe: "Bollinger bands: 20-bar mean with two standard deviations",
    placement: "overlay",
    lines: [
      { key: "upper", label: "Upper", color: "rgba(110, 168, 254, 0.75)", kind: "line" },
      { key: "basis", label: "Basis", color: "rgba(232, 194, 104, 0.8)", kind: "line" },
      { key: "lower", label: "Lower", color: "rgba(110, 168, 254, 0.75)", kind: "line" },
    ],
  },
  {
    id: "rsi",
    label: "RSI 14",
    describe: "Relative strength index with Wilder smoothing",
    placement: "pane",
    lines: [{ key: "value", label: "RSI", color: "#b79cff", kind: "line" }],
    guides: [70, 30],
  },
  {
    id: "macd",
    label: "MACD 12 26 9",
    describe: "Moving average convergence divergence with signal and histogram",
    placement: "pane",
    lines: [
      { key: "hist", label: "Hist", color: HIST_UP, kind: "histogram" },
      { key: "macd", label: "MACD", color: "#6ea8fe", kind: "line" },
      { key: "signal", label: "Signal", color: "#e8a068", kind: "line" },
    ],
    guides: [0],
  },
  {
    id: "atr",
    label: "ATR 14",
    describe: "Average true range with Wilder smoothing",
    placement: "pane",
    lines: [{ key: "value", label: "ATR", color: "#5fd4e0", kind: "line" }],
  },
];

export const INDICATOR_BY_ID = new Map(INDICATORS.map((spec) => [spec.id, spec]));

export interface IndicatorPoint {
  time: number;
  value: number;
  /** Histogram bar colour, when the line is a histogram. */
  color?: string;
}

export type IndicatorOutput = Record<string, IndicatorPoint[]>;

function sma(values: number[], times: number[], length: number): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= length) sum -= values[index - length];
    if (index >= length - 1) points.push({ time: times[index], value: sum / length });
  }
  return points;
}

function emaValues(values: number[], length: number): number[] {
  const alpha = 2 / (length + 1);
  const result: number[] = [];
  let value: number | null = null;
  for (const input of values) {
    value = value === null ? input : input * alpha + value * (1 - alpha);
    result.push(value);
  }
  return result;
}

function ema(values: number[], times: number[], length: number): IndicatorPoint[] {
  return emaValues(values, length)
    .map((value, index) => ({ time: times[index], value }))
    .slice(Math.min(values.length, length - 1));
}

function vwap(candles: MarketCandle[]): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  let day = -1;
  let notional = 0;
  let volume = 0;
  for (const candle of candles) {
    const candleDay = Math.floor(candle.time / 86_400);
    if (candleDay !== day) {
      day = candleDay;
      notional = 0;
      volume = 0;
    }
    const typical = (candle.high + candle.low + candle.close) / 3;
    notional += typical * candle.volume;
    volume += candle.volume;
    points.push({ time: candle.time, value: volume > 0 ? notional / volume : typical });
  }
  return points;
}

function bollinger(closes: number[], times: number[], length: number, width: number): IndicatorOutput {
  const upper: IndicatorPoint[] = [];
  const basis: IndicatorPoint[] = [];
  const lower: IndicatorPoint[] = [];
  let sum = 0;
  let squares = 0;
  for (let index = 0; index < closes.length; index += 1) {
    sum += closes[index];
    squares += closes[index] * closes[index];
    if (index >= length) {
      sum -= closes[index - length];
      squares -= closes[index - length] * closes[index - length];
    }
    if (index < length - 1) continue;
    const mean = sum / length;
    const deviation = Math.sqrt(Math.max(0, squares / length - mean * mean));
    upper.push({ time: times[index], value: mean + width * deviation });
    basis.push({ time: times[index], value: mean });
    lower.push({ time: times[index], value: mean - width * deviation });
  }
  return { upper, basis, lower };
}

function rsi(closes: number[], times: number[], length: number): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  let gain = 0;
  let loss = 0;
  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const up = Math.max(0, change);
    const down = Math.max(0, -change);
    if (index <= length) {
      gain += up / length;
      loss += down / length;
      if (index < length) continue;
    } else {
      gain = (gain * (length - 1) + up) / length;
      loss = (loss * (length - 1) + down) / length;
    }
    const value = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
    points.push({ time: times[index], value });
  }
  return points;
}

function macd(closes: number[], times: number[]): IndicatorOutput {
  const fast = emaValues(closes, 12);
  const slow = emaValues(closes, 26);
  const line = fast.map((value, index) => value - slow[index]);
  const signal = emaValues(line, 9);
  const start = Math.min(closes.length, 25);
  const macdPoints: IndicatorPoint[] = [];
  const signalPoints: IndicatorPoint[] = [];
  const hist: IndicatorPoint[] = [];
  let previous = 0;
  for (let index = start; index < closes.length; index += 1) {
    const value = line[index] - signal[index];
    macdPoints.push({ time: times[index], value: line[index] });
    signalPoints.push({ time: times[index], value: signal[index] });
    const rising = value >= previous;
    hist.push({
      time: times[index],
      value,
      color: value >= 0 ? (rising ? HIST_UP : "rgba(63, 217, 164, 0.3)") : rising ? "rgba(255, 93, 122, 0.3)" : HIST_DOWN,
    });
    previous = value;
  }
  return { macd: macdPoints, signal: signalPoints, hist };
}

function atr(candles: MarketCandle[], length: number): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  let average = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    const range = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
    if (index <= length) {
      average += range / length;
      if (index < length) continue;
    } else {
      average = (average * (length - 1) + range) / length;
    }
    points.push({ time: candle.time, value: average });
  }
  return points;
}

export function computeIndicator(id: IndicatorId, all: MarketCandle[]): IndicatorOutput {
  // Gap bars have no price: indicators run over the priced bars only.
  const candles = all.filter((candle) => !candle.gap);
  const closes = candles.map((candle) => candle.close);
  const times = candles.map((candle) => candle.time);
  switch (id) {
    case "volume":
      return {
        value: candles.map((candle) => ({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? "rgba(63, 217, 164, 0.32)" : "rgba(255, 93, 122, 0.32)",
        })),
      };
    case "ma7":
      return { value: sma(closes, times, 7) };
    case "ma25":
      return { value: sma(closes, times, 25) };
    case "ma99":
      return { value: sma(closes, times, 99) };
    case "ema21":
      return { value: ema(closes, times, 21) };
    case "vwap":
      return { value: vwap(candles) };
    case "bb":
      return bollinger(closes, times, 20, 2);
    case "rsi":
      return { value: rsi(closes, times, 14) };
    case "macd":
      return macd(closes, times);
    case "atr":
      return { value: atr(candles, 14) };
  }
}
