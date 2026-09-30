import { createHmac, timingSafeEqual } from "node:crypto";

/* Mirror of `services/webhooks/src/signature.ts` (the exported verifier for SDK consumers lives there). */

/**
 * Setryn webhook signatures.
 *
 *   Setryn-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>[,v1=<hex>]
 *
 * A header carries one `v1` per active secret: during a rotation grace window it is signed with both the new and the
 * previous secret, so a consumer that still holds the old secret keeps verifying. Consumers must verify against the
 * raw request body bytes exactly as received, and reject timestamps outside the tolerance to stop replays.
 */
export const SIGNATURE_HEADER = "Setryn-Signature";
export const SIGNATURE_SCHEME = "v1";
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** Builds the header value for `body` signed at `timestamp` with every given secret. */
export function signPayload(body: string, secrets: readonly string[], timestamp = Math.floor(Date.now() / 1000)): string {
  if (secrets.length === 0) throw new TypeError("at least one signing secret is required");
  return [`t=${timestamp}`, ...secrets.map((secret) => `${SIGNATURE_SCHEME}=${computeSignature(secret, timestamp, body)}`)].join(",");
}

export interface ParsedSignatureHeader {
  readonly timestamp: number;
  readonly signatures: readonly string[];
}

export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === SIGNATURE_SCHEME && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export type SignatureVerification =
  | { readonly valid: true; readonly timestamp: number }
  | { readonly valid: false; readonly reason: "MALFORMED_HEADER" | "TIMESTAMP_OUTSIDE_TOLERANCE" | "NO_MATCHING_SIGNATURE" };

export interface VerifySignatureInput {
  /** Raw request body exactly as received. */
  readonly payload: string | Uint8Array;
  /** Value of the `Setryn-Signature` header. */
  readonly header: string | null | undefined;
  /** The subscription's signing secret (`whsec_...`). */
  readonly secret: string;
  readonly toleranceSeconds?: number;
  /** Override for tests, unix seconds. */
  readonly nowSeconds?: number;
}

/** Verifies a Setryn webhook delivery. Constant-time comparison; exported for SDK consumers. */
export function verifySetrynSignature(input: VerifySignatureInput): SignatureVerification {
  const parsed = input.header ? parseSignatureHeader(input.header) : null;
  if (!parsed) return { valid: false, reason: "MALFORMED_HEADER" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.timestamp) > tolerance) return { valid: false, reason: "TIMESTAMP_OUTSIDE_TOLERANCE" };
  const body = typeof input.payload === "string" ? input.payload : Buffer.from(input.payload).toString("utf8");
  const expected = Buffer.from(computeSignature(input.secret, parsed.timestamp, body), "hex");
  const matched = parsed.signatures.some((candidate) => {
    const actual = Buffer.from(candidate, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  return matched ? { valid: true, timestamp: parsed.timestamp } : { valid: false, reason: "NO_MATCHING_SIGNATURE" };
}
