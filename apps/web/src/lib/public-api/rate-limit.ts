import type { RateLimitPolicy } from "./store";

/**
 * Per-key token bucket. Each request takes one token; tokens return at `refillPerSecond` up to `capacity`. Responses
 * carry the IETF RateLimit header fields (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, RateLimit-Policy),
 * and a refused request gets 429 with Retry-After.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const BUCKETS_KEY = Symbol.for("setryn.public-api.buckets");

function buckets(): Map<string, Bucket> {
  const holder = globalThis as unknown as Record<symbol, Map<string, Bucket> | undefined>;
  holder[BUCKETS_KEY] ??= new Map();
  return holder[BUCKETS_KEY];
}

function refill(keyId: string, policy: RateLimitPolicy, now: number): Bucket {
  const bucket = buckets().get(keyId) ?? { tokens: policy.capacity, updatedAt: now };
  const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(policy.capacity, bucket.tokens + elapsed * policy.refillPerSecond);
  bucket.updatedAt = now;
  buckets().set(keyId, bucket);
  return bucket;
}

export interface RateLimitDecision {
  allowed: boolean;
  headers: Record<string, string>;
  retryAfterSeconds: number;
}

function headersFor(policy: RateLimitPolicy, bucket: Bucket): Record<string, string> {
  const remaining = Math.floor(bucket.tokens);
  const resetSeconds = Math.ceil((policy.capacity - bucket.tokens) / policy.refillPerSecond);
  const window = Math.ceil(policy.capacity / policy.refillPerSecond);
  return {
    "RateLimit-Limit": String(policy.capacity),
    "RateLimit-Remaining": String(remaining),
    "RateLimit-Reset": String(Math.max(0, resetSeconds)),
    "RateLimit-Policy": `${policy.capacity};w=${window}`,
  };
}

export function takeToken(keyId: string, policy: RateLimitPolicy, now = Date.now()): RateLimitDecision {
  const bucket = refill(keyId, policy, now);
  if (bucket.tokens < 1) {
    const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / policy.refillPerSecond));
    return {
      allowed: false,
      retryAfterSeconds,
      headers: { ...headersFor(policy, bucket), "Retry-After": String(retryAfterSeconds) },
    };
  }
  bucket.tokens -= 1;
  return { allowed: true, retryAfterSeconds: 0, headers: headersFor(policy, bucket) };
}

export function bucketStatus(keyId: string, policy: RateLimitPolicy, now = Date.now()) {
  const bucket = refill(keyId, policy, now);
  return {
    remaining: Math.floor(bucket.tokens),
    resetSeconds: Math.max(0, Math.ceil((policy.capacity - bucket.tokens) / policy.refillPerSecond)),
  };
}
