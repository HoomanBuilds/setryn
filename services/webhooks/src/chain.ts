import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDecodedLog } from "@setryn/indexer";
import { contractBindings, type InternalContractBinding } from "@setryn/internal-contracts";
import type { LogIdentity } from "@setryn/internal-schemas";
import { createPublicClient, decodeEventLog, http, type Abi, type Address, type Hex, type Log, type PublicClient } from "viem";

import {
  isMappedSourceEvent,
  referenceRequests,
  WEBHOOK_SOURCE_COVERAGE,
  type DecodedChainLog,
  type EventReferences,
  type MarketReference,
  type OrderReference,
} from "./events.ts";

/** Contracts the worker watches, keyed by the runtime.json field that holds the address. */
const RUNTIME_CONTRACTS: readonly (readonly [runtimeField: string, contractName: string, required: boolean])[] = [
  ["orderState", "OrderState", true],
  ["atomicClearingEngine", "AtomicClearingEngine", true],
  ["positionEngine", "PositionEngine", true],
  ["marketRegistry", "MarketRegistry", true],
  ["seriesRegistry", "SeriesRegistry", true],
  ["collateralVault", "CollateralVault", true],
  // Optional: resolved from the deployment manifest when the environment deploys them.
  ["fixingEngine", "FixingEngine", false],
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
  /** Every catalog market the deployment registered; maps series and market ids to catalog ids and price scales. */
  readonly markets: readonly MarketReference[];
}

const bytes32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * Reads the runtime's market table (schema 9 `markets`; a schema 8 runtime has no catalog ids, so no markets). Every
 * entry must carry the ids and the power-of-ten price scale payload prices are rendered with; anything else throws.
 */
export function runtimeMarkets(runtime: Record<string, unknown>): MarketReference[] {
  if (runtime.markets === undefined) return [];
  if (!Array.isArray(runtime.markets)) throw new Error("runtime.markets must be an array");
  const markets = runtime.markets.map((value, index) => {
    const entry = value as Record<string, unknown>;
    const label = `runtime.markets[${index}]`;
    for (const field of ["marketId", "seriesId", "benchmarkId"] as const) {
      if (typeof entry[field] !== "string" || !bytes32.test(entry[field] as string)) throw new Error(`${label}.${field} must be a 32-byte hex id`);
    }
    if (typeof entry.marketKey !== "string" || entry.marketKey.length === 0) throw new Error(`${label}.marketKey is missing`);
    const priceScale = entry.priceScale;
    if (typeof priceScale !== "number" || !Number.isSafeInteger(priceScale) || !/^10*$/.test(String(priceScale))) {
      throw new Error(`${label}.priceScale must be a positive power of ten`);
    }
    if (typeof entry.tickSizeMinor !== "number" || !Number.isSafeInteger(entry.tickSizeMinor) || entry.tickSizeMinor <= 0) {
      throw new Error(`${label}.tickSizeMinor must be a positive integer`);
    }
    return {
      marketKey: entry.marketKey,
      marketId: (entry.marketId as string).toLowerCase(),
      seriesId: (entry.seriesId as string).toLowerCase(),
      instrumentId: typeof entry.instrumentId === "string" && bytes32.test(entry.instrumentId) ? entry.instrumentId.toLowerCase() : null,
      benchmarkId: (entry.benchmarkId as string).toLowerCase(),
      priceScale,
      tickSizeMinor: String(entry.tickSizeMinor),
    } satisfies MarketReference;
  });
  for (const field of ["marketKey", "marketId", "seriesId"] as const) {
    if (new Set(markets.map((market) => market[field])).size !== markets.length) throw new Error(`runtime.markets repeats a ${field}`);
  }
  return markets;
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

interface ManifestShape {
  contracts?: { name: string; address: string | null }[];
  phase2?: { deployments?: { name: string; address: string | null }[] };
}

/** Loads watched addresses from deployments/local/runtime.json (plus manifest.json for optional contracts). */
export async function loadLocalChainConfig(): Promise<ChainConfig> {
  const runtimePath = process.env.SETRYN_RUNTIME_PATH
    ? resolve(process.env.SETRYN_RUNTIME_PATH)
    : join(repoRoot(), "deployments", "local", "runtime.json");
  const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as Record<string, unknown>;
  const manifest = await readFile(join(dirname(runtimePath), "manifest.json"), "utf8")
    .then((text) => JSON.parse(text) as ManifestShape)
    .catch((): ManifestShape => ({ contracts: [] }));
  // Protocol contracts beyond the core registries are recorded under the Phase 2 deployments.
  const deployed = [...(manifest.contracts ?? []), ...(manifest.phase2?.deployments ?? [])];
  const chainId = Number(runtime.chainId);
  if (chainId !== 31337) throw new Error(`runtime chain ${chainId} is not the local devnet (31337)`);
  const rpcUrl = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
  assertLoopback(rpcUrl);

  const contracts: WatchedContract[] = [];
  for (const [field, name, required] of RUNTIME_CONTRACTS) {
    const address =
      (typeof runtime[field] === "string" ? (runtime[field] as string) : null) ??
      deployed.find((contract) => contract.name === name)?.address ??
      null;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      if (required) throw new Error(`runtime is missing ${field}`);
      continue;
    }
    const binding = (contractBindings as Readonly<Record<string, InternalContractBinding>>)[name];
    if (!binding) throw new Error(`no generated binding for ${name}`);
    contracts.push({ name, address: address.toLowerCase() as Address, abi: binding.abi as unknown as Abi });
  }
  return { rpcUrl, chainId, environment: "local-devnet", contracts, markets: runtimeMarkets(runtime) };
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
  private readonly orders = new Map<string, OrderReference>();
  private readonly positions = new Map<string, string>();
  private readonly claims = new Map<string, string>();

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

  /**
   * Resolves the order, position and claim identities a batch refers to without carrying (the series of a cancelled
   * order, of a settling position, of a fulfilled claim) from chain state at `blockNumber`. These fields are immutable
   * once written, so results are cached; an identity that cannot be read throws rather than being guessed.
   */
  async resolveReferences(logs: readonly DecodedChainLog[], blockNumber: bigint): Promise<EventReferences> {
    const requests = referenceRequests(logs);
    const orderState = this.contract("OrderState");
    const positionEngine = this.contract("PositionEngine");
    const vault = this.config.contracts.find((contract) => contract.name === "CollateralVault") ?? null;
    for (const orderHash of requests.orderHashes) {
      if (this.orders.has(orderHash)) continue;
      const record = await this.client.readContract({
        address: orderState.address,
        abi: orderState.abi,
        functionName: "getOrder",
        args: [orderHash as Hex],
        blockNumber,
      }) as { readonly order: { readonly targetKind: number; readonly seriesId: Hex; readonly packageId: Hex; readonly side: number; readonly priceTicks: bigint; readonly lots: bigint } };
      this.orders.set(orderHash, {
        targetKind: enumAt(["unspecified", "series", "package"], record.order.targetKind, "order target kind"),
        seriesId: record.order.seriesId.toLowerCase(),
        packageId: record.order.packageId.toLowerCase(),
        side: enumAt(["unspecified", "buy", "sell"], record.order.side, "order side"),
        priceTicks: record.order.priceTicks.toString(),
        lots: record.order.lots.toString(),
      });
    }
    const positionIds = new Set(requests.positionIds);
    for (const claimId of requests.claimIds) {
      if (!this.claims.has(claimId)) {
        if (!vault) throw new Error("CollateralVault is not watched; claim positions cannot be resolved");
        const claim = await this.client.readContract({
          address: vault.address,
          abi: vault.abi,
          functionName: "terminalClaimOf",
          args: [claimId as Hex],
          blockNumber,
        }) as { readonly positionId: Hex };
        this.claims.set(claimId, claim.positionId.toLowerCase());
      }
      positionIds.add(this.claims.get(claimId)!);
    }
    for (const positionId of positionIds) {
      if (this.positions.has(positionId)) continue;
      const [economics] = await this.client.readContract({
        address: positionEngine.address,
        abi: positionEngine.abi,
        functionName: "getPosition",
        args: [positionId as Hex],
        blockNumber,
      }) as readonly [{ readonly seriesId: Hex }, unknown];
      this.positions.set(positionId, economics.seriesId.toLowerCase());
    }
    if (this.orders.size > 10_000) this.orders.clear();
    if (this.positions.size > 10_000) this.positions.clear();
    if (this.claims.size > 10_000) this.claims.clear();
    return { markets: this.config.markets, orders: new Map(this.orders), positions: new Map(this.positions), claims: new Map(this.claims) };
  }

  private contract(name: string): WatchedContract {
    const contract = this.config.contracts.find((candidate) => candidate.name === name);
    if (!contract) throw new Error(`${name} is not watched`);
    return contract;
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
    // Role and admin events, and events explicitly marked internal, never reach the webhook mapper.
    if (!isMappedSourceEvent(contract.name, eventName)) return null;
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

function enumAt(names: readonly string[], value: number, label: string): string {
  const name = names[value];
  if (!name) throw new TypeError(`unsupported ${label} ${value}`);
  return name;
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
