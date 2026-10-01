import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import type { MarketDataSnapshot, MarketFeedStatus, SeriesStatus } from "@/lib/market-data/types";
import type { PackageMarket } from "@/lib/terminal/types";
import {
  NETWORK_OPERATOR_LABEL,
  runtimeMarket,
  seriesEvents,
  seriesPhase,
  seriesSchedule,
  writesAllowed,
  type DeploymentEvidence,
  type NetworkKey,
  type OperatorStatus,
  type Resource,
  type SeriesEvent,
  type SeriesPhase,
  type SeriesSchedule,
} from "./deployment";
import type {
  DependencyHealth,
  EnvironmentWritePolicy,
  Freshness,
  HealthState,
  OperationalAlert,
  OperationsJournalEntry,
  OperationsSnapshot,
} from "./types";

/* ------------------------------------------------------------------ */
/* Series                                                              */
/* ------------------------------------------------------------------ */

export interface SeriesRow {
  marketKey: string;
  underlying: string;
  name: string;
  strategyLabel: string;
  seriesId: string | null;
  status: SeriesStatus;
  tradable: boolean | null;
  seriesVersion: number | null;
  feeScheduleVersion: number | null;
  schedule: SeriesSchedule;
  phase: SeriesPhase;
  /** The next scheduled event at or after `now`, if any. */
  next: SeriesEvent | null;
  restingOrders: number;
  openInterestLots: number | null;
  volume24hLots: number;
  floor: number | null;
  cap: number | null;
  lotSize: number | null;
  maxOrderLots: number | null;
  /** Listed by the runtime the server reads. */
  onchain: boolean;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function seriesRows(
  markets: readonly PackageMarket[],
  runtime: SetrynRuntime | null,
  feed: MarketDataSnapshot | null,
  now: number,
): SeriesRow[] {
  return markets.map((market) => {
    const entry = runtimeMarket(runtime, market.id);
    const live = feed?.markets.find((candidate) => candidate.marketKey === market.id) ?? null;
    const schedule = seriesSchedule(market, entry);
    const events = seriesEvents(schedule);
    return {
      marketKey: market.id,
      underlying: market.underlying,
      name: market.name,
      strategyLabel: market.strategyLabel,
      seriesId: entry?.seriesId ?? null,
      status: live?.seriesStatus ?? "UNKNOWN",
      tradable: live ? live.tradable : null,
      seriesVersion: live?.seriesVersion ?? entry?.seriesVersion ?? null,
      feeScheduleVersion: live?.feeScheduleVersion ?? null,
      schedule,
      phase: seriesPhase(schedule, now),
      next: events.find((event) => event.at >= now) ?? null,
      restingOrders: live?.book.length ?? 0,
      openInterestLots: finiteOrNull(live?.openInterestLots),
      volume24hLots: finiteOrNull(live?.volume24hLots) ?? 0,
      floor: finiteOrNull(entry?.floor !== undefined ? Number(entry.floor) : market.floor),
      cap: finiteOrNull(entry?.cap !== undefined ? Number(entry.cap) : market.cap),
      lotSize: finiteOrNull(entry?.lotSize !== undefined ? Number(entry.lotSize) : market.lotSize),
      maxOrderLots: entry?.maxOrderLots ?? market.maxOrderLots ?? null,
      onchain: entry !== null,
    };
  });
}

/** Every scheduled series event from `from` on, soonest first. */
export function upcomingEvents(rows: readonly SeriesRow[], from: number, limit = 40): SeriesEvent[] {
  return rows
    .flatMap((row) => seriesEvents(row.schedule))
    .filter((event) => event.at >= from)
    .sort((left, right) => left.at - right.at)
    .slice(0, limit);
}

/** Series past last trading whose settlement deadline has not passed, or passed with open interest left. */
export function terminalRows(rows: readonly SeriesRow[]): SeriesRow[] {
  return rows.filter(
    (row) =>
      row.phase !== "TRADING" &&
      row.phase !== "UNSCHEDULED" &&
      (row.phase !== "COMPLETE" || (row.openInterestLots ?? 0) > 0),
  );
}

/* ------------------------------------------------------------------ */
/* Freshness                                                           */
/* ------------------------------------------------------------------ */

export function ageLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  if (seconds < 60) return `${Math.round(seconds)} s old`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} m old`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h old`;
  return `${Math.round(seconds / 86_400)} d old`;
}

function freshness(readAtMs: number, nowMs: number, thresholdSeconds: number): Freshness {
  if (!(readAtMs > 0)) {
    return { recordedAt: new Date(nowMs).toISOString(), ageLabel: "not read", thresholdLabel: `${thresholdSeconds} s maximum`, withinThreshold: false };
  }
  const age = Math.max(0, (nowMs - readAtMs) / 1000);
  return {
    recordedAt: new Date(readAtMs).toISOString(),
    ageLabel: ageLabel(age),
    thresholdLabel: thresholdSeconds >= 3_600 ? `${Math.round(thresholdSeconds / 3_600)} h maximum` : `${thresholdSeconds} s maximum`,
    withinThreshold: age <= thresholdSeconds,
  };
}

/* ------------------------------------------------------------------ */
/* Dependencies, policies, alerts                                      */
/* ------------------------------------------------------------------ */

export interface OperationsInput {
  /** Platform clock, unix seconds. */
  now: number;
  runtime: Resource<SetrynRuntime>;
  status: Resource<OperatorStatus>;
  evidence: Resource<DeploymentEvidence>;
  feedStatus: MarketFeedStatus;
  feed: MarketDataSnapshot | null;
  markets: readonly PackageMarket[];
}

export function networkOfInput(input: Pick<OperationsInput, "runtime" | "status" | "feed">): NetworkKey | null {
  return input.status.data?.network ?? (input.runtime.data?.network as NetworkKey | undefined) ?? null;
}

export function dependencies(input: OperationsInput): DependencyHealth[] {
  const nowMs = input.now * 1000;
  const status = input.status.data;
  const evidence = input.evidence.data;
  const references = Object.values(input.feed?.references ?? {});
  const oldestReference = references.length > 0 ? Math.min(...references.map((reference) => reference.updatedAt)) : 0;
  const contractsOk = status ? status.contracts.filter((contract) => contract.healthy).length : 0;
  const matches = evidence ? evidence.contracts.filter((contract) => contract.state === "MATCHES").length : 0;

  const chainState: HealthState = !status || status.chainUnavailable ? "UNAVAILABLE" : status.healthy ? "HEALTHY" : "DEGRADED";
  const feedState: HealthState = input.feedStatus === "LIVE" ? (input.feed?.chain?.status === "UNAVAILABLE" ? "DEGRADED" : "HEALTHY") : input.feedStatus === "STALE" ? "DEGRADED" : "UNAVAILABLE";
  const referenceState: HealthState = references.length === 0 ? "UNAVAILABLE" : input.now - oldestReference > 6 * 3_600 ? "DEGRADED" : "HEALTHY";
  const evidenceState: HealthState = !evidence ? "UNAVAILABLE" : matches === evidence.contracts.length ? "HEALTHY" : "DEGRADED";
  const runtimeState: HealthState = input.runtime.data ? "HEALTHY" : "UNAVAILABLE";

  return [
    {
      id: "runtime",
      label: "Deployment runtime",
      service: input.runtime.data ? `Schema ${input.runtime.data.schemaVersion} / ${input.runtime.data.markets.length} markets` : "Runtime file",
      state: runtimeState,
      evidence: "OBSERVED",
      freshness: freshness(input.runtime.readAt, nowMs, 3_600),
      checkpoint: input.runtime.data ? `chain ${input.runtime.data.chainId}` : (input.runtime.error ?? "loading"),
      detail: input.runtime.data
        ? "The runtime file the server reads names every contract and listed market this page reports."
        : "The server could not read the runtime file, so no deployment facts are available.",
    },
    {
      id: "chain",
      label: "Settlement chain",
      service: status?.label ?? "RPC",
      state: chainState,
      evidence: "OBSERVED",
      freshness: freshness(input.status.readAt, nowMs, 30),
      checkpoint: status?.blockNumber ? `block ${status.blockNumber.toLocaleString("en-US")}` : (input.status.error ?? "loading"),
      detail: status
        ? `${contractsOk} of ${status.contracts.length} core contracts have code at their runtime addresses.${status.chainUnavailable ? " The RPC did not answer the last check." : ""}`
        : "The operator status route has not answered.",
    },
    {
      id: "market-data",
      label: "Market-data feed",
      service: "Onchain book, fills and references",
      state: feedState,
      evidence: "OBSERVED",
      freshness: freshness(input.feed ? input.feed.asOf * 1000 : 0, nowMs, 30),
      checkpoint: input.feed ? `block ${input.feed.blockNumber.toLocaleString("en-US")}` : input.feedStatus.toLowerCase(),
      detail:
        input.feed?.chain?.status === "UNAVAILABLE"
          ? `The feed answered but the chain did not (${input.feed.chain.reason ?? "unreachable"}).`
          : "Marks, books, tapes and charts on every page read this one snapshot.",
    },
    {
      id: "references",
      label: "Chainlink references",
      service: `${references.length} underlyings`,
      state: referenceState,
      evidence: "OBSERVED",
      freshness: freshness(oldestReference * 1000, nowMs, 6 * 3_600),
      checkpoint: references.length > 0 ? `oldest round ${new Date(oldestReference * 1000).toISOString().slice(11, 16)} UTC` : "not read",
      detail:
        references.length === 0
          ? "The reference RPC could not be read; marks without book or fills have no reference."
          : "Aggregator answers on Arbitrum One. FX and metals feeds pause outside market hours.",
    },
    {
      id: "evidence",
      label: "Deployment evidence",
      service: evidence?.sourceCommit ? `commit ${evidence.sourceCommit.slice(0, 10)}` : "Manifest",
      state: evidenceState,
      evidence: "OBSERVED",
      freshness: freshness(input.evidence.readAt, nowMs, 120),
      checkpoint: evidence ? `${matches}/${evidence.contracts.length} code hashes match` : (input.evidence.error ?? "loading"),
      detail: evidence
        ? "Each recorded contract's live runtime code is hashed and compared with the hash recorded at deployment."
        : "No deployment manifest was readable for this network.",
    },
  ];
}

export function writePolicies(active: NetworkKey | null): EnvironmentWritePolicy[] {
  const policy = (network: NetworkKey, environment: EnvironmentWritePolicy["environment"]): EnvironmentWritePolicy => ({
    environment,
    label: NETWORK_OPERATOR_LABEL[network],
    writesAllowed: writesAllowed(network),
    policyLabel: writesAllowed(network) ? (network === "local" ? "Local writes" : "Testnet writes") : "Read only",
    detail:
      network === "arbitrum-one"
        ? "Deployment scripts, the operator worker and server signers refuse Arbitrum One until mainnet work is explicitly authorized. Reads only."
        : network === "arbitrum-sepolia"
          ? "Operator, designated maker and oracle publisher sign with configured keys. Settlement in Circle USDC on Arbitrum Sepolia."
          : "Anvil accounts sign every role and the mintable settlement token funds wallets.",
    evidence: network === active ? "OBSERVED" : "DERIVED",
  });
  return [policy("local", "LOCAL"), policy("arbitrum-sepolia", "ARBITRUM_SEPOLIA"), policy("arbitrum-one", "ARBITRUM_ONE")];
}

export function deriveAlerts(input: OperationsInput, rows: readonly SeriesRow[]): OperationalAlert[] {
  const nowMs = input.now * 1000;
  const openedAt = new Date(nowMs).toISOString().slice(11, 19);
  const alerts: OperationalAlert[] = [];
  const push = (id: string, severity: OperationalAlert["severity"], title: string, detail: string, source: string, readAtMs: number, threshold = 60) =>
    alerts.push({
      id,
      severity,
      state: "OPEN",
      title,
      detail,
      source,
      openedAt: `${openedAt} UTC`,
      evidence: "OBSERVED",
      freshness: freshness(readAtMs, nowMs, threshold),
    });
  const status = input.status.data;
  const network = networkOfInput(input);

  if (!input.runtime.data && !input.runtime.loading) {
    push("ALT-RUNTIME", "CRITICAL", "Runtime unavailable", `The server could not read the network runtime (${input.runtime.error ?? "unknown"}).`, "/api/internal/runtime", input.runtime.readAt);
  }
  if (status?.chainUnavailable || (input.status.error && !status && !input.status.loading)) {
    push("ALT-CHAIN", "CRITICAL", "Settlement chain not answering", "The operator status check could not read the chain head.", "/api/internal/operator/status", input.status.readAt);
  }
  if (status && input.runtime.data && status.chainId !== null && status.chainId !== input.runtime.data.chainId) {
    push("ALT-CHAIN-ID", "CRITICAL", "Chain id mismatch", `The RPC reports chain ${status.chainId} but the runtime was written for ${input.runtime.data.chainId}.`, "/api/internal/operator/status", input.status.readAt);
  }
  for (const contract of status?.contracts ?? []) {
    if (!contract.healthy) {
      push(`ALT-CODE-${contract.address.slice(2, 10)}`, "CRITICAL", `${contract.label} has no code`, `No runtime code at ${contract.address}.`, "/api/internal/operator/status", input.status.readAt);
    }
  }
  for (const contract of input.evidence.data?.contracts ?? []) {
    if (contract.state === "MATCHES") continue;
    push(
      `ALT-EVIDENCE-${(contract.address ?? contract.name).slice(-8)}`,
      contract.state === "MISSING" ? "CRITICAL" : "WARNING",
      `${contract.name} code ${contract.state === "MISSING" ? "missing" : "differs from evidence"}`,
      contract.state === "MISSING"
        ? `The manifest records ${contract.name} at ${contract.address ?? "no address"}, which has no code.`
        : `The live code hash ${contract.liveHash?.slice(0, 12) ?? "?"}… differs from the recorded ${contract.expectedHash?.slice(0, 12) ?? "?"}….`,
      "/api/internal/deployment",
      input.evidence.readAt,
      120,
    );
  }
  if (status && status.operator.available === false) {
    push("ALT-OPERATOR", network === "local" ? "WARNING" : "CRITICAL", "Operator signer not configured", status.operator.reason ?? "Risk admission, witness staging and keeper calls cannot be signed by the server.", "/api/internal/operator/status", input.status.readAt);
  }
  if (status && status.maker.available === false) {
    push("ALT-MAKER", "NOTICE", "No designated maker", status.maker.reason ?? "Private requests receive no house quotes and no house liquidity rests on the books.", "/api/internal/operator/status", input.status.readAt);
  }
  if (input.feedStatus === "STALE" || input.feedStatus === "ERROR") {
    push("ALT-FEED", input.feedStatus === "ERROR" ? "CRITICAL" : "WARNING", `Market-data feed ${input.feedStatus === "ERROR" ? "unavailable" : "stale"}`, "Marks, books and charts are not updating.", "/api/market-data", input.feed ? input.feed.asOf * 1000 : 0, 15);
  }
  if (input.feed?.fees && !input.feed.fees.active) {
    push("ALT-FEES", "WARNING", "Fee schedule not active", `Version ${input.feed.fees.version} is not the registry's active version, so nothing can clear.`, "/api/market-data", input.feed.asOf * 1000);
  }
  if (input.feed?.fees?.source === "RUNTIME") {
    push("ALT-FEES-SOURCE", "WARNING", "Fee rates from runtime fallback", "The fee registry could not be read; orders price fees from the runtime file.", "/api/market-data", input.feed.asOf * 1000);
  }
  for (const reference of Object.values(input.feed?.references ?? {})) {
    const age = input.now - reference.updatedAt;
    if (age > 6 * 3_600) {
      push(`ALT-REF-${reference.underlying}`, "NOTICE", `${reference.underlying} reference ${Math.round(age / 3_600)} h old`, "The aggregator has not updated; FX and metals pause outside market hours.", "Chainlink", reference.updatedAt * 1000, 6 * 3_600);
    }
  }
  for (const row of rows) {
    if (row.status === "PAUSED") {
      push(`ALT-PAUSED-${row.marketKey}`, "WARNING", `${row.marketKey} paused`, "The series registry has paused new orders. Terminal resolution stays permissionless.", "Series registry", input.feed ? input.feed.asOf * 1000 : 0);
    }
    if (row.next && row.next.at - input.now <= 24 * 3_600 && (row.next.kind === "FIXING_OPENS" || row.next.kind === "EXPIRY" || row.next.kind === "SETTLEMENT_DEADLINE")) {
      push(`ALT-DUE-${row.marketKey}-${row.next.kind}`, "NOTICE", `${row.marketKey} keeper window within 24 h`, `${row.next.kind.replace(/_/g, " ").toLowerCase()} at ${new Date(row.next.at * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC.`, "Series schedule", nowMs, 86_400);
    }
    if (row.phase === "COMPLETE" && (row.openInterestLots ?? 0) > 0) {
      push(`ALT-OPEN-${row.marketKey}`, "WARNING", `${row.marketKey} past settlement deadline with open interest`, `${row.openInterestLots} lots remain open; anyone can complete settlement or open claims.`, "Position engine", input.feed ? input.feed.asOf * 1000 : 0);
    }
  }
  const order: Record<OperationalAlert["severity"], number> = { CRITICAL: 0, WARNING: 1, NOTICE: 2 };
  return alerts.sort((left, right) => order[left.severity] - order[right.severity]);
}

/* ------------------------------------------------------------------ */
/* Snapshot for other surfaces                                         */
/* ------------------------------------------------------------------ */

export const EMPTY_OPERATIONS_SNAPSHOT: OperationsSnapshot = {
  capturedAt: new Date(0).toISOString(),
  captureLabel: "No operations reading yet",
  dependencies: [],
  indexerStreams: [],
  writePolicies: writePolicies(null),
  alerts: [],
  journal: [],
};

export function buildOperationsSnapshot(input: OperationsInput, journal: OperationsJournalEntry[] = []): OperationsSnapshot {
  const rows = seriesRows(input.markets, input.runtime.data, input.feed, input.now);
  const network = networkOfInput(input);
  return {
    capturedAt: new Date(input.now * 1000).toISOString(),
    captureLabel: `Read ${new Date(input.now * 1000).toISOString().slice(11, 19)} UTC${network ? ` / ${NETWORK_OPERATOR_LABEL[network]}` : ""}`,
    dependencies: dependencies(input),
    indexerStreams: [],
    writePolicies: writePolicies(network),
    alerts: deriveAlerts(input, rows),
    journal,
  };
}
