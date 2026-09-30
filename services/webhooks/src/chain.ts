import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDecodedLog } from "@setryn/indexer";
import { contractBindings, type InternalContractBinding } from "@setryn/internal-contracts";
import type { LogIdentity } from "@setryn/internal-schemas";
import { createPublicClient, decodeEventLog, http, type Abi, type Address, type Hex, type Log, type PublicClient } from "viem";

import { WEBHOOK_SOURCE_COVERAGE, type DecodedChainLog } from "./events.ts";

/** Contracts the worker watches, keyed by the runtime.json field that holds the address. */
const RUNTIME_CONTRACTS: readonly (readonly [runtimeField: string, contractName: string, required: boolean])[] = [
  ["orderState", "OrderState", true],
  ["atomicClearingEngine", "AtomicClearingEngine", true],
  ["positionEngine", "PositionEngine", true],
  ["marketRegistry", "MarketRegistry", true],
  ["seriesRegistry", "SeriesRegistry", true],
  // Not deployed by the local reset today; watched automatically once the runtime or manifest names them.
  ["cashSettlementCoordinator", "CashSettlementCoordinator", false],
  ["verifiableReceiptLedger", "VerifiableReceiptLedger", false],
];

const IGNORED_EVENTS = /^(RoleAdminChanged|RoleGranted|RoleRevoked|DefaultAdmin.*|Paused|Unpaused)$/;

/** Every non-role event on a watched contract must be mapped or explicitly excluded in WEBHOOK_SOURCE_COVERAGE. */
export function missingWebhookSourceCoverage(
  bindings: Readonly<Record<string, InternalContractBinding>> = contractBindings,
): string[] {
  const missing: string[] = [];
  for (const [contractName, table] of Object.entries(WEBHOOK_SOURCE_COVERAGE)) {
    const binding = bindings[contractName];
    if (!binding) {
      missing.push(`${contractName} (no binding)`);
      continue;
    }
    for (const item of binding.abi) {
      if (item.type !== "event" || !item.name || IGNORED_EVENTS.test(item.name)) continue;
      if (!(item.name in table)) missing.push(`${contractName}.${item.name}`);
    }
  }
  return missing.sort();
}

export interface WatchedContract {
  readonly name: string;
  readonly address: Address;
  readonly abi: Abi;
}

export interface ChainConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly environment: string;
  readonly contracts: readonly WatchedContract[];
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function assertLoopback(rpcUrl: string): void {
  const parsed = new URL(rpcUrl);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error(`the webhooks worker reads only the local devnet; refusing ${parsed.origin}`);
  }
}

/** Loads watched addresses from deployments/local/runtime.json (plus manifest.json for optional contracts). */
export async function loadLocalChainConfig(): Promise<ChainConfig> {
  const runtimePath = process.env.SETRYN_RUNTIME_PATH
    ? resolve(process.env.SETRYN_RUNTIME_PATH)
    : join(repoRoot(), "deployments", "local", "runtime.json");
  const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as Record<string, unknown>;
  const manifest = await readFile(join(dirname(runtimePath), "manifest.json"), "utf8")
    .then((text) => JSON.parse(text) as { contracts?: { name: string; address: string | null }[] })
    .catch(() => ({ contracts: [] as { name: string; address: string | null }[] }));
  const chainId = Number(runtime.chainId);
  if (chainId !== 31337) throw new Error(`runtime chain ${chainId} is not the local devnet (31337)`);
  const rpcUrl = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
  assertLoopback(rpcUrl);

  const contracts: WatchedContract[] = [];
  for (const [field, name, required] of RUNTIME_CONTRACTS) {
    const address =
      (typeof runtime[field] === "string" ? (runtime[field] as string) : null) ??
      manifest.contracts?.find((contract) => contract.name === name)?.address ??
      null;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      if (required) throw new Error(`runtime is missing ${field}`);
      continue;
    }
    const binding = (contractBindings as Readonly<Record<string, InternalContractBinding>>)[name];
    if (!binding) throw new Error(`no generated binding for ${name}`);
    contracts.push({ name, address: address.toLowerCase() as Address, abi: binding.abi as unknown as Abi });
  }
  return { rpcUrl, chainId, environment: "local-devnet", contracts };
}

export interface BlockHeader {
  readonly number: bigint;
  readonly hash: Hex;
  readonly parentHash: Hex;
  readonly timestamp: bigint;
}

export class ChainReader {
  readonly config: ChainConfig;
  readonly client: PublicClient;
  private readonly byAddress: Map<string, WatchedContract>;
  private readonly blocks = new Map<bigint, BlockHeader>();

  constructor(config: ChainConfig) {
    this.config = config;
    this.client = createPublicClient({ transport: http(config.rpcUrl) });
    this.byAddress = new Map(config.contracts.map((contract) => [contract.address, contract]));
  }

  async verifyChain(): Promise<void> {
    const chainId = await this.client.getChainId();
    if (chainId !== this.config.chainId) throw new Error(`RPC reports chain ${chainId}, expected ${this.config.chainId}`);
  }

  async head(): Promise<bigint> {
    return this.client.getBlockNumber({ cacheTime: 0 });
  }

  /** Block header by number; `fresh` bypasses the cache for reorg checks. */
  async block(number: bigint, fresh = false): Promise<BlockHeader | null> {
    if (!fresh) {
      const cached = this.blocks.get(number);
      if (cached) return cached;
    }
    const block = await this.client.getBlock({ blockNumber: number }).catch(() => null);
    if (!block || !block.hash) return null;
    const header = { number, hash: block.hash, parentHash: block.parentHash, timestamp: block.timestamp };
    if (this.blocks.size > 512) this.blocks.clear();
    this.blocks.set(number, header);
    return header;
  }

  /** Logs of every watched contract in [fromBlock, toBlock], decoded and normalized, in chain order. */
  async decodedLogs(fromBlock: bigint, toBlock: bigint): Promise<DecodedChainLog[]> {
    const logs = await this.client.getLogs({
      address: this.config.contracts.map((contract) => contract.address),
      fromBlock,
      toBlock,
    });
    logs.sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? Number(left.logIndex ?? 0) - Number(right.logIndex ?? 0)
        : left.blockNumber! < right.blockNumber! ? -1 : 1,
    );
    const decoded: DecodedChainLog[] = [];
    for (const log of logs) {
      const entry = await this.decode(log);
      if (entry) decoded.push(entry);
    }
    return decoded;
  }

  private async decode(log: Log): Promise<DecodedChainLog | null> {
    const contract = this.byAddress.get(log.address.toLowerCase());
    if (!contract || log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null;
    let eventName: string;
    let args: Record<string, unknown>;
    try {
      const result = decodeEventLog({ abi: contract.abi, data: log.data, topics: log.topics, strict: true });
      eventName = String(result.eventName);
      args = (result.args ?? {}) as Record<string, unknown>;
    } catch {
      return null;
    }
    const coverage = WEBHOOK_SOURCE_COVERAGE[contract.name]?.[eventName];
    // Role and admin events, and events explicitly marked internal, never reach the webhook mapper.
    if (!coverage || (coverage.startsWith("internal:") && eventName !== "FillPositionCreated")) return null;
    const block = await this.block(log.blockNumber);
    if (!block) throw new Error(`block ${log.blockNumber} disappeared while decoding`);
    if (log.blockHash && block.hash.toLowerCase() !== log.blockHash.toLowerCase()) {
      throw new Error(`block ${log.blockNumber} hash changed while decoding (reorg in progress)`);
    }
    const identity: LogIdentity = {
      block: {
        chainId: this.config.chainId,
        number: block.number,
        hash: block.hash.toLowerCase() as Hex,
        parentHash: block.parentHash.toLowerCase() as Hex,
        timestamp: block.timestamp,
      },
      transactionHash: log.transactionHash.toLowerCase() as Hex,
      transactionIndex: Number(log.transactionIndex ?? 0),
      logIndex: Number(log.logIndex),
      contractAddress: log.address.toLowerCase() as Hex,
    };
    const canonical = normalizeDecodedLog({ contractName: contract.name, eventName, args: lowercaseHex(args), log: identity });
    if (!canonical) throw new Error(`indexer has no canonical form for ${contract.name}.${eventName}`);
    return { contractName: contract.name, eventName, log: identity, canonical };
  }
}

/** viem checksums addresses; canonical payloads carry lowercase hex like the indexer's schema identities. */
function lowercaseHex(value: Record<string, unknown>): Record<string, unknown> {
  const convert = (item: unknown): unknown => {
    if (typeof item === "string" && /^0x[0-9a-fA-F]*$/.test(item)) return item.toLowerCase();
    if (Array.isArray(item)) return item.map(convert);
    if (item && typeof item === "object") return lowercaseHex(item as Record<string, unknown>);
    return item;
  };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)]));
}
