import type { Guarantee, PackageLeg, PackageMarket, Provenance } from "@/lib/terminal/types";

export type LifecycleHealth = "HEALTHY" | "ATTENTION" | "WINDOW_OPEN";

export type LifecycleOrigin = "RUNTIME" | "STATIC_PREVIEW";

export type LifecycleActionKind = "ROLL" | "REBALANCE" | "MIGRATE" | "DE_RISK" | "EXIT";

export type LifecycleBoundaryKind = "FUNDING" | "FIXING" | "EXPIRY" | "REBALANCE";

export interface LifecycleBoundary {
  id: string;
  kind: LifecycleBoundaryKind;
  label: string;
  dueLabel: string;
  timing: string;
  state: "UPCOMING" | "WINDOW_OPEN" | "LOCKED";
  source: string;
}

export interface LifecycleLeg extends PackageLeg {
  lifecycleRole: string;
  dependency: string;
  nextBoundaryId: string | null;
  observation: {
    provenance: Provenance;
    ageSeconds: number;
    source: string;
  };
}

export interface LifecycleImpact {
  label: string;
  before: string;
  after: string;
  tone?: "default" | "up" | "down" | "brand";
}

export interface LifecycleConstraint {
  label: string;
  state: "SATISFIED" | "REQUIRES_QUOTE" | "BLOCKED";
  detail: string;
}

export interface LifecycleProposal {
  id: string;
  kind: LifecycleActionKind;
  label: string;
  actionLabel: string;
  route: "TRADE" | "STUDIO";
  requestedLots: number;
  summary: string;
  quoteRequirement: string;
  maxCloseCost: number;
  estimatedTimeToUnwindSeconds: number;
  impacts: LifecycleImpact[];
  constraints: LifecycleConstraint[];
}

export interface LifecycleStrategy {
  id: string;
  market: PackageMarket;
  label: string;
  origin: LifecycleOrigin;
  environmentLabel: string;
  evidenceLabel: string;
  receiptId: string | null;
  createdAt: string | null;
  side: "LONG" | "SHORT";
  lots: number;
  health: LifecycleHealth;
  healthDetail: string;
  entryPrice: number;
  markPrice: number;
  closeCost: number;
  timeToUnwindSeconds: number;
  collateral: number;
  liquidationDistance: number;
  maxResidual: number;
  settlementClass: string;
  guarantee: Guarantee;
  recoveryClass: string;
  observation: {
    provenance: Provenance;
    ageSeconds: number;
    source: string;
    asOfLabel: string;
  };
  boundaries: LifecycleBoundary[];
  legs: LifecycleLeg[];
  proposals: LifecycleProposal[];
}
