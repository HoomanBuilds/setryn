import { readFile } from "node:fs/promises";

import { getAddress, type Address, type Hex } from "viem";

import { OperatorExecutionError } from "./errors.ts";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
/** Schema 9 adds a `markets` array; its single-series fields still name the primary market this runtime operates. */
const runtimeSchemaVersions: readonly unknown[] = [8, 9];

/** Addresses the operator ports call; every one is checked against the deployment manifest. */
export interface OperatorDeploymentAddresses {
  readonly settlementToken: Address;
  readonly collateralVault: Address;
  readonly fundedFeeEngine: Address;
  readonly portfolioRiskEngine: Address;
  readonly riskAdmissionBindingRegistry: Address;
  readonly orderState: Address;
  readonly atomicClearingEngine: Address;
  readonly privateRfqBook: Address;
  readonly publicOrderBook: Address;
  readonly positionEngine: Address;
  readonly seriesRegistry: Address;
  readonly benchmarkRegistry: Address;
  readonly fixingEngine: Address;
  readonly cashSettlementCoordinator: Address;
}

export interface OperatorDeploymentIds {
  readonly settlementAssetId: Hex;
  readonly riskDomainId: Hex;
  readonly marketId: Hex;
  readonly seriesId: Hex;
  readonly benchmarkId: Hex;
  readonly feeScheduleId: Hex;
  readonly executionModeId: Hex;
  readonly privateRfqExecutionModeId: Hex;
  readonly privateRfqPrivacyModeId: Hex;
  readonly privateRfqDisclosurePolicyHash: Hex;
  readonly privateRfqEligibleMakerSetHash: Hex;
  readonly enterActionId: Hex;
}

export interface OperatorDeploymentEconomics {
  readonly maxLongDebitMinorPerLot: bigint;
  readonly maxShortDebitMinorPerLot: bigint;
  readonly tickSizeMinor: bigint;
  readonly maxOrderLots: bigint;
}

export interface OperatorDeployment {
  readonly chainId: number;
  readonly day: number;
  readonly operator: Address;
  readonly deploymentBlock: bigint;
  readonly addresses: OperatorDeploymentAddresses;
  readonly ids: OperatorDeploymentIds;
  readonly economics: OperatorDeploymentEconomics;
  readonly payoffTerms: Hex;
}

const runtimeAddressFields = [
  "operator",
  "settlementToken",
  "collateralVault",
  "fundedFeeEngine",
  "portfolioRiskEngine",
  "riskAdmissionBindingRegistry",
  "orderState",
  "atomicClearingEngine",
  "privateRfqBook",
  "publicOrderBook",
  "positionEngine",
  "seriesRegistry",
  "benchmarkRegistry",
] as const;

const runtimeHashFields = [
  "settlementAssetId",
  "riskDomainId",
  "marketId",
  "seriesId",
  "benchmarkId",
  "feeScheduleId",
  "executionModeId",
  "privateRfqExecutionModeId",
  "privateRfqPrivacyModeId",
  "privateRfqDisclosurePolicyHash",
  "privateRfqEligibleMakerSetHash",
  "enterActionId",
] as const;

const runtimeIntegerFields = ["maxLongDebitMinorPerLot", "maxShortDebitMinorPerLot", "tickSizeMinor", "maxOrderLots"] as const;

/** Runtime fields that name a manifest contract; a mismatch means the runtime file is stale for this chain. */
const manifestCrossChecks: Readonly<Record<string, keyof OperatorDeploymentAddresses>> = {
  CollateralVault: "collateralVault",
  FundedFeeEngine: "fundedFeeEngine",
  PortfolioRiskEngine: "portfolioRiskEngine",
  RiskAdmissionBindingRegistry: "riskAdmissionBindingRegistry",
  OrderState: "orderState",
  AtomicClearingEngine: "atomicClearingEngine",
  PrivateRfqBook: "privateRfqBook",
  PublicOrderBook: "publicOrderBook",
  PositionEngine: "positionEngine",
  SeriesRegistry: "seriesRegistry",
  BenchmarkRegistry: "benchmarkRegistry",
};

/**
 * Reads the devnet-style runtime file (schema version 8 or 9) and the deployment manifest for one chain. The manifest
 * supplies the fixing and settlement contracts the runtime file does not carry, and both must name the same chain.
 */
export async function loadOperatorDeployment(options: {
  readonly runtimePath: string;
  readonly manifestPath: string;
  readonly expectedChainId: number;
}): Promise<OperatorDeployment> {
  const runtime = await readJson(options.runtimePath, "runtime");
  const manifest = await readJson(options.manifestPath, "manifest");
  if (!runtimeSchemaVersions.includes(runtime.schemaVersion)) {
    throw invalid(`runtime ${options.runtimePath} must be schema version ${runtimeSchemaVersions.join(" or ")}`);
  }
  if (runtime.chainId !== options.expectedChainId) {
    throw invalid(`runtime ${options.runtimePath} is for chain ${String(runtime.chainId)}, expected ${options.expectedChainId}`);
  }
  if (manifest.chainId !== options.expectedChainId) {
    throw invalid(`manifest ${options.manifestPath} is for chain ${String(manifest.chainId)}, expected ${options.expectedChainId}`);
  }
  if (typeof runtime.day !== "number" || !Number.isSafeInteger(runtime.day)) throw invalid("runtime day is missing");

  const runtimeAddresses = Object.fromEntries(
    runtimeAddressFields.map((field) => [field, requireAddress(runtime[field], `runtime.${field}`)]),
  ) as Record<(typeof runtimeAddressFields)[number], Address>;
  const ids = Object.fromEntries(
    runtimeHashFields.map((field) => [field, requireHash(runtime[field], `runtime.${field}`)]),
  ) as unknown as OperatorDeploymentIds;
  const integers = Object.fromEntries(
    runtimeIntegerFields.map((field) => [field, requirePositiveInteger(runtime[field], `runtime.${field}`)]),
  ) as unknown as OperatorDeploymentEconomics;
  if (typeof runtime.payoffTerms !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(runtime.payoffTerms)) {
    throw invalid("runtime.payoffTerms must be non-empty hex");
  }

  const manifestContracts = manifestAddresses(manifest);
  const addresses: OperatorDeploymentAddresses = {
    settlementToken: runtimeAddresses.settlementToken,
    collateralVault: runtimeAddresses.collateralVault,
    fundedFeeEngine: runtimeAddresses.fundedFeeEngine,
    portfolioRiskEngine: runtimeAddresses.portfolioRiskEngine,
    riskAdmissionBindingRegistry: runtimeAddresses.riskAdmissionBindingRegistry,
    orderState: runtimeAddresses.orderState,
    atomicClearingEngine: runtimeAddresses.atomicClearingEngine,
    privateRfqBook: runtimeAddresses.privateRfqBook,
    publicOrderBook: runtimeAddresses.publicOrderBook,
    positionEngine: runtimeAddresses.positionEngine,
    seriesRegistry: runtimeAddresses.seriesRegistry,
    benchmarkRegistry: runtimeAddresses.benchmarkRegistry,
    fixingEngine: requireManifestContract(manifestContracts, "FixingEngine"),
    cashSettlementCoordinator: requireManifestContract(manifestContracts, "CashSettlementCoordinator"),
  };
  for (const [name, field] of Object.entries(manifestCrossChecks)) {
    const fromManifest = requireManifestContract(manifestContracts, name);
    if (fromManifest !== addresses[field]) {
      throw invalid(`runtime ${field} ${addresses[field]} does not match manifest ${name} ${fromManifest}`);
    }
  }

  const blockReference = manifest.blockReference as { readonly number?: unknown } | undefined;
  const deploymentBlock = typeof blockReference?.number === "number" && Number.isSafeInteger(blockReference.number)
    ? BigInt(blockReference.number)
    : 0n;

  return {
    chainId: options.expectedChainId,
    day: runtime.day,
    operator: runtimeAddresses.operator,
    deploymentBlock,
    addresses,
    ids,
    economics: integers,
    payoffTerms: runtime.payoffTerms as Hex,
  };
}

async function readJson(path: string, label: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw invalid(`${label} file ${path} is unreadable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} file ${path} is not a JSON object`);
  return value as Record<string, unknown>;
}

function manifestAddresses(manifest: Record<string, unknown>): Map<string, Address[]> {
  const phase2 = manifest.phase2 as { readonly deployments?: unknown } | undefined;
  const entries = [
    ...(Array.isArray(manifest.contracts) ? manifest.contracts : []),
    ...(Array.isArray(phase2?.deployments) ? phase2.deployments : []),
  ] as { readonly name?: unknown; readonly address?: unknown }[];
  const byName = new Map<string, Address[]>();
  for (const entry of entries) {
    if (typeof entry.name !== "string" || typeof entry.address !== "string" || !addressPattern.test(entry.address)) continue;
    byName.set(entry.name, [...(byName.get(entry.name) ?? []), getAddress(entry.address)]);
  }
  return byName;
}

function requireManifestContract(contracts: Map<string, Address[]>, name: string): Address {
  const matches = contracts.get(name) ?? [];
  if (matches.length !== 1) throw invalid(`manifest must contain exactly one deployed ${name}`);
  return matches[0]!;
}

function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) throw invalid(`${label} must be an address`);
  return getAddress(value);
}

function requireHash(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !hashPattern.test(value)) throw invalid(`${label} must be a 32-byte hex value`);
  return value.toLowerCase() as Hex;
}

function requirePositiveInteger(value: unknown, label: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw invalid(`${label} must be a positive integer`);
  return BigInt(value);
}

function invalid(message: string): OperatorExecutionError {
  return new OperatorExecutionError("config-invalid", message);
}
