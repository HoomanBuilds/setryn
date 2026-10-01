import type { MarkSource, SeriesStatus } from "@/lib/market-data/types";

/** Every listed market quotes its forward level in USD; leg marks may carry other units. */
export type PriceUnit = "BP" | "PTS" | "USD";

export type StrategyKind =
  | "DATED_YIELD_CARRY"
  | "FUNDING_CARRY"
  | "DATED_BASIS"
  | "DELIVERABLE_FORWARD";

export type SettlementClass = "CASH_USDC" | "CASH_USDC_NDF";

export type Qualification = "QUALIFIED" | "CONDITIONAL" | "SUSPENDED";

export type Provenance = "OBSERVED" | "EXECUTABLE" | "ESTIMATED" | "MODELED";

export type LiquiditySource = "DIRECT" | "IMPLIED" | "SOLVER_FIRM";

export type Firmness = "FIRM" | "CAPACITY_BACKED" | "INDICATIVE";

export type Guarantee = "PACKAGE_ATOMIC" | "LEG_SEQUENCED" | "SOLVER_BONDED";

export type LegFamily = "FORWARD" | "BASIS" | "FUNDING" | "FINANCING" | "SPOT_REF";

export interface PackageLeg {
  id: string;
  side: "BUY" | "SELL";
  ratio: number;
  instrument: string;
  family: LegFamily;
  venueClass: "NATIVE_BOOK" | "IMPLIED_COMPONENT";
  mark: number;
  markUnit: PriceUnit;
  qualification: Qualification;
  /** Payoff slope per 1.00 of underlying move, per lot, in quote asset. */
  deltaPerLot: number;
}

export interface BookRow {
  id: string;
  side: "BID" | "ASK";
  source: LiquiditySource;
  price: number;
  lots: number;
  firmness: Firmness;
  executable: boolean;
  /** Present for solver commitments: seconds the signed quote stays valid. */
  ttlSeconds?: number;
  /** Component markets for IMPLIED rows, maker handle for SOLVER_FIRM rows. */
  origin?: string;
}

export interface RouteQuote {
  id: string;
  label: string;
  source: LiquiditySource;
  /** All-in package price to open, in the market price unit. */
  enterPrice: number;
  /** All-in package price to close, in the market price unit. */
  exitPrice: number;
  protocolFeeBps: number;
  counterpartyFeeBps: number;
  counterpartyFeeLabel: string;
  guarantee: Guarantee;
  etaLabel: string;
  availableLots: number;
  /** Lots available to a buy (resting offers) and to a sell (resting bids), when the route knows them per side. */
  enterLots?: number;
  exitLots?: number;
  requiresPrivate: boolean;
  /** Fraction of notional at risk between the first and last leg print. */
  intermediateExposureRate: number;
  collateralMultiple: number;
  note: string;
}

export interface PayoffPoint {
  move: number;
  value: number;
}

/**
 * One listed market: a cash-settled dated range forward on one underlying's fixing
 * (docs/plans/network-runtime-real-data.md, section 2). The static fields come from the deployment's catalog
 * (`catalog.generated.json`); the live fields (marks, quotes, book, routes, open interest, status) come only from the
 * market-data feed and are NaN, empty, or zero until it reports them. A missing quote is NaN, never a stand-in.
 */
export interface PackageMarket {
  id: string;
  name: string;
  code: string;
  underlying: string;
  strategyKind: StrategyKind;
  /** The analytics view the market is presented under (yield carry, funding carry, basis, forward points). */
  strategyLabel: string;
  priceUnit: PriceUnit;
  priceDecimals: number;
  tickSize: number;
  /** The mark: book mid, else last fill, else the Chainlink reference clamped into the payoff range (see `markSource`). */
  netPrice: number;
  /** The first fill of the last 24 hours, else the mark (no change). */
  priorNetPrice: number;
  /** Best resting bid on the public book; NaN when no bid rests. */
  bestBid: number;
  /** Best resting offer on the public book; NaN when no offer rests. */
  bestAsk: number;
  /** Expiry date, `YYYY-MM-DD` (UTC). The exact instant is `expiryAt`. */
  expiryIso: string;
  tenorLabel: string;
  settlementClass: SettlementClass;
  settlementAsset: "USDC";
  fixingSource: string;
  qualification: Qualification;
  qualificationNote: string;
  /** Age in seconds of the live data at the last feed update. */
  snapshotAgeSeconds: number;
  /** Lot size times the live reference: the underlying exposure of one lot in USDC. NaN without a reference. */
  notionalPerLot: number;
  /** USDC of consideration per 1.00 of quoted price, per lot: the lot size. */
  contractMultiplier: number;
  /** The short side's bounded liability per lot: lot size times (cap - floor). */
  collateralPerLot: number;
  /** Fees are charged on the fill's consideration (price x multiplier) rather than on notional, as onchain. */
  feeOnConsideration?: boolean;
  /** Largest quantity one order may carry, when the venue enforces one. */
  maxOrderLots?: number;
  residualPerLot: number;
  openInterestLots: number;
  firmDepthLots: number;
  legs: PackageLeg[];
  book: BookRow[];
  routes: RouteQuote[];
  /** Recent fill prices, oldest first; empty without fills. */
  priceHistory: number[];
  payoffMoveUnit: string;
  payoff: PayoffPoint[];
  breakEvenMove: number;
  /* Range forward terms (catalog). */
  /** Price at zero onchain ticks, the payoff floor: consideration per lot is (price - priceOffset) x contractMultiplier. */
  priceOffset: number;
  floor: number;
  cap: number;
  /** Units of the underlying per lot. */
  lotSize: number;
  /** Unix seconds of the expiry fixing. */
  expiryAt: number;
  /** Unix seconds after which the series takes no new orders. */
  lastTradingAt: number;
  /* Series schedule, unix seconds, present when the deployment's runtime states it (schema 11). */
  tradingStartsAt?: number;
  fixingWindowOpen?: number;
  fixingWindowClose?: number;
  exerciseOpensAt?: number;
  exerciseCutoffAt?: number;
  finalResolutionAt?: number;
  settlementDeadline?: number;
  /** Chainlink feed the market is referenced against, e.g. "BTC / USD". */
  referencePair: string;
  /* Live overlay (market-data feed). */
  markSource: MarkSource;
  /** Unix seconds of the reading the mark comes from; 0 when unknown. */
  markAsOf: number;
  /** Live Chainlink reference of the underlying; NaN when it could not be read. */
  referencePrice: number;
  /** Unix seconds the reference aggregator last updated; 0 when unknown. */
  referenceAsOf: number;
  seriesStatus: SeriesStatus;
  /** Whether the connected deployment lists this market onchain (false until the feed confirms it). */
  listedOnchain: boolean;
}

export type ConsoleTabId =
  | "strategies"
  | "orders"
  | "rfqs"
  | "fills"
  | "recovery"
  | "receipts";

export type PositionSide = "LONG" | "SHORT";

export type PositionState = "ACTIVE" | "FIXING_WINDOW" | "CLOSING";

/**
 * Everything a position contributes to profit and loss except the price term,
 * which is derived from the entry price against the current package mark.
 */
export interface PnlAttribution {
  carry: number;
  funding: number;
  fees: number;
  residual: number;
}

export interface StrategyRecord {
  id: string;
  marketId: string;
  side: PositionSide;
  lots: number;
  /** All-in package price at entry, in the price unit of its market. */
  entryPrice: number;
  initialMargin: number;
  maintenanceMargin: number;
  attribution: PnlAttribution;
  nextEvent: string;
  state: PositionState;
}

export interface OrderRecord {
  id: string;
  marketId: string;
  package: string;
  side: "ENTER" | "EXIT";
  lots: number;
  filledLots: number;
  limit: string;
  tif: "GTC" | "IOC" | "FOK";
  route: string;
  state: "WORKING" | "PARTIAL" | "CANCELLED" | "REJECTED";
  detail: string;
}

export interface RfqRecord {
  id: string;
  marketId: string;
  package: string;
  lots: number;
  invited: number;
  responded: number;
  best: string;
  closesInSeconds: number;
  state: "COLLECTING" | "QUOTE_SELECTED" | "EXPIRED";
  disclosure: string;
}

export interface FillRecord {
  id: string;
  marketId: string;
  package: string;
  side: "ENTER" | "EXIT";
  lots: number;
  price: string;
  source: LiquiditySource;
  fee: string;
  at: string;
}

export interface RecoveryRecord {
  id: string;
  marketId: string;
  package: string;
  stage: string;
  state: "SUBMISSION_UNKNOWN" | "RECONCILING" | "RESOLVED";
  detail: string;
  nextAction: string;
}

export interface ReceiptRecord {
  id: string;
  marketId: string;
  package: string;
  kind: "BEST_EXECUTION" | "FIXING" | "SETTLEMENT";
  commitment: string;
  state: "READY" | "PENDING_FIXING";
  detail: string;
}

export interface ConsoleData {
  strategies: StrategyRecord[];
  orders: OrderRecord[];
  rfqs: RfqRecord[];
  fills: FillRecord[];
  recovery: RecoveryRecord[];
  receipts: ReceiptRecord[];
}
