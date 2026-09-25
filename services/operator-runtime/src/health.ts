import type { OperatorRuntimeStorePort } from "./ports.ts";
import {
  operatorRuntimeVersion,
  type OperatorEnvironment,
  type OperatorJobStatus,
  type RuntimeHealthSnapshot,
  type RuntimeHealthState,
} from "./types.ts";

const jobStatuses: readonly OperatorJobStatus[] = [
  "queued",
  "leased",
  "submitted",
  "retry-scheduled",
  "blocked",
  "succeeded",
  "failed",
  "cancelled",
];

export class OperatorRuntimeHealth {
  readonly #store: OperatorRuntimeStorePort;

  constructor(store: OperatorRuntimeStorePort) {
    this.#store = store;
  }

  snapshot(environment: OperatorEnvironment, now: Date): RuntimeHealthSnapshot {
    const jobs = emptyJobCounts();
    for (const job of this.#store.listJobs(environment)) jobs[job.status] += 1;
    const activeAlerts = this.#store.activeAlerts(environment);
    const dependencies = this.#store.listDependencies(environment);
    return {
      schemaVersion: operatorRuntimeVersion,
      environment,
      state: healthState(jobs, activeAlerts.some((alert) => alert.severity === "critical"), dependencies),
      evaluatedAt: now.toISOString(),
      jobs,
      activeKillSwitches: this.#store.activeKillSwitches(environment),
      activeAlerts,
      dependencies,
    };
  }
}

function emptyJobCounts(): Record<OperatorJobStatus, number> {
  return Object.fromEntries(jobStatuses.map((status) => [status, 0])) as Record<OperatorJobStatus, number>;
}

function healthState(
  jobs: Readonly<Record<OperatorJobStatus, number>>,
  hasCriticalAlert: boolean,
  dependencies: readonly { readonly state: RuntimeHealthState }[],
): RuntimeHealthState {
  if (hasCriticalAlert || dependencies.some((dependency) => dependency.state === "unhealthy")) return "unhealthy";
  if (
    jobs.failed > 0 ||
    jobs.blocked > 0 ||
    jobs["retry-scheduled"] > 0 ||
    dependencies.some((dependency) => dependency.state === "degraded" || dependency.state === "unknown")
  ) {
    return "degraded";
  }
  return "healthy";
}
