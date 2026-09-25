import {
  parseCanonicalEvent,
  type Bytes32,
  type CanonicalEvent,
  type DeploymentManifestIdentity,
} from "@setryn/internal-schemas";

export function deploymentEventsFromManifest(
  manifest: DeploymentManifestIdentity,
  parentHash: Bytes32,
  timestamp: bigint,
): CanonicalEvent[] {
  if (manifest.status !== "broadcast" || manifest.blockNumber === null || manifest.blockHash === null) {
    return [];
  }
  return manifest.contracts.flatMap((contract, index) => {
    if (
      contract.address === null ||
      contract.runtimeCodeHash === null ||
      contract.deploymentTransactionHash === null ||
      contract.deploymentBlockNumber === null
    ) {
      return [];
    }
    return [
      parseCanonicalEvent({
        name: "deployment.identity.observed",
        contractName: contract.name,
        log: {
          block: {
            chainId: manifest.chainId,
            number: manifest.blockNumber,
            hash: manifest.blockHash,
            parentHash,
            timestamp,
          },
          transactionHash: contract.deploymentTransactionHash,
          transactionIndex: index,
          logIndex: 0,
          contractAddress: contract.address,
        },
        payload: {
          environment: manifest.environment,
          chainId: manifest.chainId,
          contractName: contract.name,
          artifact: contract.artifact,
          address: contract.address,
          runtimeCodeHash: contract.runtimeCodeHash,
          deploymentTransactionHash: contract.deploymentTransactionHash,
          deploymentBlockNumber: contract.deploymentBlockNumber,
        },
      }),
    ];
  });
}
