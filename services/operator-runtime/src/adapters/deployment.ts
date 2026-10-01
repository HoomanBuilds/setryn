import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { decodeAbiParameters, getAddress, type Address, type Hex } from "viem";

import { OperatorExecutionError } from "./errors.ts";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
/**
 * Schema 9 adds a `markets` array (one series per catalog market); its single-series fields name the primary market.
 * Schema 10 adds optional fee schedule fields (`feeScheduleVersion`, `treasuryController`) to schema 9.
 * Schema 11 (network runtime) keeps every schema 10 field and adds the network, fixing adapter, oracle signers, the
 * session-day proofs path and, per market, the listing economics: `priceOffset` (the floor), `referenceFeed` (Chainlink
 * on Arbitrum One) and the schedule. Range forwards carry a zero long debit: the long pays its consideration at the fill.
 */
const runtimeSchemaVersions: readonly unknown[] = [8, 9, 10, 11];

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
  /** The runtime's `feeScheduleRegistry`, or the manifest's; null reads it from FundedFeeEngine. */
  readonly feeScheduleRegistry: Address | null;
}

/**
 * Fee fields the runtime file recorded at deployment. They are a fallback only: orders sign the version the registry
 * has active and its rates, read through `readActiveFeeSchedule` in fees.ts.
 */
export interface OperatorDeploymentFees {
  readonly feeScheduleVersion: number | null;
  readonly makerFeeRatePpm: bigint | null;
  readonly takerFeeRatePpm: bigint | null;
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
  /** Zero for range forwards: the long's whole outlay is the consideration it pays at the fill. */
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
  /** Price ticks per unit of package price: priceTicks = (price - priceOffset) x priceScale. */
  readonly priceScale: number;
  /** Package price at zero ticks (decimal string; the range floor on schema 11, "0" before). */
  readonly priceOffset: string;
  /** Inclusive tick bounds the market registered, when the runtime records them. */
  readonly minPriceTicks: bigint | null;
  readonly maxPriceTicks: bigint | null;
  /** Benchmark feed name (for example Crypto.BTC/USD) and its Chainlink aggregator on the reference chain (schema 11). */
  readonly feedKey: string | null;
  readonly referenceFeed: Address | null;
  readonly economics: OperatorDeploymentEconomics;
}

/** Schema 11 network fields; null on older runtimes. */
export interface OperatorNetworkRuntime {
  readonly network: string;
  readonly fixingAdapter: Address;
  readonly fixingAdapterKind: string;
  readonly oracleSigners: readonly Address[];
  readonly oracleThreshold: number;
  readonly referenceChainId: number;
  readonly tradingSessionPolicy: Address;
  readonly sessionId: Hex;
  readonly sessionVersion: number;
  /** Absolute path of the session-day proofs file (`sessionDaysPath` resolved against the runtime file's directory). */
  readonly sessionDaysPath: string | null;
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
  readonly fees: OperatorDeploymentFees;
  readonly schemaVersion: number;
  /** Schema 11 network fields; null for schema 8 to 10 runtimes. */
  readonly network: OperatorNetworkRuntime | null;
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
 * Reads the runtime file (schema version 8 to 11) and the deployment manifest for one chain. The manifest
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
    runtimeIntegerFields.map((field) => [
      field,
      field === "maxLongDebitMinorPerLot"
        ? requireNonNegativeInteger(runtime[field], `runtime.${field}`)
        : requirePositiveInteger(runtime[field], `runtime.${field}`),
    ]),
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
    feeScheduleRegistry: runtime.feeScheduleRegistry === undefined || runtime.feeScheduleRegistry === null
      ? optionalManifestContract(manifestContracts, "FeeScheduleRegistry")
      : requireAddress(runtime.feeScheduleRegistry, "runtime.feeScheduleRegistry"),
  };
  const fees: OperatorDeploymentFees = {
    feeScheduleVersion: runtime.feeScheduleVersion === undefined || runtime.feeScheduleVersion === null
      ? null
      : Number(requirePositiveInteger(runtime.feeScheduleVersion, "runtime.feeScheduleVersion")),
    makerFeeRatePpm: optionalRate(runtime.makerFeeRatePpm, "runtime.makerFeeRatePpm"),
    takerFeeRatePpm: optionalRate(runtime.takerFeeRatePpm, "runtime.takerFeeRatePpm"),
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
      priceOffset: runtime.priceOffset,
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
    fees,
    schemaVersion: runtime.schemaVersion as number,
    network: runtime.schemaVersion === 11 ? parseNetwork(runtime, options.runtimePath) : null,
  };
}

function parseNetwork(runtime: Record<string, unknown>, runtimePath: string): OperatorNetworkRuntime {
  if (typeof runtime.network !== "string" || !runtime.network) throw invalid("runtime.network is missing");
  if (!Array.isArray(runtime.oracleSigners) || runtime.oracleSigners.length === 0) {
    throw invalid("runtime.oracleSigners must be a non-empty address array");
  }
  const oracleSigners = runtime.oracleSigners.map((signer, index) => requireAddress(signer, `runtime.oracleSigners[${index}]`));
  const oracleThreshold = Number(requirePositiveInteger(runtime.oracleThreshold, "runtime.oracleThreshold"));
  if (oracleThreshold > oracleSigners.length) throw invalid("runtime.oracleThreshold exceeds the oracle signer count");
  const sessionDaysPath = typeof runtime.sessionDaysPath === "string" && runtime.sessionDaysPath.trim()
    ? resolve(dirname(resolve(runtimePath)), runtime.sessionDaysPath)
    : null;
  return {
    network: runtime.network,
    fixingAdapter: requireAddress(runtime.fixingAdapter, "runtime.fixingAdapter"),
    fixingAdapterKind: typeof runtime.fixingAdapterKind === "string" ? runtime.fixingAdapterKind : "signed-observation",
    oracleSigners,
    oracleThreshold,
    referenceChainId: Number(requirePositiveInteger(runtime.referenceChainId, "runtime.referenceChainId")),
    tradingSessionPolicy: requireAddress(runtime.tradingSessionPolicy, "runtime.tradingSessionPolicy"),
    sessionId: requireHash(runtime.sessionId, "runtime.sessionId"),
    sessionVersion: Number(requirePositiveInteger(runtime.sessionVersion, "runtime.sessionVersion")),
    sessionDaysPath,
  };
}

const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/;

/** A decimal string as an integer scaled by 10^decimals; refuses digits finer than `decimals` unless they are zero. */
function scaleDecimal(value: string, decimals: number, label: string): bigint {
  const match = decimalPattern.exec(value.trim());
  if (!match) throw new OperatorExecutionError("invalid-payload", `${label} ${value} is not a decimal number`);
  const fraction = match[3] ?? "";
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new OperatorExecutionError("invalid-payload", `${label} ${value} is finer than ${decimals} decimals`);
  }
  const magnitude = BigInt(match[2]!) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function fractionDigits(value: string): number {
  return decimalPattern.exec(value.trim())?.[3]?.length ?? 0;
}

/** Decimal places of the market's tick grid (priceScale is a power of ten). */
export function priceGridDecimals(market: OperatorMarket): number {
  return String(market.priceScale).length - 1;
}

/** ticks = (price - priceOffset) x priceScale, exactly; a price off the market's tick grid is refused. */
export function priceToTicks(market: OperatorMarket, price: string, label = "price"): bigint {
  const grid = priceGridDecimals(market);
  const decimals = Math.max(grid, fractionDigits(market.priceOffset));
  const difference = scaleDecimal(price, decimals, label) - scaleDecimal(market.priceOffset, decimals, `${market.marketKey}.priceOffset`);
  const unit = 10n ** BigInt(decimals - grid);
  if (difference % unit !== 0n) {
    throw new OperatorExecutionError("invalid-payload", `${label} ${price} is off ${market.marketKey}'s ${grid}-decimal price grid`);
  }
  return difference / unit;
}

/** price = priceOffset + ticks / priceScale, as a decimal string. */
export function ticksToPrice(market: OperatorMarket, ticks: bigint): string {
  const grid = priceGridDecimals(market);
  const decimals = Math.max(grid, fractionDigits(market.priceOffset));
  const value = scaleDecimal(market.priceOffset, decimals, `${market.marketKey}.priceOffset`) + ticks * 10n ** BigInt(decimals - grid);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const fraction = decimals > 0 ? `.${(magnitude % scale).toString().padStart(decimals, "0")}` : "";
  return `${negative ? "-" : ""}${magnitude / scale}${fraction}`;
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
  const priceOffset = entry.priceOffset === undefined || entry.priceOffset === null ? "0" : entry.priceOffset;
  if (typeof priceOffset !== "string" || !decimalPattern.test(priceOffset)) {
    throw invalid(`${label}.priceOffset must be a decimal string`);
  }
  const economics: OperatorDeploymentEconomics = {
    maxLongDebitMinorPerLot: requireNonNegativeInteger(entry.maxLongDebitMinorPerLot, `${label}.maxLongDebitMinorPerLot`),
    maxShortDebitMinorPerLot: requirePositiveInteger(entry.maxShortDebitMinorPerLot, `${label}.maxShortDebitMinorPerLot`),
    tickSizeMinor: requirePositiveInteger(entry.tickSizeMinor, `${label}.tickSizeMinor`),
    maxOrderLots: requirePositiveInteger(entry.maxOrderLots, `${label}.maxOrderLots`),
  };
  const benchmarkId = requireHash(entry.benchmarkId, `${label}.benchmarkId`);
  const terms = decodePayoffTerms(payoffTerms, `${label}.payoffTerms`);
  if (terms.maxLongDebitMinorPerLot !== economics.maxLongDebitMinorPerLot || terms.maxShortDebitMinorPerLot !== economics.maxShortDebitMinorPerLot) {
    throw invalid(`${label} debit caps do not match its canonical payoff terms`);
  }
  if (economics.maxLongDebitMinorPerLot === 0n && economics.maxShortDebitMinorPerLot === 0n) {
    throw invalid(`${label} has no terminal debit on either side`);
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
    priceOffset,
    minPriceTicks: entry.minPriceTicks === undefined || entry.minPriceTicks === null ? null : requireSignedInteger(entry.minPriceTicks, `${label}.minPriceTicks`),
    maxPriceTicks: entry.maxPriceTicks === undefined || entry.maxPriceTicks === null ? null : requireSignedInteger(entry.maxPriceTicks, `${label}.maxPriceTicks`),
    feedKey: typeof entry.feedKey === "string" && entry.feedKey ? entry.feedKey : null,
    referenceFeed: entry.referenceFeed === undefined || entry.referenceFeed === null ? null : requireAddress(entry.referenceFeed, `${label}.referenceFeed`),
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

function optionalManifestContract(contracts: Map<string, Address[]>, name: string): Address | null {
  const matches = contracts.get(name) ?? [];
  return matches.length === 1 ? matches[0]! : null;
}

function optionalRate(value: unknown, label: string): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= 1_000_000) {
    throw invalid(`${label} must be a fee rate below 1,000,000 ppm`);
  }
  return BigInt(value);
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

function requireNonNegativeInteger(value: unknown, label: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid(`${label} must be a non-negative integer`);
  return BigInt(value);
}

function requireSignedInteger(value: unknown, label: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalid(`${label} must be an integer`);
  return BigInt(value);
}

function invalid(message: string): OperatorExecutionError {
  return new OperatorExecutionError("config-invalid", message);
}
