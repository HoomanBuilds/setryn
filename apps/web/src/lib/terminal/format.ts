import type { PackageMarket, PriceUnit } from "./types";

/**
 * The preview fixtures are frozen against one scenario clock so every rendered
 * countdown is reproducible and identical on the server and in the browser.
 */
export const SCENARIO_CLOCK_ISO = "2026-09-22T09:00:00Z";
const SCENARIO_CLOCK_MS = Date.parse(SCENARIO_CLOCK_ISO);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function priceUnitSuffix(unit: PriceUnit): string {
  if (unit === "BP") return "bp";
  if (unit === "PTS") return "pts";
  return "USD";
}

export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPrice(value: number, market: PackageMarket): string {
  return formatNumber(value, market.priceDecimals);
}

export function formatPriceWithUnit(value: number, market: PackageMarket): string {
  return `${formatPrice(value, market)} ${priceUnitSuffix(market.priceUnit)}`;
}

export function formatSigned(value: number, decimals: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value), decimals)}`;
}

export function formatUsd(value: number, decimals = 2): string {
  return `${formatNumber(value, decimals)} USDC`;
}

export function formatSignedUsd(value: number, decimals = 2): string {
  return `${formatSigned(value, decimals)} USDC`;
}

export function formatCompactUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)}M USDC`;
  if (Math.abs(value) >= 1_000) return `${formatNumber(value / 1_000, 1)}k USDC`;
  return formatUsd(value, 0);
}

export function formatLots(value: number): string {
  return formatNumber(value, 0);
}

export function formatBps(value: number): string {
  return `${formatNumber(value, 2)} bp`;
}

export function formatPercent(value: number, decimals = 2): string {
  return `${formatSigned(value, decimals)}%`;
}

export function formatExpiry(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function daysToExpiry(iso: string): number {
  const target = Date.parse(`${iso}T16:00:00Z`);
  return Math.max(0, Math.round((target - SCENARIO_CLOCK_MS) / 86_400_000));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function changePercent(current: number, prior: number): number {
  if (prior === 0) return 0;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function parseDecimal(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/** Preview candles are spaced on a fixed grid so the time axis is reproducible. */
export const PREVIEW_STEP_SECONDS = 1_800;

/** Epoch seconds for `points` samples ending exactly on the scenario clock. */
export function previewTimeline(points: number): number[] {
  const end = Math.floor(SCENARIO_CLOCK_MS / 1000);
  return Array.from({ length: points }, (_, i) => end - (points - 1 - i) * PREVIEW_STEP_SECONDS);
}

export function formatUtcClock(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatUtcStamp(epochSeconds: number, withTime = true): string {
  const date = new Date(epochSeconds * 1000);
  const day = `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]}`;
  if (!withTime) return day;
  return `${day} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}
