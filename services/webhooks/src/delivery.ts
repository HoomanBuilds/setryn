import { signPayload, SIGNATURE_HEADER } from "./signature.ts";
import { deliveryId } from "./store.ts";
import type { DeliveryAttempt, WebhookDelivery, WebhookEvent, WebhookSubscription } from "./types.ts";

export interface RetryPolicy {
  readonly maxAttempts: number;
  /** Delay before the second attempt; each later attempt doubles it. */
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly timeoutMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 8,
  baseDelayMs: 30_000,
  maxDelayMs: 6 * 60 * 60_000,
  timeoutMs: 10_000,
};

/** Exponential backoff with +/-20% jitter: base * 2^(attempt-1), capped. `attempt` is the number of failures so far. */
export function backoffDelayMs(policy: RetryPolicy, attempt: number, random = Math.random): number {
  const raw = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.8 + random() * 0.4));
}

export function subscriptionMatches(subscription: WebhookSubscription, event: WebhookEvent): boolean {
  if (!subscription.active || subscription.chainId !== event.network.chainId) return false;
  if (!subscription.eventTypes.includes(event.type)) return false;
  if (event.test) return true;
  return event.source !== null && BigInt(event.source.blockNumber) > BigInt(subscription.startBlock);
}

export function newDelivery(subscription: WebhookSubscription, event: WebhookEvent, policy: RetryPolicy, now = new Date()): WebhookDelivery {
  const at = now.toISOString();
  return {
    id: deliveryId(event.id, subscription.id),
    subscriptionId: subscription.id,
    eventId: event.id,
    eventType: event.type,
    url: subscription.url,
    body: JSON.stringify(event),
    status: "pending",
    attempts: [],
    maxAttempts: policy.maxAttempts,
    nextAttemptAt: at,
    leaseUntil: null,
    createdAt: at,
    updatedAt: at,
  };
}

/** Secrets that sign a delivery now: the current one, plus the previous one while its rotation grace lasts. */
export function signingSecrets(subscription: WebhookSubscription, now = new Date()): string[] {
  const secrets = [subscription.secret];
  if (
    subscription.previousSecret &&
    subscription.previousSecretExpiresAt &&
    Date.parse(subscription.previousSecretExpiresAt) > now.getTime()
  ) {
    secrets.push(subscription.previousSecret);
  }
  return secrets;
}

/**
 * Makes one signed attempt and returns the delivery's next state. A 2xx response succeeds; anything else (including
 * timeouts and connection errors) schedules a retry until `maxAttempts`, then marks the delivery failed.
 */
export async function attemptDelivery(
  delivery: WebhookDelivery,
  subscription: WebhookSubscription | undefined,
  policy: RetryPolicy,
  now = new Date(),
): Promise<WebhookDelivery> {
  const attemptNumber = delivery.attempts.length + 1;
  const started = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;

  if (!subscription || !subscription.active) {
    error = subscription ? "SUBSCRIPTION_DISABLED" : "SUBSCRIPTION_DELETED";
  } else {
    const timestamp = Math.floor(now.getTime() / 1000);
    const event = JSON.parse(delivery.body) as WebhookEvent;
    try {
      const response = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Setryn-Webhooks/1.0",
          [SIGNATURE_HEADER]: signPayload(delivery.body, signingSecrets(subscription, now), timestamp),
          "Setryn-Event-Id": event.id,
          "Setryn-Event-Type": event.type,
          "Setryn-Delivery-Id": delivery.id,
          "Setryn-Delivery-Attempt": String(attemptNumber),
        },
        body: delivery.body,
        redirect: "manual",
        signal: AbortSignal.timeout(policy.timeoutMs),
      });
      statusCode = response.status;
      await response.body?.cancel().catch(() => undefined);
      if (response.status < 200 || response.status >= 300) error = `HTTP_${response.status}`;
    } catch (caught) {
      error = caught instanceof Error ? (caught.name === "TimeoutError" ? "TIMEOUT" : caught.message.slice(0, 160)) : "DELIVERY_ERROR";
    }
  }

  const attempt: DeliveryAttempt = {
    attempt: attemptNumber,
    at: now.toISOString(),
    statusCode,
    error,
    durationMs: Date.now() - started,
  };
  const attempts = [...delivery.attempts, attempt];
  const updatedAt = new Date().toISOString();
  if (error === null) {
    return { ...delivery, attempts, status: "succeeded", nextAttemptAt: null, leaseUntil: null, updatedAt };
  }
  const terminal = attemptNumber >= delivery.maxAttempts || error === "SUBSCRIPTION_DELETED";
  return {
    ...delivery,
    attempts,
    status: terminal ? "failed" : "retrying",
    nextAttemptAt: terminal ? null : new Date(now.getTime() + backoffDelayMs(policy, attemptNumber)).toISOString(),
    leaseUntil: null,
    updatedAt,
  };
}
