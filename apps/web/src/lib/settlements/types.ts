import type { PositionOrigin } from "@/lib/positions/dossier";
import type {
  LegFamily,
  PackageMarket,
  PositionSide,
  PriceUnit,
  Provenance,
  Qualification,
} from "@/lib/terminal/types";
import type { FixingAdjustment, MarketHoliday } from "./calendar";

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

export type BoundaryKind = "FIXING" | "FUNDING" | "REBALANCE";

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
  adjustment: FixingAdjustment | null;
  provenance: Provenance;
  source: string;
}

export interface CalendarFamily {
  id: string;
  label: string;
  underlying: string;
}

export interface LegObservation {
  id: string;
  instrument: string;
  family: LegFamily;
  side: "BUY" | "SELL";
  ratio: number;
  value: number;
  unit: PriceUnit;
  ageSeconds: number;
  provenance: Provenance;
  source: string;
  qualification: Qualification;
}

export type FixingRecordState = "PENDING" | "WINDOW_OPEN" | "AWAITING_RECORD";

export interface ObservationGroup {
  market: PackageMarket;
  held: HeldExposure[];
  fixingMs: number;
  windowOpensMs: number;
  fixingState: FixingRecordState;
  /** Package mark from the shared preview board: derived from executable inputs. */
  packageMark: number;
  legs: LegObservation[];
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
  referencePrice: number;
  referenceLabel: string;
  /** Price term only: lots x multiplier x (reference - entry), signed for the holder. */
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
  | "CALENDAR"
  | "QUALIFICATION"
  | "WINDOW"
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
  projectedReference: number;
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
  referencePositions: number;
  families: CalendarFamily[];
  holidays: readonly MarketHoliday[];
  boundaries: ScheduleBoundary[];
  observations: ObservationGroup[];
  payouts: PayoutRow[];
  reconciliation: ReconciliationRow[];
  exceptions: SettlementException[];
  stages: Record<SettlementStage, number>;
  kpis: SettlementKpis;
}
