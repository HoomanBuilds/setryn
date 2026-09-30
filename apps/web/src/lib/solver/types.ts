import type {
  AuctionRecord,
  Bytes32,
  LiquidityProvenance,
  SourceRouteReservation,
} from "@/lib/auctions/types";
import type { Provenance } from "@/lib/terminal/types";

export type OpportunitySource = "SEALED_AUCTION" | "BATCH_ROUND" | "PRIVATE_RFQ";

/** Which clock a deadline is measured on: the shared preview clock, or wall time for chain objects. */
export type DeadlineClock = "PREVIEW" | "WALL";

export type OwnBidState = "NOT_COMMITTED" | "COMMITTED" | "REVEAL_DUE" | "REVEALED" | "SCHEDULED" | "QUOTE_IN_MAKER_DESK";

export type Eligibility = "ELIGIBLE" | "SIZE_CAPPED" | "DEPTH_SHORT" | "CAPACITY_LIMITED" | "BLOCKED";

export interface RoutePlanFill {
  provenance: LiquidityProvenance;
  price: number;
  lots: number;
  /** Component markets for implied rows, solver handle for firm rows. */
  origin: string | null;
  firm: boolean;
  /** Implied and solver sources must be reserved before a route can rely on them. */
  reservation: "NOT_REQUIRED" | "RESERVE_ON_COMMIT";
  invalidation: string;
}

export interface RoutePlanExclusion {
  reason: "SELF_MATCH" | "INDICATIVE";
  provenance: LiquidityProvenance;
  price: number;
  lots: number;
  origin: string | null;
}

export interface RoutePlan {
  marketId: string;
  /** What the solver must do in the market to hedge the fill: buy the package, or sell it. */
  hedgeAction: "BUY" | "SELL";
  requestedLots: number;
  fillableLots: number;
  fills: RoutePlanFill[];
  exclusions: RoutePlanExclusion[];
  byClass: { provenance: LiquidityProvenance; lots: number; share: number }[];
  touch: number;
  vwap: number | null;
  worst: number | null;
  feesUsd: number;
  /** Price-equivalent of fees, per package unit. */
  feePrice: number;
  /** The package price at which filling the auction exactly pays for the hedge and fees. */
  breakEven: number | null;
  /** Notional exposed between the first and last leg print on sequenced implied routes. */
  sequencedExposureUsd: number;
  collateralUsd: number;
}

export interface SolverOpportunity {
  id: string;
  source: OpportunitySource;
  provenance: Provenance;
  label: string;
  marketId: string;
  auction: AuctionRecord | null;
  requestId: string | null;
  /** The initiator's side. The solver takes the other side of the package. */
  initiatorSide: "BUY" | "SELL";
  lots: number;
  deadline: number;
  clock: DeadlineClock;
  deadlineLabel: string;
  bidders: number;
  ownState: OwnBidState;
  eligibility: Eligibility;
  eligibilityNote: string;
  bondUsd: number;
  plan: RoutePlan;
  /** Modeled: edge per the live touch versus the break-even price, in USDC for the full size. */
  edgeUsd: number | null;
  capacityRequiredUsd: number;
}

export interface CapacityBucket {
  id: "AVAILABLE" | "BOND_LOCKS" | "ROUTE_RESERVATIONS" | "WITHDRAWAL_DELAYED" | "RECOVERY_RESERVE";
  label: string;
  amountUsd: number;
  description: string;
}

export interface BondLock {
  bidId: Bytes32;
  auction: AuctionRecord;
  amountUsd: number;
  state: "LOCKED" | "RELEASE_DUE";
  releasesAt: number;
  detail: string;
}

export interface RouteReservationView {
  reservation: SourceRouteReservation;
  auction: AuctionRecord;
  collateralUsd: number;
}

export interface CapacityLedger {
  totalUsd: number;
  buckets: CapacityBucket[];
  bondLocks: BondLock[];
  reservations: RouteReservationView[];
}

export interface MarketPerformance {
  marketId: string;
  bids: number;
  wins: number;
  allocatedLots: number;
  bidLots: number;
  edgeUsd: number;
}

export type RejectReason = "LOST_ON_PRICE" | "LOST_ON_TIE_BREAK" | "SIZE_RULE" | "UNREVEALED" | "NO_CLEAR";

export interface SolverPerformance {
  windowSeconds: number;
  bids: number;
  revealed: number;
  wins: number;
  winRate: number;
  fillRate: number;
  edgeUsd: number;
  edgePerWinUsd: number;
  responseSeconds: number;
  rejects: Record<RejectReason, number>;
  byMarket: MarketPerformance[];
  /** Newest first, one entry per round the solver bid in. */
  recent: { auction: AuctionRecord; outcome: "WON" | RejectReason | "PENDING"; edgeUsd: number | null }[];
}

export type RecoveryKind = "SETTLEMENT_EXPIRED" | "SETTLEMENT_WATCH" | "BOND_SLASHED" | "BOND_RELEASE_DUE";

export interface RecoveryCase {
  id: string;
  kind: RecoveryKind;
  state: "WATCH" | "ACTIONABLE" | "RESOLVED";
  auction: AuctionRecord;
  amountUsd: number;
  title: string;
  detail: string;
  /** The permissionless completion path and when it becomes callable. */
  call: string | null;
  callableAt: number | null;
}
