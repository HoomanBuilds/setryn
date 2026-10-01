import type { GatewaySnapshot, OnchainMarket, RfqRequest } from "@/lib/internal-gateway/types";
import type { MarketDataSnapshot } from "@/lib/market-data/types";
import type { BookRow, PackageMarket } from "@/lib/terminal/types";
import type {
  MarketRequestStats,
  OpportunityState,
  RecoveryItem,
  RequestStats,
  RoutePlan,
  RoutePlanFill,
  SolverOpportunity,
} from "./types";

/** Lot size: consideration per unit of price per lot (the market's contract multiplier). */
function lotSizeOf(market: PackageMarket): number {
  return Number.isFinite(market.lotSize) && market.lotSize > 0 ? market.lotSize : market.contractMultiplier;
}

/**
 * Walks the public book for `lots` in `hedgeAction`'s direction. Rows matching the account's own resting orders are left
 * out; fees are the taker rate on the consideration above the floor, as the fee engine charges them.
 */
export function planRoute(
  market: PackageMarket,
  book: readonly BookRow[],
  hedgeAction: "BUY" | "SELL",
  lots: number,
  fees: Pick<OnchainMarket, "takerFeeBps" | "takerFlatFeeUsd"> | null,
  ownOrderIds: ReadonlySet<string>,
): RoutePlan {
  const side = hedgeAction === "BUY" ? "ASK" : "BID";
  const rows = book
    .filter((row) => row.side === side && row.executable && Number.isFinite(row.price) && Number.isFinite(row.lots) && row.lots > 0)
    .sort((left, right) => (hedgeAction === "BUY" ? left.price - right.price : right.price - left.price));
  const fills: RoutePlanFill[] = [];
  let remaining = lots;
  let excludedOwnLots = 0;
  for (const row of rows) {
    if (ownOrderIds.has(row.id.toLowerCase())) {
      excludedOwnLots += row.lots;
      continue;
    }
    if (remaining <= 0) break;
    const take = Math.min(remaining, row.lots);
    fills.push({ price: row.price, lots: take, orderId: row.id });
    remaining -= take;
  }
  const fillableLots = lots - Math.max(0, remaining);
  const lotSize = lotSizeOf(market);
  const floor = Number.isFinite(market.floor) ? market.floor : 0;
  const notional = fills.reduce((total, fill) => total + fill.price * fill.lots, 0);
  const vwap = fillableLots > 0 ? notional / fillableLots : null;
  const consideration = fills.reduce((total, fill) => total + Math.max(0, fill.price - floor) * fill.lots * lotSize, 0);
  const feesUsd = fees ? (consideration * fees.takerFeeBps) / 10_000 + (fills.length > 0 ? fees.takerFlatFeeUsd : 0) : 0;
  const feePrice = fillableLots > 0 ? feesUsd / (fillableLots * lotSize) : 0;
  const breakEven = vwap === null || fillableLots < lots ? null : hedgeAction === "BUY" ? vwap + feePrice : vwap - feePrice;
  return {
    marketId: market.id,
    hedgeAction,
    requestedLots: lots,
    fillableLots,
    fills,
    excludedOwnLots,
    touch: rows.find((row) => !ownOrderIds.has(row.id.toLowerCase()))?.price ?? null,
    vwap,
    worst: fills.length > 0 ? fills[fills.length - 1].price : null,
    feesUsd,
    feePrice,
    breakEven,
  };
}

export function takerAction(request: RfqRequest): "BUY" | "SELL" {
  const intent = request.authorization.intent;
  if (intent.side === "ENTER") return intent.packageSide === "LONG" ? "BUY" : "SELL";
  return intent.packageSide === "LONG" ? "SELL" : "BUY";
}

export function requestState(request: RfqRequest, now: number): OpportunityState {
  if (request.state === "EXECUTED" || request.state === "CANCELLED") return request.state;
  if (Date.parse(request.expiresAt) / 1000 <= now) return "EXPIRED";
  return request.state;
}

function ownOrders(snapshot: GatewaySnapshot): Set<string> {
  const ids = new Set<string>();
  for (const order of snapshot.restingOrders) {
    ids.add(order.id.toLowerCase());
    ids.add(order.orderHash.toLowerCase());
  }
  return ids;
}

/** Every private request the account can see, newest first, with its quotes and the book comparison. */
export function solverOpportunities(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  feed: MarketDataSnapshot | null,
  now: number,
): SolverOpportunity[] {
  const own = ownOrders(snapshot);
  return [...snapshot.rfqRequests]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map((request) => {
      const intent = request.authorization.intent;
      const market = markets.find((candidate) => candidate.id === intent.marketId) ?? null;
      const action = takerAction(request);
      const book = feed?.markets.find((candidate) => candidate.marketKey === intent.marketId)?.book ?? [];
      const plan = market ? planRoute(market, book, action, intent.lots, snapshot.onchainMarkets[intent.marketId] ?? null, own) : null;
      const live = request.quotes.filter((quote) => Date.parse(quote.expiresAt) / 1000 > now || request.selectedQuoteId === quote.id);
      const bestQuote =
        [...live].sort((left, right) => (action === "BUY" ? left.packagePrice - right.packagePrice : right.packagePrice - left.packagePrice))[0] ?? null;
      const lotSize = market ? lotSizeOf(market) : 0;
      const improvementUsd =
        bestQuote && plan && plan.vwap !== null && plan.fillableLots >= intent.lots
          ? (action === "BUY" ? plan.vwap - bestQuote.packagePrice : bestQuote.packagePrice - plan.vwap) * intent.lots * lotSize
          : null;
      return {
        id: request.id,
        request,
        marketId: intent.marketId,
        takerAction: action,
        lots: intent.lots,
        limitPrice: intent.limitPrice,
        deadline: Math.floor(Date.parse(request.expiresAt) / 1000),
        state: requestState(request, now),
        quotes: request.quotes,
        bestQuote,
        plan,
        improvementUsd,
        collateralRequired: Number.isFinite(intent.collateralRequired) ? intent.collateralRequired : 0,
      };
    });
}

export function requestStats(opportunities: readonly SolverOpportunity[]): RequestStats {
  const byMarket = new Map<string, MarketRequestStats>();
  let quoted = 0;
  let quotesReceived = 0;
  let executedLots = 0;
  for (const entry of opportunities) {
    const stats = byMarket.get(entry.marketId) ?? { marketId: entry.marketId, requests: 0, quoted: 0, executed: 0, lots: 0, executedLots: 0 };
    stats.requests += 1;
    stats.lots += entry.lots;
    if (entry.quotes.length > 0) {
      stats.quoted += 1;
      quoted += 1;
    }
    quotesReceived += entry.quotes.length;
    if (entry.state === "EXECUTED") {
      stats.executed += 1;
      stats.executedLots += entry.lots;
      executedLots += entry.lots;
    }
    byMarket.set(entry.marketId, stats);
  }
  const total = opportunities.length;
  const executed = opportunities.filter((entry) => entry.state === "EXECUTED").length;
  return {
    total,
    open: opportunities.filter((entry) => entry.state === "OPEN" || entry.state === "SELECTED").length,
    quoted,
    executed,
    cancelled: opportunities.filter((entry) => entry.state === "CANCELLED").length,
    expired: opportunities.filter((entry) => entry.state === "EXPIRED").length,
    quotesReceived,
    executedLots,
    quoteRate: total > 0 ? quoted / total : 0,
    executionRate: total > 0 ? executed / total : 0,
    byMarket: [...byMarket.values()].sort((left, right) => right.requests - left.requests),
  };
}

/** Requests past their deadline that still hold state onchain; expiring them is permissionless. */
export function recoveryItems(opportunities: readonly SolverOpportunity[]): RecoveryItem[] {
  return opportunities
    .filter((entry) => entry.state === "EXPIRED")
    .map((entry) => {
      const selected = entry.request.state === "SELECTED";
      return {
        id: entry.id,
        kind: selected ? "SELECTION_EXPIRED" : "EXPIRED_OPEN",
        request: entry.request,
        title: selected ? `Selected quote lapsed on ${entry.marketId}` : `Request lapsed on ${entry.marketId}`,
        detail: selected
          ? "A quote was selected but the handoff did not clear before the deadline. Expiring the request releases the locked capacity."
          : "The request passed its deadline without a selection. Expiring it closes the request and frees its order.",
        call: "PrivateRfqBook.expireRfq",
      };
    });
}
