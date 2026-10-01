import type { ControlEnvironment } from "./types";

export interface ControlWriteDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
}

export class OrganizationControlWritePolicy {
  assess(environment: ControlEnvironment): ControlWriteDecision {
    if (environment === "arbitrum-one") {
      return {
        allowed: false,
        reason: "Arbitrum One writes are hard-disabled by the organization control policy",
      };
    }
    return { allowed: true, reason: null };
  }

  assertWritable(environment: ControlEnvironment): void {
    const decision = this.assess(environment);
    if (!decision.allowed) throw new Error(decision.reason ?? "writes are disabled");
  }
}
