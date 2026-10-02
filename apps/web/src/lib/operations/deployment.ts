import { NETWORK_PROFILES } from "@/lib/internal-gateway/network";
import type { SetrynRuntime, SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import { seriesSchedule as calendarSchedule, type ScheduleSource } from "@/lib/settlements/calendar";
import type { PackageMarket } from "@/lib/terminal/types";

/*
 * Deployment facts every operator-facing page reads: the network runtime (`/api/internal/runtime`), the operator's
 * signer status (`/api/internal/operator/status`) and the deployment evidence checked against the live chain
 * (`/api/internal/deployment`). Nothing here is invented: a field the deployment does not publish reads as null and the
 * page says so. Pure parsing and schedule helpers live here; the polling hooks are in ./hooks.ts.
 */

export type NetworkKey = "local" | "arbitrum-sepolia" | "arbitrum-one";

/** What the product calls each network (the local chain presents as Arbitrum, lib/internal-gateway/network.ts). */
export const NETWORK_LABEL: Record<NetworkKey, string> = {
  local: NETWORK_PROFILES.local.label,
  "arbitrum-sepolia": NETWORK_PROFILES["arbitrum-sepolia"].label,
  "arbitrum-one": NETWORK_PROFILES["arbitrum-one"].label,
};

/** Operator-facing name that keeps the local chain distinct from Arbitrum One. */
export const NETWORK_OPERATOR_LABEL: Record<NetworkKey, string> = {
  local: "Local chain",
  "arbitrum-sepolia": "Arbitrum Sepolia",
  "arbitrum-one": "Arbitrum One",
};

export function networkOf(chainId: number | null | undefined, declared?: string | null): NetworkKey | null {
  if (declared === "local" || declared === "arbitrum-sepolia" || declared === "arbitrum-one") return declared;
  if (chainId === 42161) return "arbitrum-one";
  if (chainId === 421614) return "arbitrum-sepolia";
  if (chainId === 31337) return "local";
  return null;
}

export function networkLabel(chainId: number | null | undefined, declared?: string | null): string {
  const network = networkOf(chainId, declared);
  return network ? NETWORK_LABEL[network] : chainId ? `Chain ${chainId}` : "Unknown network";
}

/** Writes are refused on Arbitrum One until mainnet work is explicitly authorized (AGENTS.md). */
export function writesAllowed(network: NetworkKey | null): boolean {
  return network === "local" || network === "arbitrum-sepolia";
}

/* ------------------------------------------------------------------ */
/* Polled JSON resources                                               */
/* ------------------------------------------------------------------ */

export interface Resource<T> {
  data: T | null;
  /** Null while loading or after a successful read. */
  error: string | null;
  loading: boolean;
  /** Browser time of the last successful read, ms; 0 before the first. */
  readAt: number;
}

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

export function runtimeMarket(runtime: SetrynRuntime | null, marketKey: string): SetrynRuntimeMarket | null {
  return runtime?.markets.find((market) => market.marketKey === marketKey) ?? null;
}

/* ------------------------------------------------------------------ */
/* Operator status                                                     */
/* ------------------------------------------------------------------ */

export interface SignerStatus {
  /** True when the server holds a key for the role, false when it does not, null when not reported. */
  available: boolean | null;
  address: string | null;
  /** Why the role is unavailable, when the route says. */
  reason: string | null;
}

export interface OperatorContract {
  label: string;
  address: string;
  healthy: boolean;
}

export interface OperatorStatus {
  network: NetworkKey | null;
  /** The route's own label for the network. */
  label: string | null;
  /** How fee schedules change on this network, e.g. LOCAL_OPERATOR or GOVERNANCE_TIMELOCK. */
  feeChanges: string | null;
  /** Whether the settlement-asset faucet exists (local only). */
  funding: boolean | null;
  /** The chain did not answer even though the runtime loaded. */
  chainUnavailable: boolean;
  chainId: number | null;
  blockNumber: number | null;
  checkedAt: string | null;
  healthy: boolean | null;
  runtimeSchema: number | null;
  operator: SignerStatus;
  maker: SignerStatus;
  oracle: SignerStatus;
  contracts: OperatorContract[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOf(value: unknown): number | null {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Accepts `{ available, address }`, a bare boolean, or an address string (meaning a key is configured). */
function signerOf(...candidates: unknown[]): SignerStatus {
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") return { available: candidate, address: null, reason: null };
    if (typeof candidate === "string" && /^0x[0-9a-fA-F]{40}$/.test(candidate)) return { available: true, address: candidate, reason: null };
    const entry = record(candidate);
    if (!entry) continue;
    const available =
      typeof entry.available === "boolean"
        ? entry.available
        : typeof entry.configured === "boolean"
          ? entry.configured
          : typeof entry.enabled === "boolean"
            ? entry.enabled
            : null;
    const address = stringOf(entry.address) ?? stringOf(entry.signer);
    if (available !== null || address !== null) {
      return { available: available ?? (address !== null ? true : null), address, reason: stringOf(entry.reason) };
    }
  }
  return { available: null, address: null, reason: null };
}

/** Normalizes `/api/internal/operator/status`; every field the route does not report reads as null. */
export function parseOperatorStatus(body: unknown): OperatorStatus | null {
  const root = record(body);
  if (!root || (root.network === undefined && root.signers === undefined && root.chainId === undefined)) return null;
  const signers = record(root.signers) ?? {};
  const runtime = record(root.runtime) ?? {};
  const contracts = Array.isArray(root.contracts)
    ? root.contracts
        .map((entry) => record(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((entry) => ({
          label: stringOf(entry.label) ?? stringOf(entry.name) ?? "Contract",
          address: stringOf(entry.address) ?? "",
          healthy: entry.healthy === true,
        }))
    : [];
  const chainId = numberOf(root.chainId);
  const funding = record(root.funding);
  return {
    network: networkOf(chainId ?? numberOf(root.runtimeChainId), stringOf(root.network)),
    label: stringOf(root.label),
    feeChanges: stringOf(root.feeChanges),
    funding: typeof funding?.available === "boolean" ? funding.available : null,
    chainUnavailable: root.error === "CHAIN_UNAVAILABLE",
    chainId: chainId ?? numberOf(root.runtimeChainId),
    blockNumber: numberOf(root.blockNumber),
    checkedAt: stringOf(root.checkedAt),
    healthy: typeof root.healthy === "boolean" ? root.healthy : null,
    runtimeSchema: numberOf(root.runtimeSchema) ?? numberOf(root.schemaVersion) ?? numberOf(runtime.schemaVersion),
    operator: signerOf(signers.operator, root.operator, root.operatorSigner, root.operatorAvailable),
    maker: signerOf(signers.maker, root.maker, root.makerSigner, root.makerAvailable),
    oracle: signerOf(signers.oracle, signers.oraclePublisher, root.oracle, root.oracleSigner, root.oracleAvailable),
    contracts,
  };
}

/* ------------------------------------------------------------------ */
/* Deployment evidence                                                 */
/* ------------------------------------------------------------------ */

export interface EvidenceContract {
  name: string;
  kind: "library" | "core" | "protocol";
  address: string | null;
  expectedHash: string | null;
  liveHash: string | null;
  state: "MATCHES" | "MISMATCH" | "MISSING";
}

export interface DeploymentEvidence {
  environment: string | null;
  manifestChainId: number | null;
  chainId: number | null;
  status: string | null;
  generatedAt: string | null;
  sourceCommit: string | null;
  compiler: { version: string; evmVersion: string; optimizerRuns: number | null; viaIR: boolean } | null;
  blockNumber: number | null;
  headTime: string | null;
  chainTime: string | null;
  checkedAt: string | null;
  contracts: EvidenceContract[];
}

export function parseEvidence(body: unknown): DeploymentEvidence | null {
  const root = record(body);
  if (!root || !Array.isArray(root.contracts)) return null;
  const compiler = record(root.compiler);
  const optimizer = record(compiler?.optimizer);
  const contracts = Array.isArray(root.contracts)
    ? root.contracts
        .map((entry) => record(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((entry): EvidenceContract => ({
          name: stringOf(entry.name) ?? "Contract",
          kind: entry.kind === "library" || entry.kind === "protocol" ? entry.kind : "core",
          address: stringOf(entry.address),
          expectedHash: stringOf(entry.expectedHash),
          liveHash: stringOf(entry.liveHash),
          state: entry.state === "MATCHES" || entry.state === "MISMATCH" ? entry.state : "MISSING",
        }))
    : [];
  return {
    environment: stringOf(root.environment),
    manifestChainId: numberOf(root.manifestChainId),
    chainId: numberOf(root.chainId),
    status: stringOf(root.status),
    generatedAt: stringOf(root.generatedAt),
    sourceCommit: stringOf(root.sourceCommit),
    compiler: compiler
      ? {
          version: stringOf(compiler.version) ?? "unknown",
          evmVersion: stringOf(compiler.evmVersion) ?? "unknown",
          optimizerRuns: numberOf(optimizer?.runs),
          viaIR: compiler.viaIR === true,
        }
      : null,
    blockNumber: numberOf(root.blockNumber),
    headTime: stringOf(root.headTime),
    chainTime: stringOf(root.chainTime),
    checkedAt: stringOf(root.checkedAt),
    contracts,
  };
}

/* ------------------------------------------------------------------ */
/* Series schedule                                                     */
/* ------------------------------------------------------------------ */

export type SeriesEventKind =
  | "LAST_TRADING"
  | "FIXING_OPENS"
  | "EXPIRY"
  | "ELECTION_OPENS"
  | "ELECTION_CUTOFF"
  | "FINAL_RESOLUTION"
  | "SETTLEMENT_DEADLINE";

export const SERIES_EVENT_LABEL: Record<SeriesEventKind, string> = {
  LAST_TRADING: "Last trading",
  FIXING_OPENS: "Fixing window opens",
  EXPIRY: "Expiry and fixing close",
  ELECTION_OPENS: "Holder election opens",
  ELECTION_CUTOFF: "Holder election cutoff",
  FINAL_RESOLUTION: "Final resolution",
  SETTLEMENT_DEADLINE: "Settlement deadline",
};

/** What a keeper (anyone) can call once the event passes. */
export const SERIES_EVENT_ACTION: Record<SeriesEventKind, string> = {
  LAST_TRADING: "New orders on the series stop matching",
  FIXING_OPENS: "Publish signed fixing observations",
  EXPIRY: "Finalize the fixing from the published evidence",
  ELECTION_OPENS: "Holders may exercise against the final fixing",
  ELECTION_CUTOFF: "Unelected lots lapse; automatic exercise may run",
  FINAL_RESOLUTION: "Write settlement records for every position",
  SETTLEMENT_DEADLINE: "Settle or open claims; permissionless completion",
};

/** A series' schedule in unix seconds, with where it was read from. */
export type SeriesSchedule = Pick<
  SetrynRuntimeMarket,
  | "marketKey"
  | "lastTradingAt"
  | "expiryAt"
  | "fixingWindowOpen"
  | "fixingWindowClose"
  | "exerciseOpensAt"
  | "exerciseCutoffAt"
  | "finalResolutionAt"
  | "settlementDeadline"
> & { source: ScheduleSource };

const RUNTIME_SCHEDULE_FIELDS = [
  "expiryAt",
  "lastTradingAt",
  "fixingWindowOpen",
  "fixingWindowClose",
  "exerciseOpensAt",
  "exerciseCutoffAt",
  "finalResolutionAt",
  "settlementDeadline",
] as const;

/**
 * A market's series schedule through the shared calendar (lib/settlements/calendar.ts): the runtime's own instants when
 * it publishes them, else the catalog's, else the series terms applied to the listed expiry.
 */
export function seriesSchedule(
  market: Pick<PackageMarket, "id" | "expiryIso"> & Partial<Pick<PackageMarket, "expiryAt" | "lastTradingAt">>,
  runtimeEntry: SetrynRuntimeMarket | null,
): SeriesSchedule {
  const merged: Record<string, unknown> = { ...market };
  for (const field of RUNTIME_SCHEDULE_FIELDS) {
    const value = runtimeEntry?.[field];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) merged[field] = value;
  }
  const schedule = calendarSchedule(merged as unknown as Pick<PackageMarket, "id" | "expiryIso">);
  const at = (ms: number) => (Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined);
  return {
    marketKey: market.id,
    lastTradingAt: at(schedule.lastTradingMs),
    expiryAt: at(schedule.fixingMs),
    fixingWindowOpen: at(schedule.windowOpensMs),
    fixingWindowClose: at(schedule.fixingMs),
    exerciseOpensAt: at(schedule.electionOpensMs),
    exerciseCutoffAt: at(schedule.electionClosesMs),
    finalResolutionAt: at(schedule.finalResolutionMs),
    settlementDeadline: at(schedule.settlementDeadlineMs),
    source: schedule.source,
  };
}

export interface SeriesEvent {
  marketKey: string;
  kind: SeriesEventKind;
  /** Unix seconds. */
  at: number;
}

/** The runtime's own schedule for a series (schema 11). Older runtimes publish only what the catalog carries. */
export function seriesEvents(market: SeriesSchedule): SeriesEvent[] {
  const fields: [SeriesEventKind, number | undefined][] = [
    ["LAST_TRADING", market.lastTradingAt],
    ["FIXING_OPENS", market.fixingWindowOpen],
    ["EXPIRY", market.fixingWindowClose ?? market.expiryAt],
    ["ELECTION_OPENS", market.exerciseOpensAt],
    ["ELECTION_CUTOFF", market.exerciseCutoffAt],
    ["FINAL_RESOLUTION", market.finalResolutionAt],
    ["SETTLEMENT_DEADLINE", market.settlementDeadline],
  ];
  return fields
    .filter((entry): entry is [SeriesEventKind, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0)
    .map(([kind, at]) => ({ marketKey: market.marketKey, kind, at }));
}

/** Where a series stands by its published schedule at `now` (unix seconds). */
export type SeriesPhase =
  | "TRADING"
  | "PRE_FIXING"
  | "FIXING"
  | "ELECTION"
  | "RESOLUTION"
  | "SETTLEMENT"
  | "COMPLETE"
  | "EXPIRED"
  | "UNSCHEDULED";

export const SERIES_PHASE_LABEL: Record<SeriesPhase, string> = {
  TRADING: "Trading",
  PRE_FIXING: "Trading closed",
  FIXING: "Fixing window",
  ELECTION: "Holder election",
  RESOLUTION: "Awaiting resolution",
  SETTLEMENT: "Settlement",
  COMPLETE: "Settlement deadline passed",
  EXPIRED: "Expired",
  UNSCHEDULED: "Schedule not published",
};

export function seriesPhase(market: SeriesSchedule, now: number): SeriesPhase {
  const expiry = market.fixingWindowClose ?? market.expiryAt;
  if (!market.lastTradingAt || !expiry) return "UNSCHEDULED";
  if (now < market.lastTradingAt) return "TRADING";
  if (now < expiry) return market.fixingWindowOpen && now >= market.fixingWindowOpen ? "FIXING" : "PRE_FIXING";
  if (!market.settlementDeadline) return "EXPIRED";
  if (market.exerciseCutoffAt && now < market.exerciseCutoffAt) return "ELECTION";
  if (market.finalResolutionAt && now < market.finalResolutionAt) return "RESOLUTION";
  if (now < market.settlementDeadline) return "SETTLEMENT";
  return "COMPLETE";
}
