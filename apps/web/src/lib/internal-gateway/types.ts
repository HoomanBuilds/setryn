import type { Intent, TimeInForce } from "@/lib/terminal/economics";

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
  routeLabel: string;
  lots: number;
  price: number;
  fees: number;
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
  lots: number;
  limitPrice: number;
  executionPrice: number;
  timeInForce: TimeInForce;
  feeCap: number;
  collateralRequired: number;
  closePositionId: string | null;
  recipient: string;
  disclosure: "PUBLIC" | "PRIVATE_RFQ";
  settlementGuarantee: string;
}

export interface SignedOrderAuthorization {
  orderHash: string;
  signature: string;
  signer: string;
  nonce: string;
  deadline: string;
  intent: PackageOrderIntent;
}

export type SubmissionStepId =
  | "AUTHORIZED"
  | "SUBMITTED"
  | "INCLUDED"
  | "FILLED"
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
  | "COMPLETED"
  | "FAILED";

export interface OrderExecutionProgress {
  status: OrderExecutionStatus;
  updates: SubmissionUpdate[];
  authorization?: SignedOrderAuthorization;
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
  getReceipt(receiptId: string): ExecutionReceipt | null;
}
