import type { MarkSource } from "@/lib/market-data/types";
import type { PositionOrigin } from "@/lib/positions/dossier";
import type { PackageMarket, PositionSide, Provenance } from "@/lib/terminal/types";

/** The dated settlement state machine from the interface specification, in order. */
export type SettlementStage =
  | "LIVE"
  | "FIXING_WINDOW"
  | "FIXING_OBSERVED"
  | "FIXING_UNAVAILABLE"
  | "PAYOUT_COMPUTED"
  | "CHALLENGE_OR_FALLBACK"
  | "SETTLING"
  | "INCLUDED"
  | "SUBMISSION_UNKNOWN"
  | "RECONCILING"
  | "RECONCILED"
  | "MANUAL_INTERVENTION";

export interface HeldExposure {
  positionId: string;
  origin: PositionOrigin;
  side: PositionSide;
  lots: number;
  label: string;
}

export type BoundaryKind = "FIXING" | "LAST_TRADE" | "ELECTION";

export interface ScheduleBoundary {
  id: string;
  kind: BoundaryKind;
  market: PackageMarket;
  /** Package family, which is one row of the calendar. */
  family: string;
  label: string;
  atMs: number | null;
  timingLabel: string;
  windowOpensMs: number | null;
  state: "UPCOMING" | "WINDOW_OPEN" | "PASSED";
  held: HeldExposure[];
  provenance: Provenance;
  source: string;
}

export interface CalendarFamily {
  id: string;
  label: string;
  underlying: string;
}

/** One live input behind a series' mark or fixing: the Chainlink reference, the book touch, the last fill. */
export interface InputObservation {
  id: string;
  label: string;
  role: string;
  /** Null when the source holds no value right now (an empty book side, no fill yet). */
  value: number | null;
  unit: string;
  decimals: number;
  /** Seconds since the source last updated; null when it has no value. */
  ageSeconds: number | null;
  provenance: Provenance;
  source: string;
}

export type FixingRecordState = "PENDING" | "WINDOW_OPEN" | "AWAITING_RECORD" | "PROPOSED" | "DISPUTED" | "FINALIZED";

export interface ObservationGroup {
  market: PackageMarket;
  held: HeldExposure[];
  fixingMs: number;
  windowOpensMs: number;
  fixingState: FixingRecordState;
  /** Committed fixing value from a held position's onchain record, once proposed or final. */
  fixingValue: number | null;
  /** Live mark from the market-data feed; null while the market has no quote, fill or reference. */
  packageMark: number | null;
  markSource: MarkSource;
  /** Seconds since the feed snapshot was read at its block. */
  markAgeSeconds: number | null;
  inputs: InputObservation[];
}

export interface PayoutRow {
  id: string;
  positionId: string;
  origin: PositionOrigin;
  label: string;
  market: PackageMarket;
  side: PositionSide;
  lots: number;
  entryPrice: number;
  /** The level the amount is computed at: the live mark, the fixing, or the close fill; null without one. */
  referencePrice: number | null;
  referenceLabel: string;
  /** Price term only: lots x lot size x (reference - entry), signed for the holder. */
  amount: number;
  /** USDC per 1.00 move in the settlement reference, across the lots. */
  perPoint: number;
  collateral: number;
  fees: number;
  kind: "PROJECTED" | "REALIZED";
  stage: SettlementStage | null;
  fixingMs: number;
  provenance: Provenance;
  atMs: number | null;
  receiptId: string | null;
}

export type ReconStatus = "MATCHED" | "OPEN" | "PENDING" | "MISMATCH";

export interface ReconCheck {
  label: string;
  ok: boolean;
}

export interface ReconciliationRow {
  id: string;
  subjectKind: "POSITION" | "FILL" | "ORDER" | "RFQ";
  subject: string;
  marketId: string;
  description: string;
  status: ReconStatus;
  checks: ReconCheck[];
  atMs: number | null;
  receiptId: string | null;
  transactionHash: string | null;
  positionId: string | null;
}

export type ExceptionSeverity = "CRITICAL" | "ACTION" | "NOTICE";

export type ExceptionKind =
  | "SERIES_STATUS"
  | "ELECTION"
  | "CLAIM"
  | "FIXING_PROXIMITY"
  | "FIXING_MISSING"
  | "RECONCILIATION";

export interface SettlementException {
  id: string;
  severity: ExceptionSeverity;
  kind: ExceptionKind;
  title: string;
  detail: string;
  nextAction: string;
  market: PackageMarket | null;
  positionId: string | null;
  origin: PositionOrigin | null;
  provenance: Provenance;
  source: string;
  href: string | null;
  hrefLabel: string | null;
  atMs: number | null;
}

export interface SettlementKpis {
  nextFixing: ScheduleBoundary | null;
  nextHeldFixing: ScheduleBoundary | null;
  heldSeries: number;
  heldWithin30d: number;
  projectedAccount: number | null;
  realized: number | null;
  realizedCount: number;
  reconMatched: number;
  reconTotal: number;
  reconMismatch: number;
  exceptionCounts: Record<ExceptionSeverity, number>;
}

export interface SettlementCenter {
  nowMs: number;
  accountConnected: boolean;
  accountPositions: number;
  families: CalendarFamily[];
  boundaries: ScheduleBoundary[];
  observations: ObservationGroup[];
  payouts: PayoutRow[];
  reconciliation: ReconciliationRow[];
  exceptions: SettlementException[];
  stages: Record<SettlementStage, number>;
  kpis: SettlementKpis;
}
