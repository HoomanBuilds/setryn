import {
  BaseError,
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  accountFeesPaidMinor,
  atomicClearingAbi,
  fundedFeeLedgerAbi,
  orderStateAbi,
  publicOrderBookAbi,
  riskBindingAbi,
  riskEngineAbi,
  type OnchainPublicOrder,
} from "@/lib/internal-gateway/protocol";
import type { SetrynRuntime, SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import {
  deriveSeriesBookId,
  runtimeMarketByKey,
  runtimeMarketBySeries,
  ticksToPrice as marketTicksToPrice,
} from "@/lib/internal-gateway/runtime-markets";
import { readLocalRuntime } from "@/lib/internal-gateway/runtime-server";
import { marketTradingVersions, readActiveFeeSchedule, type ActiveFeeSchedule, type MarketTradingVersions } from "@/lib/internal-gateway/fee-schedule";

/**
 * Server-side projections of contract state and events for the public API. They reconstruct orders, fills, positions,
 * receipts, the public book and the trade tape with the same reads and the same rules as the platform's gateway
 * (`lib/internal-gateway/onchain.ts`), as pure server helpers that do not depend on a browser wallet. Contract enums
 * are canonicalized through explicit tables; a value outside a table fails the projection instead of being guessed.
 *
 * Every catalog market listed in the runtime's `markets` array executes onchain on its own series, tick grid and
 * payoff bounds. Chain records name a series; the catalog market id is always resolved from that series through the
 * runtime, and a record on a series the runtime does not list is left out of every projection.
 */

export const ACCOUNT_SALT = keccak256(stringToHex("SETRYN_PRIMARY_ACCOUNT_V1"));
export const EMPTY_ID = `0x${"0".repeat(64)}` as Hex;
export const PUBLIC_SERIES_POLICY = keccak256(stringToHex("SETRYN_POLICY_PUBLIC_SERIES_V1"));
/** Seconds a maker order must remain live past the latest block so it cannot expire before the match lands. */
export const MAKER_DEADLINE_MARGIN_SECONDS = BigInt(15);
const CONSIDERATION_ENTRY = 1;

export const positionLifecycleAbi = parseAbi([
  "function positionStatus(bytes32 positionId) view returns (uint8)",
  "event PositionQuantityChanged(bytes32 indexed positionId, uint128 remainingLots, uint128 exercisedLots, uint128 closedLots, uint64 lifecycleNonce, bytes32 indexed transitionReference)",
]);

export const vaultAbi = parseAbi([
  "function deriveAccountId(address creator, bytes32 salt) view returns (bytes32 accountId)",
  "function deriveCollateralId(bytes32 assetId, uint32 bindingVersion) view returns (bytes32 collateralId)",
  "function accountExists(bytes32 accountId) view returns (bool exists)",
  "function balanceOf(bytes32 accountId, bytes32 collateralId) view returns (uint128 total, uint128 locked, uint128 available)",
  "function isLockOperator(bytes32 accountId, address operator) view returns (bool approved)",
  "function setLockOperator(bytes32 accountId, address operator, bool approved)",
]);

// Canonical enum tables. Keys are the Solidity enum values.
export const ORDER_STATUS = { 1: "WORKING", 2: "PARTIALLY_FILLED", 3: "FILLED", 4: "CANCELLED", 5: "EXPIRED" } as const;
export const ORDER_SIDE = { 1: "LONG", 2: "SHORT" } as const;
export const TIME_IN_FORCE = { 1: "GTC", 2: "GTD", 3: "IOC", 4: "FOK" } as const;
export const CHANNEL_KIND = { 1: "DIRECT_BOOK", 2: "PRIVATE_RFQ" } as const;
const POSITION_STATUS_ACTIVE = 1;
const BOOK_ORDER_RESTING = 1;

export type OrderStateName = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
export type SideName = (typeof ORDER_SIDE)[keyof typeof ORDER_SIDE];
export type TimeInForceName = (typeof TIME_IN_FORCE)[keyof typeof TIME_IN_FORCE];
export type ChannelName = (typeof CHANNEL_KIND)[keyof typeof CHANNEL_KIND];

function canonical<T extends Record<number, string>>(table: T, value: number, name: string): T[keyof T] {
  const mapped = table[value as keyof T];
  if (mapped === undefined) throw new Error(`UNRECOGNIZED_${name}_${value}`);
  return mapped;
}

export const sideName = (value: number) => canonical(ORDER_SIDE, value, "ORDER_SIDE");
export const timeInForceName = (value: number) => canonical(TIME_IN_FORCE, value, "TIME_IN_FORCE");
export const channelName = (value: number) => canonical(CHANNEL_KIND, value, "CHANNEL_KIND");

/** Same rule as the platform: an open order past its deadline on the chain clock reads as expired. */
export function orderStateName(status: number, expired: boolean): OrderStateName {
  const state = canonical(ORDER_STATUS, status, "ORDER_STATUS");
  if ((state === "WORKING" || state === "PARTIALLY_FILLED") && expired) return "EXPIRED";
  return state;
}

/** Onchain price ticks to the package price of the market that trades on that grid. */
export const ticksToPrice = (market: SetrynRuntimeMarket, ticks: bigint) => marketTicksToPrice(market, ticks);
export const minorToUsd = (minor: bigint) => Number(formatUnits(minor, 6));
const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

export interface ChainContext {
  setryn: SetrynRuntime;
  client: PublicClient;
  headBlock: bigint;
  /** Pending-block timestamp: the clock order deadlines are checked against. */
  chainTime: bigint;
  /** The active fee schedule (15 s cache): the version orders sign, its rates, and the book it keys. */
  feeSchedule: ActiveFeeSchedule;
}

const CLIENTS_KEY = Symbol.for("setryn.public-api.clients");
const CACHE_KEY = Symbol.for("setryn.public-api.block-cache");
const PROJECTION_VERSION = 3;

function clientFor(rpcUrl: string): PublicClient {
  const holder = globalThis as unknown as Record<symbol, Map<string, PublicClient> | undefined>;
  holder[CLIENTS_KEY] ??= new Map();
  let client = holder[CLIENTS_KEY].get(rpcUrl);
  if (!client) {
    client = createPublicClient({ transport: http(rpcUrl, { batch: true }) }) as PublicClient;
    holder[CLIENTS_KEY].set(rpcUrl, client);
  }
  return client;
}

export async function chainContext(): Promise<ChainContext> {
  const setryn = await readLocalRuntime();
  const client = clientFor(setryn.rpcUrl);
  const [headBlock, pending, feeSchedule] = await Promise.all([
    client.getBlockNumber({ cacheTime: 0 }),
    client.getBlock({ blockTag: "pending" }),
    readActiveFeeSchedule(setryn, { client }),
  ]);
  return { setryn, client, headBlock, chainTime: pending.timestamp, feeSchedule };
}

/** Memoizes a projection for one head block of one deployment, so a burst of reads costs one chain scan. */
function cachedByBlock<T>(name: string, context: ChainContext, loader: () => Promise<T>): Promise<T> {
  const holder = globalThis as unknown as Record<symbol, Map<string, { key: string; value: Promise<T> }> | undefined>;
  holder[CACHE_KEY] ??= new Map();
  const cache = holder[CACHE_KEY];
  // The projection version is part of the key so a reloaded module never reads a value of an older shape.
  const key = `${PROJECTION_VERSION}:${context.setryn.orderState}:${context.headBlock}`;
  const hit = cache.get(name);
  if (hit && hit.key === key) return hit.value;
  const value = loader().catch((error: unknown) => {
    cache.delete(name);
    throw error;
  });
  cache.set(name, { key, value });
  return value;
}

/** The direct public book of one onchain market's series under one series and fee schedule version pair. */
export function deriveBookId(
  setryn: SetrynRuntime,
  market: SetrynRuntimeMarket,
  versions: Pick<MarketTradingVersions, "seriesVersion" | "feeScheduleVersion">,
): Hex {
  return deriveSeriesBookId(setryn, market.seriesId, versions);
}

/** The versions an order on `market` signs right now: its series' active version and that market's fee version. */
export function activeVersions(context: ChainContext, market: SetrynRuntimeMarket): MarketTradingVersions {
  return marketTradingVersions(context.feeSchedule, market.seriesId);
}

/** The onchain market of a catalog market id, or null when that catalog market is preview-only on this deployment. */
export function onchainMarket(setryn: SetrynRuntime, catalogMarketId: string): SetrynRuntimeMarket | null {
  return runtimeMarketByKey(setryn, catalogMarketId);
}

/** The onchain market a series trades as, or null for a series the runtime does not list. */
export function marketOfSeries(setryn: SetrynRuntime, seriesId: string): SetrynRuntimeMarket | null {
  return runtimeMarketBySeries(setryn, seriesId);
}

/** Collateral the contracts reserve per lot on one side of a market, in settlement minor units. */
export function liabilityPerLotMinor(market: SetrynRuntimeMarket, side: number): bigint {
  return BigInt(side === 1 ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot);
}

export function deriveAccountId(context: ChainContext, signer: Address): Promise<Hex> {
  return context.client.readContract({
    address: context.setryn.collateralVault,
    abi: vaultAbi,
    functionName: "deriveAccountId",
    args: [signer, ACCOUNT_SALT],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Account

export interface ApiAccount {
  accountId: Hex;
  exists: boolean;
  collateralAsset: string;
  collateralId: Hex;
  postedUsd: number;
  reservedUsd: number;
  availableUsd: number;
  postedMinor: string;
  reservedMinor: string;
  availableMinor: string;
}

export async function loadAccount(context: ChainContext, accountId: Hex): Promise<ApiAccount> {
  const { client, setryn } = context;
  const [collateralId, exists] = await Promise.all([
    client.readContract({ address: setryn.collateralVault, abi: vaultAbi, functionName: "deriveCollateralId", args: [setryn.settlementAssetId, 1] }),
    client.readContract({ address: setryn.collateralVault, abi: vaultAbi, functionName: "accountExists", args: [accountId] }),
  ]);
  const [total, locked, available] = exists
    ? await client.readContract({ address: setryn.collateralVault, abi: vaultAbi, functionName: "balanceOf", args: [accountId, collateralId] })
    : ([BigInt(0), BigInt(0), BigInt(0)] as const);
  return {
    accountId,
    exists,
    collateralAsset: "sUSD",
    collateralId,
    postedUsd: minorToUsd(total),
    reservedUsd: minorToUsd(locked),
    availableUsd: minorToUsd(available),
    postedMinor: total.toString(),
    reservedMinor: locked.toString(),
    availableMinor: available.toString(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fills, positions and receipts

type OrderRecord = Awaited<ReturnType<typeof readOrder>>;

const orderStateReadAbi = [...orderStateAbi, ...parseAbi(["error UnknownOrder(bytes32 orderHash)"])] as const;

function readOrder(context: ChainContext, orderHash: Hex) {
  return context.client.readContract({
    address: context.setryn.orderState,
    abi: orderStateReadAbi,
    functionName: "getOrder",
    args: [orderHash],
  });
}

/** The order record, or null when OrderState has no such order (getOrder reverts for unknown hashes). */
export async function readOrderIfRegistered(context: ChainContext, orderHash: Hex): Promise<OrderRecord | null> {
  try {
    return await readOrder(context, orderHash);
  } catch (error) {
    // Matched by name: error classes are not guaranteed to be one module instance across server bundles.
    const reverted =
      error instanceof Error && typeof (error as BaseError).walk === "function"
        ? ((error as BaseError).walk((cause) => (cause as Error).name === "ContractFunctionRevertedError") as
            | (Error & { data?: { errorName?: string } })
            | null)
        : null;
    if (reverted?.data?.errorName === "UnknownOrder") return null;
    throw error;
  }
}

interface RawFill {
  fillId: Hex;
  positionId: Hex;
  seriesId: Hex;
  transactionHash: Hex;
  clearedAt: bigint;
  fillLots: bigint;
  executionPriceTicks: bigint;
  channelKind: number;
  takerOrderHash: Hex;
  makerOrderHash: Hex;
  taker: OrderRecord;
  maker: OrderRecord;
  positionLive: boolean;
}

interface LedgerFlow {
  args: { fillId?: Hex; kind?: number; payerAccountId?: Hex; receiverAccountId?: Hex; amount?: bigint };
}

interface ChainActivity {
  fills: RawFill[];
  ledgerEvents: (LedgerFlow & { args: { fillId?: Hex; kind?: number; payerAccountId?: Hex; amount?: bigint } })[];
  feeEvents: { transactionHash: Hex; args: { kind?: number; accountId?: Hex; amountMinor?: bigint } }[];
  closings: Map<string, { reference: Hex; transactionHash: Hex }>;
  closedByReference: Map<string, string[]>;
}

/** Every fill of the deployment in chain order, with both orders, read from clearing and position events. */
function loadChainActivity(context: ChainContext): Promise<ChainActivity> {
  return cachedByBlock("activity", context, async () => {
    const { client, setryn } = context;
    const range = { fromBlock: BigInt(0), toBlock: context.headBlock } as const;
    const [positionEvents, ledgerEvents, quantityEvents, feeEvents] = await Promise.all([
      client.getContractEvents({ address: setryn.atomicClearingEngine, abi: atomicClearingAbi, eventName: "FillPositionCreated", ...range }),
      client.getContractEvents({ address: setryn.atomicClearingEngine, abi: atomicClearingAbi, eventName: "FillLedgerEntry", ...range }),
      client.getContractEvents({ address: setryn.positionEngine, abi: positionLifecycleAbi, eventName: "PositionQuantityChanged", ...range }),
      client.getContractEvents({ address: setryn.fundedFeeEngine, abi: fundedFeeLedgerAbi, eventName: "FeeLedgerEntryRecorded", ...range }),
    ]);
    // A full exit closes the original position and the close-fill position in one lifecycle action, so both carry the
    // same transition reference on the event that takes them to zero remaining lots.
    const closings = new Map<string, { reference: Hex; transactionHash: Hex }>();
    const closedByReference = new Map<string, string[]>();
    for (const event of quantityEvents) {
      const { positionId, remainingLots, transitionReference } = event.args;
      if (!positionId || !transitionReference || remainingLots !== BigInt(0)) continue;
      const key = positionId.toLowerCase();
      closings.set(key, { reference: transitionReference, transactionHash: event.transactionHash });
      closedByReference.set(transitionReference, [...(closedByReference.get(transitionReference) ?? []), key]);
    }
    const fills = await Promise.all(
      positionEvents
        .filter((event) => event.args.fillId && event.args.positionId && event.args.seriesId)
        .map(async (event) => {
          const fillId = event.args.fillId as Hex;
          const positionId = event.args.positionId as Hex;
          const [fill, positionStatus] = await Promise.all([
            client.readContract({ address: setryn.atomicClearingEngine, abi: atomicClearingAbi, functionName: "getFill", args: [fillId] }),
            client.readContract({ address: setryn.positionEngine, abi: positionLifecycleAbi, functionName: "positionStatus", args: [positionId] }),
          ]);
          const [maker, taker] = await Promise.all([readOrder(context, fill.makerOrderHash), readOrder(context, fill.takerOrderHash)]);
          return {
            fillId,
            positionId,
            seriesId: event.args.seriesId as Hex,
            transactionHash: event.transactionHash,
            clearedAt: fill.clearedAt,
            fillLots: fill.fillLots,
            executionPriceTicks: fill.executionPriceTicks,
            channelKind: fill.channelKind,
            takerOrderHash: fill.takerOrderHash,
            makerOrderHash: fill.makerOrderHash,
            taker,
            maker,
            positionLive: positionStatus === POSITION_STATUS_ACTIVE,
          } satisfies RawFill;
        }),
    );
    return { fills, ledgerEvents, feeEvents, closings, closedByReference };
  });
}

/** Consideration the account received minus what it paid on one fill, in settlement minor units, from the clearing ledger. */
function netConsiderationMinor(events: readonly LedgerFlow[], fillId: string, accountId: string): bigint {
  let net = BigInt(0);
  for (const { args } of events) {
    if (args.fillId?.toLowerCase() !== fillId.toLowerCase() || args.kind !== CONSIDERATION_ENTRY || args.amount == null) continue;
    if (args.receiverAccountId?.toLowerCase() === accountId.toLowerCase()) net += args.amount;
    if (args.payerAccountId?.toLowerCase() === accountId.toLowerCase()) net -= args.amount;
  }
  return net;
}

export interface ApiPosition {
  positionId: Hex;
  marketId: string;
  side: SideName;
  lots: number;
  entryPrice: number;
  entryPriceTicks: string;
  collateralUsd: number;
  state: "ACTIVE";
  openedByFillId: Hex;
  transactionHash: Hex;
  openedAt: string;
}

export interface ApiFill {
  fillId: Hex;
  orderHash: Hex;
  role: "TAKER" | "MAKER";
  marketId: string;
  side: SideName;
  route: ChannelName;
  requestedLots: number;
  filledLots: number;
  cancelledLots: number;
  price: number;
  priceTicks: string;
  feesUsd: number;
  feesMinor: string;
  positionId: Hex;
  positionLive: boolean;
  outcome: "OPENED" | "CLOSED";
  closedPositionId: Hex | null;
  transactionHash: Hex;
  createdAt: string;
}

export interface ApiReceipt {
  receiptId: Hex;
  fillId: Hex;
  orderHash: Hex;
  transactionHash: Hex;
  marketId: string;
  packageCode: string;
  side: SideName;
  route: ChannelName;
  routeLabel: string;
  lots: number;
  requestedLots: number;
  filledLots: number;
  cancelledLots: number;
  price: number;
  feesUsd: number;
  realizedPnlUsd: number | null;
  collateralReleasedUsd: number | null;
  guarantee: string;
  evidence: "DEVNET" | "TESTNET";
  createdAt: string;
}

export interface AccountActivity {
  fills: ApiFill[];
  positions: ApiPosition[];
  receipts: ApiReceipt[];
  orderLinks: Map<string, { fillIds: Hex[]; receiptIds: Hex[] }>;
}

/** The platform's per-account activity projection (fills, live positions, receipts), newest first. */
export function loadAccountActivity(context: ChainContext, accountId: Hex): Promise<AccountActivity> {
  return cachedByBlock(`account:${accountId.toLowerCase()}`, context, async () => {
    const { setryn } = context;
    const activity = await loadChainActivity(context);
    const account = accountId.toLowerCase();
    const own = [];
    for (const fill of activity.fills) {
      const market = marketOfSeries(setryn, fill.seriesId);
      if (!market) continue;
      const isTaker = fill.taker.order.accountId.toLowerCase() === account;
      const isMaker = fill.maker.order.accountId.toLowerCase() === account;
      if (!isTaker && !isMaker) continue;
      const ownRecord = isTaker ? fill.taker : fill.maker;
      const filledLots = Number(fill.fillLots);
      const side = sideName(ownRecord.order.side);
      const ownFeeKind = isTaker ? 3 : 2;
      // Fees are charged by the funded fee engine in the fill's transaction, or on the clearing ledger when funded
      // from a direct fee lock.
      const feeMinor =
        (activity.ledgerEvents.find(
          (event) =>
            event.args.fillId === fill.fillId &&
            event.args.kind === ownFeeKind &&
            event.args.payerAccountId?.toLowerCase() === account,
        )?.args.amount ?? BigInt(0)) +
        accountFeesPaidMinor(
          activity.feeEvents.filter((event) => event.transactionHash === fill.transactionHash),
          accountId,
        );
      const requestedLots = isTaker ? Number(ownRecord.order.lots) : filledLots;
      const tif = timeInForceName(ownRecord.order.timeInForce);
      const perLot = side === "LONG" ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot;
      own.push({
        fill,
        market,
        role: isTaker ? ("TAKER" as const) : ("MAKER" as const),
        orderHash: isTaker ? fill.takerOrderHash : fill.makerOrderHash,
        side,
        filledLots,
        requestedLots,
        cancelledLots: isTaker && (tif === "IOC" || tif === "FOK") ? requestedLots - Number(ownRecord.filledLots) : 0,
        feeMinor,
        collateralUsd: (filledLots * Number(perLot)) / 1_000_000,
        createdAt: iso(fill.clearedAt),
      });
    }
    // Pair each exit fill with the position it closed: the earlier fill opened it, the later one hedged it out.
    const byPosition = new Map(own.map((record, index) => [record.fill.positionId.toLowerCase(), { record, index }]));
    const closedBy = new Map<string, true>();
    const closes = new Map<string, { entry: (typeof own)[number]; transactionHash: Hex }>();
    for (const [positionKey, closing] of activity.closings) {
      const mine = byPosition.get(positionKey);
      if (!mine || closedBy.has(positionKey) || closes.has(positionKey)) continue;
      const peerKey = activity.closedByReference.get(closing.reference)?.find((candidate) => candidate !== positionKey);
      const peer = peerKey ? byPosition.get(peerKey) : undefined;
      if (!peer || peer.record.side === mine.record.side) continue;
      const [entry, exit] = mine.index < peer.index ? [mine.record, peer.record] : [peer.record, mine.record];
      closedBy.set(entry.fill.positionId.toLowerCase(), true);
      closes.set(exit.fill.positionId.toLowerCase(), { entry, transactionHash: closing.transactionHash });
    }

    const fills: ApiFill[] = [];
    const positions: ApiPosition[] = [];
    const receipts: ApiReceipt[] = [];
    const orderLinks = new Map<string, { fillIds: Hex[]; receiptIds: Hex[] }>();
    for (const record of own) {
      const { fill } = record;
      const positionKey = fill.positionId.toLowerCase();
      const closedEntry = closes.get(positionKey);
      const entry = closedEntry?.entry;
      const opened = !closedEntry && (fill.positionLive || closedBy.has(positionKey));
      const route = channelName(fill.channelKind);
      const price = ticksToPrice(record.market, fill.executionPriceTicks);
      const marketId = record.market.marketKey;
      fills.push({
        fillId: fill.fillId,
        orderHash: record.orderHash,
        role: record.role,
        marketId,
        side: record.side,
        route,
        requestedLots: record.requestedLots,
        filledLots: record.filledLots,
        cancelledLots: record.cancelledLots,
        price,
        priceTicks: fill.executionPriceTicks.toString(),
        feesUsd: minorToUsd(record.feeMinor),
        feesMinor: record.feeMinor.toString(),
        positionId: fill.positionId,
        positionLive: fill.positionLive,
        outcome: opened ? "OPENED" : "CLOSED",
        closedPositionId: opened ? null : (entry?.fill.positionId ?? fill.positionId),
        transactionHash: fill.transactionHash,
        createdAt: record.createdAt,
      });
      receipts.push({
        receiptId: fill.fillId,
        fillId: fill.fillId,
        orderHash: record.orderHash,
        transactionHash: fill.transactionHash,
        marketId,
        packageCode: marketId,
        side: record.side,
        route,
        routeLabel: route === "PRIVATE_RFQ" ? "Private firm RFQ" : "Direct package book",
        lots: record.filledLots,
        requestedLots: record.requestedLots,
        filledLots: record.filledLots,
        cancelledLots: record.cancelledLots,
        price,
        feesUsd: minorToUsd(record.feeMinor),
        realizedPnlUsd: entry
          ? minorToUsd(
              netConsiderationMinor(activity.ledgerEvents, entry.fill.fillId, accountId) +
                netConsiderationMinor(activity.ledgerEvents, fill.fillId, accountId),
            )
          : null,
        collateralReleasedUsd: entry ? entry.collateralUsd + record.collateralUsd : null,
        guarantee: "Atomic onchain settlement",
        evidence: setryn.chainId === 31337 ? "DEVNET" : "TESTNET",
        createdAt: record.createdAt,
      });
      if (fill.positionLive) {
        positions.push({
          positionId: fill.positionId,
          marketId,
          side: record.side,
          lots: record.filledLots,
          entryPrice: price,
          entryPriceTicks: fill.executionPriceTicks.toString(),
          collateralUsd: record.collateralUsd,
          state: "ACTIVE",
          openedByFillId: fill.fillId,
          transactionHash: fill.transactionHash,
          openedAt: record.createdAt,
        });
      }
      const links = orderLinks.get(record.orderHash.toLowerCase()) ?? { fillIds: [], receiptIds: [] };
      links.fillIds.push(fill.fillId);
      links.receiptIds.push(fill.fillId);
      orderLinks.set(record.orderHash.toLowerCase(), links);
    }
    return { fills: fills.reverse(), positions: positions.reverse(), receipts: receipts.reverse(), orderLinks };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Orders

export interface ApiOrder {
  orderHash: Hex;
  accountId: Hex;
  signer: Address;
  marketId: string;
  /** DIRECT_BOOK for public book orders; PRIVATE_RFQ for the taker order behind a private RFQ. */
  route: ChannelName;
  side: SideName;
  lots: number;
  filledLots: number;
  remainingLots: number;
  limitPrice: number;
  priceTicks: string;
  timeInForce: TimeInForceName;
  postOnly: boolean;
  state: OrderStateName;
  statusCode: number;
  deadline: string;
  maxFeeUsd: number;
  collateralReservationUsd: number;
  riskAdmissionId: Hex | null;
  fillIds: Hex[];
  receiptIds: Hex[];
  createdAt: string;
}

async function projectOrder(
  context: ChainContext,
  orderHash: Hex,
  record: OrderRecord,
  market: SetrynRuntimeMarket,
): Promise<ApiOrder> {
  const { client, setryn } = context;
  const admissionId = await client.readContract({
    address: setryn.riskAdmissionBindingRegistry,
    abi: riskBindingAbi,
    functionName: "admissionForOrder",
    args: [orderHash],
  });
  const admission =
    admissionId === EMPTY_ID
      ? null
      : await client.readContract({ address: setryn.portfolioRiskEngine, abi: riskEngineAbi, functionName: "getAdmission", args: [admissionId] });
  const activity = await loadAccountActivity(context, record.order.accountId);
  const links = activity.orderLinks.get(orderHash.toLowerCase());
  const lots = Number(record.order.lots);
  const filledLots = Number(record.filledLots);
  return {
    orderHash,
    accountId: record.order.accountId,
    signer: getAddress(record.order.signer),
    marketId: market.marketKey,
    route: record.order.executionModeId.toLowerCase() === setryn.privateRfqExecutionModeId.toLowerCase() ? "PRIVATE_RFQ" : "DIRECT_BOOK",
    side: sideName(record.order.side),
    lots,
    filledLots,
    remainingLots: lots - filledLots,
    limitPrice: ticksToPrice(market, record.order.priceTicks),
    priceTicks: record.order.priceTicks.toString(),
    timeInForce: timeInForceName(record.order.timeInForce),
    postOnly: record.order.postOnly,
    state: orderStateName(record.status, record.order.deadline <= context.chainTime),
    statusCode: record.status,
    deadline: iso(record.order.deadline),
    maxFeeUsd: minorToUsd(record.order.maxFeeMinor),
    collateralReservationUsd: admission ? minorToUsd(admission.terminalLiabilityBaseUnits) : 0,
    riskAdmissionId: admissionId === EMPTY_ID ? null : admissionId,
    fillIds: links?.fillIds ?? [],
    receiptIds: links?.receiptIds ?? [],
    createdAt: iso(record.registeredAt),
  };
}

/** Expiry depends on the chain clock, which moves between blocks, so it is applied after the per-block cache. */
function withLiveState(order: ApiOrder, chainTime: bigint): ApiOrder {
  const expired = BigInt(Math.floor(Date.parse(order.deadline) / 1000)) <= chainTime;
  return { ...order, state: orderStateName(order.statusCode, expired) };
}

/** Registered orders of one account (or one signer) on every onchain market, newest first. */
export async function loadOrders(context: ChainContext, filter: { accountId: Hex } | { signer: Address }): Promise<ApiOrder[]> {
  const cacheName = "accountId" in filter ? `orders:account:${filter.accountId.toLowerCase()}` : `orders:signer:${filter.signer.toLowerCase()}`;
  const orders = await cachedByBlock(cacheName, context, async () => {
    const { client, setryn } = context;
    const logs = await client.getContractEvents({
      address: setryn.orderState,
      abi: orderStateAbi,
      eventName: "OrderRegistered",
      args: "signer" in filter ? { signer: filter.signer } : undefined,
      fromBlock: BigInt(0),
      toBlock: context.headBlock,
    });
    const hashes = [
      ...new Set(
        logs
          .filter((log) => "signer" in filter || log.args.order?.accountId.toLowerCase() === filter.accountId.toLowerCase())
          .map((log) => log.args.orderHash)
          .filter((hash): hash is Hex => hash != null),
      ),
    ];
    const orders: ApiOrder[] = [];
    for (const orderHash of hashes) {
      const record = await readOrder(context, orderHash);
      const market = marketOfSeries(setryn, record.order.seriesId);
      if (!market) continue;
      orders.push(await projectOrder(context, orderHash, record, market));
    }
    return orders.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  });
  return orders.map((order) => withLiveState(order, context.chainTime));
}

export async function loadOrder(context: ChainContext, orderHash: Hex): Promise<ApiOrder | null> {
  const record = await readOrderIfRegistered(context, orderHash);
  if (!record || record.registeredAt === BigInt(0)) return null;
  const market = marketOfSeries(context.setryn, record.order.seriesId);
  if (!market) return null;
  return projectOrder(context, orderHash, record, market);
}

// ---------------------------------------------------------------------------------------------------------------
// Public book and trade tape

export interface BookOrderRow {
  orderHash: Hex;
  side: "BID" | "ASK";
  price: number;
  priceTicks: string;
  lots: number;
  deadline: string;
}

export interface BookLevel {
  price: number;
  priceTicks: string;
  lots: number;
  orders: number;
}

export interface OnchainBook {
  bookId: Hex;
  bids: BookLevel[];
  asks: BookLevel[];
  orders: BookOrderRow[];
}

function aggregate(rows: BookOrderRow[]): BookLevel[] {
  const levels = new Map<string, BookLevel>();
  for (const row of rows) {
    const level = levels.get(row.priceTicks) ?? { price: row.price, priceTicks: row.priceTicks, lots: 0, orders: 0 };
    level.lots += row.lots;
    level.orders += 1;
    levels.set(row.priceTicks, level);
  }
  return [...levels.values()];
}

/**
 * Live resting orders of one market's direct book, as the platform shows them: resting, open and not past deadline.
 * Each onchain market rests on its own series book.
 */
export async function loadPublicBook(context: ChainContext, market: SetrynRuntimeMarket): Promise<OnchainBook> {
  const versions = activeVersions(context, market);
  const { bookId, rows } = await cachedByBlock(`book:${market.seriesId.toLowerCase()}:${versions.seriesVersion}:${versions.feeScheduleVersion}`, context, async () => {
    const { client, setryn } = context;
    const bookId = deriveBookId(setryn, market, versions);
    const events = await client.getContractEvents({
      address: setryn.publicOrderBook,
      abi: publicOrderBookAbi,
      eventName: "DirectOrderRested",
      args: { bookId },
      fromBlock: BigInt(0),
      toBlock: context.headBlock,
    });
    const hashes = [...new Set(events.map((event) => event.args.orderHash).filter((value): value is Hex => value != null))];
    const rows = (
      await Promise.all(
        hashes.map(async (orderHash) => {
          const [bookOrder, record] = await Promise.all([
            client.readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "getBookOrder", args: [orderHash] }),
            readOrder(context, orderHash),
          ]);
          const state = orderStateName(record.status, false);
          if (bookOrder.status !== BOOK_ORDER_RESTING || (state !== "WORKING" && state !== "PARTIALLY_FILLED")) return null;
          return {
            deadlineSeconds: record.order.deadline,
            orderHash,
            side: sideName(bookOrder.side) === "LONG" ? ("BID" as const) : ("ASK" as const),
            price: ticksToPrice(market, bookOrder.priceTicks),
            priceTicks: bookOrder.priceTicks.toString(),
            lots: Number(bookOrder.remainingLots),
            deadline: iso(record.order.deadline),
          };
        }),
      )
    ).filter((row) => row !== null);
    return { bookId, rows };
  });
  // Resting orders past their deadline on the chain clock are not executable; the clock moves between blocks.
  const live: BookOrderRow[] = rows
    .filter((row) => row.deadlineSeconds > context.chainTime)
    .map((row) => ({ orderHash: row.orderHash, side: row.side, price: row.price, priceTicks: row.priceTicks, lots: row.lots, deadline: row.deadline }));
  const bids = live.filter((row) => row.side === "BID").sort((left, right) => right.price - left.price);
  const asks = live.filter((row) => row.side === "ASK").sort((left, right) => left.price - right.price);
  return { bookId, bids: aggregate(bids), asks: aggregate(asks), orders: [...asks, ...bids] };
}

export interface ApiTrade {
  tradeId: Hex;
  marketId: string;
  price: number;
  priceTicks: string;
  lots: number;
  /** Aggressor side: BUY lifted the offer, SELL hit the bid. */
  aggressorSide: "BUY" | "SELL";
  route: ChannelName;
  transactionHash: Hex;
  time: string;
}

/**
 * Public tape of one onchain market, newest first. Only direct-book fills are printed: private RFQ fills settle onchain
 * but their disclosure policy keeps them off the public tape.
 */
export async function loadTrades(context: ChainContext, market: SetrynRuntimeMarket): Promise<ApiTrade[]> {
  const activity = await loadChainActivity(context);
  return activity.fills
    .filter((fill) => fill.seriesId.toLowerCase() === market.seriesId.toLowerCase() && channelName(fill.channelKind) === "DIRECT_BOOK")
    .map((fill) => ({
      tradeId: fill.fillId,
      marketId: market.marketKey,
      price: ticksToPrice(market, fill.executionPriceTicks),
      priceTicks: fill.executionPriceTicks.toString(),
      lots: Number(fill.fillLots),
      aggressorSide: sideName(fill.taker.order.side) === "LONG" ? ("BUY" as const) : ("SELL" as const),
      route: "DIRECT_BOOK" as const,
      transactionHash: fill.transactionHash,
      time: iso(fill.clearedAt),
    }))
    .reverse();
}

// ---------------------------------------------------------------------------------------------------------------
// Order entry support

/** Insertion hint for a new resting order at `priceTicks`, walking the book from its best level. */
export async function levelHint(context: ChainContext, bookId: Hex, side: 1 | 2, priceTicks: bigint) {
  const { client, setryn } = context;
  let current: Hex;
  try {
    current = await client.readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "bestLevel", args: [bookId, side] });
  } catch {
    return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };
  }
  if (current === EMPTY_ID) return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };
  let previous = EMPTY_ID;
  for (let depth = 0; depth < 256 && current !== EMPTY_ID; depth += 1) {
    const level = await client.readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "getPriceLevel", args: [current] });
    if (level.priceTicks === priceTicks) return { previousLevelId: EMPTY_ID, nextLevelId: EMPTY_ID };
    const currentBeforeIncoming = side === 1 ? level.priceTicks > priceTicks : level.priceTicks < priceTicks;
    if (!currentBeforeIncoming) return { previousLevelId: previous, nextLevelId: current };
    previous = current;
    current = level.nextLevelId;
  }
  if (current !== EMPTY_ID) throw new Error("ORDER_BOOK_DEPTH_LIMIT");
  return { previousLevelId: previous, nextLevelId: EMPTY_ID };
}

/** Head order of the best level on one side of the direct book, and whether it is still live on the chain clock. */
export async function bookHead(context: ChainContext, bookId: Hex, side: 1 | 2) {
  const { client, setryn } = context;
  const levelId = await client.readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "bestLevel", args: [bookId, side] });
  if (levelId === EMPTY_ID) return null;
  const level = await client.readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "getPriceLevel", args: [levelId] });
  const [bookOrder, record] = await Promise.all([
    client.readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "getBookOrder", args: [level.headOrderHash] }),
    readOrder(context, level.headOrderHash),
  ]);
  const live =
    (record.status === 1 || record.status === 2) && record.order.deadline > context.chainTime + MAKER_DEADLINE_MARGIN_SECONDS;
  return { orderHash: level.headOrderHash, bookOrder, record, live };
}

export function orderTypedDataDomain(setryn: SetrynRuntime) {
  return { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.orderState } as const;
}

export function hashOrder(context: ChainContext, order: OnchainPublicOrder): Promise<Hex> {
  return context.client.readContract({ address: context.setryn.orderState, abi: orderStateAbi, functionName: "hashOrder", args: [order] });
}
