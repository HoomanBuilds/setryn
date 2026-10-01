import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { readActiveFeeSchedule, marketTradingVersions, type ActiveFeeSchedule } from "@/lib/internal-gateway/fee-schedule";
import { orderStateAbi, publicOrderBookAbi, seriesRegistryAbi } from "@/lib/internal-gateway/protocol";
import type { SetrynRuntime, SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import { deriveSeriesBookId, ticksToPrice } from "@/lib/internal-gateway/runtime-markets";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";
import type { BookRow } from "@/lib/terminal/types";
import { aggregateCandles, INTERVAL_SECONDS, MAX_BARS, stepCandles, type PricePoint } from "./intervals";
import { readReferenceQuotes, referenceClient, REFERENCE_CHAIN_ID, REFERENCE_FEEDS } from "./reference";
import type {
  ChartInterval,
  LiveMarketData,
  MarketCandlesResponse,
  MarketDataSnapshot,
  MarketFeeSchedule,
  MarketTrade,
  ReferenceQuote,
  SeriesStatus,
} from "./types";

/*
 * The server side of the market-data feed (docs/plans/network-runtime-real-data.md, section 4). One snapshot reads
 * every runtime market at one block: the active series version's public book, fills cleared up to that block, open
 * interest from the position engine's events, the series status, and the protocol fee schedule; the Chainlink
 * references come from Arbitrum One. Fills and positions are scanned incrementally with a cursor held in memory and
 * reset whenever the chain is (an anvil reset, a reorg, a redeploy). Nothing is invented: an unreadable chain reports
 * itself unavailable and the markets carry no live state.
 */

const SNAPSHOT_TTL_MS = 2_000;
const RPC_TIMEOUT_MS = 6_000;
const LOCAL_CHAIN_ID = 31337;
/** Bounded book walk: price levels per side and orders per level. */
const MAX_LEVELS = 24;
const MAX_ORDERS_PER_LEVEL = 32;
/** Fills kept per market for the tape, the day's statistics, and fill candles. */
const MAX_FILLS_PER_MARKET = 20_000;
const TAPE_LENGTH = 80;
/** Without a known deployment block, a network scan starts this many blocks back (about a day on Arbitrum). */
const DEFAULT_LOOKBACK_BLOCKS = BigInt(400_000);
/** Log ranges per request: anvil serves any range; public RPCs cap it. */
const LOCAL_LOG_CHUNK = BigInt(200_000);
const NETWORK_LOG_CHUNK = BigInt(Number(process.env.SETRYN_LOG_CHUNK_BLOCKS ?? 9_000));
/** Chunks scanned per snapshot; a longer backlog continues on the next snapshot. */
const MAX_CHUNKS_PER_SYNC = 40;
const DAY_SECONDS = 86_400;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
/** PositionStatus values that still carry open lots: 1 Live, 2 Fixing, 3 SettlementReady. Every other status is closed. */
const OPEN_POSITION_STATUSES = new Set([1, 2, 3]);
const SERIES_STATUS: Record<number, SeriesStatus> = { 1: "ACTIVE", 2: "PAUSED", 3: "DEPRECATED" };
/** ClearingChannelKind: 1 Direct, 2 PrivateRfq, 3 SealedAuction. Anything else is reported as unspecified. */
const CLEARING_CHANNEL: Record<number, MarketTrade["channel"]> = { 1: "BOOK", 2: "RFQ", 3: "AUCTION" };

const fillRecordComponents = [
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

/** Every state-changing event the feed projects: clearing fills and the position quantities behind open interest. */
const feedEventsAbi = [
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

/* ------------------------------------------------------------------------------------------------------------------ */
/* Incremental chain state                                                                                             */
/* ------------------------------------------------------------------------------------------------------------------ */

interface StoredFill extends MarketTrade {
  takerOrderHash: Hex;
  makerOrderHash: Hex;
  logIndex: number;
}

interface PositionState {
  seriesId: string;
  remaining: number;
  open: boolean;
}

interface FeedState {
  /** Identity of the deployment the state belongs to; a different one starts over. */
  key: string;
  startBlock: bigint;
  /** Whether the scan started at the deployment, so open interest is complete. */
  fromDeployment: boolean;
  /** Last block whose logs are applied, and its hash for reset and reorg detection. */
  syncedBlock: bigint | null;
  syncedHash: Hex | null;
  fills: Map<string, StoredFill[]>;
  fillIds: Set<string>;
  positions: Map<string, PositionState>;
  orderSides: Map<string, "BUY" | "SELL" | null>;
}

/** The Chainlink rounds read so far for one underlying: a contiguous run of one phase, oldest first. */
interface ReferenceHistory {
  at: number;
  newestRound: bigint;
  oldestRound: bigint;
  /** The walk reached the first round of the phase: nothing older is readable without the previous phase. */
  exhausted: boolean;
  points: PricePoint[];
}

interface Holder {
  state: FeedState | null;
  snapshot: { at: number; value: MarketDataSnapshot } | null;
  inflight: Promise<MarketDataSnapshot> | null;
  clients: Map<string, PublicClient>;
  referenceHistory: Map<string, ReferenceHistory>;
}

const HOLDER_KEY = Symbol.for("setryn.market-data.server");

function holder(): Holder {
  const scope = globalThis as unknown as Record<symbol, Holder | undefined>;
  scope[HOLDER_KEY] ??= { state: null, snapshot: null, inflight: null, clients: new Map(), referenceHistory: new Map() };
  return scope[HOLDER_KEY];
}

function chainClient(rpcUrl: string): PublicClient {
  const clients = holder().clients;
  let client = clients.get(rpcUrl);
  if (!client) {
    client = createPublicClient({ transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS, batch: { batchSize: 64, wait: 4 } }) }) as PublicClient;
    clients.set(rpcUrl, client);
  }
  return client;
}

/** Runtime markets whose prices convert as range forwards. A schema 9 or 10 market quotes another unit and is skipped. */
function rangeForwardMarkets(runtime: SetrynRuntime): SetrynRuntimeMarket[] {
  return runtime.markets.filter((market) => market.priceOffset !== undefined && market.floor !== undefined && market.cap !== undefined);
}

function stateKey(runtime: SetrynRuntime): string {
  return [runtime.chainId, runtime.atomicClearingEngine, runtime.positionEngine, runtime.publicOrderBook].join(":").toLowerCase();
}

function freshState(runtime: SetrynRuntime, head: bigint): FeedState {
  const known = runtime.deploymentBlock !== undefined;
  const local = runtime.chainId === LOCAL_CHAIN_ID;
  const startBlock = known
    ? BigInt(runtime.deploymentBlock as number)
    : local
      ? BigInt(0)
      : head > DEFAULT_LOOKBACK_BLOCKS
        ? head - DEFAULT_LOOKBACK_BLOCKS
        : BigInt(0);
  return {
    key: stateKey(runtime),
    startBlock,
    fromDeployment: known || local || startBlock === BigInt(0),
    syncedBlock: null,
    syncedHash: null,
    fills: new Map(),
    fillIds: new Set(),
    positions: new Map(),
    orderSides: new Map(),
  };
}

/** The aggressor side from the taker order's side, else the maker's opposite; null when neither order is public. */
async function aggressorSide(client: PublicClient, runtime: SetrynRuntime, state: FeedState, taker: Hex, maker: Hex): Promise<"BUY" | "SELL" | null> {
  const sideOf = async (hash: Hex): Promise<"BUY" | "SELL" | null> => {
    if (hash === ZERO_HASH) return null;
    const known = state.orderSides.get(hash);
    if (known !== undefined) return known;
    const record = await client
      .readContract({ address: runtime.orderState, abi: orderStateAbi, functionName: "getOrder", args: [hash] })
      .catch(() => null);
    const side = record?.order.side === 1 ? "BUY" : record?.order.side === 2 ? "SELL" : null;
    state.orderSides.set(hash, side);
    return side;
  };
  const takerSide = await sideOf(taker);
  if (takerSide) return takerSide;
  const makerSide = await sideOf(maker);
  return makerSide === "BUY" ? "SELL" : makerSide === "SELL" ? "BUY" : null;
}

/** Applies logs from the cursor to `head`, in bounded chunks. Returns false when the backlog is not finished. */
async function syncEvents(client: PublicClient, runtime: SetrynRuntime, head: { number: bigint; hash: Hex }): Promise<boolean> {
  const scope = holder();
  let state = scope.state;
  if (!state || state.key !== stateKey(runtime)) state = freshState(runtime, head.number);
  // A chain that went backwards, or whose block at the cursor changed, was reset or reorganized: start over.
  if (state.syncedBlock !== null) {
    if (head.number < state.syncedBlock) state = freshState(runtime, head.number);
    else {
      const block = await client.getBlock({ blockNumber: state.syncedBlock }).catch(() => null);
      if (!block || block.hash !== state.syncedHash) state = freshState(runtime, head.number);
    }
  }
  scope.state = state;

  const markets = new Map(rangeForwardMarkets(runtime).map((market) => [market.seriesId.toLowerCase(), market]));
  const chunk = runtime.chainId === LOCAL_CHAIN_ID ? LOCAL_LOG_CHUNK : NETWORK_LOG_CHUNK;
  let from = state.syncedBlock === null ? state.startBlock : state.syncedBlock + BigInt(1);
  let chunks = 0;
  while (from <= head.number && chunks < MAX_CHUNKS_PER_SYNC) {
    const to = from + chunk - BigInt(1) < head.number ? from + chunk - BigInt(1) : head.number;
    const logs = await client.getLogs({
      address: [runtime.atomicClearingEngine, runtime.positionEngine],
      events: feedEventsAbi,
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    for (const log of logs) {
      if (log.eventName === "FillCleared") {
        const record = log.args.record;
        const market = markets.get(record.targetId.toLowerCase());
        const id = record.fillId;
        if (!market || record.isPackage || state.fillIds.has(id) || log.address.toLowerCase() !== runtime.atomicClearingEngine.toLowerCase()) continue;
        const fills = state.fills.get(market.marketKey) ?? [];
        const price = ticksToPrice(market, record.executionPriceTicks);
        const side = await aggressorSide(client, runtime, state, record.takerOrderHash, record.makerOrderHash);
        const previous = fills[fills.length - 1];
        fills.push({
          id,
          time: Number(record.clearedAt),
          price,
          lots: Number(record.fillLots),
          // Tick rule for a fill whose taker order is private: up from the previous print is a buy.
          side: side ?? (previous && price < previous.price ? "SELL" : "BUY"),
          sideInferred: side === null ? true : undefined,
          channel: CLEARING_CHANNEL[record.channelKind] ?? "UNSPECIFIED",
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          takerOrderHash: record.takerOrderHash,
          makerOrderHash: record.makerOrderHash,
          logIndex: log.logIndex,
        });
        if (fills.length > MAX_FILLS_PER_MARKET) fills.splice(0, fills.length - MAX_FILLS_PER_MARKET);
        state.fills.set(market.marketKey, fills);
        state.fillIds.add(id);
        continue;
      }
      if (log.address.toLowerCase() !== runtime.positionEngine.toLowerCase()) continue;
      const positionId = log.args.positionId.toLowerCase();
      if (log.eventName === "PositionCreated") {
        state.positions.set(positionId, { seriesId: log.args.seriesId.toLowerCase(), remaining: Number(log.args.lots), open: true });
      } else if (log.eventName === "PositionQuantityChanged") {
        const position = state.positions.get(positionId);
        if (position) position.remaining = Number(log.args.remainingLots);
      } else if (log.eventName === "PositionStatusChanged") {
        const position = state.positions.get(positionId);
        if (position) position.open = OPEN_POSITION_STATUSES.has(log.args.newStatus);
      }
    }
    state.syncedBlock = to;
    from = to + BigInt(1);
    chunks += 1;
  }
  if (state.syncedBlock !== null) {
    const synced = state.syncedBlock === head.number ? head : await client.getBlock({ blockNumber: state.syncedBlock });
    state.syncedHash = synced.hash as Hex;
  }
  return state.syncedBlock === head.number;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Book and series reads at one block                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------ */

/** One side of a series book, best level first, counting only orders that are resting, open, and unexpired. */
async function readBookSide(
  client: PublicClient,
  runtime: SetrynRuntime,
  market: SetrynRuntimeMarket,
  bookId: Hex,
  side: 1 | 2,
  blockNumber: bigint,
  chainTime: bigint,
): Promise<BookRow[]> {
  const rows: BookRow[] = [];
  let levelId = await client.readContract({
    address: runtime.publicOrderBook,
    abi: publicOrderBookAbi,
    functionName: "bestLevel",
    args: [bookId, side],
    blockNumber,
  });
  for (let index = 0; index < MAX_LEVELS && levelId !== ZERO_HASH; index += 1) {
    const level = await client.readContract({
      address: runtime.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "getPriceLevel",
      args: [levelId],
      blockNumber,
    });
    if (!level.active) break;
    let lots = BigInt(0);
    let orders = 0;
    let hash = level.headOrderHash;
    for (let count = 0; count < MAX_ORDERS_PER_LEVEL && hash !== ZERO_HASH; count += 1) {
      const [bookOrder, record] = await Promise.all([
        client.readContract({ address: runtime.publicOrderBook, abi: publicOrderBookAbi, functionName: "getBookOrder", args: [hash], blockNumber }),
        client
          .readContract({ address: runtime.orderState, abi: orderStateAbi, functionName: "getOrder", args: [hash], blockNumber })
          .catch(() => null),
      ]);
      // Resting on the book, open or partially filled in OrderState, and not past its deadline on the chain clock.
      if (bookOrder.status === 1 && record && (record.status === 1 || record.status === 2) && record.order.deadline > chainTime) {
        lots += bookOrder.remainingLots;
        orders += 1;
      }
      hash = bookOrder.nextOrderHash;
    }
    if (lots > BigInt(0)) {
      rows.push({
        id: `${side === 1 ? "BID" : "ASK"}-${levelId}`,
        side: side === 1 ? "BID" : "ASK",
        source: "DIRECT",
        price: ticksToPrice(market, level.priceTicks),
        lots: Number(lots),
        firmness: "FIRM",
        executable: true,
        origin: `Public order book, ${orders} ${orders === 1 ? "order" : "orders"}`,
      });
    }
    levelId = level.nextLevelId;
  }
  return rows;
}

async function readSeriesStatus(
  client: PublicClient,
  runtime: SetrynRuntime,
  market: SetrynRuntimeMarket,
  seriesVersion: number,
  blockNumber: bigint,
): Promise<SeriesStatus> {
  if (!runtime.seriesRegistry) return "UNKNOWN";
  const record = await client
    .readContract({
      address: runtime.seriesRegistry,
      abi: seriesRegistryAbi,
      functionName: "getSeries",
      args: [market.seriesId, seriesVersion],
      blockNumber,
    })
    .catch(() => null);
  return record ? (SERIES_STATUS[Number(record.status)] ?? "UNKNOWN") : "UNKNOWN";
}

function feeView(fees: ActiveFeeSchedule): MarketFeeSchedule {
  return {
    version: fees.version,
    active: fees.active,
    makerFeeBps: fees.makerFeeBps,
    takerFeeBps: fees.takerFeeBps,
    makerFlatFeeUsd: fees.maker.flatChargeMinor / 1_000_000,
    takerFlatFeeUsd: fees.taker.flatChargeMinor / 1_000_000,
    source: fees.source,
  };
}

/** The reference spot clamped into the payoff range on the tick grid: what a market marks at with no book or fills. */
function referenceMark(market: SetrynRuntimeMarket, reference: ReferenceQuote | undefined): number | null {
  if (!reference) return null;
  const floor = Number(market.floor);
  const cap = Number(market.cap);
  const tick = 1 / market.priceScale;
  const decimals = market.priceDecimals ?? Math.round(Math.log10(market.priceScale));
  const clamped = Math.min(cap - tick, Math.max(floor + tick, reference.price));
  return Number((Math.round(clamped / tick) * tick).toFixed(decimals));
}

async function readLiveMarket(
  client: PublicClient,
  runtime: SetrynRuntime,
  market: SetrynRuntimeMarket,
  fees: ActiveFeeSchedule,
  block: { number: bigint; timestamp: bigint },
  references: Record<string, ReferenceQuote>,
): Promise<LiveMarketData> {
  const state = holder().state;
  const versions = marketTradingVersions(fees, market.seriesId);
  const bookId = deriveSeriesBookId(runtime, market.seriesId, versions);
  const [asks, bids, seriesStatus] = await Promise.all([
    readBookSide(client, runtime, market, bookId, 2, block.number, block.timestamp),
    readBookSide(client, runtime, market, bookId, 1, block.number, block.timestamp),
    readSeriesStatus(client, runtime, market, versions.seriesVersion, block.number),
  ]);
  const chainTime = Number(block.timestamp);
  const status: SeriesStatus = market.expiryAt !== undefined && chainTime >= market.expiryAt ? "EXPIRED" : seriesStatus;
  const fills = (state?.fills.get(market.marketKey) ?? []).filter((fill) => fill.blockNumber <= Number(block.number));
  const dayFills = fills.filter((fill) => fill.time >= chainTime - DAY_SECONDS);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const lastFill = fills[fills.length - 1] ?? null;
  const reference = market.underlying ? references[market.underlying] : undefined;
  let mark: number | null;
  let markSource: LiveMarketData["markSource"];
  let markAsOf: number;
  if (bestBid !== null && bestAsk !== null) {
    const decimals = market.priceDecimals ?? Math.round(Math.log10(market.priceScale));
    mark = Number(((bestBid + bestAsk) / 2).toFixed(decimals + 1));
    markSource = "MID";
    markAsOf = chainTime;
  } else if (lastFill) {
    mark = lastFill.price;
    markSource = "LAST";
    markAsOf = lastFill.time;
  } else {
    mark = referenceMark(market, reference);
    markSource = mark === null ? "NONE" : "REFERENCE";
    markAsOf = reference?.updatedAt ?? 0;
  }
  let openInterestLots: number | null = null;
  if (state?.fromDeployment) {
    const seriesKey = market.seriesId.toLowerCase();
    openInterestLots = 0;
    for (const position of state.positions.values()) {
      if (position.open && position.seriesId === seriesKey) openInterestLots += position.remaining;
    }
  }
  return {
    marketKey: market.marketKey,
    seriesStatus: status,
    seriesVersion: versions.seriesVersion,
    feeScheduleVersion: versions.feeScheduleVersion,
    tradable:
      versions.tradable &&
      status === "ACTIVE" &&
      (market.lastTradingAt === undefined || chainTime < market.lastTradingAt),
    book: [...asks, ...bids],
    bestBid,
    bestAsk,
    last: lastFill?.price ?? null,
    mark,
    markSource,
    open24h: dayFills[0]?.price ?? null,
    high24h: dayFills.length > 0 ? Math.max(...dayFills.map((fill) => fill.price)) : null,
    low24h: dayFills.length > 0 ? Math.min(...dayFills.map((fill) => fill.price)) : null,
    volume24hLots: dayFills.reduce((total, fill) => total + fill.lots, 0),
    openInterestLots,
    trades: fills
      .slice(-TAPE_LENGTH)
      .reverse()
      .map((fill) => ({
        id: fill.id,
        time: fill.time,
        price: fill.price,
        lots: fill.lots,
        side: fill.side,
        ...(fill.sideInferred ? { sideInferred: true } : {}),
        channel: fill.channel,
        txHash: fill.txHash,
        blockNumber: fill.blockNumber,
      })),
    markAsOf,
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Snapshot                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------ */

function unavailable(reason: string, references: Record<string, ReferenceQuote>, network: string, chainId: number): MarketDataSnapshot {
  return {
    network,
    chainId,
    blockNumber: 0,
    asOf: 0,
    markets: [],
    references,
    chain: { status: "UNAVAILABLE", reason },
    fees: null,
    servedAt: Math.floor(Date.now() / 1000),
  };
}

function errorReason(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(message) ? message : fallback;
}

async function buildSnapshot(): Promise<MarketDataSnapshot> {
  const referencesPromise = readReferenceQuotes().catch(() => ({}) as Record<string, ReferenceQuote>);
  let runtime: SetrynRuntime;
  try {
    runtime = await readRuntime();
  } catch (error) {
    const network = process.env.SETRYN_NETWORK ?? process.env.NEXT_PUBLIC_SETRYN_NETWORK ?? "local";
    return unavailable(errorReason(error, "RUNTIME_UNAVAILABLE"), await referencesPromise, network, 0);
  }
  const network = runtime.network ?? "local";
  const client = chainClient(runtime.rpcUrl);
  let head: { number: bigint; hash: Hex; timestamp: bigint };
  try {
    const block = await client.getBlock({ blockTag: "latest" });
    head = { number: block.number, hash: block.hash, timestamp: block.timestamp };
  } catch {
    return unavailable("RPC_UNREACHABLE", await referencesPromise, network, runtime.chainId);
  }
  try {
    const [fees, references] = await Promise.all([
      readActiveFeeSchedule(runtime, { client }),
      referencesPromise,
      syncEvents(client, runtime, head),
    ]);
    const markets = await Promise.all(
      rangeForwardMarkets(runtime).map((market) => readLiveMarket(client, runtime, market, fees, head, references)),
    );
    return {
      network,
      chainId: runtime.chainId,
      blockNumber: Number(head.number),
      asOf: Number(head.timestamp),
      markets,
      references,
      chain: { status: "LIVE" },
      fees: feeView(fees),
      servedAt: Math.floor(Date.now() / 1000),
    };
  } catch (error) {
    return unavailable(errorReason(error, "CHAIN_READ_FAILED"), await referencesPromise, network, runtime.chainId);
  }
}

/** The current snapshot, read at most once per two seconds per server; concurrent callers share one read. */
export function readMarketDataSnapshot(): Promise<MarketDataSnapshot> {
  const scope = holder();
  if (scope.snapshot && Date.now() - scope.snapshot.at < SNAPSHOT_TTL_MS) return Promise.resolve(scope.snapshot.value);
  scope.inflight ??= buildSnapshot()
    .then((value) => {
      scope.snapshot = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      scope.inflight = null;
    });
  return scope.inflight;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Candles                                                                                                             */
/* ------------------------------------------------------------------------------------------------------------------ */

const REFERENCE_HISTORY_TTL_MS = 30_000;
const REFERENCE_ROUND_BATCH = 250;
/** Rounds read per request: new rounds since the last read, then this many older ones until the window is covered. */
const REFERENCE_NEW_ROUNDS = 500;
const REFERENCE_DEEPEN_ROUNDS = 2_000;
const REFERENCE_MAX_POINTS = 25_000;
const PHASE_MASK = BigInt("0xFFFFFFFFFFFFFFFF");

const aggregatorRoundAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

type Round = readonly [bigint, bigint, bigint, bigint, bigint];

function roundPoint(round: Round): PricePoint | null {
  return round[1] > BigInt(0) && round[3] > BigInt(0) ? { time: Number(round[3]), price: Number(round[1]) / 1e8, lots: 0 } : null;
}

/** Reads rounds `from` down to `to` (inclusive, `from` >= `to`, same phase) in multicall batches. */
async function readRounds(feed: `0x${string}`, from: bigint, to: bigint): Promise<PricePoint[]> {
  const client = referenceClient();
  const points: PricePoint[] = [];
  for (let high = from; high >= to; high -= BigInt(REFERENCE_ROUND_BATCH)) {
    const ids: bigint[] = [];
    for (let id = high; id >= to && id > high - BigInt(REFERENCE_ROUND_BATCH); id -= BigInt(1)) ids.push(id);
    const results = await client.multicall({
      contracts: ids.map((id) => ({ address: feed, abi: aggregatorRoundAbi, functionName: "getRoundData", args: [id] }) as const),
      allowFailure: true,
    });
    for (const result of results) {
      if (result.status !== "success") continue;
      const point = roundPoint(result.result as Round);
      if (point) points.push(point);
    }
  }
  return points;
}

function mergePoints(...lists: PricePoint[][]): PricePoint[] {
  const merged = lists.flat().sort((left, right) => left.time - right.time);
  const unique = merged.filter((point, index) => index === 0 || point.time !== merged[index - 1].time);
  return unique.slice(-REFERENCE_MAX_POINTS);
}

/**
 * The aggregator's answers covering `since` onward, oldest first; each holds from its update until the next. Rounds
 * are read incrementally: every call adds the rounds published since the last one and walks a bounded number further
 * back until the window is covered or the phase's first round is reached, so a long window fills over a few calls
 * instead of one unbounded walk.
 */
async function referenceHistory(underlying: string, since: number): Promise<PricePoint[]> {
  const feed = REFERENCE_FEEDS[underlying];
  if (!feed) return [];
  const cache = holder().referenceHistory;
  const cached = cache.get(underlying);
  // A hot reload can leave an entry of an older shape behind; it is read again rather than trusted.
  const hit = cached && typeof cached.newestRound === "bigint" ? cached : undefined;
  const covered = hit ? hit.exhausted || (hit.points[0]?.time ?? Number.POSITIVE_INFINITY) <= since : false;
  if (hit && covered && Date.now() - hit.at < REFERENCE_HISTORY_TTL_MS) return hit.points;

  const latest = (await referenceClient().readContract({ address: feed, abi: aggregatorRoundAbi, functionName: "latestRoundData" })) as Round;
  const latestId = latest[0];
  const phaseStart = (latestId & ~PHASE_MASK) + BigInt(1);
  const latestPoint = roundPoint(latest);
  let entry: ReferenceHistory;
  if (hit && (hit.newestRound & ~PHASE_MASK) === (latestId & ~PHASE_MASK) && hit.newestRound <= latestId) {
    // Same phase: read only what was published since, bounded.
    const floor = hit.newestRound + BigInt(1);
    const from = latestId - BigInt(1);
    const to = from - floor + BigInt(1) > BigInt(REFERENCE_NEW_ROUNDS) ? from - BigInt(REFERENCE_NEW_ROUNDS) + BigInt(1) : floor;
    const fresh = from >= to ? await readRounds(feed, from, to) : [];
    // A gap left by a burst longer than the bound starts the run over from the latest round.
    entry =
      to > floor
        ? { at: Date.now(), newestRound: latestId, oldestRound: to, exhausted: false, points: mergePoints(fresh, latestPoint ? [latestPoint] : []) }
        : { ...hit, at: Date.now(), newestRound: latestId, points: mergePoints(hit.points, fresh, latestPoint ? [latestPoint] : []) };
  } else {
    entry = { at: Date.now(), newestRound: latestId, oldestRound: latestId, exhausted: latestId <= phaseStart, points: latestPoint ? [latestPoint] : [] };
  }
  if (!entry.exhausted && (entry.points[0]?.time ?? Number.POSITIVE_INFINITY) > since) {
    const from = entry.oldestRound - BigInt(1);
    const to = from - BigInt(REFERENCE_DEEPEN_ROUNDS) + BigInt(1) > phaseStart ? from - BigInt(REFERENCE_DEEPEN_ROUNDS) + BigInt(1) : phaseStart;
    if (from >= to) {
      const older = await readRounds(feed, from, to);
      entry = { ...entry, oldestRound: to, exhausted: to <= phaseStart, points: mergePoints(older, entry.points) };
    } else {
      entry = { ...entry, exhausted: true };
    }
  }
  cache.set(underlying, entry);
  return entry.points;
}

/**
 * OHLCV bars for one market: from its onchain fills, or, when it has none, from the Chainlink history of its
 * underlying (labelled REFERENCE).
 */
export async function readMarketCandles(
  marketKey: string,
  interval: ChartInterval,
  underlying: string | null,
): Promise<MarketCandlesResponse> {
  const snapshot = await readMarketDataSnapshot();
  const fills = holder().state?.fills.get(marketKey) ?? [];
  const listed = snapshot.markets.some((market) => market.marketKey === marketKey);
  if (listed && fills.length > 0) {
    const points = fills
      .filter((fill) => fill.blockNumber <= snapshot.blockNumber)
      .map((fill) => ({ time: fill.time, price: fill.price, lots: fill.lots }));
    return { marketKey, interval, source: "FILLS", candles: aggregateCandles(points, interval) };
  }
  if (!underlying || !REFERENCE_FEEDS[underlying]) return { marketKey, interval, source: "REFERENCE", candles: [] };
  const until = Math.floor(Date.now() / 1000);
  const since = until - INTERVAL_SECONDS[interval] * MAX_BARS[interval];
  const points = await referenceHistory(underlying, since).catch(() => [] as PricePoint[]);
  const [base, quote] = underlying.includes("/") ? underlying.split("/") : [underlying, "USD"];
  return {
    marketKey,
    interval,
    source: "REFERENCE",
    candles: stepCandles(points, interval, until),
    reference: { underlying, pair: `${base} / ${quote}`, feed: REFERENCE_FEEDS[underlying], chainId: REFERENCE_CHAIN_ID },
  };
}
