import type { FirmRfqQuote, RfqRequest } from "@/lib/internal-gateway/types";

/*
 * Solver read model: the private requests the connected account can see (its own, from the PrivateRfqBook through the
 * gateway), the firm quotes on them, and what hedging each one on the public book would cost at the feed's block.
 */

export type OpportunityState = "OPEN" | "SELECTED" | "EXECUTED" | "CANCELLED" | "EXPIRED";

export interface RoutePlanFill {
  price: number;
  lots: number;
  /** Book row id (the resting order). */
  orderId: string;
}

/** What it costs to take `requestedLots` from the public book on one side, at the feed's block. */
export interface RoutePlan {
  marketId: string;
  /** What the hedger does on the book: buy lifts offers, sell hits bids. */
  hedgeAction: "BUY" | "SELL";
  requestedLots: number;
  fillableLots: number;
  fills: RoutePlanFill[];
  /** Lots resting from the connected account itself, left out so the plan never matches its own orders. */
  excludedOwnLots: number;
  touch: number | null;
  vwap: number | null;
  worst: number | null;
  /** Taker fee on the filled consideration, USDC. */
  feesUsd: number;
  /** Fees expressed per unit of price, so they can be added to a level. */
  feePrice: number;
  /** The level at which a fill exactly pays for the book hedge and its fees. */
  breakEven: number | null;
}

export interface SolverOpportunity {
  id: string;
  request: RfqRequest;
  marketId: string;
  /** The taker's action. */
  takerAction: "BUY" | "SELL";
  lots: number;
  limitPrice: number;
  /** Unix seconds. */
  deadline: number;
  state: OpportunityState;
  quotes: FirmRfqQuote[];
  bestQuote: FirmRfqQuote | null;
  /** Taking the same size from the book in the taker's direction, for comparison. */
  plan: RoutePlan | null;
  /** Best quote against the book for the full size, USDC; positive means the quote beats the book. */
  improvementUsd: number | null;
  collateralRequired: number;
}

export interface MarketRequestStats {
  marketId: string;
  requests: number;
  quoted: number;
  executed: number;
  lots: number;
  executedLots: number;
}

export interface RequestStats {
  total: number;
  open: number;
  quoted: number;
  executed: number;
  cancelled: number;
  expired: number;
  quotesReceived: number;
  executedLots: number;
  quoteRate: number;
  executionRate: number;
  byMarket: MarketRequestStats[];
}

export type RecoveryKind = "EXPIRED_OPEN" | "SELECTION_EXPIRED";

export interface RecoveryItem {
  id: string;
  kind: RecoveryKind;
  request: RfqRequest;
  title: string;
  detail: string;
  /** The call that closes it; anyone may expire a lapsed request. */
  call: string;
}
