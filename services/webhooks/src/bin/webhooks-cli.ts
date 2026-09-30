import { WebhookStore, newSigningSecret, newSubscriptionId } from "../store.ts";
import { isWebhookEventType, WEBHOOK_EVENT_TYPES, type WebhookEventType, type WebhookSubscription } from "../types.ts";

/**
 * Local subscription management without the web app:
 *
 *   webhooks-cli.ts create --url http://127.0.0.1:4610/hook [--events order.filled,receipt.ready] [--start-block 0]
 *   webhooks-cli.ts list | delete --id whsub_... | deliveries [--id whsub_...]
 */
const [command, ...rest] = process.argv.slice(2);
const args = new Map<string, string>();
for (let index = 0; index < rest.length; index += 2) args.set(rest[index].replace(/^--/, ""), rest[index + 1] ?? "");
const store = new WebhookStore();

if (command === "create") {
  const url = args.get("url");
  if (!url || !/^https?:\/\//.test(url)) throw new TypeError("--url http(s)://... is required");
  const eventTypes = (args.get("events")?.split(",") ?? [...WEBHOOK_EVENT_TYPES]).map((item) => item.trim());
  const invalid = eventTypes.filter((item) => !isWebhookEventType(item));
  if (invalid.length > 0) throw new TypeError(`unknown event types: ${invalid.join(", ")}`);
  const now = new Date().toISOString();
  const subscription: WebhookSubscription = {
    id: newSubscriptionId(),
    ownerId: "local-devnet",
    url,
    description: args.get("description") ?? "CLI subscription",
    eventTypes: eventTypes as WebhookEventType[],
    partnerCode: args.get("partner") ?? null,
    active: true,
    secret: newSigningSecret(),
    previousSecret: null,
    previousSecretExpiresAt: null,
    startBlock: args.get("start-block") ?? "0",
    chainId: 31337,
    createdAt: now,
    updatedAt: now,
  };
  await store.upsertSubscription(subscription);
  console.log(JSON.stringify({ id: subscription.id, secret: subscription.secret, url, eventTypes, startBlock: subscription.startBlock }));
} else if (command === "list") {
  for (const item of await store.listSubscriptions()) {
    console.log(JSON.stringify({ id: item.id, url: item.url, active: item.active, eventTypes: item.eventTypes, startBlock: item.startBlock }));
  }
} else if (command === "delete") {
  console.log(JSON.stringify({ deleted: await store.deleteSubscription(args.get("id") ?? "") }));
} else if (command === "deliveries") {
  const id = args.get("id");
  for (const item of (await store.listDeliveries()).filter((delivery) => !id || delivery.subscriptionId === id)) {
    console.log(JSON.stringify({
      id: item.id,
      type: item.eventType,
      status: item.status,
      attempts: item.attempts.map((attempt) => `${attempt.attempt}@${attempt.at}:${attempt.statusCode ?? attempt.error}`),
      nextAttemptAt: item.nextAttemptAt,
    }));
  }
} else {
  console.error("usage: webhooks-cli.ts create|list|delete|deliveries");
  process.exitCode = 1;
}
