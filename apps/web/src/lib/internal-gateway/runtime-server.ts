import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SetrynRuntime } from "./runtime";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

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
  "maxLongDebitMinorPerLot",
  "maxShortDebitMinorPerLot",
  "tickSizeMinor",
  "maxOrderLots",
] as const;

/** Fallback fee rates: a zero rate is a valid schedule (for example a zero-fee maker tier). */
const FEE_RATE_FIELDS = ["makerFeeRatePpm", "takerFeeRatePpm"] as const;
/** Optional fields a newer runtime carries; each is validated when present. */
const OPTIONAL_ADDRESS_FIELDS = ["feeScheduleRegistry", "treasuryController", "seriesRegistry", "marketRegistry"] as const;

/** Read at request time from the local deployment; excluded from output tracing so the server bundle stays scoped. */
function runtimePath(): string {
  if (process.env.SETRYN_RUNTIME_PATH) return resolve(/*turbopackIgnore: true*/ process.env.SETRYN_RUNTIME_PATH);
  const suffix = process.cwd().endsWith("/apps/web") ? "../../deployments/local/runtime.json" : "deployments/local/runtime.json";
  return resolve(/*turbopackIgnore: true*/ process.cwd(), suffix);
}

function localRpcUrl(): string {
  const rpcUrl = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
  const parsed = new URL(rpcUrl);
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (parsed.protocol !== "http:" || !loopback.has(parsed.hostname)) throw new Error("INVALID_LOCAL_RPC_URL");
  return rpcUrl;
}

const MARKET_HASH_FIELDS = ["marketId", "instrumentId", "seriesId", "benchmarkId"] as const;
const MARKET_INTEGER_FIELDS = [
  "tickSizeMinor",
  "priceScale",
  "maxLongDebitMinorPerLot",
  "maxShortDebitMinorPerLot",
  "maxOrderLots",
] as const;
const MARKET_KEY_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+-[0-9]{2}[A-Z]{3}[0-9]{2}$/;
const PAYOFF_TERMS_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

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
      if (!Number.isSafeInteger(market[field]) || Number(market[field]) <= 0) throw new Error("INVALID_RUNTIME");
    }
    for (const field of ["marketVersion", "seriesVersion"] as const) {
      if (market[field] === undefined || market[field] === null) delete market[field];
      else if (!Number.isSafeInteger(market[field]) || Number(market[field]) <= 0) throw new Error("INVALID_RUNTIME");
    }
    // Package prices carry at most six decimals, so a price scale is a power of ten.
    if (!/^10{0,6}$/.test(String(market.priceScale))) throw new Error("INVALID_RUNTIME");
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

function validateRuntime(candidate: unknown): Omit<SetrynRuntime, "rpcUrl"> {
  if (!candidate || typeof candidate !== "object") throw new Error("INVALID_RUNTIME");
  const record = candidate as Record<string, unknown>;
  // Schema 10 only adds optional fields (fee schedule version, treasury controller) to schema 9.
  if ((record.schemaVersion !== 9 && record.schemaVersion !== 10) || record.chainId !== 31337 || typeof record.day !== "number") {
    throw new Error("INVALID_RUNTIME");
  }
  for (const field of ADDRESS_FIELDS) {
    if (typeof record[field] !== "string" || !ADDRESS_PATTERN.test(record[field])) throw new Error("INVALID_RUNTIME");
  }
  for (const field of HASH_FIELDS) {
    if (typeof record[field] !== "string" || !HASH_PATTERN.test(record[field])) throw new Error("INVALID_RUNTIME");
  }
  if (typeof record.payoffTerms !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(record.payoffTerms)) {
    throw new Error("INVALID_RUNTIME");
  }
  for (const field of POSITIVE_INTEGER_FIELDS) {
    if (!Number.isSafeInteger(record[field]) || Number(record[field]) <= 0) throw new Error("INVALID_RUNTIME");
  }
  for (const field of FEE_RATE_FIELDS) {
    if (!Number.isSafeInteger(record[field]) || Number(record[field]) < 0 || Number(record[field]) >= 1_000_000) {
      throw new Error("INVALID_RUNTIME");
    }
  }
  for (const field of OPTIONAL_ADDRESS_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      delete record[field];
      continue;
    }
    if (typeof record[field] !== "string" || !ADDRESS_PATTERN.test(record[field])) throw new Error("INVALID_RUNTIME");
  }
  if (record.feeScheduleVersion === undefined || record.feeScheduleVersion === null) {
    delete record.feeScheduleVersion;
  } else if (!Number.isSafeInteger(record.feeScheduleVersion) || Number(record.feeScheduleVersion) <= 0) {
    throw new Error("INVALID_RUNTIME");
  }
  validateMarkets(record);
  return record as unknown as Omit<SetrynRuntime, "rpcUrl">;
}

const TERMINAL_CONTRACTS = {
  FixingEngine: "fixingEngine",
  CashSettlementCoordinator: "cashSettlementCoordinator",
  PositionLifecycleExecutor: "positionLifecycleExecutor",
} as const;

/**
 * The fixing, settlement and lifecycle-executor addresses live only in the deployment manifest. Each is taken only when
 * the manifest names exactly one deployment of it, and a missing or unreadable manifest leaves them out.
 */
async function readTerminalContracts(): Promise<Partial<Pick<SetrynRuntime, (typeof TERMINAL_CONTRACTS)[keyof typeof TERMINAL_CONTRACTS]>>> {
  try {
    const manifest = JSON.parse(await readFile(resolve(/*turbopackIgnore: true*/ runtimePath(), "..", "manifest.json"), "utf8")) as {
      chainId?: unknown;
      contracts?: unknown;
      phase2?: { deployments?: unknown };
    };
    if (manifest.chainId !== 31337) return {};
    const entries = [
      ...(Array.isArray(manifest.contracts) ? manifest.contracts : []),
      ...(Array.isArray(manifest.phase2?.deployments) ? manifest.phase2.deployments : []),
    ] as { name?: unknown; address?: unknown }[];
    const found: Partial<Record<string, `0x${string}`>> = {};
    for (const [name, field] of Object.entries(TERMINAL_CONTRACTS)) {
      const matches = entries.filter((entry) => entry.name === name && typeof entry.address === "string" && ADDRESS_PATTERN.test(entry.address));
      if (matches.length === 1) found[field] = matches[0].address as `0x${string}`;
    }
    return found;
  } catch {
    return {};
  }
}

export async function readLocalRuntime(): Promise<SetrynRuntime> {
  const candidate = JSON.parse(await readFile(runtimePath(), "utf8")) as unknown;
  return { ...validateRuntime(candidate), ...(await readTerminalContracts()), rpcUrl: localRpcUrl() };
}

/** Deployment evidence written next to the runtime by the local reset (`generate-deployment-evidence.mjs`). */
export async function readLocalDeploymentEvidence(): Promise<unknown> {
  const manifestPath = resolve(/*turbopackIgnore: true*/ runtimePath(), "..", "manifest.json");
  return JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
}
