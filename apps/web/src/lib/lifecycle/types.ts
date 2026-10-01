import type { ExecutionPosition, OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import type { MarkSource, SeriesStatus } from "@/lib/market-data/types";
import type { RangeTerms } from "@/lib/strategies/range";
import type { PackageMarket } from "@/lib/terminal/types";

/*
 * Lifecycle read model: one entry per position the connected account holds, built from the gateway's position and its
 * onchain terminal lifecycle, the market's range-forward terms and the market-data feed. Nothing is recorded or modeled
 * beyond arithmetic on those reads, and every estimate says what it is computed from.
 */

export type LifecycleHealth = "HEALTHY" | "ATTENTION" | "WINDOW_OPEN" | "CLOSED";

export type LifecycleActionKind = "EXIT" | "ROLL" | "OFFSET";

export type LifecycleBoundaryKind = "TRADING" | "FIXING" | "ELECTION" | "CORRECTION" | "RESOLUTION" | "SETTLEMENT";

export interface LifecycleBoundary {
  id: string;
  kind: LifecycleBoundaryKind;
  label: string;
  /** Unix seconds. */
  at: number;
  state: "UPCOMING" | "WINDOW_OPEN" | "PASSED";
  source: string;
}

export interface LifecycleLeg {
  id: string;
  instrument: string;
  role: string;
  side: "BUY" | "SELL";
  ratio: number;
  mark: number | null;
  markLabel: string;
  source: string;
  provenance: "EXECUTABLE" | "OBSERVED" | "REFERENCE";
  dependency: string;
}

export interface LifecycleImpact {
  label: string;
  before: string;
  after: string;
  tone?: "default" | "up" | "down" | "brand";
}

export interface LifecycleConstraint {
  label: string;
  state: "SATISFIED" | "REQUIRES_QUOTE" | "BLOCKED";
  detail: string;
}

export interface LifecycleProposal {
  id: string;
  kind: LifecycleActionKind;
  label: string;
  actionLabel: string;
  /** Where the action opens: the trade terminal of `targetMarketId` with the given direction and lots. */
  targetMarketId: string;
  direction: "LONG" | "SHORT";
  intent: "ENTER" | "EXIT";
  requestedLots: number;
  summary: string;
  quoteRequirement: string;
  impacts: LifecycleImpact[];
  constraints: LifecycleConstraint[];
}

export interface LifecycleStrategy {
  id: string;
  position: ExecutionPosition;
  market: PackageMarket;
  terms: RangeTerms | null;
  label: string;
  side: "LONG" | "SHORT";
  lots: number;
  entryPrice: number;
  /** Live mark from the feed, null when the market has none. */
  mark: number | null;
  markSource: MarkSource;
  seriesStatus: SeriesStatus;
  /** Underlying reference (Chainlink), null when not read. */
  reference: number | null;
  /** Mark-to-market result: lots x lot size x (mark - entry), signed for the side. */
  markPnl: number | null;
  /** Result at expiry if the fixing equals today's reference. */
  pnlAtReference: number | null;
  /** Result at expiry with the fixing at the cap (long's best) and at the floor. */
  pnlAtCap: number | null;
  pnlAtFloor: number | null;
  /** Underlying units of exposure at the reference: lots x lot size inside the range, signed for the side. */
  delta: number | null;
  collateral: number;
  receiptId: string | null;
  createdAt: string;
  /** Onchain terminal lifecycle, once the gateway has read it. */
  lifecycle: OnchainPositionLifecycle | null;
  health: LifecycleHealth;
  healthDetail: string;
  boundaries: LifecycleBoundary[];
  legs: LifecycleLeg[];
  proposals: LifecycleProposal[];
}
