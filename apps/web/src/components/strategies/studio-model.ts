import { breakevens, valueAt } from "@/components/strategies/desk/PayoffPlot";
import { priceUnitSuffix, formatNumber } from "@/lib/terminal/format";
import type { InstrumentOption, PackageDirection } from "@/lib/strategies/types";
import type { PackageMarket } from "@/lib/terminal/types";

export interface PayoffSummary {
  points: { x: number; y: number }[];
  maxGain: number;
  maxLoss: number;
  carryAtZero: number;
  slopePerPoint: number;
  breakevens: number[];
  rewardRisk: number | null;
  moveMin: number;
  moveMax: number;
}

/**
 * The listed payoff profile (computed from the live mark and reference) scaled
 * to the draft: lots, the graph ratio scale and the package direction. Every
 * value is the contract's payoff at expiry for a given fixing.
 */
export function payoffSummary(
  market: PackageMarket,
  lots: number,
  scale: number,
  direction: PackageDirection,
): PayoffSummary {
  const factor = Math.max(1, lots) * scale * (direction === "LONG" ? 1 : -1);
  const points = market.payoff.map((point) => ({ x: point.move, y: point.value * factor }));
  const ys = points.map((point) => point.y);
  // Without a mark and a reference there is no payoff to draw; the panels say so instead of plotting a stand-in.
  const maxGain = ys.length > 0 ? Math.max(...ys) : 0;
  const maxLoss = ys.length > 0 ? Math.min(...ys) : 0;
  return {
    points,
    maxGain,
    maxLoss,
    carryAtZero: valueAt(points, 0),
    slopePerPoint: (valueAt(points, 1) - valueAt(points, -1)) / 2,
    breakevens: breakevens(points),
    rewardRisk: maxGain > 0 && maxLoss < 0 ? maxGain / Math.abs(maxLoss) : null,
    moveMin: points[0]?.x ?? -1,
    moveMax: points[points.length - 1]?.x ?? 1,
  };
}

export function formatMove(value: number, decimals = 1): string {
  const rounded = Number(value.toFixed(decimals));
  if (rounded === 0) return `0${decimals > 0 ? `.${"0".repeat(decimals)}` : ""}%`;
  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toFixed(decimals)}%`;
}

export function formatTick(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0%";
  const body = Number.isInteger(rounded) ? Math.abs(rounded).toFixed(0) : Math.abs(rounded).toFixed(1);
  return `${rounded > 0 ? "+" : "-"}${body}%`;
}

export function markLabel(option: Pick<InstrumentOption, "mark" | "markUnit">): string {
  const decimals = option.markUnit === "USD" ? (option.mark < 10 ? 4 : 2) : 1;
  return `${formatNumber(option.mark, decimals)} ${priceUnitSuffix(option.markUnit)}`;
}

export function familyLabel(family: string): string {
  return family.toLowerCase().replaceAll("_", " ");
}
