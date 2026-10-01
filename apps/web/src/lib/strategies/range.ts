import type { SetrynRuntimeMarket } from "@/lib/internal-gateway/runtime";
import type { LiveMarketData, MarkSource, MarketDataSnapshot, ReferenceQuote, SeriesStatus } from "@/lib/market-data/types";
import {
  MARK_SOURCE_LABEL as FORWARD_MARK_SOURCE_LABEL,
  clampToRange as forwardClamp,
  deltaUnits,
  forwardPnl,
  impliedCarry,
  maxLossPerLot,
} from "@/lib/portfolio/forward";
import type { PackageMarket } from "@/lib/terminal/types";

/*
 * The listed product (docs/plans/network-runtime-real-data.md, section 2): a cash-settled dated range forward. The long
 * receives `lotSize x clamp(S_T - floor, 0, cap - floor)` per lot at the fixing and paid `lotSize x (F - floor)` at the
 * fill, so its result per lot is `lotSize x (clamp(S_T, floor, cap) - F)`. Between floor and cap the contract is
 * delta-one on the underlying. Terms come from the deployment runtime, or from the catalog when it carries them; a
 * market whose terms are not published returns null and the page says so instead of guessing. The arithmetic is the
 * shared range-forward maths in lib/portfolio/forward.ts, here with the bounds required.
 */

export interface RangeTerms {
  marketId: string;
  underlying: string;
  floor: number;
  cap: number;
  /** Units of the underlying per lot. */
  lotSize: number;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Terms from the runtime when it publishes them, else from the catalog the runtime generated. */
export function rangeTerms(market: PackageMarket, runtime?: SetrynRuntimeMarket | null): RangeTerms | null {
  const floor = finite(runtime?.floor) ?? finite(market.floor);
  const cap = finite(runtime?.cap) ?? finite(market.cap);
  const lotSize = finite(runtime?.lotSize) ?? finite(market.lotSize) ?? finite(market.contractMultiplier);
  if (floor === null || cap === null || lotSize === null || !(cap > floor) || !(lotSize > 0)) return null;
  return { marketId: market.id, underlying: market.underlying, floor, cap, lotSize };
}

export function clampToRange(terms: RangeTerms, fixing: number): number {
  return forwardClamp(fixing, terms);
}

/** Result per lot for the long at fixing `fixing` when the forward level traded at `forward`, in USDC. */
export function longResultPerLot(terms: RangeTerms, fixing: number, forward: number): number {
  return forwardPnl("LONG", 1, forward, fixing, terms);
}

/** Underlying units of exposure per long lot at spot `spot`: the lot size inside the range, zero outside it. */
export function deltaPerLot(terms: RangeTerms, spot: number): number {
  return deltaUnits("LONG", 1, terms, spot);
}

/** Consideration the long pays per lot at forward level `forward`. */
export function considerationPerLot(terms: RangeTerms, forward: number): number {
  return terms.lotSize * Math.max(0, Math.min(terms.cap, forward) - terms.floor);
}

/** Collateral a side locks per lot at forward level `forward`: the most it can lose. */
export function collateralPerLot(terms: RangeTerms, forward: number, side: "LONG" | "SHORT"): number {
  return maxLossPerLot(side, Math.min(terms.cap, Math.max(terms.floor, forward)), terms) ?? 0;
}

/* ------------------------------------------------------------------ */
/* Expiry                                                              */
/* ------------------------------------------------------------------ */

/** Expiry in unix seconds: the runtime's own when published, else the catalog date at the 08:00 UTC fixing. */
export function expiryAt(market: PackageMarket, runtime?: SetrynRuntimeMarket | null): number | null {
  if (runtime?.expiryAt && Number.isFinite(runtime.expiryAt)) return runtime.expiryAt;
  const declared = finite(market.expiryAt);
  if (declared !== null && declared > 0) return declared;
  const iso = market.expiryIso;
  if (typeof iso !== "string" || iso.length === 0) return null;
  const ms = Date.parse(iso.includes("T") ? iso : `${iso}T08:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function daysUntil(atSeconds: number | null, nowSeconds: number): number | null {
  if (atSeconds === null || !Number.isFinite(nowSeconds) || nowSeconds <= 0) return null;
  return Math.max(0, (atSeconds - nowSeconds) / 86_400);
}

/* ------------------------------------------------------------------ */
/* Live quotes                                                         */
/* ------------------------------------------------------------------ */

export interface LiveQuote {
  mark: number | null;
  markSource: MarkSource;
  bid: number | null;
  ask: number | null;
  last: number | null;
  seriesStatus: SeriesStatus;
  openInterestLots: number | null;
  volume24hLots: number;
  /** Chainlink reference of the underlying, when the feed read it. */
  reference: ReferenceQuote | null;
}

function liveNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function liveFor(snapshot: MarketDataSnapshot | null, marketId: string): LiveMarketData | null {
  return snapshot?.markets.find((candidate) => candidate.marketKey === marketId) ?? null;
}

/** Live numbers for one market, straight from the feed and guarded: anything not published is null. */
export function liveQuote(snapshot: MarketDataSnapshot | null, market: Pick<PackageMarket, "id" | "underlying">): LiveQuote {
  const live = liveFor(snapshot, market.id);
  const reference = snapshot?.references[market.underlying] ?? null;
  return {
    mark: live && live.markSource !== "NONE" ? liveNumber(live.mark) : null,
    markSource: live?.markSource ?? "NONE",
    bid: liveNumber(live?.bestBid),
    ask: liveNumber(live?.bestAsk),
    last: liveNumber(live?.last),
    seriesStatus: live?.seriesStatus ?? "UNKNOWN",
    openInterestLots: liveNumber(live?.openInterestLots),
    volume24hLots: liveNumber(live?.volume24hLots) ?? 0,
    reference: reference && Number.isFinite(reference.price) ? reference : null,
  };
}

export const MARK_SOURCE_LABEL: Record<MarkSource, string> = FORWARD_MARK_SOURCE_LABEL;

/** Implied annualized carry of a forward level against spot: (F / S - 1) x 365 / days, in percent. */
export function impliedCarryPct(forward: number, spot: number, days: number | null): number | null {
  if (days === null) return null;
  const carry = impliedCarry(forward, spot, days);
  return carry === null ? null : carry * 100;
}
