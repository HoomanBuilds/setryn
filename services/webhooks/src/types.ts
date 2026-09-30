/**
 * Public webhook contract. Every event type is derived from confirmed chain logs; the payload carries enough source
 * identity (contract, event, block hash, transaction hash, log index) for a consumer to re-derive it from the chain.
 */
export const WEBHOOK_EVENT_TYPES = [
  "order.registered",
  "order.filled",
  "order.cancelled",
  "position.opened",
  "position.status",
  "position.exercised",
  "position.lapsed",
  "position.closed",
  "fixing.proposed",
  "fixing.disputed",
  "fixing.finalized",
  "settlement.finalized",
  "settlement.claim_created",
  "settlement.claim_fulfilled",
  "receipt.ready",
  "market.status",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_API_VERSION = "2026-09-01";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface WebhookEventSource {
  readonly contractName: string;
  readonly contractAddress: string;
  readonly eventName: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: number;
}

export interface WebhookEvent {
  /** Stable across re-polls of the same log: `evt_` + sha256(chainId:blockHash:txHash:logIndex:type). */
  readonly id: string;
  readonly type: WebhookEventType;
  readonly apiVersion: string;
  /** Block timestamp of the source log, ISO-8601. */
  readonly createdAt: string;
  readonly network: { readonly chainId: number; readonly environment: string };
  readonly livemode: false;
  readonly test: boolean;
  readonly data: JsonObject;
  readonly source: WebhookEventSource | null;
}

export interface WebhookSubscription {
  readonly id: string;
  /** Owner scope: an API key id once public-api keys exist, `local-devnet` for loopback management. */
  readonly ownerId: string;
  readonly url: string;
  readonly description: string;
  readonly eventTypes: readonly WebhookEventType[];
  readonly partnerCode: string | null;
  readonly active: boolean;
  readonly secret: string;
  /** During rotation the previous secret keeps signing (as a second v1) until this instant. */
  readonly previousSecret: string | null;
  readonly previousSecretExpiresAt: string | null;
  /** Only events from blocks strictly after this block are delivered. */
  readonly startBlock: string;
  readonly chainId: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DeliveryStatus = "pending" | "retrying" | "succeeded" | "failed";

export interface DeliveryAttempt {
  readonly attempt: number;
  readonly at: string;
  readonly statusCode: number | null;
  readonly error: string | null;
  readonly durationMs: number;
}

export interface WebhookDelivery {
  /** `dlv_` + sha256(eventId:subscriptionId): enqueueing the same event twice is a no-op. */
  readonly id: string;
  readonly subscriptionId: string;
  readonly eventId: string;
  readonly eventType: WebhookEventType;
  readonly url: string;
  readonly body: string;
  readonly status: DeliveryStatus;
  readonly attempts: readonly DeliveryAttempt[];
  readonly maxAttempts: number;
  readonly nextAttemptAt: string | null;
  /** Lease held by whichever process is sending; others skip the delivery until it lapses. */
  readonly leaseUntil: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChainCursor {
  readonly chainId: number;
  /** First block not yet scanned. */
  readonly nextBlock: string;
  /** Recently scanned block hashes, oldest first, for reorg detection. */
  readonly recent: readonly { readonly number: string; readonly hash: string }[];
  readonly updatedAt: string;
}

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === "string" && (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}
