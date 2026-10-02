import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SetrynNetwork, SetrynRuntime } from "./runtime";
import { NETWORK_PROFILES, isSetrynNetwork, parseNetwork } from "./network";

/*
 * Server-side reader of a deployment's runtime file (docs/plans/network-runtime-real-data.md, sections 3 and 5). The
 * network comes from SETRYN_NETWORK (local by default); the file is deployments/<network>/runtime.json unless
 * SETRYN_RUNTIME_PATH names another one. Schemas 9, 10 and 11 are accepted; every schema 11 field is validated when
 * present.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
/** A non-negative decimal string without exponent or sign, for example "42000" or "0.00001". */
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

const ADDRESS_FIELDS = [
  "operator",
  "settlementToken",
  "marketAdapter",
  "collateralVault",
  "fundedFeeEngine",
  "portfolioRiskEngine",
  "riskAdmissionBindingRegistry",
  "executionPolicyRegistry",
  "tradingSessionPolicy",
  "orderState",
  "atomicClearingEngine",
  "privateRfqValidationGate",
  "privateRfqBook",
  "publicOrderBook",
  "positionEngine",
  "lifecyclePolicyValidator",
  "signedLifecycleEngine",
] as const;

const HASH_FIELDS = [
  "settlementAssetId",
  "riskDomainId",
  "marketId",
  "seriesId",
  "instrumentId",
  "benchmarkId",
  "feeScheduleId",
  "feeRecipientAccountId",
  "executionModeSetHash",
  "executionModeId",
  "privateRfqExecutionModeId",
  "privateRfqPrivacyModeId",
  "privateRfqDisclosurePolicyHash",
  "privateRfqEligibleMakerSetHash",
  "enterActionId",
] as const;

const POSITIVE_INTEGER_FIELDS = [
  "maxShortDebitMinorPerLot",
  "tickSizeMinor",
  "maxOrderLots",
] as const;

/** Fallback fee rates: a zero rate is a valid schedule (for example a zero-fee maker tier). */
const FEE_RATE_FIELDS = ["makerFeeRatePpm", "takerFeeRatePpm"] as const;
/** Optional fields a newer runtime carries; each is validated when present. */
const OPTIONAL_ADDRESS_FIELDS = [
  "feeScheduleRegistry",
  "treasuryController",
  "seriesRegistry",
  "marketRegistry",
  "fixingAdapter",
  "riskAdapter",
  "quoteSettlementRouter",
  "streamCapacityManager",
] as const;
/** Schema 11 top-level unix-second and count fields. */
const OPTIONAL_TOP_INTEGER_FIELDS = ["listedAt", "referenceChainId", "deploymentBlock"] as const;

const MARKET_HASH_FIELDS = ["marketId", "instrumentId", "seriesId", "benchmarkId"] as const;
const MARKET_INTEGER_FIELDS = [
  "tickSizeMinor",
  "priceScale",
  "maxShortDebitMinorPerLot",
  "maxOrderLots",
] as const;
/**
 * A range forward's long side owes nothing at settlement (it pays its consideration at the fill), so its terminal debit
 * bound is zero; it must still be a non-negative safe integer.
 */
const NON_NEGATIVE_DEBIT_FIELD = "maxLongDebitMinorPerLot";
/** Schema 11 market schedule fields, unix seconds. */
const MARKET_TIME_FIELDS = [
  "tradingStartsAt",
  "lastTradingAt",
  "expiryAt",
  "fixingWindowOpen",
  "fixingWindowClose",
  "exerciseOpensAt",
  "exerciseCutoffAt",
  "finalResolutionAt",
  "settlementDeadline",
] as const;
const MARKET_DECIMAL_FIELDS = ["floor", "cap", "lotSize", "tickPrice", "priceOffset"] as const;
const MARKET_TEXT_FIELDS = ["underlying", "feedKey", "displayName"] as const;
const STRATEGY_KINDS = new Set(["DATED_YIELD_CARRY", "FUNDING_CARRY", "DATED_BASIS", "DELIVERABLE_FORWARD"]);
const FIXING_ADAPTER_KINDS = new Set(["signed-observation", "chainlink-historical"]);
/** Catalog keys: family code, strategy code, expiry, for example "BTC-YC-24DEC26" or "EURUSD-FW-24DEC26". */
const MARKET_KEY_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+-[0-9]{2}[A-Z]{3}[0-9]{2}$/;
const PAYOFF_TERMS_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** The deployment network this server runs against: SETRYN_NETWORK, else the public setting, else the local chain. */
export function configuredNetwork(): SetrynNetwork {
  return parseNetwork(process.env.SETRYN_NETWORK?.trim() || process.env.NEXT_PUBLIC_SETRYN_NETWORK);
}

/** Read at request time from the deployment; excluded from output tracing so the server bundle stays scoped. */
function runtimePath(network: SetrynNetwork): string {
  if (process.env.SETRYN_RUNTIME_PATH) return resolve(/*turbopackIgnore: true*/ process.env.SETRYN_RUNTIME_PATH);
  const relative = `deployments/${network}/runtime.json`;
  const suffix = process.cwd().endsWith("/apps/web") ? `../../${relative}` : relative;
  return resolve(/*turbopackIgnore: true*/ process.cwd(), suffix);
}

/**
 * The RPC the server reads and sends through. SETRYN_RPC_URL overrides the default; the local chain only accepts a
 * loopback http endpoint (LOCAL_RPC_URL is still honoured there), and a network only an https one. It may carry a
 * provider key, so it is never handed to the browser.
 */
export function serverRpcUrl(network: SetrynNetwork): string {
  const configured = process.env.SETRYN_RPC_URL?.trim() || (network === "local" ? process.env.LOCAL_RPC_URL?.trim() : undefined);
  const rpcUrl = configured || NETWORK_PROFILES[network].defaultRpcUrl;
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error("INVALID_RPC_URL");
  }
  if (network === "local") {
    if (parsed.protocol !== "http:" || !LOOPBACK.has(parsed.hostname)) throw new Error("INVALID_LOCAL_RPC_URL");
  } else if (parsed.protocol !== "https:") {
    throw new Error("INVALID_NETWORK_RPC_URL");
  }
  return rpcUrl;
}

/**
 * The RPC the browser reads through and wallets add: NEXT_PUBLIC_SETRYN_RPC_URL when set, else the network's public
 * endpoint. Locally the browser keeps using the same loopback node as the server.
 */
export function browserRpcUrl(network: SetrynNetwork, serverRpc: string): string {
  const configured = process.env.NEXT_PUBLIC_SETRYN_RPC_URL?.trim();
  if (configured) return configured;
  return network === "local" ? serverRpc : NETWORK_PROFILES[network].defaultRpcUrl;
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/** Drops an absent optional field, validates a present one. */
function optional(record: Record<string, unknown>, field: string, valid: (value: unknown) => boolean): void {
  if (record[field] === undefined || record[field] === null) {
    delete record[field];
    return;
  }
  if (!valid(record[field])) throw new Error("INVALID_RUNTIME");
}

function validateListingFields(market: Record<string, unknown>): void {
  for (const field of MARKET_TEXT_FIELDS) optional(market, field, (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 120);
  optional(market, "strategyKind", (value) => typeof value === "string" && STRATEGY_KINDS.has(value));
  for (const field of MARKET_DECIMAL_FIELDS) optional(market, field, (value) => typeof value === "string" && DECIMAL_PATTERN.test(value));
  optional(market, "priceDecimals", (value) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 18);
  optional(market, "referenceFeed", isAddress);
  for (const field of MARKET_TIME_FIELDS) optional(market, field, (value) => Number.isSafeInteger(value) && Number(value) >= 0);
  // A range forward's payoff runs from its floor to its cap, and its price grid starts at the floor.
  if (market.floor !== undefined && market.cap !== undefined && !(Number(market.cap) > Number(market.floor))) throw new Error("INVALID_RUNTIME");
  if (market.priceOffset !== undefined && market.floor !== undefined && Number(market.priceOffset) !== Number(market.floor)) {
    throw new Error("INVALID_RUNTIME");
  }
  if (market.tickPrice !== undefined && !(Number(market.tickPrice) > 0)) throw new Error("INVALID_RUNTIME");
  if (market.lotSize !== undefined && !(Number(market.lotSize) > 0)) throw new Error("INVALID_RUNTIME");
  // The schedule runs forward wherever both ends of a step are listed.
  const ordered: [(typeof MARKET_TIME_FIELDS)[number], (typeof MARKET_TIME_FIELDS)[number]][] = [
    ["tradingStartsAt", "lastTradingAt"],
    ["lastTradingAt", "expiryAt"],
    ["fixingWindowOpen", "fixingWindowClose"],
    ["finalResolutionAt", "settlementDeadline"],
  ];
  for (const [earlier, later] of ordered) {
    if (market[earlier] !== undefined && market[later] !== undefined && !(Number(market[earlier]) <= Number(market[later]))) {
      throw new Error("INVALID_RUNTIME");
    }
  }
}

function validateMarkets(record: Record<string, unknown>): void {
  const markets = record.markets;
  if (!Array.isArray(markets) || markets.length === 0) throw new Error("INVALID_RUNTIME");
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const candidate of markets as unknown[]) {
    if (!candidate || typeof candidate !== "object") throw new Error("INVALID_RUNTIME");
    const market = candidate as Record<string, unknown>;
    if (typeof market.marketKey !== "string" || !MARKET_KEY_PATTERN.test(market.marketKey)) throw new Error("INVALID_RUNTIME");
    for (const field of MARKET_HASH_FIELDS) {
      if (typeof market[field] !== "string" || !HASH_PATTERN.test(market[field])) throw new Error("INVALID_RUNTIME");
    }
    if (typeof market.payoffTerms !== "string" || !PAYOFF_TERMS_PATTERN.test(market.payoffTerms)) {
      throw new Error("INVALID_RUNTIME");
    }
    for (const field of MARKET_INTEGER_FIELDS) {
      if (!isPositiveInteger(market[field])) throw new Error("INVALID_RUNTIME");
    }
    if (!Number.isSafeInteger(market[NON_NEGATIVE_DEBIT_FIELD]) || Number(market[NON_NEGATIVE_DEBIT_FIELD]) < 0) throw new Error("INVALID_RUNTIME");
    for (const field of ["marketVersion", "seriesVersion"] as const) optional(market, field, isPositiveInteger);
    // Package prices carry at most six decimals, so a price scale is a power of ten.
    if (!/^10{0,6}$/.test(String(market.priceScale))) throw new Error("INVALID_RUNTIME");
    validateListingFields(market);
    // A schema 11 tick price is the inverse of the price scale.
    if (market.tickPrice !== undefined && Math.abs(Number(market.tickPrice) * Number(market.priceScale) - 1) > 1e-9) {
      throw new Error("INVALID_RUNTIME");
    }
    const seriesKey = (market.seriesId as string).toLowerCase();
    const marketIdKey = (market.marketId as string).toLowerCase();
    if (keys.has(market.marketKey) || ids.has(seriesKey) || ids.has(marketIdKey)) throw new Error("INVALID_RUNTIME");
    keys.add(market.marketKey);
    ids.add(seriesKey);
    ids.add(marketIdKey);
  }
  // The single-series fields name the primary market, so both views of it must agree.
  const primary = markets[0] as Record<string, unknown>;
  for (const field of ["marketId", "seriesId", "payoffTerms", "tickSizeMinor", "maxOrderLots", "maxLongDebitMinorPerLot", "maxShortDebitMinorPerLot"]) {
    if (primary[field] !== record[field]) throw new Error("INVALID_RUNTIME");
  }
}

function validateRuntime(candidate: unknown, network: SetrynNetwork): Omit<SetrynRuntime, "rpcUrl"> {
  if (!candidate || typeof candidate !== "object") throw new Error("INVALID_RUNTIME");
  const record = candidate as Record<string, unknown>;
  // Schema 10 adds optional fee fields to schema 9; schema 11 adds the network listing fields to schema 10.
  if (![9, 10, 11].includes(record.schemaVersion as number) || typeof record.day !== "number") throw new Error("INVALID_RUNTIME");
  // The runtime must belong to the configured network: its chain, and its own network name when it carries one.
  if (record.chainId !== NETWORK_PROFILES[network].chainId) throw new Error("RUNTIME_NETWORK_MISMATCH");
  if (record.network !== undefined && record.network !== null && (!isSetrynNetwork(record.network) || record.network !== network)) {
    throw new Error("RUNTIME_NETWORK_MISMATCH");
  }
  for (const field of ADDRESS_FIELDS) {
    if (!isAddress(record[field])) throw new Error("INVALID_RUNTIME");
  }
  for (const field of HASH_FIELDS) {
    if (typeof record[field] !== "string" || !HASH_PATTERN.test(record[field])) throw new Error("INVALID_RUNTIME");
  }
  if (typeof record.payoffTerms !== "string" || !PAYOFF_TERMS_PATTERN.test(record.payoffTerms)) {
    throw new Error("INVALID_RUNTIME");
  }
  for (const field of POSITIVE_INTEGER_FIELDS) {
    if (!isPositiveInteger(record[field])) throw new Error("INVALID_RUNTIME");
  }
  if (!Number.isSafeInteger(record[NON_NEGATIVE_DEBIT_FIELD]) || Number(record[NON_NEGATIVE_DEBIT_FIELD]) < 0) throw new Error("INVALID_RUNTIME");
  for (const field of FEE_RATE_FIELDS) {
    if (!Number.isSafeInteger(record[field]) || Number(record[field]) < 0 || Number(record[field]) >= 1_000_000) {
      throw new Error("INVALID_RUNTIME");
    }
  }
  for (const field of OPTIONAL_ADDRESS_FIELDS) optional(record, field, isAddress);
  optional(record, "feeScheduleVersion", isPositiveInteger);
  for (const field of OPTIONAL_TOP_INTEGER_FIELDS) optional(record, field, (value) => Number.isSafeInteger(value) && Number(value) >= 0);
  optional(record, "fixingAdapterKind", (value) => typeof value === "string" && FIXING_ADAPTER_KINDS.has(value));
  // A Chainlink-historical adapter has no publishers, so an empty signer set with a zero threshold is valid.
  optional(record, "oracleSigners", (value) =>
    Array.isArray(value) && value.every(isAddress) && new Set(value.map((entry: string) => entry.toLowerCase())).size === value.length);
  optional(record, "oracleThreshold", (value) => Number.isSafeInteger(value) && Number(value) >= 0);
  optional(record, "settlementTokenMintable", (value) => typeof value === "boolean");
  if (record.oracleThreshold !== undefined && Number(record.oracleThreshold) > (Array.isArray(record.oracleSigners) ? record.oracleSigners.length : 0)) {
    throw new Error("INVALID_RUNTIME");
  }
  // A relative path inside the deployment directory, never an absolute or escaping one.
  optional(record, "sessionDaysPath", (value) => typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.split(/[\\/]/).includes(".."));
  validateMarkets(record);
  record.network = network;
  return record as unknown as Omit<SetrynRuntime, "rpcUrl">;
}

const TERMINAL_CONTRACTS = {
  FixingEngine: "fixingEngine",
  CashSettlementCoordinator: "cashSettlementCoordinator",
  PositionLifecycleExecutor: "positionLifecycleExecutor",
} as const;

type ManifestEntry = { name?: unknown; address?: unknown; blockNumber?: unknown; deploymentTransaction?: { blockNumber?: unknown } | null };

/**
 * The fixing, settlement and lifecycle-executor addresses live only in the deployment manifest next to the runtime, as
 * does the block the deployment started at. Each address is taken only when the manifest names exactly one deployment
 * of it; a missing, unreadable or other-chain manifest leaves them out.
 */
async function readManifestFields(
  path: string,
  chainId: number,
): Promise<Partial<Pick<SetrynRuntime, (typeof TERMINAL_CONTRACTS)[keyof typeof TERMINAL_CONTRACTS] | "deploymentBlock">>> {
  try {
    const manifest = JSON.parse(await readFile(resolve(/*turbopackIgnore: true*/ path, "..", "manifest.json"), "utf8")) as {
      chainId?: unknown;
      contracts?: unknown;
      linkedLibraries?: unknown;
      phase2?: { deployments?: unknown };
    };
    if (manifest.chainId !== chainId) return {};
    const entries = [
      ...(Array.isArray(manifest.contracts) ? manifest.contracts : []),
      ...(Array.isArray(manifest.linkedLibraries) ? manifest.linkedLibraries : []),
      ...(Array.isArray(manifest.phase2?.deployments) ? manifest.phase2.deployments : []),
    ] as ManifestEntry[];
    const found: Partial<Record<string, `0x${string}` | number>> = {};
    for (const [name, field] of Object.entries(TERMINAL_CONTRACTS)) {
      const matches = entries.filter((entry) => entry.name === name && isAddress(entry.address));
      if (matches.length === 1) found[field] = matches[0].address as `0x${string}`;
    }
    const blocks = entries
      .map((entry) => entry.deploymentTransaction?.blockNumber ?? entry.blockNumber)
      .filter((value): value is number => Number.isSafeInteger(value) && Number(value) >= 0);
    if (blocks.length > 0) found.deploymentBlock = Math.min(...blocks);
    return found;
  } catch {
    return {};
  }
}

/**
 * The deployment runtime of the configured network, with the terminal lifecycle contracts merged from its manifest and
 * `rpcUrl` set to the server RPC. Routes that hand the runtime to the browser replace `rpcUrl` with `browserRpcUrl`.
 */
export async function readRuntime(): Promise<SetrynRuntime> {
  const network = configuredNetwork();
  const path = runtimePath(network);
  const rpcUrl = serverRpcUrl(network);
  const candidate = JSON.parse(await readFile(path, "utf8")) as unknown;
  const runtime = validateRuntime(candidate, network);
  const manifest = await readManifestFields(path, runtime.chainId);
  // The runtime's own deployment block wins over the manifest's.
  return { ...runtime, ...manifest, deploymentBlock: runtime.deploymentBlock ?? manifest.deploymentBlock, rpcUrl };
}

/** Deployment evidence written next to the runtime (`generate-deployment-evidence.mjs`). */
export async function readDeploymentEvidence(): Promise<unknown> {
  const manifestPath = resolve(/*turbopackIgnore: true*/ runtimePath(configuredNetwork()), "..", "manifest.json");
  return JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
}
