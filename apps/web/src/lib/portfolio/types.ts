import type { CollateralAsset } from "@/lib/terminal/account";
import type {
  PackageMarket,
  PnlAttribution,
  PositionSide,
  PositionState,
  StrategyRecord,
} from "@/lib/terminal/types";

export type RiskDomainId = "CRYPTO_CARRY" | "CRYPTO_BASIS" | "MACRO_FORWARD";

export type GroupBy = "STRATEGY" | "UNDERLYING" | "EXPIRY" | "DOMAIN";

/** The authored components plus the price term derived from entry against mark. */
export interface PnlBreakdown extends PnlAttribution {
  price: number;
  total: number;
}

export interface Position {
  id: string;
  record: StrategyRecord;
  market: PackageMarket;
  label: string;
  side: PositionSide;
  state: PositionState;
  /** Authored magnitude. Direction lives in `side` and in `signedLots`. */
  lots: number;
  /** Negative for a short book, so every size reads with its own sign. */
  signedLots: number;
  entryPrice: number;
  markPrice: number;
  /** Short books carry the sign, so net and gross exposure differ. */
  signedNotional: number;
  grossNotional: number;
  collateral: number;
  initialMargin: number;
  maintenanceMargin: number;
  pnl: PnlBreakdown;
  /** Collateral plus profit and loss, which is what the buffer is measured on. */
  equity: number;
  bufferUsdc: number;
  bufferShare: number;
  /** Adverse package-price move absorbed before the maintenance floor breaks. */
  bufferPoints: number;
  /** Null when that move runs through zero, so no quoted level can trigger it. */
  liquidationPrice: number | null;
  domain: RiskDomainId;
  daysToExpiry: number;
  nextEvent: string;
  href: string;
  /** Terminal handoff for exiting an active account position. */
  exitHref?: string;
  source?: "ONCHAIN_RUNTIME" | "REFERENCE_OBSERVATION";
  provenance?: string;
  receiptId?: string;
}

export interface PositionGroup {
  id: string;
  label: string;
  detail: string;
  positions: Position[];
  gross: number;
  net: number;
  collateral: number;
  pnl: number;
}

export interface ExposureGroup {
  id: string;
  label: string;
  count: number;
  gross: number;
  net: number;
  collateral: number;
  share: number;
}

export interface LadderRung {
  expiryIso: string;
  days: number;
  positions: Position[];
  lots: number;
  collateralRelease: number;
  residualCash: number;
  netCash: number;
  availableAfter: number;
  state: PositionState;
}

export interface StressScenario {
  id: string;
  label: string;
  narrative: string;
  /** Relative move applied to the package price of every market in the domain. */
  moves: Record<RiskDomainId, number>;
}

export interface ScenarioResult {
  scenario: StressScenario;
  impact: number;
  equityAfter: number;
  headroom: number;
  healthFactor: number;
  binding: boolean;
  worstLabel: string;
  worstImpact: number;
}

export interface CollateralLine {
  asset: CollateralAsset;
  eligible: number;
  available: number;
  share: number;
}

export interface AccountSummary {
  equity: number;
  postedValue: number;
  eligible: number;
  reserved: number;
  available: number;
  initialMargin: number;
  maintenanceMargin: number;
  healthFactor: number;
  marginUsage: number;
  stressHeadroom: number;
  stressHealthFactor: number;
  bindingLabel: string;
}
