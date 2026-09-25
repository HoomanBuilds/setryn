import { assertJsonValue, type JsonObject } from "@setryn/internal-schemas";

import type { OperatorRuntimeStorePort } from "./ports.ts";
import {
  operatorIntentTarget,
  operatorRuntimeVersion,
  type OperatorAlertId,
  type OperatorCompletion,
  type OperatorEnvironment,
  type OperatorJob,
  type OperatorJobId,
  type OperatorJobLease,
  type OperatorJobRequest,
  type OperatorJobStatus,
  type OperatorKillSwitch,
  type OperatorKillSwitchId,
  type OperatorRuntimeSnapshot,
  type RetryPolicy,
  type RetryState,
  type RuntimeAlert,
  type RuntimeDependencyHealth,
} from "./types.ts";

const maximumAttempts = 12;
const maximumDelayMs = 86_400_000;
const maximumLeaseMs = 300_000;

export class InMemoryOperatorRuntimeStore implements OperatorRuntimeStorePort {
  readonly #jobs = new Map<OperatorJobId, OperatorJob>();
  readonly #idempotency = new Map<string, { readonly jobId: OperatorJobId; readonly fingerprint: string }>();
  readonly #killSwitches = new Map<OperatorKillSwitchId, OperatorKillSwitch>();
  readonly #alerts = new Map<OperatorAlertId, RuntimeAlert>();
  readonly #dependencies = new Map<string, RuntimeDependencyHealth>();
  readonly #nextId: (prefix: "job" | "kill" | "alert") => string;

  constructor(nextId: (prefix: "job" | "kill" | "alert") => string = defaultRuntimeId) {
    this.#nextId = nextId;
  }

  enqueue(request: OperatorJobRequest, now: Date): { readonly job: OperatorJob; readonly created: boolean } {
    validateJobRequest(request);
    const fingerprint = stableJson({ intent: request.intent, retryPolicy: request.retryPolicy, requestedBy: request.requestedBy });
    const idempotencyKey = idempotencyLookupKey(request.intent.environment, request.intent.idempotencyKey);
    const existing = this.#idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error(`idempotency key ${request.intent.idempotencyKey} was already used with a different request`);
      }
      const job = this.#jobs.get(existing.jobId);
      if (!job) throw new Error("idempotency index points to a missing operator job");
      return { job: clone(job), created: false };
    }
    const createdAt = now.toISOString();
    const job: OperatorJob = {
      id: this.#nextId("job"),
      intent: clone(request.intent),
      status: "queued",
      payloadFingerprint: fingerprint,
      createdAt,
      updatedAt: createdAt,
      requestedBy: request.requestedBy,
      retry: initialRetryState(request.retryPolicy),
      lease: null,
      submission: null,
      completion: null,
      blockReason: null,
      cancellationReason: null,
    };
    if (this.#jobs.has(job.id)) throw new Error(`operator job identifier collision: ${job.id}`);
    this.#jobs.set(job.id, job);
    this.#idempotency.set(idempotencyKey, { jobId: job.id, fingerprint });
    return { job: clone(job), created: true };
  }

  getJob(jobId: OperatorJobId): OperatorJob | null {
    const job = this.#jobs.get(jobId);
    return job ? clone(job) : null;
  }

  listJobs(environment?: OperatorEnvironment): readonly OperatorJob[] {
    return [...this.#jobs.values()]
      .filter((job) => environment === undefined || job.intent.environment === environment)
      .sort(compareJobs)
      .map(clone);
  }

  leaseNext(environment: OperatorEnvironment, workerId: string, leaseDurationMs: number, now: Date): OperatorJob | null {
    assertNonEmpty(workerId, "workerId");
    assertBoundedPositiveInteger(leaseDurationMs, "leaseDurationMs", maximumLeaseMs);
    this.#recoverExpiredLeases(environment, now);
    const currentTime = now.getTime();
    const ready = this.listJobs(environment).find((job) =>
      job.status === "queued" || job.status === "retry-scheduled" && retryReady(job, currentTime),
    );
    if (!ready) return null;
    const lease: OperatorJobLease = {
      workerId,
      leasedAt: now.toISOString(),
      expiresAt: new Date(currentTime + leaseDurationMs).toISOString(),
    };
    return this.#replace(ready.id, (job) => ({
      ...job,
      status: "leased",
      lease,
      blockReason: null,
      updatedAt: now.toISOString(),
    }));
  }

  markSubmitted(jobId: OperatorJobId, submission: { readonly reference: string; readonly details: JsonObject }, now: Date): OperatorJob {
    assertNonEmpty(submission.reference, "submission.reference");
    assertJsonValue(submission.details, "submission.details");
    return this.#replaceLeased(jobId, now, (job) => ({
      ...job,
      status: "submitted",
      lease: null,
      submission: {
        reference: submission.reference,
        submittedAt: now.toISOString(),
        details: clone(submission.details),
      },
      updatedAt: now.toISOString(),
    }));
  }

  complete(jobId: OperatorJobId, completion: OperatorCompletion, now: Date): OperatorJob {
    assertJsonValue(completion.details, "completion.details");
    const current = this.#require(jobId);
    if (current.status !== "leased" && current.status !== "submitted") {
      throw new Error(`operator job ${jobId} cannot complete from ${current.status}`);
    }
    return this.#replace(jobId, (job) => ({
      ...job,
      status: "succeeded",
      lease: null,
      completion: { completedAt: completion.completedAt, details: clone(completion.details) },
      updatedAt: now.toISOString(),
    }));
  }

  scheduleRetry(jobId: OperatorJobId, error: string, now: Date): OperatorJob {
    assertNonEmpty(error, "error");
    const current = this.#require(jobId);
    if (current.status !== "leased") {
      throw new Error(`operator job ${jobId} cannot retry from ${current.status}`);
    }
    const attempts = current.retry.attempts + 1;
    if (attempts >= current.retry.maxAttempts) {
      return this.#replace(jobId, (job) => ({
        ...job,
        status: "failed",
        lease: null,
        retry: { ...job.retry, attempts, nextAttemptAt: null, lastError: error },
        updatedAt: now.toISOString(),
      }));
    }
    const delay = retryDelay(current.retry, attempts);
    return this.#replace(jobId, (job) => ({
      ...job,
      status: "retry-scheduled",
      lease: null,
      retry: {
        ...job.retry,
        attempts,
        nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
        lastError: error,
      },
      updatedAt: now.toISOString(),
    }));
  }

  block(jobId: OperatorJobId, reason: string, now: Date): OperatorJob {
    assertNonEmpty(reason, "reason");
    const current = this.#require(jobId);
    if (isTerminal(current.status)) throw new Error(`operator job ${jobId} cannot block from ${current.status}`);
    return this.#replace(jobId, (job) => ({
      ...job,
      status: "blocked",
      lease: null,
      blockReason: reason,
      updatedAt: now.toISOString(),
    }));
  }

  resume(jobId: OperatorJobId, now: Date): OperatorJob {
    const current = this.#require(jobId);
    if (current.status !== "blocked") throw new Error(`operator job ${jobId} cannot resume from ${current.status}`);
    return this.#replace(jobId, (job) => ({
      ...job,
      status: "queued",
      lease: null,
      blockReason: null,
      updatedAt: now.toISOString(),
    }));
  }

  cancel(jobId: OperatorJobId, reason: string, now: Date): OperatorJob {
    assertNonEmpty(reason, "reason");
    const current = this.#require(jobId);
    if (current.status === "submitted") {
      throw new Error(`operator job ${jobId} cannot cancel after external submission`);
    }
    if (isTerminal(current.status)) throw new Error(`operator job ${jobId} cannot cancel from ${current.status}`);
    return this.#replace(jobId, (job) => ({
      ...job,
      status: "cancelled",
      lease: null,
      cancellationReason: reason,
      updatedAt: now.toISOString(),
    }));
  }

  activateKillSwitch(value: Omit<OperatorKillSwitch, "id" | "deactivatedAt">, now: Date): OperatorKillSwitch {
    validateKillSwitch(value);
    const killSwitch: OperatorKillSwitch = {
      ...clone(value),
      id: this.#nextId("kill"),
      activatedAt: value.activatedAt || now.toISOString(),
      deactivatedAt: null,
    };
    if (this.#killSwitches.has(killSwitch.id)) throw new Error(`kill switch identifier collision: ${killSwitch.id}`);
    this.#killSwitches.set(killSwitch.id, killSwitch);
    return clone(killSwitch);
  }

  deactivateKillSwitch(killSwitchId: string, now: Date): OperatorKillSwitch {
    const current = this.#killSwitches.get(killSwitchId);
    if (!current) throw new Error(`unknown operator kill switch ${killSwitchId}`);
    if (current.deactivatedAt !== null) return clone(current);
    const next = { ...current, deactivatedAt: now.toISOString() };
    this.#killSwitches.set(killSwitchId, next);
    return clone(next);
  }

  activeKillSwitches(environment: OperatorEnvironment): readonly OperatorKillSwitch[] {
    return [...this.#killSwitches.values()]
      .filter((value) => value.environment === environment && value.deactivatedAt === null)
      .sort((left, right) => left.activatedAt.localeCompare(right.activatedAt) || left.id.localeCompare(right.id))
      .map(clone);
  }

  blockNewRisk(scope: OperatorKillSwitch, now: Date): readonly OperatorJob[] {
    const blocked: OperatorJob[] = [];
    for (const job of this.#jobs.values()) {
      if (job.intent.environment !== scope.environment || job.intent.riskClass !== "new-risk" || isTerminal(job.status) || job.status === "submitted") {
        continue;
      }
      if (!matchesKillSwitch(scope, job)) continue;
      blocked.push(this.#replace(job.id, (current) => ({
        ...current,
        status: "blocked",
        lease: null,
        blockReason: `kill switch ${scope.id}: ${scope.reason}`,
        updatedAt: now.toISOString(),
      })));
    }
    return blocked;
  }

  recordAlert(value: Omit<RuntimeAlert, "id" | "createdAt" | "resolvedAt">, now: Date): RuntimeAlert {
    assertNonEmpty(value.message, "alert.message");
    assertJsonValue(value.details, "alert.details");
    const alert: RuntimeAlert = {
      ...clone(value),
      id: this.#nextId("alert"),
      createdAt: now.toISOString(),
      resolvedAt: null,
    };
    if (this.#alerts.has(alert.id)) throw new Error(`alert identifier collision: ${alert.id}`);
    this.#alerts.set(alert.id, alert);
    return clone(alert);
  }

  resolveAlert(alertId: string, now: Date): RuntimeAlert {
    const current = this.#alerts.get(alertId);
    if (!current) throw new Error(`unknown operator alert ${alertId}`);
    if (current.resolvedAt !== null) return clone(current);
    const next = { ...current, resolvedAt: now.toISOString() };
    this.#alerts.set(alertId, next);
    return clone(next);
  }

  activeAlerts(environment: OperatorEnvironment): readonly RuntimeAlert[] {
    return [...this.#alerts.values()]
      .filter((alert) => alert.environment === environment && alert.resolvedAt === null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
      .map(clone);
  }

  reportDependency(health: RuntimeDependencyHealth): RuntimeDependencyHealth {
    assertNonEmpty(health.dependency, "dependency");
    const value = clone(health);
    this.#dependencies.set(`${value.environment}:${value.dependency}`, value);
    return clone(value);
  }

  listDependencies(environment: OperatorEnvironment): readonly RuntimeDependencyHealth[] {
    return [...this.#dependencies.values()]
      .filter((health) => health.environment === environment)
      .sort((left, right) => left.dependency.localeCompare(right.dependency))
      .map(clone);
  }

  snapshot(now: Date): OperatorRuntimeSnapshot {
    return {
      schemaVersion: operatorRuntimeVersion,
      generatedAt: now.toISOString(),
      jobs: this.listJobs(),
      killSwitches: [...this.#killSwitches.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(clone),
      alerts: [...this.#alerts.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(clone),
      dependencies: [...this.#dependencies.values()]
        .sort((left, right) => `${left.environment}:${left.dependency}`.localeCompare(`${right.environment}:${right.dependency}`))
        .map(clone),
    };
  }

  #recoverExpiredLeases(environment: OperatorEnvironment, now: Date): void {
    for (const job of this.#jobs.values()) {
      if (job.intent.environment !== environment || job.status !== "leased" || !job.lease) continue;
      if (Date.parse(job.lease.expiresAt) > now.getTime()) continue;
      this.scheduleRetry(job.id, "worker lease expired before completion", now);
    }
  }

  #replaceLeased(jobId: OperatorJobId, now: Date, update: (job: OperatorJob) => OperatorJob): OperatorJob {
    const current = this.#require(jobId);
    if (current.status !== "leased") throw new Error(`operator job ${jobId} must be leased`);
    return this.#replace(jobId, update);
  }

  #replace(jobId: OperatorJobId, update: (job: OperatorJob) => OperatorJob): OperatorJob {
    const current = this.#require(jobId);
    const next = update(current);
    this.#jobs.set(jobId, next);
    return clone(next);
  }

  #require(jobId: OperatorJobId): OperatorJob {
    const job = this.#jobs.get(jobId);
    if (!job) throw new Error(`unknown operator job ${jobId}`);
    return job;
  }
}

function validateJobRequest(request: OperatorJobRequest): void {
  assertNonEmpty(request.requestedBy, "requestedBy");
  assertNonEmpty(request.intent.idempotencyKey, "idempotencyKey");
  assertNonEmpty(request.intent.requestedAt, "requestedAt");
  if (!Number.isFinite(Date.parse(request.intent.requestedAt))) throw new TypeError("requestedAt must be an ISO timestamp");
  assertRetryPolicy(request.retryPolicy);
  assertJsonValue(intentPayload(request.intent), "intent");
  switch (request.intent.kind) {
    case "quote-cycle":
      assertNonEmpty(request.intent.makerKey, "makerKey");
      if (!Number.isFinite(Date.parse(request.intent.expiresAt))) throw new TypeError("expiresAt must be an ISO timestamp");
      return;
    case "solver-execution":
      return;
    case "keeper-work":
      assertNonEmpty(request.intent.workType, "workType");
      return;
    case "oracle-relay":
      assertNonEmpty(request.intent.feedKey, "feedKey");
      return;
  }
}

function validateKillSwitch(value: Omit<OperatorKillSwitch, "id" | "deactivatedAt">): void {
  assertNonEmpty(value.reason, "kill switch reason");
  assertNonEmpty(value.activatedBy, "activatedBy");
  if (!Number.isFinite(Date.parse(value.activatedAt))) throw new TypeError("kill switch activatedAt must be an ISO timestamp");
}

function assertRetryPolicy(policy: RetryPolicy): void {
  assertBoundedPositiveInteger(policy.maxAttempts, "retryPolicy.maxAttempts", maximumAttempts);
  assertBoundedPositiveInteger(policy.baseDelayMs, "retryPolicy.baseDelayMs", maximumDelayMs);
  assertBoundedPositiveInteger(policy.maxDelayMs, "retryPolicy.maxDelayMs", maximumDelayMs);
  if (policy.baseDelayMs > policy.maxDelayMs) throw new RangeError("retryPolicy.baseDelayMs cannot exceed retryPolicy.maxDelayMs");
}

function initialRetryState(policy: RetryPolicy): RetryState {
  return { ...policy, attempts: 0, nextAttemptAt: null, lastError: null };
}

function retryDelay(retry: RetryState, attempts: number): number {
  return Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** Math.max(0, attempts - 1));
}

function retryReady(job: OperatorJob, now: number): boolean {
  return job.retry.nextAttemptAt !== null && Date.parse(job.retry.nextAttemptAt) <= now;
}

function isTerminal(status: OperatorJobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function matchesKillSwitch(killSwitch: OperatorKillSwitch, job: OperatorJob): boolean {
  if (killSwitch.environment !== job.intent.environment) return false;
  switch (killSwitch.scope.kind) {
    case "environment":
      return true;
    case "domain":
      return job.intent.domain === killSwitch.scope.domain;
    case "market":
      return operatorIntentTarget(job.intent).marketId === killSwitch.scope.marketId;
    case "resource":
      return operatorIntentTarget(job.intent).resourceId === killSwitch.scope.resourceId;
  }
}

function intentPayload(intent: OperatorJobRequest["intent"]): JsonObject {
  return intent as unknown as JsonObject;
}

function idempotencyLookupKey(environment: OperatorEnvironment, key: string): string {
  return `${environment}:${key}`;
}

function compareJobs(left: OperatorJob, right: OperatorJob): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new TypeError(`${label} must not be empty`);
}

function assertBoundedPositiveInteger(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be a safe integer from 1 to ${maximum}`);
  }
}

function defaultRuntimeId(prefix: "job" | "kill" | "alert"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  throw new TypeError("operator job requests must be JSON serializable");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function jobMatchesKillSwitch(killSwitch: OperatorKillSwitch, job: OperatorJob): boolean {
  return matchesKillSwitch(killSwitch, job);
}
