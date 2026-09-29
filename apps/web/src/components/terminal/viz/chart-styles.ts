import type { ChartInterval, PreviewCandle } from "./preview-price-data";

export type ChartStyle = "candles" | "hollow" | "bars" | "heikin" | "line" | "step" | "area" | "baseline";

export const CHART_STYLES: { id: ChartStyle; label: string; ohlc: boolean }[] = [
  { id: "candles", label: "Candles", ohlc: true },
  { id: "hollow", label: "Hollow candles", ohlc: true },
  { id: "bars", label: "Bars", ohlc: true },
  { id: "heikin", label: "Heikin Ashi", ohlc: true },
  { id: "line", label: "Line", ohlc: false },
  { id: "step", label: "Step line", ohlc: false },
  { id: "area", label: "Area", ohlc: false },
  { id: "baseline", label: "Baseline", ohlc: false },
];

export function isOhlcStyle(style: ChartStyle): boolean {
  return CHART_STYLES.find((option) => option.id === style)?.ohlc ?? true;
}

/** Heikin Ashi bar from the raw bar and the previous Heikin Ashi bar. */
export function heikinAshiBar(candle: PreviewCandle, previous: PreviewCandle | undefined): PreviewCandle {
  const close = (candle.open + candle.high + candle.low + candle.close) / 4;
  const open = previous ? (previous.open + previous.close) / 2 : (candle.open + candle.close) / 2;
  return {
    time: candle.time,
    open,
    high: Math.max(candle.high, open, close),
    low: Math.min(candle.low, open, close),
    close,
    volume: candle.volume,
  };
}

export function heikinAshi(candles: PreviewCandle[]): PreviewCandle[] {
  const result: PreviewCandle[] = [];
  for (const candle of candles) result.push(heikinAshiBar(candle, result[result.length - 1]));
  return result;
}

export const INTERVAL_GROUPS: { label: string; intervals: ChartInterval[] }[] = [
  { label: "Minutes", intervals: ["1m", "3m", "5m", "15m", "30m"] },
  { label: "Hours", intervals: ["1h", "2h", "4h", "6h", "12h"] },
  { label: "Days", intervals: ["1d", "1w"] },
];

export const ALL_INTERVALS: ChartInterval[] = INTERVAL_GROUPS.flatMap((group) => group.intervals);

export const FAVORITE_INTERVALS: ChartInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** Exchange-style interval label: minutes lower case, hours and longer upper case. */
export function intervalLabel(interval: ChartInterval): string {
  return interval.endsWith("m") ? interval : interval.toUpperCase();
}

export function intervalName(interval: ChartInterval): string {
  const count = Number.parseInt(interval, 10);
  const unit = interval.replace(/^\d+/, "");
  const noun = unit === "m" ? "minute" : unit === "h" ? "hour" : unit === "d" ? "day" : "week";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Visible ranges and the interval each one loads, as on professional charting desks. */
export const RANGES: { label: string; seconds: number | null; interval: ChartInterval }[] = [
  { label: "1D", seconds: 86_400, interval: "1m" },
  { label: "5D", seconds: 5 * 86_400, interval: "5m" },
  { label: "1M", seconds: 30 * 86_400, interval: "30m" },
  { label: "3M", seconds: 91 * 86_400, interval: "1h" },
  { label: "6M", seconds: 182 * 86_400, interval: "2h" },
  { label: "1Y", seconds: 365 * 86_400, interval: "1d" },
  { label: "All", seconds: null, interval: "1w" },
];

/** Time left in the open bar, formatted like a price-axis countdown. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  return `${pad(minutes)}:${pad(secs)}`;
}
