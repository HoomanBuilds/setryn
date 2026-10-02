import { hashTypedData, keccak256, toHex, verifyTypedData, type Address, type Hex, type PublicClient } from "viem";
import { makerAccountId, MAKER_PUBLIC_POLICY_CONTEXT, PUBLIC_SERIES_POLICY } from "@/lib/internal-gateway/designated-maker";
import { marketTradingVersions, orderFeeCapMinor, readActiveFeeSchedule, type ActiveFeeSchedule } from "@/lib/internal-gateway/fee-schedule";
import { MakerPricingError, makerQuotes, type MakerQuote } from "@/lib/internal-gateway/maker-pricing";
import { makerSigner, SignerUnavailableError, type RoleSigner } from "@/lib/internal-gateway/operator-signer";
import { publicOrderTypedData, serializePublicOrder, type OnchainPublicOrder } from "@/lib/internal-gateway/protocol";
import type { SetrynRuntime, SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import { ticksToPrice } from "@/lib/internal-gateway/runtime-markets";
import { readRuntime } from "@/lib/internal-gateway/runtime-server";
import {
  QUOTE_LIFETIME_SECONDS,
  RENEW_BEFORE_SECONDS,
  serializeRiskAuthorization,
  type FirmQuote,
  type FirmQuoteBook,
  type MarketQuoteState,
} from "./firm-quote";
import { makerQuoteTermsHash, orderRiskAuthorizationTypes, setrynDomain, ZERO_HASH, type OrderRiskAuthorization } from "./protocol";
import { openCapacityInBackground, readSeriesCapacities, type CapacityView } from "./quote-capacity";

/*
 * The designated maker's quote engine: firm, signed, capacity-backed quotes for every configured market, produced
 * offchain with no transaction. Each tick prices every market from one Chainlink reference read, keeps a market's
 * signed quotes while their price, size and capacity hold and they have time left, and re-signs them otherwise. A market
 * that cannot be quoted firmly (no capacity yet, no reference, a paused fee schedule, a committed maker) is reported as
 * INDICATIVE or UNAVAILABLE with the reason, never with a quote, and one market's failure never touches another.
 *
 * Quote generation is separate from settlement: this module only signs, with the maker key; settlements are submitted
 * by the taker, any bot, or the optional relayer (app/api/quotes/settle). The book is a cache on the server process
 * and nothing in it is authoritative: the router verifies everything onchain. A restarted server derives the same
 * capacities and simply signs fresh quotes.
 */

/** A built book answers again for this long, so any number of streams share one signing pass per tick. */
const BOOK_TTL_MS = 500;
/** Lots per quote at most: the larger of this and the market's limit is never exceeded. */
const QUOTE_LOTS = 10;
/** Capacity and collateral reads are reused this long; settled fills show up within it. */
const CHAIN_READ_TTL_MS = 4_000;
const SIDE_BUY = 1;
const SIDE_SELL = 2;

const vaultAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "collateralId", type: "bytes32" },
    ],
    outputs: [
      { name: "total", type: "uint128" },
      { name: "locked", type: "uint128" },
      { name: "available", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "deriveCollateralId",
    stateMutability: "view",
    inputs: [
      { name: "assetId", type: "bytes32" },
      { name: "bindingVersion", type: "uint32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "accountRiskDomainTerminalLiability",
    stateMutability: "view",
    inputs: [
      { name: "accountId", type: "bytes32" },
      { name: "riskDomainId", type: "bytes32" },
      { name: "version", type: "uint32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface SignedSide {
  quote: FirmQuote;
  priceTicks: bigint;
  capacityId: Hex;
}

interface MakerCollateral {
  available: bigint;
  liability: bigint;
}

interface EngineState {
  book: FirmQuoteBook | null;
  building: Promise<FirmQuoteBook> | null;
  version: number;
  signed: Map<string, { bid: SignedSide | null; ask: SignedSide | null }>;
  capacities: Map<string, { at: number; views: CapacityView[] }>;
  collateral: { at: number; value: MakerCollateral } | null;
  makerAccount: { maker: Address; accountId: Hex } | null;
}

const STATE_KEY = Symbol.for("setryn.quote-engine.state");

function engine(): EngineState {
  const holder = globalThis as unknown as Record<symbol, EngineState | undefined>;
  holder[STATE_KEY] ??= {
    book: null,
    building: null,
    version: 0,
    signed: new Map(),
    capacities: new Map(),
    collateral: null,
    makerAccount: null,
  };
  return holder[STATE_KEY];
}

/** The current firm quote book, built at most once per tick per server process. */
export function readFirmQuoteBook(): Promise<FirmQuoteBook> {
  const state = engine();
  if (state.book && Date.now() - state.book.asOf < BOOK_TTL_MS) return Promise.resolve(state.book);
  state.building ??= buildBook()
    .then((book) => {
      state.book = book;
      return book;
    })
    .finally(() => {
      state.building = null;
    });
  return state.building;
}

async function buildBook(): Promise<FirmQuoteBook> {
  const state = engine();
  const setryn = await readRuntime();
  const nowMs = Date.now();
  const markets: Record<string, MarketQuoteState> = {};
  const unavailable = (reason: string, status: MarketQuoteState["status"] = "UNAVAILABLE") => {
    for (const market of setryn.markets) {
      markets[market.marketKey] = { marketId: market.marketKey, status, reason, bid: null, ask: null, reference: null };
    }
  };

  if (!setryn.quoteSettlementRouter || !setryn.streamCapacityManager) {
    unavailable("This deployment has no firm-quote settlement router; only the public book trades.");
    return publish(setryn, null, markets, nowMs);
  }
  let maker: RoleSigner;
  try {
    maker = await makerSigner(setryn);
  } catch (error) {
    unavailable(error instanceof SignerUnavailableError ? error.reason : "The designated maker is unavailable.", "INDICATIVE");
    return publish(setryn, null, markets, nowMs);
  }

  const [prices, fees, accountId] = await Promise.all([
    makerQuotes(setryn.markets),
    readActiveFeeSchedule(setryn, { client: maker.publicClient }),
    cachedMakerAccount(maker),
  ]);
  const collateral = await cachedCollateral(maker, accountId).catch(() => null);
  await Promise.all(
    setryn.markets.map(async (market) => {
      try {
        markets[market.marketKey] = await quoteMarket(maker, accountId, fees, market, prices.get(market.marketKey), collateral, nowMs);
      } catch (error) {
        // One market's failure is that market's alone.
        state.signed.delete(market.marketKey);
        markets[market.marketKey] = {
          marketId: market.marketKey,
          status: "INDICATIVE",
          reason: "The maker could not sign a quote for this market just now.",
          bid: null,
          ask: null,
          reference: null,
        };
        console.error("[quote-engine]", market.marketKey, error instanceof Error ? error.message.split("\n")[0] : error);
      }
    }),
  );
  return publish(setryn, maker.address, markets, nowMs);
}

function publish(setryn: SetrynRuntime, maker: Address | null, markets: Record<string, MarketQuoteState>, nowMs: number): FirmQuoteBook {
  const state = engine();
  const previous = state.book;
  const changed =
    !previous ||
    Object.keys(markets).some((key) => {
      const before = previous.markets[key];
      const after = markets[key];
      return before?.status !== after.status || before?.bid?.id !== after.bid?.id || before?.ask?.id !== after.ask?.id;
    });
  if (changed) state.version += 1;
  return {
    version: state.version,
    asOf: nowMs,
    chainId: setryn.chainId,
    router: (setryn.quoteSettlementRouter as Address | undefined) ?? null,
    maker,
    markets,
  };
}

async function quoteMarket(
  maker: RoleSigner,
  accountId: Hex,
  fees: ActiveFeeSchedule,
  market: SetrynRuntimeMarket,
  price: MakerQuote | MakerPricingError | undefined,
  collateral: MakerCollateral | null,
  nowMs: number,
): Promise<MarketQuoteState> {
  const base: MarketQuoteState = { marketId: market.marketKey, status: "INDICATIVE", reason: null, bid: null, ask: null, reference: null };
  if (!price || price instanceof MakerPricingError) {
    engine().signed.delete(market.marketKey);
    return { ...base, status: "UNAVAILABLE", reason: price instanceof MakerPricingError ? price.detail : "No reference price." };
  }
  const reference = { price: price.reference.price, updatedAt: price.reference.updatedAt, source: `Chainlink ${market.underlying ?? "reference"}` };
  const versions = marketTradingVersions(fees, market.seriesId);
  if ((fees.source === "CHAIN" && !fees.active) || !versions.tradable) {
    return { ...base, reference, reason: "The market's fee schedule is not active, so nothing can clear." };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const views = await cachedCapacities(maker, market, versions.seriesVersion, accountId, nowSeconds);
  const perLot = views[0].liabilityPerLot;
  const backing = views.find(
    (view) => view.live && view.remainingLiability >= perLot && view.expiry > BigInt(nowSeconds + QUOTE_LIFETIME_SECONDS + 60),
  );
  // The current epoch's capacity opens the first time it is missing, while the previous one still backs quotes.
  if (!views[0].live) openCapacityInBackground(maker, views[0].terms);
  if (!backing) {
    return { ...base, reference, reason: "The maker is locking its quote capacity onchain; quotes stream once it confirms." };
  }
  const capacityLots = Number(backing.remainingLiability / perLot);
  const lots = Math.min(QUOTE_LOTS, market.maxOrderLots, capacityLots);
  if (lots < 1) {
    return { ...base, reference, reason: "The maker's quote capacity is used up." };
  }
  if (collateral && !collateralCovers(collateral, market, lots, perLot)) {
    return { ...base, reference, reason: "The maker's collateral is fully committed." };
  }

  const state = engine();
  const previous = state.signed.get(market.marketKey) ?? { bid: null, ask: null };
  const [bid, ask] = await Promise.all([
    keepOrSign(previous.bid, maker, accountId, fees, market, versions, backing, SIDE_BUY, price.bidTicks, lots, nowMs),
    keepOrSign(previous.ask, maker, accountId, fees, market, versions, backing, SIDE_SELL, price.askTicks, lots, nowMs),
  ]);
  state.signed.set(market.marketKey, { bid, ask });
  return { ...base, status: "FIRM", reference, bid: bid.quote, ask: ask.quote };
}

/** The maker's free collateral, after a fill draws `lots` from capacity, still covers its liability plus the fill's. */
function collateralCovers(collateral: MakerCollateral, market: SetrynRuntimeMarket, lots: number, capacityPerLot: bigint): boolean {
  const sideLiability = BigInt(Math.max(market.maxLongDebitMinorPerLot, market.maxShortDebitMinorPerLot)) * BigInt(lots);
  return collateral.available + capacityPerLot * BigInt(lots) >= collateral.liability + sideLiability;
}

async function keepOrSign(
  previous: SignedSide | null,
  maker: RoleSigner,
  accountId: Hex,
  fees: ActiveFeeSchedule,
  market: SetrynRuntimeMarket,
  versions: { seriesVersion: number; feeScheduleVersion: number },
  capacity: CapacityView,
  side: number,
  priceTicks: bigint,
  lots: number,
  nowMs: number,
): Promise<SignedSide> {
  if (
    previous &&
    previous.priceTicks === priceTicks &&
    previous.capacityId === capacity.id &&
    previous.quote.lots === lots &&
    previous.quote.order.targetVersion === versions.seriesVersion &&
    previous.quote.expiresAt - nowMs / 1000 > RENEW_BEFORE_SECONDS
  ) {
    return previous;
  }
  return signQuote(maker, accountId, fees, market, versions, capacity, side, priceTicks, lots, nowMs);
}

async function signQuote(
  maker: RoleSigner,
  accountId: Hex,
  fees: ActiveFeeSchedule,
  market: SetrynRuntimeMarket,
  versions: { seriesVersion: number; feeScheduleVersion: number },
  capacity: CapacityView,
  side: number,
  priceTicks: bigint,
  lots: number,
  nowMs: number,
): Promise<SignedSide> {
  const { setryn, walletClient } = maker;
  const deadline = BigInt(Math.floor(nowMs / 1000) + QUOTE_LIFETIME_SECONDS);
  // A random 128-bit nonce: unique without any stored counter, so restarts and parallel servers never collide.
  const random = crypto.getRandomValues(new Uint8Array(16));
  const nonce = BigInt(toHex(random));
  const lotsBig = BigInt(lots);
  const absoluteTicks = priceTicks < BigInt(0) ? -priceTicks : priceTicks;
  const order: OnchainPublicOrder = {
    signer: maker.address,
    accountId,
    policyId: PUBLIC_SERIES_POLICY,
    policyContextHash: MAKER_PUBLIC_POLICY_CONTEXT,
    actionId: setryn.enterActionId,
    targetKind: 1,
    seriesId: market.seriesId,
    packageId: ZERO_HASH,
    targetVersion: versions.seriesVersion,
    side: side as 1 | 2,
    lots: lotsBig,
    priceTicks,
    timeInForce: 2,
    deadline,
    executionModeId: setryn.executionModeId,
    feeScheduleId: setryn.feeScheduleId,
    feeScheduleVersion: versions.feeScheduleVersion,
    maxFeeMinor: orderFeeCapMinor(fees, lotsBig * absoluteTicks * BigInt(market.tickSizeMinor), "MAKER"),
    recipient: maker.address,
    permittedExecutor: setryn.atomicClearingEngine,
    nonce,
    salt: keccak256(random),
    allowPartialFills: true,
    minimumFillLots: BigInt(1),
    remainderPolicy: 1,
    postOnly: false,
    reduceOnly: false,
  };
  const orderDomain = setrynDomain(setryn.chainId, setryn.orderState);
  const orderHash = hashTypedData({ domain: orderDomain, types: publicOrderTypedData, primaryType: "PublicOrder", message: order });
  const perLotSide = BigInt(side === SIDE_BUY ? market.maxLongDebitMinorPerLot : market.maxShortDebitMinorPerLot);
  const risk: OrderRiskAuthorization = {
    orderHash,
    accountId,
    riskDomainId: setryn.riskDomainId,
    riskDomainVersion: 1,
    maxOpenInterestBaseUnits: lotsBig,
    maxTerminalLiabilityBaseUnits: lotsBig * perLotSide,
    maxAdmissionDeadline: deadline + BigInt(60),
    binder: setryn.quoteSettlementRouter as Address,
    // The maker consents to exits: a taker holding a position against it closes it with this quote in one transaction.
    binderTerms: makerQuoteTermsHash(capacity.id, true),
    nonce,
    deadline,
  };
  const riskDomain = setrynDomain(setryn.chainId, setryn.riskAdmissionBindingRegistry);
  const [orderSignature, riskSignature] = await Promise.all([
    walletClient.signTypedData({ account: walletClient.account, domain: orderDomain, types: publicOrderTypedData, primaryType: "PublicOrder", message: order }),
    walletClient.signTypedData({
      account: walletClient.account,
      domain: riskDomain,
      types: orderRiskAuthorizationTypes,
      primaryType: "SetrynOrderRiskAuthorizationV1",
      message: risk,
    }),
  ]);
  // Validated before it is distributed: a quote whose signatures do not recover to the maker is never published.
  const [orderValid, riskValid] = await Promise.all([
    verifyTypedData({ address: maker.address, domain: orderDomain, types: publicOrderTypedData, primaryType: "PublicOrder", message: order, signature: orderSignature }),
    verifyTypedData({
      address: maker.address,
      domain: riskDomain,
      types: orderRiskAuthorizationTypes,
      primaryType: "SetrynOrderRiskAuthorizationV1",
      message: risk,
      signature: riskSignature,
    }),
  ]);
  if (!orderValid || !riskValid) throw new Error("QUOTE_SIGNATURE_INVALID");
  return {
    priceTicks,
    capacityId: capacity.id,
    quote: {
      id: orderHash,
      marketId: market.marketKey,
      side: side === SIDE_BUY ? "BID" : "ASK",
      priceTicks: priceTicks.toString(),
      price: ticksToPrice(market, priceTicks),
      lots,
      expiresAt: Number(deadline),
      issuedAt: nowMs,
      maker: maker.address,
      makerAccountId: accountId,
      capacityId: capacity.id,
      allowsOffsetUnwind: true,
      capacityRemainingLots: Number(capacity.remainingLiability / capacity.liabilityPerLot),
      order: serializePublicOrder(order),
      orderSignature,
      risk: serializeRiskAuthorization(risk),
      riskSignature,
    },
  };
}

async function cachedMakerAccount(maker: RoleSigner): Promise<Hex> {
  const state = engine();
  if (state.makerAccount?.maker === maker.address) return state.makerAccount.accountId;
  const accountId = await makerAccountId(maker);
  state.makerAccount = { maker: maker.address, accountId };
  return accountId;
}

async function cachedCapacities(
  maker: RoleSigner,
  market: SetrynRuntimeMarket,
  seriesVersion: number,
  accountId: Hex,
  nowSeconds: number,
): Promise<CapacityView[]> {
  const state = engine();
  const key = `${market.seriesId}:${seriesVersion}`;
  const cached = state.capacities.get(key);
  if (cached && Date.now() - cached.at < CHAIN_READ_TTL_MS) return cached.views;
  const views = await readSeriesCapacities(maker.publicClient as PublicClient, maker.setryn, market, seriesVersion, maker.address, accountId, nowSeconds);
  state.capacities.set(key, { at: Date.now(), views });
  return views;
}

async function cachedCollateral(maker: RoleSigner, accountId: Hex): Promise<MakerCollateral> {
  const state = engine();
  if (state.collateral && Date.now() - state.collateral.at < CHAIN_READ_TTL_MS) return state.collateral.value;
  const { setryn, publicClient } = maker;
  const collateralId = await publicClient.readContract({
    address: setryn.collateralVault,
    abi: vaultAbi,
    functionName: "deriveCollateralId",
    args: [setryn.settlementAssetId, 1],
  });
  const [[, , available], liability] = await Promise.all([
    publicClient.readContract({ address: setryn.collateralVault, abi: vaultAbi, functionName: "balanceOf", args: [accountId, collateralId] }),
    publicClient.readContract({
      address: setryn.collateralVault,
      abi: vaultAbi,
      functionName: "accountRiskDomainTerminalLiability",
      args: [accountId, setryn.riskDomainId, 1],
    }),
  ]);
  const value = { available, liability };
  state.collateral = { at: Date.now(), value };
  return value;
}
