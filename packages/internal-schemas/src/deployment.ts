import { isJsonObject } from "./json.ts";
import { parseAddress, parseBytes32, type Address, type Bytes32 } from "./ids.ts";
import { parseChainId, parseNonNegativeInteger } from "./network.ts";

export type DeploymentStatus = "planned" | "simulated" | "broadcast" | "disabled";

export interface ContractDeploymentIdentity {
  readonly name: string;
  readonly artifact: string;
  readonly address: Address | null;
  readonly runtimeCodeHash: Bytes32 | null;
  readonly deploymentTransactionHash: Bytes32 | null;
  readonly deploymentBlockNumber: number | null;
}

export interface DeploymentManifestIdentity {
  readonly schemaVersion: string;
  readonly environment: string;
  readonly chainId: number;
  readonly status: DeploymentStatus;
  readonly blockNumber: number | null;
  readonly blockHash: Bytes32 | null;
  readonly contracts: readonly ContractDeploymentIdentity[];
  readonly phase2Contracts: readonly string[];
  readonly mainnetBroadcastAllowed: false;
}

const statuses = new Set<DeploymentStatus>(["planned", "simulated", "broadcast", "disabled"]);

export function parseDeploymentManifestIdentity(value: unknown): DeploymentManifestIdentity {
  if (!isJsonObject(value)) {
    throw new TypeError("deployment manifest must be an object");
  }
  const status = value.status;
  if (typeof status !== "string" || !statuses.has(status as DeploymentStatus)) {
    throw new TypeError("deployment status is unsupported");
  }
  if (!Array.isArray(value.contracts) || value.contracts.length === 0) {
    throw new TypeError("deployment manifest must contain contracts");
  }
  const block = requireObject(value.blockReference, "blockReference");
  const phase2 = requireObject(value.phase2, "phase2");
  if (!Array.isArray(phase2.contracts) || phase2.contracts.length === 0) {
    throw new TypeError("Phase 2 manifest contract inventory must be non-empty");
  }
  const phase2Contracts = phase2.contracts.map((name, index) =>
    requireNonEmptyString(name, `phase2.contracts[${index}]`),
  );
  if (new Set(phase2Contracts).size !== phase2Contracts.length) {
    throw new TypeError("Phase 2 manifest contract names must be unique");
  }
  if (phase2.mainnetBroadcastAllowed !== false) {
    throw new TypeError("Phase 2 mainnet broadcast must remain disabled");
  }
  return {
    schemaVersion: requireNonEmptyString(value.schemaVersion, "schemaVersion"),
    environment: requireNonEmptyString(value.environment, "environment"),
    chainId: parseChainId(value.chainId),
    status: status as DeploymentStatus,
    blockNumber: block.number === null ? null : parseNonNegativeInteger(block.number, "blockReference.number"),
    blockHash: block.hash === null ? null : parseBytes32(block.hash, "blockReference.hash"),
    contracts: [
      ...value.contracts.map(parseContractIdentity),
      ...parsePhase2Deployments(phase2.deployments),
    ],
    phase2Contracts,
    mainnetBroadcastAllowed: false,
  };
}

function parsePhase2Deployments(value: unknown): ContractDeploymentIdentity[] {
  if (!Array.isArray(value)) throw new TypeError("phase2.deployments must be an array");
  return value.map((item, index) => {
    const deployment = requireObject(item, `phase2.deployments[${index}]`);
    return {
      name: requireNonEmptyString(deployment.name, `phase2.deployments[${index}].name`),
      artifact: requireNonEmptyString(deployment.artifact, `phase2.deployments[${index}].artifact`),
      address: parseAddress(deployment.address, `phase2.deployments[${index}].address`),
      runtimeCodeHash: parseBytes32(
        deployment.runtimeCodeHash,
        `phase2.deployments[${index}].runtimeCodeHash`,
      ),
      deploymentTransactionHash: parseBytes32(
        deployment.transactionHash,
        `phase2.deployments[${index}].transactionHash`,
      ),
      deploymentBlockNumber: parseNonNegativeInteger(
        deployment.blockNumber,
        `phase2.deployments[${index}].blockNumber`,
      ),
    };
  });
}

function parseContractIdentity(value: unknown, index: number): ContractDeploymentIdentity {
  const contract = requireObject(value, `contracts[${index}]`);
  const bytecode = requireObject(contract.bytecode, `contracts[${index}].bytecode`);
  const transaction = requireObject(contract.deploymentTransaction, `contracts[${index}].deploymentTransaction`);
  return {
    name: requireNonEmptyString(contract.name, `contracts[${index}].name`),
    artifact: requireNonEmptyString(contract.artifact, `contracts[${index}].artifact`),
    address: contract.address === null ? null : parseAddress(contract.address, `contracts[${index}].address`),
    runtimeCodeHash:
      bytecode.runtimeCodeHash === null
        ? null
        : parseBytes32(bytecode.runtimeCodeHash, `contracts[${index}].bytecode.runtimeCodeHash`),
    deploymentTransactionHash:
      transaction.hash === null
        ? null
        : parseBytes32(transaction.hash, `contracts[${index}].deploymentTransaction.hash`),
    deploymentBlockNumber:
      transaction.blockNumber === null
        ? null
        : parseNonNegativeInteger(transaction.blockNumber, `contracts[${index}].deploymentTransaction.blockNumber`),
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}
