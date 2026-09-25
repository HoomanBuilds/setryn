import { parseAddress, parseBytes32, type Address, type Bytes32 } from "./ids.ts";

export interface NetworkIdentity {
  readonly chainId: number;
  readonly environment: string;
}

export interface BlockIdentity {
  readonly chainId: number;
  readonly number: bigint;
  readonly hash: Bytes32;
  readonly parentHash: Bytes32;
  readonly timestamp: bigint;
}

export interface LogIdentity {
  readonly block: BlockIdentity;
  readonly transactionHash: Bytes32;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly contractAddress: Address;
}

export function parseChainId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError("chainId must be a positive safe integer");
  }
  return value as number;
}

export function parseBlockIdentity(value: unknown): BlockIdentity {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("block must be an object");
  }
  const block = value as Record<string, unknown>;
  return {
    chainId: parseChainId(block.chainId),
    number: parseNonNegativeBigInt(block.number, "block.number"),
    hash: parseBytes32(block.hash, "block.hash"),
    parentHash: parseBytes32(block.parentHash, "block.parentHash"),
    timestamp: parseNonNegativeBigInt(block.timestamp, "block.timestamp"),
  };
}

export function parseLogIdentity(value: unknown): LogIdentity {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("log identity must be an object");
  }
  const log = value as Record<string, unknown>;
  return {
    block: parseBlockIdentity(log.block),
    transactionHash: parseBytes32(log.transactionHash, "transactionHash"),
    transactionIndex: parseNonNegativeInteger(log.transactionIndex, "transactionIndex"),
    logIndex: parseNonNegativeInteger(log.logIndex, "logIndex"),
    contractAddress: parseAddress(log.contractAddress, "contractAddress"),
  };
}

export function parseNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

export function parseNonNegativeBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  if (Number.isSafeInteger(value) && (value as number) >= 0) {
    return BigInt(value as number);
  }
  throw new TypeError(`${label} must be a non-negative integer`);
}

export function logId(log: LogIdentity): string {
  return `${log.block.chainId}:${log.transactionHash}:${log.logIndex}`;
}
