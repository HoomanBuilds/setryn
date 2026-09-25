import type { JsonObject } from "@setryn/internal-schemas";

import { OperatorRuntimeHealth } from "./health.ts";
import type { OperatorExecutionPorts, OperatorRuntimeStorePort, RuntimeClock } from "./ports.ts";
import { StrictEnvironmentWritePolicy } from "./policy.ts";
import { jobMatchesKillSwitch } from "./store.ts";
import type {
  OperatorDispatchDecision,
  OperatorEnvironment,
  OperatorExecutionContext,
  OperatorJob,
  OperatorJobId,
  OperatorJobRequest,
  OperatorKillSwitch,
  OperatorExecutionResult,
  OperatorRuntimeSnapshot,
  RuntimeAlert,
  RuntimeDependencyHealth,
  RuntimeHealthSnapshot,
} from "./types.ts";

export interface OperatorRuntimeConfig {
  readonly store: OperatorRuntimeStorePort;
  readonly executionPorts?: OperatorExecutionPorts;
  readonly writePolicy?: StrictEnvironmentWritePolicy;
  readonly clock?: RuntimeClock;
}

export type OperatorRunResult =
  | { readonly state: "idle" }
  | { readonly state: "blocked"; readonly job: OperatorJob; readonly reason: string }
  | { readonly state: "submitted"; readonly job: OperatorJob }
  | { readonly state: "completed"; readonly job: OperatorJob }
  | { readonly state: "retry-scheduled" | "failed"; readonly job: OperatorJob; readonly error: string };

export class InternalOperatorRuntime {
  readonly #store: OperatorRuntimeStorePort;
  readonly #ports: OperatorExecutionPorts;
  readonly #writePolicy: StrictEnvironmentWritePolicy;
  readonly #clock: RuntimeClock;
  readonly #health: OperatorRuntimeHealth;

  constructor(config: OperatorRuntimeConfig) {
    this.#store = config.store;
    this.#ports = config.executionPorts ?? {};
    this.#writePolicy = config.writePolicy ?? new StrictEnvironmentWritePolicy();
    this.#clock = config.clock ?? { now: () => new Date() };
    this.#health = new OperatorRuntimeHealth(this.#store);
  }

  enqueue(request: OperatorJobRequest): { readonly job: OperatorJob; readonly created: boolean } {
    const now = this.#clock.now();
    const result = this.#store.enqueue(request, now);
    const decision = this.dispatchDecision(result.job);
    if (result.job.status === "queued" && !decision.allowed) {
      return { created: result.created, job: this.#store.block(result.job.id, decision.reason ?? "operator dispatch blocked", now) };
    }
    return result;
  }

  async runNext(environment: OperatorEnvironment, workerId: string, leaseDurationMs = 60_000): Promise<OperatorRunResult> {
    const now = this.#clock.now();
    const job = this.#store.leaseNext(environment, workerId, leaseDurationMs, now);
    if (!job) return { state: "idle" };
    const decision = this.dispatchDecision(job);
    if (!decision.allowed) {
      const blocked = this.#store.block(job.id, decision.reason ?? "operator dispatch blocked", this.#clock.now());
      return { state: "blocked", job: blocked, reason: blocked.blockReason ?? "operator dispatch blocked" };
    }
    const executor = this.executorFor(job);
    if (!executor) {
      const reason = `No ${job.intent.domain} execution port is configured`;
      const blocked = this.#store.block(job.id, reason, this.#clock.now());
      return { state: "blocked", job: blocked, reason };
    }
    const context: OperatorExecutionContext = {
      jobId: job.id,
      environment: job.intent.environment,
      workerId,
      attempt: job.retry.attempts + 1,
      idempotencyKey: job.intent.idempotencyKey,
    };
    try {
      const result = await executor(context);
      const completedAt = this.#clock.now();
      if (result.state === "submitted") {
        return {
          state: "submitted",
          job: this.#store.markSubmitted(job.id, { reference: result.reference, details: result.details }, completedAt),
        };
      }
      return {
        state: "completed",
        job: this.#store.complete(job.id, { completedAt: completedAt.toISOString(), details: result.details }, completedAt),
      };
    } catch (error) {
      const message = errorMessage(error);
      const retried = this.#store.scheduleRetry(job.id, message, this.#clock.now());
      this.#store.recordAlert({
        environment: job.intent.environment,
        domain: job.intent.domain,
        severity: retried.status === "failed" ? "critical" : "warning",
        message: `Operator ${job.intent.kind} failed: ${message}`,
        details: { jobId: job.id, status: retried.status },
      }, this.#clock.now());
      return { state: retried.status === "failed" ? "failed" : "retry-scheduled", job: retried, error: message };
    }
  }

  completeSubmitted(jobId: OperatorJobId, details: JsonObject): OperatorJob {
    const now = this.#clock.now();
    return this.#store.complete(jobId, { completedAt: now.toISOString(), details }, now);
  }

  blockSubmittedForReconciliation(jobId: OperatorJobId, reason: string): OperatorJob {
    const job = this.#store.getJob(jobId);
    if (!job) throw new Error(`unknown operator job ${jobId}`);
    if (job.status !== "submitted") throw new Error(`operator job ${jobId} is not awaiting reconciliation`);
    return this.#store.block(jobId, reason, this.#clock.now());
  }

  cancel(jobId: OperatorJobId, reason: string): OperatorJob {
    return this.#store.cancel(jobId, reason, this.#clock.now());
  }

  resume(jobId: OperatorJobId): OperatorJob {
    const job = this.#store.getJob(jobId);
    if (!job) throw new Error(`unknown operator job ${jobId}`);
    const decision = this.dispatchDecision(job);
    if (!decision.allowed) throw new Error(decision.reason ?? "operator dispatch blocked");
    return this.#store.resume(jobId, this.#clock.now());
  }

  activateKillSwitch(value: Omit<OperatorKillSwitch, "id" | "deactivatedAt">): OperatorKillSwitch {
    const now = this.#clock.now();
    const killSwitch = this.#store.activateKillSwitch(value, now);
    const blocked = this.#store.blockNewRisk(killSwitch, now);
    this.#store.recordAlert({
      environment: killSwitch.environment,
      domain: killSwitch.scope.kind === "domain" ? killSwitch.scope.domain : null,
      severity: "warning",
      message: `Kill switch ${killSwitch.id} activated`,
      details: { scope: killSwitch.scope.kind, blockedJobs: blocked.map((job) => job.id), reason: killSwitch.reason },
    }, now);
    return killSwitch;
  }

  deactivateKillSwitch(killSwitchId: string): OperatorKillSwitch {
    return this.#store.deactivateKillSwitch(killSwitchId, this.#clock.now());
  }

  dispatchDecision(job: OperatorJob): OperatorDispatchDecision {
    const writeDecision = this.#writePolicy.assess(job.intent.environment);
    if (!writeDecision.allowed) return writeDecision;
    if (job.intent.riskClass === "new-risk") {
      const matching = this.#store.activeKillSwitches(job.intent.environment).find((killSwitch) => jobMatchesKillSwitch(killSwitch, job));
      if (matching) {
        return { allowed: false, reason: `kill switch ${matching.id} blocks new risk: ${matching.reason}` };
      }
    }
    return { allowed: true, reason: null };
  }

  reportDependency(health: RuntimeDependencyHealth): RuntimeDependencyHealth {
    return this.#store.reportDependency(health);
  }

  recordAlert(alert: Omit<RuntimeAlert, "id" | "createdAt" | "resolvedAt">): RuntimeAlert {
    return this.#store.recordAlert(alert, this.#clock.now());
  }

  resolveAlert(alertId: string): RuntimeAlert {
    return this.#store.resolveAlert(alertId, this.#clock.now());
  }

  healthSnapshot(environment: OperatorEnvironment): RuntimeHealthSnapshot {
    return this.#health.snapshot(environment, this.#clock.now());
  }

  snapshot(): OperatorRuntimeSnapshot {
    return this.#store.snapshot(this.#clock.now());
  }

  executorFor(job: OperatorJob): ((context: OperatorExecutionContext) => Promise<OperatorExecutionResult>) | null {
    const intent = job.intent;
    switch (intent.kind) {
      case "quote-cycle":
        return this.#ports.maker
          ? (context) => this.#ports.maker!.executeQuoteCycle(intent, context)
          : null;
      case "solver-execution":
        return this.#ports.solver
          ? (context) => this.#ports.solver!.executeSolverIntent(intent, context)
          : null;
      case "keeper-work":
        return this.#ports.keeper
          ? (context) => this.#ports.keeper!.executeKeeperWork(intent, context)
          : null;
      case "oracle-relay":
        return this.#ports.oracle
          ? (context) => this.#ports.oracle!.executeOracleRelay(intent, context)
          : null;
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "unknown operator runtime execution error";
}
