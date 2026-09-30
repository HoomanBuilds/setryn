import type { Address, Hex } from "viem";

export type Side = "LONG" | "SHORT";
export type TimeInForce = "GTC" | "GTD" | "IOC" | "FOK";
export type OrderState = "WORKING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "EXPIRED";
export type Route = "DIRECT_BOOK" | "PRIVATE_RFQ";

export interface Page<T> {
  data: T[];
  page: { limit: number; nextCursor: string | null; total: number };
}

export interface PageParams {
  limit?: number;
  cursor?: string;
}

export type AccountFilter = { accountId: Hex; signer?: never } | { signer: Address; accountId?: never };

export interface Status {
  environment: string;
  chainId: number;
  headBlock: string;
  headTime: string;
  chainTime: string;
  deployment: { status: string; sourceCommit: string | null; contracts: number; matching: number; state: "VERIFIED" | "DEGRADED" };
  settlement: { token: Address; assetId: Hex; collateralSymbol: string; decimals: number };
  contracts: Record<string, Address>;
}

export interface Market {
  id: string;
  name: string;
  code: string;
  underlying: string;
  strategyKind: string;
  strategyLabel: string;
  priceUnit: string;
  priceDecimals: number;
  tickSize: number;
  tenorLabel: string;
  expiry: string;
  settlementClass: string;
  settlementAsset: string;
  fixingSource: string;
  qualification: "QUALIFIED" | "CONDITIONAL" | "SUSPENDED";
  qualificationNote: string;
  contractMultiplier: number;
  collateralPerLot: number;
  maxOrderLots: number | null;
  execution: "ONCHAIN" | "PREVIEW_ONLY";
  onchain: {
    chainId: number;
    seriesId: Hex;
    marketId: Hex;
    orderState: Address;
    publicOrderBook: Address;
    tickSizeMinor: number;
    maxOrderLots: number;
    makerFeeRatePpm: number;
    takerFeeRatePpm: number;
  } | null;
  quote: { source: "PREVIEW_SNAPSHOT"; netPrice: number; priorNetPrice: number; bestBid: number; bestAsk: number };
  legs: { id: string; side: "BUY" | "SELL"; ratio: number }[];
}

export interface BookLevel {
  price: number;
  lots: number;
  priceTicks?: string;
  orders?: number;
}

export interface Book {
  marketId: string;
  source: "ONCHAIN_PUBLIC_BOOK" | "PREVIEW_DEPTH";
  executable: boolean;
  bookId?: Hex;
  headBlock?: string;
  chainTime?: string;
  bids: BookLevel[];
  asks: BookLevel[];
  note?: string;
}

export interface Trade {
  tradeId: string;
  marketId: string;
  price: number;
  priceTicks?: string;
  lots: number;
  aggressorSide: "BUY" | "SELL";
  route?: "DIRECT_BOOK";
  transactionHash?: Hex;
  time: string;
  source: "ONCHAIN_FILL" | "PREVIEW_TAPE";
}

export interface Account {
  accountId: Hex;
  exists: boolean;
  collateralAsset: string;
  collateralId: Hex;
  postedUsd: number;
  reservedUsd: number;
  availableUsd: number;
  postedMinor: string;
  reservedMinor: string;
  availableMinor: string;
}

export interface Position {
  positionId: Hex;
  marketId: string;
  side: Side;
  lots: number;
  entryPrice: number;
  entryPriceTicks: string;
  collateralUsd: number;
  state: "ACTIVE";
  openedByFillId: Hex;
  transactionHash: Hex;
  openedAt: string;
}

export interface Fill {
  fillId: Hex;
  orderHash: Hex;
  role: "TAKER" | "MAKER";
  marketId: string;
  side: Side;
  route: Route;
  requestedLots: number;
  filledLots: number;
  cancelledLots: number;
  price: number;
  priceTicks: string;
  feesUsd: number;
  feesMinor: string;
  positionId: Hex;
  positionLive: boolean;
  outcome: "OPENED" | "CLOSED";
  closedPositionId: Hex | null;
  transactionHash: Hex;
  createdAt: string;
}

export interface Receipt {
  receiptId: Hex;
  fillId: Hex;
  orderHash: Hex;
  transactionHash: Hex;
  marketId: string;
  packageCode: string;
  side: Side;
  route: Route;
  routeLabel: string;
  lots: number;
  requestedLots: number;
  filledLots: number;
  cancelledLots: number;
  price: number;
  feesUsd: number;
  realizedPnlUsd: number | null;
  collateralReleasedUsd: number | null;
  guarantee: string;
  evidence: "DEVNET" | "TESTNET";
  createdAt: string;
}

export interface Order {
  orderHash: Hex;
  accountId: Hex;
  signer: Address;
  marketId: string;
  side: Side;
  lots: number;
  filledLots: number;
  remainingLots: number;
  limitPrice: number;
  priceTicks: string;
  timeInForce: TimeInForce;
  postOnly: boolean;
  state: OrderState;
  statusCode: number;
  deadline: string;
  maxFeeUsd: number;
  collateralReservationUsd: number;
  riskAdmissionId: Hex | null;
  fillIds: Hex[];
  receiptIds: Hex[];
  createdAt: string;
}

/** PublicOrder with its 64-bit and wider integers as decimal strings, exactly as the API returns it. */
export interface SerializedPublicOrder {
  signer: Address;
  accountId: Hex;
  policyId: Hex;
  policyContextHash: Hex;
  actionId: Hex;
  targetKind: 1;
  seriesId: Hex;
  packageId: Hex;
  targetVersion: number;
  side: 1 | 2;
  lots: string;
  priceTicks: string;
  timeInForce: 1 | 2 | 3 | 4;
  deadline: string;
  executionModeId: Hex;
  feeScheduleId: Hex;
  feeScheduleVersion: number;
  maxFeeMinor: string;
  recipient: Address;
  permittedExecutor: Address;
  nonce: string;
  salt: Hex;
  allowPartialFills: boolean;
  minimumFillLots: string;
  remainderPolicy: 1 | 2;
  postOnly: boolean;
  reduceOnly: boolean;
}

export interface TransactionRequest {
  step:
    | "APPROVE_LOCK_OPERATOR"
    | "BIND_RISK"
    | "REGISTER_ORDER"
    | "PLACE_ON_BOOK"
    | "MATCH"
    | "CANCEL_ORDER"
    | "SYNC_BOOK"
    | "AUTHORIZE_LIFECYCLE"
    | "EXECUTE_LIFECYCLE";
  description: string;
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: "0";
}

export interface PrepareOrderInput {
  signer: Address;
  marketId: string;
  side: Side;
  lots: number;
  limitPrice: number;
  timeInForce?: TimeInForce;
  /** Required for GTD. */
  expiresAt?: string;
  postOnly?: boolean;
  maxFeeUsd?: number;
}

export interface PreparedOrder {
  orderHash: Hex;
  accountId: Hex;
  order: SerializedPublicOrder;
  typedData: {
    domain: { name: "Setryn"; version: "1"; chainId: number; verifyingContract: Address };
    types: { PublicOrder: { name: string; type: string }[] };
    primaryType: "PublicOrder";
    message: SerializedPublicOrder;
  };
  chainTime: string;
  deadline: string;
  submitWithinSeconds: number;
  preconditions: {
    accountExists: boolean;
    availableCollateralMinor: string;
    requiredCollateralMinor: string;
    sufficientCollateral: boolean;
    lockOperatorsApproved: boolean;
  };
  requiredTransactions: TransactionRequest[];
  next: string;
}

export interface SubmitOrderResult {
  orderHash: Hex;
  accountId: Hex;
  signer: Address;
  status: "RISK_RESERVED";
  riskAdmissionId: Hex;
  riskReservationTransaction: Hex | null;
  validUntil: string;
  transactions: TransactionRequest[];
  next: string;
}

/** A prepared cancellation: transactions for the order's signer, and the risk-release message to sign and submit. */
export interface PreparedCancel {
  order: Order;
  transactions: TransactionRequest[];
  riskRelease: {
    description: string;
    to: Address;
    functionName: "cancelBoundAdmission";
    typedData: {
      domain: { name: string; version: string; chainId: number; verifyingContract: Address };
      types: Record<string, { name: string; type: string }[]>;
      primaryType: "SetrynRiskAdmissionCancellationV1";
      message: {
        admissionId: Hex;
        orderHash: Hex;
        accountId: Hex;
        signer: Address;
        nonce: string;
        deadline: string;
        cancellationReference: Hex;
      };
    };
  } | null;
}

/** A kind-4 (full exit) LifecycleAction with its 64-bit and wider integers as decimal strings. */
export interface SerializedLifecycleAction {
  kind: number;
  actor: Address;
  actorAccountId: Hex;
  policyContextHash: Hex;
  inputsHash: Hex;
  successorsHash: Hex;
  collateralReplacementsHash: Hex;
  participantSetHash: Hex;
  consentsHash: Hex;
  riskDomainId: Hex;
  riskDomainVersion: number;
  feeScheduleId: Hex;
  feeScheduleVersion: number;
  economicTransitionHash: Hex;
  compressionPlanId: Hex;
  breaksPackageProvenance: boolean;
  packageBreakPermissionHash: Hex;
  actorMaximumLiabilityIncreaseBaseUnits: string;
  actorMaximumCollateralIncreaseBaseUnits: string;
  inputCount: number;
  successorCount: number;
  participantCount: number;
  deadline: string;
  nonce: string;
  permittedExecutor: Address;
  salt: Hex;
}

export interface SerializedLifecycleInput {
  positionId: Hex;
  expectedImmutableHash: Hex;
  expectedLifecycleHash: Hex;
  expectedPositionLots: string;
  actionLots: string;
}

export interface SerializedCollateralReplacement {
  accountId: Hex;
  collateralId: Hex;
  terminalLiabilityBaseUnits: string;
}

export interface SerializedLifecycleConsent {
  actionId: Hex;
  accountId: Hex;
  signer: Address;
  nonce: string;
  deadline: string;
  maximumLiabilityIncreaseBaseUnits: string;
  maximumCollateralIncreaseBaseUnits: string;
  allowsPackageBreak: boolean;
  salt: Hex;
}

export interface PrepareExitInput {
  signer: Address;
  /** The open position and the opposite position that closes it (from an opposite-side order), in any order. */
  positionIds: [Hex, Hex];
}

/** A prepared full exit: the action to sign, with the counterparty's consent already attached. */
export interface PreparedExit {
  actionId: Hex;
  accountId: Hex;
  counterpartyAccountId: Hex;
  positions: { positionId: Hex; side: Side; lots: number }[];
  action: SerializedLifecycleAction;
  inputs: SerializedLifecycleInput[];
  replacements: SerializedCollateralReplacement[];
  consent: SerializedLifecycleConsent;
  consentSignature: Hex;
  typedData: {
    domain: { name: "Setryn"; version: "1"; chainId: number; verifyingContract: Address };
    types: { SetrynLifecycleActionV1: { name: string; type: string }[] };
    primaryType: "SetrynLifecycleActionV1";
    message: SerializedLifecycleAction & { chainId: string; engine: Address };
  };
  chainTime: string;
  deadline: string;
  submitWithinSeconds: number;
  next: string;
}

export interface SubmitExitInput {
  action: SerializedLifecycleAction;
  inputs: SerializedLifecycleInput[];
  replacements: SerializedCollateralReplacement[];
  consent: SerializedLifecycleConsent;
  consentSignature: Hex;
  actorSignature: Hex;
}

export interface SubmitExitResult {
  actionId: Hex;
  accountId: Hex;
  signer: Address;
  positionIds: Hex[];
  validUntil: string;
  transactions: TransactionRequest[];
  next: string;
}
