import { BaseError, ContractFunctionRevertedError, createPublicClient, http, type Hex, type PublicClient } from "viem";
import {
  aggressorSide,
  clearingChannel,
  deploymentKey,
  fillStream,
  marketFeedEventsAbi,
  phaseOf,
  PHASE_SIZE,
  positionStatusOpen,
  readLatestRound,
  readRoundRange,
  REFERENCE_STALE_AFTER_SECONDS,
  roundPrice,
  tickRuleSide,
  type ChainlinkRound,
} from "@setryn/market-data";
import {
  databaseConfigured,
  readMarketFills,
  readOpenPositions,
  readStreamCursor,
  referenceBuckets,
  referenceRoundHoles,
  referenceSpotsAt,
} from "@setryn/persistence";
import { readActiveFeeSchedule, marketTradingVersions, type ActiveFeeSchedule } from "@/lib/internal-gateway/fee-schedule";
import { orderStateAbi, publicOrderBookAbi, seriesRegistryAbi } from "@/lib/internal-gateway/protocol";
import type { SetrynRuntime, SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import { considerationPerPriceUnit, deriveSeriesBookId, ticksToPrice } from "@/lib/internal-gateway/runtime-markets";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";
import {
  cappedForwardMark,
  markBasis,
  markParametersAt,
  MARK_PARAMETER_SETS,
  runtimeMarkTerms,
  type BasisFill,
  type MarkBasis,
  type MarkTerms,
  type MarkValue,
} from "@/lib/pricing/mark";
import type { BookRow } from "@/lib/terminal/types";
import { barGrid, barOpenTime, INTERVAL_SECONDS, MAX_BARS, type PricePoint } from "./intervals";
import { bucketPoints, buildMarkBars, withReading, type SpotHistory } from "./mark-bars";
import { readReferenceQuotes, referenceClient, REFERENCE_CHAIN_ID, REFERENCE_FEEDS } from "./reference";
import type {
  ChartInterval,
  ChartTrade,
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
 * reset whenever the chain is (an anvil reset, a reorg, a redeploy). With a database (SETRYN_DATABASE_URL), a fresh
 * server starts from what the market-data ingester stored (services/market-data-ingester) and scans only the blocks
 * after its cursor, and chart history and past spots come from the stored Chainlink rounds; without one, or when it
 * cannot be read, everything is read from chain as before. Nothing is invented: an unreadable chain reports itself
 * unavailable and the markets carry no live state.
 */

const SNAPSHOT_TTL_MS = 2_000;
const RPC_TIMEOUT_MS = 6_000;
const LOCAL_CHAIN_ID = 31337;
/** Bounded book walk: price levels per side and orders per level. */
const MAX_LEVELS = 24;
const MAX_ORDERS_PER_LEVEL = 32;
/** Fills kept per market for the tape, the day's statistics, fill markers and the mark basis. */
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
const SERIES_STATUS: Record<number, SeriesStatus> = { 1: "ACTIVE", 2: "PAUSED", 3: "DEPRECATED" };
/** A reading may hold this long before a chart bar is a gap, for a feed without its own entry. */
const DEFAULT_STALE_AFTER_SECONDS = 90_000;

/* ------------------------------------------------------------------------------------------------------------------ */
/* Incremental chain state                                                                                             */
/* ------------------------------------------------------------------------------------------------------------------ */

interface StoredFill extends MarketTrade {
  takerOrderHash: Hex;
  makerOrderHash: Hex;
  logIndex: number;
  buyerAccountId: string;
  sellerAccountId: string;
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
  /** Where the state up to `syncedBlock` came from: the ingester's database, or this server's own scan. */
  origin: "DATABASE" | "CHAIN";
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
  /** Deployments whose stored cursor did not match this chain: they are scanned from chain instead. */
  seedRejected: Set<string>;
  /** Model value (no basis) of each fill at its own time, by parameter set and fill id: a fill's never changes. */
  fillModels: Map<string, number>;
  /** When the database last failed, so a failing database is not retried on every request. */
  databaseFailedAt: number;
}

const HOLDER_KEY = Symbol.for("setryn.market-data.server");
const DATABASE_RETRY_MS = 30_000;

function holder(): Holder {
  const scope = globalThis as unknown as Record<symbol, Holder | undefined>;
  scope[HOLDER_KEY] ??= {
    state: null,
    snapshot: null,
    inflight: null,
    clients: new Map(),
    referenceHistory: new Map(),
    seedRejected: new Set(),
    fillModels: new Map(),
    databaseFailedAt: 0,
  };
  // A hot reload can leave a holder of an older shape behind.
  scope[HOLDER_KEY].seedRejected ??= new Set();
  scope[HOLDER_KEY].fillModels ??= new Map();
  scope[HOLDER_KEY].databaseFailedAt ??= 0;
  return scope[HOLDER_KEY];
}

/** Whether to read the database: configured, and not failing within the last half minute. */
function databaseReadable(): boolean {
  return databaseConfigured() && Date.now() - holder().databaseFailedAt > DATABASE_RETRY_MS;
}

function databaseFailed(error: unknown): void {
  const scope = holder();
  if (Date.now() - scope.databaseFailedAt > DATABASE_RETRY_MS) {
    console.error("[market-data] database unavailable, reading from chain:", error instanceof Error ? error.message.split("\n")[0] : error);
  }
  scope.databaseFailedAt = Date.now();
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
  return deploymentKey(runtime);
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
    origin: "CHAIN",
    syncedBlock: null,
    syncedHash: null,
    fills: new Map(),
    fillIds: new Set(),
    positions: new Map(),
    orderSides: new Map(),
  };
}

/**
 * A fresh state seeded from the ingester's database: its fills, open positions and cursor, when the cursor's block is
 * on this chain and the ingester started at the same deployment block (so open interest is complete). Otherwise, or
 * when the database cannot be read, the plain fresh state, scanned from chain.
 */
async function seededState(client: PublicClient, runtime: SetrynRuntime, head: bigint): Promise<FeedState> {
  const state = freshState(runtime, head);
  const scope = holder();
  if (!databaseReadable() || scope.seedRejected.has(state.key)) return state;
  try {
    const cursor = await readStreamCursor(fillStream(state.key));
    if (!cursor || cursor.blockNumber === null || !cursor.blockHash || BigInt(cursor.blockNumber) > head) return state;
    if (String(cursor.payload.startBlock ?? "") !== state.startBlock.toString()) return state;
    const block = await client.getBlock({ blockNumber: BigInt(cursor.blockNumber) }).catch(() => null);
    if (!block || block.hash.toLowerCase() !== cursor.blockHash) {
      scope.seedRejected.add(state.key);
      return state;
    }
    const [fills, positions] = await Promise.all([
      readMarketFills({ deploymentKey: state.key, limitPerMarket: MAX_FILLS_PER_MARKET, throughBlock: cursor.blockNumber }),
      readOpenPositions({ deploymentKey: state.key }),
    ]);
    for (const fill of fills) {
      const list = state.fills.get(fill.marketKey) ?? [];
      list.push({
        id: fill.fillId as Hex,
        time: fill.clearedAt,
        price: fill.price,
        lots: Number(fill.lots),
        side: fill.side,
        sideInferred: fill.sideInferred ? true : undefined,
        channel: fill.channel,
        txHash: fill.txHash as Hex,
        blockNumber: fill.blockNumber,
        takerOrderHash: fill.takerOrderHash as Hex,
        makerOrderHash: fill.makerOrderHash as Hex,
        logIndex: fill.logIndex,
        buyerAccountId: fill.buyerAccountId,
        sellerAccountId: fill.sellerAccountId,
      });
      state.fills.set(fill.marketKey, list);
      state.fillIds.add(fill.fillId);
    }
    for (const position of positions) {
      state.positions.set(position.positionId, { seriesId: position.seriesId, remaining: Number(position.remainingLots), open: position.open });
    }
    console.info(`[market-data] seeded ${fills.length} fills and ${positions.length} open positions from the database at block ${cursor.blockNumber}`);
    return { ...state, origin: "DATABASE", fromDeployment: true, syncedBlock: BigInt(cursor.blockNumber), syncedHash: block.hash as Hex };
  } catch (error) {
    databaseFailed(error);
    return freshState(runtime, head);
  }
}

/** Applies logs from the cursor to `head`, in bounded chunks. Returns false when the backlog is not finished. */
async function syncEvents(client: PublicClient, runtime: SetrynRuntime, head: { number: bigint; hash: Hex }): Promise<boolean> {
  const scope = holder();
  let state = scope.state;
  if (!state || state.key !== stateKey(runtime)) state = await seededState(client, runtime, head.number);
  // A chain that went backwards, or whose block at the cursor changed, was reset or reorganized: start over.
  if (state.syncedBlock !== null) {
    if (head.number < state.syncedBlock) state = await seededState(client, runtime, head.number);
    else {
      const block = await client.getBlock({ blockNumber: state.syncedBlock }).catch(() => null);
      if (!block || block.hash !== state.syncedHash) state = await seededState(client, runtime, head.number);
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
      events: marketFeedEventsAbi,
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
        const side = await aggressorSide(client, runtime.orderState, record.takerOrderHash, record.makerOrderHash, state.orderSides);
        fills.push({
          id,
          time: Number(record.clearedAt),
          price,
          lots: Number(record.fillLots),
          // Tick rule for a fill whose taker order is private: below the previous print is a sell.
          side: side ?? tickRuleSide(price, fills[fills.length - 1]?.price),
          sideInferred: side === null ? true : undefined,
          channel: clearingChannel(record.channelKind),
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          takerOrderHash: record.takerOrderHash,
          makerOrderHash: record.makerOrderHash,
          logIndex: log.logIndex,
          buyerAccountId: record.buyerAccountId.toLowerCase(),
          sellerAccountId: record.sellerAccountId.toLowerCase(),
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
        if (position) position.open = positionStatusOpen(log.args.newStatus);
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
  // A book exists only once its first order rests; until then the book contract reverts, which reads as empty.
  // Transport failures still propagate so the snapshot reports the chain as unavailable.
  let levelId: Hex;
  try {
    levelId = await client.readContract({
      address: runtime.publicOrderBook,
      abi: publicOrderBookAbi,
      functionName: "bestLevel",
      args: [bookId, side],
      blockNumber,
    });
  } catch (error) {
    if (error instanceof BaseError && error.walk((cause) => cause instanceof ContractFunctionRevertedError)) return rows;
    throw error;
  }
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

/** The market's mark from a spot reading at `atSeconds` and the fill basis then (lib/pricing/mark.ts), or null. */
function modelMark(market: SetrynRuntimeMarket, spot: number | undefined, atSeconds: number, basis: MarkBasis | null = null): MarkValue | null {
  const terms = runtimeMarkTerms(market);
  return terms && spot !== undefined ? cappedForwardMark(terms, spot, atSeconds, undefined, basis) : null;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Spots at past times and the fill basis                                                                              */
/* ------------------------------------------------------------------------------------------------------------------ */

function spotKey(underlying: string, at: number): string {
  return `${underlying}:${Math.floor(at)}`;
}

/**
 * The Chainlink reading in force at each requested time: from the stored rounds when the database has them, else from
 * the reference history already in memory (refreshed in the background, so a request never waits on a long walk).
 * A time neither covers is absent.
 */
async function spotsAt(requests: readonly { underlying: string; at: number }[]): Promise<Map<string, number>> {
  const spots = new Map<string, number>();
  const wanted = requests.filter((request) => REFERENCE_FEEDS[request.underlying] && Number.isFinite(request.at));
  if (wanted.length === 0) return spots;
  if (databaseReadable()) {
    try {
      const found = await referenceSpotsAt(
        REFERENCE_CHAIN_ID,
        wanted.map((request) => ({ feed: REFERENCE_FEEDS[request.underlying], at: request.at })),
      );
      for (const request of wanted) {
        const round = found.get(`${REFERENCE_FEEDS[request.underlying].toLowerCase()}:${Math.floor(request.at)}`);
        const staleAfter = REFERENCE_STALE_AFTER_SECONDS[request.underlying] ?? DEFAULT_STALE_AFTER_SECONDS;
        if (round && request.at - round.updatedAt <= staleAfter) spots.set(spotKey(request.underlying, request.at), round.price);
      }
    } catch (error) {
      databaseFailed(error);
    }
  }
  const histories = holder().referenceHistory;
  for (const request of wanted) {
    const key = spotKey(request.underlying, request.at);
    if (spots.has(key)) continue;
    const history = histories.get(request.underlying);
    const spot = history ? spotAt(history.points, request.at) : undefined;
    if (spot !== undefined) spots.set(key, spot);
    if (!history || spot === undefined || Date.now() - history.at > REFERENCE_HISTORY_TTL_MS) {
      void referenceHistory(request.underlying, request.at - DAY_SECONDS).catch(() => undefined);
    }
  }
  return spots;
}

/** How far back a fill still weighs in the basis (eight half-lives), measured from the earliest time it is asked for. */
function basisHorizon(): number {
  return 8 * Math.max(...MARK_PARAMETER_SETS.map((parameters) => parameters.basis.halfLifeSeconds));
}

/**
 * The fills that inform a market's basis since `since`, each with the model value at its own time. A fill whose spot
 * is not known yet is left out (it joins once the reading is), and self-trades (one account on both sides) never count.
 */
async function basisFills(market: SetrynRuntimeMarket, fills: readonly StoredFill[], since: number): Promise<BasisFill[]> {
  const terms = runtimeMarkTerms(market);
  const underlying = market.underlying;
  if (!terms || !underlying) return [];
  const multiplier = considerationPerPriceUnit(market);
  const cache = holder().fillModels;
  const relevant = fills.filter((fill) => fill.time >= since && fill.buyerAccountId !== fill.sellerAccountId);
  const cacheKey = (fill: StoredFill) => `${markParametersAt(fill.time)?.id ?? "unmarked"}:${fill.id}`;
  const missing = relevant.filter((fill) => !cache.has(cacheKey(fill)));
  if (missing.length > 0) {
    const spots = await spotsAt(missing.map((fill) => ({ underlying, at: fill.time })));
    for (const fill of missing) {
      const spot = spots.get(spotKey(underlying, fill.time));
      const parameters = markParametersAt(fill.time);
      const model = spot === undefined || !parameters ? null : cappedForwardMark(terms, spot, fill.time, parameters);
      if (model) cache.set(cacheKey(fill), model.model.modelValue);
    }
  }
  const result: BasisFill[] = [];
  for (const fill of relevant) {
    const modelValue = cache.get(cacheKey(fill));
    if (modelValue === undefined) continue;
    result.push({ time: fill.time, price: fill.price, notional: fill.lots * fill.price * multiplier, modelValue });
  }
  return result;
}

async function readLiveMarket(
  client: PublicClient,
  runtime: SetrynRuntime,
  market: SetrynRuntimeMarket,
  fees: ActiveFeeSchedule,
  block: { number: bigint; timestamp: bigint },
  references: Record<string, ReferenceQuote>,
  pastSpots: Map<string, number>,
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
  // One mark per expiry: the versioned model plus the basis real fills earned (never book quotes). Past expiry the
  // reading in force at expiry fixes it, not today's spot.
  const expired = market.expiryAt !== undefined && chainTime >= market.expiryAt;
  const expirySpot = expired && market.underlying ? pastSpots.get(spotKey(market.underlying, market.expiryAt as number)) : undefined;
  const spot = expired ? expirySpot : reference?.price;
  const evaluationAt = expired ? (market.expiryAt as number) : chainTime;
  const allowObservedBasis = runtime.chainId !== REFERENCE_CHAIN_ID && runtime.network !== "arbitrum-one";
  const informing = allowObservedBasis ? await basisFills(market, fills, evaluationAt - DAY_SECONDS - basisHorizon()) : [];
  const modeled = modelMark(market, spot, evaluationAt, allowObservedBasis ? markBasis(informing, evaluationAt) : null);
  const mark = modeled?.price ?? null;
  const markSource: LiveMarketData["markSource"] = mark === null ? "NONE" : "MODEL";
  const markAsOf = expirySpot !== undefined ? (market.expiryAt as number) : (reference?.updatedAt ?? 0);
  const priorAt = evaluationAt - DAY_SECONDS;
  const priorSpot = market.underlying ? pastSpots.get(spotKey(market.underlying, priorAt)) : undefined;
  const markPrior24h = modelMark(market, priorSpot, priorAt, allowObservedBasis ? markBasis(informing, priorAt) : null)?.price ?? null;
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
    markModel: modeled?.model ?? null,
    markPrior24h,
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
    const listed = rangeForwardMarkets(runtime);
    const chainTime = Number(head.timestamp);
    // Every past reading the snapshot needs, in one read: the mark's 24h base and each expired market's expiry.
    const pastSpots = await spotsAt(
      listed.flatMap((market) => {
        if (!market.underlying) return [];
        const evaluationAt = market.expiryAt !== undefined && chainTime >= market.expiryAt ? market.expiryAt : chainTime;
        const requests = [{ underlying: market.underlying, at: evaluationAt - DAY_SECONDS }];
        if (market.expiryAt !== undefined && chainTime >= market.expiryAt) requests.push({ underlying: market.underlying, at: market.expiryAt });
        return requests;
      }),
    );
    const markets = await Promise.all(
      listed.map((market) => readLiveMarket(client, runtime, market, fees, head, references, pastSpots)),
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
    console.error("[market-data]", error instanceof Error ? error.message.split("\n").slice(0, 4).join(" ") : error);
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
/* Reference history and candles                                                                                       */
/* ------------------------------------------------------------------------------------------------------------------ */

const REFERENCE_HISTORY_TTL_MS = 30_000;
/** Rounds read per request: new rounds since the last read, then this many older ones until the window is covered. */
const REFERENCE_NEW_ROUNDS = 500;
const REFERENCE_DEEPEN_ROUNDS = 2_000;
const REFERENCE_MAX_POINTS = 25_000;

function roundPoint(round: ChainlinkRound): PricePoint {
  return { time: round.updatedAt, price: roundPrice(round), lots: 0 };
}

function mergePoints(...lists: PricePoint[][]): PricePoint[] {
  const merged = lists.flat().sort((left, right) => left.time - right.time);
  const unique = merged.filter((point, index) => index === 0 || point.time !== merged[index - 1].time);
  return unique.slice(-REFERENCE_MAX_POINTS);
}

/**
 * The aggregator's answers covering `since` onward, oldest first, read straight from chain and kept in this server's
 * memory: the fallback when no database holds the rounds. Every call adds the rounds published since the last one and
 * walks a bounded number further back until the window is covered or the phase's first round is reached, so a long
 * window fills over a few calls instead of one unbounded walk.
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

  const client = referenceClient();
  const latest = await readLatestRound(client, feed);
  if (!latest) return hit?.points ?? [];
  const latestId = latest.roundId;
  const phaseStart = BigInt(phaseOf(latestId)) * PHASE_SIZE + BigInt(1);
  const latestPoint = roundPoint(latest);
  let entry: ReferenceHistory;
  if (hit && phaseOf(hit.newestRound) === phaseOf(latestId) && hit.newestRound <= latestId) {
    // Same phase: read only what was published since, bounded.
    const floor = hit.newestRound + BigInt(1);
    const from = latestId - BigInt(1);
    const to = from - floor + BigInt(1) > BigInt(REFERENCE_NEW_ROUNDS) ? from - BigInt(REFERENCE_NEW_ROUNDS) + BigInt(1) : floor;
    const fresh = from >= to ? (await readRoundRange(client, feed, from, to)).map(roundPoint) : [];
    // A gap left by a burst longer than the bound starts the run over from the latest round.
    entry =
      to > floor
        ? { at: Date.now(), newestRound: latestId, oldestRound: to, exhausted: false, points: mergePoints(fresh, [latestPoint]) }
        : { ...hit, at: Date.now(), newestRound: latestId, points: mergePoints(hit.points, fresh, [latestPoint]) };
  } else {
    entry = { at: Date.now(), newestRound: latestId, oldestRound: latestId, exhausted: latestId <= phaseStart, points: [latestPoint] };
  }
  if (!entry.exhausted && (entry.points[0]?.time ?? Number.POSITIVE_INFINITY) > since) {
    const from = entry.oldestRound - BigInt(1);
    const to = from - BigInt(REFERENCE_DEEPEN_ROUNDS) + BigInt(1) > phaseStart ? from - BigInt(REFERENCE_DEEPEN_ROUNDS) + BigInt(1) : phaseStart;
    if (from >= to) {
      const older = (await readRoundRange(client, feed, from, to)).map(roundPoint);
      entry = { ...entry, oldestRound: to, exhausted: to <= phaseStart, points: mergePoints(older, entry.points) };
    } else {
      entry = { ...entry, exhausted: true };
    }
  }
  cache.set(underlying, entry);
  return entry.points;
}

/** The reading in force at `time` (the last one at or before it), or undefined when the points do not reach back. */
function spotAt(points: readonly PricePoint[], time: number): number | undefined {
  if (points.length === 0 || points[0].time > time) return undefined;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (points[middle].time <= time) low = middle;
    else high = middle - 1;
  }
  return points[low].price;
}

/**
 * An underlying's readings over a chart window, bucketed per bar: from the stored rounds (with any holes), else from the
 * reference history in memory. `earliest` is the first reading either source holds.
 */
async function spotHistory(
  underlying: string,
  interval: ChartInterval,
  since: number,
  until: number,
): Promise<{ history: SpotHistory; earliest: number | null; source: "DATABASE" | "MEMORY" }> {
  const feed = REFERENCE_FEEDS[underlying];
  if (databaseReadable()) {
    try {
      const { step, anchor } = barGrid(interval);
      const [stored, holes] = await Promise.all([
        referenceBuckets({ chainId: REFERENCE_CHAIN_ID, feed, since, until, step, anchor }),
        referenceRoundHoles(REFERENCE_CHAIN_ID, feed, 500),
      ]);
      if (stored.earliest !== null) {
        return {
          history: {
            carry: stored.carry ? { price: stored.carry.price, updatedAt: stored.carry.updatedAt } : null,
            buckets: stored.buckets,
            holes: holes.filter((hole) => hole.to > since && hole.from < until).map((hole) => ({ from: hole.from, to: hole.to })),
          },
          earliest: stored.earliest,
          source: "DATABASE",
        };
      }
    } catch (error) {
      databaseFailed(error);
    }
  }
  const points = await referenceHistory(underlying, since).catch(() => [] as PricePoint[]);
  return { history: bucketPoints(points, barGrid(interval), since, until), earliest: points[0]?.time ?? null, source: "MEMORY" };
}

/** Most fills a candles response draws as markers. */
const MAX_CHART_TRADES = 500;

/**
 * Chart data for one market: OHLC bars of its own mark (the model at each Chainlink reading's own time to expiry, plus
 * the fill basis then), with gaps where no fresh reading is known; the lots actually traded in each bar as its volume;
 * the fills themselves as markers; and the Chainlink spot as a separate line. The bars never switch source after a
 * trade. A market past expiry ends at its expiry.
 */
export async function readMarketCandles(
  marketKey: string,
  interval: ChartInterval,
  catalog: MarkTerms,
): Promise<MarketCandlesResponse> {
  const snapshot = await readMarketDataSnapshot();
  const runtime = await readRuntime().catch(() => null);
  const listedMarket = runtime ? rangeForwardMarkets(runtime).find((market) => market.marketKey === marketKey) : undefined;
  const terms = (listedMarket ? runtimeMarkTerms(listedMarket) : null) ?? catalog;
  const band = { floor: terms.floor, cap: terms.cap };
  const empty: MarketCandlesResponse = {
    marketKey,
    interval,
    source: "MODEL_MARK",
    candles: [],
    trades: [],
    reference: null,
    band,
    expiryAt: terms.expiryAt,
    model: null,
    history: { source: "MEMORY", earliest: null },
  };
  const underlying = terms.underlying;
  const feed = REFERENCE_FEEDS[underlying];
  if (!feed) return empty;

  const now = snapshot.asOf > 0 ? snapshot.asOf : Math.floor(Date.now() / 1000);
  const until = Math.min(now, terms.expiryAt);
  const step = INTERVAL_SECONDS[interval];
  const windowStart = barOpenTime(until, interval) - (MAX_BARS[interval] - 1) * step;
  const historyStart = Math.max(windowStart, terms.tradingStartsAt ?? windowStart);
  if (historyStart > until) return empty;
  const spot = await spotHistory(underlying, interval, historyStart, until);
  let history = spot.history;
  // The live reading (what the header marks with) closes the last bar, when it is newer than the stored rounds. It is
  // the reading in force at the platform's clock even when chain time trails it (an idle devnet), so it is held there.
  const live = snapshot.references[underlying];
  if (live && until === now) {
    history = withReading(history, { price: live.price, updatedAt: Math.min(live.updatedAt, until) }, barGrid(interval), historyStart, until);
  }
  if (spot.earliest === null && history.buckets.length === 0) return { ...empty, history: { source: spot.source, earliest: null } };
  const marketFirstBar = barOpenTime(historyStart, interval);
  const firstBar = history.carry ? marketFirstBar : Math.max(marketFirstBar, barOpenTime(history.buckets[0]?.time ?? until, interval));

  const fills = (holder().state?.fills.get(marketKey) ?? []).filter((fill) => fill.blockNumber <= snapshot.blockNumber && fill.time <= until);
  const allowObservedBasis = runtime?.chainId !== REFERENCE_CHAIN_ID && runtime?.network !== "arbitrum-one";
  const informing = listedMarket && allowObservedBasis ? await basisFills(listedMarket, fills, historyStart - basisHorizon()) : [];
  const markAt = (price: number, time: number) =>
    cappedForwardMark(terms, price, time, undefined, allowObservedBasis ? markBasis(informing, time) : null)?.price ?? null;
  const bars = buildMarkBars({
    history,
    grid: barGrid(interval),
    firstBar,
    activeFrom: historyStart,
    until,
    staleAfter: REFERENCE_STALE_AFTER_SECONDS[underlying] ?? DEFAULT_STALE_AFTER_SECONDS,
    markAt,
  });

  const windowFills = fills.filter((fill) => fill.time >= historyStart);
  const volumeByBar = new Map<number, number>();
  for (const fill of windowFills) {
    const bar = barOpenTime(fill.time, interval);
    volumeByBar.set(bar, (volumeByBar.get(bar) ?? 0) + fill.lots);
  }
  for (const candle of bars.candles) candle.volume = volumeByBar.get(candle.time) ?? 0;
  const trades: ChartTrade[] = windowFills
    .slice(-MAX_CHART_TRADES)
    .map((fill) => ({ time: fill.time, price: fill.price, lots: fill.lots, side: fill.side, sideInferred: fill.sideInferred === true }));

  const latestReading = live && until === now ? live.price : history.buckets[history.buckets.length - 1]?.close ?? history.carry?.price;
  const latest =
    latestReading === undefined
      ? null
      : cappedForwardMark(terms, latestReading, until, undefined, allowObservedBasis ? markBasis(informing, until) : null);
  const [base, quote] = underlying.includes("/") ? underlying.split("/") : [underlying, "USD"];
  return {
    ...empty,
    candles: bars.candles,
    trades,
    reference: {
      underlying,
      pair: `${base} / ${quote}`,
      feed,
      chainId: REFERENCE_CHAIN_ID,
      line: bars.spot,
    },
    model: latest?.model ?? null,
    history: { source: spot.source, earliest: spot.earliest },
  };
}
