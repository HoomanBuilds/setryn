import type { AccountId, Bytes32, JsonObject, MarketId } from "@setryn/internal-schemas";

export const operatorRuntimeVersion = "setryn.operator-runtime.v1" as const;

export type OperatorRuntimeVersion = typeof operatorRuntimeVersion;
export type OperatorEnvironment = "local" | "arbitrum-sepolia" | "arbitrum-one";
export type OperatorDomain = "maker" | "solver" | "keeper" | "oracle";
export type OperatorJobKind = "quote-cycle" | "solver-execution" | "keeper-work" | "oracle-relay";
export type OperatorRiskClass = "new-risk" | "terminal-resolution" | "operational";
export type OperatorJobStatus =
  | "queued"
  | "leased"
  | "submitted"
  | "retry-scheduled"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled";
export type RuntimeHealthState = "healthy" | "degraded" | "unhealthy" | "unknown";
export type RuntimeAlertSeverity = "info" | "warning" | "critical";

export type OperatorJobId = string;
export type OperatorKillSwitchId = string;
export type OperatorAlertId = string;

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface RetryState extends RetryPolicy {
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
}

export interface OperatorIntentBase {
  readonly environment: OperatorEnvironment;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly correlationId?: string;
}

export interface QuoteCycleIntent extends OperatorIntentBase {
  readonly kind: "quote-cycle";
  readonly domain: "maker";
  readonly riskClass: "new-risk";
  readonly marketId: MarketId;
  readonly makerKey: string;
  readonly quoteRequest: JsonObject;
  readonly expiresAt: string;
}

export interface SolverExecutionIntent extends OperatorIntentBase {
  readonly kind: "solver-execution";
  readonly domain: "solver";
  readonly riskClass: OperatorRiskClass;
  readonly marketId: MarketId;
  readonly packageHash: Bytes32;
  readonly accountId: AccountId;
  readonly executionPlan: JsonObject;
}

export interface KeeperWorkIntent extends OperatorIntentBase {
  readonly kind: "keeper-work";
  readonly domain: "keeper";
  readonly riskClass: "terminal-resolution" | "operational";
  readonly resourceId: Bytes32;
  readonly workType: string;
  readonly work: JsonObject;
}

export interface OracleRelayIntent extends OperatorIntentBase {
  readonly kind: "oracle-relay";
  readonly domain: "oracle";
  readonly riskClass: "operational";
  readonly feedKey: string;
  readonly marketId?: MarketId;
  readonly relayPayload: JsonObject;
}

export type OperatorIntent = QuoteCycleIntent | SolverExecutionIntent | KeeperWorkIntent | OracleRelayIntent;

export interface OperatorJobRequest {
  readonly intent: OperatorIntent;
  readonly retryPolicy: RetryPolicy;
  readonly requestedBy: string;
}

export interface OperatorJobLease {
  readonly workerId: string;
  readonly leasedAt: string;
  readonly expiresAt: string;
}

export interface OperatorSubmission {
  readonly reference: string;
  readonly submittedAt: string;
  readonly details: JsonObject;
}

export interface OperatorCompletion {
  readonly completedAt: string;
  readonly details: JsonObject;
}

export interface OperatorJob {
  readonly id: OperatorJobId;
  readonly intent: OperatorIntent;
  readonly status: OperatorJobStatus;
  readonly payloadFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly requestedBy: string;
  readonly retry: RetryState;
  readonly lease: OperatorJobLease | null;
  readonly submission: OperatorSubmission | null;
  readonly completion: OperatorCompletion | null;
  readonly blockReason: string | null;
  readonly cancellationReason: string | null;
}

export type KillSwitchScope =
  | { readonly kind: "environment" }
  | { readonly kind: "domain"; readonly domain: OperatorDomain }
  | { readonly kind: "market"; readonly marketId: MarketId }
  | { readonly kind: "resource"; readonly resourceId: Bytes32 };

export interface OperatorKillSwitch {
  readonly id: OperatorKillSwitchId;
  readonly environment: OperatorEnvironment;
  readonly scope: KillSwitchScope;
  readonly reason: string;
  readonly activatedBy: string;
  readonly activatedAt: string;
  readonly deactivatedAt: string | null;
}

export interface RuntimeAlert {
  readonly id: OperatorAlertId;
  readonly environment: OperatorEnvironment;
  readonly domain: OperatorDomain | null;
  readonly severity: RuntimeAlertSeverity;
  readonly message: string;
  readonly details: JsonObject;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface RuntimeDependencyHealth {
  readonly environment: OperatorEnvironment;
  readonly dependency: string;
  readonly state: RuntimeHealthState;
  readonly observedAt: string;
  readonly detail: string | null;
}

export interface RuntimeHealthSnapshot {
  readonly schemaVersion: OperatorRuntimeVersion;
  readonly environment: OperatorEnvironment;
  readonly state: RuntimeHealthState;
  readonly evaluatedAt: string;
  readonly jobs: Readonly<Record<OperatorJobStatus, number>>;
  readonly activeKillSwitches: readonly OperatorKillSwitch[];
  readonly activeAlerts: readonly RuntimeAlert[];
  readonly dependencies: readonly RuntimeDependencyHealth[];
}

export interface OperatorRuntimeSnapshot {
  readonly schemaVersion: OperatorRuntimeVersion;
  readonly generatedAt: string;
  readonly jobs: readonly OperatorJob[];
  readonly killSwitches: readonly OperatorKillSwitch[];
  readonly alerts: readonly RuntimeAlert[];
  readonly dependencies: readonly RuntimeDependencyHealth[];
}

export interface OperatorExecutionContext {
  readonly jobId: OperatorJobId;
  readonly environment: OperatorEnvironment;
  readonly workerId: string;
  readonly attempt: number;
  readonly idempotencyKey: string;
}

export type OperatorExecutionResult =
  | { readonly state: "submitted"; readonly reference: string; readonly details: JsonObject }
  | { readonly state: "completed"; readonly details: JsonObject };

export interface OperatorDispatchDecision {
  readonly allowed: boolean;
  readonly reason: string | null;
}

export function operatorIntentTarget(intent: OperatorIntent): {
  readonly marketId: MarketId | null;
  readonly resourceId: Bytes32 | null;
} {
  switch (intent.kind) {
    case "quote-cycle":
    case "solver-execution":
      return { marketId: intent.marketId, resourceId: null };
    case "keeper-work":
      return { marketId: null, resourceId: intent.resourceId };
    case "oracle-relay":
      return { marketId: intent.marketId ?? null, resourceId: null };
  }
}
