import { keccak256, parseEventLogs, stringToHex, type Hex } from "viem";

import type { SolverExecutionPort } from "../ports.ts";
import type { OperatorExecutionContext, OperatorExecutionResult, SolverExecutionIntent } from "../types.ts";
import { ensureTradingAccount, hashOrder, reserveOrderRisk, signOrder } from "./book.ts";
import { transactionSummary, type OperatorChainClient, type OperatorTransaction } from "./chain.ts";
import { requireMarketById, requireMarketBySeries, type OperatorMarket } from "./deployment.ts";
import { describeChainError, isContractRevert, OperatorExecutionError } from "./errors.ts";
import { PayloadReader } from "./payload.ts";
import {
  abis,
  capacityCancelTypes,
  deterministicSalt,
  deterministicWord,
  enumName,
  makerQuoteTypes,
  makerQuoteStatusNames,
  makerRfqPolicyContext,
  publicSeriesPolicy,
  rfqStatus,
  rfqStatusNames,
  setrynDomain,
  zeroId,
  type PublicOrder,
} from "./protocol.ts";
import { assertIntentEnvironment, completed } from "./results.ts";

/**
 * Accepted `executionPlan` for a solver-execution intent (integers as JSON numbers or decimal strings):
 *
 *   { "action": "submit-quote", "rfqId": bytes32, "priceTicks": integer,
 *     "lots"?: integer, "maxFeeMinor"?: integer, "ttlSeconds"?: 5..120, "capacityTailSeconds"?: 1..300 }
 *     Registers the solver's backing maker order (risk reserved and bound), submits a signed firm quote for an RFQ
 *     that is collecting, and reserves its capacity. Requires riskClass "new-risk".
 *
 *   { "action": "execute-handoff", "rfqId": bytes32 }
 *     Clears the taker-selected, submitted RFQ through AtomicClearingEngine.clearSeriesWithHandoff and reports the
 *     created position. Requires riskClass "new-risk".
 *
 *   { "action": "withdraw-quote", "quoteId": bytes32 }
 *     Cancels the solver's unselected firm capacity with a signed cancellation. Any risk class.
 *
 * The intent's `marketId` must be the market the RFQ's series trades as (any market of the deployment), `packageHash`
 * must equal the RFQ's package id (zero for a single-series RFQ), and `accountId` must be an account on the RFQ (the
 * solver's for quoting and withdrawal). Liability, lot caps and payoff terms come from that market.
 */
export class ChainSolverExecutionPort implements SolverExecutionPort {
  readonly #client: OperatorChainClient;
  readonly #fundingMinor: bigint | null;
  readonly #results = new Map<string, OperatorExecutionResult>();
  readonly #plans = new Map<string, { readonly makerOrder: PublicOrder; readonly deadline: bigint }>();

  constructor(client: OperatorChainClient, options: { readonly accountFundingMinor?: bigint | null } = {}) {
    this.#client = client;
    this.#fundingMinor = options.accountFundingMinor === undefined
      ? client.environment === "local" ? 250_000_000_000n : null
      : options.accountFundingMinor;
  }

  async executeSolverIntent(intent: SolverExecutionIntent, context: OperatorExecutionContext): Promise<OperatorExecutionResult> {
    assertIntentEnvironment(this.#client, intent.environment, context);
    const cached = this.#results.get(intent.idempotencyKey);
    if (cached) return { ...cached, details: { ...cached.details, replayed: true } };
    const plan = new PayloadReader(intent.executionPlan, "executionPlan");
    const action = plan.oneOf("action", ["submit-quote", "execute-handoff", "withdraw-quote"] as const);
    if (action !== "withdraw-quote" && intent.riskClass !== "new-risk") {
      throw new OperatorExecutionError("invalid-payload", `${action} creates exposure and must be classed new-risk so kill switches apply`);
    }
    requireMarketById(this.#client.deployment, intent.marketId);
    if (!this.#client.isDeploymentOperator()) {
      throw new OperatorExecutionError("precondition", "solver execution needs the deployment operator's risk-consumer and match-executor roles");
    }
    try {
      const result = action === "submit-quote"
        ? await this.#submitQuote(intent, plan)
        : action === "execute-handoff"
          ? await this.#executeHandoff(intent, plan)
          : await this.#withdrawQuote(intent, plan);
      this.#results.set(intent.idempotencyKey, result);
      return result;
    } catch (error) {
      throw describeChainError(error, `solver ${action} ${intent.idempotencyKey}`);
    }
  }

  async #submitQuote(intent: SolverExecutionIntent, plan: PayloadReader): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const rfqId = plan.bytes32("rfqId");
    const rfq = await this.#readRfq(rfqId);
    this.#assertTarget(intent, rfq.request.packageId);
    const market = this.#marketFor(intent, rfq.request.seriesId);
    const account = await ensureTradingAccount(client, { fundingMinor: this.#fundingMinor });
    if (intent.accountId.toLowerCase() !== account.accountId) {
      throw new OperatorExecutionError("invalid-payload", `accountId must be the solver account ${account.accountId}`);
    }
    const transactions: OperatorTransaction[] = [...account.transactions];

    const existing = await this.#ownQuote(rfqId);
    if (existing) {
      transactions.push(...await this.#ensureCapacity(existing.quoteId));
      return completed({ action: "submit-quote", rfqId, quoteId: existing.quoteId, previouslySubmitted: true, quoteStatus: existing.status }, transactions);
    }

    const now = await client.chainNow();
    if (rfq.status !== rfqStatus.collecting || rfq.request.deadline <= now) {
      throw new OperatorExecutionError("precondition", `RFQ ${rfqId} is ${enumName(rfqStatusNames, rfq.status)} and not collecting quotes`);
    }
    if (rfq.request.sidePolicy !== 1 && rfq.request.sidePolicy !== 2) {
      throw new OperatorExecutionError("precondition", "two-way RFQs are not quoted by this solver");
    }
    const makerSide = rfq.request.sidePolicy === 1 ? 2 : 1;
    const priceTicks = plan.bigint("priceTicks", { min: 1n });
    const lots = plan.bigint("lots", { fallback: rfq.request.lots, min: 1n, max: rfq.request.lots });
    if (lots > market.economics.maxOrderLots) {
      throw new OperatorExecutionError("precondition", `${market.marketKey} caps orders at ${market.economics.maxOrderLots} lots; the RFQ asks ${lots}`);
    }
    const maxFeeMinor = plan.bigint("maxFeeMinor", { fallback: rfq.request.maxFeeMinor, min: 0n, max: rfq.request.maxFeeMinor });
    const ttl = BigInt(plan.integer("ttlSeconds", { fallback: 120, min: 5, max: 120 }));
    const tail = BigInt(plan.integer("capacityTailSeconds", { fallback: 60, min: 1, max: 300 }));
    if (lots < rfq.request.lots && (!rfq.request.allowPartialFills || rfq.request.remainderPolicy !== 2)) {
      throw new OperatorExecutionError("invalid-payload", "the RFQ does not accept partial quotes");
    }

    const cached = this.#plans.get(intent.idempotencyKey);
    const deadline = cached?.deadline ?? (rfq.request.deadline < now + ttl ? rfq.request.deadline : now + ttl);
    const orderNonce = deterministicWord(`setryn.operator.solver:${intent.environment}:${intent.idempotencyKey}:maker-order`);
    const makerOrder: PublicOrder = cached?.makerOrder ?? {
      signer: client.address,
      accountId: account.accountId,
      policyId: publicSeriesPolicy,
      policyContextHash: makerRfqPolicyContext,
      actionId: deployment.ids.enterActionId,
      targetKind: 1,
      seriesId: rfq.request.seriesId,
      packageId: zeroId,
      targetVersion: rfq.request.targetVersion,
      side: makerSide,
      lots,
      priceTicks,
      timeInForce: 4,
      deadline,
      executionModeId: deployment.ids.privateRfqExecutionModeId,
      feeScheduleId: deployment.ids.feeScheduleId,
      feeScheduleVersion: 1,
      maxFeeMinor,
      recipient: client.address,
      permittedExecutor: deployment.addresses.atomicClearingEngine,
      nonce: orderNonce,
      salt: deterministicSalt(`${rfqId}:${orderNonce}:maker-order`),
      // The maker's quote order is fill-or-kill for exactly the quoted size, so its policy is the canonical FOK one.
      allowPartialFills: false,
      minimumFillLots: lots,
      remainderPolicy: 2,
      postOnly: false,
      reduceOnly: false,
    };
    this.#plans.set(intent.idempotencyKey, { makerOrder, deadline });

    const makerOrderHash = await hashOrder(client, makerOrder);
    const status = await client.read("read order status", (reader) =>
      reader.readContract({ address: deployment.addresses.orderState, abi: abis.orderState, functionName: "statusOf", args: [makerOrderHash] }),
    );
    if (status === 0) {
      const signature = await signOrder(client, makerOrder);
      let admissionId = await client.read("read risk binding", (reader) =>
        reader.readContract({
          address: deployment.addresses.riskAdmissionBindingRegistry,
          abi: abis.riskAdmissionBindingRegistry,
          functionName: "admissionForOrder",
          args: [makerOrderHash],
        }),
      );
      if (admissionId === zeroId) {
        const reservation = await reserveOrderRisk(client, makerOrder, makerOrderHash);
        if (reservation.transaction) transactions.push(reservation.transaction);
        transactions.push(transactionSummary(await client.write("bind solver order risk", {
          address: deployment.addresses.riskAdmissionBindingRegistry,
          abi: abis.riskAdmissionBindingRegistry,
          functionName: "bindOrderRisk",
          args: [makerOrder, reservation.admissionId],
        })));
        admissionId = reservation.admissionId;
      }
      transactions.push(transactionSummary(await client.write("register solver order", {
        address: deployment.addresses.orderState,
        abi: abis.orderState,
        functionName: "registerSignedOrder",
        args: [makerOrder, signature],
      })));
    }

    const liabilityPerLot = makerSide === 1 ? market.economics.maxLongDebitMinorPerLot : market.economics.maxShortDebitMinorPerLot;
    const quoteNonce = deterministicWord(`setryn.operator.solver:${intent.environment}:${intent.idempotencyKey}:quote`);
    const quote = {
      rfqId,
      maker: client.address,
      makerAccountId: account.accountId,
      takerAccountId: rfq.request.takerAccountId,
      makerOrderHash,
      targetKind: rfq.request.targetKind,
      seriesId: rfq.request.seriesId,
      packageId: rfq.request.packageId,
      targetVersion: rfq.request.targetVersion,
      hasPackageLegCommitment: rfq.request.hasPackageLegCommitment,
      packageLegsHash: rfq.request.packageLegsHash,
      sidePolicy: rfq.request.sidePolicy,
      lots,
      allowPartialFills: rfq.request.allowPartialFills,
      minimumFillLots: rfq.request.minimumFillLots,
      remainderPolicy: rfq.request.remainderPolicy,
      bidPriceTicks: rfq.request.sidePolicy === 2 ? priceTicks : 0n,
      askPriceTicks: rfq.request.sidePolicy === 1 ? priceTicks : 0n,
      feeScheduleId: deployment.ids.feeScheduleId,
      feeScheduleVersion: 1,
      maxFeeMinor,
      riskDomainId: deployment.ids.riskDomainId,
      riskDomainVersion: 1,
      collateralAssetId: deployment.ids.settlementAssetId,
      collateralBindingVersion: 1,
      maximumLiability: lots * liabilityPerLot,
      privacyModeId: deployment.ids.privateRfqPrivacyModeId,
      executionModeId: deployment.ids.privateRfqExecutionModeId,
      disclosurePolicyHash: deployment.ids.privateRfqDisclosurePolicyHash,
      eligibleMakerSetHash: deployment.ids.privateRfqEligibleMakerSetHash,
      deadline,
      capacityExpiry: deadline + tail,
      permittedExecutor: deployment.addresses.atomicClearingEngine,
      nonce: quoteNonce,
      salt: deterministicSalt(`${rfqId}:${quoteNonce}:maker-quote`),
    } as const;
    const quoteSignature = await client.signTypedData("sign firm quote", {
      domain: setrynDomain(deployment, deployment.addresses.privateRfqBook),
      types: makerQuoteTypes,
      primaryType: "MakerQuote",
      message: quote,
    });
    const quoteId = await client.read("hash quote", (reader) =>
      reader.readContract({ address: deployment.addresses.privateRfqBook, abi: abis.privateRfqBook, functionName: "hashQuote", args: [quote] }),
    );
    // A single-leaf eligible-maker set: the leaf is the root, so the membership proof is empty.
    transactions.push(transactionSummary(await client.write("submit firm quote", {
      address: deployment.addresses.privateRfqBook,
      abi: abis.privateRfqBook,
      functionName: "submitQuote",
      args: [quote, [], quoteSignature],
    })));
    transactions.push(...await this.#ensureCapacity(quoteId));
    return completed(
      {
        action: "submit-quote",
        marketKey: market.marketKey,
        seriesId: market.seriesId,
        rfqId,
        quoteId,
        makerOrderHash,
        makerSide: makerSide === 1 ? "long" : "short",
        priceTicks,
        lots,
        maxFeeMinor,
        deadline,
        capacityExpiry: deadline + tail,
        maximumLiability: lots * liabilityPerLot,
      },
      transactions,
    );
  }

  async #executeHandoff(intent: SolverExecutionIntent, plan: PayloadReader): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const rfqId = plan.bytes32("rfqId");
    const rfq = await this.#readRfq(rfqId);
    this.#assertTarget(intent, rfq.request.packageId);
    const market = this.#marketFor(intent, rfq.request.seriesId);
    if (rfq.status === 7 || rfq.status === rfqStatus.settled) {
      return completed({ action: "execute-handoff", rfqId, previouslyExecuted: true, rfqStatus: enumName(rfqStatusNames, rfq.status) }, []);
    }
    if (rfq.status !== rfqStatus.submitted || rfq.selectedQuoteId === zeroId) {
      throw new OperatorExecutionError("precondition", `RFQ ${rfqId} is ${enumName(rfqStatusNames, rfq.status)}; the taker has not submitted a selection`);
    }
    const privateRfqBook = deployment.addresses.privateRfqBook;
    const [quote, capacity, sourceCommitment] = await Promise.all([
      client.read("read quote", (reader) => reader.readContract({ address: privateRfqBook, abi: abis.privateRfqBook, functionName: "getQuote", args: [rfq.selectedQuoteId] })),
      client.read("read capacity", (reader) => reader.readContract({ address: privateRfqBook, abi: abis.privateRfqBook, functionName: "getCapacity", args: [rfq.selectedQuoteId] })),
      client.read("read handoff commitment", (reader) =>
        reader.readContract({ address: privateRfqBook, abi: abis.privateRfqBook, functionName: "selectedHandoffCommitment", args: [rfqId] }),
      ),
    ]);
    const accounts = [rfq.request.takerAccountId.toLowerCase(), quote.quote.makerAccountId.toLowerCase()];
    if (!accounts.includes(intent.accountId.toLowerCase())) {
      throw new OperatorExecutionError("invalid-payload", `accountId ${intent.accountId} is not a party to RFQ ${rfqId}`);
    }
    const executionPriceTicks = rfq.request.sidePolicy === 1 ? quote.quote.askPriceTicks : quote.quote.bidPriceTicks;
    if (executionPriceTicks === 0n) throw new OperatorExecutionError("precondition", "selected quote has no price for the requested side");

    const bindings = deployment.addresses.riskAdmissionBindingRegistry;
    const [takerAdmissionId, makerAdmissionId, capacityLock, positionEngineId, fillId] = await Promise.all([
      client.read("read taker risk", (reader) => reader.readContract({ address: bindings, abi: abis.riskAdmissionBindingRegistry, functionName: "admissionForOrder", args: [rfq.request.takerOrderHash] })),
      client.read("read maker risk", (reader) => reader.readContract({ address: bindings, abi: abis.riskAdmissionBindingRegistry, functionName: "admissionForOrder", args: [quote.quote.makerOrderHash] })),
      client.read("read capacity lock", (reader) => reader.readContract({ address: deployment.addresses.collateralVault, abi: abis.collateralVault, functionName: "getLock", args: [capacity.lockId] })),
      client.read("read position engine id", (reader) => reader.readContract({ address: deployment.addresses.positionEngine, abi: abis.positionEngine, functionName: "positionEngineId" })),
      client.read("preview fill id", (reader) =>
        reader.readContract({
          address: deployment.addresses.atomicClearingEngine,
          abi: abis.atomicClearingEngine,
          functionName: "previewSeriesFillId",
          args: [rfq.request.takerOrderHash, quote.quote.makerOrderHash, rfq.request.lots, executionPriceTicks, market.payoffTerms],
        }),
      ),
    ]);
    if (takerAdmissionId === zeroId || makerAdmissionId === zeroId) throw new OperatorExecutionError("precondition", "a risk admission is not bound to the RFQ orders");
    if (capacityLock.remainingAmount !== capacity.remainingLiability) throw new OperatorExecutionError("precondition", "capacity lock does not match the firm capacity record");
    const [takerAdmission, makerAdmission] = await Promise.all([
      client.read("read taker admission", (reader) => reader.readContract({ address: deployment.addresses.portfolioRiskEngine, abi: abis.portfolioRiskEngine, functionName: "getAdmission", args: [takerAdmissionId] })),
      client.read("read maker admission", (reader) => reader.readContract({ address: deployment.addresses.portfolioRiskEngine, abi: abis.portfolioRiskEngine, functionName: "getAdmission", args: [makerAdmissionId] })),
    ]);

    const takerIsLong = rfq.request.sidePolicy === 1;
    const makerSide = takerIsLong ? 2 : 1;
    const capacityFunding = {
      lockId: capacity.lockId,
      lockReference: capacityLock.lockReference,
      expectedRemainingAmount: capacity.remainingLiability,
      expectedExpiry: capacity.expiry,
    } as const;
    const emptyFunding = { lockId: zeroId, lockReference: zeroId, expectedRemainingAmount: 0n, expectedExpiry: 0n } as const;
    const positionCreation = {
      fillIdentity: fillId,
      seriesId: rfq.request.seriesId,
      seriesVersion: rfq.request.targetVersion,
      longAccountId: takerIsLong ? rfq.request.takerAccountId : quote.quote.makerAccountId,
      shortAccountId: takerIsLong ? quote.quote.makerAccountId : rfq.request.takerAccountId,
      ordinal: 0,
      lots: rfq.request.lots,
      entryPriceTicks: executionPriceTicks,
      longFunding: makerSide === 1 ? capacityFunding : emptyFunding,
      shortFunding: makerSide === 2 ? capacityFunding : emptyFunding,
      payoffTerms: market.payoffTerms,
    } as const;
    const positionId = await client.read("derive position id", (reader) =>
      reader.readContract({ address: deployment.addresses.positionEngine, abi: abis.positionEngine, functionName: "derivePositionId", args: [positionCreation] }),
    );
    const liabilityKey = await client.read("derive liability key", (reader) =>
      reader.readContract({ address: deployment.addresses.positionEngine, abi: abis.positionEngine, functionName: "deriveLiabilityKey", args: [positionId, makerSide] }),
    );
    const reservationId = await client.read("derive reservation id", (reader) =>
      reader.readContract({
        address: deployment.addresses.collateralVault,
        abi: abis.collateralVault,
        functionName: "deriveTerminalLiabilityReservationId",
        args: [deployment.addresses.positionEngine, positionEngineId, liabilityKey],
      }),
    );

    const zeroOrderFunding = { terminalLiabilityLockId: zeroId, considerationLockId: zeroId } as const;
    const zeroFeeFunding = { consumptionId: zeroId, chargeLockId: zeroId, budgetLockId: zeroId } as const;
    const longAdmissionId = takerIsLong ? takerAdmissionId : makerAdmissionId;
    const shortAdmissionId = takerIsLong ? makerAdmissionId : takerAdmissionId;
    const longAdmissionResultHash = takerIsLong ? takerAdmission.resultHash : makerAdmission.resultHash;
    const shortAdmissionResultHash = takerIsLong ? makerAdmission.resultHash : takerAdmission.resultHash;
    const reservationAmount = rfq.request.lots * (makerSide === 1 ? market.economics.maxLongDebitMinorPerLot : market.economics.maxShortDebitMinorPerLot);
    const clearingRequest = {
      matchData: {
        takerOrderHash: rfq.request.takerOrderHash,
        makerOrderHash: quote.quote.makerOrderHash,
        fillLots: rfq.request.lots,
        executionPriceTicks,
        longAdmissionId,
        longAdmissionResultHash,
        shortAdmissionId,
        shortAdmissionResultHash,
        takerFunding: zeroOrderFunding,
        makerFunding: zeroOrderFunding,
        takerFeeFunding: zeroFeeFunding,
        makerFeeFunding: zeroFeeFunding,
      },
      payoffTerms: market.payoffTerms,
      channelKind: 2,
    } as const;
    const claim = {
      kind: 1,
      consumptionId: keccak256(stringToHex(`${rfqId}:${rfq.selectedQuoteId}:${fillId}:handoff`)),
      sourceId: rfqId,
      sourceVersion: 1,
      sourceCommitment,
      takerOrderHash: rfq.request.takerOrderHash,
      makerOrderHash: quote.quote.makerOrderHash,
      takerAccountId: rfq.request.takerAccountId,
      makerAccountId: quote.quote.makerAccountId,
      takerSide: takerIsLong ? 1 : 2,
      targetKind: 1,
      seriesId: rfq.request.seriesId,
      packageId: zeroId,
      targetVersion: rfq.request.targetVersion,
      selectedQuoteOrRouteId: rfq.selectedQuoteId,
      packageWitnessHash: zeroId,
      packageLegs: [],
      fillLots: rfq.request.lots,
      executionPriceTicks,
      feeScheduleId: rfq.request.feeScheduleId,
      feeScheduleVersion: rfq.request.feeScheduleVersion,
      takerMaximumFeeMinor: rfq.request.maxFeeMinor,
      makerMaximumFeeMinor: quote.quote.maxFeeMinor,
      makerFeeFunding: zeroFeeFunding,
      takerFeeFunding: zeroFeeFunding,
      riskDomainId: rfq.request.riskDomainId,
      riskDomainVersion: rfq.request.riskDomainVersion,
      executionModeId: rfq.request.executionModeId,
      longAdmissionId,
      longAdmissionResultHash,
      shortAdmissionId,
      shortAdmissionResultHash,
      deadline: rfq.request.deadline < quote.quote.deadline ? rfq.request.deadline : quote.quote.deadline,
      capacityDispositions: [{
        positionOrdinal: 0,
        side: makerSide,
        accountId: quote.quote.makerAccountId,
        funding: capacityFunding,
        reservationAmount,
        capacityDisposition: 1,
        reservationId,
        unusedCapacityPolicy: 2,
      }],
    } as const;
    const clearing = await client.write("clear RFQ handoff", {
      address: deployment.addresses.atomicClearingEngine,
      abi: abis.atomicClearingEngine,
      functionName: "clearSeriesWithHandoff",
      args: [clearingRequest, claim],
    });
    const created = parseEventLogs({ abi: abis.atomicClearingEngine, eventName: "FillPositionCreated", logs: clearing.receipt.logs, strict: true });
    const createdPositionId = created[0]?.args.positionId;
    if (createdPositionId !== positionId) {
      throw new OperatorExecutionError("precondition", `clearing ${clearing.hash} did not emit the expected position ${positionId}`, {
        details: { transactionHash: clearing.hash },
      });
    }
    return completed(
      {
        action: "execute-handoff",
        marketKey: market.marketKey,
        seriesId: market.seriesId,
        rfqId,
        quoteId: rfq.selectedQuoteId,
        fillId,
        positionId,
        executionPriceTicks,
        fillLots: rfq.request.lots,
        takerSide: takerIsLong ? "long" : "short",
      },
      [transactionSummary(clearing)],
    );
  }

  async #withdrawQuote(intent: SolverExecutionIntent, plan: PayloadReader): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const quoteId = plan.bytes32("quoteId");
    const quote = await client.read("read quote", (reader) =>
      reader.readContract({ address: deployment.addresses.privateRfqBook, abi: abis.privateRfqBook, functionName: "getQuote", args: [quoteId] }),
    );
    if (quote.quote.maker !== client.address) throw new OperatorExecutionError("precondition", `quote ${quoteId} belongs to ${quote.quote.maker}`);
    if (intent.accountId.toLowerCase() !== quote.quote.makerAccountId.toLowerCase()) {
      throw new OperatorExecutionError("invalid-payload", "accountId must be the quoting account");
    }
    if (quote.status >= 4) {
      return completed({ action: "withdraw-quote", quoteId, quoteStatus: enumName(makerQuoteStatusNames, quote.status), previouslyClosed: true }, []);
    }
    const now = await client.chainNow();
    const nonce = deterministicWord(`setryn.operator.solver:${intent.environment}:${intent.idempotencyKey}:cancel`);
    const cancellation = { quoteId, maker: client.address, nonce, deadline: now + 60n, salt: deterministicSalt(`${quoteId}:${nonce}:cancel-capacity`) } as const;
    const signature = await client.signTypedData("sign capacity cancellation", {
      domain: setrynDomain(deployment, deployment.addresses.privateRfqBook),
      types: capacityCancelTypes,
      primaryType: "CapacityCancelAuthorization",
      message: cancellation,
    });
    const result = await client.write("cancel quote capacity", {
      address: deployment.addresses.privateRfqBook,
      abi: abis.privateRfqBook,
      functionName: "cancelQuoteCapacity",
      args: [cancellation, signature],
    });
    return completed({ action: "withdraw-quote", quoteId }, [transactionSummary(result)]);
  }

  async #readRfq(rfqId: Hex) {
    return this.#client.read("read RFQ", (reader) =>
      reader.readContract({ address: this.#client.deployment.addresses.privateRfqBook, abi: abis.privateRfqBook, functionName: "getRfq", args: [rfqId] }),
    );
  }

  /** The RFQ's series must be a market of this deployment, and the one the intent names. */
  #marketFor(intent: SolverExecutionIntent, seriesId: Hex): OperatorMarket {
    const market = requireMarketBySeries(this.#client.deployment, seriesId);
    if (market.marketId !== intent.marketId.toLowerCase()) {
      throw new OperatorExecutionError("invalid-payload", `RFQ series ${seriesId} trades as ${market.marketKey} (${market.marketId}), not market ${intent.marketId}`);
    }
    return market;
  }

  #assertTarget(intent: SolverExecutionIntent, packageId: Hex): void {
    if (intent.packageHash.toLowerCase() !== packageId.toLowerCase()) {
      throw new OperatorExecutionError("invalid-payload", `packageHash ${intent.packageHash} does not match the RFQ package ${packageId}`);
    }
  }

  /** This solver's existing quote on an RFQ, found through MakerQuoteCommitted so a restarted worker never double-quotes. */
  async #ownQuote(rfqId: Hex): Promise<{ readonly quoteId: Hex; readonly status: string } | null> {
    const { deployment } = this.#client;
    const events = await this.#client.read("read committed quotes", (reader) =>
      reader.getContractEvents({
        address: deployment.addresses.privateRfqBook,
        abi: abis.privateRfqBook,
        eventName: "MakerQuoteCommitted",
        args: { rfqId },
        fromBlock: deployment.deploymentBlock,
        toBlock: "latest",
        strict: true,
      }),
    );
    for (const event of events) {
      const quote = await this.#client.read("read quote", (reader) =>
        reader.readContract({ address: deployment.addresses.privateRfqBook, abi: abis.privateRfqBook, functionName: "getQuote", args: [event.args.quoteId] }),
      );
      if (quote.quote.maker === this.#client.address) return { quoteId: event.args.quoteId, status: enumName(makerQuoteStatusNames, quote.status) };
    }
    return null;
  }

  async #ensureCapacity(quoteId: Hex): Promise<OperatorTransaction[]> {
    const { deployment } = this.#client;
    const capacity = await this.#client.read("read capacity", (reader) =>
      reader.readContract({ address: deployment.addresses.privateRfqBook, abi: abis.privateRfqBook, functionName: "getCapacity", args: [quoteId] }),
    ).catch((error: unknown) => {
      if (isContractRevert(error)) return null;
      throw error;
    });
    if (capacity && capacity.status !== 0) return [];
    return [transactionSummary(await this.#client.write("reserve quote capacity", {
      address: deployment.addresses.privateRfqBook,
      abi: abis.privateRfqBook,
      functionName: "reserveQuoteCapacity",
      args: [quoteId],
    }))];
  }
}
