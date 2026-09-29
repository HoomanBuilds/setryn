import type { PreviewCandle } from "./preview-price-data";

export type IndicatorId = "ma7" | "ma25" | "ma99" | "ema21" | "vwap";

export interface IndicatorSpec {
  id: IndicatorId;
  label: string;
  color: string;
  describe: string;
}

export const INDICATORS: IndicatorSpec[] = [
  { id: "ma7", label: "MA 7", color: "#f0b90b", describe: "Simple moving average of 7 closes" },
  { id: "ma25", label: "MA 25", color: "#d16ee8", describe: "Simple moving average of 25 closes" },
  { id: "ma99", label: "MA 99", color: "#6ea8fe", describe: "Simple moving average of 99 closes" },
  { id: "ema21", label: "EMA 21", color: "#4fd1c5", describe: "Exponential moving average of 21 closes" },
  { id: "vwap", label: "VWAP", color: "#ff9d4d", describe: "Volume-weighted average price, reset each UTC day" },
];

export interface IndicatorPoint {
  time: number;
  value: number;
}

function sma(candles: PreviewCandle[], length: number): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  let sum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;
    if (index >= length) sum -= candles[index - length].close;
    if (index >= length - 1) points.push({ time: candles[index].time, value: sum / length });
  }
  return points;
}

function ema(candles: PreviewCandle[], length: number): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  const alpha = 2 / (length + 1);
  let value: number | null = null;
  for (const candle of candles) {
    value = value === null ? candle.close : candle.close * alpha + value * (1 - alpha);
    points.push({ time: candle.time, value });
  }
  return points.slice(Math.min(points.length, length - 1));
}

function vwap(candles: PreviewCandle[]): IndicatorPoint[] {
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

export function computeIndicator(id: IndicatorId, candles: PreviewCandle[]): IndicatorPoint[] {
  switch (id) {
    case "ma7":
      return sma(candles, 7);
    case "ma25":
      return sma(candles, 25);
    case "ma99":
      return sma(candles, 99);
    case "ema21":
      return ema(candles, 21);
    case "vwap":
      return vwap(candles);
  }
}
