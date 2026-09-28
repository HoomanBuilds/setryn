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

function runtimePath(): string {
  if (process.env.SETRYN_RUNTIME_PATH) return resolve(process.env.SETRYN_RUNTIME_PATH);
  const suffix = process.cwd().endsWith("/apps/web") ? "../../deployments/local/runtime.json" : "deployments/local/runtime.json";
  return resolve(process.cwd(), suffix);
}

function localRpcUrl(): string {
  const rpcUrl = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
  const parsed = new URL(rpcUrl);
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (parsed.protocol !== "http:" || !loopback.has(parsed.hostname)) throw new Error("INVALID_LOCAL_RPC_URL");
  return rpcUrl;
}

function validateRuntime(candidate: unknown): Omit<SetrynRuntime, "rpcUrl"> {
  if (!candidate || typeof candidate !== "object") throw new Error("INVALID_RUNTIME");
  const record = candidate as Record<string, unknown>;
  if (record.schemaVersion !== 7 || record.chainId !== 31337 || typeof record.day !== "number") {
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
  if (
    !Number.isSafeInteger(record.maxLongDebitMinorPerLot) ||
    Number(record.maxLongDebitMinorPerLot) <= 0 ||
    !Number.isSafeInteger(record.maxShortDebitMinorPerLot) ||
    Number(record.maxShortDebitMinorPerLot) <= 0
  ) {
    throw new Error("INVALID_RUNTIME");
  }
  return record as unknown as Omit<SetrynRuntime, "rpcUrl">;
}

export async function readLocalRuntime(): Promise<SetrynRuntime> {
  const candidate = JSON.parse(await readFile(runtimePath(), "utf8")) as unknown;
  return { ...validateRuntime(candidate), rpcUrl: localRpcUrl() };
}
