import { platformNow } from "@/lib/terminal/clock";
import { clampToRange, deriveMarketReadings } from "@/lib/terminal/markets";
import type { BookRow, PackageMarket, Qualification, RouteQuote } from "@/lib/terminal/types";
import { firmQuoteRows, quoteExecutable, quoteSecondsLeft, type MarketQuoteState } from "@/lib/quotes/firm-quote";
import type { LiveMarketData, MarketDataSnapshot, MarketFeeSchedule, ReferenceQuote } from "./types";

/*
 * How a market-data snapshot overlays the static catalog. Shared by the client provider and server code (the public
 * API), so both read a market the same way. Nothing here invents a number: a missing quote stays NaN, a market without
 * live state keeps its catalog entry, and a mark without a book or fills is the Chainlink reference, labelled so.
 */

/** Context an overlay needs beyond the market's own live state; every field is optional. */
export interface LiveMarketContext {
  references?: Record<string, ReferenceQuote>;
  fees?: MarketFeeSchedule | null;
  /** Chain time of the snapshot, unix seconds. */
  asOf?: number;
}

const QUALIFICATION_BY_STATUS: Partial<Record<LiveMarketData["seriesStatus"], Qualification>> = {
  ACTIVE: "QUALIFIED",
  PAUSED: "SUSPENDED",
  DEPRECATED: "SUSPENDED",
  EXPIRED: "SUSPENDED",
};

function sideLots(book: readonly BookRow[], side: BookRow["side"]): number {
  return book.reduce((total, row) => total + (row.side === side && row.executable ? row.lots : 0), 0);
}

/**
 * The routes a market can execute on, priced only from real liquidity: the public book at its best prices with the
 * lots resting there, and the private RFQ, which has no price until solvers quote. A market the deployment does not
 * list has no route.
 */
export function deriveRoutes(market: Pick<PackageMarket, "bestBid" | "bestAsk" | "book" | "maxOrderLots">, fees: MarketFeeSchedule | null | undefined): RouteQuote[] {
  const protocolFeeBps = fees ? fees.takerFeeBps : Number.NaN;
  const askLots = sideLots(market.book, "ASK");
  const bidLots = sideLots(market.book, "BID");
  return [
    {
      id: "DIRECT_BOOK",
      label: "Public order book",
      source: "DIRECT",
      enterPrice: market.bestAsk,
      exitPrice: market.bestBid,
      protocolFeeBps,
      counterpartyFeeBps: 0,
      counterpartyFeeLabel: "Maker fee",
      guarantee: "PACKAGE_ATOMIC",
      etaLabel: "1 block",
      availableLots: askLots + bidLots,
      enterLots: askLots,
      exitLots: bidLots,
      requiresPrivate: false,
      intermediateExposureRate: 0,
      collateralMultiple: 1,
      note: "Resting onchain orders on the series book. A fill clears atomically in one transaction.",
    },
    {
      id: "SOLVER_RFQ",
      label: "Private RFQ",
      source: "SOLVER_FIRM",
      enterPrice: Number.NaN,
      exitPrice: Number.NaN,
      protocolFeeBps,
      counterpartyFeeBps: 0,
      counterpartyFeeLabel: "Solver fee",
      guarantee: "SOLVER_BONDED",
      etaLabel: "1 block after accept",
      availableLots: market.maxOrderLots ?? Number.NaN,
      requiresPrivate: true,
      intermediateExposureRate: 0,
      collateralMultiple: 1,
      note: "Request firm quotes from qualified solvers. There is no price until a solver quotes; the request is disclosed only to invited solvers.",
    },
  ];
}

/**
 * Overlays one market's live state on its catalog entry. Without live state the market marks at the live Chainlink
 * reference (clamped into its payoff range), else at the reference it was listed against; either way it is labelled
 * REFERENCE and carries no quotes, book, or routes.
 */
export function applyLiveMarket(base: PackageMarket, live: LiveMarketData | undefined, context: LiveMarketContext = {}): PackageMarket {
  const reference = context.references?.[base.underlying];
  const referencePrice = reference ? reference.price : base.referencePrice;
  const referenceAsOf = reference ? reference.updatedAt : base.referenceAsOf;

  if (!live) {
    if (!reference) return base;
    const mark = clampToRange(base, reference.price);
    return {
      ...base,
      netPrice: mark,
      priorNetPrice: mark,
      markSource: "REFERENCE",
      markAsOf: reference.updatedAt,
      referencePrice,
      referenceAsOf,
      ...deriveMarketReadings(base, mark, referencePrice),
    };
  }

  const mark = live.mark ?? Number.NaN;
  const book = live.book;
  const bestBid = live.bestBid ?? Number.NaN;
  const bestAsk = live.bestAsk ?? Number.NaN;
  const qualification = QUALIFICATION_BY_STATUS[live.seriesStatus] ?? base.qualification;
  const statusNote =
    live.seriesStatus === "PAUSED"
      ? " The series is paused onchain: no new orders clear until it resumes."
      : live.seriesStatus === "EXPIRED"
        ? " The series has reached expiry and settles against its fixing."
        : live.seriesStatus === "DEPRECATED"
          ? " The series version is deprecated onchain."
          : !live.tradable
            ? " New orders cannot clear on the active versions right now."
            : "";
  const merged: PackageMarket = {
    ...base,
    netPrice: mark,
    priorNetPrice: live.open24h ?? mark,
    bestBid,
    bestAsk,
    book,
    openInterestLots: live.openInterestLots ?? Number.NaN,
    firmDepthLots: book.reduce((total, row) => total + (row.executable ? row.lots : 0), 0),
    priceHistory: [...live.trades].reverse().map((trade) => trade.price),
    snapshotAgeSeconds: context.asOf ? Math.max(0, Math.floor(platformNow() / 1000) - context.asOf) : 0,
    qualification,
    qualificationNote: `${base.qualificationNote}${statusNote}`,
    markSource: live.markSource,
    markAsOf: live.markAsOf,
    referencePrice,
    referenceAsOf,
    seriesStatus: live.seriesStatus,
    listedOnchain: true,
    ...deriveMarketReadings({ ...base, qualification }, mark, referencePrice),
    routes: [],
  };
  merged.routes = deriveRoutes(merged, context.fees);
  return merged;
}

/** Every catalog market overlaid with one snapshot. */
export function overlaySnapshot(markets: readonly PackageMarket[], snapshot: MarketDataSnapshot): PackageMarket[] {
  const live = new Map(snapshot.markets.map((market) => [market.marketKey, market]));
  const context: LiveMarketContext = { references: snapshot.references, fees: snapshot.fees, asOf: snapshot.asOf };
  return markets.map((market) => applyLiveMarket(market, live.get(market.id), context));
}

/**
 * Adds a market's firm streaming quotes to its book, best prices and routes. Quote rows are labelled STREAM_FIRM and
 * keep their own expiry; a quote too close to its deadline stays visible but not executable, an expired one is gone,
 * so the book never shows an expired quote as liquidity and never contradicts the quote route the ticket offers.
 */
export function applyFirmQuotes(market: PackageMarket, state: MarketQuoteState | null | undefined, nowMs: number): PackageMarket {
  if (!state) return market;
  const rows = firmQuoteRows(state, nowMs);
  const book = rows.length > 0 ? [...rows, ...market.book] : market.book;
  const executableAsks = book.filter((row) => row.side === "ASK" && row.executable).map((row) => row.price);
  const executableBids = book.filter((row) => row.side === "BID" && row.executable).map((row) => row.price);
  const ask = state.status === "FIRM" && state.ask && quoteExecutable(state.ask, nowMs) ? state.ask : null;
  const bid = state.status === "FIRM" && state.bid && quoteExecutable(state.bid, nowMs) ? state.bid : null;
  const routes = ask || bid ? [firmQuoteRoute(market, ask, bid, nowMs), ...market.routes] : market.routes;
  return {
    ...market,
    book,
    bestAsk: executableAsks.length > 0 ? Math.min(...executableAsks) : market.bestAsk,
    bestBid: executableBids.length > 0 ? Math.max(...executableBids) : market.bestBid,
    firmDepthLots: book.reduce((total, row) => total + (row.executable ? row.lots : 0), 0),
    routes,
    firmQuotes: state,
  };
}

function firmQuoteRoute(
  market: PackageMarket,
  ask: MarketQuoteState["ask"],
  bid: MarketQuoteState["bid"],
  nowMs: number,
): RouteQuote {
  const ttl = Math.floor(Math.min(...[ask, bid].filter((quote) => quote !== null).map((quote) => quoteSecondsLeft(quote, nowMs))));
  const protocolFeeBps = market.routes.find((route) => route.id === "DIRECT_BOOK")?.protocolFeeBps ?? Number.NaN;
  return {
    id: "FIRM_QUOTE",
    label: "Firm maker quote",
    source: "STREAM_FIRM",
    enterPrice: ask ? ask.price : Number.NaN,
    exitPrice: bid ? bid.price : Number.NaN,
    protocolFeeBps,
    counterpartyFeeBps: 0,
    counterpartyFeeLabel: "Maker fee",
    guarantee: "PACKAGE_ATOMIC",
    etaLabel: "1 transaction",
    availableLots: (ask?.lots ?? 0) + (bid?.lots ?? 0),
    enterLots: ask?.lots ?? 0,
    exitLots: bid?.lots ?? 0,
    requiresPrivate: false,
    intermediateExposureRate: 0,
    collateralMultiple: 1,
    note: `Signed by the designated maker and backed by its onchain capacity, valid ${ttl}s. You sign typed data; one transaction settles both sides, gasless through Setryn's relayer or from your wallet.`,
  };
}
