import { createHash, randomBytes } from "node:crypto";
import { createPublicClient, http } from "viem";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";
import { readJson, setrynDataDirectory, updateJson } from "./json-store";
import { signPayload, SIGNATURE_HEADER } from "./signature";
import {
  isWebhookEventType,
  WEBHOOK_API_VERSION,
  WEBHOOK_EVENT_TYPES,
  type ChainCursor,
  type DeliveryAttempt,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookEventType,
  type WebhookSubscription,
} from "./types";

/**
 * Subscription management and test sends for the web API. Chain-derived events and retries are the worker's job
 * (`services/webhooks`); both sides share the `.setryn/webhooks` store.
 */
const FILES = { subscriptions: "subscriptions.json", deliveries: "deliveries.json", events: "events.json", cursor: "cursor.json" };
const LOCAL_CHAIN_ID = 31337;
const MAX_SUBSCRIPTIONS_PER_OWNER = 25;
const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 30_000;
const TIMEOUT_MS = 10_000;
const DEFAULT_ROTATION_GRACE_SECONDS = 24 * 60 * 60;

interface SubscriptionFile { version: number; subscriptions: WebhookSubscription[] }
interface DeliveryFile { version: number; deliveries: WebhookDelivery[] }
interface EventFile { version: number; events: WebhookEvent[] }
interface CursorFile { version: number; cursor: ChainCursor | null }

const emptySubscriptions = (): SubscriptionFile => ({ version: 1, subscriptions: [] });
const emptyDeliveries = (): DeliveryFile => ({ version: 1, deliveries: [] });

export class WebhookApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function dir(): string {
  return setrynDataDirectory("webhooks");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface PublicSubscription {
  id: string;
  url: string;
  description: string;
  eventTypes: readonly WebhookEventType[];
  partnerCode: string | null;
  active: boolean;
  secretHint: string;
  rotationGraceUntil: string | null;
  startBlock: string;
  chainId: number;
  createdAt: string;
  updatedAt: string;
}

export function publicSubscription(subscription: WebhookSubscription): PublicSubscription {
  const graceActive =
    subscription.previousSecretExpiresAt !== null && Date.parse(subscription.previousSecretExpiresAt) > Date.now();
  return {
    id: subscription.id,
    url: subscription.url,
    description: subscription.description,
    eventTypes: subscription.eventTypes,
    partnerCode: subscription.partnerCode,
    active: subscription.active,
    secretHint: `whsec_…${subscription.secret.slice(-4)}`,
    rotationGraceUntil: graceActive ? subscription.previousSecretExpiresAt : null,
    startBlock: subscription.startBlock,
    chainId: subscription.chainId,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

async function allSubscriptions(): Promise<WebhookSubscription[]> {
  return (await readJson(dir(), FILES.subscriptions, emptySubscriptions())).subscriptions;
}

export async function listSubscriptions(ownerId: string): Promise<WebhookSubscription[]> {
  return (await allSubscriptions())
    .filter((item) => item.ownerId === ownerId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getSubscription(ownerId: string, id: string): Promise<WebhookSubscription> {
  const found = (await allSubscriptions()).find((item) => item.id === id && item.ownerId === ownerId);
  if (!found) throw new WebhookApiError(404, "SUBSCRIPTION_NOT_FOUND", `No subscription ${id}.`);
  return found;
}

function validateUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2_048) throw new WebhookApiError(400, "INVALID_URL", "url must be an absolute http(s) URL.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new WebhookApiError(400, "INVALID_URL", "url must be an absolute http(s) URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new WebhookApiError(400, "INVALID_URL", "url must use http or https.");
  }
  if (parsed.username || parsed.password) throw new WebhookApiError(400, "INVALID_URL", "url must not embed credentials.");
  return parsed.toString();
}

function validateEventTypes(raw: unknown): WebhookEventType[] {
  if (raw === undefined) return [...WEBHOOK_EVENT_TYPES];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new WebhookApiError(400, "INVALID_EVENT_TYPES", `eventTypes must be a non-empty array of: ${WEBHOOK_EVENT_TYPES.join(", ")}.`);
  }
  const unknown = raw.filter((item) => !isWebhookEventType(item));
  if (unknown.length > 0) throw new WebhookApiError(400, "INVALID_EVENT_TYPES", `Unknown event types: ${unknown.join(", ")}.`);
  return [...new Set(raw as WebhookEventType[])];
}

function validateText(raw: unknown, label: string, max: number): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string" || raw.length > max) throw new WebhookApiError(400, "INVALID_FIELD", `${label} must be a string of at most ${max} characters.`);
  return raw.trim();
}

function validatePartnerCode(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^[a-z0-9][a-z0-9-]{2,31}$/.test(raw)) {
    throw new WebhookApiError(400, "INVALID_PARTNER_CODE", "partnerCode must be 3-32 lowercase letters, digits or hyphens.");
  }
  return raw;
}

async function chainHead(): Promise<bigint | null> {
  try {
    const runtime = await readLocalRuntime();
    return await createPublicClient({ transport: http(runtime.rpcUrl) }).getBlockNumber();
  } catch {
    const cursor = (await readJson<CursorFile>(dir(), FILES.cursor, { version: 1, cursor: null })).cursor;
    return cursor ? BigInt(cursor.nextBlock) - BigInt(1) : null;
  }
}

function newSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export interface CreateSubscriptionInput {
  url?: unknown;
  eventTypes?: unknown;
  description?: unknown;
  partnerCode?: unknown;
  /** Replay events after this block (local devnet only). Defaults to the current head: only new events deliver. */
  fromBlock?: unknown;
}

export async function createSubscription(ownerId: string, input: CreateSubscriptionInput): Promise<WebhookSubscription> {
  const url = validateUrl(input.url);
  const eventTypes = validateEventTypes(input.eventTypes);
  const description = validateText(input.description, "description", 200);
  const partnerCode = validatePartnerCode(input.partnerCode);
  const head = await chainHead();
  let startBlock: string;
  if (input.fromBlock === undefined || input.fromBlock === null) {
    startBlock = (head ?? BigInt(0)).toString();
  } else {
    if (typeof input.fromBlock !== "number" || !Number.isSafeInteger(input.fromBlock) || input.fromBlock < 0) {
      throw new WebhookApiError(400, "INVALID_FROM_BLOCK", "fromBlock must be a non-negative integer.");
    }
    // Deliveries cover blocks strictly after startBlock, so fromBlock N replays block N onward.
    startBlock = input.fromBlock === 0 ? "-1" : String(input.fromBlock - 1);
  }
  const now = new Date().toISOString();
  const subscription: WebhookSubscription = {
    id: `whsub_${randomBytes(12).toString("hex")}`,
    ownerId,
    url,
    description,
    eventTypes,
    partnerCode,
    active: true,
    secret: newSecret(),
    previousSecret: null,
    previousSecretExpiresAt: null,
    startBlock,
    chainId: LOCAL_CHAIN_ID,
    createdAt: now,
    updatedAt: now,
  };
  await updateJson(dir(), FILES.subscriptions, emptySubscriptions(), (file) => {
    if (file.subscriptions.filter((item) => item.ownerId === ownerId).length >= MAX_SUBSCRIPTIONS_PER_OWNER) {
      throw new WebhookApiError(409, "SUBSCRIPTION_LIMIT", `At most ${MAX_SUBSCRIPTIONS_PER_OWNER} subscriptions per owner.`);
    }
    return { next: { version: 1, subscriptions: [...file.subscriptions, subscription] }, result: undefined };
  });
  return subscription;
}

async function mutateSubscription(
  ownerId: string,
  id: string,
  change: (current: WebhookSubscription) => WebhookSubscription,
): Promise<WebhookSubscription> {
  return updateJson(dir(), FILES.subscriptions, emptySubscriptions(), (file) => {
    const current = file.subscriptions.find((item) => item.id === id && item.ownerId === ownerId);
    if (!current) throw new WebhookApiError(404, "SUBSCRIPTION_NOT_FOUND", `No subscription ${id}.`);
    const next = { ...change(current), updatedAt: new Date().toISOString() };
    return { next: { version: 1, subscriptions: file.subscriptions.map((item) => (item.id === id ? next : item)) }, result: next };
  });
}

export async function updateSubscription(
  ownerId: string,
  id: string,
  input: { url?: unknown; eventTypes?: unknown; description?: unknown; active?: unknown },
): Promise<WebhookSubscription> {
  const url = input.url === undefined ? undefined : validateUrl(input.url);
  const eventTypes = input.eventTypes === undefined ? undefined : validateEventTypes(input.eventTypes);
  const description = input.description === undefined ? undefined : validateText(input.description, "description", 200);
  if (input.active !== undefined && typeof input.active !== "boolean") {
    throw new WebhookApiError(400, "INVALID_FIELD", "active must be a boolean.");
  }
  return mutateSubscription(ownerId, id, (current) => ({
    ...current,
    url: url ?? current.url,
    eventTypes: eventTypes ?? current.eventTypes,
    description: description ?? current.description,
    active: typeof input.active === "boolean" ? input.active : current.active,
  }));
}

export async function deleteSubscription(ownerId: string, id: string): Promise<void> {
  await updateJson(dir(), FILES.subscriptions, emptySubscriptions(), (file) => {
    const remaining = file.subscriptions.filter((item) => !(item.id === id && item.ownerId === ownerId));
    if (remaining.length === file.subscriptions.length) {
      throw new WebhookApiError(404, "SUBSCRIPTION_NOT_FOUND", `No subscription ${id}.`);
    }
    return { next: { version: 1, subscriptions: remaining }, result: undefined };
  });
}

/** Issues a new secret. The old one keeps signing (as a second v1) for the grace window so receivers can roll over. */
export async function rotateSecret(ownerId: string, id: string, graceSeconds?: unknown): Promise<WebhookSubscription> {
  const grace = graceSeconds === undefined ? DEFAULT_ROTATION_GRACE_SECONDS : graceSeconds;
  if (typeof grace !== "number" || !Number.isInteger(grace) || grace < 0 || grace > 7 * 24 * 60 * 60) {
    throw new WebhookApiError(400, "INVALID_GRACE", "graceSeconds must be an integer between 0 and 604800.");
  }
  return mutateSubscription(ownerId, id, (current) => ({
    ...current,
    secret: newSecret(),
    previousSecret: grace > 0 ? current.secret : null,
    previousSecretExpiresAt: grace > 0 ? new Date(Date.now() + grace * 1_000).toISOString() : null,
  }));
}

export interface PublicDelivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  eventType: WebhookEventType;
  status: WebhookDelivery["status"];
  attempts: readonly DeliveryAttempt[];
  maxAttempts: number;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  test: boolean;
  blockNumber: string | null;
}

export function publicDelivery(delivery: WebhookDelivery): PublicDelivery {
  let test = false;
  let blockNumber: string | null = null;
  try {
    const event = JSON.parse(delivery.body) as WebhookEvent;
    test = event.test;
    blockNumber = event.source?.blockNumber ?? null;
  } catch {
    // A corrupt body still lists; it fails on its next attempt.
  }
  return {
    id: delivery.id,
    subscriptionId: delivery.subscriptionId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    maxAttempts: delivery.maxAttempts,
    nextAttemptAt: delivery.nextAttemptAt,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
    test,
    blockNumber,
  };
}

export async function listDeliveries(ownerId: string, id: string, limit = 50): Promise<WebhookDelivery[]> {
  await getSubscription(ownerId, id);
  const all = (await readJson(dir(), FILES.deliveries, emptyDeliveries())).deliveries;
  return all
    .filter((item) => item.subscriptionId === id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, Math.min(200, limit)));
}

export async function listEvents(limit = 50, type?: string | null): Promise<WebhookEvent[]> {
  const events = (await readJson<EventFile>(dir(), FILES.events, { version: 1, events: [] })).events;
  return events
    .filter((event) => !type || event.type === type)
    .slice(-Math.max(1, Math.min(500, limit)))
    .reverse();
}

export async function readCursor(): Promise<ChainCursor | null> {
  return (await readJson<CursorFile>(dir(), FILES.cursor, { version: 1, cursor: null })).cursor;
}

function signingSecrets(subscription: WebhookSubscription): string[] {
  const secrets = [subscription.secret];
  if (subscription.previousSecret && subscription.previousSecretExpiresAt && Date.parse(subscription.previousSecretExpiresAt) > Date.now()) {
    secrets.push(subscription.previousSecret);
  }
  return secrets;
}

/**
 * Enqueues a `test: true` event for one subscription and makes the first signed attempt inline, so the caller sees the
 * receiver's answer. A failed attempt is left `retrying` with backoff for the worker to continue.
 */
export async function sendTestEvent(ownerId: string, id: string, rawType: unknown): Promise<WebhookDelivery> {
  const subscription = await getSubscription(ownerId, id);
  const type = rawType === undefined ? subscription.eventTypes[0] : rawType;
  if (!isWebhookEventType(type)) throw new WebhookApiError(400, "INVALID_EVENT_TYPE", `type must be one of: ${WEBHOOK_EVENT_TYPES.join(", ")}.`);
  const nonce = randomBytes(8).toString("hex");
  const event: WebhookEvent = {
    id: `evt_test_${sha256(`${type}:${nonce}`).slice(0, 32)}`,
    type,
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: new Date().toISOString(),
    network: { chainId: LOCAL_CHAIN_ID, environment: "local-devnet" },
    livemode: false,
    test: true,
    data: { message: `Test ${type} delivery from Setryn`, nonce },
    source: null,
  };
  const now = new Date();
  const body = JSON.stringify(event);
  const pending: WebhookDelivery = {
    id: `dlv_${sha256(`${event.id}:${subscription.id}`).slice(0, 32)}`,
    subscriptionId: subscription.id,
    eventId: event.id,
    eventType: type,
    url: subscription.url,
    body,
    status: "pending",
    attempts: [],
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: now.toISOString(),
    // Leased by this request so the worker does not send it concurrently.
    leaseUntil: new Date(now.getTime() + TIMEOUT_MS + 5_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await updateJson(dir(), FILES.deliveries, emptyDeliveries(), (file) => ({
    next: { version: 1, deliveries: [...file.deliveries, pending] },
    result: undefined,
  }));

  const timestamp = Math.floor(now.getTime() / 1000);
  const started = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const response = await fetch(subscription.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Setryn-Webhooks/1.0",
        [SIGNATURE_HEADER]: signPayload(body, signingSecrets(subscription), timestamp),
        "Setryn-Event-Id": event.id,
        "Setryn-Event-Type": type,
        "Setryn-Delivery-Id": pending.id,
        "Setryn-Delivery-Attempt": "1",
      },
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    statusCode = response.status;
    await response.body?.cancel().catch(() => undefined);
    if (response.status < 200 || response.status >= 300) error = `HTTP_${response.status}`;
  } catch (caught) {
    error = caught instanceof Error ? (caught.name === "TimeoutError" ? "TIMEOUT" : caught.message.slice(0, 160)) : "DELIVERY_ERROR";
  }
  const attempt: DeliveryAttempt = { attempt: 1, at: now.toISOString(), statusCode, error, durationMs: Date.now() - started };
  const delay = Math.round(BASE_DELAY_MS * (0.8 + Math.random() * 0.4));
  const settled: WebhookDelivery = {
    ...pending,
    attempts: [attempt],
    status: error === null ? "succeeded" : "retrying",
    nextAttemptAt: error === null ? null : new Date(now.getTime() + delay).toISOString(),
    leaseUntil: null,
    updatedAt: new Date().toISOString(),
  };
  await updateJson(dir(), FILES.deliveries, emptyDeliveries(), (file) => ({
    next: { version: 1, deliveries: file.deliveries.map((item) => (item.id === settled.id ? settled : item)) },
    result: undefined,
  }));
  return settled;
}
