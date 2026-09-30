import type { ActiveFeeSchedule } from "./fee-schedule";
import type { Intent, PackageSide, TimeInForce } from "@/lib/terminal/economics";
import type { BookRow, PackageMarket } from "@/lib/terminal/types";
import type { OnchainPublicOrder } from "./protocol";

export type WalletStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "WRONG_NETWORK";

export interface RuntimeEnvironment {
  id: "LOCAL_DEMO" | "LOCAL_DEVNET" | "ARBITRUM_SEPOLIA";
  label: string;
  chainId: number;
  evidence: "DEMO" | "DEVNET" | "TESTNET";
}

export interface GatewayAccount {
  id: string;
  label: string;
  riskDomain: string;
  collateralAsset: "USDC" | "sUSD";
  posted: number;
  eligible: number;
  reserved: number;
  available: number;
  equity: number;
}

export interface ExecutionPosition {
  id: string;
  marketId: string;
  side: "LONG" | "SHORT";
  lots: number;
  entryPrice: number;
  collateral: number;
  state: "ACTIVE";
  createdAt: string;
}

export interface ExecutionReceipt {
  id: string;
  orderHash: string;
  fillId: string;
  transactionHash: string;
  marketId: string;
  packageCode: string;
  packageSide: PackageSide;
  routeLabel: string;
  lots: number;
  requestedLots: number;
  filledLots: number;
  cancelledLots: number;
  price: number;
  fees: number;
  realizedPnlUsd?: number;
  collateralReleasedUsd?: number;
  guarantee: string;
  evidence: RuntimeEnvironment["evidence"];
  createdAt: string;
}

/**
 * Where a held position stands in its onchain terminal lifecycle, read from the position engine, the fixing engine and
 * the settlement coordinator. It is never inferred from the preview clock alone.
 */
export type PositionLifecyclePhase =
  /** Live and tradable, before the fixing window. */
  | "LIVE"
  /** Inside or past the fixing window with no final fixing accepted onto the position yet. */
  | "AWAITING_FIXING"
  /** The final fixing is on the position and the holder may elect before the exercise cutoff. */
  | "FIXED_AWAITING_ELECTION"
  /** The holder exercised; the settlement record is not written yet. */
  | "EXERCISED"
  /** A settlement record is written with a nonzero transfer, or the exercise paid out. */
  | "SETTLED"
  /** Unelected lots lapsed with no transfer. */
  | "LAPSED"
  /** A terminal claim is open for the receiving account. */
  | "CLAIM_AVAILABLE"
  /** Closed by unwind or replaced by a lifecycle successor. */
  | "CLOSED";

export type LifecycleActionKey = "EXERCISE" | "SETTLE" | "CLAIM" | "FINALIZE";

export interface LifecycleActionState {
  available: boolean;
  /** Why the action is unavailable, precise enough to act on; null when available. */
  reason: string | null;
}

export interface OnchainLifecycleSchedule {
  lastTradingAt: string;
  fixingWindowOpen: string;
  fixingWindowClose: string;
  exerciseOpensAt: string;
  exerciseCutoffAt: string;
  correctionCutoffAt: string;
  finalResolutionAt: string;
  settlementDeadline: string;
}

export interface OnchainFixingState {
  status: "PENDING" | "PROPOSED" | "DISPUTED" | "FINALIZED";
  /** Benchmark value in its own units, from the finalized result or else the open proposal. */
  value: number | null;
  resolution: "PRIMARY_FINAL" | "FALLBACK_FINAL" | "TERMINAL_DISRUPTION" | null;
  /** True when the position itself carries a final fixing reference, which holder election requires. */
  acceptedOnPosition: boolean;
  observedAt: string | null;
  finalizedAt: string | null;
}

export interface OnchainSettlementRecord {
  id: string;
  mode: "NORMAL" | "TERMINAL_DISRUPTION" | "LAPSED";
  /** Signed transfer to this account: positive receives, negative pays. */
  transferUsd: number;
  finalizedAt: string;
  transactionHash: string | null;
  /** This account's own terminal reservation released back to it. */
  releasedUsd: number;
  claim: {
    id: string;
    status: "ACTIVE" | "FULFILLED";
    amountUsd: number;
    /** True when this account is the claim's receiver. */
    receivable: boolean;
    transactionHash: string | null;
  } | null;
}

export interface OnchainPositionLifecycle {
  positionId: string;
  marketId: string;
  side: "LONG" | "SHORT";
  /** Position engine status name, for example "Live" or "Fixing". */
  status: string;
  /** Position engine exercise state name, for example "ElectionOpen". */
  exerciseState: string;
  exercisePolicy: "HOLDER_ELECTION" | "AUTOMATIC" | "AUTOMATIC_UNLESS_ABANDONED" | "UNKNOWN";
  phase: PositionLifecyclePhase;
  lots: number;
  remainingLots: number;
  exercisedLots: number;
  closedLots: number;
  entryPrice: number;
  /** The account holds the lifecycle election (the long side). */
  holdsElection: boolean;
  schedule: OnchainLifecycleSchedule;
  fixing: OnchainFixingState;
  /** Transfer to this account's side at the fixing for the remaining lots, from the payoff module. */
  projectedPayoffUsd: number | null;
  /** Projected payoff plus the consideration the opening fill exchanged. */
  projectedPnlUsd: number | null;
  /** Transfer already fixed on the position for this account (exercised lots or terminal outcome). */
  terminalTransferUsd: number;
  settlement: OnchainSettlementRecord | null;
  /** Collateral the position still reserves on this account's side. */
  collateralReservedUsd: number;
  exerciseTransactionHash: string | null;
  /** Chain time of the read, in unix seconds. */
  observedAtSeconds: number;
}

export interface LifecycleActionResult {
  action: LifecycleActionKey;
  positionId: string;
  transactionHash: string;
  detail: string;
}

export interface GatewaySnapshot {
  environment: RuntimeEnvironment;
  wallet: {
    status: WalletStatus;
    address: string | null;
    chainId: number | null;
  };
  account: GatewayAccount;
  positions: ExecutionPosition[];
  receipts: ExecutionReceipt[];
  executions: GatewayExecution[];
  restingOrders: RestingPackageOrder[];
  /** The primary onchain market. Every market in `onchainMarkets` trades onchain; this one names the first. */
  publicBookMarketId: string | null;
  /** Economics of the primary market's series, once the runtime is loaded. */
  publicBookEconomics: OnchainMarketEconomics | null;
  /** Every catalog market registered onchain, keyed by catalog market id, once the runtime is loaded. */
  onchainMarkets: Record<string, OnchainMarket>;
  /** The active protocol fee schedule read from chain, refreshed with the book; null until the runtime is loaded. */
  feeSchedule: ActiveFeeSchedule | null;
  /** Settlement chain time minus browser time; deadlines and countdowns read the chain clock. */
  chainClockOffsetMs: number;
  /** The primary market's public book. */
  publicBookOrders: BookRow[];
  /** Resting public book orders of every onchain market, keyed by catalog market id. */
  publicBooks: Record<string, BookRow[]>;
  rfqRequests: RfqRequest[];
  /** Onchain terminal lifecycle of every position the account holds or held, keyed by lowercase position id. */
  lifecycles: Record<string, OnchainPositionLifecycle>;
}

export interface OnchainMarketEconomics {
  /** Settlement units of consideration per lot for each unit of package price. */
  considerationPerPriceUnit: number;
  longCollateralPerLot: number;
  shortCollateralPerLot: number;
  maxOrderLots: number;
  /** The fee schedule version orders on this market sign: the one its active market version names. */
  feeScheduleVersion: number;
  /** The series' active version: the `targetVersion` orders on this market sign. */
  seriesVersion: number;
  /** False while the market's fee schedule version is not the active one (mid fee change), so nothing can clear. */
  tradable: boolean;
  makerFeeBps: number;
  takerFeeBps: number;
  /** Flat charge per fill on top of the rate, in USD (zero under a pure rate schedule). */
  makerFlatFeeUsd: number;
  takerFlatFeeUsd: number;
}

/** One catalog market's onchain series and the economics its orders settle on. */
export interface OnchainMarket extends OnchainMarketEconomics {
  marketKey: string;
  seriesId: string;
  bookId: string;
  /** Price ticks per unit of package price. */
  priceScale: number;
}

export interface CollateralIntent {
  kind: "DEPOSIT" | "WITHDRAW";
  accountId: string;
  asset: "USDC" | "sUSD";
  amount: number;
  recipient: string;
}

export interface CollateralIntentResult {
  intentId: string;
  kind: CollateralIntent["kind"];
  amount: number;
  status: "COMPLETED";
}

export interface PackageOrderIntent {
  accountId: string;
  marketId: string;
  packageCode: string;
  routeId: string;
  routeLabel: string;
  side: Intent;
  packageSide: PackageSide;
  lots: number;
  fillLots: number;
  limitPrice: number;
  executionPrice: number;
  contractMultiplier: number;
  orderType: OrderType;
  timeInForce: TimeInForce;
  expiresAt: string | null;
  feeCap: number;
  collateralRequired: number;
  closePositionId: string | null;
  replacesOrderId: string | null;
  recipient: string;
  disclosure: "PUBLIC" | "PRIVATE_RFQ";
  settlementGuarantee: string;
  /** Rest-only maker order; the book rejects it instead of letting it cross. */
  postOnly?: boolean;
}

export type OrderType = "MARKET" | "LIMIT";

export type RestingOrderState =
  | "WORKING"
  | "PARTIALLY_FILLED"
  | "CANCELLED"
  | "FILLED"
  | "REPLACED"
  | "EXPIRED";

export interface RestingPackageOrder {
  id: string;
  orderHash: string;
  accountId: string;
  marketId: string;
  packageCode: string;
  routeId: string;
  routeLabel: string;
  side: Intent;
  packageSide: PackageSide;
  lots: number;
  filledLots: number;
  remainingLots: number;
  limitPrice: number;
  timeInForce: TimeInForce;
  expiresAt: string | null;
  collateralReservation: number;
  remainingCollateralReservation: number;
  feeCap: number;
  remainingFeeCap: number;
  fillIds: string[];
  receiptIds: string[];
  closePositionId: string | null;
  replacesOrderId: string | null;
  replacedByOrderId?: string | null;
  replacedAt?: string;
  createdAt: string;
  cancelledAt?: string;
  expiredAt?: string;
  state: RestingOrderState;
  orderType?: OrderType;
  contractMultiplier?: number;
  settlementGuarantee?: string;
  disclosure?: "PUBLIC" | "PRIVATE_RFQ";
  recipient?: string;
  collateralRequired?: number;
  filledAt?: string;
  fillId?: string;
  receiptId?: string;
  /** Rest-only maker order. */
  postOnly?: boolean;
}

export interface SignedOrderAuthorization {
  orderHash: string;
  signature: string;
  signer: string;
  nonce: string;
  deadline: string;
  intent: PackageOrderIntent;
  onchainOrder: OnchainPublicOrder;
  riskAdmissionId: string;
}

export type RfqRequestState = "OPEN" | "SELECTED" | "CANCELLED" | "EXECUTED";

export type RfqQuoteProvenance = "SEEDED_SOLVER" | "DEVNET_MAKER";

export interface FirmRfqQuote {
  id: string;
  solverLabel: string;
  packagePrice: number;
  feeCap: number;
  capacityLots: number;
  expiresAt: string;
  settlementGuarantee: string;
  provenance: RfqQuoteProvenance;
}

export interface LocalMakerQuoteInput {
  packagePrice: number;
  capacityLots: number;
  feeCap: number;
  ttlSeconds: number;
}

export interface RfqRequest {
  id: string;
  authorization: SignedOrderAuthorization;
  createdAt: string;
  expiresAt: string;
  state: RfqRequestState;
  selectedQuoteId: string | null;
  receiptId: string | null;
  quotes: FirmRfqQuote[];
}

export type SubmissionStepId =
  | "AUTHORIZED"
  | "SUBMITTED"
  | "INCLUDED"
  | "FILLED"
  | "IOC_CANCELLED"
  | "POSITION_CREATED"
  | "POSITION_UPDATED"
  | "POSITION_CLOSED"
  | "RECEIPT_READY";

export interface SubmissionUpdate {
  step: SubmissionStepId;
  label: string;
  detail: string;
  transactionHash?: string;
}

export type ExecutionOutcome = "OPENED" | "REDUCED" | "CLOSED";

export interface PackageExecutionResult {
  fillId: string;
  outcome: ExecutionOutcome;
  requestedLots: number;
  filledLots: number;
  cancelledLots: number;
  position: ExecutionPosition | null;
  closedPositionId: string | null;
  closedLots: number;
  receipt: ExecutionReceipt;
}

export interface GatewayExecution {
  id: string;
  orderHash: string;
  updates: SubmissionUpdate[];
  result: PackageExecutionResult;
  createdAt: string;
}

export type OrderExecutionStatus =
  | "IDLE"
  | "CONNECTING"
  | "AUTHORIZING"
  | "SUBMITTING"
  | "RESTING"
  | "COMPLETED"
  | "FAILED";

export interface OrderExecutionProgress {
  status: OrderExecutionStatus;
  updates: SubmissionUpdate[];
  authorization?: SignedOrderAuthorization;
  restingOrder?: RestingPackageOrder;
  result?: PackageExecutionResult;
  error?: string;
}

export interface InternalTradingGateway {
  getSnapshot(): GatewaySnapshot;
  /** The snapshot the server renders, used for hydration. */
  getServerSnapshot(): GatewaySnapshot;
  subscribe(listener: () => void): () => void;
  connectWallet(): Promise<void>;
  submitCollateralIntent(intent: CollateralIntent): Promise<CollateralIntentResult>;
  authorizeOrder(intent: PackageOrderIntent): Promise<SignedOrderAuthorization>;
  submitAuthorizedOrder(
    authorization: SignedOrderAuthorization,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult>;
  placeRestingOrder(authorization: SignedOrderAuthorization): Promise<RestingPackageOrder>;
  replaceRestingOrder(
    oldOrderId: string,
    authorization: SignedOrderAuthorization,
  ): Promise<RestingPackageOrder>;
  cancelRestingOrder(orderId: string): Promise<RestingPackageOrder>;
  reconcileRestingOrders(markets: readonly PackageMarket[]): RestingPackageOrder[];
  requestRfq(authorization: SignedOrderAuthorization): Promise<RfqRequest>;
  selectRfqQuote(requestId: string, quoteId: string): Promise<RfqRequest>;
  executeSelectedRfq(
    requestId: string,
    onUpdate: (update: SubmissionUpdate) => void,
  ): Promise<PackageExecutionResult>;
  cancelRfq(requestId: string): Promise<RfqRequest>;
  submitLocalMakerQuote(requestId: string, input: LocalMakerQuoteInput): Promise<RfqRequest>;
  withdrawLocalMakerQuote(requestId: string): Promise<RfqRequest>;
  getReceipt(receiptId: string): ExecutionReceipt | null;
  /** Re-reads the onchain terminal lifecycle of the account's positions. */
  refreshLifecycles(): Promise<void>;
  /** Runs one terminal lifecycle action on a position, signed by the connected wallet. */
  runLifecycleAction(positionId: string, action: LifecycleActionKey): Promise<LifecycleActionResult>;
  /**
   * Withdraws available protocol fees from the fee recipient account through CollateralVault.withdraw. Only that
   * account's controller can; SIMULATE checks the call against the chain without sending, SEND signs and waits.
   */
  withdrawTreasuryFees(request: TreasuryWithdrawal, mode: "SIMULATE" | "SEND"): Promise<TreasuryWithdrawalResult>;
}

export interface TreasuryWithdrawal {
  accountId: string;
  /** USD amount of the settlement asset, at most six decimals. */
  amount: number;
  recipient: string;
}

export interface TreasuryWithdrawalResult {
  mode: "SIMULATE" | "SEND";
  amount: number;
  recipient: string;
  transactionHash: string | null;
}
