import { createPublicClient, keccak256, stringToHex, type Address, type Hex, type PublicClient } from "viem";
import type { SetrynRuntime, SetrynRuntimeMarket } from "./runtime";
import { serverReadTransport } from "./rpc-transport";

/*
 * The protocol fee schedule, read from chain. One helper serves the server routes, the public API, and the browser
 * gateway, so every order, quote, estimate and projection prices under the same active version.
 *
 * FeeScheduleRegistry holds the versioned schedule: `activeVersion(id)` is the only version that may price new risk,
 * and `getFeeSchedule(id, version)` returns its immutable definition. The definition commits to its fee rules by hash
 * (`feeRulesHash`); the concrete rules live in FundedFeeEngine as the installed witness (`getScheduleWitness`), which
 * the engine proved against that hash when it was installed. Rates are derived exactly as FundedFeeEngine charges them
 * at clearing: the MakerFill or TakerFill rule of the order's version, its first tier under the volume-tiered model
 * (clearing passes zero qualifying volume), and charge = flat + ceil(notional x ratePpm / 1,000,000).
 *
 * A fee change re-versions every market onto the new fee schedule version and every series onto the new market
 * version (PublicOrderBook admits an order only under its series' market's fee schedule version). So the reading also
 * carries, per catalog market, the versions an order must sign: the series' active version (`targetVersion`) and the
 * `feeScheduleVersion` its market version names, both read from SeriesRegistry and MarketRegistry.
 *
 * Reads are cached for 15 seconds per deployment. When the chain cannot be read the helper falls back to the runtime
 * file (`feeScheduleVersion`, `makerFeeRatePpm`, `takerFeeRatePpm`, `markets[].seriesVersion`/`marketVersion`) and says
 * so in `source`.
 */

export const PPM_DENOMINATOR = 1_000_000;
const DEFAULT_MAX_AGE_MS = 15_000;
const CACHE_KEY = Symbol.for("setryn.fee-schedule.cache");

const actionId = (name: string) => keccak256(stringToHex(`SetrynFeeActionV1:${name}`));
const modelId = (name: string) => keccak256(stringToHex(`SetrynFeeModelV1:${name}`));

/** Every fee action the contracts name, by its canonical hash. A hash outside this table is surfaced, never guessed. */
export const FEE_ACTIONS = {
  MAKER_FILL: actionId("MakerFill"),
  TAKER_FILL: actionId("TakerFill"),
  SETTLEMENT: actionId("Settlement"),
  EXERCISE: actionId("Exercise"),
  LIQUIDATION: actionId("Liquidation"),
  FUNDING: actionId("Funding"),
  SOLVER_REWARD: actionId("SolverReward"),
  KEEPER_REWARD: actionId("KeeperReward"),
  LIQUIDITY_INCENTIVE: actionId("LiquidityIncentive"),
} as const;
export type FeeActionName = keyof typeof FEE_ACTIONS;

export const FEE_ACTION_LABELS: Record<FeeActionName, string> = {
  MAKER_FILL: "Maker fill",
  TAKER_FILL: "Taker fill",
  SETTLEMENT: "Settlement",
  EXERCISE: "Exercise",
  LIQUIDATION: "Liquidation",
  FUNDING: "Funding",
  SOLVER_REWARD: "Solver reward",
  KEEPER_REWARD: "Keeper reward",
  LIQUIDITY_INCENTIVE: "Liquidity incentive",
};

export function feeActionName(id: string): FeeActionName | null {
  const needle = id.toLowerCase();
  for (const [name, hash] of Object.entries(FEE_ACTIONS)) if (hash === needle) return name as FeeActionName;
  return null;
}

export const FEE_MODELS = {
  FLAT_PER_ACTION: modelId("FlatPerAction"),
  AD_VALOREM: modelId("AdValorem"),
  MAKER_TAKER: modelId("MakerTaker"),
  VOLUME_TIERED: modelId("VolumeTiered"),
} as const;
export type FeeModelName = keyof typeof FEE_MODELS | "UNRECOGNIZED";

export function feeModelName(id: string): FeeModelName {
  const needle = id.toLowerCase();
  for (const [name, hash] of Object.entries(FEE_MODELS)) if (hash === needle) return name as FeeModelName;
  return "UNRECOGNIZED";
}

/** RegistryStatus, canonicalized from the Solidity enum. Unspecified is the never-registered sentinel. */
export const REGISTRY_STATUS = { 0: "UNSPECIFIED", 1: "ACTIVE", 2: "PAUSED", 3: "DEPRECATED" } as const;
export type RegistryStatusName = (typeof REGISTRY_STATUS)[keyof typeof REGISTRY_STATUS];

export function registryStatusName(value: number): RegistryStatusName {
  const name = REGISTRY_STATUS[value as keyof typeof REGISTRY_STATUS];
  if (!name) throw new Error(`UNRECOGNIZED_REGISTRY_STATUS_${value}`);
  return name;
}

const feeScheduleDefinitionComponents = [
  { name: "namespaceId", type: "bytes32" },
  { name: "scheduleKey", type: "bytes32" },
  { name: "feeModelId", type: "bytes32" },
  { name: "settlementAssetId", type: "bytes32" },
  { name: "settlementAssetVersion", type: "uint32" },
  { name: "feeRulesHash", type: "bytes32" },
  { name: "recipientsHash", type: "bytes32" },
  { name: "maxChargeRatePpm", type: "uint32" },
  { name: "maxRebateRatePpm", type: "uint32" },
  { name: "maxFlatChargeBaseUnits", type: "uint128" },
  { name: "maxFlatRebateBaseUnits", type: "uint128" },
  { name: "evidenceHash", type: "bytes32" },
] as const;

export const feeTierComponents = [
  { name: "minimumVolumeMinor", type: "uint128" },
  { name: "chargeRatePpm", type: "uint32" },
  { name: "rebateRatePpm", type: "uint32" },
  { name: "flatChargeMinor", type: "uint128" },
  { name: "flatRebateMinor", type: "uint128" },
] as const;

export const feeRuleComponents = [
  { name: "actionId", type: "bytes32" },
  { name: "requiresOpenSchedule", type: "bool" },
  { name: "chargeRatePpm", type: "uint32" },
  { name: "rebateRatePpm", type: "uint32" },
  { name: "flatChargeMinor", type: "uint128" },
  { name: "flatRebateMinor", type: "uint128" },
  { name: "tiers", type: "tuple[]", components: feeTierComponents },
] as const;

export const feeRecipientSetComponents = [
  { name: "remainderPolicyId", type: "bytes32" },
  { name: "remainderRecipientIndex", type: "uint8" },
  {
    name: "recipients",
    type: "tuple[]",
    components: [
      { name: "accountId", type: "bytes32" },
      { name: "sharePpm", type: "uint32" },
    ],
  },
] as const;

export const feeScheduleRegistryAbi = [
  { type: "function", name: "activeVersion", stateMutability: "view", inputs: [{ name: "feeScheduleId", type: "bytes32" }], outputs: [{ name: "", type: "uint32" }] },
  { type: "function", name: "latestVersion", stateMutability: "view", inputs: [{ name: "feeScheduleId", type: "bytes32" }], outputs: [{ name: "", type: "uint32" }] },
  {
    type: "function",
    name: "statusOf",
    stateMutability: "view",
    inputs: [
      { name: "feeScheduleId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "getFeeSchedule",
    stateMutability: "view",
    inputs: [
      { name: "feeScheduleId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [
      {
        name: "record",
        type: "tuple",
        components: [
          { name: "definition", type: "tuple", components: feeScheduleDefinitionComponents },
          { name: "definitionHash", type: "bytes32" },
          { name: "versionHash", type: "bytes32" },
          { name: "version", type: "uint32" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "registerFeeSchedule",
    stateMutability: "nonpayable",
    inputs: [{ name: "definition", type: "tuple", components: feeScheduleDefinitionComponents }],
    outputs: [
      { name: "feeScheduleId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "activateFeeSchedule",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feeScheduleId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pauseFeeSchedule",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feeScheduleId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [],
  },
  { type: "function", name: "FEE_SCHEDULE_QUALIFIER_ROLE", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "FEE_SCHEDULE_STATUS_MANAGER_ROLE", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bytes32" }] },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "FeeScheduleRegistered",
    inputs: [
      { name: "feeScheduleId", type: "bytes32", indexed: true },
      { name: "version", type: "uint32", indexed: true },
      { name: "versionHash", type: "bytes32", indexed: true },
      { name: "definitionHash", type: "bytes32", indexed: false },
      { name: "definition", type: "tuple", indexed: false, components: feeScheduleDefinitionComponents },
      { name: "chainId", type: "uint256", indexed: false },
      { name: "initialStatus", type: "uint8", indexed: false },
      { name: "operator", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeeScheduleStatusChanged",
    inputs: [
      { name: "feeScheduleId", type: "bytes32", indexed: true },
      { name: "version", type: "uint32", indexed: true },
      { name: "previousStatus", type: "uint8", indexed: false },
      { name: "newStatus", type: "uint8", indexed: false },
      { name: "operator", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "FeeScheduleActiveVersionChanged",
    inputs: [
      { name: "feeScheduleId", type: "bytes32", indexed: true },
      { name: "previousVersion", type: "uint32", indexed: false },
      { name: "newVersion", type: "uint32", indexed: false },
      { name: "operator", type: "address", indexed: true },
    ],
  },
  { type: "error", name: "UnknownFeeScheduleVersion", inputs: [{ name: "feeScheduleId", type: "bytes32" }, { name: "version", type: "uint32" }] },
  { type: "error", name: "DuplicateFeeScheduleDefinition", inputs: [{ name: "feeScheduleId", type: "bytes32" }, { name: "definitionHash", type: "bytes32" }, { name: "existingVersion", type: "uint32" }] },
  { type: "error", name: "InvalidFeeScheduleTransition", inputs: [{ name: "feeScheduleId", type: "bytes32" }, { name: "version", type: "uint32" }, { name: "previousStatus", type: "uint8" }, { name: "newStatus", type: "uint8" }] },
  { type: "error", name: "AnotherFeeScheduleVersionActive", inputs: [{ name: "feeScheduleId", type: "bytes32" }, { name: "activeVersion", type: "uint32" }] },
  { type: "error", name: "SettlementAssetDependencyNotOpen", inputs: [{ name: "settlementAssetId", type: "bytes32" }, { name: "settlementAssetVersion", type: "uint32" }] },
  { type: "error", name: "AccessControlUnauthorizedAccount", inputs: [{ name: "account", type: "address" }, { name: "neededRole", type: "bytes32" }] },
] as const;

export const fundedFeeEngineAbi = [
  { type: "function", name: "feeScheduleRegistry", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "witnessInstalled",
    stateMutability: "view",
    inputs: [
      { name: "feeScheduleId", type: "bytes32" },
      { name: "feeScheduleVersion", type: "uint32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getScheduleWitness",
    stateMutability: "view",
    inputs: [
      { name: "feeScheduleId", type: "bytes32" },
      { name: "feeScheduleVersion", type: "uint32" },
    ],
    outputs: [
      { name: "rules", type: "tuple[]", components: feeRuleComponents },
      { name: "recipients", type: "tuple", components: feeRecipientSetComponents },
    ],
  },
  {
    type: "function",
    name: "installScheduleWitness",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feeScheduleId", type: "bytes32" },
      { name: "feeScheduleVersion", type: "uint32" },
      { name: "rules", type: "tuple[]", components: feeRuleComponents },
      { name: "recipients", type: "tuple", components: feeRecipientSetComponents },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "FeeActionConsumed",
    inputs: [
      { name: "consumptionId", type: "bytes32", indexed: true },
      { name: "parentActionId", type: "bytes32", indexed: true },
      { name: "actionId", type: "bytes32", indexed: true },
      { name: "feeScheduleId", type: "bytes32", indexed: false },
      { name: "feeScheduleVersion", type: "uint32", indexed: false },
      { name: "notionalMinor", type: "uint128", indexed: false },
      { name: "qualifyingVolumeMinor", type: "uint128", indexed: false },
      { name: "maxFeeMinor", type: "uint128", indexed: false },
      {
        name: "computation",
        type: "tuple",
        indexed: false,
        components: [
          { name: "chargeMinor", type: "uint128" },
          { name: "rebateMinor", type: "uint128" },
          { name: "chargeRatePpm", type: "uint32" },
          { name: "rebateRatePpm", type: "uint32" },
          { name: "flatChargeMinor", type: "uint128" },
          { name: "flatRebateMinor", type: "uint128" },
          { name: "tierIndex", type: "uint16" },
        ],
      },
      { name: "resultHash", type: "bytes32", indexed: false },
      { name: "consumer", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeeLedgerEntryRecorded",
    inputs: [
      { name: "consumptionId", type: "bytes32", indexed: true },
      { name: "kind", type: "uint8", indexed: true },
      { name: "actionId", type: "bytes32", indexed: true },
      { name: "accountId", type: "bytes32", indexed: false },
      { name: "amountMinor", type: "int256", indexed: false },
    ],
  },
  { type: "error", name: "FeeWitnessAlreadyInstalled", inputs: [{ name: "feeScheduleId", type: "bytes32" }, { name: "version", type: "uint32" }] },
  { type: "error", name: "FeeRulesCommitmentMismatch", inputs: [{ name: "expected", type: "bytes32" }, { name: "actual", type: "bytes32" }] },
  { type: "error", name: "FeeRecipientsCommitmentMismatch", inputs: [{ name: "expected", type: "bytes32" }, { name: "actual", type: "bytes32" }] },
  { type: "error", name: "UnknownFeeRecipient", inputs: [{ name: "accountId", type: "bytes32" }] },
  { type: "error", name: "InvalidRuleForModel", inputs: [{ name: "index", type: "uint256" }, { name: "feeModelId", type: "bytes32" }] },
  { type: "error", name: "FeeRateExceedsSchedule", inputs: [{ name: "ruleIndex", type: "uint256" }, { name: "tierIndex", type: "uint256" }, { name: "actual", type: "uint32" }, { name: "maximum", type: "uint32" }, { name: "rebate", type: "bool" }] },
] as const;

/** One fee action's charge terms as FundedFeeEngine applies them at clearing. */
export interface FeeActionTerms {
  /** Charge rate against PPM_DENOMINATOR. */
  chargeRatePpm: number;
  /** Flat charge per action, in settlement minor units. */
  flatChargeMinor: number;
  rebateRatePpm: number;
  flatRebateMinor: number;
}

export interface FeeScheduleVersionView {
  feeScheduleId: Hex;
  version: number;
  status: RegistryStatusName;
  feeModel: FeeModelName;
  definitionHash: Hex;
  versionHash: Hex;
  feeRulesHash: Hex;
  recipientsHash: Hex;
  maxChargeRatePpm: number;
  maxRebateRatePpm: number;
  /** Whether FundedFeeEngine holds the rule witness; without it the version cannot charge. */
  witnessInstalled: boolean;
  maker: FeeActionTerms | null;
  taker: FeeActionTerms | null;
  /** Fee recipient accounts and their share of every charge, from the installed witness. */
  recipients: { accountId: Hex; sharePpm: number }[];
}

/** The versions an order on one catalog market signs right now. */
export interface MarketTradingVersions {
  marketKey: string;
  seriesId: Hex;
  /** The series' active version: an order's `targetVersion`, and part of its book id. */
  seriesVersion: number;
  /** The market version that series version is registered on. */
  marketVersion: number;
  /** The fee schedule version that market version names: an order's `feeScheduleVersion`, and part of its book id. */
  feeScheduleVersion: number;
  /** Whether the market's fee schedule version is the registry's active one, so an order on it can clear. */
  tradable: boolean;
}

export interface ActiveFeeSchedule {
  feeScheduleId: Hex;
  /** The version orders and quotes sign. Zero only when the chain reports no active version and none is known. */
  version: number;
  latestVersion: number;
  /** Whether the registry names this version as its active pointer (false when paused or unreadable). */
  active: boolean;
  feeModel: FeeModelName;
  maker: FeeActionTerms;
  taker: FeeActionTerms;
  makerFeeRatePpm: number;
  takerFeeRatePpm: number;
  makerFeeBps: number;
  takerFeeBps: number;
  maxChargeRatePpm: number | null;
  /** CHAIN when read from the registry and the fee engine; RUNTIME when the chain was unreachable. */
  source: "CHAIN" | "RUNTIME";
  /** Milliseconds since the epoch at which this reading was taken. */
  readAt: number;
  /** Per catalog market, keyed by lowercase series id: the versions its orders sign. */
  markets: Record<string, MarketTradingVersions>;
}

type RuntimeFeeFields = Pick<SetrynRuntime, "rpcUrl" | "chainId" | "fundedFeeEngine" | "feeScheduleId"> &
  Partial<
    Pick<
      SetrynRuntime,
      "feeScheduleRegistry" | "feeScheduleVersion" | "makerFeeRatePpm" | "takerFeeRatePpm" | "seriesRegistry" | "marketRegistry"
    >
  > & { markets?: readonly Pick<SetrynRuntimeMarket, "marketKey" | "marketId" | "seriesId" | "seriesVersion" | "marketVersion">[] };

type ReadClient = Pick<PublicClient, "readContract">;

interface CacheEntry {
  at: number;
  value: Promise<ActiveFeeSchedule>;
}

function cache(): Map<string, CacheEntry> {
  const holder = globalThis as unknown as Record<symbol, Map<string, CacheEntry> | undefined>;
  holder[CACHE_KEY] ??= new Map();
  return holder[CACHE_KEY];
}

function cacheKey(setryn: RuntimeFeeFields): string {
  return `${setryn.chainId}:${setryn.rpcUrl}:${setryn.fundedFeeEngine.toLowerCase()}:${setryn.feeScheduleId.toLowerCase()}`;
}

/** Drops cached readings, for example right after a fee schedule change. */
export function invalidateFeeScheduleCache(): void {
  cache().clear();
}

const clients = new Map<string, ReadClient>();

function clientFor(rpcUrl: string, chainId: number): ReadClient {
  const key = `${chainId}:${rpcUrl}`;
  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({ transport: serverReadTransport(rpcUrl, chainId, { timeout: 8_000 }) });
    clients.set(key, client);
  }
  return client;
}

export function feeRateBps(ratePpm: number): number {
  return ratePpm / 100;
}

/** The charge FundedFeeEngine computes for one action: flat plus the rate on the notional, rounded up. */
export function feeChargeMinor(terms: Pick<FeeActionTerms, "chargeRatePpm" | "flatChargeMinor">, notionalMinor: bigint): bigint {
  const notional = notionalMinor < BigInt(0) ? -notionalMinor : notionalMinor;
  const rate = BigInt(terms.chargeRatePpm);
  const proportional = notional === BigInt(0) || rate === BigInt(0)
    ? BigInt(0)
    : (notional * rate - BigInt(1)) / BigInt(PPM_DENOMINATOR) + BigInt(1);
  return BigInt(terms.flatChargeMinor) + proportional;
}

/** Charge in USD for a consideration in USD, for estimates; the chain charges in minor units with feeChargeMinor. */
export function feeChargeUsd(terms: Pick<FeeActionTerms, "chargeRatePpm" | "flatChargeMinor">, considerationUsd: number): number {
  if (!Number.isFinite(considerationUsd)) return 0;
  return (Math.abs(considerationUsd) * terms.chargeRatePpm) / PPM_DENOMINATOR + terms.flatChargeMinor / 1_000_000;
}

function runtimeTerms(ratePpm: number | undefined): FeeActionTerms {
  return { chargeRatePpm: ratePpm ?? 0, flatChargeMinor: 0, rebateRatePpm: 0, flatRebateMinor: 0 };
}

function runtimeMarkets(setryn: RuntimeFeeFields, feeScheduleVersion: number): Record<string, MarketTradingVersions> {
  return Object.fromEntries(
    (setryn.markets ?? []).map((market) => [
      market.seriesId.toLowerCase(),
      {
        marketKey: market.marketKey,
        seriesId: market.seriesId,
        seriesVersion: market.seriesVersion ?? 1,
        marketVersion: market.marketVersion ?? 1,
        feeScheduleVersion,
        tradable: true,
      },
    ]),
  );
}

function fromRuntime(setryn: RuntimeFeeFields): ActiveFeeSchedule {
  const maker = runtimeTerms(setryn.makerFeeRatePpm);
  const taker = runtimeTerms(setryn.takerFeeRatePpm);
  const version = setryn.feeScheduleVersion ?? 1;
  return {
    markets: runtimeMarkets(setryn, version),
    feeScheduleId: setryn.feeScheduleId,
    version,
    latestVersion: version,
    active: false,
    feeModel: "MAKER_TAKER",
    maker,
    taker,
    makerFeeRatePpm: maker.chargeRatePpm,
    takerFeeRatePpm: taker.chargeRatePpm,
    makerFeeBps: feeRateBps(maker.chargeRatePpm),
    takerFeeBps: feeRateBps(taker.chargeRatePpm),
    maxChargeRatePpm: null,
    source: "RUNTIME",
    readAt: Date.now(),
  };
}

type WitnessRule = {
  actionId: Hex;
  chargeRatePpm: number;
  rebateRatePpm: number;
  flatChargeMinor: bigint;
  flatRebateMinor: bigint;
  tiers: readonly { chargeRatePpm: number; rebateRatePpm: number; flatChargeMinor: bigint; flatRebateMinor: bigint }[];
};

/** The terms clearing applies for one action: the rule itself, or its first tier under the volume-tiered model. */
function actionTerms(rules: readonly WitnessRule[], action: Hex, model: FeeModelName): FeeActionTerms | null {
  const rule = rules.find((candidate) => candidate.actionId.toLowerCase() === action);
  if (!rule) return null;
  const source = model === "VOLUME_TIERED" ? rule.tiers[0] : rule;
  if (!source) return null;
  return {
    chargeRatePpm: Number(source.chargeRatePpm),
    flatChargeMinor: Number(source.flatChargeMinor),
    rebateRatePpm: Number(source.rebateRatePpm),
    flatRebateMinor: Number(source.flatRebateMinor),
  };
}

export async function resolveFeeScheduleRegistry(client: ReadClient, setryn: RuntimeFeeFields): Promise<Address> {
  if (setryn.feeScheduleRegistry) return setryn.feeScheduleRegistry;
  return client.readContract({ address: setryn.fundedFeeEngine, abi: fundedFeeEngineAbi, functionName: "feeScheduleRegistry" });
}

/** One registered version: its definition from the registry and its concrete rules from the fee engine's witness. */
export async function readFeeScheduleVersion(
  client: ReadClient,
  setryn: RuntimeFeeFields,
  version: number,
  registry?: Address,
): Promise<FeeScheduleVersionView> {
  const registryAddress = registry ?? (await resolveFeeScheduleRegistry(client, setryn));
  const [record, installed] = await Promise.all([
    client.readContract({
      address: registryAddress,
      abi: feeScheduleRegistryAbi,
      functionName: "getFeeSchedule",
      args: [setryn.feeScheduleId, version],
    }),
    client.readContract({
      address: setryn.fundedFeeEngine,
      abi: fundedFeeEngineAbi,
      functionName: "witnessInstalled",
      args: [setryn.feeScheduleId, version],
    }),
  ]);
  const model = feeModelName(record.definition.feeModelId);
  let rules: readonly WitnessRule[] = [];
  let recipients: { accountId: Hex; sharePpm: number }[] = [];
  if (installed) {
    const [witnessRules, witnessRecipients] = await client.readContract({
      address: setryn.fundedFeeEngine,
      abi: fundedFeeEngineAbi,
      functionName: "getScheduleWitness",
      args: [setryn.feeScheduleId, version],
    });
    rules = witnessRules as readonly WitnessRule[];
    recipients = witnessRecipients.recipients.map((recipient) => ({ accountId: recipient.accountId, sharePpm: Number(recipient.sharePpm) }));
  }
  return {
    feeScheduleId: setryn.feeScheduleId,
    version: Number(record.version),
    status: registryStatusName(Number(record.status)),
    feeModel: model,
    definitionHash: record.definitionHash,
    versionHash: record.versionHash,
    feeRulesHash: record.definition.feeRulesHash,
    recipientsHash: record.definition.recipientsHash,
    maxChargeRatePpm: Number(record.definition.maxChargeRatePpm),
    maxRebateRatePpm: Number(record.definition.maxRebateRatePpm),
    witnessInstalled: installed,
    maker: actionTerms(rules, FEE_ACTIONS.MAKER_FILL, model),
    taker: actionTerms(rules, FEE_ACTIONS.TAKER_FILL, model),
    recipients,
  };
}

async function readFromChain(client: ReadClient, setryn: RuntimeFeeFields): Promise<ActiveFeeSchedule> {
  const registry = await resolveFeeScheduleRegistry(client, setryn);
  const [activeVersion, latestVersion] = await Promise.all([
    client.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "activeVersion", args: [setryn.feeScheduleId] }),
    client.readContract({ address: registry, abi: feeScheduleRegistryAbi, functionName: "latestVersion", args: [setryn.feeScheduleId] }),
  ]);
  const active = Number(activeVersion);
  const latest = Number(latestVersion);
  if (latest === 0) throw new Error("FEE_SCHEDULE_NOT_REGISTERED");
  // With no active version nothing can clear; the most recent version is shown so estimates stay honest about it.
  const version = active !== 0 ? active : latest;
  const [view, markets] = await Promise.all([
    readFeeScheduleVersion(client, setryn, version, registry),
    readMarketVersions(client, setryn, active),
  ]);
  if (!view.maker || !view.taker) throw new Error("FEE_SCHEDULE_WITNESS_MISSING");
  return {
    markets,
    feeScheduleId: setryn.feeScheduleId,
    version,
    latestVersion: latest,
    active: active !== 0,
    feeModel: view.feeModel,
    maker: view.maker,
    taker: view.taker,
    makerFeeRatePpm: view.maker.chargeRatePpm,
    takerFeeRatePpm: view.taker.chargeRatePpm,
    makerFeeBps: feeRateBps(view.maker.chargeRatePpm),
    takerFeeBps: feeRateBps(view.taker.chargeRatePpm),
    maxChargeRatePpm: view.maxChargeRatePpm,
    source: "CHAIN",
    readAt: Date.now(),
  };
}

const seriesVersionAbi = [
  { type: "function", name: "activeVersion", stateMutability: "view", inputs: [{ name: "seriesId", type: "bytes32" }], outputs: [{ name: "", type: "uint32" }] },
  { type: "function", name: "latestVersion", stateMutability: "view", inputs: [{ name: "seriesId", type: "bytes32" }], outputs: [{ name: "", type: "uint32" }] },
  { type: "function", name: "marketRegistry", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "getSeries",
    stateMutability: "view",
    inputs: [
      { name: "seriesId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [
      {
        name: "record",
        type: "tuple",
        components: [
          {
            name: "definition",
            type: "tuple",
            components: [
              { name: "namespaceId", type: "bytes32" },
              { name: "seriesKey", type: "bytes32" },
              { name: "marketId", type: "bytes32" },
              { name: "marketVersion", type: "uint32" },
            ],
          },
        ],
      },
    ],
  },
] as const;

/*
 * Only the leading fields of each struct are declared: a dynamic-free tuple decodes by position, so the prefix reads
 * exactly and the remaining words are ignored. SeriesDefinition and MarketDefinition are both all static types.
 */
const marketVersionAbi = [
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [
      {
        name: "record",
        type: "tuple",
        components: [
          {
            name: "definition",
            type: "tuple",
            components: [
              { name: "namespaceId", type: "bytes32" },
              { name: "marketKey", type: "bytes32" },
              { name: "baseAssetId", type: "bytes32" },
              { name: "quoteAssetId", type: "bytes32" },
              { name: "settlementAssetId", type: "bytes32" },
              { name: "settlementAssetVersion", type: "uint32" },
              { name: "markBenchmarkId", type: "bytes32" },
              { name: "markBenchmarkVersion", type: "uint32" },
              { name: "tradingCalendarId", type: "bytes32" },
              { name: "tradingCalendarVersion", type: "uint32" },
              { name: "tradingSessionId", type: "bytes32" },
              { name: "tradingSessionVersion", type: "uint32" },
              { name: "riskDomainId", type: "bytes32" },
              { name: "riskDomainVersion", type: "uint32" },
              { name: "feeScheduleId", type: "bytes32" },
              { name: "feeScheduleVersion", type: "uint32" },
            ],
          },
        ],
      },
    ],
  },
] as const;

/**
 * Every listed market's active series version, the market version it sits on, and that market version's fee schedule
 * version. A market whose series has no active version keeps its latest one, marked not tradable.
 */
async function readMarketVersions(client: ReadClient, setryn: RuntimeFeeFields, activeFeeVersion: number): Promise<Record<string, MarketTradingVersions>> {
  const markets = setryn.markets ?? [];
  if (markets.length === 0) return {};
  if (!setryn.seriesRegistry) return runtimeMarkets(setryn, activeFeeVersion);
  const seriesRegistry = setryn.seriesRegistry;
  const marketRegistry =
    setryn.marketRegistry ?? (await client.readContract({ address: seriesRegistry, abi: seriesVersionAbi, functionName: "marketRegistry" }));
  const rows = await Promise.all(
    markets.map(async (market): Promise<[string, MarketTradingVersions]> => {
      const [active, latest] = await Promise.all([
        client.readContract({ address: seriesRegistry, abi: seriesVersionAbi, functionName: "activeVersion", args: [market.seriesId] }),
        client.readContract({ address: seriesRegistry, abi: seriesVersionAbi, functionName: "latestVersion", args: [market.seriesId] }),
      ]);
      const seriesVersion = Number(active) || Number(latest) || (market.seriesVersion ?? 1);
      const series = await client.readContract({
        address: seriesRegistry,
        abi: seriesVersionAbi,
        functionName: "getSeries",
        args: [market.seriesId, seriesVersion],
      });
      const marketVersion = Number(series.definition.marketVersion);
      const record = await client.readContract({
        address: marketRegistry,
        abi: marketVersionAbi,
        functionName: "getMarket",
        args: [series.definition.marketId, marketVersion],
      });
      const feeScheduleVersion = Number(record.definition.feeScheduleVersion);
      return [
        market.seriesId.toLowerCase(),
        {
          marketKey: market.marketKey,
          seriesId: market.seriesId,
          seriesVersion,
          marketVersion,
          feeScheduleVersion,
          tradable: Number(active) !== 0 && activeFeeVersion !== 0 && feeScheduleVersion === activeFeeVersion,
        },
      ];
    }),
  );
  return Object.fromEntries(rows);
}

/**
 * The versions an order on `seriesId` signs under this reading. A series the reading does not list signs version 1
 * under the active fee schedule, as a deployment without re-versioned markets does.
 */
export function marketTradingVersions(fees: Pick<ActiveFeeSchedule, "markets" | "version">, seriesId: string): MarketTradingVersions {
  return (
    fees.markets[seriesId.toLowerCase()] ?? {
      marketKey: "",
      seriesId: seriesId as Hex,
      seriesVersion: 1,
      marketVersion: 1,
      feeScheduleVersion: fees.version,
      tradable: true,
    }
  );
}

/**
 * The active fee schedule, cached for `maxAgeMs` (15 s by default; 0 forces a fresh read). A failed chain read falls
 * back to the runtime's fields rather than throwing, and is not cached, so the next call tries the chain again.
 */
export function readActiveFeeSchedule(
  setryn: RuntimeFeeFields,
  options: { client?: ReadClient; maxAgeMs?: number; fallback?: boolean } = {},
): Promise<ActiveFeeSchedule> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const key = cacheKey(setryn);
  const entries = cache();
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at <= maxAgeMs) return hit.value;
  const client = options.client ?? clientFor(setryn.rpcUrl, setryn.chainId);
  const value = readFromChain(client, setryn).catch((error: unknown) => {
    if (entries.get(key)?.value === value) entries.delete(key);
    if (options.fallback === false) throw error;
    return fromRuntime(setryn);
  });
  entries.set(key, { at: Date.now(), value });
  return value;
}

/** The fee cap an order signs so the charge under `schedule` fits: the larger of the maker and taker charges. */
export function orderFeeCapMinor(schedule: Pick<ActiveFeeSchedule, "maker" | "taker">, considerationMinor: bigint, role: "MAKER" | "TAKER" | "EITHER"): bigint {
  const maker = feeChargeMinor(schedule.maker, considerationMinor);
  const taker = feeChargeMinor(schedule.taker, considerationMinor);
  const cap = role === "MAKER" ? maker : role === "TAKER" ? taker : maker > taker ? maker : taker;
  return cap < BigInt(1) ? BigInt(1) : cap;
}
