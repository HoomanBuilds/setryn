import type { OperatorEnvironment } from "./types.ts";

export interface EnvironmentWriteDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
}

export class StrictEnvironmentWritePolicy {
  readonly #enabled: ReadonlySet<Exclude<OperatorEnvironment, "arbitrum-one">>;

  constructor(enabled: readonly Exclude<OperatorEnvironment, "arbitrum-one">[] = ["local", "arbitrum-sepolia"]) {
    this.#enabled = new Set(enabled);
  }

  assess(environment: OperatorEnvironment): EnvironmentWriteDecision {
    if (environment === "arbitrum-one") {
      return {
        allowed: false,
        reason: "Arbitrum One writes are hard-disabled by the operator runtime policy",
      };
    }
    if (!this.#enabled.has(environment)) {
      return {
        allowed: false,
        reason: `Operator writes are disabled for ${environment}`,
      };
    }
    return { allowed: true, reason: null };
  }

  assertWritable(environment: OperatorEnvironment): void {
    const decision = this.assess(environment);
    if (!decision.allowed) throw new Error(decision.reason ?? "operator writes are disabled");
  }
}
