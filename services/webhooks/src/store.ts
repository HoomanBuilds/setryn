import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseConfigured, readDocument, updateDocument } from "@setryn/persistence";

import type { ChainCursor, WebhookDelivery, WebhookEvent, WebhookSubscription } from "./types.ts";

/**
 * JSON file store under `.setryn/webhooks/`. The web app (subscription management, test sends) and the worker (chain
 * events, deliveries) share these files, so every read-modify-write takes a directory lock and replaces the file
 * atomically. The file layout is the contract with `apps/web/src/lib/webhooks/store.ts`.
 */
export const STORE_FILES = {
  subscriptions: "subscriptions.json",
  deliveries: "deliveries.json",
  events: "events.json",
  cursor: "cursor.json",
} as const;

/** Retained history; completed deliveries and old events beyond these are pruned oldest first. */
export const MAX_EVENTS = 5_000;
export const MAX_DELIVERIES = 5_000;

const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 5_000;

export function defaultStoreDirectory(): string {
  if (process.env.SETRYN_WEBHOOKS_DIR) return resolve(process.env.SETRYN_WEBHOOKS_DIR);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return join(repoRoot, ".setryn", "webhooks");
}

interface SubscriptionFile { version: 1; subscriptions: WebhookSubscription[] }
interface DeliveryFile { version: 1; deliveries: WebhookDelivery[] }
interface EventFile { version: 1; events: WebhookEvent[] }
interface CursorFile { version: 1; cursor: ChainCursor | null }

export class WebhookStore {
  readonly directory: string;

  constructor(directory = defaultStoreDirectory()) {
    this.directory = directory;
  }

  private path(name: keyof typeof STORE_FILES): string {
    return join(this.directory, STORE_FILES[name]);
  }

  private async read<T>(name: keyof typeof STORE_FILES, empty: T): Promise<T> {
    if (databaseConfigured()) return readDocument("webhooks", STORE_FILES[name], empty);
    try {
      return JSON.parse(await readFile(this.path(name), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw error;
    }
  }

  private async write(name: keyof typeof STORE_FILES, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.path(name);
    const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  /** Runs `mutate` under the file's lock; the returned `next` value is written back when it is not undefined. */
  private async update<T, R>(name: keyof typeof STORE_FILES, empty: T, mutate: (current: T) => { next?: T; result: R }): Promise<R> {
    if (databaseConfigured()) return updateDocument("webhooks", STORE_FILES[name], empty, mutate);
    const release = await this.lock(name);
    try {
      const current = await this.read(name, empty);
      const { next, result } = mutate(current);
      if (next !== undefined) await this.write(name, next);
      return result;
    } finally {
      await release();
    }
  }

  private async lock(name: keyof typeof STORE_FILES): Promise<() => Promise<void>> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = `${this.path(name)}.lock`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        await mkdir(lockPath);
        return async () => {
          await rm(lockPath, { recursive: true, force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = await stat(lockPath).catch(() => null);
        if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${lockPath}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 15 + Math.random() * 25));
      }
    }
  }

  // Subscriptions ------------------------------------------------------------------------------------------------

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    return (await this.read<SubscriptionFile>("subscriptions", { version: 1, subscriptions: [] })).subscriptions;
  }

  async upsertSubscription(subscription: WebhookSubscription): Promise<void> {
    await this.update<SubscriptionFile, void>("subscriptions", { version: 1, subscriptions: [] }, (file) => ({
      next: { version: 1, subscriptions: [...file.subscriptions.filter((item) => item.id !== subscription.id), subscription] },
      result: undefined,
    }));
  }

  async deleteSubscription(id: string): Promise<boolean> {
    return this.update<SubscriptionFile, boolean>("subscriptions", { version: 1, subscriptions: [] }, (file) => {
      const remaining = file.subscriptions.filter((item) => item.id !== id);
      return remaining.length === file.subscriptions.length
        ? { result: false }
        : { next: { version: 1, subscriptions: remaining }, result: true };
    });
  }

  // Events -------------------------------------------------------------------------------------------------------

  async listEvents(): Promise<WebhookEvent[]> {
    return (await this.read<EventFile>("events", { version: 1, events: [] })).events;
  }

  /** Appends events not yet recorded (by id) and returns only the new ones. */
  async appendEvents(events: readonly WebhookEvent[]): Promise<WebhookEvent[]> {
    if (events.length === 0) return [];
    return this.update<EventFile, WebhookEvent[]>("events", { version: 1, events: [] }, (file) => {
      const known = new Set(file.events.map((event) => event.id));
      const fresh = events.filter((event) => {
        if (known.has(event.id)) return false;
        known.add(event.id);
        return true;
      });
      if (fresh.length === 0) return { result: [] };
      return { next: { version: 1, events: [...file.events, ...fresh].slice(-MAX_EVENTS) }, result: fresh };
    });
  }

  // Deliveries ---------------------------------------------------------------------------------------------------

  async listDeliveries(): Promise<WebhookDelivery[]> {
    return (await this.read<DeliveryFile>("deliveries", { version: 1, deliveries: [] })).deliveries;
  }

  /** Enqueues deliveries whose id is new; existing ids are left untouched (idempotent). */
  async enqueueDeliveries(deliveries: readonly WebhookDelivery[]): Promise<number> {
    if (deliveries.length === 0) return 0;
    return this.update<DeliveryFile, number>("deliveries", { version: 1, deliveries: [] }, (file) => {
      const known = new Set(file.deliveries.map((delivery) => delivery.id));
      const fresh = deliveries.filter((delivery) => !known.has(delivery.id));
      if (fresh.length === 0) return { result: 0 };
      return { next: { version: 1, deliveries: pruneDeliveries([...file.deliveries, ...fresh]) }, result: fresh.length };
    });
  }

  /** Leases up to `limit` due deliveries for `leaseMs`, so a concurrent sender skips them. */
  async leaseDueDeliveries(now: Date, limit: number, leaseMs: number): Promise<WebhookDelivery[]> {
    return this.update<DeliveryFile, WebhookDelivery[]>("deliveries", { version: 1, deliveries: [] }, (file) => {
      const leased: WebhookDelivery[] = [];
      const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
      const next = file.deliveries.map((delivery) => {
        if (leased.length >= limit) return delivery;
        if (delivery.status !== "pending" && delivery.status !== "retrying") return delivery;
        if (delivery.nextAttemptAt && Date.parse(delivery.nextAttemptAt) > now.getTime()) return delivery;
        if (delivery.leaseUntil && Date.parse(delivery.leaseUntil) > now.getTime()) return delivery;
        const updated = { ...delivery, leaseUntil };
        leased.push(updated);
        return updated;
      });
      return leased.length === 0 ? { result: [] } : { next: { version: 1, deliveries: next }, result: leased };
    });
  }

  async saveDelivery(delivery: WebhookDelivery): Promise<void> {
    await this.update<DeliveryFile, void>("deliveries", { version: 1, deliveries: [] }, (file) => ({
      next: { version: 1, deliveries: file.deliveries.map((item) => (item.id === delivery.id ? delivery : item)) },
      result: undefined,
    }));
  }

  // Cursor -------------------------------------------------------------------------------------------------------

  async readCursor(): Promise<ChainCursor | null> {
    return (await this.read<CursorFile>("cursor", { version: 1, cursor: null })).cursor;
  }

  async writeCursor(cursor: ChainCursor, allowRewind = false): Promise<void> {
    await this.update<CursorFile, void>("cursor", { version: 1, cursor: null }, (file) => {
      if (!allowRewind && file.cursor?.chainId === cursor.chainId && BigInt(file.cursor.nextBlock) > BigInt(cursor.nextBlock)) {
        return { result: undefined };
      }
      return { next: { version: 1, cursor }, result: undefined };
    });
  }
}

function pruneDeliveries(deliveries: WebhookDelivery[]): WebhookDelivery[] {
  if (deliveries.length <= MAX_DELIVERIES) return deliveries;
  let excess = deliveries.length - MAX_DELIVERIES;
  // Completed deliveries go first; pending and retrying work is never dropped.
  return deliveries.filter((delivery) => {
    if (excess > 0 && (delivery.status === "succeeded" || delivery.status === "failed")) {
      excess -= 1;
      return false;
    }
    return true;
  });
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deliveryId(eventId: string, subscriptionId: string): string {
  return `dlv_${sha256Hex(`${eventId}:${subscriptionId}`).slice(0, 32)}`;
}

export function newSubscriptionId(): string {
  return `whsub_${randomBytes(12).toString("hex")}`;
}

export function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}
