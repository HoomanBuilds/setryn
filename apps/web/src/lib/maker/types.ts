import type { ExecutionPosition, ExecutionReceipt, RestingPackageOrder } from "@/lib/internal-gateway/types";
import type { PackageMarket } from "@/lib/terminal/types";
import type { LiveQuote, RangeTerms } from "@/lib/strategies/range";

/*
 * The maker desk reads the connected wallet's own state from the gateway (resting public-book orders, fills, positions,
 * RFQ requests) and every market number from the market-data feed. Nothing is modeled.
 */

export type QuoteAction = "BUY" | "SELL";

/** A working quote: one of the wallet's resting public-book orders. */
export interface WorkingQuote {
  order: RestingPackageOrder;
  action: QuoteAction;
}

/** The wallet's own resting lots at one book price. */
export interface OwnLevel {
  action: QuoteAction;
  price: number;
  lots: number;
  orders: number;
}

/** A price level of the public book with the wallet's own share of it. */
export interface LadderLevel {
  price: number;
  bidLots: number;
  askLots: number;
  ownBidLots: number;
  ownAskLots: number;
}

export interface MarketInventory {
  marketId: string;
  longLots: number;
  shortLots: number;
  /** Long minus short lots. */
  netLots: number;
  /** Lot-weighted entry of the net side; null when flat. */
  averageEntry: number | null;
  collateral: number;
  positions: ExecutionPosition[];
}

/** One listed market with the wallet's activity on it. */
export interface MakerMarket {
  market: PackageMarket;
  quote: LiveQuote;
  terms: RangeTerms | null;
  working: WorkingQuote[];
  bidLots: number;
  askLots: number;
  inventory: MarketInventory | null;
  fills: ExecutionReceipt[];
}

/** A two-sided quote the composer is about to sign. */
export interface QuoteDraft {
  bid: number | null;
  ask: number | null;
  lots: number;
}
