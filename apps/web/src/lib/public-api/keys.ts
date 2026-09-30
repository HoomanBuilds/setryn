import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { PublicApiError } from "./errors";
import {
  loadStore,
  persist,
  schedulePersist,
  type ApiScope,
  type RateLimitPolicy,
  type RequestLogEntry,
  type StoredApiKey,
} from "./store";
import { bucketStatus } from "./rate-limit";
import { getPartner, isPartnerCode } from "../webhooks/partners";

/**
 * API keys look like `stk_test_<12 hex id>_<43 char base64url secret>`. Only the SHA-256 of the whole key is stored,
 * and the key is returned exactly once, when it is issued. The same hash is the HMAC key for request signatures, so
 * a client derives it from the key it holds and the server never needs the key itself at rest.
 */
const KEY_PATTERN = /^stk_(test|live)_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
export const DEFAULT_RATE_LIMIT: RateLimitPolicy = { capacity: 20, refillPerSecond: 2 };
const MAX_KEYS = 50;
const SCOPES: readonly ApiScope[] = ["read", "trade"];

export function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export interface IssueKeyInput {
  name?: unknown;
  scopes?: unknown;
  signers?: unknown;
  rateLimit?: unknown;
  partnerCode?: unknown;
}

function parseIssueInput(input: IssueKeyInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 64) throw new PublicApiError(400, "INVALID_REQUEST", "name must be 1 to 64 characters.");
  const scopesInput = input.scopes ?? ["read"];
  if (!Array.isArray(scopesInput) || scopesInput.length === 0 || scopesInput.some((scope) => !SCOPES.includes(scope as ApiScope))) {
    throw new PublicApiError(400, "INVALID_REQUEST", "scopes must be a non-empty subset of [\"read\", \"trade\"].");
  }
  const scopes = [...new Set(scopesInput as ApiScope[])];
  // Trading needs to read back the orders, fills and receipts it creates.
  if (scopes.includes("trade") && !scopes.includes("read")) scopes.unshift("read");
  const signersInput = input.signers ?? [];
  if (!Array.isArray(signersInput) || signersInput.length > 10 || signersInput.some((signer) => typeof signer !== "string" || !isAddress(signer))) {
    throw new PublicApiError(400, "INVALID_REQUEST", "signers must be up to 10 EVM addresses.");
  }
  const signers = [...new Set((signersInput as string[]).map((signer) => getAddress(signer).toLowerCase()))];
  let rateLimit = DEFAULT_RATE_LIMIT;
  if (input.rateLimit !== undefined) {
    const candidate = input.rateLimit as Partial<RateLimitPolicy> | null;
    const capacity = Number(candidate?.capacity);
    const refillPerSecond = Number(candidate?.refillPerSecond);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200 || !Number.isFinite(refillPerSecond) || refillPerSecond <= 0 || refillPerSecond > 50) {
      throw new PublicApiError(400, "INVALID_REQUEST", "rateLimit needs an integer capacity of 1 to 200 and a refillPerSecond above 0 and at most 50.");
    }
    rateLimit = { capacity, refillPerSecond };
  }
  return { name, scopes, signers, rateLimit };
}

export async function issueKey(input: IssueKeyInput): Promise<{ key: string; record: StoredApiKey }> {
  const parsed = parseIssueInput(input);
  let partnerCode: string | null = null;
  if (input.partnerCode !== undefined && input.partnerCode !== null && input.partnerCode !== "") {
    const partner = isPartnerCode(input.partnerCode) ? await getPartner(input.partnerCode) : null;
    if (!partner) throw new PublicApiError(400, "INVALID_REQUEST", "partnerCode must name an existing partner deployment.");
    partnerCode = partner.code;
  }
  const store = await loadStore();
  if (store.keys.filter((key) => !key.revokedAt).length >= MAX_KEYS) {
    throw new PublicApiError(409, "INVALID_REQUEST", `At most ${MAX_KEYS} active keys are allowed. Revoke one first.`);
  }
  const id = randomBytes(6).toString("hex");
  const key = `stk_test_${id}_${randomBytes(32).toString("base64url")}`;
  const record: StoredApiKey = {
    id,
    name: parsed.name,
    prefix: `stk_test_${id}`,
    secretHash: hashKey(key),
    scopes: parsed.scopes,
    signers: parsed.signers,
    rateLimit: parsed.rateLimit,
    partnerCode,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    usage: { requests: 0, errors: 0, rateLimited: 0, replayRejected: 0 },
  };
  store.keys.push(record);
  await persist();
  return { key, record };
}

export async function revokeKey(id: string): Promise<StoredApiKey> {
  const store = await loadStore();
  const record = store.keys.find((key) => key.id === id);
  if (!record) throw new PublicApiError(404, "NOT_FOUND", "No API key has that id.");
  record.revokedAt ??= new Date().toISOString();
  await persist();
  return record;
}

/** Resolves a bearer key to its record; the hash comparison is constant-time. */
export async function verifyKey(key: string): Promise<StoredApiKey> {
  const match = KEY_PATTERN.exec(key);
  if (!match) throw new PublicApiError(401, "INVALID_API_KEY", "The API key is malformed.");
  const store = await loadStore();
  const record = store.keys.find((candidate) => candidate.id === match[2]);
  const presented = Buffer.from(hashKey(key), "hex");
  const expected = Buffer.from(record?.secretHash ?? "0".repeat(64), "hex");
  if (!record || !timingSafeEqual(presented, expected)) {
    throw new PublicApiError(401, "INVALID_API_KEY", "The API key is not recognized.");
  }
  if (record.revokedAt) throw new PublicApiError(401, "API_KEY_REVOKED", "The API key was revoked.");
  return record;
}

export function recordUsage(record: StoredApiKey, status: number, code?: string): void {
  record.lastUsedAt = new Date().toISOString();
  record.usage.requests += 1;
  if (status >= 400) record.usage.errors += 1;
  if (code === "RATE_LIMITED") record.usage.rateLimited += 1;
  if (code === "NONCE_REUSED" || code === "TIMESTAMP_OUT_OF_WINDOW" || code === "INVALID_SIGNATURE") record.usage.replayRejected += 1;
  schedulePersist();
}

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  signers: string[];
  rateLimit: RateLimitPolicy & { remaining: number; resetSeconds: number };
  partnerCode: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "ACTIVE" | "REVOKED";
  usage: StoredApiKey["usage"];
  recentRequests: RequestLogEntry[];
}

export async function listKeys(): Promise<ApiKeyView[]> {
  const store = await loadStore();
  return store.keys
    .map((record) => {
      const bucket = bucketStatus(record.id, record.rateLimit);
      return {
        id: record.id,
        name: record.name,
        prefix: record.prefix,
        scopes: record.scopes,
        signers: record.signers,
        rateLimit: { ...record.rateLimit, remaining: bucket.remaining, resetSeconds: bucket.resetSeconds },
        partnerCode: record.partnerCode ?? null,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt,
        revokedAt: record.revokedAt,
        status: record.revokedAt ? ("REVOKED" as const) : ("ACTIVE" as const),
        usage: record.usage,
        recentRequests: store.logs[record.id] ?? [],
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
