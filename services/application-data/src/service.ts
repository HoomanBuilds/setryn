import type { Bytes32 } from "@setryn/internal-schemas";

import type { ApplicationDataAdapter } from "./ports.ts";
import {
  applicationViewVersion,
  type ApplicationViewQuery,
  type Freshness,
  type InternalApplicationView,
  type Provenance,
} from "./types.ts";

export class InternalApplicationDataService {
  readonly #adapters: ReadonlyMap<string, ApplicationDataAdapter>;
  readonly #now: () => Date;

  constructor(adapters: readonly ApplicationDataAdapter[], now: () => Date = () => new Date()) {
    if (new Set(adapters.map(({ environment }) => environment)).size !== adapters.length) {
      throw new TypeError("application data environments must be unique");
    }
    this.#adapters = new Map(adapters.map((adapter) => [adapter.environment, adapter]));
    this.#now = now;
  }

  async loadView(query: ApplicationViewQuery): Promise<InternalApplicationView> {
    const adapter = this.#adapters.get(query.environment);
    if (!adapter) throw new Error(`No internal application adapter for ${query.environment}`);
    assertQuery(query);
    const maximumAgeSeconds = query.maximumAgeSeconds ?? 30;
    const slice = await adapter.load(query);
    if (slice.status.environment !== query.environment) throw new Error("environment response drifted");
    assertEnvironmentChain(slice.status);
    const provenance = [...slice.provenance, ...slice.indexed.provenance];
    assertCoherentChain(slice.status.chainId, provenance);
    assertSourceBlocks(slice.status, provenance, slice.indexed.indexerBlockNumber);
    return {
      schemaVersion: applicationViewVersion,
      generatedAt: this.#now().toISOString(),
      status: {
        ...slice.status,
        indexerBlockNumber: slice.indexed.indexerBlockNumber,
        indexerSynced:
          slice.indexed.indexerBlockNumber !== null &&
          slice.indexed.indexerBlockNumber <= slice.status.headBlockNumber &&
          slice.status.headBlockNumber - slice.indexed.indexerBlockNumber <= 2n,
      },
      contracts: slice.contracts,
      markets: uniqueById(slice.markets, ({ marketId }) => marketId),
      account: normalizeAccount(slice.indexed.account),
      freshness: freshness(provenance, maximumAgeSeconds, this.#now()),
    };
  }
}

function freshness(provenance: readonly Provenance[], maximumAgeSeconds: number, now: Date): Freshness {
  const observations = provenance.map(({ observedAt, source }) => {
    const observed = Date.parse(observedAt);
    if (!Number.isFinite(observed)) throw new Error(`source ${source} has an invalid observation timestamp`);
    return observed;
  });
  const oldest = observations.length === 0 ? null : Math.min(...observations);
  const state = oldest === null ? "unavailable" : now.getTime() - oldest > maximumAgeSeconds * 1000 ? "stale" : "fresh";
  return {
    state,
    evaluatedAt: now.toISOString(),
    oldestObservationAt: oldest === null ? null : new Date(oldest).toISOString(),
    maximumAgeSeconds,
    provenance: [...provenance].sort((left, right) => provenanceKey(left).localeCompare(provenanceKey(right))),
  };
}

function assertCoherentChain(chainId: number, provenance: readonly Provenance[]): void {
  const mismatch = provenance.find((entry) => entry.chainId !== chainId);
  if (mismatch) throw new Error(`source ${mismatch.source} belongs to chain ${mismatch.chainId}, expected ${chainId}`);
}

function assertQuery(query: ApplicationViewQuery): void {
  const maximumAgeSeconds = query.maximumAgeSeconds ?? 30;
  if (!Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 1) {
    throw new TypeError("maximumAgeSeconds must be a positive safe integer");
  }
  if (query.marketIds && new Set(query.marketIds).size !== query.marketIds.length) {
    throw new TypeError("marketIds must not contain duplicates");
  }
}

function assertEnvironmentChain(status: InternalApplicationView["status"]): void {
  const valid =
    (status.environment === "local" && (status.chainId === 31337 || status.chainId === 1337)) ||
    (status.environment === "arbitrum-sepolia" && status.chainId === 421614) ||
    (status.environment === "arbitrum-one" && status.chainId === 42161);
  if (!valid) throw new Error(`environment ${status.environment} cannot use chain ${status.chainId}`);
  if (status.environment === "arbitrum-one" && status.writeMode !== "disabled") {
    throw new Error("Arbitrum One writes must remain disabled");
  }
  if (status.writeMode === "enabled" && status.writeDisabledReason !== null) {
    throw new Error("enabled environments cannot report a write-disabled reason");
  }
  if (status.writeMode === "disabled" && !status.writeDisabledReason) {
    throw new Error("disabled environments must explain why writes are unavailable");
  }
}

function assertSourceBlocks(
  status: InternalApplicationView["status"],
  provenance: readonly Provenance[],
  indexerBlockNumber: bigint | null,
): void {
  if (indexerBlockNumber !== null && indexerBlockNumber > status.headBlockNumber) {
    throw new Error("indexer block cannot be ahead of the chain head");
  }
  const future = provenance.find((entry) => entry.blockNumber !== null && entry.blockNumber > status.headBlockNumber);
  if (future) throw new Error(`source ${future.source} is ahead of the chain head`);
}

function normalizeAccount<T extends InternalApplicationView["account"]>(account: T): T {
  if (!account) return account;
  return {
    ...account,
    collateral: uniqueById(account.collateral, ({ collateralId }) => collateralId),
    positions: uniqueById(account.positions, ({ id }) => id),
    orders: uniqueById(account.orders, ({ id }) => id),
    lifecycle: uniqueById(account.lifecycle, ({ id }) => id),
    receipts: uniqueById(account.receipts, ({ receiptId }) => receiptId),
  } as T;
}

function uniqueById<T>(items: readonly T[], id: (item: T) => Bytes32): readonly T[] {
  const values = new Map<Bytes32, T>();
  for (const item of items) {
    const key = id(item);
    if (values.has(key)) throw new Error(`duplicate application view entity ${key}`);
    values.set(key, item);
  }
  return [...values.values()].sort((left, right) => id(left).localeCompare(id(right)));
}

function provenanceKey(value: Provenance): string {
  return `${value.kind}:${value.source}:${value.blockNumber ?? -1n}`;
}
