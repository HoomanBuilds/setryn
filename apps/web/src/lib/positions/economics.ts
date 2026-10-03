import type { OnchainMarketEconomics, OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import type { LiveMarketData, MarkSource } from "@/lib/market-data/types";
import {
  clampToRange,
  closeTouch,
  deltaUnits,
  forwardPnl,
  markOf,
  markProvenance,
  maxLossPerLot,
  rangeTerms,
  type RangeTerms,
} from "@/lib/portfolio/forward";
import { quoteExecutable } from "@/lib/quotes/firm-quote";
import { seriesSchedule, type SeriesSchedule } from "@/lib/settlements/calendar";
import { tradeHref } from "@/lib/terminal/markets";
import type { BookRow, PackageMarket, PositionSide, Provenance } from "@/lib/terminal/types";
import type { PositionDossier } from "./dossier";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface PositionMetrics {
  direction: 1 | -1;
  terms: RangeTerms;
  /** Live forward level from the market-data feed; null while the market has no quote, fill or reference. */
  mark: number | null;
  markSource: MarkSource;
  /** Executable price that closes the position now: the best bid for a long, the best ask for a short. */
  closeTouch: number | null;
  /** USDC per 1.00 of forward level across the open lots, signed for the holder. */
  perPoint: number;
  /** Underlying units the position moves with: lots x lot size inside the range, zero outside. */
  deltaUnits: number;
  /** USD value of the underlying units at the mark (entry while unmarked). */
  notional: number;
  pricePnl: number;
  totalPnl: number;
  /** PnL if closed at the touch, less fees paid; null without a resting touch. */
  touchPnl: number | null;
  /** Collateral plus price PnL: what the position returns if the fixing prints at the mark. */
  equity: number;
  /** Collateral still at risk to the adverse payoff bound. */
  atRisk: number;
  /** Most the position gains if the fixing prints at its favourable bound; null without published bounds. */
  maxGain: number | null;
  /** Adverse payoff bound: the floor for a long, the cap for a short. */
  boundLevel: number | null;
  recordProvenance: Provenance;
  markProvenance: Provenance;
  schedule: SeriesSchedule;
  fixingMs: number;
  windowOpensMs: number;
  msToFixing: number;
}

export function positionMetrics(
  dossier: PositionDossier,
  market: PackageMarket,
  live: LiveMarketData | null,
  nowMs: number,
  lifecycle: OnchainPositionLifecycle | null = null,
): PositionMetrics {
  const direction = dossier.side === "LONG" ? 1 : -1;
  const terms = rangeTerms(market);
  const lots = dossier.lots;
  const mark = markOf(live);
  const touch = closeTouch(live, dossier.side);
  const pricePnl = mark.price === null ? 0 : round2(forwardPnl(dossier.side, lots, dossier.entryPrice, mark.price, terms));
  const totalPnl = round2(pricePnl - dossier.fees);
  const touchPnl = touch === null ? null : round2(forwardPnl(dossier.side, lots, dossier.entryPrice, touch, terms) - dossier.fees);
  const equity = round2(dossier.collateral + pricePnl);
  const level = mark.price ?? dossier.entryPrice;
  const favourable = dossier.side === "LONG" ? terms.cap : terms.floor;
  const schedule = seriesSchedule(market, lifecycle?.schedule);
  return {
    direction,
    terms,
    mark: mark.price,
    markSource: mark.source,
    closeTouch: touch,
    perPoint: direction * lots * terms.lotSize,
    deltaUnits: deltaUnits(dossier.side, lots, terms, mark.price),
    notional: round2(lots * terms.lotSize * Math.abs(level)),
    pricePnl,
    totalPnl,
    touchPnl,
    equity,
    atRisk: Math.max(0, equity),
    maxGain:
      favourable === null ? null : round2(forwardPnl(dossier.side, lots, dossier.entryPrice, favourable, terms)),
    boundLevel: dossier.side === "LONG" ? terms.floor : terms.cap,
    recordProvenance: "OBSERVED",
    markProvenance: markProvenance(mark.source),
    schedule,
    fixingMs: schedule.fixingMs,
    windowOpensMs: schedule.windowOpensMs,
    msToFixing: schedule.fixingMs - nowMs,
  };
}

/* ------------------------------------------------------------------ */
/* Book execution                                                      */
/* ------------------------------------------------------------------ */

export interface BookFill {
  /** Lots the resting book can fill now, at most the size asked. */
  lots: number;
  /** Volume-weighted price across the levels taken; null when nothing rests. */
  averagePrice: number | null;
  /** Deepest level the fill reaches; the limit that takes it. */
  worstPrice: number | null;
}

/**
 * Walks the resting public book for a taker: a sell takes bids from the best down, a buy takes asks from the best up.
 * Only executable rows count.
 */
export function walkBook(book: readonly BookRow[], action: "BUY" | "SELL", lots: number): BookFill {
  const side = action === "BUY" ? "ASK" : "BID";
  const rows = book
    .filter((row) => row.side === side && row.executable && row.lots > 0)
    .sort((left, right) => (action === "BUY" ? left.price - right.price : right.price - left.price));
  let left = lots;
  let notional = 0;
  let worst: number | null = null;
  for (const row of rows) {
    if (left <= 0) break;
    const take = Math.min(left, row.lots);
    notional += take * row.price;
    left -= take;
    worst = row.price;
  }
  const filled = lots - left;
  return { lots: filled, averagePrice: filled > 0 ? notional / filled : null, worstPrice: worst };
}

/** Taker fee for a fill: the active schedule's rate on the consideration (lots x lot size x (price - floor)) plus any flat charge. */
export function takerFee(
  market: PackageMarket,
  economics: OnchainMarketEconomics | null,
  lots: number,
  price: number,
): number | null {
  if (!economics) return null;
  const terms = rangeTerms(market);
  const consideration = lots * terms.lotSize * Math.abs(price - (terms.floor ?? 0));
  return round2((consideration * economics.takerFeeBps) / 10_000 + (lots > 0 ? economics.takerFlatFeeUsd : 0));
}

function tradingBlockers(
  market: PackageMarket,
  live: LiveMarketData | null,
  economics: OnchainMarketEconomics | null,
  schedule: SeriesSchedule,
  nowMs: number,
): string[] {
  const blockers: string[] = [];
  if (nowMs >= schedule.lastTradingMs) {
    blockers.push(`Trading in ${market.code} closed at its last trade time. The position settles in cash at the fixing.`);
  } else if (live && live.seriesStatus !== "ACTIVE" && live.seriesStatus !== "UNKNOWN") {
    blockers.push(`${market.code} is ${live.seriesStatus.toLowerCase()} onchain; the book accepts no new fills.`);
  }
  if (economics && !economics.tradable) {
    blockers.push("The market's fee schedule is changing over; nothing clears until the new version is active.");
  }
  return blockers;
}

export interface ClosePreview {
  lots: number;
  remainingLots: number;
  /** Lots the maker's firm quote can close now. */
  fillableLots: number;
  /** The firm quote's close price; null when no quote can close the position now. */
  price: number | null;
  /** Fee at the active schedule; null until the onchain fee schedule is read. */
  fees: number | null;
  realizedPnl: number | null;
  collateralRelease: number;
  /** Terminal preflight conditions this page can see before the handoff. */
  blockers: string[];
  notices: string[];
}

export function closePreview(
  dossier: PositionDossier,
  market: PackageMarket,
  live: LiveMarketData | null,
  economics: OnchainMarketEconomics | null,
  lots: number,
  nowMs: number,
  schedule: SeriesSchedule = seriesSchedule(market),
): ClosePreview {
  const size = Math.max(0, Math.min(lots, dossier.lots));
  const action = dossier.side === "LONG" ? "SELL" : "BUY";
  // A close settles only against the maker's firm quote, in full, in one transaction with both positions closing; the
  // public book cannot close a position, so it is not what this preview prices.
  const state = market.firmQuotes;
  const sideQuote = action === "SELL" ? state?.bid : state?.ask;
  const quote = state?.status === "FIRM" && sideQuote && quoteExecutable(sideQuote, nowMs) ? sideQuote : null;
  const usable = quote && quote.allowsOffsetUnwind && quote.lots >= size ? quote : null;
  const closePrice = usable ? usable.price : null;
  const fees = closePrice === null ? null : takerFee(market, economics, size, closePrice);
  const realizedGross = closePrice === null ? null : forwardPnl(dossier.side, size, dossier.entryPrice, closePrice, rangeTerms(market));
  const blockers = tradingBlockers(market, live, economics, schedule, nowMs);
  if (size <= 0) blockers.push("Enter a quantity above zero.");
  if (size < dossier.lots) blockers.push("A close settles the whole position in one transaction; partial closes are not available.");
  if (!quote) {
    blockers.push(
      `No firm maker ${action === "SELL" ? "bid" : "offer"} to close against right now. Quotes stream continuously, so try again in a moment, or hold the position to settlement.`,
    );
  } else if (!quote.allowsOffsetUnwind) {
    blockers.push("The current maker quote does not allow closing a position with it. Wait for the next quote.");
  } else if (quote.lots < size) {
    blockers.push(`The maker quote covers ${quote.lots} of the ${size} lots. Wait for a larger quote.`);
  }
  if (market.maxOrderLots != null && size > market.maxOrderLots) {
    blockers.push(`This market accepts at most ${market.maxOrderLots} lots per order.`);
  }
  const notices: string[] = [];
  if (!economics) notices.push("Fees show once the onchain fee schedule is read.");
  return {
    lots: size,
    remainingLots: dossier.lots - size,
    fillableLots: usable ? size : 0,
    price: closePrice,
    fees,
    realizedPnl: realizedGross === null ? null : round2(realizedGross - (fees ?? 0)),
    collateralRelease: dossier.lots === 0 ? 0 : round2((dossier.collateral * size) / dossier.lots),
    blockers,
    notices,
  };
}

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

/** Later maturities of the same underlying and family, nearest first. */
export function rollTargets(market: PackageMarket, markets: readonly PackageMarket[]): PackageMarket[] {
  return markets
    .filter(
      (candidate) =>
        candidate.underlying === market.underlying &&
        candidate.strategyKind === market.strategyKind &&
        candidate.expiryIso > market.expiryIso,
    )
    .sort((left, right) => left.expiryIso.localeCompare(right.expiryIso));
}

export interface RollPreview {
  target: PackageMarket;
  lots: number;
  close: ClosePreview;
  /** Average opening price across the target book; null when nothing rests on the opening side. */
  openPrice: number | null;
  openFillableLots: number;
  /** Target entry less current exit, in price units. */
  rollSpread: number | null;
  /** USDC paid crossing from each mark to its executable fill, both tickets together. */
  crossingCost: number | null;
  fees: number | null;
  collateralRelease: number;
  /** Collateral the new position locks: the long pays the consideration, the short locks the range less what it receives. */
  collateralRequired: number | null;
  netCollateral: number | null;
  extensionDays: number;
  openBlockers: string[];
}

function openingCollateral(side: PositionSide, lots: number, price: number, terms: RangeTerms): number | null {
  const loss = maxLossPerLot(side, price, terms);
  return loss === null ? null : round2(lots * loss);
}

export function rollPreview(
  dossier: PositionDossier,
  current: PackageMarket,
  currentLive: LiveMarketData | null,
  target: PackageMarket,
  targetLive: LiveMarketData | null,
  economics: { current: OnchainMarketEconomics | null; target: OnchainMarketEconomics | null },
  lots: number,
  nowMs: number,
  schedule: SeriesSchedule = seriesSchedule(current),
): RollPreview {
  const close = closePreview(dossier, current, currentLive, economics.current, lots, nowMs, schedule);
  const openAction = dossier.side === "LONG" ? "BUY" : "SELL";
  const open = walkBook(targetLive?.book ?? [], openAction, close.lots);
  const targetTerms = rangeTerms(target);
  const openFees = open.averagePrice === null ? null : takerFee(target, economics.target, close.lots, open.averagePrice);
  const currentMark = markOf(currentLive).price;
  const targetMark = markOf(targetLive).price;
  const direction = dossier.side === "LONG" ? 1 : -1;
  const closeCross =
    close.price === null || currentMark === null
      ? null
      : (currentMark - close.price) * direction * close.lots * rangeTerms(current).lotSize;
  const openCross =
    open.averagePrice === null || targetMark === null
      ? null
      : (open.averagePrice - targetMark) * direction * close.lots * targetTerms.lotSize;
  const collateralRequired =
    open.averagePrice === null ? null : openingCollateral(dossier.side, close.lots, open.averagePrice, targetTerms);
  const openBlockers = tradingBlockers(target, targetLive, economics.target, seriesSchedule(target), nowMs);
  if (open.lots === 0) {
    openBlockers.push(
      `No resting ${openAction === "BUY" ? "offer" : "bid"} on the ${target.code} book. Rest a limit in the terminal or request quotes privately.`,
    );
  } else if (open.lots < close.lots) {
    openBlockers.push(`The ${target.code} book holds ${open.lots} of the ${close.lots} lots at executable prices.`);
  }
  const fees = close.fees === null || openFees === null ? null : round2(close.fees + openFees);
  return {
    target,
    lots: close.lots,
    close,
    openPrice: open.averagePrice,
    openFillableLots: open.lots,
    rollSpread: open.averagePrice === null || close.price === null ? null : open.averagePrice - close.price,
    crossingCost: closeCross === null || openCross === null ? null : round2(closeCross + openCross),
    fees,
    collateralRelease: close.collateralRelease,
    collateralRequired,
    netCollateral: collateralRequired === null ? null : round2(collateralRequired - close.collateralRelease),
    extensionDays: Math.round((seriesSchedule(target).fixingMs - schedule.fixingMs) / 86_400_000),
    openBlockers,
  };
}

/** PnL of the open lots if the fixing prints at `level`: lots x lot size x (clamp(level) - entry), signed. */
export function settlementPnlAt(dossier: PositionDossier, market: PackageMarket, level: number): number {
  const terms = rangeTerms(market);
  return round2(forwardPnl(dossier.side, dossier.lots, dossier.entryPrice, clampToRange(level, terms), terms));
}

/** Cash the open lots receive at a fixing: the long the payoff, the short the range less the payoff. */
export function settlementCashAt(dossier: PositionDossier, market: PackageMarket, level: number): number | null {
  const terms = rangeTerms(market);
  if (terms.floor === null || terms.cap === null) return null;
  const payoff = terms.lotSize * (clampToRange(level, terms) - terms.floor);
  const perLot = dossier.side === "LONG" ? payoff : terms.lotSize * (terms.cap - terms.floor) - payoff;
  return round2(dossier.lots * perLot);
}

/* ------------------------------------------------------------------ */
/* Terminal handoffs                                                   */
/* ------------------------------------------------------------------ */

const SOURCE = { source: "positions", sourceLabel: "Position" } as const;

/** Close or reduce through the terminal. The terminal re-quotes and owns authorization. */
export function closeHandoffHref(dossier: PositionDossier, market: PackageMarket, lots: number, maxCloseCost?: number | null): string {
  const params = new URLSearchParams({
    ...SOURCE,
    lifecycle: dossier.id,
    intent: lots < dossier.lots ? "derisk" : "exit",
    direction: dossier.side.toLowerCase(),
    lots: String(lots),
    guarantee: dossier.guarantee.toLowerCase(),
  });
  if (maxCloseCost !== undefined && maxCloseCost !== null && maxCloseCost > 0) params.set("maxCloseCost", maxCloseCost.toFixed(2));
  return `${tradeHref(market)}?${params.toString()}`;
}

/** Opening ticket for the roll target, carrying the source position for traceability. */
export function rollOpenHandoffHref(dossier: PositionDossier, target: PackageMarket, lots: number): string {
  const params = new URLSearchParams({
    ...SOURCE,
    lifecycle: dossier.id,
    intent: "roll",
    direction: dossier.side.toLowerCase(),
    lots: String(lots),
  });
  return `${tradeHref(target)}?${params.toString()}`;
}

export function marketFor(marketId: string, markets: readonly PackageMarket[]): PackageMarket | null {
  return markets.find((market) => market.id === marketId) ?? null;
}
