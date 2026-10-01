import type { CollateralAsset } from "@/lib/terminal/account";
import type { MarkSource } from "@/lib/market-data/types";
import type {
  PackageMarket,
  PnlAttribution,
  PositionSide,
  PositionState,
  StrategyRecord,
} from "@/lib/terminal/types";

export type RiskDomainId = "CRYPTO_CARRY" | "CRYPTO_BASIS" | "MACRO_FORWARD";

export type GroupBy = "STRATEGY" | "UNDERLYING" | "EXPIRY" | "DOMAIN";

/** The fee and carry components plus the price term derived from entry against mark. */
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
  /** Lot count. Direction lives in `side` and in `signedLots`. */
  lots: number;
  /** Negative for a short, so every size reads with its own sign. */
  signedLots: number;
  /** Underlying units the position moves with (lots x lot size), signed; zero outside the payoff range. */
  signedUnits: number;
  /** Forward level the position opened at, in USD. */
  entryPrice: number;
  /** Live forward level from the market-data feed; null while the market has no quote, fill or reference. */
  markPrice: number | null;
  markSource: MarkSource;
  /** USD value of the underlying units at the mark (entry while unmarked), signed by side. */
  signedNotional: number;
  grossNotional: number;
  /** Collateral the position locks onchain: its bounded terminal liability. */
  collateral: number;
  initialMargin: number;
  maintenanceMargin: number;
  pnl: PnlBreakdown;
  /** Collateral plus price PnL: what the position returns if the fixing prints at the mark. */
  equity: number;
  /** What the position can still lose if the fixing prints at its adverse bound, never below zero. */
  atRisk: number;
  /** Adverse payoff bound (the floor for a long, the cap for a short); null when the listing omits it. */
  boundLevel: number | null;
  domain: RiskDomainId;
  daysToExpiry: number;
  nextEvent: string;
  href: string;
  /** Terminal handoff for exiting an active account position. */
  exitHref?: string;
  source?: "ONCHAIN_RUNTIME";
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
  /** Price PnL settled at the fixing if it prints at today's marks. */
  residualCash: number;
  netCash: number;
  availableAfter: number;
  state: PositionState;
}

export interface StressScenario {
  id: string;
  label: string;
  narrative: string;
  /** Relative move applied to the forward level of every market in the domain. */
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
  /** Collateral the account's positions and resting orders lock: their bounded terminal liability. */
  initialMargin: number;
  maintenanceMargin: number;
  /** Collateral equity over the locked liability; 0 when nothing is locked. */
  healthFactor: number;
  marginUsage: number;
  stressHeadroom: number;
  stressHealthFactor: number;
  bindingLabel: string;
}
