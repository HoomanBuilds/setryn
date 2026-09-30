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
  "makerFeeRatePpm",
  "takerFeeRatePpm",
] as const;

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
  if (record.schemaVersion !== 9 || record.chainId !== 31337 || typeof record.day !== "number") {
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
  if (Number(record.takerFeeRatePpm) >= 1_000_000 || Number(record.makerFeeRatePpm) >= 1_000_000) {
    throw new Error("INVALID_RUNTIME");
  }
  validateMarkets(record);
  return record as unknown as Omit<SetrynRuntime, "rpcUrl">;
}

export async function readLocalRuntime(): Promise<SetrynRuntime> {
  const candidate = JSON.parse(await readFile(runtimePath(), "utf8")) as unknown;
  return { ...validateRuntime(candidate), rpcUrl: localRpcUrl() };
}

/** Deployment evidence written next to the runtime by the local reset (`generate-deployment-evidence.mjs`). */
export async function readLocalDeploymentEvidence(): Promise<unknown> {
  const manifestPath = resolve(/*turbopackIgnore: true*/ runtimePath(), "..", "manifest.json");
  return JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
}
