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

export interface PackageMarket {
  id: string;
  name: string;
  code: string;
  underlying: string;
  strategyKind: StrategyKind;
  strategyLabel: string;
  priceUnit: PriceUnit;
  priceDecimals: number;
  tickSize: number;
  netPrice: number;
  priorNetPrice: number;
  bestBid: number;
  bestAsk: number;
  expiryIso: string;
  tenorLabel: string;
  settlementClass: SettlementClass;
  settlementAsset: "USDC";
  fixingSource: string;
  qualification: Qualification;
  qualificationNote: string;
  /** Age in seconds of the fixture snapshot at page construction. */
  snapshotAgeSeconds: number;
  notionalPerLot: number;
  collateralPerLot: number;
  residualPerLot: number;
  openInterestLots: number;
  firmDepthLots: number;
  legs: PackageLeg[];
  book: BookRow[];
  routes: RouteQuote[];
  priceHistory: number[];
  payoffMoveUnit: string;
  payoff: PayoffPoint[];
  breakEvenMove: number;
}

export type ConsoleTabId =
  | "strategies"
  | "orders"
  | "rfqs"
  | "fills"
  | "recovery"
  | "receipts";

export interface StrategyRecord {
  id: string;
  marketId: string;
  package: string;
  lots: number;
  entry: string;
  mark: string;
  unrealised: number;
  collateral: string;
  nextEvent: string;
  state: "ACTIVE" | "FIXING_WINDOW" | "CLOSING";
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
