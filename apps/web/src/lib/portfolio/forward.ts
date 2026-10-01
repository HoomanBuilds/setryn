import type { LiveMarketData, MarketDataSnapshot, MarkSource, ReferenceQuote } from "@/lib/market-data/types";
import type { PackageMarket, PositionSide, Provenance } from "@/lib/terminal/types";

/*
 * Range-forward economics shared by the portfolio, position, exposure, settlement and alert surfaces
 * (docs/plans/network-runtime-real-data.md, section 2). Each market is a cash-settled dated range forward: the quoted
 * price is the forward level F in USD, one lot is `lotSize` units of the underlying, and the long receives
 * `lotSize x clamp(S_T - floor, 0, cap - floor)` at expiry. Marks come only from the market-data feed; nothing here
 * invents a price.
 */

/** Optional schema 11 listing fields a catalog market may carry next to its metadata. */
type ListingFields = {
  floor?: number | string | null;
  cap?: number | string | null;
  lotSize?: number | string | null;
};

function numeric(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

export function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface RangeTerms {
  /** Units of the underlying per lot (the catalog's contract multiplier). */
  lotSize: number;
  /** Payoff floor and cap in USD; null when the listing does not publish them. */
  floor: number | null;
  cap: number | null;
}

export function rangeTerms(market: PackageMarket): RangeTerms {
  const fields = market as PackageMarket & ListingFields;
  const lotSize = numeric(fields.lotSize) ?? market.contractMultiplier;
  const floor = numeric(fields.floor);
  const cap = numeric(fields.cap);
  const bounded = floor !== null && cap !== null && cap > floor;
  return { lotSize, floor: bounded ? floor : null, cap: bounded ? cap : null };
}

export function direction(side: PositionSide): 1 | -1 {
  return side === "LONG" ? 1 : -1;
}

/** A level clamped into the payoff range; unchanged when the range is not published. */
export function clampToRange(level: number, terms: RangeTerms): number {
  let value = level;
  if (terms.floor !== null) value = Math.max(terms.floor, value);
  if (terms.cap !== null) value = Math.min(terms.cap, value);
  return value;
}

/** USDC moved by a 1.00 change of the forward level across `lots`, signed for the holder. */
export function perPoint(side: PositionSide, lots: number, terms: RangeTerms): number {
  return direction(side) * lots * terms.lotSize;
}

/** Value of the position against a forward level: lots x lotSize x (level - entry), signed by side. */
export function forwardPnl(side: PositionSide, lots: number, entry: number, level: number, terms: RangeTerms): number {
  return perPoint(side, lots, terms) * (clampToRange(level, terms) - entry);
}

/** Cash the long receives per lot at a fixing: lotSize x clamp(S - floor, 0, cap - floor). */
export function longPayoffPerLot(fixing: number, terms: RangeTerms): number | null {
  if (terms.floor === null || terms.cap === null) return null;
  return terms.lotSize * (clampToRange(fixing, terms) - terms.floor);
}

/** Largest loss the side can take per lot from its entry; null without published bounds. */
export function maxLossPerLot(side: PositionSide, entry: number, terms: RangeTerms): number | null {
  if (terms.floor === null || terms.cap === null) return null;
  return terms.lotSize * Math.max(0, side === "LONG" ? entry - terms.floor : terms.cap - entry);
}

/** Underlying units the position moves with: delta-one inside the range, zero outside it. */
export function deltaUnits(side: PositionSide, lots: number, terms: RangeTerms, level: number | null): number {
  const inside =
    level === null || ((terms.floor === null || level > terms.floor) && (terms.cap === null || level < terms.cap));
  return inside ? direction(side) * lots * terms.lotSize : 0;
}

/** Implied annualized carry of the forward over the live reference: (F / S - 1) x 365 / days. */
export function impliedCarry(forward: number, spot: number, days: number): number | null {
  if (!finite(forward) || !finite(spot) || spot <= 0 || days <= 0) return null;
  return ((forward / spot - 1) * 365) / days;
}

/* ------------------------------------------------------------------ */
/* Marks                                                               */
/* ------------------------------------------------------------------ */

export interface MarkRead {
  /** Forward level; null while the market has no quote, no fill and no reference. */
  price: number | null;
  source: MarkSource;
}

export const NO_MARK: MarkRead = { price: null, source: "NONE" };

export const MARK_SOURCE_LABEL: Record<MarkSource, string> = {
  MID: "Book mid",
  LAST: "Last fill",
  REFERENCE: "Chainlink reference",
  NONE: "No quote",
};

/** Trust class of a mark: a book mid is derived, a fill or reference is observed, nothing is nothing. */
export function markProvenance(source: MarkSource): Provenance {
  if (source === "MID") return "ESTIMATED";
  if (source === "LAST" || source === "REFERENCE") return "OBSERVED";
  return "MODELED";
}

export function markOf(live: LiveMarketData | null | undefined): MarkRead {
  if (!live || !finite(live.mark)) return NO_MARK;
  return { price: live.mark, source: live.markSource };
}

/** Live state keyed by market id, from one snapshot of the feed. */
export function liveIndex(snapshot: MarketDataSnapshot | null | undefined): Map<string, LiveMarketData> {
  return new Map((snapshot?.markets ?? []).map((market) => [market.marketKey, market]));
}

/** Executable price that closes the side now: the best bid for a long, the best ask for a short. */
export function closeTouch(live: LiveMarketData | null | undefined, side: PositionSide): number | null {
  if (!live) return null;
  const touch = side === "LONG" ? live.bestBid : live.bestAsk;
  return finite(touch) ? touch : null;
}

/** Executable price that opens the side now: the best ask to buy, the best bid to sell. */
export function openTouch(live: LiveMarketData | null | undefined, side: PositionSide): number | null {
  if (!live) return null;
  const touch = side === "LONG" ? live.bestAsk : live.bestBid;
  return finite(touch) ? touch : null;
}

export function referenceFor(
  market: Pick<PackageMarket, "underlying">,
  references: Record<string, ReferenceQuote> | null | undefined,
): ReferenceQuote | null {
  const quote = references?.[market.underlying];
  return quote && finite(quote.price) ? quote : null;
}
