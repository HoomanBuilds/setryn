import type { JsonObject } from "@setryn/internal-schemas";
import type { Hex } from "viem";

import type { MakerQuoteExecutionPort } from "../ports.ts";
import type { OperatorExecutionContext, OperatorExecutionResult, QuoteCycleIntent } from "../types.ts";
import {
  ensureFreeCollateral,
  ensureTradingAccount,
  hashOrder,
  isLiveOrderStatus,
  levelHint,
  readBookSide,
  reserveOrderRisk,
  signOrder,
  withdrawOwnOrder,
} from "./book.ts";
import { transactionSummary, type OperatorChainClient, type OperatorTransaction } from "./chain.ts";
import { requireMarketById, type OperatorMarket } from "./deployment.ts";
import { describeChainError, OperatorExecutionError } from "./errors.ts";
import { feeChargeMinor, readActiveFeeSchedule, readActiveSeriesVersions, requireOpenFeeSchedule } from "./fees.ts";
import { assertIntentEnvironment, completed, transactionHashes } from "./results.ts";
import { PayloadReader } from "./payload.ts";
import {
  abis,
  deriveSeriesBookId,
  deterministicSalt,
  deterministicWord,
  enumName,
  makerPublicPolicyContext,
  orderStatusNames,
  publicSeriesPolicy,
  zeroId,
  type OrderSide,
  type PublicOrder,
} from "./protocol.ts";

/**
 * Accepted `quoteRequest` for a quote-cycle intent (integers as JSON numbers or decimal strings). The intent's
 * `marketId` picks the market: any market of the deployment, each quoted on its own book, grid and economics.
 * {
 *   referencePriceTicks?: integer,       // mid in the market's price ticks (price x priceScale), or ...
 *   referencePrice?: decimal string,     // ... the mid as a package price, converted with the market's priceScale
 *   gridTicks?: integer >= 1,            // price grid in ticks (catalog tickSize x priceScale); default 1
 *   halfSpreadTicks?: integer >= 1,      // default 10 grid steps' worth of ticks; bid = mid - half, ask = mid + half,
 *                                        // then the bid snaps down and the ask up onto the grid
 *   lots?: integer, bidLots?, askLots?,  // default and cap: the market's maxOrderLots
 *   ttlSeconds?: 30..300,                // default 240, measured on chain time
 *   refreshMarginSeconds?: integer,      // own quotes expiring sooner than this are replaced (default 30)
 *   maxFeeMinor?: integer,               // default: the active schedule's maker charge on the quote's consideration
 *   sides?: "both" | "bid" | "ask"       // default "both"
 * }
 * Each side is sized to the account's free collateral at the market's per-lot debit cap. On the local devnet a
 * shortfall is topped up from the faucet; elsewhere a side is shrunk (or skipped) to what the account can back.
 */
export interface MakerQuotePortOptions {
  /** Devnet faucet amount minted into a missing maker account; null requires a pre-provisioned account. */
  readonly accountFundingMinor?: bigint | null;
}

interface SideTarget {
  readonly side: OrderSide;
  readonly label: "bid" | "ask";
  readonly priceTicks: bigint;
  readonly lots: bigint;
}

export class ChainMakerQuoteExecutionPort implements MakerQuoteExecutionPort {
  readonly #client: OperatorChainClient;
  readonly #fundingMinor: bigint | null;
  readonly #plans = new Map<string, Map<OrderSide, PublicOrder>>();
  readonly #results = new Map<string, OperatorExecutionResult>();

  constructor(client: OperatorChainClient, options: MakerQuotePortOptions = {}) {
    this.#client = client;
    this.#fundingMinor = options.accountFundingMinor === undefined
      ? client.environment === "local" ? 250_000_000_000n : null
      : options.accountFundingMinor;
  }

  async executeQuoteCycle(intent: QuoteCycleIntent, context: OperatorExecutionContext): Promise<OperatorExecutionResult> {
    assertIntentEnvironment(this.#client, intent.environment, context);
    const cached = this.#results.get(intent.idempotencyKey);
    if (cached) return replayed(cached);
    try {
      const result = await this.#run(intent);
      this.#results.set(intent.idempotencyKey, result);
      return result;
    } catch (error) {
      throw describeChainError(error, `quote cycle ${intent.idempotencyKey}`);
    }
  }

  async #run(intent: QuoteCycleIntent): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    if (!client.isDeploymentOperator()) {
      throw new OperatorExecutionError("precondition", "maker quoting reserves risk through the deployment operator's risk-consumer role");
    }
    const market = requireMarketById(deployment, intent.marketId);
    if (Date.parse(intent.expiresAt) <= Date.now()) {
      throw new OperatorExecutionError("precondition", `quote intent expired at ${intent.expiresAt} before execution`);
    }
    const request = new PayloadReader(intent.quoteRequest, "quoteRequest");
    const mid = referenceTicks(request, market);
    const grid = request.bigint("gridTicks", { fallback: 1n, min: 1n, max: mid });
    const halfSpread = request.bigint("halfSpreadTicks", { fallback: 10n * grid, min: 1n, max: mid - 1n });
    const maxLots = market.economics.maxOrderLots;
    const lots = request.bigint("lots", { fallback: maxLots, min: 1n, max: maxLots });
    const ttl = BigInt(request.integer("ttlSeconds", { fallback: 240, min: 30, max: 300 }));
    const refreshMargin = BigInt(request.integer("refreshMarginSeconds", { fallback: 30, min: 0, max: 240 }));
    // An explicit cap wins; otherwise each quote caps at the maker charge the active schedule puts on its consideration.
    const explicitMaxFeeMinor = request.has("maxFeeMinor") ? request.bigint("maxFeeMinor", { min: 1n }) : null;
    const sides = request.oneOf("sides", ["both", "bid", "ask"] as const, "both");
    const bidTicks = ((mid - halfSpread) / grid) * grid;
    const askTicks = ceilDiv(mid + halfSpread, grid) * grid;
    if (bidTicks <= 0n) throw new OperatorExecutionError("invalid-payload", `bid ${bidTicks} is not a positive price on a ${grid}-tick grid`);
    const targets: SideTarget[] = [];
    if (sides !== "ask") targets.push({ side: 1, label: "bid", priceTicks: bidTicks, lots: request.bigint("bidLots", { fallback: lots, min: 1n, max: maxLots }) });
    if (sides !== "bid") targets.push({ side: 2, label: "ask", priceTicks: askTicks, lots: request.bigint("askLots", { fallback: lots, min: 1n, max: maxLots }) });

    const seriesId = market.seriesId;
    const now = await client.chainNow();
    // Quotes sign the series' active version and the fee schedule version its market version names.
    const versions = await readActiveSeriesVersions(client, seriesId);
    const open = versions.active && await client.read("read series trading status", (reader) =>
      reader.readContract({
        address: deployment.addresses.seriesRegistry,
        abi: abis.seriesRegistry,
        functionName: "isOpenForNewRisk",
        args: [seriesId, versions.seriesVersion, Number(now / 86_400n)],
      }),
    );
    if (!open) {
      return completed({ quoted: false, marketKey: market.marketKey, reason: "series is not open for new risk at chain time", chainTime: now.toString() }, []);
    }

    const fees = requireOpenFeeSchedule(await readActiveFeeSchedule(client));
    if (fees.source === "CHAIN" && versions.feeScheduleVersion !== fees.version) {
      return completed({
        quoted: false,
        marketKey: market.marketKey,
        reason: `series v${versions.seriesVersion} is on fee schedule v${versions.feeScheduleVersion}; v${fees.version} is active, so nothing on it can clear yet`,
        chainTime: now.toString(),
      }, []);
    }
    const account = await ensureTradingAccount(client, { fundingMinor: this.#fundingMinor });
    const transactions: OperatorTransaction[] = [...account.transactions];
    const bookId = deriveSeriesBookId(deployment, seriesId, versions);
    const posted: JsonObject[] = [];
    const kept: JsonObject[] = [];
    const withdrawn: JsonObject[] = [];
    const skipped: JsonObject[] = [];
    // A plan signed under a fee schedule version that is no longer active could never clear, so it is dropped.
    const previousPlan = this.#plans.get(intent.idempotencyKey);
    const plan = previousPlan && [...previousPlan.values()].every((order) =>
      order.feeScheduleVersion === versions.feeScheduleVersion && order.targetVersion === versions.seriesVersion)
      ? previousPlan
      : new Map<OrderSide, PublicOrder>();
    this.#plans.set(intent.idempotencyKey, plan);

    // Withdraw stale own quotes on both sides before posting, so a moved mid never crosses our own old quote.
    const toPost: SideTarget[] = [];
    for (const target of targets) {
      const planned = plan.get(target.side);
      const plannedHash = planned ? await hashOrder(client, planned) : null;
      const resting = await readBookSide(client, bookId, target.side);
      let keep: Hex | null = null;
      for (const order of resting) {
        if (order.signer !== client.address || order.orderHash === plannedHash) continue;
        const fresh = isLiveOrderStatus(order.status) && order.deadline > now + refreshMargin;
        if (!planned && keep === null && fresh && order.priceTicks === target.priceTicks) {
          keep = order.orderHash;
          kept.push({ side: target.label, orderHash: order.orderHash, priceTicks: order.priceTicks.toString(), deadline: order.deadline.toString() });
          continue;
        }
        const withdrawal = await withdrawOwnOrder(client, order.orderHash, `withdraw stale ${target.label}`);
        transactions.push(...withdrawal);
        withdrawn.push({
          side: target.label,
          orderHash: order.orderHash,
          priceTicks: order.priceTicks.toString(),
          status: enumName(orderStatusNames, order.status),
          transactions: transactionHashes(withdrawal),
        });
      }
      if (keep === null) toPost.push(target);
    }

    // Size unplanned sides to free collateral at this market's per-lot debit cap before any risk is reserved.
    const sized: SideTarget[] = [];
    const perLot = (side: OrderSide) => side === 1 ? market.economics.maxLongDebitMinorPerLot : market.economics.maxShortDebitMinorPerLot;
    const required = toPost.filter((target) => !plan.has(target.side)).reduce((sum, target) => sum + target.lots * perLot(target.side), 0n);
    const collateral = await ensureFreeCollateral(client, account.accountId, required, {
      faucet: this.#fundingMinor !== null,
      headroomMinor: this.#fundingMinor ?? 0n,
    });
    transactions.push(...collateral.transactions);
    let free = collateral.available;
    for (const target of toPost) {
      if (plan.has(target.side)) {
        sized.push(target);
        continue;
      }
      const affordable = free / perLot(target.side);
      const lotsToPost = target.lots < affordable ? target.lots : affordable;
      if (lotsToPost === 0n) {
        skipped.push({ side: target.label, reason: `free collateral ${free} cannot back one lot at ${perLot(target.side)}` });
        continue;
      }
      free -= lotsToPost * perLot(target.side);
      sized.push({ ...target, lots: lotsToPost });
    }

    for (const target of sized) {
      const planned = plan.get(target.side);
      const opposite = await readBookSide(client, bookId, target.side === 1 ? 2 : 1, 8);
      const bestOpposite = opposite.find((order) => isLiveOrderStatus(order.status) && order.deadline >= now);
      if (!planned && bestOpposite && crosses(target.side, target.priceTicks, bestOpposite.priceTicks)) {
        skipped.push({ side: target.label, reason: `post-only ${target.label} at ${target.priceTicks} would cross ${bestOpposite.priceTicks}` });
        continue;
      }

      const consideration = target.lots * (target.priceTicks < 0n ? -target.priceTicks : target.priceTicks) * market.economics.tickSizeMinor;
      const makerCharge = feeChargeMinor(fees.maker, consideration);
      const maxFeeMinor = explicitMaxFeeMinor ?? (makerCharge > 0n ? makerCharge : 1n);
      const order = planned ?? {
        signer: client.address,
        accountId: account.accountId,
        policyId: publicSeriesPolicy,
        policyContextHash: makerPublicPolicyContext,
        actionId: deployment.ids.enterActionId,
        targetKind: 1,
        seriesId,
        packageId: zeroId,
        targetVersion: versions.seriesVersion,
        side: target.side,
        lots: target.lots,
        priceTicks: target.priceTicks,
        timeInForce: 1,
        deadline: now + ttl,
        executionModeId: deployment.ids.executionModeId,
        feeScheduleId: deployment.ids.feeScheduleId,
        feeScheduleVersion: versions.feeScheduleVersion,
        maxFeeMinor,
        recipient: client.address,
        permittedExecutor: deployment.addresses.atomicClearingEngine,
        nonce: deterministicWord(`setryn.operator.maker:${intent.environment}:${intent.makerKey}:${intent.idempotencyKey}:${target.side}`),
        salt: deterministicSalt(`setryn.operator.maker:${intent.makerKey}:${intent.idempotencyKey}:${target.label}`),
        allowPartialFills: true,
        minimumFillLots: 1n,
        remainderPolicy: 1,
        postOnly: true,
        reduceOnly: false,
      } satisfies PublicOrder;
      plan.set(target.side, order);
      const placement = await this.#placeOrder(order, bookId, now);
      transactions.push(...placement.transactions);
      posted.push({
        side: target.label,
        orderHash: placement.orderHash,
        priceTicks: order.priceTicks.toString(),
        lots: order.lots.toString(),
        deadline: order.deadline.toString(),
        admissionId: placement.admissionId,
        previouslyRegistered: placement.previouslyRegistered,
        transactions: transactionHashes(placement.transactions),
      });
    }

    return completed(
      {
        quoted: posted.length > 0 || kept.length > 0,
        marketKey: market.marketKey,
        marketId: market.marketId,
        seriesId,
        priceScale: market.priceScale,
        gridTicks: grid.toString(),
        maker: client.address,
        makerAccountId: account.accountId,
        bookId,
        seriesVersion: versions.seriesVersion,
        feeScheduleVersion: versions.feeScheduleVersion,
        makerFeeRatePpm: fees.maker.chargeRatePpm.toString(),
        chainTime: now.toString(),
        referencePriceTicks: mid.toString(),
        posted,
        kept,
        withdrawn,
        skipped,
      },
      transactions,
    );
  }

  /** Each step checks chain state first, so a retried cycle resumes where the previous attempt stopped. */
  async #placeOrder(order: PublicOrder, bookId: Hex, now: bigint) {
    const client = this.#client;
    const { deployment } = client;
    const transactions: OperatorTransaction[] = [];
    const orderHash = await hashOrder(client, order);
    const status = await client.read("read order status", (reader) =>
      reader.readContract({ address: deployment.addresses.orderState, abi: abis.orderState, functionName: "statusOf", args: [orderHash] }),
    );
    let admissionId = await client.read("read risk binding", (reader) =>
      reader.readContract({
        address: deployment.addresses.riskAdmissionBindingRegistry,
        abi: abis.riskAdmissionBindingRegistry,
        functionName: "admissionForOrder",
        args: [orderHash],
      }),
    );
    if (status === 0) {
      const nonceUsed = await client.read("read order nonce", (reader) =>
        reader.readContract({
          address: deployment.addresses.orderState,
          abi: abis.orderState,
          functionName: "isNonceUsed",
          args: [order.signer, order.nonce],
        }),
      );
      if (nonceUsed) return { orderHash: await this.#consumedOrderHash(order), admissionId, transactions, previouslyRegistered: true };
      if (order.deadline <= now + 5n) {
        throw new OperatorExecutionError("precondition", `quote plan for ${orderHash} expired before placement; enqueue a new cycle`);
      }
      const signature = await signOrder(client, order);
      if (admissionId === zeroId) {
        const reservation = await reserveOrderRisk(client, order, orderHash);
        if (reservation.transaction) transactions.push(reservation.transaction);
        transactions.push(transactionSummary(await client.write("bind order risk", {
          address: deployment.addresses.riskAdmissionBindingRegistry,
          abi: abis.riskAdmissionBindingRegistry,
          functionName: "bindOrderRisk",
          args: [order, reservation.admissionId],
        })));
        admissionId = reservation.admissionId;
      }
      transactions.push(transactionSummary(await client.write("register maker order", {
        address: deployment.addresses.orderState,
        abi: abis.orderState,
        functionName: "registerSignedOrder",
        args: [order, signature],
      })));
    } else if (!isLiveOrderStatus(status)) {
      return { orderHash, admissionId, transactions, previouslyRegistered: true };
    }
    const resting = await client.read("read book order", (reader) =>
      reader.readContract({ address: deployment.addresses.publicOrderBook, abi: abis.publicOrderBook, functionName: "getBookOrder", args: [orderHash] }),
    ).then((bookOrder) => bookOrder.status === 1, () => false);
    if (!resting) {
      const hint = await levelHint(client, bookId, order.side, order.priceTicks);
      transactions.push(transactionSummary(await client.write("rest maker order", {
        address: deployment.addresses.publicOrderBook,
        abi: abis.publicOrderBook,
        functionName: "placeSeriesOrder",
        args: [orderHash, hint],
      })));
    }
    return { orderHash, admissionId, transactions, previouslyRegistered: status !== 0 };
  }

  /** An earlier worker registered this idempotency key's order; OrderNonceConsumed names the hash it used. */
  async #consumedOrderHash(order: PublicOrder): Promise<Hex> {
    const { deployment } = this.#client;
    const events = await this.#client.read("read consumed order nonce", (reader) =>
      reader.getContractEvents({
        address: deployment.addresses.orderState,
        abi: abis.orderState,
        eventName: "OrderNonceConsumed",
        args: { signer: order.signer, nonce: order.nonce },
        fromBlock: deployment.deploymentBlock,
        toBlock: "latest",
        strict: true,
      }),
    );
    const orderHash = events.at(-1)?.args.orderHash;
    if (!orderHash) throw new OperatorExecutionError("precondition", `order nonce ${order.nonce} is used but its registration was not found`);
    return orderHash;
  }
}

/** The quote mid in the market's ticks, from ticks directly or from a package price scaled by the market. */
function referenceTicks(request: PayloadReader, market: OperatorMarket): bigint {
  if (request.has("referencePriceTicks")) return request.bigint("referencePriceTicks", { min: 1n });
  const price = request.string("referencePrice");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price);
  if (!match) throw new OperatorExecutionError("invalid-payload", "quoteRequest.referencePrice must be a positive decimal string");
  const decimals = String(market.priceScale).length - 1;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new OperatorExecutionError("invalid-payload", `quoteRequest.referencePrice ${price} is finer than ${market.marketKey}'s ${decimals}-decimal price grid`);
  }
  const ticks = BigInt(match[1]!) * BigInt(market.priceScale) + BigInt((fraction.slice(0, decimals).padEnd(decimals, "0")) || "0");
  if (ticks <= 0n) throw new OperatorExecutionError("invalid-payload", "quoteRequest.referencePrice must be positive");
  return ticks;
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function crosses(side: OrderSide, priceTicks: bigint, oppositeTicks: bigint): boolean {
  return side === 1 ? priceTicks >= oppositeTicks : priceTicks <= oppositeTicks;
}

function replayed(result: OperatorExecutionResult): OperatorExecutionResult {
  return { ...result, details: { ...result.details, replayed: true } };
}
