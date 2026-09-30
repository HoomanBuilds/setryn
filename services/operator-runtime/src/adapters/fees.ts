import { contractBindings } from "@setryn/internal-contracts";
import { keccak256, stringToHex, type Address, type Hex } from "viem";

import type { OperatorChainClient } from "./chain.ts";
import type { OperatorDeployment } from "./deployment.ts";
import { OperatorExecutionError } from "./errors.ts";

/*
 * The active protocol fee schedule, read from chain. It ports the web app's `lib/internal-gateway/fee-schedule.ts` onto
 * the generated bindings: FeeScheduleRegistry names the active version of `feeScheduleId`, FundedFeeEngine holds that
 * version's installed rule witness, and a fill is charged flat + ceil(consideration x ratePpm / 1,000,000) under the
 * MakerFill or TakerFill rule (the first tier under the volume-tiered model, since clearing passes zero volume).
 * Every maker and solver order signs this version, so a fee change needs no operator restart.
 */

const feeScheduleRegistryAbi = contractBindings.FeeScheduleRegistry.abi;
const fundedFeeEngineAbi = contractBindings.FundedFeeEngine.abi;
const seriesRegistryAbi = contractBindings.SeriesRegistry.abi;
const marketRegistryAbi = contractBindings.MarketRegistry.abi;

const makerFillAction = keccak256(stringToHex("SetrynFeeActionV1:MakerFill"));
const takerFillAction = keccak256(stringToHex("SetrynFeeActionV1:TakerFill"));
const volumeTieredModel = keccak256(stringToHex("SetrynFeeModelV1:VolumeTiered"));
const ppmDenominator = 1_000_000n;
const cacheMilliseconds = 15_000;

export interface OperatorFeeTerms {
  readonly chargeRatePpm: bigint;
  readonly flatChargeMinor: bigint;
}

export interface OperatorFeeSchedule {
  readonly feeScheduleId: Hex;
  readonly version: number;
  /** The newest registered version; books of every version up to it may still hold orders to expire. */
  readonly latestVersion: number;
  readonly active: boolean;
  readonly maker: OperatorFeeTerms;
  readonly taker: OperatorFeeTerms;
  /** CHAIN when read from the registry and fee engine; RUNTIME when the chain read failed and the runtime file was used. */
  readonly source: "CHAIN" | "RUNTIME";
}

const cache = new WeakMap<OperatorDeployment, { readonly at: number; readonly value: OperatorFeeSchedule }>();

/** The charge FundedFeeEngine computes for one fill: flat plus the rate on the consideration, rounded up. */
export function feeChargeMinor(terms: OperatorFeeTerms, considerationMinor: bigint): bigint {
  const notional = considerationMinor < 0n ? -considerationMinor : considerationMinor;
  const proportional = notional === 0n || terms.chargeRatePpm === 0n ? 0n : (notional * terms.chargeRatePpm - 1n) / ppmDenominator + 1n;
  return terms.flatChargeMinor + proportional;
}

async function registryAddress(client: OperatorChainClient): Promise<Address> {
  const { deployment } = client;
  if (deployment.addresses.feeScheduleRegistry) return deployment.addresses.feeScheduleRegistry;
  return client.read("read fee schedule registry", (reader) =>
    reader.readContract({ address: deployment.addresses.fundedFeeEngine, abi: fundedFeeEngineAbi, functionName: "feeScheduleRegistry" }),
  );
}

async function readFromChain(client: OperatorChainClient): Promise<OperatorFeeSchedule> {
  const { deployment } = client;
  const feeScheduleId = deployment.ids.feeScheduleId;
  const registry = await registryAddress(client);
  const [active, latest] = await Promise.all([
    client.read("read active fee schedule version", (reader) =>
      reader.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "activeVersion", args: [feeScheduleId] }),
    ),
    client.read("read latest fee schedule version", (reader) =>
      reader.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "latestVersion", args: [feeScheduleId] }),
    ),
  ]);
  if (latest === 0) throw new OperatorExecutionError("precondition", `fee schedule ${feeScheduleId} has no registered version`);
  const version = active !== 0 ? active : latest;
  const [record, witness] = await Promise.all([
    client.read("read fee schedule definition", (reader) =>
      reader.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "getFeeSchedule", args: [feeScheduleId, version] }),
    ),
    client.read("read fee schedule witness", (reader) =>
      reader.readContract({
        address: deployment.addresses.fundedFeeEngine,
        abi: fundedFeeEngineAbi,
        functionName: "getScheduleWitness",
        args: [feeScheduleId, version],
      }),
    ),
  ]);
  const [rules] = witness;
  const tiered = record.definition.feeModelId.toLowerCase() === volumeTieredModel;
  const terms = (action: Hex): OperatorFeeTerms => {
    const rule = rules.find((candidate) => candidate.actionId.toLowerCase() === action);
    const source = rule ? (tiered ? rule.tiers[0] : rule) : undefined;
    if (!source) throw new OperatorExecutionError("precondition", `fee schedule version ${version} has no rule for action ${action}`);
    return { chargeRatePpm: BigInt(source.chargeRatePpm), flatChargeMinor: BigInt(source.flatChargeMinor) };
  };
  return {
    feeScheduleId,
    version,
    latestVersion: latest,
    active: active !== 0,
    maker: terms(makerFillAction),
    taker: terms(takerFillAction),
    source: "CHAIN",
  };
}

function fromRuntime(deployment: OperatorDeployment): OperatorFeeSchedule {
  return {
    feeScheduleId: deployment.ids.feeScheduleId,
    version: deployment.fees.feeScheduleVersion ?? 1,
    latestVersion: deployment.fees.feeScheduleVersion ?? 1,
    active: false,
    maker: { chargeRatePpm: deployment.fees.makerFeeRatePpm ?? 0n, flatChargeMinor: 0n },
    taker: { chargeRatePpm: deployment.fees.takerFeeRatePpm ?? 0n, flatChargeMinor: 0n },
    source: "RUNTIME",
  };
}

/**
 * The active fee schedule, cached for 15 seconds per deployment. `fresh` forces a read. A failed chain read falls back
 * to the runtime file's recorded version and rates and is not cached.
 */
export async function readActiveFeeSchedule(client: OperatorChainClient, options: { readonly fresh?: boolean } = {}): Promise<OperatorFeeSchedule> {
  const hit = cache.get(client.deployment);
  if (!options.fresh && hit && Date.now() - hit.at <= cacheMilliseconds) return hit.value;
  try {
    const value = await readFromChain(client);
    cache.set(client.deployment, { at: Date.now(), value });
    return value;
  } catch {
    return fromRuntime(client.deployment);
  }
}

/** Refuses to sign under a schedule that cannot clear: the chain reports no active version. */
export function requireOpenFeeSchedule(fees: OperatorFeeSchedule): OperatorFeeSchedule {
  if (fees.source === "CHAIN" && !fees.active) {
    throw new OperatorExecutionError("precondition", `fee schedule ${fees.feeScheduleId} has no active version, so no order can clear`);
  }
  return fees;
}

/** The versions an order on one series version signs: the version itself and its market version's fee schedule version. */
export interface OperatorSeriesVersions {
  readonly seriesVersion: number;
  readonly marketVersion: number;
  readonly feeScheduleVersion: number;
}

/**
 * A fee change re-versions every market onto the new fee schedule version and every series onto the new market version,
 * and PublicOrderBook admits an order only under its series' market's fee version. This reads that pair for one
 * series version.
 */
export async function readSeriesVersions(client: OperatorChainClient, seriesId: Hex, seriesVersion: number): Promise<OperatorSeriesVersions> {
  const { deployment } = client;
  const series = await client.read("read series version", (reader) =>
    reader.readContract({ address: deployment.addresses.seriesRegistry, abi: seriesRegistryAbi, functionName: "getSeries", args: [seriesId, seriesVersion] }),
  );
  const marketRegistry = await client.read("read market registry", (reader) =>
    reader.readContract({ address: deployment.addresses.seriesRegistry, abi: seriesRegistryAbi, functionName: "marketRegistry" }),
  );
  const market = await client.read("read market version", (reader) =>
    reader.readContract({
      address: marketRegistry,
      abi: marketRegistryAbi,
      functionName: "getMarket",
      args: [series.definition.marketId, series.definition.marketVersion],
    }),
  );
  return { seriesVersion, marketVersion: series.definition.marketVersion, feeScheduleVersion: market.definition.feeScheduleVersion };
}

/** The series' active version and the versions its orders sign now; `latestVersion` bounds the books to scan. */
export async function readActiveSeriesVersions(
  client: OperatorChainClient,
  seriesId: Hex,
): Promise<OperatorSeriesVersions & { readonly active: boolean; readonly latestVersion: number }> {
  const { deployment } = client;
  const [active, latest] = await Promise.all([
    client.read("read active series version", (reader) =>
      reader.readContract({ address: deployment.addresses.seriesRegistry, abi: seriesRegistryAbi, functionName: "activeVersion", args: [seriesId] }),
    ),
    client.read("read latest series version", (reader) =>
      reader.readContract({ address: deployment.addresses.seriesRegistry, abi: seriesRegistryAbi, functionName: "latestVersion", args: [seriesId] }),
    ),
  ]);
  const version = Number(active) || Number(latest) || 1;
  return { ...(await readSeriesVersions(client, seriesId, version)), active: Number(active) !== 0, latestVersion: Number(latest) || version };
}
