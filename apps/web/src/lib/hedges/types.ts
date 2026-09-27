import type {
  PackageMarket,
  Qualification,
  SettlementClass,
} from "@/lib/terminal/types";

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
  /** Notional in settlement-asset terms (USDC equivalent). Keeps sizing free of invented FX. */
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
  rank: number;
  assetMatch: boolean;
  packageDirection: PackageDirection;
  lots: number;
  notionalCovered: number;
  coverageRatio: number;
  tenorGapDays: number;
  horizonDays: number;
  executablePrice: number;
  executablePriceProvenance: "EXECUTABLE";
  collateralEstimate: number;
  collateralProvenance: "MODELED";
  residualEstimate: number;
  residualProvenance: "MODELED";
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
