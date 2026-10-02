import { cappedForwardMark } from "@/lib/pricing/mark";
import catalogJson from "./catalog.generated.json";
import { rangeForwardValue, referencePairLabel } from "@/lib/market-data/analytics";
import type { PackageLeg, PackageMarket, PayoffPoint, Qualification, StrategyKind } from "./types";

/*
 * The listed markets. Identity, expiry, payoff bounds, and the lot and tick grid come from the deployment's catalog,
 * generated from the network's runtime (or listing) by `scripts/sync-market-catalog.mjs`. Nothing here is a fixture:
 * until the market-data feed reports, a market has no quotes (NaN), an empty book, no routes, and no fills, and its
 * mark is the Chainlink reference its family was listed against, labelled as such.
 */

/** One market as the catalog generator writes it. */
export interface CatalogMarket {
  id: string;
  displayName: string;
  underlying: string;
  feedKey: string | null;
  strategyKind: StrategyKind;
  expiryAt: number;
  tradingStartsAt?: number;
  lastTradingAt?: number;
  fixingWindowOpen?: number;
  fixingWindowClose?: number;
  exerciseOpensAt?: number;
  exerciseCutoffAt?: number;
  finalResolutionAt?: number;
  settlementDeadline?: number;
  floor: number;
  cap: number;
  lotSize: number;
  tickPrice: number;
  priceDecimals: number;
  priceScale: number;
  tickSizeMinor: number;
  maxOrderLots: number;
  referenceFeed: string | null;
  referencePrice: number | null;
  referenceAt: number | null;
}

export interface MarketCatalog {
  schemaVersion: number;
  network: string;
  /** "runtime" when generated from a deployed schema 11 runtime, "listing" when from the listing alone. */
  source: "runtime" | "listing";
  chainId: number | null;
  listedAt: number | null;
  fixingAdapterKind: "signed-observation" | "chainlink-historical" | null;
  markets: CatalogMarket[];
}

export const CATALOG = catalogJson as MarketCatalog;

/** Trading closes this long before the expiry fixing when the runtime does not state it (the listing schedule). */
const LAST_TRADING_BEFORE_EXPIRY_SECONDS = 2 * 3_600;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export const STRATEGY_LABEL: Record<StrategyKind, string> = {
  DATED_YIELD_CARRY: "Dated yield carry",
  FUNDING_CARRY: "Funding carry",
  DATED_BASIS: "Dated basis",
  DELIVERABLE_FORWARD: "Deliverable forward",
};

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function expiryDate(expiryAt: number): Date {
  return new Date(expiryAt * 1000);
}

/** `DEC 26`: the expiry month and year, how a desk names the tenor. */
function tenorLabel(expiryAt: number): string {
  const date = expiryDate(expiryAt);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(-2)}`;
}

/** `24DEC26`: the expiry token the market keys carry. */
function expiryToken(expiryAt: number): string {
  const date = expiryDate(expiryAt);
  return `${String(date.getUTCDate()).padStart(2, "0")}${MONTHS[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}

function fixingSource(entry: CatalogMarket): string {
  const pair = referencePairLabel(entry.underlying);
  return CATALOG.fixingAdapterKind === "chainlink-historical"
    ? `Chainlink ${pair} · round at expiry`
    : `Chainlink ${pair} · signed fixing`;
}

/** A price clamped strictly inside the payoff range, on the tick grid: a reference outside it marks at the bound. */
export function clampToRange(market: Pick<PackageMarket, "floor" | "cap" | "tickSize" | "priceDecimals">, price: number): number {
  if (!Number.isFinite(price)) return Number.NaN;
  const low = market.floor + market.tickSize;
  const high = market.cap - market.tickSize;
  const ticks = Math.round(Math.min(high, Math.max(low, price)) / market.tickSize);
  return round(ticks * market.tickSize, market.priceDecimals);
}

/** Moves of the underlying, in percent of the reference, the payoff chart spans: both kinks plus a margin. */
function payoffRange(market: Pick<PackageMarket, "floor" | "cap">, base: number): number {
  const reach = Math.max(Math.abs(market.floor / base - 1), Math.abs(market.cap / base - 1));
  return Math.min(95, Math.ceil(reach * 125));
}

/**
 * Everything derived from the mark and the live reference: the two legs, the payoff at expiry of one long lot entered
 * at the mark, the move to break even, and the notional per lot. Recomputed whenever either reading changes.
 */
export function deriveMarketReadings(
  market: Pick<
    PackageMarket,
    "id" | "underlying" | "floor" | "cap" | "lotSize" | "expiryAt" | "qualification" | "referencePair"
  >,
  mark: number,
  reference: number,
): Pick<PackageMarket, "legs" | "payoff" | "payoffMoveUnit" | "breakEvenMove" | "notionalPerLot"> {
  const token = expiryToken(market.expiryAt);
  const legs: PackageLeg[] = [
    {
      id: `${market.id}-fwd`,
      side: "BUY",
      ratio: 1,
      instrument: `${market.underlying} ${token} range forward`,
      family: "FORWARD",
      venueClass: "NATIVE_BOOK",
      mark,
      markUnit: "USD",
      qualification: market.qualification,
      deltaPerLot: market.lotSize,
    },
    {
      id: `${market.id}-ref`,
      side: "SELL",
      ratio: 1,
      instrument: `Chainlink ${market.referencePair} reference`,
      family: "SPOT_REF",
      venueClass: "IMPLIED_COMPONENT",
      mark: reference,
      markUnit: "USD",
      qualification: "QUALIFIED",
      // The reference prices the strategy view only; the contract's payoff is the forward leg alone.
      deltaPerLot: 0,
    },
  ];

  const base = Number.isFinite(reference) && reference > 0 ? reference : mark;
  let payoff: PayoffPoint[] = [];
  let breakEvenMove = 0;
  if (Number.isFinite(base) && base > 0 && Number.isFinite(mark)) {
    const range = payoffRange(market, base);
    const moves = new Set<number>();
    const steps = 48;
    for (let index = 0; index <= steps; index += 1) moves.add(round(-range + (2 * range * index) / steps, 3));
    // The kinks sit exactly on the floor and the cap so the line bends where the contract does.
    for (const bound of [market.floor, market.cap]) {
      const move = round((bound / base - 1) * 100, 3);
      if (move > -range && move < range) moves.add(move);
    }
    payoff = [...moves]
      .sort((left, right) => left - right)
      .map((move) => ({ move, value: round(rangeForwardValue(market, mark, base * (1 + move / 100)), 2) }));
    breakEvenMove = round((mark / base - 1) * 100, 3);
  }

  return {
    legs,
    payoff,
    payoffMoveUnit: `${market.underlying} move vs reference, percent`,
    breakEvenMove,
    notionalPerLot: Number.isFinite(reference) ? market.lotSize * reference : Number.NaN,
  };
}

const SCHEDULE_FIELDS = [
  "tradingStartsAt",
  "fixingWindowOpen",
  "fixingWindowClose",
  "exerciseOpensAt",
  "exerciseCutoffAt",
  "finalResolutionAt",
  "settlementDeadline",
] as const;

/** The series schedule fields the catalog carries; absent ones stay absent rather than being derived. */
function scheduleOf(entry: CatalogMarket): Partial<Pick<PackageMarket, (typeof SCHEDULE_FIELDS)[number]>> {
  return Object.fromEntries(
    SCHEDULE_FIELDS.filter((field) => typeof entry[field] === "number").map((field) => [field, entry[field]]),
  );
}

function buildMarket(entry: CatalogMarket): PackageMarket {
  const tickSize = entry.tickPrice;
  const expiry = expiryDate(entry.expiryAt);
  const referencePair = referencePairLabel(entry.underlying);
  const qualification: Qualification = "QUALIFIED";
  const bounds = { floor: entry.floor, cap: entry.cap, tickSize, priceDecimals: entry.priceDecimals };
  const listingReference = entry.referencePrice ?? Number.NaN;
  // Marked with the platform model at the listing's own reading and time, so the static catalog is deterministic.
  const listed = cappedForwardMark(
    { ...bounds, underlying: entry.underlying, expiryAt: entry.expiryAt },
    listingReference,
    entry.referenceAt ?? Number.NaN,
  );
  const mark = listed?.price ?? Number.NaN;
  const name = entry.displayName.split(" · ")[0] || entry.displayName;
  const base = {
    id: entry.id,
    underlying: entry.underlying,
    floor: entry.floor,
    cap: entry.cap,
    lotSize: entry.lotSize,
    expiryAt: entry.expiryAt,
    qualification,
    referencePair,
  };

  return {
    ...base,
    name,
    code: entry.id,
    strategyKind: entry.strategyKind,
    strategyLabel: STRATEGY_LABEL[entry.strategyKind],
    priceUnit: "USD",
    priceDecimals: entry.priceDecimals,
    tickSize,
    netPrice: mark,
    priorNetPrice: Number.NaN,
    bestBid: Number.NaN,
    bestAsk: Number.NaN,
    expiryIso: expiry.toISOString().slice(0, 10),
    tenorLabel: tenorLabel(entry.expiryAt),
    settlementClass: "CASH_USDC",
    settlementAsset: "USDC",
    fixingSource: fixingSource(entry),
    qualificationNote: `Range forward on the Chainlink ${referencePair} fixing at ${expiry
      .toISOString()
      .slice(11, 16)} UTC on ${expiry.toISOString().slice(0, 10)}, paying between ${entry.floor.toLocaleString("en-US")} and ${entry.cap.toLocaleString("en-US")}.`,
    snapshotAgeSeconds: 0,
    contractMultiplier: entry.lotSize,
    collateralPerLot: round(entry.lotSize * (entry.cap - entry.floor), 6),
    feeOnConsideration: true,
    maxOrderLots: entry.maxOrderLots,
    residualPerLot: 0,
    // Unknown until the feed reads the position engine; zero would claim a reading that was not taken.
    openInterestLots: Number.NaN,
    firmDepthLots: 0,
    book: [],
    routes: [],
    priceHistory: [],
    priceOffset: entry.floor,
    lastTradingAt: entry.lastTradingAt ?? entry.expiryAt - LAST_TRADING_BEFORE_EXPIRY_SECONDS,
    ...scheduleOf(entry),
    markSource: listed ? "MODEL" : "NONE",
    markModel: listed?.model ?? null,
    markAsOf: entry.referenceAt ?? 0,
    referencePrice: listingReference,
    referenceAsOf: entry.referenceAt ?? 0,
    seriesStatus: "UNKNOWN",
    listedOnchain: false,
    ...deriveMarketReadings(base, mark, listingReference),
  };
}

/**
 * The most recent onchain fill price, or NaN before the market trades. Market-implied readings (carry, basis) use it;
 * the modeled mark would only echo the model's own inputs back.
 */
export function lastTradedPrice(market: Pick<PackageMarket, "priceHistory">): number {
  const last = market.priceHistory[market.priceHistory.length - 1];
  return last !== undefined && Number.isFinite(last) ? last : Number.NaN;
}

/** Every listed market in catalog order (family, then expiry). */
export const MARKETS: PackageMarket[] = CATALOG.markets.map(buildMarket);

export const CATALOG_MARKETS: ReadonlyMap<string, CatalogMarket> = new Map(CATALOG.markets.map((entry) => [entry.id, entry]));

export const DEFAULT_MARKET_ID = MARKETS[0].id;

export function findMarket(id: string): PackageMarket {
  return MARKETS.find((market) => market.id === id) ?? MARKETS[0];
}

/** Market ids are already uppercase and URL-safe, so the id is the route slug. */
export function marketSlug(market: PackageMarket): string {
  return market.id;
}

/** Product name plus tenor, which is how a desk names the contract it holds. */
export function packageLabel(market: PackageMarket): string {
  return `${market.name} ${market.tenorLabel}`;
}

export function tradeHref(market: PackageMarket): string {
  return `/trade/${encodeURIComponent(marketSlug(market))}`;
}

export const DEFAULT_MARKET_SLUG = marketSlug(MARKETS[0]);

export const DEFAULT_TRADE_HREF = tradeHref(MARKETS[0]);

/**
 * Resolution is case-insensitive so a hand-typed URL still finds its market,
 * but only the canonical slug renders: the route redirects anything else.
 * A slug that matches nothing is a 404, never a fallback to another market.
 */
export function marketBySlug(slug: string): PackageMarket | null {
  const needle = slug.trim().toLowerCase();
  return MARKETS.find((market) => marketSlug(market).toLowerCase() === needle) ?? null;
}

/** Consideration per lot at `price`: lot size x (price - floor), the USDC the long pays and fees are charged on. */
export function considerationPerLot(market: Pick<PackageMarket, "priceOffset" | "contractMultiplier">, price: number): number {
  return (price - market.priceOffset) * market.contractMultiplier;
}

/** Whether a quote exists: a missing best bid or offer is NaN. */
export function hasQuote(value: number): boolean {
  return Number.isFinite(value);
}
