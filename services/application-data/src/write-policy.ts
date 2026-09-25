import type { InternalWriteRequest, InternalWriteTransport } from "./ports.ts";
import type { InternalEnvironment } from "./types.ts";

export type InternalWriteStatus =
  | { readonly mode: "enabled"; readonly reason: null }
  | { readonly mode: "disabled"; readonly reason: string };

export class EnvironmentWritePolicy implements InternalWriteTransport {
  readonly #environment: InternalEnvironment;
  readonly #delegate: InternalWriteTransport | null;

  constructor(environment: InternalEnvironment, delegate: InternalWriteTransport | null) {
    this.#environment = environment;
    this.#delegate = delegate;
  }

  status(): InternalWriteStatus {
    if (this.#environment === "arbitrum-one") {
      return { mode: "disabled", reason: "Arbitrum One writes are disabled by the internal application data policy" };
    }
    if (!this.#delegate) return { mode: "disabled", reason: `Writes are not configured for ${this.#environment}` };
    return { mode: "enabled", reason: null };
  }

  submit(request: InternalWriteRequest): Promise<{ readonly transactionHash: string }> {
    if (request.operation.trim().length === 0) throw new TypeError("internal write operation must not be empty");
    const status = this.status();
    if (status.mode === "disabled") throw new Error(status.reason);
    if (!this.#delegate) throw new Error("write delegate is unavailable");
    return this.#delegate.submit(request);
  }
}
