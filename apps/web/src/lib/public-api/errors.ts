/** Stable machine-readable codes of the public API error envelope `{ error: { code, message } }`. */
export type PublicApiErrorCode =
  | "UNAUTHENTICATED"
  | "ORDER_NOT_WORKING"
  | "INVALID_API_KEY"
  | "API_KEY_REVOKED"
  | "INSUFFICIENT_SCOPE"
  | "RATE_LIMITED"
  | "REPLAY_HEADERS_REQUIRED"
  | "TIMESTAMP_OUT_OF_WINDOW"
  | "INVALID_NONCE"
  | "NONCE_REUSED"
  | "INVALID_SIGNATURE"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "MARKET_NOT_ONCHAIN"
  | "SIGNER_NOT_ALLOWED"
  | "ORDER_REJECTED"
  | "NOT_MARKETABLE"
  | "WOULD_CROSS"
  | "RISK_RESERVATION_FAILED"
  | "CONSOLE_LOCAL_ONLY"
  | "CHAIN_UNAVAILABLE"
  | "INTERNAL";

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: PublicApiErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

export function errorBody(code: PublicApiErrorCode, message: string) {
  return { error: { code, message } };
}

export function errorResponse(error: PublicApiError, headers: Record<string, string> = {}): Response {
  return Response.json(errorBody(error.code, error.message), {
    status: error.status,
    headers: { "Cache-Control": "no-store", ...headers, ...error.headers },
  });
}

/** Anything that is not a deliberate API error is reported without internals. */
export function toPublicApiError(error: unknown): PublicApiError {
  if (error instanceof PublicApiError) return error;
  const text = error instanceof Error ? error.message : "";
  if (/ENOENT|ECONNREFUSED|fetch failed|RUNTIME|HTTP request failed/i.test(text)) {
    return new PublicApiError(503, "CHAIN_UNAVAILABLE", "The Setryn deployment or its chain RPC is unavailable.");
  }
  return new PublicApiError(500, "INTERNAL", "The request could not be completed.");
}
