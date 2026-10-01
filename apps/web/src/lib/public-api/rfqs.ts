import {
  BaseError,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  stringToHex,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { POST as operatorRfqExecute } from "@/app/api/internal/operator/rfq-execute/route";
import { POST as makerRfqQuote } from "@/app/api/internal/operator/rfq-quote/route";
import { signerAvailability } from "@/lib/internal-gateway/operator-signer";
import {
  orderStateAbi,
  privateRfqBookAbi,
  privateRfqRequestTypedData,
  riskBindingAbi,
  rfqSelectionTypedData,
  serializePublicOrder,
  type OnchainPrivateRfqRequest,
  type OnchainPublicOrder,
  type OnchainRfqSelection,
} from "@/lib/internal-gateway/protocol";
import type { SetrynRuntime, SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import { PublicApiError } from "./errors";
import {
  EMPTY_ID,
  chainContext,
  hashOrder,
  loadAccountActivity,
  marketOfSeries,
  minorToUsd,
  readOrderIfRegistered,
  sideName,
  ticksToPrice,
  timeInForceName,
  type ChainContext,
  type SideName,
  type TimeInForceName,
} from "./chain";
import {
  assertActiveFeeSchedule,
  assertSignerAllowed,
  draftOrder,
  lockOperatorTransactions,
  reserveOrderRisk,
  riskReleaseFor,
  typedDataFor,
  verifySignedOrder,
  type PrepareInput,
  type TransactionRequest,
  type TransactionStep,
} from "./orders";
import type { StoredApiKey } from "./store";

/**
 * Private firm RFQ through the public API, mirroring the platform terminal (`requestRfq`, `selectRfqQuote` and
 * `executeSelectedRfq` in lib/internal-gateway/onchain.ts). The API never holds a user key and never sends a transaction
 * for the requester:
 *
 *   1. POST /rfqs/prepare builds the taker's PublicOrder (private RFQ execution mode) and the PrivateRfqRequest bound to
 *      it, and returns both EIP-712 typed data.
 *   2. POST /rfqs verifies both signatures, runs the platform's risk admission for the order, and returns the
 *      transactions the requester sends: bindOrderRisk, registerSignedOrder, registerRequest and openCollection.
 *   3. POST /rfqs/{rfqId}/quotes invites the solver network to quote. Where the deployment runs a designated maker, it
 *      quotes from the live reference exactly as the terminal triggers it. GET /rfqs/{rfqId}/quotes lists quotes.
 *   4. POST /rfqs/{rfqId}/accept/prepare returns the RfqSelectionAuthorization typed data for one quote; POST
 *      /rfqs/{rfqId}/accept verifies the signed selection and returns lockSelection, confirmSelectedCapacity,
 *      authorizeSubmission and submitSelectedRfq for the requester to send.
 *   5. POST /rfqs/{rfqId}/settle hands the submitted RFQ to the permitted executor, which clears it atomically through
 *      AtomicClearingEngine.clearSeriesWithHandoff. The executor is the platform operator.
 *
 * Every hash, signature, lifecycle state, deadline and collateral bound is validated again by the contracts.
 */

// Canonical enum tables, keyed by the Solidity enum values of RfqStatus and MakerQuoteStatus.
export const RFQ_STATUS = {
  1: "INVITING",
  2: "COLLECTING",
  3: "SELECTION_LOCKED",
  4: "CAPACITY_RESERVED",
  5: "AUTHORIZED",
  6: "SUBMITTED",
  7: "CLEARING",
  8: "SETTLED",
  9: "CANCELLED",
  10: "EXPIRED",
  11: "REJECTED",
} as const;
export const QUOTE_STATUS = { 1: "OFFERED", 2: "RESERVED", 3: "SELECTED", 4: "CONSUMED", 5: "CANCELLED", 6: "EXPIRED", 7: "REJECTED" } as const;
const RFQ_SIDE_POLICY = { 1: "BUY_ONLY", 2: "SELL_ONLY", 3: "TWO_WAY" } as const;
const RAW_RFQ_COLLECTING = 2;
const RAW_RFQ_SUBMITTED = 6;
const RAW_RFQ_SETTLED = 8;
const SELECTION_LIFETIME_SECONDS = BigInt(90);
const RISK_WINDOW_SECONDS = BigInt(300);
const SOLVER_LABEL = "Setryn MM";

export type RfqStateName = (typeof RFQ_STATUS)[keyof typeof RFQ_STATUS];
export type QuoteStateName = (typeof QUOTE_STATUS)[keyof typeof QUOTE_STATUS];

function canonical<T extends Record<number, string>>(table: T, value: number, name: string): T[keyof T] {
  const mapped = table[value as keyof T];
  if (mapped === undefined) throw new Error(`UNRECOGNIZED_${name}_${value}`);
  return mapped;
}

/** Open lifecycle states read as EXPIRED once the chain clock passes the deadline, like orders. */
const OPEN_RFQ_STATES: ReadonlySet<RfqStateName> = new Set(["INVITING", "COLLECTING", "SELECTION_LOCKED", "CAPACITY_RESERVED", "AUTHORIZED", "SUBMITTED"]);
const OPEN_QUOTE_STATES: ReadonlySet<QuoteStateName> = new Set(["OFFERED", "RESERVED"]);

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

function revertName(error: unknown): string | null {
  if (!(error instanceof Error) || typeof (error as BaseError).walk !== "function") return null;
  const reverted = (error as BaseError).walk((cause) => (cause as Error).name === "ContractFunctionRevertedError") as
    | (Error & { data?: { errorName?: string } })
    | null;
  return reverted?.data?.errorName ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Serialization

type RfqRequestWideFields = "lots" | "minimumFillLots" | "maxFeeMinor" | "deadline" | "nonce";
export type SerializedRfqRequest = Omit<OnchainPrivateRfqRequest, RfqRequestWideFields> & Record<RfqRequestWideFields, string>;
export type SerializedRfqSelection = Omit<OnchainRfqSelection, "nonce" | "deadline"> & { nonce: string; deadline: string };

export function serializeRfqRequest(request: OnchainPrivateRfqRequest): SerializedRfqRequest {
  return {
    ...request,
    lots: request.lots.toString(),
    minimumFillLots: request.minimumFillLots.toString(),
    maxFeeMinor: request.maxFeeMinor.toString(),
    deadline: request.deadline.toString(),
    nonce: request.nonce.toString(),
  };
}

function serializeSelection(selection: OnchainRfqSelection): SerializedRfqSelection {
  return { ...selection, nonce: selection.nonce.toString(), deadline: selection.deadline.toString() };
}

const invalid = (message: string) => new PublicApiError(400, "INVALID_REQUEST", message);

function field(record: Record<string, unknown>, name: string): unknown {
  if (!(name in record)) throw invalid(`${name} is missing.`);
  return record[name];
}
function bytes32Field(record: Record<string, unknown>, name: string): Hex {
  const value = field(record, name);
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length !== 66) throw invalid(`${name} must be a 32-byte hex value.`);
  return value as Hex;
}
function addressField(record: Record<string, unknown>, name: string): Address {
  const value = field(record, name);
  if (typeof value !== "string" || !isAddress(value)) throw invalid(`${name} must be an EVM address.`);
  return getAddress(value);
}
function uintField(record: Record<string, unknown>, name: string): bigint {
  const value = field(record, name);
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) throw invalid(`${name} must be a decimal integer string.`);
  return BigInt(value);
}
function smallIntField(record: Record<string, unknown>, name: string, allowed?: readonly number[]): number {
  const value = field(record, name);
  if (!Number.isSafeInteger(value) || Number(value) < 0 || (allowed && !allowed.includes(Number(value)))) {
    throw invalid(`${name} must be ${allowed ? `one of ${allowed.join(", ")}` : "a non-negative integer"}.`);
  }
  return Number(value);
}
function boolField(record: Record<string, unknown>, name: string): boolean {
  const value = field(record, name);
  if (typeof value !== "boolean") throw invalid(`${name} must be a boolean.`);
  return value;
}
function objectInput(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function parseRfqRequest(value: unknown): OnchainPrivateRfqRequest {
  const record = objectInput(value, "request");
  return {
    taker: addressField(record, "taker"),
    takerAccountId: bytes32Field(record, "takerAccountId"),
    takerOrderHash: bytes32Field(record, "takerOrderHash"),
    targetKind: smallIntField(record, "targetKind", [1, 2]) as 1 | 2,
    seriesId: bytes32Field(record, "seriesId"),
    packageId: bytes32Field(record, "packageId"),
    targetVersion: smallIntField(record, "targetVersion"),
    hasPackageLegCommitment: boolField(record, "hasPackageLegCommitment"),
    packageLegsHash: bytes32Field(record, "packageLegsHash"),
    sidePolicy: smallIntField(record, "sidePolicy", [1, 2, 3]) as 1 | 2 | 3,
    lots: uintField(record, "lots"),
    allowPartialFills: boolField(record, "allowPartialFills"),
    minimumFillLots: uintField(record, "minimumFillLots"),
    remainderPolicy: smallIntField(record, "remainderPolicy", [1, 2]) as 1 | 2,
    feeScheduleId: bytes32Field(record, "feeScheduleId"),
    feeScheduleVersion: smallIntField(record, "feeScheduleVersion"),
    maxFeeMinor: uintField(record, "maxFeeMinor"),
    riskDomainId: bytes32Field(record, "riskDomainId"),
    riskDomainVersion: smallIntField(record, "riskDomainVersion"),
    privacyModeId: bytes32Field(record, "privacyModeId"),
    executionModeId: bytes32Field(record, "executionModeId"),
    disclosurePolicyHash: bytes32Field(record, "disclosurePolicyHash"),
    eligibleMakerSetHash: bytes32Field(record, "eligibleMakerSetHash"),
    deadline: uintField(record, "deadline"),
    permittedExecutor: addressField(record, "permittedExecutor"),
    nonce: uintField(record, "nonce"),
    salt: bytes32Field(record, "salt"),
  };
}

function parseSelection(value: unknown): OnchainRfqSelection {
  const record = objectInput(value, "selection");
  return {
    rfqId: bytes32Field(record, "rfqId"),
    quoteId: bytes32Field(record, "quoteId"),
    taker: addressField(record, "taker"),
    executor: addressField(record, "executor"),
    nonce: uintField(record, "nonce"),
    deadline: uintField(record, "deadline"),
    salt: bytes32Field(record, "salt"),
  };
}

function rfqDomain(setryn: SetrynRuntime) {
  return { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.privateRfqBook } as const;
}

/** The only request the API accepts for a signed taker order: every term is derived from the order and the runtime. */
function requestForOrder(
  setryn: SetrynRuntime,
  order: OnchainPublicOrder,
  orderHash: Hex,
  nonce: bigint,
  salt: Hex,
): OnchainPrivateRfqRequest {
  return {
    taker: order.signer,
    takerAccountId: order.accountId,
    takerOrderHash: orderHash,
    targetKind: 1,
    seriesId: order.seriesId,
    packageId: EMPTY_ID,
    targetVersion: order.targetVersion,
    hasPackageLegCommitment: false,
    packageLegsHash: EMPTY_ID,
    sidePolicy: order.side === 1 ? 1 : 2,
    lots: order.lots,
    allowPartialFills: order.allowPartialFills,
    minimumFillLots: order.minimumFillLots,
    remainderPolicy: order.remainderPolicy,
    // The request must carry the order's own fee schedule: the RFQ book and clearing both check they agree.
    feeScheduleId: order.feeScheduleId,
    feeScheduleVersion: order.feeScheduleVersion,
    maxFeeMinor: order.maxFeeMinor,
    riskDomainId: setryn.riskDomainId,
    riskDomainVersion: 1,
    privacyModeId: setryn.privateRfqPrivacyModeId,
    executionModeId: setryn.privateRfqExecutionModeId,
    disclosurePolicyHash: setryn.privateRfqDisclosurePolicyHash,
    eligibleMakerSetHash: setryn.privateRfqEligibleMakerSetHash,
    deadline: order.deadline,
    permittedExecutor: setryn.atomicClearingEngine,
    nonce,
    salt,
  };
}

function requestTypedData(setryn: SetrynRuntime, request: OnchainPrivateRfqRequest) {
  return {
    domain: rfqDomain(setryn),
    types: { PrivateRfqRequest: privateRfqRequestTypedData.PrivateRfqRequest.map((entry) => ({ name: entry.name, type: entry.type })) },
    primaryType: "PrivateRfqRequest" as const,
    message: serializeRfqRequest(request),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Projection

export interface ApiRfqQuote {
  quoteId: Hex;
  rfqId: Hex;
  solver: string;
  maker: Address;
  makerAccountId: Hex;
  /** The price the requester trades at: the ask for a LONG request, the bid for a SHORT request. */
  price: number;
  priceTicks: string;
  lots: number;
  remainingLots: number;
  maxFeeUsd: number;
  maxFeeMinor: string;
  maximumLiabilityUsd: number;
  /** Whether the quote is at or better than the requester's signed limit price; only such a quote can be accepted. */
  withinLimit: boolean;
  state: QuoteStateName;
  statusCode: number;
  expiresAt: string;
  capacityExpiresAt: string;
  offeredAt: string;
}

export interface ApiRfq {
  rfqId: Hex;
  marketId: string;
  seriesId: Hex;
  accountId: Hex;
  taker: Address;
  takerOrderHash: Hex;
  side: SideName;
  sidePolicy: (typeof RFQ_SIDE_POLICY)[keyof typeof RFQ_SIDE_POLICY];
  lots: number;
  filledLots: number;
  limitPrice: number | null;
  limitPriceTicks: string | null;
  timeInForce: TimeInForceName | null;
  maxFeeUsd: number;
  state: RfqStateName;
  statusCode: number;
  selectedQuoteId: Hex | null;
  quotes: ApiRfqQuote[];
  fillIds: Hex[];
  receiptIds: Hex[];
  deadline: string;
  createdAt: string;
}

type RfqRecord = Awaited<ReturnType<typeof readRfq>>;

const rfqReadAbi = [...privateRfqBookAbi, ...parseAbi(["error UnknownRfq(bytes32 rfqId)"])] as const;

function readRfq(context: ChainContext, rfqId: Hex) {
  return context.client.readContract({ address: context.setryn.privateRfqBook, abi: rfqReadAbi, functionName: "getRfq", args: [rfqId] });
}

async function readRfqIfRegistered(context: ChainContext, rfqId: Hex): Promise<RfqRecord | null> {
  try {
    return await readRfq(context, rfqId);
  } catch (error) {
    if (revertName(error) === "UnknownRfq") return null;
    throw error;
  }
}

function rfqState(record: RfqRecord, chainTime: bigint): RfqStateName {
  const state = canonical(RFQ_STATUS, record.status, "RFQ_STATUS");
  return OPEN_RFQ_STATES.has(state) && record.request.deadline < chainTime ? "EXPIRED" : state;
}

async function loadQuotes(context: ChainContext, rfqId: Hex, record: RfqRecord, market: SetrynRuntimeMarket, limitTicks: bigint | null) {
  const { client, setryn } = context;
  const events = await client.getContractEvents({
    address: setryn.privateRfqBook,
    abi: privateRfqBookAbi,
    eventName: "MakerQuoteCommitted",
    args: { rfqId },
    fromBlock: context.deploymentBlock,
    toBlock: context.headBlock,
  });
  const quoteIds = [...new Set(events.map((event) => event.args.quoteId).filter((value): value is Hex => value != null))];
  const takerLong = record.request.sidePolicy === 1;
  const quotes = await Promise.all(
    quoteIds.map(async (quoteId): Promise<ApiRfqQuote> => {
      const quote = await client.readContract({ address: setryn.privateRfqBook, abi: privateRfqBookAbi, functionName: "getQuote", args: [quoteId] });
      const priceTicks = takerLong ? quote.quote.askPriceTicks : quote.quote.bidPriceTicks;
      const raw = canonical(QUOTE_STATUS, quote.status, "QUOTE_STATUS");
      const state = OPEN_QUOTE_STATES.has(raw) && quote.quote.deadline < context.chainTime ? "EXPIRED" : raw;
      return {
        quoteId,
        rfqId,
        solver: getAddress(quote.quote.maker) === designatedMakerAddress(setryn) ? SOLVER_LABEL : getAddress(quote.quote.maker),
        maker: getAddress(quote.quote.maker),
        makerAccountId: quote.quote.makerAccountId,
        price: ticksToPrice(market, priceTicks),
        priceTicks: priceTicks.toString(),
        lots: Number(quote.quote.lots),
        remainingLots: Number(quote.quote.lots - quote.cumulativeFilledLots),
        maxFeeUsd: minorToUsd(quote.quote.maxFeeMinor),
        maxFeeMinor: quote.quote.maxFeeMinor.toString(),
        maximumLiabilityUsd: minorToUsd(quote.quote.maximumLiability),
        withinLimit: limitTicks === null ? false : takerLong ? priceTicks <= limitTicks : priceTicks >= limitTicks,
        state,
        statusCode: quote.status,
        expiresAt: iso(quote.quote.deadline),
        capacityExpiresAt: iso(quote.quote.capacityExpiry),
        offeredAt: iso(quote.offeredAt),
      };
    }),
  );
  return quotes.sort((left, right) => (takerLong ? left.price - right.price : right.price - left.price));
}

async function projectRfq(context: ChainContext, rfqId: Hex, record: RfqRecord): Promise<ApiRfq | null> {
  const market = marketOfSeries(context.setryn, record.request.seriesId);
  if (!market) return null;
  const order = await readOrderIfRegistered(context, record.request.takerOrderHash);
  const registeredOrder = order && order.registeredAt !== BigInt(0) ? order : null;
  const limitTicks = registeredOrder ? registeredOrder.order.priceTicks : null;
  const [quotes, activity] = await Promise.all([
    loadQuotes(context, rfqId, record, market, limitTicks),
    loadAccountActivity(context, record.request.takerAccountId),
  ]);
  const links = activity.orderLinks.get(record.request.takerOrderHash.toLowerCase());
  return {
    rfqId,
    marketId: market.marketKey,
    seriesId: record.request.seriesId,
    accountId: record.request.takerAccountId,
    taker: getAddress(record.request.taker),
    takerOrderHash: record.request.takerOrderHash,
    side: sideName(record.request.sidePolicy === 1 ? 1 : 2),
    sidePolicy: canonical(RFQ_SIDE_POLICY, record.request.sidePolicy, "RFQ_SIDE_POLICY"),
    lots: Number(record.request.lots),
    filledLots: Number(record.cumulativeFilledLots),
    limitPrice: limitTicks === null ? null : ticksToPrice(market, limitTicks),
    limitPriceTicks: limitTicks === null ? null : limitTicks.toString(),
    timeInForce: registeredOrder ? timeInForceName(registeredOrder.order.timeInForce) : null,
    maxFeeUsd: minorToUsd(record.request.maxFeeMinor),
    state: rfqState(record, context.chainTime),
    statusCode: record.status,
    selectedQuoteId: record.selectedQuoteId === EMPTY_ID ? null : record.selectedQuoteId,
    quotes,
    fillIds: links?.fillIds ?? [],
    receiptIds: links?.receiptIds ?? [],
    deadline: iso(record.request.deadline),
    createdAt: iso(record.registeredAt),
  };
}

export async function loadRfq(context: ChainContext, rfqId: Hex): Promise<ApiRfq | null> {
  const record = await readRfqIfRegistered(context, rfqId);
  return record ? projectRfq(context, rfqId, record) : null;
}

/** RFQs a key may see: a key restricted to signers only sees RFQs those signers requested. */
function assertRfqVisible(key: StoredApiKey, rfq: ApiRfq): void {
  if (key.signers.length > 0 && !key.signers.includes(rfq.taker.toLowerCase())) {
    throw new PublicApiError(404, "NOT_FOUND", "No private RFQ has that id.");
  }
}

export async function getRfqForKey(context: ChainContext, key: StoredApiKey, rfqId: Hex): Promise<ApiRfq> {
  const rfq = await loadRfq(context, rfqId);
  if (!rfq) throw new PublicApiError(404, "NOT_FOUND", "No private RFQ on an onchain market has that id.");
  assertRfqVisible(key, rfq);
  return rfq;
}

/** Private RFQs requested by one account (or one signer), newest first. */
export async function loadRfqs(context: ChainContext, key: StoredApiKey, filter: { accountId: Hex } | { signer: Address }): Promise<ApiRfq[]> {
  const { client, setryn } = context;
  const events = await client.getContractEvents({
    address: setryn.privateRfqBook,
    abi: privateRfqBookAbi,
    eventName: "PrivateRfqCommitted",
    fromBlock: context.deploymentBlock,
    toBlock: context.headBlock,
  });
  const rfqIds = [...new Set(events.map((event) => event.args.rfqId).filter((value): value is Hex => value != null))];
  const records = await Promise.all(rfqIds.map(async (rfqId) => ({ rfqId, record: await readRfq(context, rfqId) })));
  const mine = records.filter(({ record }) =>
    "accountId" in filter
      ? record.request.takerAccountId.toLowerCase() === filter.accountId.toLowerCase()
      : record.request.taker.toLowerCase() === filter.signer.toLowerCase(),
  );
  const projected = (await Promise.all(mine.map(({ rfqId, record }) => projectRfq(context, rfqId, record)))).filter(
    (rfq): rfq is ApiRfq => rfq !== null && (key.signers.length === 0 || key.signers.includes(rfq.taker.toLowerCase())),
  );
  return projected.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

// ---------------------------------------------------------------------------------------------------------------
// Request

function transaction(context: ChainContext, from: Address, step: TransactionStep, description: string, to: Address, data: Hex): TransactionRequest {
  return { step, description, chainId: context.setryn.chainId, from, to, data, value: "0" };
}

export async function prepareRfq(context: ChainContext, key: StoredApiKey, input: PrepareInput) {
  const { setryn, client } = context;
  if (input.postOnly !== undefined && input.postOnly !== false) throw invalid("postOnly does not apply to a private RFQ.");
  const drafted = await draftOrder(context, key, input, "PRIVATE_RFQ");
  const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  const request = requestForOrder(setryn, drafted.order, drafted.orderHash, nonce, keccak256(stringToHex(`${drafted.orderHash}:${nonce}:rfq`)));
  const rfqId = await client.readContract({ address: setryn.privateRfqBook, abi: privateRfqBookAbi, functionName: "hashRequest", args: [request] });
  return {
    rfqId,
    orderHash: drafted.orderHash,
    accountId: drafted.accountId,
    marketId: drafted.market.marketKey,
    order: serializePublicOrder(drafted.order),
    orderTypedData: typedDataFor(context, drafted.order),
    request: serializeRfqRequest(request),
    requestTypedData: requestTypedData(setryn, request),
    chainTime: iso(context.chainTime),
    deadline: iso(drafted.deadline),
    submitWithinSeconds: Number(drafted.deadline - context.chainTime),
    preconditions: drafted.preconditions,
    requiredTransactions: drafted.requiredTransactions,
    next: "Sign orderTypedData and requestTypedData with the signer's wallet, then POST /api/v1/rfqs with { order, orderSignature, request, requestSignature } before the deadline.",
  };
}

export interface SubmitRfqInput {
  order?: unknown;
  orderSignature?: unknown;
  request?: unknown;
  requestSignature?: unknown;
}

export async function submitRfq(context: ChainContext, key: StoredApiKey, input: SubmitRfqInput) {
  const { setryn, client } = context;
  const { order, signature: orderSignature } = await verifySignedOrder(context, input.order, input.orderSignature, "orderSignature");
  assertSignerAllowed(key, order.signer);
  if (order.executionModeId.toLowerCase() !== setryn.privateRfqExecutionModeId.toLowerCase()) {
    throw new PublicApiError(409, "ORDER_REJECTED", "The order was not prepared for private RFQ execution. Use POST /rfqs/prepare.");
  }
  const market = marketOfSeries(setryn, order.seriesId);
  if (!market) throw new PublicApiError(409, "MARKET_NOT_ONCHAIN", "The order's series is not an onchain market on this deployment.");
  assertActiveFeeSchedule(context, order);
  if (order.deadline <= context.chainTime || order.deadline > context.chainTime + RISK_WINDOW_SECONDS) {
    throw new PublicApiError(409, "ORDER_REJECTED", "The order deadline is outside the live window. Prepare a fresh RFQ.");
  }
  const request = parseRfqRequest(input.request);
  if (typeof input.requestSignature !== "string" || !isHex(input.requestSignature, { strict: true })) {
    throw invalid("requestSignature must be a hex EIP-712 signature.");
  }
  const requestSignature = input.requestSignature as Hex;
  const orderHash = await hashOrder(context, order);
  // The request must be exactly the one derived from the signed order: same taker, series, side, size, fee cap,
  // deadline and the deployment's private RFQ privacy, execution and disclosure terms.
  const expected = serializeRfqRequest(requestForOrder(setryn, order, orderHash, request.nonce, request.salt));
  const received = serializeRfqRequest(request);
  const mismatched = (Object.keys(expected) as (keyof SerializedRfqRequest)[]).filter(
    (name) => String(expected[name]).toLowerCase() !== String(received[name]).toLowerCase(),
  );
  if (mismatched.length > 0) {
    throw new PublicApiError(409, "RFQ_REJECTED", `The RFQ request does not match the signed order (${mismatched.join(", ")}).`);
  }
  const validRequestSignature = await verifyTypedData({
    address: order.signer,
    domain: rfqDomain(setryn),
    types: privateRfqRequestTypedData,
    primaryType: "PrivateRfqRequest",
    message: request,
    signature: requestSignature,
  }).catch(() => false);
  if (!validRequestSignature) throw new PublicApiError(401, "INVALID_SIGNATURE", "The RFQ request signature does not recover to the order signer.");

  const [rfqId, existingOrder] = await Promise.all([
    client.readContract({ address: setryn.privateRfqBook, abi: privateRfqBookAbi, functionName: "hashRequest", args: [request] }),
    readOrderIfRegistered(context, orderHash),
  ]);
  if (existingOrder && existingOrder.registeredAt !== BigInt(0)) throw new PublicApiError(409, "RFQ_REJECTED", "The RFQ's order is already registered.");
  if (await readRfqIfRegistered(context, rfqId)) throw new PublicApiError(409, "RFQ_REJECTED", "This RFQ is already registered.");

  // The platform's own risk path: operator-side portfolio risk admission for the taker order.
  const reservation = await reserveOrderRisk(order, orderSignature, orderHash);
  const from = order.signer;
  const transactions: TransactionRequest[] = await lockOperatorTransactions(context, from, order.accountId);
  transactions.push(
    transaction(
      context,
      from,
      "BIND_RISK",
      "Bind the reserved risk admission to the signed RFQ order.",
      setryn.riskAdmissionBindingRegistry,
      encodeFunctionData({ abi: riskBindingAbi, functionName: "bindOrderRisk", args: [order, reservation.admissionId] }),
    ),
    transaction(
      context,
      from,
      "REGISTER_ORDER",
      "Register the signed RFQ order onchain.",
      setryn.orderState,
      encodeFunctionData({ abi: orderStateAbi, functionName: "registerSignedOrder", args: [order, orderSignature] }),
    ),
    transaction(
      context,
      from,
      "REGISTER_RFQ",
      "Commit the signed private RFQ request to the private RFQ book.",
      setryn.privateRfqBook,
      encodeFunctionData({ abi: privateRfqBookAbi, functionName: "registerRequest", args: [request, [], requestSignature] }),
    ),
    transaction(
      context,
      from,
      "OPEN_RFQ",
      "Open quote collection for eligible solvers.",
      setryn.privateRfqBook,
      encodeFunctionData({ abi: privateRfqBookAbi, functionName: "openCollection", args: [rfqId] }),
    ),
  );
  return {
    rfqId,
    orderHash,
    accountId: order.accountId,
    signer: order.signer,
    marketId: market.marketKey,
    status: "RISK_RESERVED" as const,
    riskAdmissionId: reservation.admissionId,
    riskReservationTransaction: reservation.transactionHash,
    validUntil: iso(order.deadline),
    transactions,
    next: "Send each transaction from the signer in order and wait for each receipt. Then POST /api/v1/rfqs/{rfqId}/quotes to invite solver quotes.",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Quotes

async function requireOwnRfq(context: ChainContext, key: StoredApiKey, rfqId: Hex) {
  const record = await readRfqIfRegistered(context, rfqId);
  const rfq = record ? await projectRfq(context, rfqId, record) : null;
  if (!record || !rfq) throw new PublicApiError(404, "NOT_FOUND", "No private RFQ on an onchain market has that id.");
  assertRfqVisible(key, rfq);
  assertSignerAllowed(key, rfq.taker);
  return { record, rfq };
}

/** The designated maker's address, or null when the deployment runs none. */
function designatedMakerAddress(setryn: SetrynRuntime): Address | null {
  const maker = signerAvailability(setryn).maker;
  return maker.available && maker.address ? getAddress(maker.address) : null;
}

function requireRole(context: ChainContext, role: "maker" | "operator"): void {
  const status = signerAvailability(context.setryn)[role];
  if (!status.available) {
    throw new PublicApiError(
      409,
      "SOLVER_UNAVAILABLE",
      role === "maker" ? "This deployment runs no designated maker to quote through the API." : "This deployment has no operator to execute the handoff.",
    );
  }
}

/**
 * Invites the eligible solvers to quote an RFQ that is collecting. Where the deployment runs a designated maker, it
 * quotes from the live reference the same way the terminal triggers it; its quote is firm and capacity-backed.
 */
export async function solicitQuotes(context: ChainContext, key: StoredApiKey, rfqId: Hex, origin: string) {
  const { record, rfq } = await requireOwnRfq(context, key, rfqId);
  if (record.status !== RAW_RFQ_COLLECTING || rfq.state !== "COLLECTING") {
    throw new PublicApiError(409, "RFQ_NOT_COLLECTING", `The RFQ is ${rfq.state}; quotes are collected only while it is COLLECTING. Send OPEN_RFQ first.`);
  }
  requireRole(context, "maker");
  const response = await makerRfqQuote(
    new Request(new URL("/api/internal/operator/rfq-quote", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqId }),
    }),
  );
  const body = (await response.json()) as { quoteId?: string; error?: string };
  if (!response.ok || typeof body.quoteId !== "string") {
    throw new PublicApiError(409, "QUOTE_UNAVAILABLE", `The solver did not quote${body.error ? `: ${body.error}` : ""}.`);
  }
  const fresh = await chainContext();
  const updated = await loadRfq(fresh, rfqId);
  return { rfqId, solicited: [{ solver: SOLVER_LABEL, quoteId: body.quoteId as Hex }], quotes: updated?.quotes ?? [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Accept

function acceptableQuote(rfq: ApiRfq, quoteId: unknown): ApiRfqQuote {
  if (typeof quoteId !== "string" || !isHex(quoteId, { strict: true }) || quoteId.length !== 66) throw invalid("quoteId must be a 32-byte hex value.");
  const quote = rfq.quotes.find((candidate) => candidate.quoteId.toLowerCase() === quoteId.toLowerCase());
  if (!quote) throw new PublicApiError(404, "NOT_FOUND", "The RFQ has no quote with that id.");
  // Only a quote whose firm capacity the solver has reserved can be selected and confirmed.
  if (quote.state !== "RESERVED") {
    throw new PublicApiError(409, "QUOTE_NOT_ACCEPTABLE", `The quote is ${quote.state}; only a live quote with reserved capacity can be accepted.`);
  }
  if (!quote.withinLimit) {
    throw new PublicApiError(409, "QUOTE_NOT_ACCEPTABLE", `The quote price ${quote.price} is outside the RFQ's limit price ${rfq.limitPrice}.`);
  }
  return quote;
}

function requireCollecting(record: RfqRecord, rfq: ApiRfq): void {
  if (record.status !== RAW_RFQ_COLLECTING || rfq.state !== "COLLECTING") {
    throw new PublicApiError(409, "RFQ_NOT_COLLECTING", `The RFQ is ${rfq.state}; a quote can be accepted only while it is COLLECTING.`);
  }
}

function selectionTypedData(setryn: SetrynRuntime, selection: OnchainRfqSelection) {
  return {
    domain: rfqDomain(setryn),
    types: { RfqSelectionAuthorization: rfqSelectionTypedData.RfqSelectionAuthorization.map((entry) => ({ name: entry.name, type: entry.type })) },
    primaryType: "RfqSelectionAuthorization" as const,
    message: serializeSelection(selection),
  };
}

export async function prepareAcceptance(context: ChainContext, key: StoredApiKey, rfqId: Hex, input: { quoteId?: unknown }) {
  const { setryn } = context;
  const { record, rfq } = await requireOwnRfq(context, key, rfqId);
  requireCollecting(record, rfq);
  const quote = acceptableQuote(rfq, input.quoteId);
  // The selection may not outlive the request or the quote it selects, so its deadline is the earliest of the three.
  const deadline = [context.chainTime + SELECTION_LIFETIME_SECONDS, record.request.deadline, BigInt(Math.floor(Date.parse(quote.expiresAt) / 1000))].reduce(
    (earliest, candidate) => (candidate < earliest ? candidate : earliest),
  );
  if (deadline <= context.chainTime) throw new PublicApiError(409, "QUOTE_NOT_ACCEPTABLE", "The quote or the RFQ has expired.");
  const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  const selection: OnchainRfqSelection = {
    rfqId,
    quoteId: quote.quoteId,
    taker: rfq.taker,
    executor: setryn.atomicClearingEngine,
    nonce,
    deadline,
    salt: keccak256(stringToHex(`${rfqId}:${quote.quoteId}:${nonce}`)),
  };
  return {
    rfqId,
    quoteId: quote.quoteId,
    quote,
    selection: serializeSelection(selection),
    typedData: selectionTypedData(setryn, selection),
    chainTime: iso(context.chainTime),
    deadline: iso(deadline),
    submitWithinSeconds: Number(deadline - context.chainTime),
    next: "Sign typedData with the signer's wallet, then POST /api/v1/rfqs/{rfqId}/accept with { selection, signature } before the deadline.",
  };
}

export async function acceptQuote(context: ChainContext, key: StoredApiKey, rfqId: Hex, input: { selection?: unknown; signature?: unknown }) {
  const { setryn, client } = context;
  const { record, rfq } = await requireOwnRfq(context, key, rfqId);
  requireCollecting(record, rfq);
  const selection = parseSelection(input.selection);
  if (typeof input.signature !== "string" || !isHex(input.signature, { strict: true })) throw invalid("signature must be a hex EIP-712 signature.");
  const signature = input.signature as Hex;
  if (selection.rfqId.toLowerCase() !== rfqId.toLowerCase()) throw new PublicApiError(409, "RFQ_REJECTED", "The selection names a different RFQ.");
  if (getAddress(selection.taker) !== rfq.taker) throw new PublicApiError(409, "RFQ_REJECTED", "The selection's taker is not the RFQ requester.");
  if (getAddress(selection.executor) !== getAddress(setryn.atomicClearingEngine)) {
    throw new PublicApiError(409, "RFQ_REJECTED", "The selection's executor is not the atomic clearing engine.");
  }
  if (selection.deadline <= context.chainTime || selection.deadline > record.request.deadline) {
    throw new PublicApiError(409, "RFQ_REJECTED", "The selection deadline is outside the live window. Prepare a fresh acceptance.");
  }
  const quote = acceptableQuote(rfq, selection.quoteId);
  const validSignature = await verifyTypedData({
    address: rfq.taker,
    domain: rfqDomain(setryn),
    types: rfqSelectionTypedData,
    primaryType: "RfqSelectionAuthorization",
    message: selection,
    signature,
  }).catch(() => false);
  if (!validSignature) throw new PublicApiError(401, "INVALID_SIGNATURE", "The selection signature does not recover to the RFQ requester.");
  // The first transaction is simulated from the requester, so a selection the book would refuse fails here, not onchain.
  await client
    .simulateContract({ account: rfq.taker, address: setryn.privateRfqBook, abi: privateRfqBookAbi, functionName: "lockSelection", args: [selection, signature] })
    .catch((error: unknown) => {
      throw new PublicApiError(409, "RFQ_REJECTED", `The private RFQ book refused the selection${revertName(error) ? `: ${revertName(error)}` : ""}.`);
    });
  const from = rfq.taker;
  const book = setryn.privateRfqBook;
  const transactions: TransactionRequest[] = [
    transaction(context, from, "LOCK_SELECTION", "Lock the signed quote selection.", book, encodeFunctionData({ abi: privateRfqBookAbi, functionName: "lockSelection", args: [selection, signature] })),
    transaction(context, from, "CONFIRM_CAPACITY", "Confirm the selected quote's firm capacity.", book, encodeFunctionData({ abi: privateRfqBookAbi, functionName: "confirmSelectedCapacity", args: [rfqId] })),
    transaction(context, from, "AUTHORIZE_SUBMISSION", "Authorize the private handoff of the selected RFQ.", book, encodeFunctionData({ abi: privateRfqBookAbi, functionName: "authorizeSubmission", args: [rfqId] })),
    transaction(
      context,
      from,
      "SUBMIT_RFQ",
      "Submit the selected RFQ to private channel clearing.",
      book,
      encodeFunctionData({ abi: privateRfqBookAbi, functionName: "submitSelectedRfq", args: [rfqId, keccak256(stringToHex(`${rfqId}:submitted`))] }),
    ),
  ];
  return {
    rfqId,
    quoteId: quote.quoteId,
    signer: rfq.taker,
    price: quote.price,
    priceTicks: quote.priceTicks,
    lots: quote.lots,
    validUntil: iso(selection.deadline),
    transactions,
    next: "Send each transaction from the signer in order and wait for each receipt. Then POST /api/v1/rfqs/{rfqId}/settle.",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Settle and cancel

/**
 * Hands a submitted RFQ to its permitted executor for atomic clearing. The executor is the platform operator, triggered
 * through the same route the terminal uses. Settling a settled RFQ returns its
 * settlement again.
 */
export async function settleRfq(context: ChainContext, key: StoredApiKey, rfqId: Hex, origin: string) {
  const { record, rfq } = await requireOwnRfq(context, key, rfqId);
  const market = marketOfSeries(context.setryn, record.request.seriesId) as SetrynRuntimeMarket;
  if (record.status === RAW_RFQ_SETTLED) return settlementOf(rfq, null);
  if (record.status !== RAW_RFQ_SUBMITTED || rfq.state !== "SUBMITTED") {
    throw new PublicApiError(409, "RFQ_NOT_SUBMITTED", `The RFQ is ${rfq.state}; send the accepted selection's transactions first.`);
  }
  requireRole(context, "operator");
  const response = await operatorRfqExecute(
    new Request(new URL("/api/internal/operator/rfq-execute", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfqId }),
    }),
  );
  const body = (await response.json()) as {
    fillId?: Hex;
    positionId?: Hex;
    transactionHash?: Hex;
    executionPriceTicks?: string;
    fillLots?: string;
    takerFeeMinor?: string;
    error?: string;
  };
  if (!response.ok || !body.fillId || !body.positionId || !body.transactionHash || body.executionPriceTicks === undefined || body.fillLots === undefined) {
    throw new PublicApiError(409, "RFQ_SETTLEMENT_FAILED", `The RFQ handoff did not clear${body.error ? `: ${body.error}` : ""}.`);
  }
  const fresh = await chainContext();
  const settled = (await loadRfq(fresh, rfqId)) ?? rfq;
  const feeMinor = BigInt(body.takerFeeMinor ?? "0");
  return settlementOf(settled, {
    fillId: body.fillId,
    positionId: body.positionId,
    transactionHash: body.transactionHash,
    filledLots: Number(body.fillLots),
    price: ticksToPrice(market, BigInt(body.executionPriceTicks)),
    priceTicks: body.executionPriceTicks,
    feesUsd: minorToUsd(feeMinor),
    feesMinor: feeMinor.toString(),
  });
}

function settlementOf(
  rfq: ApiRfq,
  clearing: {
    fillId: Hex;
    positionId: Hex;
    transactionHash: Hex;
    filledLots: number;
    price: number;
    priceTicks: string;
    feesUsd: number;
    feesMinor: string;
  } | null,
) {
  const fillId = clearing?.fillId ?? rfq.fillIds[rfq.fillIds.length - 1] ?? null;
  return {
    rfqId: rfq.rfqId,
    marketId: rfq.marketId,
    state: rfq.state,
    quoteId: rfq.selectedQuoteId,
    fillId,
    receiptId: fillId,
    positionId: clearing?.positionId ?? null,
    transactionHash: clearing?.transactionHash ?? null,
    filledLots: clearing?.filledLots ?? rfq.filledLots,
    price: clearing?.price ?? null,
    priceTicks: clearing?.priceTicks ?? null,
    feesUsd: clearing?.feesUsd ?? null,
    feesMinor: clearing?.feesMinor ?? null,
    route: "PRIVATE_RFQ" as const,
    guarantee: "Firm capacity, atomic onchain settlement",
    next: "The fill, position and receipt are in GET /api/v1/fills, /accounts/{accountId}/positions and /receipts (route PRIVATE_RFQ).",
  };
}

/**
 * Cancelling an RFQ that has not been selected (or expiring one past its deadline), prepared for the requester: the
 * book transition to send and the typed risk release that frees the collateral reserved for the taker order.
 */
export async function prepareRfqCancel(context: ChainContext, key: StoredApiKey, rfqId: Hex) {
  const { setryn, client } = context;
  const { record, rfq } = await requireOwnRfq(context, key, rfqId);
  const raw = canonical(RFQ_STATUS, record.status, "RFQ_STATUS");
  const expired = record.request.deadline < context.chainTime;
  const terminal = raw === "SETTLED" || raw === "CANCELLED" || raw === "EXPIRED" || raw === "REJECTED";
  if (terminal || (!expired && raw !== "INVITING" && raw !== "COLLECTING")) {
    throw new PublicApiError(409, "RFQ_NOT_CANCELLABLE", `The RFQ is ${rfq.state}; only an unselected or expired RFQ can be cancelled.`);
  }
  const admissionId = (await client.readContract({
    address: setryn.riskAdmissionBindingRegistry,
    abi: riskBindingAbi,
    functionName: "admissionForOrder",
    args: [rfq.takerOrderHash],
  })) as Hex;
  const transactions = [
    transaction(
      context,
      rfq.taker,
      "CANCEL_RFQ",
      expired ? "Expire the RFQ past its deadline (permissionless)." : "Cancel the RFQ before a quote is selected.",
      setryn.privateRfqBook,
      encodeFunctionData({ abi: privateRfqBookAbi, functionName: expired ? "expireRfq" : "cancelRfq", args: [rfqId] }),
    ),
  ];
  const riskRelease =
    admissionId === EMPTY_ID
      ? null
      : riskReleaseFor(context, { admissionId, orderHash: rfq.takerOrderHash, accountId: rfq.accountId, signer: rfq.taker });
  return { rfq, transactions, riskRelease };
}
