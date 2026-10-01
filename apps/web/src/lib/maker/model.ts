import type { GatewaySnapshot, RestingPackageOrder } from "@/lib/internal-gateway/types";
import type { BookRow, PackageMarket } from "@/lib/terminal/types";
import type { LadderLevel, MarketInventory, OwnLevel, QuoteAction, WorkingQuote } from "./types";

/** Buy for an entering long or an exiting short; sell otherwise. */
export function quoteAction(order: Pick<RestingPackageOrder, "side" | "packageSide">): QuoteAction {
  if (order.side === "ENTER") return order.packageSide === "LONG" ? "BUY" : "SELL";
  return order.packageSide === "LONG" ? "SELL" : "BUY";
}

export function isWorking(order: RestingPackageOrder): boolean {
  return (order.state === "WORKING" || order.state === "PARTIALLY_FILLED") && order.remainingLots > 0;
}

/** The wallet's working orders on one market (or every market), newest first. */
export function workingQuotes(snapshot: GatewaySnapshot, marketId?: string): WorkingQuote[] {
  return snapshot.restingOrders
    .filter((order) => isWorking(order) && (marketId === undefined || order.marketId === marketId))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map((order) => ({ order, action: quoteAction(order) }));
}

export function ownLevels(quotes: readonly WorkingQuote[]): OwnLevel[] {
  const levels = new Map<string, OwnLevel>();
  for (const { order, action } of quotes) {
    const key = `${action}:${order.limitPrice}`;
    const level = levels.get(key) ?? { action, price: order.limitPrice, lots: 0, orders: 0 };
    level.lots += order.remainingLots;
    level.orders += 1;
    levels.set(key, level);
  }
  return [...levels.values()];
}

/** The public book by price, asks above bids, with the wallet's own lots at each level. */
export function ladder(book: readonly BookRow[], own: readonly OwnLevel[]): LadderLevel[] {
  const levels = new Map<number, LadderLevel>();
  const level = (price: number) => {
    const existing = levels.get(price);
    if (existing) return existing;
    const created = { price, bidLots: 0, askLots: 0, ownBidLots: 0, ownAskLots: 0 };
    levels.set(price, created);
    return created;
  };
  for (const row of book) {
    if (!Number.isFinite(row.price) || !Number.isFinite(row.lots)) continue;
    if (row.side === "BID") level(row.price).bidLots += row.lots;
    else level(row.price).askLots += row.lots;
  }
  for (const entry of own) {
    if (!Number.isFinite(entry.price)) continue;
    if (entry.action === "BUY") level(entry.price).ownBidLots += entry.lots;
    else level(entry.price).ownAskLots += entry.lots;
  }
  return [...levels.values()].sort((left, right) => right.price - left.price);
}

export function inventoryByMarket(snapshot: GatewaySnapshot): Map<string, MarketInventory> {
  const out = new Map<string, MarketInventory>();
  for (const position of snapshot.positions) {
    const entry = out.get(position.marketId) ?? {
      marketId: position.marketId,
      longLots: 0,
      shortLots: 0,
      netLots: 0,
      averageEntry: null,
      collateral: 0,
      positions: [],
    };
    if (position.side === "LONG") entry.longLots += position.lots;
    else entry.shortLots += position.lots;
    entry.collateral += Number.isFinite(position.collateral) ? position.collateral : 0;
    entry.positions.push(position);
    out.set(position.marketId, entry);
  }
  for (const entry of out.values()) {
    entry.netLots = entry.longLots - entry.shortLots;
    const netSide = entry.netLots > 0 ? "LONG" : entry.netLots < 0 ? "SHORT" : null;
    const side = entry.positions.filter((position) => position.side === netSide);
    const lots = side.reduce((total, position) => total + position.lots, 0);
    entry.averageEntry = lots > 0 ? side.reduce((total, position) => total + position.entryPrice * position.lots, 0) / lots : null;
  }
  return out;
}

/** Rounds a price onto the market's tick grid. */
export function onTick(price: number, market: Pick<PackageMarket, "tickSize" | "priceDecimals">): number {
  const tick = market.tickSize > 0 ? market.tickSize : 10 ** -market.priceDecimals;
  return Number((Math.round(price / tick) * tick).toFixed(market.priceDecimals));
}

/**
 * Fee cap for a maker quote: the larger of the maker and taker charge on the quote's full consideration bound
 * (lots x price x contract multiplier, an upper bound of the range forward's consideration), rounded up to a micro-dollar.
 */
export function quoteFeeCap(
  lots: number,
  price: number,
  contractMultiplier: number,
  fees: { makerFeeBps: number; takerFeeBps: number; makerFlatFeeUsd: number; takerFlatFeeUsd: number } | null,
): number {
  if (!fees) return 0;
  const consideration = lots * Math.abs(price) * contractMultiplier;
  const charge = (bps: number, flat: number) => (consideration * bps) / 10_000 + flat;
  const cap = Math.max(charge(fees.makerFeeBps, fees.makerFlatFeeUsd), charge(fees.takerFeeBps, fees.takerFlatFeeUsd));
  return Math.ceil(cap * 1_000_000) / 1_000_000;
}

const ORDER_ERRORS: Record<string, string> = {
  MARKET_NOT_ONCHAIN_ENABLED: "This market is not registered on the connected network.",
  INVALID_LOTS: "Lots must be a whole number within the market's order limit.",
  INVALID_LIMIT_PRICE: "Enter a valid price on the market's tick grid.",
  FEE_SCHEDULE_INACTIVE: "The fee schedule is not active, so nothing can clear right now.",
  MARKET_FEE_SCHEDULE_PENDING: "The market is moving to a new fee schedule. Try again shortly.",
  FEE_SCHEDULE_CHANGED: "Fees changed since the page loaded. Review and sign again.",
  RECIPIENT_MISMATCH: "The connected wallet changed. Reconnect and try again.",
  ACCOUNT_MISMATCH: "The connected wallet changed. Reconnect and try again.",
  RESTING_ORDER_NOT_FOUND: "That quote is no longer in the book.",
  RESTING_ORDER_NOT_WORKING: "That quote is no longer working.",
  ORDER_AUTHORIZATION_UNAVAILABLE: "This quote was signed in another session and must be cancelled from there or left to expire.",
  WALLET_CONNECTION_REJECTED: "Wallet connection was not completed.",
};

export function makerError(error: unknown, fallback = "The request did not complete."): string {
  if (!(error instanceof Error)) return fallback;
  const code = error.message.split(/[\s:]/)[0];
  if (ORDER_ERRORS[code]) return ORDER_ERRORS[code];
  if (/user rejected|denied/i.test(error.message)) return "The wallet declined the signature.";
  if (/post.?only|would cross|crosses/i.test(error.message)) return "The quote would cross the book, so the post-only order was refused.";
  return fallback;
}
