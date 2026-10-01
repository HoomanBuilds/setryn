import { platformNow } from "./clock";
import type { PackageMarket, PriceUnit } from "./types";

/** What every formatter prints for a value that does not exist (no quote, no reading): never a stand-in number. */
export const MISSING = "—";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function priceUnitSuffix(unit: PriceUnit): string {
  if (unit === "BP") return "bp";
  if (unit === "PTS") return "pts";
  return "USD";
}

export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return MISSING;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPrice(value: number, market: PackageMarket): string {
  return formatNumber(value, market.priceDecimals);
}

export function formatPriceWithUnit(value: number, market: PackageMarket): string {
  if (!Number.isFinite(value)) return MISSING;
  return `${formatPrice(value, market)} ${priceUnitSuffix(market.priceUnit)}`;
}

export function formatSigned(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return MISSING;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value), decimals)}`;
}

export function formatUsd(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return MISSING;
  return `${formatNumber(value, decimals)} USDC`;
}

export function formatSignedUsd(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return MISSING;
  return `${formatSigned(value, decimals)} USDC`;
}

/** Amount in a named collateral asset, for balances that are not always USDC (the local devnet posts sUSD). */
export function formatAsset(value: number, asset: string, decimals = 2): string {
  if (!Number.isFinite(value)) return MISSING;
  return `${formatNumber(value, decimals)} ${asset}`;
}

export function formatCompactAsset(value: number, asset: string): string {
  if (!Number.isFinite(value)) return MISSING;
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)}M ${asset}`;
  if (Math.abs(value) >= 1_000) return `${formatNumber(value / 1_000, 1)}k ${asset}`;
  return formatAsset(value, asset, 0);
}

export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return MISSING;
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)}M USDC`;
  if (Math.abs(value) >= 1_000) return `${formatNumber(value / 1_000, 1)}k USDC`;
  return formatUsd(value, 0);
}

export function formatSignedCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return MISSING;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatCompactUsd(Math.abs(value))}`;
}

/** Unsigned share of a whole, for concentration and utilisation reads. */
export function formatShare(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) return MISSING;
  return `${formatNumber(fraction * 100, decimals)}%`;
}

export function formatMultiple(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return MISSING;
  return `${formatNumber(value, decimals)}x`;
}

export function formatLots(value: number): string {
  return formatNumber(value, 0);
}

/** Lot count with its unit, singular for exactly one lot. */
export function formatLotCount(value: number): string {
  return `${formatLots(value)} ${value === 1 ? "lot" : "lots"}`;
}

export function formatBps(value: number): string {
  if (!Number.isFinite(value)) return MISSING;
  return `${formatNumber(value, 2)} bp`;
}

export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return MISSING;
  return `${formatSigned(value, decimals)}%`;
}

export function formatExpiry(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The expiry fixing hour every listed series uses (08:00 UTC). */
export const EXPIRY_HOUR_UTC = 8;

/** Unix milliseconds of the expiry fixing on an `expiryIso` date. */
export function expiryMs(iso: string): number {
  return Date.parse(`${iso}T${String(EXPIRY_HOUR_UTC).padStart(2, "0")}:00:00Z`);
}

/** Whole days from now (the chain-corrected platform clock unless `nowMs` is given) to the expiry fixing. */
export function daysToExpiry(iso: string, nowMs = platformNow()): number {
  return Math.max(0, Math.round((expiryMs(iso) - nowMs) / 86_400_000));
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
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return Number.NaN;
  if (prior === 0) return 0;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function parseDecimal(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/** The platform clock in unix seconds: the replacement for the retired scenario clock. */
export function platformNowSeconds(): number {
  return Math.floor(platformNow() / 1000);
}

/** Age of a reading in compact form ("12s", "4m", "3h", "2d"); an em dash for an unknown time. */
export function formatAge(fromSeconds: number, nowSeconds = platformNowSeconds()): string {
  if (!(fromSeconds > 0)) return MISSING;
  const age = Math.max(0, nowSeconds - fromSeconds);
  if (age < 60) return `${age}s`;
  if (age < 3_600) return `${Math.floor(age / 60)}m`;
  if (age < 86_400) return `${Math.floor(age / 3_600)}h`;
  return `${Math.floor(age / 86_400)}d`;
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

/** Display name for a record's evidence class. Chain-derived evidence reads as "onchain" on every network. */
export function evidenceLabel(evidence: string): string {
  const key = evidence.toUpperCase();
  if (key === "DEVNET" || key === "TESTNET" || key === "MAINNET" || key === "ONCHAIN") return "onchain";
  return evidence.toLowerCase().replace(/_/g, " ");
}
