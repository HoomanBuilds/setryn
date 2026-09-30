import { readFile } from "node:fs/promises";

import { decodeAbiParameters, getAddress, type Address, type Hex } from "viem";

import { OperatorExecutionError } from "./errors.ts";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
/** Schema 9 adds a `markets` array (one series per catalog market); its single-series fields name the primary market. */
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

/** The canonical payoff terms a series committed to, decoded from its `payoffTerms` bytes. */
export interface OperatorPayoffTerms {
  readonly kind: number;
  readonly valueDecimals: number;
  readonly primaryStrike: bigint;
  readonly secondaryStrike: bigint;
  readonly maxLongDebitMinorPerLot: bigint;
  readonly maxShortDebitMinorPerLot: bigint;
  readonly fixingRequirements: readonly {
    readonly slot: number;
    readonly benchmarkId: Hex;
    readonly benchmarkVersion: number;
    readonly decimals: number;
  }[];
}

/** One onchain market: a catalog market registered as exactly one series, with its own economics and price grid. */
export interface OperatorMarket {
  /** The catalog market id (for example BTC-YC-24DEC26); the key every product surface uses. */
  readonly marketKey: string;
  readonly marketId: Hex;
  readonly instrumentId: Hex | null;
  readonly seriesId: Hex;
  readonly benchmarkId: Hex;
  readonly payoffTerms: Hex;
  readonly terms: OperatorPayoffTerms;
  /** Price ticks per unit of package price: priceTicks = price x priceScale. */
  readonly priceScale: number;
  readonly economics: OperatorDeploymentEconomics;
}

export interface OperatorDeployment {
  readonly chainId: number;
  readonly day: number;
  readonly operator: Address;
  readonly deploymentBlock: bigint;
  readonly addresses: OperatorDeploymentAddresses;
  readonly ids: OperatorDeploymentIds;
  /** The primary market's economics; per-market economics live on `markets`. */
  readonly economics: OperatorDeploymentEconomics;
  readonly payoffTerms: Hex;
  /** Every market this deployment trades. Schema 8 runtimes list only the primary market. */
  readonly markets: readonly OperatorMarket[];
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

  const markets = runtime.schemaVersion === 8
    ? [buildMarket({
      marketKey: typeof runtime.marketKey === "string" && runtime.marketKey.trim() ? runtime.marketKey : "PRIMARY",
      marketId: ids.marketId,
      instrumentId: typeof runtime.instrumentId === "string" ? runtime.instrumentId : null,
      seriesId: ids.seriesId,
      benchmarkId: ids.benchmarkId,
      payoffTerms: runtime.payoffTerms,
      priceScale: typeof runtime.priceScale === "number" ? runtime.priceScale : 1,
      maxLongDebitMinorPerLot: runtime.maxLongDebitMinorPerLot,
      maxShortDebitMinorPerLot: runtime.maxShortDebitMinorPerLot,
      tickSizeMinor: runtime.tickSizeMinor,
      maxOrderLots: runtime.maxOrderLots,
    }, "runtime")]
    : parseMarkets(runtime.markets);
  const primary = markets.find((market) => market.marketId === ids.marketId);
  if (!primary) throw invalid(`runtime.markets does not list the primary market ${ids.marketId}`);
  if (primary.seriesId !== ids.seriesId || primary.payoffTerms !== (runtime.payoffTerms as string).toLowerCase()) {
    throw invalid(`runtime.markets entry ${primary.marketKey} disagrees with the primary series fields`);
  }

  return {
    chainId: options.expectedChainId,
    day: runtime.day,
    operator: runtimeAddresses.operator,
    deploymentBlock,
    addresses,
    ids,
    economics: integers,
    payoffTerms: runtime.payoffTerms as Hex,
    markets,
  };
}

/** The market registered under an onchain market id; unknown ids are refused rather than defaulted. */
export function requireMarketById(deployment: OperatorDeployment, marketId: string): OperatorMarket {
  const needle = marketId.toLowerCase();
  const market = deployment.markets.find((candidate) => candidate.marketId === needle);
  if (!market) throw new OperatorExecutionError("invalid-payload", `market ${marketId} is not a market of this deployment`);
  return market;
}

/** The market a series trades as; unknown series are refused rather than defaulted. */
export function requireMarketBySeries(deployment: OperatorDeployment, seriesId: string): OperatorMarket {
  const needle = seriesId.toLowerCase();
  const market = deployment.markets.find((candidate) => candidate.seriesId === needle);
  if (!market) throw new OperatorExecutionError("invalid-payload", `series ${seriesId} is not a market of this deployment`);
  return market;
}

/** Resolves a catalog key (BTC-YC-24DEC26) or an onchain market id. */
export function requireMarket(deployment: OperatorDeployment, keyOrId: string): OperatorMarket {
  if (hashPattern.test(keyOrId)) return requireMarketById(deployment, keyOrId);
  const market = deployment.markets.find((candidate) => candidate.marketKey === keyOrId);
  if (!market) throw new OperatorExecutionError("invalid-payload", `market ${keyOrId} is not a market of this deployment`);
  return market;
}

const canonicalPayoffTermsAbi = [
  {
    type: "tuple",
    components: [
      { name: "schemaVersion", type: "uint8" },
      { name: "kind", type: "uint8" },
      { name: "valueDecimals", type: "uint8" },
      { name: "primaryStrike", type: "int256" },
      { name: "secondaryStrike", type: "int256" },
      { name: "premiumMinorPerLot", type: "int256" },
      { name: "multiplierNumerator", type: "uint256" },
      { name: "multiplierDenominator", type: "uint256" },
      { name: "minimumTransferMinorPerLot", type: "int256" },
      { name: "maximumTransferMinorPerLot", type: "int256" },
      { name: "maxLongDebitMinorPerLot", type: "uint128" },
      { name: "maxShortDebitMinorPerLot", type: "uint128" },
      { name: "disruptionTransferMinorPerLot", type: "int256" },
      {
        name: "fixingRequirements",
        type: "tuple[]",
        components: [
          { name: "slot", type: "uint8" },
          { name: "benchmarkId", type: "bytes32" },
          { name: "benchmarkVersion", type: "uint32" },
          { name: "windowKindId", type: "bytes32" },
          { name: "decimals", type: "uint8" },
        ],
      },
    ],
  },
] as const;

/** Decodes `abi.encode(CanonicalPayoffTerms)`; malformed bytes are a stale or corrupt runtime file. */
export function decodePayoffTerms(payoffTerms: Hex, label: string): OperatorPayoffTerms {
  let decoded;
  try {
    [decoded] = decodeAbiParameters(canonicalPayoffTermsAbi, payoffTerms);
  } catch (error) {
    throw invalid(`${label} is not canonical payoff terms: ${error instanceof Error ? error.message.split("\n")[0] : "decode failed"}`);
  }
  return {
    kind: decoded.kind,
    valueDecimals: decoded.valueDecimals,
    primaryStrike: decoded.primaryStrike,
    secondaryStrike: decoded.secondaryStrike,
    maxLongDebitMinorPerLot: decoded.maxLongDebitMinorPerLot,
    maxShortDebitMinorPerLot: decoded.maxShortDebitMinorPerLot,
    fixingRequirements: decoded.fixingRequirements.map((requirement) => ({
      slot: requirement.slot,
      benchmarkId: requirement.benchmarkId.toLowerCase() as Hex,
      benchmarkVersion: requirement.benchmarkVersion,
      decimals: requirement.decimals,
    })),
  };
}

const maximumMarkets = 256;

function parseMarkets(value: unknown): OperatorMarket[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid("runtime.markets must be a non-empty array");
  if (value.length > maximumMarkets) throw invalid(`runtime.markets lists more than ${maximumMarkets} markets`);
  const markets = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid(`runtime.markets[${index}] must be an object`);
    return buildMarket(entry as Record<string, unknown>, `runtime.markets[${index}]`);
  });
  for (const field of ["marketKey", "marketId", "seriesId"] as const) {
    const seen = new Set<string>();
    for (const market of markets) {
      if (seen.has(market[field])) throw invalid(`runtime.markets repeats ${field} ${market[field]}`);
      seen.add(market[field]);
    }
  }
  return markets;
}

/**
 * Validates one market entry and cross-checks it against its own canonical payoff terms: the debit caps the runtime
 * advertises must be the ones the terms commit to, and the fixing requirement must name the market's benchmark.
 */
function buildMarket(entry: Record<string, unknown>, label: string): OperatorMarket {
  if (typeof entry.marketKey !== "string" || !/^[A-Z0-9][A-Z0-9-]{1,63}$/.test(entry.marketKey)) {
    throw invalid(`${label}.marketKey must be a catalog market id`);
  }
  if (typeof entry.payoffTerms !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(entry.payoffTerms)) {
    throw invalid(`${label}.payoffTerms must be non-empty hex`);
  }
  const priceScale = entry.priceScale;
  if (typeof priceScale !== "number" || !Number.isSafeInteger(priceScale) || priceScale <= 0 || !/^10*$/.test(String(priceScale))) {
    throw invalid(`${label}.priceScale must be a positive power of ten`);
  }
  const payoffTerms = entry.payoffTerms.toLowerCase() as Hex;
  const economics: OperatorDeploymentEconomics = {
    maxLongDebitMinorPerLot: requirePositiveInteger(entry.maxLongDebitMinorPerLot, `${label}.maxLongDebitMinorPerLot`),
    maxShortDebitMinorPerLot: requirePositiveInteger(entry.maxShortDebitMinorPerLot, `${label}.maxShortDebitMinorPerLot`),
    tickSizeMinor: requirePositiveInteger(entry.tickSizeMinor, `${label}.tickSizeMinor`),
    maxOrderLots: requirePositiveInteger(entry.maxOrderLots, `${label}.maxOrderLots`),
  };
  const benchmarkId = requireHash(entry.benchmarkId, `${label}.benchmarkId`);
  const terms = decodePayoffTerms(payoffTerms, `${label}.payoffTerms`);
  if (terms.maxLongDebitMinorPerLot !== economics.maxLongDebitMinorPerLot || terms.maxShortDebitMinorPerLot !== economics.maxShortDebitMinorPerLot) {
    throw invalid(`${label} debit caps do not match its canonical payoff terms`);
  }
  if (terms.fixingRequirements.length === 0 || terms.fixingRequirements.some((requirement) => requirement.benchmarkId !== benchmarkId)) {
    throw invalid(`${label} payoff terms do not fix on its benchmark ${benchmarkId}`);
  }
  return {
    marketKey: entry.marketKey,
    marketId: requireHash(entry.marketId, `${label}.marketId`),
    instrumentId: entry.instrumentId === undefined || entry.instrumentId === null ? null : requireHash(entry.instrumentId, `${label}.instrumentId`),
    seriesId: requireHash(entry.seriesId, `${label}.seriesId`),
    benchmarkId,
    payoffTerms,
    terms,
    priceScale,
    economics,
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
