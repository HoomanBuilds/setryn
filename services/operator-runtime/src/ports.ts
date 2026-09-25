import type {
  OperatorCompletion,
  OperatorEnvironment,
  OperatorExecutionContext,
  OperatorExecutionResult,
  OperatorJob,
  OperatorJobId,
  OperatorJobLease,
  OperatorJobRequest,
  OperatorKillSwitch,
  OperatorRuntimeSnapshot,
  OracleRelayIntent,
  QuoteCycleIntent,
  RuntimeAlert,
  RuntimeDependencyHealth,
  SolverExecutionIntent,
  KeeperWorkIntent,
} from "./types.ts";
import type { JsonObject } from "@setryn/internal-schemas";

export interface RuntimeClock {
  now(): Date;
}

export interface RuntimeIdentifierSource {
  next(prefix: "job" | "kill" | "alert"): string;
}

export interface MakerQuoteExecutionPort {
  executeQuoteCycle(intent: QuoteCycleIntent, context: OperatorExecutionContext): Promise<OperatorExecutionResult>;
}

export interface SolverExecutionPort {
  executeSolverIntent(intent: SolverExecutionIntent, context: OperatorExecutionContext): Promise<OperatorExecutionResult>;
}

export interface KeeperExecutionPort {
  executeKeeperWork(intent: KeeperWorkIntent, context: OperatorExecutionContext): Promise<OperatorExecutionResult>;
}

export interface OracleRelayExecutionPort {
  executeOracleRelay(intent: OracleRelayIntent, context: OperatorExecutionContext): Promise<OperatorExecutionResult>;
}

export interface OperatorExecutionPorts {
  readonly maker?: MakerQuoteExecutionPort;
  readonly solver?: SolverExecutionPort;
  readonly keeper?: KeeperExecutionPort;
  readonly oracle?: OracleRelayExecutionPort;
}

export interface OperatorRuntimeStorePort {
  enqueue(request: OperatorJobRequest, now: Date): { readonly job: OperatorJob; readonly created: boolean };
  getJob(jobId: OperatorJobId): OperatorJob | null;
  listJobs(environment?: OperatorEnvironment): readonly OperatorJob[];
  leaseNext(environment: OperatorEnvironment, workerId: string, leaseDurationMs: number, now: Date): OperatorJob | null;
  markSubmitted(jobId: OperatorJobId, submission: { readonly reference: string; readonly details: JsonObject }, now: Date): OperatorJob;
  complete(jobId: OperatorJobId, completion: OperatorCompletion, now: Date): OperatorJob;
  scheduleRetry(jobId: OperatorJobId, error: string, now: Date): OperatorJob;
  block(jobId: OperatorJobId, reason: string, now: Date): OperatorJob;
  resume(jobId: OperatorJobId, now: Date): OperatorJob;
  cancel(jobId: OperatorJobId, reason: string, now: Date): OperatorJob;
  activateKillSwitch(switchValue: Omit<OperatorKillSwitch, "id" | "deactivatedAt">, now: Date): OperatorKillSwitch;
  deactivateKillSwitch(killSwitchId: string, now: Date): OperatorKillSwitch;
  activeKillSwitches(environment: OperatorEnvironment): readonly OperatorKillSwitch[];
  blockNewRisk(scope: OperatorKillSwitch, now: Date): readonly OperatorJob[];
  recordAlert(alert: Omit<RuntimeAlert, "id" | "createdAt" | "resolvedAt">, now: Date): RuntimeAlert;
  resolveAlert(alertId: string, now: Date): RuntimeAlert;
  activeAlerts(environment: OperatorEnvironment): readonly RuntimeAlert[];
  reportDependency(health: RuntimeDependencyHealth): RuntimeDependencyHealth;
  listDependencies(environment: OperatorEnvironment): readonly RuntimeDependencyHealth[];
  snapshot(now: Date): OperatorRuntimeSnapshot;
}
