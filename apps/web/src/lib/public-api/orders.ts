import { randomUUID } from "node:crypto";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseUnits,
  stringToHex,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import {
  orderStateAbi,
  parsePublicOrder,
  publicOrderBookAbi,
  publicOrderComponents,
  publicOrderTypedData,
  riskBindingAbi,
  riskEngineAbi,
  serializePublicOrder,
  type OnchainPublicOrder,
  type SerializedPublicOrder,
} from "@/lib/internal-gateway/protocol";
import { POST as reserveRisk } from "@/app/api/internal/orders/reserve-risk/route";
import type { SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import { priceOffset } from "@/lib/internal-gateway/runtime-markets";
import { marketTradingVersions, orderFeeCapMinor } from "@/lib/internal-gateway/fee-schedule";
import { PublicApiError } from "./errors";
import {
  EMPTY_ID,
  PUBLIC_SERIES_POLICY,
  activeVersions,
  bookHead,
  deriveAccountId,
  deriveBookId,
  hashOrder,
  levelHint,
  liabilityPerLotMinor,
  loadAccount,
  loadOrder,
  marketOfSeries,
  onchainMarket,
  orderTypedDataDomain,
  readOrderIfRegistered,
  ticksToPrice,
  timeInForceName,
  vaultAbi,
  type ChainContext,
  type SideName,
  type TimeInForceName,
} from "./chain";
import { PLATFORM_MAX_ORDER_LOTS, findCatalogMarket } from "./markets";
import type { StoredApiKey } from "./store";

/**
 * Public order entry. The API never holds a user key and never sends a transaction for a user:
 *
 *   1. POST /orders/prepare builds the canonical PublicOrder with chain-time deadlines and returns its EIP-712 typed data.
 *   2. The client signs it locally with the order signer's wallet.
 *   3. POST /orders verifies the signature and runs the platform's own risk reservation path
 *      (`/api/internal/orders/reserve-risk`, the operator-side portfolio risk admission), then returns the exact
 *      transactions the signer must send, in order: lock operator approvals when missing, bindOrderRisk,
 *      registerSignedOrder, and placeSeriesOrder (resting) or matchSeries (IOC/FOK).
 *
 * Qualification, collateral, risk admission, execution and settlement all stay with the contracts and the platform's
 * risk path; nothing here can widen them.
 */

const DEFAULT_LIFETIME_SECONDS = BigInt(240);
/** The risk path refuses a reservation whose deadline is more than this far ahead of chain time. */
const RISK_WINDOW_SECONDS = BigInt(300);
const SIDES: Record<string, { side: 1 | 2; name: SideName }> = { LONG: { side: 1, name: "LONG" }, SHORT: { side: 2, name: "SHORT" } };
const TIFS: Record<string, 1 | 2 | 3 | 4> = { GTC: 1, GTD: 2, IOC: 3, FOK: 4 };

export type TransactionStep =
  | "APPROVE_LOCK_OPERATOR"
  | "BIND_RISK"
  | "REGISTER_ORDER"
  | "PLACE_ON_BOOK"
  | "MATCH"
  | "CANCEL_ORDER"
  | "SYNC_BOOK"
  | "AUTHORIZE_LIFECYCLE"
  | "EXECUTE_LIFECYCLE"
  | "REGISTER_RFQ"
  | "OPEN_RFQ"
  | "LOCK_SELECTION"
  | "CONFIRM_CAPACITY"
  | "AUTHORIZE_SUBMISSION"
  | "SUBMIT_RFQ"
  | "CANCEL_RFQ";

export interface TransactionRequest {
  step: TransactionStep;
  description: string;
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: "0";
}

export function assertSignerAllowed(key: StoredApiKey, signer: Address): void {
  if (key.signers.length > 0 && !key.signers.includes(signer.toLowerCase())) {
    throw new PublicApiError(403, "SIGNER_NOT_ALLOWED", "This API key is restricted to other signer addresses.");
  }
}

export function typedDataFor(context: ChainContext, order: OnchainPublicOrder) {
  return {
    domain: orderTypedDataDomain(context.setryn),
    types: { PublicOrder: publicOrderComponents.map((field) => ({ name: field.name, type: field.type })) },
    primaryType: "PublicOrder" as const,
    message: serializePublicOrder(order),
  };
}

export async function lockOperatorTransactions(context: ChainContext, signer: Address, accountId: Hex): Promise<TransactionRequest[]> {
  const { client, setryn } = context;
  const operators = [
    { operator: setryn.atomicClearingEngine, label: "atomic clearing engine" },
    { operator: setryn.positionEngine, label: "position engine" },
  ];
  const approvals = await Promise.all(
    operators.map(({ operator }) =>
      client.readContract({ address: setryn.collateralVault, abi: vaultAbi, functionName: "isLockOperator", args: [accountId, operator] }),
    ),
  );
  return operators
    .filter((_, index) => !approvals[index])
    .map(({ operator, label }) => ({
      step: "APPROVE_LOCK_OPERATOR",
      description: `Approve the ${label} to lock collateral on your account (one-time).`,
      chainId: setryn.chainId,
      from: signer,
      to: setryn.collateralVault,
      data: encodeFunctionData({ abi: vaultAbi, functionName: "setLockOperator", args: [accountId, operator, true] }),
      value: "0",
    }));
}

export interface PrepareInput {
  signer?: unknown;
  marketId?: unknown;
  side?: unknown;
  lots?: unknown;
  limitPrice?: unknown;
  timeInForce?: unknown;
  expiresAt?: unknown;
  postOnly?: unknown;
  maxFeeUsd?: unknown;
}

const INT128_MIN = -(BigInt(1) << BigInt(127));
const INT128_MAX = (BigInt(1) << BigInt(127)) - BigInt(1);

/**
 * A package price on the market's onchain grid: (price - priceOffset) x priceScale must be a whole number of ticks. The
 * offset is the range forward's floor on a schema 11 market and zero on older runtimes.
 */
export function priceTicksFor(market: SetrynRuntimeMarket, price: unknown, name = "limitPrice"): bigint {
  if (typeof price !== "number" || !Number.isFinite(price)) {
    throw new PublicApiError(400, "INVALID_REQUEST", `${name} must be a finite number.`);
  }
  const offset = priceOffset(market);
  const scaled = (price - offset) * market.priceScale;
  const ticks = Math.round(scaled);
  if (Math.abs(scaled - ticks) > 1e-6) {
    throw new PublicApiError(
      400,
      "INVALID_REQUEST",
      `${name} ${price} is off the ${market.marketKey} price grid: prices are quoted in steps of ${1 / market.priceScale}${offset ? ` from ${offset}` : ""}.`,
    );
  }
  const priceTicks = BigInt(ticks);
  if (priceTicks < INT128_MIN || priceTicks > INT128_MAX) throw new PublicApiError(400, "INVALID_REQUEST", `${name} is out of range.`);
  return priceTicks;
}

/** The onchain market behind a catalog market id; an unlisted or suspended market cannot take an order. */
export function tradableMarket(context: ChainContext, marketId: unknown): SetrynRuntimeMarket {
  const market = typeof marketId === "string" ? findCatalogMarket(marketId) : null;
  if (!market) throw new PublicApiError(404, "NOT_FOUND", "No market has that id.");
  const onchain = onchainMarket(context.setryn, market.id);
  if (!onchain) {
    throw new PublicApiError(409, "MARKET_NOT_ONCHAIN", `${market.id} is not listed onchain on this deployment and cannot be traded through the API.`);
  }
  if (market.qualification === "SUSPENDED") throw new PublicApiError(409, "ORDER_REJECTED", "The market is suspended.");
  return onchain;
}

export interface DraftedOrder {
  market: SetrynRuntimeMarket;
  order: OnchainPublicOrder;
  orderHash: Hex;
  accountId: Hex;
  deadline: bigint;
  preconditions: {
    accountExists: boolean;
    availableCollateralMinor: string;
    requiredCollateralMinor: string;
    sufficientCollateral: boolean;
    lockOperatorsApproved: boolean;
  };
  requiredTransactions: TransactionRequest[];
}

/**
 * Builds the canonical PublicOrder for one onchain market: its series, its price grid, its lot cap, its collateral per
 * lot, and chain-time deadlines. A direct-book order carries the public execution mode; the taker order behind a private
 * RFQ carries the private RFQ execution mode.
 */
export async function draftOrder(
  context: ChainContext,
  key: StoredApiKey,
  input: PrepareInput,
  route: "DIRECT_BOOK" | "PRIVATE_RFQ",
): Promise<DraftedOrder> {
  const { setryn } = context;
  if (typeof input.signer !== "string" || !isAddress(input.signer)) throw new PublicApiError(400, "INVALID_REQUEST", "signer must be an EVM address.");
  const signer = getAddress(input.signer);
  assertSignerAllowed(key, signer);
  const market = tradableMarket(context, input.marketId);
  const side = typeof input.side === "string" ? SIDES[input.side] : undefined;
  if (!side) throw new PublicApiError(400, "INVALID_REQUEST", "side must be LONG or SHORT.");
  const maxLots = Math.min(PLATFORM_MAX_ORDER_LOTS, market.maxOrderLots);
  if (!Number.isInteger(input.lots) || Number(input.lots) < 1 || Number(input.lots) > maxLots) {
    throw new PublicApiError(400, "INVALID_REQUEST", `lots must be an integer from 1 to ${maxLots} on ${market.marketKey}.`);
  }
  const lots = BigInt(input.lots as number);
  const priceTicks = priceTicksFor(market, input.limitPrice);
  const versions = activeVersions(context, market);
  if (context.feeSchedule.source === "CHAIN" && !versions.tradable) {
    throw new PublicApiError(409, "FEE_SCHEDULE_CHANGED", `${market.marketKey} is moving to fee schedule version ${context.feeSchedule.version}. Retry shortly.`);
  }
  const tifName = typeof input.timeInForce === "string" ? input.timeInForce : route === "PRIVATE_RFQ" ? "IOC" : "GTC";
  const timeInForce = TIFS[tifName];
  if (!timeInForce) throw new PublicApiError(400, "INVALID_REQUEST", "timeInForce must be GTC, GTD, IOC or FOK.");
  // The RFQ book accepts a no-partial-fill request only when its remainder stays open, which a fill-or-kill order's
  // cancel-remainder policy contradicts, so the request would revert at registration.
  if (route === "PRIVATE_RFQ" && timeInForce === 4) {
    throw new PublicApiError(400, "INVALID_REQUEST", "FOK is not available for a private RFQ. Use IOC (the default), GTC or GTD; quotes are firm for the full size.");
  }
  const postOnly = input.postOnly === true;
  if (postOnly && (route === "PRIVATE_RFQ" || timeInForce === 3 || timeInForce === 4)) {
    throw new PublicApiError(400, "INVALID_REQUEST", "postOnly applies only to resting GTC or GTD book orders.");
  }

  let lifetime = DEFAULT_LIFETIME_SECONDS;
  if (timeInForce === 2) {
    const requested = typeof input.expiresAt === "string" ? Date.parse(input.expiresAt) : Number.NaN;
    const nowMs = Number(context.chainTime) * 1000;
    if (!Number.isFinite(requested) || requested <= nowMs) {
      throw new PublicApiError(400, "INVALID_REQUEST", "GTD orders need an expiresAt in the future on the chain clock.");
    }
    const requestedLifetime = BigInt(Math.max(1, Math.floor((requested - nowMs) / 1000)));
    lifetime = requestedLifetime < lifetime ? requestedLifetime : lifetime;
  }
  const deadline = context.chainTime + lifetime;

  let maxFeeMinor: bigint;
  if (input.maxFeeUsd !== undefined) {
    if (typeof input.maxFeeUsd !== "number" || !Number.isFinite(input.maxFeeUsd) || input.maxFeeUsd < 0) {
      throw new PublicApiError(400, "INVALID_REQUEST", "maxFeeUsd must be a non-negative number.");
    }
    maxFeeMinor = parseUnits(input.maxFeeUsd.toFixed(6), 6);
  } else {
    // Twice the larger of the maker and taker charges under the active schedule on the order's full consideration
    // (lots x price ticks x the market's tick size), so a better fill price or a resting fill still fits the cap.
    const absTicks = priceTicks < BigInt(0) ? -priceTicks : priceTicks;
    const consideration = lots * absTicks * BigInt(market.tickSizeMinor);
    maxFeeMinor = orderFeeCapMinor(context.feeSchedule, consideration, "EITHER") * BigInt(2);
  }
  if (maxFeeMinor < BigInt(1)) maxFeeMinor = BigInt(1);

  const accountId = await deriveAccountId(context, signer);
  const nonce = BigInt(Date.now()) * BigInt(1_000_000) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  const salt = keccak256(stringToHex(`${signer}:${nonce}:${market.marketKey}:${randomUUID()}`));
  const guarantee = route === "PRIVATE_RFQ" ? "Firm capacity, atomic onchain settlement" : "Package atomic";
  const policyContextHash = keccak256(stringToHex(`${market.marketKey}:${route}:${side.name}:${tifName}:${guarantee}`));
  const order: OnchainPublicOrder = {
    signer,
    accountId,
    policyId: PUBLIC_SERIES_POLICY,
    policyContextHash,
    actionId: setryn.enterActionId,
    targetKind: 1,
    seriesId: market.seriesId,
    packageId: EMPTY_ID,
    targetVersion: versions.seriesVersion,
    side: side.side,
    lots,
    priceTicks,
    timeInForce,
    deadline,
    executionModeId: route === "PRIVATE_RFQ" ? setryn.privateRfqExecutionModeId : setryn.executionModeId,
    feeScheduleId: setryn.feeScheduleId,
    feeScheduleVersion: versions.feeScheduleVersion,
    maxFeeMinor,
    recipient: signer,
    permittedExecutor: setryn.atomicClearingEngine,
    nonce,
    salt,
    allowPartialFills: timeInForce !== 4,
    minimumFillLots: BigInt(1),
    remainderPolicy: timeInForce === 3 || timeInForce === 4 ? 2 : 1,
    postOnly,
    reduceOnly: false,
  };
  const [orderHash, account, approvals] = await Promise.all([
    hashOrder(context, order),
    loadAccount(context, accountId),
    lockOperatorTransactions(context, signer, accountId),
  ]);
  const requiredCollateralMinor = lots * liabilityPerLotMinor(market, side.side);
  return {
    market,
    order,
    orderHash,
    accountId,
    deadline,
    preconditions: {
      accountExists: account.exists,
      availableCollateralMinor: account.availableMinor,
      requiredCollateralMinor: requiredCollateralMinor.toString(),
      sufficientCollateral: BigInt(account.availableMinor) >= requiredCollateralMinor,
      lockOperatorsApproved: approvals.length === 0,
    },
    requiredTransactions: approvals,
  };
}

export async function prepareOrder(context: ChainContext, key: StoredApiKey, input: PrepareInput) {
  const drafted = await draftOrder(context, key, input, "DIRECT_BOOK");
  return {
    orderHash: drafted.orderHash,
    accountId: drafted.accountId,
    marketId: drafted.market.marketKey,
    order: serializePublicOrder(drafted.order),
    typedData: typedDataFor(context, drafted.order),
    chainTime: new Date(Number(context.chainTime) * 1000).toISOString(),
    deadline: new Date(Number(drafted.deadline) * 1000).toISOString(),
    submitWithinSeconds: Number(drafted.deadline - context.chainTime),
    preconditions: drafted.preconditions,
    requiredTransactions: drafted.requiredTransactions,
    next: "Sign typedData with the signer's wallet (eth_signTypedData_v4 / viem signTypedData), then POST /api/v1/orders with { order, signature } before the deadline.",
  };
}

/** Relays a signed order to the platform's risk path; returns the reserved admission and its transaction. */
export async function reserveOrderRisk(order: OnchainPublicOrder, signature: Hex, orderHash: Hex) {
  const reservation = await reserveRisk(
    new Request("http://localhost/api/internal/orders/reserve-risk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: serializePublicOrder(order), signature, orderHash }),
    }),
  );
  const reservationBody = (await reservation.json()) as { admissionId?: string; transactionHash?: string; error?: string };
  if (!reservation.ok || typeof reservationBody.admissionId !== "string") {
    throw new PublicApiError(
      422,
      "RISK_RESERVATION_FAILED",
      `Risk admission refused the order${reservationBody.error ? `: ${reservationBody.error}` : ""}. Check collateral and limits.`,
    );
  }
  return { admissionId: reservationBody.admissionId as Hex, transactionHash: (reservationBody.transactionHash ?? null) as Hex | null };
}

/** Parses a serialized PublicOrder and its signature and verifies the signature against order.signer. */
export async function verifySignedOrder(context: ChainContext, orderInput: unknown, signatureInput: unknown, name = "signature") {
  let order: OnchainPublicOrder;
  try {
    order = parsePublicOrder(orderInput);
  } catch {
    throw new PublicApiError(400, "INVALID_REQUEST", "order must be the serialized PublicOrder returned by the prepare call.");
  }
  if (typeof signatureInput !== "string" || !isHex(signatureInput, { strict: true })) {
    throw new PublicApiError(400, "INVALID_REQUEST", `${name} must be a hex EIP-712 signature.`);
  }
  const signature = signatureInput as Hex;
  const validSignature = await verifyTypedData({
    address: order.signer,
    domain: orderTypedDataDomain(context.setryn),
    types: publicOrderTypedData,
    primaryType: "PublicOrder",
    message: order,
    signature,
  }).catch(() => false);
  if (!validSignature) throw new PublicApiError(401, "INVALID_SIGNATURE", "The order signature does not recover to order.signer.");
  return { order, signature };
}

/**
 * Clearing charges only under the open fee schedule version, so an order signed under another schedule or a retired
 * version could never fill; it is refused before any risk is reserved.
 */
export function assertActiveFeeSchedule(context: ChainContext, order: OnchainPublicOrder): void {
  if (order.feeScheduleId.toLowerCase() !== context.setryn.feeScheduleId.toLowerCase()) {
    throw new PublicApiError(409, "ORDER_REJECTED", "The order names a fee schedule this deployment does not use.");
  }
  if (context.feeSchedule.source !== "CHAIN") return;
  const versions = marketTradingVersions(context.feeSchedule, order.seriesId);
  if (!versions.tradable || order.feeScheduleVersion !== versions.feeScheduleVersion || order.targetVersion !== versions.seriesVersion) {
    throw new PublicApiError(
      409,
      "FEE_SCHEDULE_CHANGED",
      `The order signs series version ${order.targetVersion} under fee schedule version ${order.feeScheduleVersion}; the market trades series version ${versions.seriesVersion} under fee schedule version ${context.feeSchedule.version}. Prepare a fresh order.`,
    );
  }
}

export interface SubmitInput {
  order?: unknown;
  signature?: unknown;
}

export async function submitSignedOrder(context: ChainContext, key: StoredApiKey, input: SubmitInput) {
  const { setryn, client } = context;
  const { order, signature } = await verifySignedOrder(context, input.order, input.signature);
  assertSignerAllowed(key, order.signer);
  if (order.executionModeId.toLowerCase() !== setryn.executionModeId.toLowerCase()) {
    throw new PublicApiError(409, "ORDER_REJECTED", "Only direct public book orders are accepted by /orders. Private RFQ orders go through /rfqs.");
  }
  const market = marketOfSeries(setryn, order.seriesId);
  if (!market) throw new PublicApiError(409, "MARKET_NOT_ONCHAIN", "The order's series is not an onchain market on this deployment.");
  const tif: TimeInForceName = timeInForceName(order.timeInForce);
  assertActiveFeeSchedule(context, order);
  if (order.deadline <= context.chainTime || order.deadline > context.chainTime + RISK_WINDOW_SECONDS) {
    throw new PublicApiError(409, "ORDER_REJECTED", "The order deadline is outside the live window. Prepare a fresh order.");
  }

  const orderHash = await hashOrder(context, order);
  const existing = await readOrderIfRegistered(context, orderHash);
  if (existing && existing.registeredAt !== BigInt(0)) throw new PublicApiError(409, "ORDER_REJECTED", "This order is already registered.");

  // Check marketability before any risk is reserved, so a refused order leaves nothing behind.
  const bookId = deriveBookId(setryn, market, { seriesVersion: order.targetVersion, feeScheduleVersion: order.feeScheduleVersion });
  const makerSide: 1 | 2 = order.side === 1 ? 2 : 1;
  const head = await bookHead(context, bookId, makerSide);
  const crosses = (priceTicks: bigint) => (order.side === 1 ? order.priceTicks >= priceTicks : order.priceTicks <= priceTicks);
  const resting = tif === "GTC" || tif === "GTD";
  if (resting && head && head.live && crosses(head.bookOrder.priceTicks)) {
    throw new PublicApiError(
      409,
      "WOULD_CROSS",
      order.postOnly ? "A post-only order would cross the book." : "A resting order would cross the book. Use IOC or FOK to take liquidity.",
    );
  }
  if (!resting) {
    if (!head || !head.live) throw new PublicApiError(409, "NOT_MARKETABLE", "There is no live liquidity on the opposite side of the book.");
    if (!crosses(head.bookOrder.priceTicks)) throw new PublicApiError(409, "NOT_MARKETABLE", "The limit price does not cross the best opposite level.");
    if (tif === "FOK" && head.bookOrder.remainingLots < order.lots) {
      throw new PublicApiError(409, "NOT_MARKETABLE", "The best level cannot fill the whole fill-or-kill quantity.");
    }
  }

  // The platform's own risk path: operator-side portfolio risk admission for the signed order.
  const reservation = await reserveOrderRisk(order, signature, orderHash);
  const admissionId = reservation.admissionId;
  const transactions: TransactionRequest[] = await lockOperatorTransactions(context, order.signer, order.accountId);
  const tx = (step: TransactionStep, description: string, to: Address, data: Hex): TransactionRequest => ({
    step,
    description,
    chainId: setryn.chainId,
    from: order.signer,
    to,
    data,
    value: "0",
  });
  transactions.push(
    tx(
      "BIND_RISK",
      "Bind the reserved risk admission to the signed order.",
      setryn.riskAdmissionBindingRegistry,
      encodeFunctionData({ abi: riskBindingAbi, functionName: "bindOrderRisk", args: [order, admissionId] }),
    ),
    tx(
      "REGISTER_ORDER",
      "Register the signed order onchain.",
      setryn.orderState,
      encodeFunctionData({ abi: orderStateAbi, functionName: "registerSignedOrder", args: [order, signature] }),
    ),
  );
  if (resting) {
    const hint = await levelHint(context, bookId, order.side, order.priceTicks);
    transactions.push(
      tx(
        "PLACE_ON_BOOK",
        "Rest the registered order on the direct book.",
        setryn.publicOrderBook,
        encodeFunctionData({ abi: publicOrderBookAbi, functionName: "placeSeriesOrder", args: [orderHash, hint] }),
      ),
    );
  } else if (head) {
    const makerAdmissionId = await client.readContract({
      address: setryn.riskAdmissionBindingRegistry,
      abi: riskBindingAbi,
      functionName: "admissionForOrder",
      args: [head.orderHash],
    });
    if (makerAdmissionId === EMPTY_ID) throw new PublicApiError(409, "NOT_MARKETABLE", "The best maker order has no risk admission.");
    const [takerAdmission, makerAdmission] = await Promise.all([
      client.readContract({ address: setryn.portfolioRiskEngine, abi: riskEngineAbi, functionName: "getAdmission", args: [admissionId] }),
      client.readContract({ address: setryn.portfolioRiskEngine, abi: riskEngineAbi, functionName: "getAdmission", args: [makerAdmissionId] }),
    ]);
    const takerIsLong = order.side === 1;
    const fillLots = order.lots < head.bookOrder.remainingLots ? order.lots : head.bookOrder.remainingLots;
    const zeroOrderFunding = { terminalLiabilityLockId: EMPTY_ID, considerationLockId: EMPTY_ID } as const;
    const zeroFeeFunding = { consumptionId: EMPTY_ID, chargeLockId: EMPTY_ID, budgetLockId: EMPTY_ID } as const;
    const proposal = {
      matchData: {
        takerOrderHash: orderHash,
        makerOrderHash: head.orderHash,
        fillLots,
        executionPriceTicks: head.bookOrder.priceTicks,
        longAdmissionId: takerIsLong ? admissionId : makerAdmissionId,
        longAdmissionResultHash: takerIsLong ? takerAdmission.resultHash : makerAdmission.resultHash,
        shortAdmissionId: takerIsLong ? makerAdmissionId : admissionId,
        shortAdmissionResultHash: takerIsLong ? makerAdmission.resultHash : takerAdmission.resultHash,
        takerFunding: zeroOrderFunding,
        makerFunding: zeroOrderFunding,
        takerFeeFunding: zeroFeeFunding,
        makerFeeFunding: zeroFeeFunding,
      },
      payoffTerms: market.payoffTerms,
      channelKind: 1,
    } as const;
    transactions.push(
      tx(
        "MATCH",
        `Match against the best ${makerSide === 2 ? "offer" : "bid"} on ${market.marketKey} (${fillLots} lots at ${ticksToPrice(market, head.bookOrder.priceTicks)}). Built from the book at submission; if the book moves first the match reverts and nothing fills.`,
        setryn.publicOrderBook,
        encodeFunctionData({ abi: publicOrderBookAbi, functionName: "matchSeries", args: [bookId, [proposal]] }),
      ),
    );
  }
  return {
    orderHash,
    accountId: order.accountId,
    signer: order.signer,
    marketId: market.marketKey,
    status: "RISK_RESERVED" as const,
    riskAdmissionId: admissionId,
    riskReservationTransaction: reservation.transactionHash,
    validUntil: new Date(Number(order.deadline) * 1000).toISOString(),
    transactions,
    next: "Send each transaction from the signer in order and wait for each receipt. Then poll GET /api/v1/orders/{orderHash}.",
  };
}

export type { SerializedPublicOrder };

/**
 * Cancelling a working order, prepared for the signer to execute. The API never cancels on anyone's behalf: it returns
 * the order-state cancellation and the book sync to send, and the typed risk-release message whose signature the
 * signer submits to `cancelBoundAdmission` so the reserved collateral is freed.
 */
export async function prepareCancel(context: ChainContext, key: StoredApiKey, orderHash: Hex) {
  const { client, setryn } = context;
  const order = await loadOrder(context, orderHash);
  if (!order) throw new PublicApiError(404, "NOT_FOUND", "No registered order on an onchain market has that hash.");
  assertSignerAllowed(key, order.signer);
  if (order.state !== "WORKING" && order.state !== "PARTIALLY_FILLED") {
    throw new PublicApiError(409, "ORDER_NOT_WORKING", `The order is ${order.state} and cannot be cancelled.`);
  }
  const admissionId = (await client.readContract({
    address: setryn.riskAdmissionBindingRegistry,
    abi: riskBindingAbi,
    functionName: "admissionForOrder",
    args: [orderHash],
  })) as Hex;
  const transactions: TransactionRequest[] = [
    {
      step: "CANCEL_ORDER",
      description: "Cancel the signed order in order state.",
      chainId: setryn.chainId,
      from: order.signer,
      to: setryn.orderState,
      data: encodeFunctionData({ abi: orderStateAbi, functionName: "cancelOrder", args: [orderHash] }),
      value: "0",
    },
    {
      step: "SYNC_BOOK",
      description: "Remove the cancelled order from the public book (permissionless).",
      chainId: setryn.chainId,
      from: order.signer,
      to: setryn.publicOrderBook,
      data: encodeFunctionData({ abi: publicOrderBookAbi, functionName: "syncOrder", args: [orderHash] }),
      value: "0",
    },
  ];
  const riskRelease =
    admissionId === EMPTY_ID ? null : riskReleaseFor(context, { admissionId, orderHash, accountId: order.accountId, signer: order.signer });
  return { order, transactions, riskRelease };
}

/**
 * The typed risk-release message a signer signs and submits to `cancelBoundAdmission` on the risk binding registry, so
 * the collateral reserved for an order that will not fill is freed.
 */
export function riskReleaseFor(context: ChainContext, input: { admissionId: Hex; orderHash: Hex; accountId: Hex; signer: Address }) {
  const { setryn } = context;
  const nonce = BigInt(`0x${randomUUID().replaceAll("-", "")}`);
  return {
    description: "Sign this message, then call cancelBoundAdmission(message, signature) on the risk binding registry to release the reserved collateral.",
    to: setryn.riskAdmissionBindingRegistry,
    functionName: "cancelBoundAdmission",
    typedData: {
      domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.riskAdmissionBindingRegistry },
      types: {
        SetrynRiskAdmissionCancellationV1: [
          { name: "admissionId", type: "bytes32" },
          { name: "orderHash", type: "bytes32" },
          { name: "accountId", type: "bytes32" },
          { name: "signer", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "cancellationReference", type: "bytes32" },
        ],
      },
      primaryType: "SetrynRiskAdmissionCancellationV1" as const,
      message: {
        admissionId: input.admissionId,
        orderHash: input.orderHash,
        accountId: input.accountId,
        signer: input.signer,
        nonce: nonce.toString(),
        deadline: (context.chainTime + DEFAULT_LIFETIME_SECONDS).toString(),
        cancellationReference: keccak256(stringToHex(`${input.orderHash}:${nonce}`)),
      },
    },
  };
}
