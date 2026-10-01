import type { StrategyKind } from "@/lib/terminal/types";

/*
 * Strategy views of a dated range forward, computed from its mark F against the live Chainlink reference S
 * (docs/plans/network-runtime-real-data.md, section 2). Nothing here is stored: every value is a function of the two
 * readings and the time to expiry, and is NaN when either reading is missing.
 */

export interface StrategyAnalytic {
  /** Short column label, e.g. "Implied carry". */
  label: string;
  /** One-line definition for tooltips. */
  describe: string;
  value: number;
  /** Display unit suffix: "bp" (annualized), "USD", or "pts". */
  unit: "bp" | "USD" | "pts";
  decimals: number;
}

const SECONDS_PER_YEAR_DAYS = 365;

/** Precious metals quote as `XAU/USD` like FX pairs but are not forward-point markets. */
const METALS = new Set(["XAU", "XAG", "XPT", "XPD"]);

export function isFxPair(underlying: string): boolean {
  const [base, quote] = underlying.split("/");
  return Boolean(base && quote) && !METALS.has(base);
}

/** Chainlink pair label of an underlying: "BTC" reads "BTC / USD", "EUR/USD" reads "EUR / USD". */
export function referencePairLabel(underlying: string): string {
  const [base, quote] = underlying.includes("/") ? underlying.split("/") : [underlying, "USD"];
  return `${base} / ${quote}`;
}

/** Fractional days from `nowSeconds` to `expiryAt`; zero or less once expired. */
export function daysBetween(nowSeconds: number, expiryAt: number): number {
  return (expiryAt - nowSeconds) / 86_400;
}

/** Annualized carry implied by a forward over spot, in basis points: (F / S - 1) x 365 / days x 10^4. */
export function impliedCarryBps(forward: number, spot: number, days: number): number {
  if (!Number.isFinite(forward) || !Number.isFinite(spot) || spot <= 0 || !(days > 0)) return Number.NaN;
  return (forward / spot - 1) * (SECONDS_PER_YEAR_DAYS / days) * 10_000;
}

/** The strategy view a market is presented under, from its mark and the live reference. */
export function strategyAnalytic(
  market: { strategyKind: StrategyKind; underlying: string; priceDecimals: number; expiryAt: number },
  forward: number,
  spot: number,
  nowSeconds: number,
): StrategyAnalytic {
  const basis = Number.isFinite(forward) && Number.isFinite(spot) ? forward - spot : Number.NaN;
  switch (market.strategyKind) {
    case "DATED_YIELD_CARRY":
    case "FUNDING_CARRY":
      return {
        label: market.strategyKind === "FUNDING_CARRY" ? "Implied funding" : "Implied carry",
        describe: "Annualized carry the forward implies over the Chainlink reference: (F / S - 1) x 365 / days.",
        value: impliedCarryBps(forward, spot, daysBetween(nowSeconds, market.expiryAt)),
        unit: "bp",
        decimals: 0,
      };
    case "DATED_BASIS":
      return {
        label: "Basis",
        describe: "Forward level minus the Chainlink reference: F - S.",
        value: basis,
        unit: "USD",
        decimals: market.priceDecimals,
      };
    case "DELIVERABLE_FORWARD":
      if (isFxPair(market.underlying)) {
        return {
          label: "Forward points",
          describe: "Forward level minus the Chainlink spot reference, in pips: (F - S) x 10^4.",
          value: Number.isFinite(basis) ? basis * 10_000 : Number.NaN,
          unit: "pts",
          decimals: 1,
        };
      }
      return {
        label: "Forward basis",
        describe: "Forward level minus the Chainlink spot reference: F - S.",
        value: basis,
        unit: "USD",
        decimals: market.priceDecimals,
      };
  }
}

/** The analytic as text with its sign and unit, or an em dash when either reading is missing. */
export function formatAnalytic(analytic: StrategyAnalytic): string {
  if (!Number.isFinite(analytic.value)) return "—";
  const sign = analytic.value > 0 ? "+" : analytic.value < 0 ? "-" : "";
  const magnitude = Math.abs(analytic.value).toLocaleString("en-US", {
    minimumFractionDigits: analytic.decimals,
    maximumFractionDigits: analytic.decimals,
  });
  return `${sign}${magnitude} ${analytic.unit === "bp" ? "bp/yr" : analytic.unit}`;
}

/**
 * Value at expiry of one long lot entered at `entry`, for a fixing `fixing`: lot size x (clamp(fixing, floor, cap) -
 * entry), in USDC. A short lot is the negative.
 */
export function rangeForwardValue(
  terms: { floor: number; cap: number; lotSize: number },
  entry: number,
  fixing: number,
): number {
  const settled = Math.min(terms.cap, Math.max(terms.floor, fixing));
  return terms.lotSize * (settled - entry);
}
