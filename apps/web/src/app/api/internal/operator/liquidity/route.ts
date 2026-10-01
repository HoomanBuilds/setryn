import { encodeAbiParameters, keccak256, type Hex } from "viem";
import {
  ensureMakerAccount,
  MAKER_PUBLIC_POLICY_CONTEXT,
  PUBLIC_SERIES_POLICY,
  withdrawMakerOrder,
} from "@/lib/internal-gateway/designated-maker";
import {
  marketTradingVersions,
  orderFeeCapMinor,
  readActiveFeeSchedule,
  type ActiveFeeSchedule,
} from "@/lib/internal-gateway/fee-schedule";
import { MakerPricingError, makerQuotes, type MakerQuote } from "@/lib/internal-gateway/maker-pricing";
import { withMakerLock } from "@/lib/internal-gateway/maker-lock";
import { makerSigner, signerUnavailableResponse, type RoleSigner } from "@/lib/internal-gateway/operator-signer";
import {
  orderStateAbi,
  publicOrderBookAbi,
  publicOrderTypedData,
  riskBindingAbi,
  riskEngineAbi,
  type OnchainPublicOrder,
} from "@/lib/internal-gateway/protocol";
import { reserveOrderRisk } from "@/lib/internal-gateway/risk-admission";
import type { SetrynNetwork, SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import { deriveSeriesBookId } from "@/lib/internal-gateway/runtime-markets";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const ZERO_ID = `0x${"0".repeat(64)}` as Hex;
const MAKER_LOTS = 10;
const SEPOLIA_MAKER_LOTS = 1;

/** Faucet-sized testnet quotes rest one lot; every other network rests ten lots. */
function makerLotsForNetwork(network: SetrynNetwork | undefined): number {
  return network === "arbitrum-sepolia" ? SEPOLIA_MAKER_LOTS : MAKER_LOTS;
}
/** The risk reservation admits deadlines up to five minutes out; a longer-lived quote churns the book less. */
const QUOTE_LIFETIME_SECONDS = BigInt(290);

const riskExpiryAbi = [
  {
    type: "function",
    name: "expireAdmission",
    stateMutability: "nonpayable",
    inputs: [{ name: "admissionId", type: "bytes32" }],
    outputs: [],
  },
] as const;

interface QuoteContext {
  maker: RoleSigner;
  accountId: Hex;
  fees: ActiveFeeSchedule;
}

/**
 * The designated maker keeps one resting order at the top of each side of every market's book, priced from the live
 * Chainlink reference of the market's underlying (lib/internal-gateway/maker-pricing.ts). It runs only where a maker
 * can sign: the local operator account, or SETRYN_MAKER_PRIVATE_KEY on a network. A market without a network listing
 * (schema 9 or 10 runtime) or without a fresh reference is reported, never quoted from anything else.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { marketId?: unknown };
  // Every connected page asks for a full refresh on a timer, so concurrent full refreshes share one run, and one that
  // finished moments ago answers again. A single market's refresh (a taker found its book empty) always runs.
  if (typeof body.marketId === "string") return refresh(body.marketId);
  const shared = fullRefresh();
  if (shared.running) return (await shared.running).clone();
  if (shared.last && Date.now() - shared.last.at < FULL_REFRESH_REUSE_MS) return shared.last.response.clone();
  shared.running = refresh(null)
    .then((response) => {
      shared.last = { at: Date.now(), response: response.clone() };
      return response;
    })
    .finally(() => {
      shared.running = null;
    });
  return (await shared.running).clone();
}

/** How long a finished full refresh answers further full-refresh requests. */
const FULL_REFRESH_REUSE_MS = 10_000;
const FULL_REFRESH_KEY = Symbol.for("setryn.maker-liquidity.full-refresh");

interface FullRefreshState {
  running: Promise<Response> | null;
  last: { at: number; response: Response } | null;
}

function fullRefresh(): FullRefreshState {
  const holder = globalThis as unknown as Record<symbol, FullRefreshState | undefined>;
  holder[FULL_REFRESH_KEY] ??= { running: null, last: null };
  return holder[FULL_REFRESH_KEY];
}

async function refresh(marketId: string | null): Promise<Response> {
  try {
    const setryn = await readRuntime();
    const markets = marketId !== null ? setryn.markets.filter((market) => market.marketKey === marketId) : setryn.markets;
    if (markets.length === 0) return Response.json({ error: "MARKET_NOT_ONCHAIN_ENABLED" }, { status: 404, headers: NO_STORE });
    const maker = await makerSigner(setryn);

    // One reference read prices every requested market; a runtime with no listing quotes nothing.
    const prices = await makerQuotes(markets);
    const priced = markets.filter((market) => !(prices.get(market.marketKey) instanceof MakerPricingError));
    if (priced.length === 0) {
      const refusal = prices.get(markets[0].marketKey) as MakerPricingError;
      return Response.json(
        {
          error: refusal.code,
          message: refusal.detail,
          failed: markets.map((market) => ({ marketId: market.marketKey, error: (prices.get(market.marketKey) as MakerPricingError).code })),
        },
        { status: refusal.status, headers: NO_STORE },
      );
    }

    const accountId = await withMakerLock(() => ensureMakerAccount(maker));
    // Quotes sign each series' active version and its market's fee schedule version; each pair has its own book.
    const fees = await readActiveFeeSchedule(setryn, { client: maker.publicClient });
    if (fees.source === "CHAIN" && !fees.active) {
      return Response.json({ error: "FEE_SCHEDULE_INACTIVE" }, { status: 422, headers: NO_STORE });
    }
    const context: QuoteContext = { maker, accountId, fees };
    const created: { marketId: string; orderHash: Hex }[] = [];
    const failed: { marketId: string; error: string }[] = markets
      .filter((market) => prices.get(market.marketKey) instanceof MakerPricingError)
      .map((market) => ({ marketId: market.marketKey, error: (prices.get(market.marketKey) as MakerPricingError).code }));
    // One maker account signs every quote, so markets are quoted in turn under the maker lock. Each market holds the
    // lock on its own, so a single-market refresh from a taker's order waits for at most one market ahead of it.
    for (const market of priced) {
      try {
        const quote = prices.get(market.marketKey) as MakerQuote;
        const hashes = await withMakerLock(() => quoteMarket(context, market, quote));
        for (const orderHash of hashes) created.push({ marketId: market.marketKey, orderHash });
      } catch (error) {
        failed.push({ marketId: market.marketKey, error: error instanceof Error ? error.message.split("\n")[0] : "QUOTE_FAILED" });
      }
    }
    // Every requested market failing is a failed refresh; a partial one still returns what it placed.
    const status = failed.length === markets.length ? 422 : 200;
    return Response.json(
      { maker: maker.address, accountId, created, failed, ...(status === 422 ? { error: failed[0]?.error ?? "MAKER_LIQUIDITY_FAILED" } : {}) },
      { status, headers: NO_STORE },
    );
  } catch (error) {
    const unavailable = signerUnavailableResponse(error);
    if (unavailable) return unavailable;
    const message = error instanceof Error ? error.message.split("\n")[0] : "MAKER_LIQUIDITY_FAILED";
    return Response.json({ error: message }, { status: 422, headers: NO_STORE });
  }
}

/**
 * Keeps one live maker order at the top of each side of a market's book. Expired heads are pruned; a maker order the
 * reference has moved through (a bid above the current bid, an ask below the current ask) is withdrawn and replaced.
 */
async function quoteMarket(context: QuoteContext, market: SetrynRuntimeMarket, quote: MakerQuote): Promise<Hex[]> {
  const { maker, fees } = context;
  const { setryn, publicClient, walletClient } = maker;
  const versions = marketTradingVersions(fees, market.seriesId);
  if (fees.source === "CHAIN" && !versions.tradable) throw new Error("MARKET_FEE_SCHEDULE_PENDING");
  const bookId = deriveSeriesBookId(setryn, market.seriesId, versions);
  const block = await publicClient.getBlock({ blockTag: "pending" });
  const created: Hex[] = [];
  const sides = [
    { side: 1 as const, priceTicks: quote.bidTicks },
    { side: 2 as const, priceTicks: quote.askTicks },
  ];
  for (const target of sides) {
    const bestLevelOf = () =>
      publicClient
        .readContract({ address: setryn.publicOrderBook, abi: publicOrderBookAbi, functionName: "bestLevel", args: [bookId, target.side] })
        .catch(() => ZERO_ID);
    let bestLevel = await bestLevelOf();
    for (let attempt = 0; bestLevel !== ZERO_ID && attempt < 8; attempt += 1) {
      const level = await publicClient.readContract({
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "getPriceLevel",
        args: [bestLevel],
      });
      const record = await publicClient.readContract({
        address: setryn.orderState,
        abi: orderStateAbi,
        functionName: "getOrder",
        args: [level.headOrderHash],
      });
      const live = (record.status === 1 || record.status === 2) && record.order.deadline > block.timestamp;
      if (live) {
        const own = record.order.signer.toLowerCase() === maker.address.toLowerCase();
        const stale = target.side === 1 ? record.order.priceTicks > target.priceTicks : record.order.priceTicks < target.priceTicks;
        if (!own || !stale) break;
        await withdrawMakerOrder(maker, level.headOrderHash, record.order);
        bestLevel = await bestLevelOf();
        continue;
      }
      // The pending block can run ahead of the book's own eligibility clock; an order it still holds eligible stays.
      const prunable = await publicClient
        .simulateContract({
          account: maker.address,
          address: setryn.publicOrderBook,
          abi: publicOrderBookAbi,
          functionName: "pruneBest",
          args: [bookId, target.side, [level.headOrderHash]],
        })
        .then(() => true)
        .catch(() => false);
      if (!prunable) break;
      const pruneHash = await walletClient.writeContract({
        chain: null,
        address: setryn.publicOrderBook,
        abi: publicOrderBookAbi,
        functionName: "pruneBest",
        args: [bookId, target.side, [level.headOrderHash]],
      });
      await publicClient.waitForTransactionReceipt({ hash: pruneHash });
      if (record.order.signer.toLowerCase() === maker.address.toLowerCase()) await expireMakerAdmission(maker, level.headOrderHash);
      bestLevel = await bestLevelOf();
    }
    if (bestLevel !== ZERO_ID) continue;
    created.push(await placeQuote(context, market, versions, target.side, target.priceTicks, block.timestamp));
  }
  return created;
}

async function placeQuote(
  context: QuoteContext,
  market: SetrynRuntimeMarket,
  versions: { seriesVersion: number; feeScheduleVersion: number },
  side: 1 | 2,
  priceTicks: bigint,
  now: bigint,
): Promise<Hex> {
  const { maker, accountId, fees } = context;
  const { setryn, publicClient, walletClient } = maker;
  // Random low bits keep concurrent refreshes in one block from signing the same order twice.
  const nonce = now * BigInt(2 ** 32) + BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  const lots = BigInt(Math.min(makerLotsForNetwork(maker.setryn.network), market.maxOrderLots));
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
    deadline: now + QUOTE_LIFETIME_SECONDS,
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
  const bindingHash = await walletClient.writeContract({
    chain: null,
    address: setryn.riskAdmissionBindingRegistry,
    abi: riskBindingAbi,
    functionName: "bindOrderRisk",
    args: [order, admissionId],
  });
  await publicClient.waitForTransactionReceipt({ hash: bindingHash });
  const registrationHash = await walletClient.writeContract({
    chain: null,
    address: setryn.orderState,
    abi: orderStateAbi,
    functionName: "registerSignedOrder",
    args: [order, signature],
  });
  await publicClient.waitForTransactionReceipt({ hash: registrationHash });
  const placementHash = await walletClient.writeContract({
    chain: null,
    address: setryn.publicOrderBook,
    abi: publicOrderBookAbi,
    functionName: "placeSeriesOrder",
    args: [orderHash, { previousLevelId: ZERO_ID, nextLevelId: ZERO_ID }],
  });
  await publicClient.waitForTransactionReceipt({ hash: placementHash });
  return orderHash;
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
  const admission = await publicClient.readContract({
    address: setryn.portfolioRiskEngine,
    abi: riskEngineAbi,
    functionName: "getAdmission",
    args: [admissionId],
  });
  if (admission.status !== 1) return;
  try {
    await publicClient.simulateContract({
      account: maker.address,
      address: setryn.portfolioRiskEngine,
      abi: riskExpiryAbi,
      functionName: "expireAdmission",
      args: [admissionId],
    });
  } catch {
    return;
  }
  const expiryHash = await walletClient.writeContract({
    chain: null,
    address: setryn.portfolioRiskEngine,
    abi: riskExpiryAbi,
    functionName: "expireAdmission",
    args: [admissionId],
  });
  await publicClient.waitForTransactionReceipt({ hash: expiryHash });
}
