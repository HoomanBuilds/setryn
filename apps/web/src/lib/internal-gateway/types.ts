import type { Intent, PackageSide, TimeInForce } from "@/lib/terminal/economics";
import type { PackageMarket } from "@/lib/terminal/types";

export type WalletStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "WRONG_NETWORK";

export interface RuntimeEnvironment {
  id: "LOCAL_DEMO" | "ARBITRUM_SEPOLIA";
  label: string;
  chainId: number;
  evidence: "DEMO" | "TESTNET";
}

export interface GatewayAccount {
  id: string;
  label: string;
  riskDomain: string;
  collateralAsset: "USDC";
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
  rfqRequests: RfqRequest[];
}

export interface CollateralIntent {
  kind: "DEPOSIT" | "WITHDRAW";
  accountId: string;
  asset: "USDC";
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
}

export type OrderType = "MARKET" | "LIMIT";

export type RestingOrderState = "WORKING" | "CANCELLED" | "FILLED" | "REPLACED" | "EXPIRED";

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
  limitPrice: number;
  timeInForce: TimeInForce;
  expiresAt: string | null;
  collateralReservation: number;
  feeCap: number;
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
}

export interface SignedOrderAuthorization {
  orderHash: string;
  signature: string;
  signer: string;
  nonce: string;
  deadline: string;
  intent: PackageOrderIntent;
}

export type RfqRequestState = "OPEN" | "SELECTED" | "CANCELLED" | "EXECUTED";

export type RfqQuoteProvenance = "SEEDED_SOLVER" | "LOCAL_DEMO";

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
  cancelRfq(requestId: string): Promise<RfqRequest>;
  completeRfq(requestId: string, receiptId: string): Promise<RfqRequest>;
  submitLocalMakerQuote(requestId: string, input: LocalMakerQuoteInput): Promise<RfqRequest>;
  withdrawLocalMakerQuote(requestId: string): Promise<RfqRequest>;
  getReceipt(receiptId: string): ExecutionReceipt | null;
}
