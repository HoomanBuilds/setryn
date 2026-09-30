import type { JsonObject } from "@setryn/internal-schemas";
import type { Hex } from "viem";

import type { KeeperExecutionPort } from "../ports.ts";
import type { KeeperWorkIntent, OperatorExecutionContext, OperatorExecutionResult } from "../types.ts";
import { isLiveOrderStatus, readBookSide } from "./book.ts";
import { transactionSummary, type OperatorChainClient, type OperatorTransaction } from "./chain.ts";
import { requireMarket, requireMarketBySeries, type OperatorMarket } from "./deployment.ts";
import { describeChainError, isContractRevert, OperatorExecutionError } from "./errors.ts";
import { toAbiSlot } from "./oracle.ts";
import { PayloadReader } from "./payload.ts";
import {
  abis,
  deriveSeriesBookId,
  enumName,
  fixingResolutionNames,
  fixingStatus,
  fixingStatusNames,
  orderStatusNames,
  positionStatus,
  positionStatusNames,
  zeroId,
} from "./protocol.ts";
import { assertIntentEnvironment, completed } from "./results.ts";
import { SeriesCatalog } from "./series.ts";

type KeeperWorkType = "expire-orders" | "resolve-fixing" | "settle-positions" | "recover" | "sweep";

const sweepSteps = ["expire-orders", "resolve-fixing", "settle-positions", "recover-positions"] as const;
type SweepStep = (typeof sweepSteps)[number];

interface KeeperAction {
  readonly target: string;
  readonly action: string;
  readonly outcome: "executed" | "skipped" | "not-due";
  readonly reason?: string;
  readonly transactionHash?: Hex;
  readonly details?: JsonObject;
}

const recoveryKinds = [
  "expire-risk-admission",
  "release-expired-lock",
  "expire-quote-capacity",
  "expire-rfq",
  "finalize-terminal-reservation",
  "materialize-terminal-claim",
  "fulfill-terminal-claim",
] as const;

/**
 * Keeper work runs only permissionless entry points, so it never depends on an authority that can be revoked and
 * terminal state always follows committed chain time. `resourceId` is the series for series-scoped work types.
 *
 * - "expire-orders":    { seriesId?, maxOrders?: 1..128, orderHashes?: bytes32[] }
 *     Refreshes past-deadline resting orders out of the public book (PublicOrderBook.syncOrder, which expires them in
 *     OrderState) and expires listed off-book orders (OrderState.expireOrder).
 * - "resolve-fixing":   { seriesId?, seriesVersion?, positionIds?: bytes32[] }
 *     Moves live positions into fixing once the window opens (PositionEngine.beginFixing), finalizes a proposed fixing
 *     inside [correctionCutoffAt, finalResolutionAt) (FixingEngine.finalizeFixing / finalizeFixingVector), and applies the
 *     terminal fallback once final resolution passes without a final fixing (FixingEngine.applyTerminalFallback[Vector]).
 * - "settle-positions": { seriesId?, seriesVersion?, positionIds?: bytes32[] }
 *     Completes settlement through CashSettlementCoordinator: finalizeNormalSettlement before final resolution when a
 *     final fixing exists, finalizeTerminalDisruption after it, finalizeLapsedPosition for lapsed positions.
 * - "recover":          { actions?: [{ kind, id }], positionIds?: bytes32[] }
 *     kinds: expire-risk-admission, release-expired-lock, expire-quote-capacity, expire-rfq,
 *     finalize-terminal-reservation, materialize-terminal-claim, fulfill-terminal-claim. For positionIds, both terminal
 *     liability reservations are finalized (or materialized into claims after final resolution) when due.
 *
 * - "sweep":            { marketKeys?: string[], steps?: ("expire-orders" | "resolve-fixing" | "settle-positions" |
 *                         "recover-positions")[], seriesVersion? }
 *     Runs the listed steps (default: all four, in that order) for every market of the deployment (or the listed
 *     catalog keys). "recover-positions" finalizes or materializes the terminal reservations of every position on the
 *     series. `resourceId` must be the zero id: the sweep is deployment-scoped. One market's failure is recorded and
 *     the sweep continues; transport failures still throw so the runtime retries the (idempotent) sweep.
 *
 * Series-scoped work only runs on series that are markets of the deployment. Positions default to every
 * PositionCreated on the series. Work that is not yet due is reported, not failed.
 */
export class ChainKeeperExecutionPort implements KeeperExecutionPort {
  readonly #client: OperatorChainClient;
  readonly #catalog: SeriesCatalog;

  constructor(client: OperatorChainClient, catalog = new SeriesCatalog(client)) {
    this.#client = client;
    this.#catalog = catalog;
  }

  async executeKeeperWork(intent: KeeperWorkIntent, context: OperatorExecutionContext): Promise<OperatorExecutionResult> {
    assertIntentEnvironment(this.#client, intent.environment, context);
    const work = new PayloadReader(intent.work, "work");
    const workType = intent.workType as KeeperWorkType;
    try {
      switch (workType) {
        case "expire-orders":
          return await this.#expireOrders(intent, work);
        case "resolve-fixing":
          return await this.#resolveFixing(intent, work);
        case "settle-positions":
          return await this.#settlePositions(intent, work);
        case "recover":
          return await this.#recover(work);
        case "sweep":
          return await this.#sweep(intent, work);
        default:
          throw new OperatorExecutionError("invalid-payload", `unsupported keeper work type ${intent.workType}`);
      }
    } catch (error) {
      throw describeChainError(error, `keeper ${intent.workType} ${intent.idempotencyKey}`);
    }
  }

  async #expireOrders(intent: KeeperWorkIntent, work: PayloadReader): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const seriesId = this.#seriesFor(intent, work);
    const maxOrders = work.integer("maxOrders", { fallback: 64, min: 1, max: 128 });
    const bookId = deriveSeriesBookId(deployment, seriesId);
    const now = await client.chainNow();
    const actions: KeeperAction[] = [];
    const transactions: OperatorTransaction[] = [];
    const seen = new Set<Hex>();
    for (const side of [1, 2] as const) {
      const resting = await readBookSide(client, bookId, side, maxOrders);
      for (const order of resting) {
        seen.add(order.orderHash);
        const dead = !isLiveOrderStatus(order.status) || order.deadline < now;
        if (!dead) continue;
        const executed = await this.#attempt(`book order ${order.orderHash}`, "sync-expired-order", {
          address: deployment.addresses.publicOrderBook,
          abi: abis.publicOrderBook,
          functionName: "syncOrder",
          args: [order.orderHash],
        }, { side: side === 1 ? "bid" : "ask", deadline: order.deadline.toString(), status: enumName(orderStatusNames, order.status) });
        actions.push(executed.action);
        if (executed.transaction) transactions.push(executed.transaction);
      }
    }
    for (const orderHash of work.bytes32List("orderHashes")) {
      if (seen.has(orderHash)) continue;
      const status = await client.read("read order status", (reader) =>
        reader.readContract({ address: deployment.addresses.orderState, abi: abis.orderState, functionName: "statusOf", args: [orderHash] }),
      );
      if (!isLiveOrderStatus(status)) {
        actions.push({ target: `order ${orderHash}`, action: "expire-order", outcome: "skipped", reason: `order is ${enumName(orderStatusNames, status)}` });
        continue;
      }
      const executed = await this.#attempt(`order ${orderHash}`, "expire-order", {
        address: deployment.addresses.orderState,
        abi: abis.orderState,
        functionName: "expireOrder",
        args: [orderHash],
      });
      actions.push(executed.action);
      if (executed.transaction) transactions.push(executed.transaction);
    }
    return completed({ workType: "expire-orders", marketKey: requireMarketBySeries(deployment, seriesId).marketKey, seriesId, bookId, chainTime: now, actions: [...actions] }, transactions);
  }

  async #resolveFixing(intent: KeeperWorkIntent, work: PayloadReader): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const seriesId = this.#seriesFor(intent, work);
    const seriesVersion = work.integer("seriesVersion", { fallback: 1, min: 1 });
    const schedule = await this.#catalog.schedule(seriesId, seriesVersion);
    const slots = await this.#catalog.fixingSlots(seriesId, seriesVersion);
    const positionIds = work.has("positionIds") ? work.bytes32List("positionIds") : await this.#catalog.positionIds(seriesId);
    const now = await client.chainNow();
    const actions: KeeperAction[] = [];
    const transactions: OperatorTransaction[] = [];

    for (const positionId of positionIds) {
      const status = await this.#positionStatus(positionId);
      if (status !== positionStatus.live) continue;
      if (now < schedule.fixingWindowOpen || now >= schedule.finalResolutionAt) {
        actions.push({
          target: `position ${positionId}`,
          action: "begin-fixing",
          outcome: "not-due",
          reason: now < schedule.fixingWindowOpen ? `fixing window opens at ${schedule.fixingWindowOpen}` : "final resolution reached; settle through the terminal fallback",
        });
        continue;
      }
      const executed = await this.#attempt(`position ${positionId}`, "begin-fixing", {
        address: deployment.addresses.positionEngine,
        abi: abis.positionEngine,
        functionName: "beginFixing",
        args: [positionId],
      });
      actions.push(executed.action);
      if (executed.transaction) transactions.push(executed.transaction);
    }

    const statuses = await Promise.all(slots.map((slot) =>
      client.read("read fixing status", (reader) =>
        reader.readContract({ address: deployment.addresses.fixingEngine, abi: abis.fixingEngine, functionName: "fixingStatus", args: [seriesId, seriesVersion, slot.slot] }),
      ),
    ));
    const target = `series ${seriesId} v${seriesVersion}`;
    if (statuses.every((status) => status === fixingStatus.finalized)) {
      actions.push({ target, action: "resolve-fixing", outcome: "skipped", reason: "every fixing slot is already final" });
    } else if (now >= schedule.finalResolutionAt) {
      const executed = slots.length === 1
        ? await this.#attempt(target, "apply-terminal-fallback", {
          address: deployment.addresses.fixingEngine,
          abi: abis.fixingEngine,
          functionName: "applyTerminalFallback",
          args: [seriesId, seriesVersion, slots[0]!.slot],
        })
        : await this.#attempt(target, "apply-terminal-fallback-vector", {
          address: deployment.addresses.fixingEngine,
          abi: abis.fixingEngine,
          functionName: "applyTerminalFallbackVector",
          args: [seriesId, seriesVersion, slots.map(toAbiSlot)],
        });
      actions.push(executed.action);
      if (executed.transaction) transactions.push(executed.transaction);
    } else if (statuses.every((status) => status === fixingStatus.proposed || status === fixingStatus.finalized)) {
      if (now < schedule.correctionCutoffAt) {
        actions.push({ target, action: "finalize-fixing", outcome: "not-due", reason: `corrections stay open until ${schedule.correctionCutoffAt}` });
      } else {
        const executed = slots.length === 1
          ? await this.#attempt(target, "finalize-fixing", {
            address: deployment.addresses.fixingEngine,
            abi: abis.fixingEngine,
            functionName: "finalizeFixing",
            args: [seriesId, seriesVersion, slots[0]!.slot],
          })
          : await this.#attempt(target, "finalize-fixing-vector", {
            address: deployment.addresses.fixingEngine,
            abi: abis.fixingEngine,
            functionName: "finalizeFixingVector",
            args: [seriesId, seriesVersion, slots.map(toAbiSlot)],
          });
        actions.push(executed.action);
        if (executed.transaction) transactions.push(executed.transaction);
      }
    } else {
      actions.push({
        target,
        action: "resolve-fixing",
        outcome: "not-due",
        reason: `awaiting fixing evidence (${statuses.map((status) => enumName(fixingStatusNames, status)).join(", ")}); terminal fallback opens at ${schedule.finalResolutionAt}`,
      });
    }

    const results = await Promise.all(slots.map((slot) =>
      client.read("read final fixing", (reader) =>
        reader.readContract({ address: deployment.addresses.fixingEngine, abi: abis.fixingEngine, functionName: "getFinalizedFixing", args: [seriesId, seriesVersion, slot.slot] }),
      ),
    ));
    return completed(
      {
        workType: "resolve-fixing",
        marketKey: requireMarketBySeries(deployment, seriesId).marketKey,
        seriesId,
        seriesVersion,
        chainTime: now,
        schedule: { fixingWindowOpen: schedule.fixingWindowOpen, correctionCutoffAt: schedule.correctionCutoffAt, finalResolutionAt: schedule.finalResolutionAt },
        fixings: results.map((result, index) => ({
          slot: slots[index]!.slot,
          resolution: enumName(fixingResolutionNames, result.resolutionKind),
          resultHash: result.resultHash,
          value: result.value,
          decimals: result.decimals,
        })),
        actions: [...actions],
      },
      transactions,
    );
  }

  async #settlePositions(intent: KeeperWorkIntent, work: PayloadReader): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const seriesId = this.#seriesFor(intent, work);
    const seriesVersion = work.integer("seriesVersion", { fallback: 1, min: 1 });
    const schedule = await this.#catalog.schedule(seriesId, seriesVersion);
    const slots = (await this.#catalog.fixingSlots(seriesId, seriesVersion)).map(toAbiSlot);
    const positionIds = work.has("positionIds") ? work.bytes32List("positionIds") : await this.#catalog.positionIds(seriesId);
    const now = await client.chainNow();
    const coordinator = deployment.addresses.cashSettlementCoordinator;
    const actions: KeeperAction[] = [];
    const transactions: OperatorTransaction[] = [];
    const settlements: JsonObject[] = [];
    const finalStatuses = await Promise.all(slots.map((slot) =>
      client.read("read fixing status", (reader) =>
        reader.readContract({ address: deployment.addresses.fixingEngine, abi: abis.fixingEngine, functionName: "fixingStatus", args: [seriesId, seriesVersion, slot.slot] }),
      ),
    ));
    const normalReady = finalStatuses.every((status) => status === fixingStatus.finalized)
      || (now >= schedule.correctionCutoffAt && finalStatuses.every((status) => status === fixingStatus.proposed || status === fixingStatus.finalized));

    for (const positionId of positionIds) {
      const target = `position ${positionId}`;
      const existing = await client.read("read settlement", (reader) =>
        reader.readContract({ address: coordinator, abi: abis.cashSettlementCoordinator, functionName: "settlementOf", args: [positionId] }),
      );
      if (existing !== zeroId) {
        actions.push({ target, action: "settle", outcome: "skipped", reason: `already settled as ${existing}` });
        settlements.push({ positionId, settlementId: existing });
        continue;
      }
      const status = await this.#positionStatus(positionId);
      let executed: { readonly action: KeeperAction; readonly transaction: OperatorTransaction | null };
      if (status === positionStatus.lapsed) {
        executed = await this.#attempt(target, "finalize-lapsed-position", {
          address: coordinator,
          abi: abis.cashSettlementCoordinator,
          functionName: "finalizeLapsedPosition",
          args: [positionId, []],
        });
      } else if (now >= schedule.finalResolutionAt) {
        executed = await this.#attempt(target, "finalize-terminal-disruption", {
          address: coordinator,
          abi: abis.cashSettlementCoordinator,
          functionName: "finalizeTerminalDisruption",
          args: [positionId, slots, []],
        });
      } else if (normalReady) {
        executed = await this.#attempt(target, "finalize-normal-settlement", {
          address: coordinator,
          abi: abis.cashSettlementCoordinator,
          functionName: "finalizeNormalSettlement",
          args: [positionId, slots, []],
        });
      } else {
        actions.push({
          target,
          action: "settle",
          outcome: "not-due",
          reason: `position is ${enumName(positionStatusNames, status)}; no final fixing yet and the terminal fallback opens at ${schedule.finalResolutionAt}`,
        });
        continue;
      }
      actions.push(executed.action);
      if (executed.transaction) transactions.push(executed.transaction);
      if (executed.action.outcome === "executed") {
        const settlementId = await client.read("read settlement", (reader) =>
          reader.readContract({ address: coordinator, abi: abis.cashSettlementCoordinator, functionName: "settlementOf", args: [positionId] }),
        );
        const after = await this.#positionStatus(positionId);
        settlements.push({ positionId, settlementId, positionStatus: enumName(positionStatusNames, after) });
      }
    }
    return completed({ workType: "settle-positions", marketKey: requireMarketBySeries(deployment, seriesId).marketKey, seriesId, seriesVersion, chainTime: now, settlements, actions: [...actions] }, transactions);
  }

  async #recover(work: PayloadReader): Promise<OperatorExecutionResult> {
    const client = this.#client;
    const { deployment } = client;
    const now = await client.chainNow();
    const actions: KeeperAction[] = [];
    const transactions: OperatorTransaction[] = [];
    const record = (executed: { readonly action: KeeperAction; readonly transaction: OperatorTransaction | null }) => {
      actions.push(executed.action);
      if (executed.transaction) transactions.push(executed.transaction);
    };

    for (const entry of work.objects("actions")) {
      const kind = entry.oneOf("kind", recoveryKinds);
      const id = entry.bytes32("id");
      const target = `${kind} ${id}`;
      switch (kind) {
        case "expire-risk-admission":
          record(await this.#attempt(target, kind, { address: deployment.addresses.portfolioRiskEngine, abi: abis.portfolioRiskEngine, functionName: "expireAdmission", args: [id] }));
          break;
        case "release-expired-lock":
          record(await this.#attempt(target, kind, { address: deployment.addresses.collateralVault, abi: abis.collateralVault, functionName: "releaseExpiredLock", args: [id] }));
          break;
        case "expire-quote-capacity":
          record(await this.#attempt(target, kind, { address: deployment.addresses.privateRfqBook, abi: abis.privateRfqBook, functionName: "expireQuoteCapacity", args: [id] }));
          break;
        case "expire-rfq":
          record(await this.#attempt(target, kind, { address: deployment.addresses.privateRfqBook, abi: abis.privateRfqBook, functionName: "expireRfq", args: [id] }));
          break;
        case "finalize-terminal-reservation":
          record(await this.#attempt(target, kind, { address: deployment.addresses.collateralVault, abi: abis.collateralVault, functionName: "finalizeTerminalLiabilityReservation", args: [id] }));
          break;
        case "materialize-terminal-claim":
          record(await this.#attempt(target, kind, { address: deployment.addresses.collateralVault, abi: abis.collateralVault, functionName: "materializeTerminalClaimAfterFinalResolution", args: [id] }));
          break;
        case "fulfill-terminal-claim":
          record(await this.#attempt(target, kind, { address: deployment.addresses.collateralVault, abi: abis.collateralVault, functionName: "fulfillTerminalClaim", args: [id] }));
          break;
      }
    }

    for (const positionId of work.bytes32List("positionIds")) {
      const [economics] = await client.read("read position", (reader) =>
        reader.readContract({ address: deployment.addresses.positionEngine, abi: abis.positionEngine, functionName: "getPosition", args: [positionId] }),
      );
      for (const [side, reservationId] of [["long", economics.longReservationId], ["short", economics.shortReservationId]] as const) {
        if (reservationId === zeroId) continue;
        const target = `position ${positionId} ${side} reservation ${reservationId}`;
        const status = await client.read("read terminal reservation", (reader) =>
          reader.readContract({
            address: deployment.addresses.collateralVault,
            abi: abis.collateralVault,
            functionName: "terminalLiabilityReservationStatusOf",
            args: [reservationId],
          }),
        );
        if (status !== 1) {
          actions.push({ target, action: "finalize-terminal-reservation", outcome: "skipped", reason: "reservation is no longer active" });
          continue;
        }
        const finalized = await this.#attempt(target, "finalize-terminal-reservation", {
          address: deployment.addresses.collateralVault,
          abi: abis.collateralVault,
          functionName: "finalizeTerminalLiabilityReservation",
          args: [reservationId],
        });
        if (finalized.action.outcome === "executed" || now < economics.finalResolutionAt) {
          record(finalized);
          continue;
        }
        record(await this.#attempt(target, "materialize-terminal-claim", {
          address: deployment.addresses.collateralVault,
          abi: abis.collateralVault,
          functionName: "materializeTerminalClaimAfterFinalResolution",
          args: [reservationId],
        }));
      }
    }
    if (actions.length === 0) throw new OperatorExecutionError("invalid-payload", "recover work needs actions or positionIds");
    return completed({ workType: "recover", chainTime: now, actions: [...actions] }, transactions);
  }

  async #sweep(intent: KeeperWorkIntent, work: PayloadReader): Promise<OperatorExecutionResult> {
    const { deployment } = this.#client;
    if (intent.resourceId.toLowerCase() !== zeroId) {
      throw new OperatorExecutionError("invalid-payload", "a sweep is deployment-scoped; its resourceId must be the zero id");
    }
    const markets: OperatorMarket[] = work.has("marketKeys")
      ? work.strings("marketKeys").map((key) => requireMarket(deployment, key))
      : [...deployment.markets];
    const steps: SweepStep[] = work.has("steps") ? work.strings("steps").map((step) => {
      if (!(sweepSteps as readonly string[]).includes(step)) throw new OperatorExecutionError("invalid-payload", `work.steps has unknown step ${step}`);
      return step as SweepStep;
    }) : [...sweepSteps];
    const seriesVersion = work.integer("seriesVersion", { fallback: 1, min: 1 });
    const now = await this.#client.chainNow();
    const transactions: { label: string; hash: Hex; blockNumber: string; gasUsed: string }[] = [];
    const perMarket: JsonObject[] = [];
    let failures = 0;
    for (const market of markets) {
      const seriesWork = new PayloadReader({ seriesId: market.seriesId, seriesVersion }, `work.${market.marketKey}`);
      const seriesIntent = { ...intent, resourceId: market.seriesId as never };
      const results: Record<string, JsonObject> = {};
      try {
        for (const step of steps) {
          let result: OperatorExecutionResult;
          if (step === "expire-orders") result = await this.#expireOrders(seriesIntent, seriesWork);
          else if (step === "resolve-fixing") result = await this.#resolveFixing(seriesIntent, seriesWork);
          else if (step === "settle-positions") result = await this.#settlePositions(seriesIntent, seriesWork);
          else {
            const positionIds = await this.#catalog.positionIds(market.seriesId);
            if (positionIds.length === 0) {
              results[step] = { actions: [], reason: "no positions on the series" };
              continue;
            }
            result = await this.#recover(new PayloadReader({ positionIds }, `work.${market.marketKey}.recover`));
          }
          const { transactions: stepTransactions, transactionCount: _count, ...details } = result.details as JsonObject & { transactions?: unknown };
          results[step] = details as JsonObject;
          for (const transaction of (Array.isArray(stepTransactions) ? stepTransactions : []) as { label: string; hash: Hex; blockNumber: string }[]) {
            transactions.push({ label: `${market.marketKey}: ${transaction.label}`, hash: transaction.hash, blockNumber: transaction.blockNumber, gasUsed: "0" });
          }
        }
        perMarket.push({ marketKey: market.marketKey, seriesId: market.seriesId, outcome: "swept", steps: results });
      } catch (error) {
        if (error instanceof OperatorExecutionError && error.retryable && !isContractRevert(error)) throw error;
        failures += 1;
        perMarket.push({ marketKey: market.marketKey, seriesId: market.seriesId, outcome: "failed", reason: error instanceof Error ? error.message : String(error), steps: results });
      }
    }
    if (markets.length > 0 && failures === markets.length) {
      throw new OperatorExecutionError("precondition", `keeper sweep failed on every market: ${perMarket.map((entry) => `${String(entry.marketKey)}: ${String(entry.reason)}`).join("; ")}`);
    }
    return completed({ workType: "sweep", chainTime: now, steps: [...steps], markets: perMarket }, transactions);
  }

  /**
   * Simulates first: a contract revert means the work is not due or already done, which is recorded with its decoded
   * reason instead of failing the job. Transport failures still throw so the runtime retries.
   */
  async #attempt(
    target: string,
    action: string,
    call: Parameters<OperatorChainClient["write"]>[1],
    details?: JsonObject,
  ): Promise<{ readonly action: KeeperAction; readonly transaction: OperatorTransaction | null }> {
    try {
      await this.#client.simulate(`${action} ${target}`, call as never);
    } catch (error) {
      if (isContractRevert(error)) {
        return { action: { target, action, outcome: "skipped", reason: String(error.details.reason ?? error.message), details }, transaction: null };
      }
      throw error;
    }
    const result = await this.#client.write(`${action} ${target}`, call as never);
    return {
      action: { target, action, outcome: "executed", transactionHash: result.hash, details },
      transaction: transactionSummary(result),
    };
  }

  async #positionStatus(positionId: Hex): Promise<number> {
    const { deployment } = this.#client;
    return this.#client.read("read position status", (reader) =>
      reader.readContract({ address: deployment.addresses.positionEngine, abi: abis.positionEngine, functionName: "positionStatus", args: [positionId] }),
    );
  }

  #seriesFor(intent: KeeperWorkIntent, work: PayloadReader): Hex {
    const seriesId = work.bytes32("seriesId", intent.resourceId.toLowerCase() as Hex);
    if (seriesId !== intent.resourceId.toLowerCase()) {
      throw new OperatorExecutionError("invalid-payload", `work.seriesId ${seriesId} must equal the intent resourceId ${intent.resourceId}`);
    }
    requireMarketBySeries(this.#client.deployment, seriesId);
    return seriesId;
  }
}
