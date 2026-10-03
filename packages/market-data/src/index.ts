import type { Address, Hex, PublicClient } from "viem";

/*
 * Chain decoding shared by the web app's live feed and the market-data ingester (services/market-data), so a Chainlink
 * round or a fill is read one way everywhere: the reference feeds and their rounds (Arbitrum One, read-only), and the
 * clearing and position events behind fills and open interest. Nothing here writes to any chain.
 */

/* ------------------------------------------------------------------------------------------------------------------ */
/* Chainlink reference feeds                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------ */

export const REFERENCE_CHAIN_ID = 42161;

/** Underlying to its Chainlink aggregator proxy on Arbitrum One (8 decimals each, verified 2026-10-01). */
export const REFERENCE_FEEDS: Readonly<Record<string, Address>> = {
  BTC: "0x6ce185860a4963106506C203335A2910413708e9",
  ETH: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
  ARB: "0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6",
  "EUR/USD": "0xA14d53bC1F1c0F31B4aA3BD109344E5009051a84",
  "XAU/USD": "0x1F954Dc24a49708C26E0C1777f16750B5C6d5a2c",
};

/**
 * How long a feed's reading may go without a new round before it is stale: each feed's heartbeat (24 hours on these
 * Arbitrum One feeds) plus an hour of grace. A chart shows a stale stretch as a gap rather than carrying the old reading.
 */
export const REFERENCE_STALE_AFTER_SECONDS: Readonly<Record<string, number>> = {
  BTC: 90_000,
  ETH: 90_000,
  ARB: 90_000,
  "EUR/USD": 90_000,
  "XAU/USD": 90_000,
};

/** Proxy round ids carry the phase in the high 16 bits and the phase aggregator's round in the low 64. */
export const PHASE_SIZE = BigInt("18446744073709551616");

export function phaseOf(roundId: bigint): number {
  return Number(roundId / PHASE_SIZE);
}

export function aggregatorRoundOf(roundId: bigint): bigint {
  return roundId % PHASE_SIZE;
}

const roundOutputs = [
  { name: "roundId", type: "uint80" },
  { name: "answer", type: "int256" },
  { name: "startedAt", type: "uint256" },
  { name: "updatedAt", type: "uint256" },
  { name: "answeredInRound", type: "uint80" },
] as const;

export const aggregatorProxyAbi = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: roundOutputs },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: roundOutputs,
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function",
    name: "phaseAggregators",
    stateMutability: "view",
    inputs: [{ name: "phaseId", type: "uint16" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const phaseAggregatorAbi = [
  { type: "function", name: "latestRound", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

export interface ChainlinkRound {
  roundId: bigint;
  answer: bigint;
  startedAt: number;
  updatedAt: number;
  answeredInRound: bigint;
}

type RawRound = readonly [bigint, bigint, bigint, bigint, bigint];

/** A round with an answer; a round never published (zero time) or without a positive answer is not a reading. */
export function roundOf(raw: RawRound): ChainlinkRound | null {
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = raw;
  if (answer <= BigInt(0) || updatedAt === BigInt(0)) return null;
  return { roundId, answer, startedAt: Number(startedAt), updatedAt: Number(updatedAt), answeredInRound };
}

export function roundPrice(round: Pick<ChainlinkRound, "answer">, decimals = 8): number {
  return Number(round.answer) / 10 ** decimals;
}

export async function readLatestRound(client: PublicClient, feed: Address): Promise<ChainlinkRound | null> {
  const raw = (await client.readContract({ address: feed, abi: aggregatorProxyAbi, functionName: "latestRoundData" })) as RawRound;
  return roundOf(raw);
}

/**
 * Rounds `from` down to `to` (inclusive, `from` >= `to`, one phase) in multicall batches, newest first. A round that
 * cannot be read is left out; the caller sees it as a hole.
 */
export async function readRoundRange(client: PublicClient, feed: Address, from: bigint, to: bigint, batch = 250): Promise<ChainlinkRound[]> {
  const rounds: ChainlinkRound[] = [];
  const step = BigInt(batch);
  for (let high = from; high >= to; high -= step) {
    const ids: bigint[] = [];
    for (let id = high; id >= to && id > high - step; id -= BigInt(1)) ids.push(id);
    const results = await client.multicall({
      contracts: ids.map((id) => ({ address: feed, abi: aggregatorProxyAbi, functionName: "getRoundData", args: [id] }) as const),
      allowFailure: true,
    });
    for (const result of results) {
      if (result.status !== "success") continue;
      const round = roundOf(result.result as RawRound);
      if (round) rounds.push(round);
    }
  }
  return rounds;
}

/** The proxy round id of the last round of an earlier phase, or null when the proxy has no aggregator for it. */
export async function phaseLastRound(client: PublicClient, feed: Address, phaseId: number): Promise<bigint | null> {
  if (phaseId < 1) return null;
  const aggregator = (await client.readContract({
    address: feed,
    abi: aggregatorProxyAbi,
    functionName: "phaseAggregators",
    args: [phaseId],
  })) as Address;
  if (/^0x0{40}$/i.test(aggregator)) return null;
  const latest = (await client.readContract({ address: aggregator, abi: phaseAggregatorAbi, functionName: "latestRound" })) as bigint;
  return latest > BigInt(0) ? BigInt(phaseId) * PHASE_SIZE + latest : null;
}

export function referenceStream(chainId: number, feed: string): string {
  return `reference:${chainId}:${feed.toLowerCase()}`;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Clearing and position events                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------ */

export const fillRecordComponents = [
  { name: "fillId", type: "bytes32" },
  { name: "takerOrderHash", type: "bytes32" },
  { name: "makerOrderHash", type: "bytes32" },
  { name: "targetId", type: "bytes32" },
  { name: "witnessHash", type: "bytes32" },
  { name: "executionModeId", type: "bytes32" },
  { name: "channelConsumptionId", type: "bytes32" },
  { name: "routeCommitment", type: "bytes32" },
  { name: "channelSource", type: "address" },
  { name: "channelKind", type: "uint8" },
  { name: "settlementAssetId", type: "bytes32" },
  { name: "buyerAccountId", type: "bytes32" },
  { name: "sellerAccountId", type: "bytes32" },
  { name: "makerFeeResultHash", type: "bytes32" },
  { name: "takerFeeResultHash", type: "bytes32" },
  { name: "targetVersion", type: "uint32" },
  { name: "settlementAssetVersion", type: "uint32" },
  { name: "clearedAt", type: "uint64" },
  { name: "fillLots", type: "uint128" },
  { name: "takerCumulativeLots", type: "uint128" },
  { name: "makerCumulativeLots", type: "uint128" },
  { name: "executionPriceTicks", type: "int128" },
  { name: "considerationMinor", type: "int256" },
  { name: "makerFeeChargeMinor", type: "uint128" },
  { name: "makerFeeRebateMinor", type: "uint128" },
  { name: "takerFeeChargeMinor", type: "uint128" },
  { name: "takerFeeRebateMinor", type: "uint128" },
  { name: "positionCount", type: "uint16" },
  { name: "isPackage", type: "bool" },
] as const;

/**
 * Every state-changing event the market data projects: clearing fills (AtomicClearingEngine) and the position quantities
 * behind open interest (PositionEngine).
 */
export const marketFeedEventsAbi = [
  {
    type: "event",
    name: "FillCleared",
    inputs: [
      { name: "fillId", type: "bytes32", indexed: true },
      { name: "record", type: "tuple", indexed: false, components: fillRecordComponents },
      { name: "submitter", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "PositionCreated",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "fillIdentity", type: "bytes32", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "seriesVersion", type: "uint32", indexed: false },
      { name: "longAccountId", type: "bytes32", indexed: false },
      { name: "shortAccountId", type: "bytes32", indexed: false },
      { name: "lots", type: "uint128", indexed: false },
      { name: "longReservationId", type: "bytes32", indexed: false },
      { name: "shortReservationId", type: "bytes32", indexed: false },
      { name: "clearingEngine", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PositionQuantityChanged",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "remainingLots", type: "uint128", indexed: false },
      { name: "exercisedLots", type: "uint128", indexed: false },
      { name: "closedLots", type: "uint128", indexed: false },
      { name: "lifecycleNonce", type: "uint64", indexed: false },
      { name: "transitionReference", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "PositionStatusChanged",
    inputs: [
      { name: "positionId", type: "bytes32", indexed: true },
      { name: "previousStatus", type: "uint8", indexed: false },
      { name: "newStatus", type: "uint8", indexed: false },
      { name: "transitionReference", type: "bytes32", indexed: true },
      { name: "caller", type: "address", indexed: false },
    ],
  },
] as const;

export type FillChannel = "BOOK" | "RFQ" | "AUCTION" | "UNSPECIFIED";

/** ClearingChannelKind, canonicalized: 1 Direct, 2 PrivateRfq, 3 SealedAuction. Anything else is unspecified. */
export function clearingChannel(kind: number): FillChannel {
  return kind === 1 ? "BOOK" : kind === 2 ? "RFQ" : kind === 3 ? "AUCTION" : "UNSPECIFIED";
}

/** PositionStatus values that still carry open lots: 1 Live, 2 Fixing, 3 SettlementReady. Every other status is closed. */
export function positionStatusOpen(status: number): boolean {
  return status === 1 || status === 2 || status === 3;
}

/**
 * The contract set a chain stream belongs to: chain id and the clearing, position and book addresses. A redeployment is
 * a new key, so its history starts over instead of mixing with the previous one.
 */
export function deploymentKey(deployment: {
  chainId: number;
  atomicClearingEngine: string;
  positionEngine: string;
  publicOrderBook: string;
}): string {
  return [deployment.chainId, deployment.atomicClearingEngine, deployment.positionEngine, deployment.publicOrderBook].join(":").toLowerCase();
}

export function fillStream(key: string): string {
  return `fills:${key}`;
}

/**
 * The block a deployment's chain stream starts at, one rule for the app and the ingester: the runtime's own
 * `deploymentBlock` when it records one, else the earliest block any manifest entry (contract, linked library, phase 2
 * deployment) was deployed at. Null when neither says.
 */
export function deploymentStartBlock(runtime: { deploymentBlock?: unknown }, manifest: unknown): number | null {
  if (typeof runtime.deploymentBlock === "number" && Number.isSafeInteger(runtime.deploymentBlock) && runtime.deploymentBlock >= 0) {
    return runtime.deploymentBlock;
  }
  const record = (manifest ?? {}) as { contracts?: unknown; linkedLibraries?: unknown; phase2?: { deployments?: unknown } };
  const entries = [
    ...(Array.isArray(record.contracts) ? record.contracts : []),
    ...(Array.isArray(record.linkedLibraries) ? record.linkedLibraries : []),
    ...(Array.isArray(record.phase2?.deployments) ? record.phase2.deployments : []),
  ] as { blockNumber?: unknown; deploymentTransaction?: { blockNumber?: unknown } }[];
  const blocks = entries
    .map((entry) => entry.deploymentTransaction?.blockNumber ?? entry.blockNumber)
    .filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return blocks.length > 0 ? Math.min(...blocks) : null;
}

const publicOrderComponents = [
  { name: "signer", type: "address" },
  { name: "accountId", type: "bytes32" },
  { name: "policyId", type: "bytes32" },
  { name: "policyContextHash", type: "bytes32" },
  { name: "actionId", type: "bytes32" },
  { name: "targetKind", type: "uint8" },
  { name: "seriesId", type: "bytes32" },
  { name: "packageId", type: "bytes32" },
  { name: "targetVersion", type: "uint32" },
  { name: "side", type: "uint8" },
  { name: "lots", type: "uint128" },
  { name: "priceTicks", type: "int128" },
  { name: "timeInForce", type: "uint8" },
  { name: "deadline", type: "uint64" },
  { name: "executionModeId", type: "bytes32" },
  { name: "feeScheduleId", type: "bytes32" },
  { name: "feeScheduleVersion", type: "uint32" },
  { name: "maxFeeMinor", type: "uint128" },
  { name: "recipient", type: "address" },
  { name: "permittedExecutor", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "salt", type: "bytes32" },
  { name: "allowPartialFills", type: "bool" },
  { name: "minimumFillLots", type: "uint128" },
  { name: "remainderPolicy", type: "uint8" },
  { name: "postOnly", type: "bool" },
  { name: "reduceOnly", type: "bool" },
] as const;

const orderReadAbi = [
  {
    type: "function",
    name: "getOrder",
    stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [
      {
        name: "record",
        type: "tuple",
        components: [
          { name: "order", type: "tuple", components: publicOrderComponents },
          { name: "filledLots", type: "uint128" },
          { name: "status", type: "uint8" },
          { name: "registeredAt", type: "uint64" },
        ],
      },
    ],
  },
] as const;

const ZERO_HASH = `0x${"0".repeat(64)}`;

/**
 * The aggressor side of a fill: the taker order's side, else the opposite of the maker order's; null when neither order
 * is registered publicly (a private RFQ), for the caller to classify by the tick rule and mark as inferred. Order sides
 * are cached in `cache`, since an order fills many times.
 */
export async function aggressorSide(
  client: PublicClient,
  orderState: Address,
  takerOrderHash: Hex,
  makerOrderHash: Hex,
  cache: Map<string, "BUY" | "SELL" | null>,
): Promise<"BUY" | "SELL" | null> {
  const sideOf = async (hash: Hex): Promise<"BUY" | "SELL" | null> => {
    if (hash === ZERO_HASH) return null;
    const known = cache.get(hash);
    if (known !== undefined) return known;
    const record = await client.readContract({ address: orderState, abi: orderReadAbi, functionName: "getOrder", args: [hash] }).catch(() => null);
    const side = record?.order.side === 1 ? "BUY" : record?.order.side === 2 ? "SELL" : null;
    cache.set(hash, side);
    return side;
  };
  const taker = await sideOf(takerOrderHash);
  if (taker) return taker;
  const maker = await sideOf(makerOrderHash);
  return maker === "BUY" ? "SELL" : maker === "SELL" ? "BUY" : null;
}

/** The tick rule for a fill whose orders are private: below the previous print is a sell, anything else a buy. */
export function tickRuleSide(price: number, previousPrice: number | undefined): "BUY" | "SELL" {
  return previousPrice !== undefined && price < previousPrice ? "SELL" : "BUY";
}
