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
  publicBookMarketId: string | null;
  /** Economics of the onchain series behind the public book market, once the runtime is loaded. */
  publicBookEconomics: OnchainMarketEconomics | null;
  /** Settlement chain time minus browser time; deadlines and countdowns read the chain clock. */
  chainClockOffsetMs: number;
  publicBookOrders: BookRow[];
  rfqRequests: RfqRequest[];
}

export interface OnchainMarketEconomics {
  /** Settlement units of consideration per lot for each unit of package price. */
  considerationPerPriceUnit: number;
  longCollateralPerLot: number;
  shortCollateralPerLot: number;
  maxOrderLots: number;
  makerFeeBps: number;
  takerFeeBps: number;
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
}
