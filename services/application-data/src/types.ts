import type { AccountId, Address, Bytes32, JsonObject, MarketId } from "@setryn/internal-schemas";

export const applicationViewVersion = "setryn.application-data.v1" as const;

export type ApplicationViewVersion = typeof applicationViewVersion;
export type InternalEnvironment = "local" | "arbitrum-sepolia" | "arbitrum-one";
export type FreshnessState = "fresh" | "stale" | "unavailable";
export type ProvenanceKind = "contract-read" | "indexed-event" | "market-snapshot" | "local-fixture";

export interface Provenance {
  readonly kind: ProvenanceKind;
  readonly source: string;
  readonly chainId: number;
  readonly blockNumber: bigint | null;
  readonly blockHash: Bytes32 | null;
  readonly observedAt: string;
}

export interface Freshness {
  readonly state: FreshnessState;
  readonly evaluatedAt: string;
  readonly oldestObservationAt: string | null;
  readonly maximumAgeSeconds: number;
  readonly provenance: readonly Provenance[];
}

export interface EnvironmentStatus {
  readonly environment: InternalEnvironment;
  readonly chainId: number;
  readonly headBlockNumber: bigint;
  readonly headBlockHash: Bytes32;
  readonly headBlockTimestamp: bigint;
  readonly rpcReachable: boolean;
  readonly indexerBlockNumber: bigint | null;
  readonly indexerSynced: boolean;
  readonly writeMode: "enabled" | "disabled";
  readonly writeDisabledReason: string | null;
}

export interface ContractSnapshot {
  readonly deploymentId: Bytes32 | null;
  readonly values: Readonly<Record<string, JsonObject>>;
}

export interface MarketSnapshot {
  readonly marketId: MarketId;
  readonly version: number;
  readonly status: string;
  readonly bid: string | null;
  readonly ask: string | null;
  readonly mark: string | null;
  readonly quoteUnit: string;
  readonly observedAt: string;
  readonly sourceSequence: string;
}

export interface CollateralView {
  readonly collateralId: Bytes32;
  readonly total: string;
  readonly preTradeLocked: string;
  readonly terminalReserved: string;
  readonly terminalClaimBacking: string;
  readonly available: string;
  readonly updatedAtBlock: bigint;
}

export interface EconomicView {
  readonly id: Bytes32;
  readonly status: string | null;
  readonly originalQuantity: string | null;
  readonly remainingQuantity: string | null;
  readonly cumulativeAmount: string;
  readonly sequence: number;
  readonly updatedAtBlock: bigint;
  readonly details: JsonObject;
}

export interface ReceiptView {
  readonly receiptId: Bytes32;
  readonly status: string | null;
  readonly sequence: number;
  readonly updatedAtBlock: bigint;
  readonly details: JsonObject;
}

export interface AccountApplicationView {
  readonly accountId: AccountId;
  readonly controller: Address | null;
  readonly collateral: readonly CollateralView[];
  readonly positions: readonly EconomicView[];
  readonly orders: readonly EconomicView[];
  readonly lifecycle: readonly EconomicView[];
  readonly receipts: readonly ReceiptView[];
}

export interface InternalApplicationView {
  readonly schemaVersion: ApplicationViewVersion;
  readonly generatedAt: string;
  readonly status: EnvironmentStatus;
  readonly contracts: ContractSnapshot;
  readonly markets: readonly MarketSnapshot[];
  readonly account: AccountApplicationView | null;
  readonly freshness: Freshness;
}

export interface ApplicationViewQuery {
  readonly environment: InternalEnvironment;
  readonly accountId?: AccountId;
  readonly marketIds?: readonly MarketId[];
  readonly maximumAgeSeconds?: number;
}

export interface IndexedApplicationSlice {
  readonly account: AccountApplicationView | null;
  readonly indexerBlockNumber: bigint | null;
  readonly provenance: readonly Provenance[];
}

export interface ApplicationDataSlice {
  readonly status: EnvironmentStatus;
  readonly contracts: ContractSnapshot;
  readonly markets: readonly MarketSnapshot[];
  readonly indexed: IndexedApplicationSlice;
  readonly provenance: readonly Provenance[];
}
