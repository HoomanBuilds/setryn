/** Error thrown for every non-2xx API response, carrying the envelope's stable `code`. */
export class SetrynApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  /** Seconds to wait before retrying, from Retry-After on 429. */
  readonly retryAfterSeconds: number | null;

  constructor(input: { status: number; code: string; message: string; requestId: string | null; retryAfterSeconds: number | null }) {
    super(input.message);
    this.name = "SetrynApiError";
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** Raised by the order helpers when a step of the flow cannot continue (wrong chain, reverted transaction). */
export class SetrynOrderError extends Error {
  readonly step: string;

  constructor(step: string, message: string) {
    super(message);
    this.name = "SetrynOrderError";
    this.step = step;
  }
}
