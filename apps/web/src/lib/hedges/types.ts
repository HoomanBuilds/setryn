import type { PackageMarket, Qualification, SettlementClass } from "@/lib/terminal/types";
import type { RangeTerms } from "@/lib/strategies/range";

export type HedgeDirection = "RECEIVABLE" | "PAYABLE";
export type PackageDirection = "LONG" | "SHORT";

export type RiskObjective = "LOCK_RATE" | "BALANCED" | "LOW_COLLATERAL";

export interface ReferenceAsset {
  id: string;
  label: string;
  /** Substrings matched against PackageMarket.underlying (e.g. "EUR" matches "EUR/USD"). */
  matchTokens: string[];
}

export interface SettlementAsset {
  id: string;
  label: string;
}

export interface ExposureInput {
  direction: HedgeDirection;
  referenceAssetId: string;
  settlementAssetId: string;
  /** Notional in settlement-asset terms (USDC equivalent), converted to underlying units at the live reference. */
  amount: number;
  /** Cash-flow / exposure date, YYYY-MM-DD. */
  exposureDateIso: string;
  riskObjective: RiskObjective;
}

export interface ExposureValidation {
  valid: boolean;
  reasons: string[];
}

export interface HedgeCandidate {
  market: PackageMarket;
  terms: RangeTerms | null;
  rank: number;
  assetMatch: boolean;
  packageDirection: PackageDirection;
  lots: number;
  /** Underlying units the exposure represents at the live reference. */
  exposureUnits: number | null;
  /** Live Chainlink reference of the underlying. */
  reference: number | null;
  notionalCovered: number;
  coverageRatio: number;
  tenorGapDays: number;
  horizonDays: number;
  /** Best resting price on the side the hedge takes; NaN when nothing rests there. */
  executablePrice: number;
  executablePriceProvenance: "EXECUTABLE" | "UNAVAILABLE";
  /** The level the outcome is computed at: the touch, else the mark. */
  forwardLevel: number;
  forwardSource: "TOUCH" | "MARK" | "NONE";
  collateralEstimate: number;
  collateralProvenance: "COMPUTED";
  /** Lots above the market's per-order limit, which need more than one order. */
  ordersNeeded: number;
  qualification: Qualification;
  settlementClass: SettlementClass;
  score: number;
}

export interface ScenarioRow {
  movePct: number;
  unhedged: number;
  packageModeled: number;
  netModeled: number;
}

export interface HandoffLinks {
  studioHref: string;
  tradeHref: string | null;
  tradeBlockedReason: string | null;
}

/** Net exposure the account's positions carry on one underlying, at the live reference. */
export interface PortfolioExposure {
  underlying: string;
  referenceAssetId: string | null;
  reference: number | null;
  /** Signed underlying units: lots x lot size for each position whose range contains the reference. */
  delta: number;
  /** delta x reference, USDC. */
  deltaUsd: number | null;
  positions: number;
  /** Positions whose range no longer contains the reference: their delta is zero until it re-enters. */
  outsideRange: number;
  /** Earliest expiry among the positions, unix seconds. */
  nearestExpiryAt: number | null;
  /** A listed market and size that would offset the delta, when one exists. */
  offset: { market: PackageMarket; direction: PackageDirection; lots: number } | null;
}
