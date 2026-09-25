export type OperationsEnvironment = "ARBITRUM_SEPOLIA" | "ARBITRUM_ONE";

export type HealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export type EvidenceKind = "FIXTURE" | "RECORDED" | "MODELED";

export type JobRunner = "SOLVER" | "KEEPER" | "ORACLE_RELAY" | "INDEXER";

export type RecoveryState =
  | "RECONCILING"
  | "RECOVERY_QUEUED"
  | "RESOLUTION_READY"
  | "RESOLVED";

export type KillSwitchState = "ARMED" | "STOPPED";

export type KillSwitchScope =
  | "PACKAGE_ADMISSION"
  | "SOLVER_ROUTING"
  | "MAKER_QUOTING"
  | "LIFECYCLE_KEEPERS";

export type AlertSeverity = "CRITICAL" | "WARNING" | "NOTICE";

export type AlertState = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export interface Freshness {
  recordedAt: string;
  ageLabel: string;
  thresholdLabel: string;
  withinThreshold: boolean;
}

export interface DependencyHealth {
  id: string;
  label: string;
  service: string;
  state: HealthState;
  evidence: EvidenceKind;
  freshness: Freshness;
  checkpoint: string;
  detail: string;
}

export interface IndexerStream {
  id: string;
  label: string;
  state: HealthState;
  headBlock: number;
  projectedBlock: number;
  lagBlocks: number;
  allowedLagBlocks: number;
  freshness: Freshness;
  evidence: EvidenceKind;
}

export interface JobQueue {
  id: string;
  runner: JobRunner;
  label: string;
  state: HealthState;
  queued: number;
  leased: number;
  delayed: number;
  lastCompletion: string;
  nextCheckpoint: string;
  detail: string;
  evidence: EvidenceKind;
  freshness: Freshness;
}

export interface RecoveryEvent {
  id: string;
  at: string;
  label: string;
  detail: string;
  evidence: EvidenceKind;
}

export interface RecoveryCase {
  id: string;
  packageCode: string;
  state: RecoveryState;
  riskBoundary: string;
  residual: string;
  deadline: string;
  writeAuthority: string;
  newRiskBlocked: boolean;
  terminalResolutionPermitted: boolean;
  evidence: EvidenceKind;
  freshness: Freshness;
  events: RecoveryEvent[];
}

export interface KillSwitch {
  id: string;
  scope: KillSwitchScope;
  label: string;
  state: KillSwitchState;
  stops: string;
  permits: string;
  changedAt: string;
  actor: string;
  evidence: EvidenceKind;
}

export interface EnvironmentWritePolicy {
  environment: OperationsEnvironment;
  label: string;
  writesAllowed: boolean;
  policyLabel: string;
  detail: string;
  evidence: EvidenceKind;
}

export interface OperationalAlert {
  id: string;
  severity: AlertSeverity;
  state: AlertState;
  title: string;
  detail: string;
  source: string;
  openedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  evidence: EvidenceKind;
  freshness: Freshness;
}

export interface OperationsJournalEntry {
  id: string;
  at: string;
  actor: string;
  subject: string;
  action: string;
  detail: string;
  evidence: EvidenceKind;
}

export interface OperationsSnapshot {
  capturedAt: string;
  captureLabel: string;
  dependencies: DependencyHealth[];
  indexerStreams: IndexerStream[];
  jobQueues: JobQueue[];
  recoveryCases: RecoveryCase[];
  killSwitches: KillSwitch[];
  writePolicies: EnvironmentWritePolicy[];
  alerts: OperationalAlert[];
  journal: OperationsJournalEntry[];
}
