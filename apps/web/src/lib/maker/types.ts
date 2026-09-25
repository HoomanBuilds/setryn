export type MakerEnvironment = "ARBITRUM_SEPOLIA" | "LOCAL";

export type DataOrigin = "SIMULATED" | "OBSERVED" | "PROJECTED";

export type CapacityKind = "FIRM" | "INDICATIVE" | "RESERVED";

export type ConnectivityState = "HEALTHY" | "DEGRADED" | "OFFLINE";

export type QuoteSessionState = "QUOTING" | "PAUSED" | "RISK_PAUSED";

export interface Freshness {
  observedAt: string;
  ageMs: number;
  source: string;
  origin: DataOrigin;
}

export interface MakerSeries {
  id: string;
  displayName: string;
  template: string;
  underlying: string;
  settlementAsset: string;
  expiry: string;
  quoteConvention: string;
  quoteCurrency: string;
  quoteUnit: string;
  venueScope: string;
  status: "QUALIFIED" | "CONDITIONAL" | "SUSPENDED";
}

export interface QuoteLevel {
  sizeLabel: string;
  notionalUsd: number;
  bid: number;
  ask: number;
  spreadBps: number;
  firmCapacityUsd: number;
  indicativeCapacityUsd: number;
  expirySeconds: number;
  expectedHedgeCostBps: number;
  fillProbability: number;
  toxicityScore: number;
  expectedEdgeBps: number;
  capacityOrigin: Freshness;
}

export interface MarketRisk {
  seriesId: string;
  grossNotionalUsd: number;
  netDeltaUsd: number;
  expectedHedgeCostBps: number;
  stressLossUsd: number;
  quoteLimitUsd: number;
  utilization: number;
  state: "WITHIN_LIMIT" | "WATCH" | "PAUSED";
}

export interface InventoryPosition {
  id: string;
  seriesId: string;
  label: string;
  netPackageQuantity: number;
  deltaUsd: number;
  vegaUsd: number;
  fundingExposureUsd: number;
  hedgeVenue: string;
  hedgeStatus: "COVERED" | "PENDING" | "UNHEDGED";
  closeCostBps: number;
  freshness: Freshness;
}

export interface RfqRequest {
  id: string;
  seriesId: string;
  side: "BUY" | "SELL";
  sizeLabel: string;
  requestedNotionalUsd: number;
  requestedAt: string;
  expiresInSeconds: number;
  counterpartyScope: string;
  eligibility: "ELIGIBLE" | "CAPACITY_LIMITED" | "RISK_BLOCKED";
  modeledHedgeCostBps: number;
  modeledEdgeBps: number;
  source: Freshness;
}

export interface CapitalBucket {
  label: string;
  amountUsd: number;
  description: string;
  state: "AVAILABLE" | "RESERVED" | "WITHDRAWAL_DELAY" | "RECOVERY";
}

export interface SessionCheck {
  id: string;
  label: string;
  state: ConnectivityState;
  latencyMs: number | null;
  lastUpdate: string;
  source: string;
}

export interface KillSwitchScope {
  id: string;
  label: string;
  description: string;
  active: boolean;
  protectedNotionalUsd: number;
}

export interface MakerCockpitSnapshot {
  environment: MakerEnvironment;
  snapshot: Freshness;
  session: {
    id: string;
    state: QuoteSessionState;
    quoteCount: number;
    hitRate: number;
    realizedPnlUsd: number;
    expectedPnlUsd: number;
  };
  series: MakerSeries[];
  quoteLevels: Record<string, QuoteLevel[]>;
  marketRisk: MarketRisk[];
  inventory: InventoryPosition[];
  rfqs: RfqRequest[];
  capital: CapitalBucket[];
  health: SessionCheck[];
  killSwitches: KillSwitchScope[];
}
