import type { ChainReader } from "./chain.ts";
import { attemptDelivery, DEFAULT_RETRY_POLICY, newDelivery, subscriptionMatches, type RetryPolicy } from "./delivery.ts";
import { deriveWebhookEvents } from "./events.ts";
import type { WebhookStore } from "./store.ts";
import type { ChainCursor, WebhookDelivery } from "./types.ts";

export interface WorkerOptions {
  /** Blocks behind head before a log is considered final. */
  readonly confirmations: number;
  /** Largest block range per getLogs call. */
  readonly maxBlockRange: number;
  /** First block to scan when no cursor exists. */
  readonly startBlock: bigint;
  readonly retry: RetryPolicy;
  readonly deliveryConcurrency: number;
  readonly log: (entry: Record<string, unknown>) => void;
}

const RECENT_BLOCKS = 64;

export const DEFAULT_WORKER_OPTIONS: WorkerOptions = {
  confirmations: 0,
  maxBlockRange: 2_000,
  startBlock: 0n,
  retry: DEFAULT_RETRY_POLICY,
  deliveryConcurrency: 8,
  log: (entry) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry })),
};

export interface PollResult {
  readonly scanned: readonly [bigint, bigint] | null;
  readonly events: number;
  readonly enqueued: number;
  readonly reorg: boolean;
}

export class WebhookWorker {
  readonly store: WebhookStore;
  readonly chain: ChainReader;
  readonly options: WorkerOptions;

  constructor(store: WebhookStore, chain: ChainReader, options: Partial<WorkerOptions> = {}) {
    this.store = store;
    this.chain = chain;
    this.options = { ...DEFAULT_WORKER_OPTIONS, ...options };
  }

  /**
   * Scans the next confirmed block range. Before scanning, the last recorded block hash is re-read; on mismatch the
   * cursor walks back to the newest recorded block that still matches (or to genesis when none does) and rescans.
   * Event ids include the block hash, so a rescanned canonical log that already produced an event is deduplicated,
   * while a log that moved to a different block produces a new event.
   */
  async pollChainOnce(): Promise<PollResult> {
    const chainId = this.chain.config.chainId;
    let cursor: ChainCursor = (await this.store.readCursor()) ?? {
      chainId,
      nextBlock: this.options.startBlock.toString(),
      recent: [],
      updatedAt: new Date().toISOString(),
    };
    if (cursor.chainId !== chainId) throw new Error(`cursor belongs to chain ${cursor.chainId}`);

    const head = await this.chain.head();
    let reorg = false;
    const recent = [...cursor.recent];
    while (recent.length > 0) {
      const last = recent[recent.length - 1];
      const current = BigInt(last.number) <= head ? await this.chain.block(BigInt(last.number), true) : null;
      if (current && current.hash.toLowerCase() === last.hash.toLowerCase()) break;
      reorg = true;
      recent.pop();
    }
    if (reorg) {
      const nextBlock = recent.length > 0 ? (BigInt(recent[recent.length - 1].number) + 1n).toString() : "0";
      this.options.log({ event: "reorg-detected", previousNextBlock: cursor.nextBlock, rewoundTo: nextBlock });
      cursor = { ...cursor, nextBlock, recent, updatedAt: new Date().toISOString() };
      await this.store.writeCursor(cursor);
    }

    const safeHead = head - BigInt(this.options.confirmations);
    const from = BigInt(cursor.nextBlock);
    if (safeHead < from) return { scanned: null, events: 0, enqueued: 0, reorg };
    const to = from + BigInt(this.options.maxBlockRange - 1) < safeHead ? from + BigInt(this.options.maxBlockRange - 1) : safeHead;

    const logs = await this.chain.decodedLogs(from, to);
    const derived = deriveWebhookEvents({ chainId, environment: this.chain.config.environment }, logs);
    const fresh = await this.store.appendEvents(derived);

    const subscriptions = await this.store.listSubscriptions();
    const deliveries: WebhookDelivery[] = [];
    for (const event of fresh) {
      for (const subscription of subscriptions) {
        if (subscriptionMatches(subscription, event)) deliveries.push(newDelivery(subscription, event, this.options.retry));
      }
    }
    const enqueued = await this.store.enqueueDeliveries(deliveries);

    const tip = await this.chain.block(to, true);
    if (!tip) throw new Error(`block ${to} unavailable`);
    await this.store.writeCursor({
      chainId,
      nextBlock: (to + 1n).toString(),
      recent: [...recent, { number: to.toString(), hash: tip.hash.toLowerCase() }].slice(-RECENT_BLOCKS),
      updatedAt: new Date().toISOString(),
    });
    if (fresh.length > 0 || enqueued > 0) {
      this.options.log({
        event: "chain-scanned",
        fromBlock: from.toString(),
        toBlock: to.toString(),
        head: head.toString(),
        confirmations: this.options.confirmations,
        derived: derived.length,
        newEvents: fresh.length,
        types: countBy(fresh.map((item) => item.type)),
        enqueued,
      });
    }
    return { scanned: [from, to], events: fresh.length, enqueued, reorg };
  }

  /** Sends every due delivery once (leased so the web app's test sender never double-sends). */
  async deliverDueOnce(now = new Date()): Promise<WebhookDelivery[]> {
    const leased = await this.store.leaseDueDeliveries(now, this.options.deliveryConcurrency, this.options.retry.timeoutMs + 5_000);
    if (leased.length === 0) return [];
    const subscriptions = new Map((await this.store.listSubscriptions()).map((item) => [item.id, item]));
    const results = await Promise.all(
      leased.map(async (delivery) => {
        const next = await attemptDelivery(delivery, subscriptions.get(delivery.subscriptionId), this.options.retry, now);
        await this.store.saveDelivery(next);
        const last = next.attempts[next.attempts.length - 1];
        this.options.log({
          event: "delivery-attempt",
          deliveryId: next.id,
          eventType: next.eventType,
          subscriptionId: next.subscriptionId,
          attempt: last?.attempt,
          statusCode: last?.statusCode,
          error: last?.error,
          status: next.status,
          nextAttemptAt: next.nextAttemptAt,
        });
        return next;
      }),
    );
    return results;
  }

  /** Earliest scheduled retry, so the loop can sleep precisely. */
  async nextDueAt(): Promise<number | null> {
    const pending = (await this.store.listDeliveries())
      .filter((delivery) => (delivery.status === "pending" || delivery.status === "retrying") && delivery.nextAttemptAt)
      .map((delivery) => Date.parse(delivery.nextAttemptAt!));
    return pending.length === 0 ? null : Math.min(...pending);
  }
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
