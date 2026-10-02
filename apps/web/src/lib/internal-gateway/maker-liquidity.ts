import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { ensureMakerAccount, MAKER_PUBLIC_POLICY_CONTEXT, PUBLIC_SERIES_POLICY, withdrawMakerOrder } from "./designated-maker";
import { marketTradingVersions, orderFeeCapMinor, readActiveFeeSchedule, type ActiveFeeSchedule } from "./fee-schedule";
import { MakerPricingError, makerQuotes, type MakerQuote } from "./maker-pricing";
import { withMakerLock } from "./maker-lock";
import { renewQuotes, ZERO_ID, type LevelHint, type MakerBookPort, type ScannedOrder, type SideScan, type Side } from "./maker-quote-plan";
import { makerSigner, type RoleSigner } from "./operator-signer";
import {
  orderStateAbi,
  publicOrderBookAbi,
  publicOrderTypedData,
  riskBindingAbi,
  riskEngineAbi,
  type OnchainPublicOrder,
} from "./protocol";
import { reserveOrderRisk } from "./risk-admission";
import type { SetrynRuntime, SetrynRuntimeMarket } from "./runtime";
import { deriveSeriesBookId } from "./runtime-markets";

/*
 * The designated maker keeps exactly one bid and one ask resting on every active market's public book, priced from the
 * live Chainlink reference of the market's underlying (maker-pricing.ts). Each quote lives MAKER_QUOTE_LIFETIME_SECONDS;
 * a refresh reuses a live quote, renews one inside its last RENEW_MARGIN_SECONDS or one the reference has moved away
 * from, and clears expired ones off the book and out of the risk engine. Every transaction runs under the maker lock
 * (maker-lock.ts), one market at a time, so single-market and full refreshes from any server instance never interleave
 * their sends. Refreshes are driven by the connected trading application; a persistent scheduler comes later.
 */

/** The risk reservation admits deadlines up to five minutes out; a quote lives just under that. */
export const MAKER_QUOTE_LIFETIME_SECONDS = BigInt(290);
/** A quote further than this fraction of the reference from the target is re-priced even if it is not through it. */
const STALE_FRACTION = 0.0025;
const MAKER_LOTS = 10;
/** Book orders read per side when looking for the maker's own quotes. */
const MAX_SCAN_ORDERS = 32;
/** Price levels walked per side for an insertion hint; a new level past this many can only go between levels read. */
const MAX_SCAN_LEVELS = 256;
const BOOK_RESTING = 1;

const riskExpiryAbi = [
  {
    type: "function",
    name: "expireAdmission",
    stateMutability: "nonpayable",
    inputs: [{ name: "admissionId", type: "bytes32" }],
    outputs: [],
  },
] as const;

export interface MarketRefresh {
  marketId: string;
  created: Hex[];
  kept: number;
  withdrawn: number;
  cleared: number;
}

export interface MakerLiquidityResult {
  maker: Hex;
  accountId: Hex | null;
  markets: MarketRefresh[];
  /** Created order hashes, flattened, for callers that only count placements. */
  created: { marketId: string; orderHash: Hex }[];
  failed: { marketId: string; error: string }[];
  /** Markets not reached inside the time budget; the next refresh starts with them. */
  pending: string[];
}

/** Last refresh time per market in this process, so a budgeted full refresh starts with the longest-unvisited. */
const VISITED_KEY = Symbol.for("setryn.maker-liquidity.visited");

function visited(): Map<string, number> {
  const holder = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  holder[VISITED_KEY] ??= new Map();
  return holder[VISITED_KEY];
}

/**
 * Refreshes the maker's quotes on the given markets (every runtime market when `marketKeys` is null). Markets are
 * started only while `budgetMs` lasts; the rest are reported as pending.
 */
export async function refreshMakerLiquidity(setryn: SetrynRuntime, marketKeys: string[] | null, budgetMs: number): Promise<MakerLiquidityResult> {
  const started = Date.now();
  const markets = marketKeys === null ? setryn.markets : setryn.markets.filter((market) => marketKeys.includes(market.marketKey));
  if (markets.length === 0) throw new Error("MARKET_NOT_ONCHAIN_ENABLED");
  const maker = await makerSigner(setryn);
  const result: MakerLiquidityResult = { maker: maker.address, accountId: null, markets: [], created: [], failed: [], pending: [] };

  // One reference read prices every requested market; a market without a listing or a fresh reference is not quoted.
  const prices = await makerQuotes(markets);
  const priced = markets.filter((market) => {
    const quote = prices.get(market.marketKey);
    if (quote instanceof MakerPricingError) {
      result.failed.push({ marketId: market.marketKey, error: quote.code });
      return false;
    }
    return true;
  });
  if (priced.length === 0) {
    const refusal = prices.get(markets[0].marketKey) as MakerPricingError;
    throw refusal;
  }

  result.accountId = await withMakerLock(() => ensureMakerAccount(maker));
  // Quotes sign each series' active version and its market's fee schedule version; each pair has its own book.
  const fees = await readActiveFeeSchedule(setryn, { client: maker.publicClient });
  if (fees.source === "CHAIN" && !fees.active) throw new Error("FEE_SCHEDULE_INACTIVE");

  const seen = visited();
  const ordered = [...priced].sort((left, right) => (seen.get(left.marketKey) ?? 0) - (seen.get(right.marketKey) ?? 0));
  for (const market of ordered) {
    if (Date.now() - started > budgetMs) {
      result.pending.push(market.marketKey);
      continue;
    }
    try {
      const quote = prices.get(market.marketKey) as MakerQuote;
      // Each market holds the lock on its own, so a taker's single-market refresh waits for at most one market.
      const refreshed = await withMakerLock(() => refreshMarket(maker, result.accountId as Hex, fees, market, quote));
      seen.set(market.marketKey, Date.now());
      result.markets.push(refreshed);
      for (const orderHash of refreshed.created) result.created.push({ marketId: market.marketKey, orderHash });
    } catch (error) {
      result.failed.push({ marketId: market.marketKey, error: error instanceof Error ? error.message.split("\n")[0] : "QUOTE_FAILED" });
    }
  }
  return result;
}

async function refreshMarket(
  maker: RoleSigner,
  accountId: Hex,
  fees: ActiveFeeSchedule,
  market: SetrynRuntimeMarket,
  quote: MakerQuote,
): Promise<MarketRefresh> {
  const { setryn, publicClient } = maker;
  const versions = marketTradingVersions(fees, market.seriesId);
  if (fees.source === "CHAIN" && !versions.tradable) throw new Error("MARKET_FEE_SCHEDULE_PENDING");
  const bookId = deriveSeriesBookId(setryn, market.seriesId, versions);
  const block = await publicClient.getBlock({ blockTag: "pending" });
  const now = block.timestamp;
  const tolerance = BigInt(Math.max(2, Math.ceil(quote.reference.price * STALE_FRACTION * market.priceScale)));
  const port: MakerBookPort = {
    scan: (side) => scanSide(maker, bookId, side, MAX_SCAN_ORDERS),
    levels: (side) => scanSide(maker, bookId, side, 0),
    withdraw: (order) => withdrawMakerOrder(maker, order.hash, order).then(() => undefined),
    clearExpired: (order) => clearExpiredQuote(maker, order),
    pruneHead: (side, order) => pruneHead(maker, bookId, side, order.hash),
    prepare: (side, priceTicks) => prepareQuote(maker, accountId, fees, market, versions, side, priceTicks, now),
    place: (orderHash, hint) => placeOnBook(maker, orderHash, hint),
  };
  const targets: { side: Side; priceTicks: bigint }[] = [
    { side: 1, priceTicks: quote.bidTicks },
    { side: 2, priceTicks: quote.askTicks },
  ];
  return { marketId: market.marketKey, ...(await renewQuotes(port, maker.address, targets, now, tolerance)) };
}

/**
 * One side of a book read now: its level chain best to worst (up to MAX_SCAN_LEVELS) and its first `maxOrders` resting
 * orders. An uncreated book reads as empty.
 */
async function scanSide(maker: RoleSigner, bookId: Hex, side: Side, maxOrders: number): Promise<SideScan> {
  const { setryn, publicClient } = maker;
  const scan: SideScan = { levels: [], orders: [], complete: true };
  const orders = scan.orders;
  let levelId = await publicClient
    .readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "bestLevel", args: [bookId, side] })
    .catch(() => ZERO_ID);
  while (levelId !== ZERO_ID) {
    if (scan.levels.length >= MAX_SCAN_LEVELS) {
      scan.complete = false;
      break;
    }
    const level = await publicClient.readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "getPriceLevel", args: [levelId] });
    scan.levels.push({ id: levelId, priceTicks: level.priceTicks, previousLevelId: level.previousLevelId as Hex, nextLevelId: level.nextLevelId as Hex });
    let orderHash = level.headOrderHash as Hex;
    while (orderHash !== ZERO_ID && orders.length < maxOrders) {
      const [bookOrder, record] = await Promise.all([
        publicClient.readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "getBookOrder", args: [orderHash] }),
        publicClient.readContract({ address: setryn.orderState, abi: orderStateAbi, functionName: "getOrder", args: [orderHash] }),
      ]);
      orders.push({
        hash: orderHash,
        signer: record.order.signer,
        deadline: record.order.deadline,
        priceTicks: record.order.priceTicks,
        accountId: record.order.accountId,
        open: record.status === 1 || record.status === 2,
        resting: bookOrder.status === BOOK_RESTING,
      });
      orderHash = bookOrder.nextOrderHash as Hex;
    }
    levelId = level.nextLevelId as Hex;
  }
  return scan;
}

/** Signs a post-only maker quote, reserves and binds its risk, and registers it; it is not on the book yet. */
async function prepareQuote(
  maker: RoleSigner,
  accountId: Hex,
  fees: ActiveFeeSchedule,
  market: SetrynRuntimeMarket,
  versions: { seriesVersion: number; feeScheduleVersion: number },
  side: Side,
  priceTicks: bigint,
  now: bigint,
): Promise<Hex> {
  const { setryn, publicClient, walletClient } = maker;
  // Random low bits keep two quotes signed in one block from hashing to the same order.
  const nonce = now * BigInt(2 ** 32) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  const lots = BigInt(Math.min(MAKER_LOTS, market.maxOrderLots));
  const absoluteTicks = priceTicks < BigInt(0) ? -priceTicks : priceTicks;
  // A post-only quote only ever fills as maker, so its cap is the maker charge on its full consideration.
  const maxFeeMinor = orderFeeCapMinor(fees, lots * absoluteTicks * BigInt(market.tickSizeMinor), "MAKER");
  const order: OnchainPublicOrder = {
    signer: maker.address,
    accountId,
    policyId: PUBLIC_SERIES_POLICY,
    policyContextHash: MAKER_PUBLIC_POLICY_CONTEXT,
    recipient: maker.address,
    targetKind: 1,
    seriesId: market.seriesId,
    targetVersion: versions.seriesVersion,
    packageId: ZERO_ID,
    side,
    lots,
    priceTicks,
    timeInForce: 1,
    remainderPolicy: 1,
    deadline: now + MAKER_QUOTE_LIFETIME_SECONDS,
    feeScheduleId: setryn.feeScheduleId,
    feeScheduleVersion: versions.feeScheduleVersion,
    maxFeeMinor,
    executionModeId: setryn.executionModeId,
    actionId: setryn.enterActionId,
    permittedExecutor: setryn.atomicClearingEngine,
    nonce,
    salt: keccak256(encodeAbiParameters(
      [{ name: "seriesId", type: "bytes32" }, { name: "nonce", type: "uint256" }],
      [market.seriesId, nonce],
    )),
    allowPartialFills: true,
    minimumFillLots: BigInt(1),
    postOnly: true,
    reduceOnly: false,
  };
  const signature = await walletClient.signTypedData({
    domain: { name: "Setryn", version: "1", chainId: setryn.chainId, verifyingContract: setryn.orderState },
    types: publicOrderTypedData,
    primaryType: "PublicOrder",
    message: order,
  });
  const orderHash = await publicClient.readContract({ address: setryn.orderState, abi: orderStateAbi, functionName: "hashOrder", args: [order] });
  const { admissionId } = await reserveOrderRisk(setryn, order, signature, orderHash).catch((error: unknown) => {
    console.error("[maker-liquidity] risk reservation", error instanceof Error ? error.message.split("\n")[0] : error);
    throw new Error("MAKER_RISK_RESERVATION_FAILED");
  });
  const send = async (hash: Promise<Hex>, failure: string) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: await hash });
    if (receipt.status !== "success") throw new Error(failure);
  };
  await send(
    walletClient.writeContract({ chain: null, address: setryn.riskAdmissionBindingRegistry, abi: riskBindingAbi, functionName: "bindOrderRisk", args: [order, admissionId] }),
    "MAKER_RISK_BINDING_FAILED",
  );
  await send(
    walletClient.writeContract({ chain: null, address: setryn.orderState, abi: orderStateAbi, functionName: "registerSignedOrder", args: [order, signature] }),
    "MAKER_ORDER_REGISTRATION_FAILED",
  );
  return orderHash;
}

/**
 * Rests a registered quote on its book between the hinted levels. Simulated first so a level chain that moved since the
 * hint was read surfaces as InvalidLevelHint (and is retried with a fresh hint) instead of as a reverted transaction.
 */
async function placeOnBook(maker: RoleSigner, orderHash: Hex, hint: LevelHint): Promise<void> {
  const { setryn, publicClient, walletClient } = maker;
  const placement = { address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "placeSeriesOrder", args: [orderHash, hint] } as const;
  await publicClient.simulateContract({ account: maker.address, ...placement });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: await walletClient.writeContract({ chain: null, ...placement }) });
  if (receipt.status !== "success") throw new Error("MAKER_ORDER_PLACEMENT_FAILED");
}

/** An expired maker quote comes off the book (wherever it rests) and its risk admission is released. */
async function clearExpiredQuote(maker: RoleSigner, order: ScannedOrder): Promise<void> {
  const { setryn, publicClient, walletClient } = maker;
  if (order.resting) {
    // The pending block can run ahead of the book's own clock; an order the book still holds eligible stays for now.
    const syncable = await publicClient
      .simulateContract({ account: maker.address, address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "syncOrder", args: [order.hash] })
      .then(() => true)
      .catch(() => false);
    if (!syncable) return;
    const hash = await walletClient.writeContract({ chain: null, address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "syncOrder", args: [order.hash] });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  await expireMakerAdmission(maker, order.hash);
}

/** Prunes someone else's expired order from the head of a side; best effort, true when it came off. */
async function pruneHead(maker: RoleSigner, bookId: Hex, side: Side, orderHash: Hex): Promise<boolean> {
  const { setryn, publicClient, walletClient } = maker;
  const prunable = await publicClient
    .simulateContract({ account: maker.address, address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "pruneBest", args: [bookId, side, [orderHash]] })
    .then(() => true)
    .catch(() => false);
  if (!prunable) return false;
  const hash = await walletClient.writeContract({ chain: null, address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "pruneBest", args: [bookId, side, [orderHash]] });
  return (await publicClient.waitForTransactionReceipt({ hash })).status === "success";
}

/** An expired maker quote no longer holds risk: its admission is released through the permissionless expiry. */
async function expireMakerAdmission(maker: RoleSigner, orderHash: Hex): Promise<void> {
  const { setryn, publicClient, walletClient } = maker;
  const admissionId = await publicClient.readContract({
    address: setryn.riskAdmissionBindingRegistry,
    abi: riskBindingAbi,
    functionName: "admissionForOrder",
    args: [orderHash],
  });
  if (admissionId === ZERO_ID) return;
  const admission = await publicClient.readContract({ address: setryn.portfolioRiskEngine, abi: riskEngineAbi, functionName: "getAdmission", args: [admissionId] });
  if (admission.status !== 1) return;
  const expirable = await publicClient
    .simulateContract({ account: maker.address, address: setryn.portfolioRiskEngine, abi: riskExpiryAbi, functionName: "expireAdmission", args: [admissionId] })
    .then(() => true)
    .catch(() => false);
  if (!expirable) return;
  const hash = await walletClient.writeContract({ chain: null, address: setryn.portfolioRiskEngine, abi: riskExpiryAbi, functionName: "expireAdmission", args: [admissionId] });
  await publicClient.waitForTransactionReceipt({ hash });
}
