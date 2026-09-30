/**
 * Request signing for replay protection, with Web Crypto only (Node 20+, browsers, edge runtimes).
 *
 *   key       = SHA-256(apiKey)                       (32 raw bytes; the value the server stores)
 *   canonical = "SETRYN-HMAC-SHA256-V1\n" + METHOD + "\n" + path?query + "\n" + timestamp + "\n" + nonce + "\n" + hex(SHA-256(body))
 *   signature = hex(HMAC-SHA256(key, canonical))
 */
export const SIGNATURE_VERSION = "SETRYN-HMAC-SHA256-V1";

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function canonicalRequest(method: string, pathWithQuery: string, timestamp: string, nonce: string, bodyHash: string): string {
  return [SIGNATURE_VERSION, method.toUpperCase(), pathWithQuery, timestamp, nonce, bodyHash].join("\n");
}

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface SignedHeaders {
  "Setryn-Timestamp": string;
  "Setryn-Nonce": string;
  "Setryn-Signature": string;
}

export async function signRequest(input: {
  apiKey: string;
  method: string;
  pathWithQuery: string;
  body: string;
  timestamp?: number;
  nonce?: string;
}): Promise<SignedHeaders> {
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? createNonce();
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(input.apiKey));
  const hmacKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const canonical = canonicalRequest(input.method, input.pathWithQuery, timestamp, nonce, await sha256Hex(input.body));
  const signature = toHex(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(canonical)));
  return { "Setryn-Timestamp": timestamp, "Setryn-Nonce": nonce, "Setryn-Signature": signature };
}
