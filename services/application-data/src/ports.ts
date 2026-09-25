import type { AbiItem } from "@setryn/internal-contracts";
import type { AccountId, Address, JsonObject, MarketId } from "@setryn/internal-schemas";

import type {
  ApplicationDataSlice,
  ApplicationViewQuery,
  ContractSnapshot,
  EnvironmentStatus,
  IndexedApplicationSlice,
  InternalEnvironment,
  MarketSnapshot,
  Provenance,
} from "./types.ts";

export interface ApplicationDataAdapter {
  readonly environment: InternalEnvironment;
  load(query: ApplicationViewQuery): Promise<ApplicationDataSlice>;
}

export interface ChainStatusSource {
  loadStatus(): Promise<{ readonly status: EnvironmentStatus; readonly provenance: Provenance }>;
}

export interface ContractViewSource {
  loadContractSnapshot(query: ApplicationViewQuery): Promise<{
    readonly snapshot: ContractSnapshot;
    readonly provenance: readonly Provenance[];
  }>;
}

export interface IndexedViewSource {
  loadIndexedView(accountId?: AccountId): Promise<IndexedApplicationSlice>;
}

export interface MarketSnapshotSource {
  loadMarketSnapshots(marketIds?: readonly MarketId[]): Promise<{
    readonly markets: readonly MarketSnapshot[];
    readonly provenance: readonly Provenance[];
  }>;
}

export interface ContractReadTransport {
  read<T>(request: {
    readonly chainId: number;
    readonly blockNumber: bigint;
    readonly address: Address;
    readonly abi: readonly AbiItem[];
    readonly functionName: string;
    readonly args: readonly unknown[];
  }): Promise<T>;
}

export interface ContractReadDescriptor {
  readonly key: string;
  readonly contractName: string;
  readonly functionName: string;
  readonly args: readonly unknown[];
  map(value: unknown): JsonObject;
}

export interface InternalWriteRequest {
  readonly operation: string;
  readonly payload: JsonObject;
}

export interface InternalWriteTransport {
  submit(request: InternalWriteRequest): Promise<{ readonly transactionHash: string }>;
}
