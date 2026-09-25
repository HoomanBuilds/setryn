import type { Bytes32 } from "@setryn/internal-schemas";

import type { LocalApplicationFixture } from "../adapters/local-fixture.ts";

const zeroHash = `0x${"00".repeat(32)}` as Bytes32;

export function createEmptyLocalFixture(observedAt = new Date(0).toISOString()): LocalApplicationFixture {
  return {
    status: {
      headBlockNumber: 0n,
      headBlockHash: zeroHash,
      headBlockTimestamp: 0n,
      rpcReachable: true,
      indexerBlockNumber: 0n,
      indexerSynced: true,
    },
    contracts: { deploymentId: null, values: {} },
    markets: [],
    indexed: {
      account: null,
      indexerBlockNumber: 0n,
      provenance: [{
        kind: "local-fixture",
        source: "empty-local-indexer",
        chainId: 31337,
        blockNumber: 0n,
        blockHash: zeroHash,
        observedAt,
      }],
    },
    provenance: [{
      kind: "local-fixture",
      source: "empty-local-application-data",
      chainId: 31337,
      blockNumber: 0n,
      blockHash: zeroHash,
      observedAt,
    }],
  };
}
