import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PublicApiError } from "./errors";

/**
 * Replay protection for write requests. The client sends
 *
 *   Setryn-Timestamp: unix seconds, within ±60s of server time
 *   Setryn-Nonce:     16 to 128 characters of [A-Za-z0-9_-], never reused by the key
 *   Setryn-Signature: hex HMAC-SHA256 of the canonical request
 *
 * The HMAC key is the 32-byte SHA-256 digest of the API key (the value the server stores), and the canonical request is
 *
 *   SETRYN-HMAC-SHA256-V1 \n METHOD \n path?query \n timestamp \n nonce \n hex SHA-256 of the raw body
 *
 * A nonce is remembered for twice the timestamp window, after which the timestamp check alone rejects the request.
 */
export const SIGNATURE_VERSION = "SETRYN-HMAC-SHA256-V1";
export const TIMESTAMP_WINDOW_SECONDS = 60;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const NONCES_KEY = Symbol.for("setryn.public-api.nonces");

function nonces(): Map<string, number> {
  const holder = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  holder[NONCES_KEY] ??= new Map();
  return holder[NONCES_KEY];
}

function pruneNonces(nowSeconds: number): void {
  const horizon = nowSeconds - TIMESTAMP_WINDOW_SECONDS * 2;
  for (const [nonce, seenAt] of nonces()) if (seenAt < horizon) nonces().delete(nonce);
}

export function canonicalRequest(method: string, pathWithQuery: string, timestamp: string, nonce: string, body: string): string {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  return [SIGNATURE_VERSION, method.toUpperCase(), pathWithQuery, timestamp, nonce, bodyHash].join("\n");
}

export function verifySignedRequest(input: {
  keyId: string;
  secretHash: string;
  method: string;
  pathWithQuery: string;
  headers: Headers;
  body: string;
  nowSeconds?: number;
}): void {
  const timestamp = input.headers.get("setryn-timestamp");
  const nonce = input.headers.get("setryn-nonce");
  const signature = input.headers.get("setryn-signature");
  if (!timestamp || !nonce || !signature) {
    throw new PublicApiError(
      400,
      "REPLAY_HEADERS_REQUIRED",
      "Write requests need Setryn-Timestamp, Setryn-Nonce and Setryn-Signature headers.",
    );
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > TIMESTAMP_WINDOW_SECONDS) {
    throw new PublicApiError(
      401,
      "TIMESTAMP_OUT_OF_WINDOW",
      `Setryn-Timestamp must be unix seconds within ${TIMESTAMP_WINDOW_SECONDS}s of server time (${now}).`,
    );
  }
  if (!NONCE_PATTERN.test(nonce)) {
    throw new PublicApiError(400, "INVALID_NONCE", "Setryn-Nonce must be 16 to 128 characters of [A-Za-z0-9_-].");
  }
  const expected = createHmac("sha256", Buffer.from(input.secretHash, "hex"))
    .update(canonicalRequest(input.method, input.pathWithQuery, timestamp, nonce, input.body), "utf8")
    .digest();
  const presented = /^[0-9a-fA-F]{64}$/.test(signature) ? Buffer.from(signature, "hex") : Buffer.alloc(32);
  if (!timingSafeEqual(expected, presented) || !/^[0-9a-fA-F]{64}$/.test(signature)) {
    throw new PublicApiError(401, "INVALID_SIGNATURE", "Setryn-Signature does not match the canonical request.");
  }
  pruneNonces(now);
  const scoped = `${input.keyId}:${nonce}`;
  if (nonces().has(scoped)) {
    throw new PublicApiError(409, "NONCE_REUSED", "This Setryn-Nonce was already used. Every write needs a fresh nonce.");
  }
  nonces().set(scoped, now);
}
