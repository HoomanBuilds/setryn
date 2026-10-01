/*
 * Operations read model. Every value is read from the deployment runtime, the chain (through the operator status and
 * deployment evidence routes) or the market-data feed. A check that cannot run reads as UNAVAILABLE, never as a
 * recorded stand-in.
 */

export type OperationsEnvironment = "LOCAL" | "ARBITRUM_SEPOLIA" | "ARBITRUM_ONE";

export type HealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

/** How a value is known: read live from the chain or a route, or derived from the published schedule. */
export type EvidenceKind = "OBSERVED" | "SCHEDULED" | "DERIVED";

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

/** An indexer projection checkpoint. No indexer service reports to the web app yet, so snapshots carry none. */
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
  transactionHash?: string;
}

/** The health summary other surfaces (status strip, alerts) read; built from live checks only. */
export interface OperationsSnapshot {
  capturedAt: string;
  captureLabel: string;
  dependencies: DependencyHealth[];
  indexerStreams: IndexerStream[];
  writePolicies: EnvironmentWritePolicy[];
  alerts: OperationalAlert[];
  journal: OperationsJournalEntry[];
}
