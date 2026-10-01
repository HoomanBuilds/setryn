import type { ExecutionReceipt } from "@/lib/internal-gateway/types";
import type { MarketDataSnapshot } from "@/lib/market-data/types";
import { forwardPnl, rangeTerms } from "@/lib/portfolio/forward";
import type { Position } from "@/lib/portfolio/types";

export interface SessionPoint {
  /** Unix seconds of the observation. */
  t: number;
  /** Open-book profit and loss at that observation. */
  pnl: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function receiptSeconds(receipt: ExecutionReceipt | undefined): number | null {
  if (!receipt) return null;
  const ms = Date.parse(receipt.createdAt);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * The open book's profit and loss through its own history, rebuilt from real records only: each position counts from
 * its opening fill, and is marked at every onchain fill its market printed since (the feed's recent trades), then at
 * the live mark. Between prints the last print stands. Fees are booked at the opening fill. A position whose opening
 * time is not recorded enters at the first print the feed holds; without any print the book has no history yet.
 */
export function sessionSeries(
  positions: readonly Position[],
  receipts: readonly ExecutionReceipt[],
  feed: MarketDataSnapshot | null,
  nowSeconds: number,
  maxPoints = 240,
): SessionPoint[] {
  if (positions.length === 0 || !feed) return [];
  const trades = new Map(feed.markets.map((market) => [market.marketKey, [...market.trades].reverse()]));
  const opened = new Map(
    positions.map((position) => {
      const receipt = receipts.find((candidate) => candidate.id === position.receiptId);
      return [position.id, receiptSeconds(receipt)] as const;
    }),
  );

  const times = new Set<number>();
  for (const position of positions) {
    const start = opened.get(position.id);
    if (start !== null && start !== undefined) times.add(start);
    for (const trade of trades.get(position.market.id) ?? []) {
      if (start === null || start === undefined || trade.time >= start) times.add(trade.time);
    }
  }
  if (times.size === 0) return [];
  const end = Math.max(nowSeconds, feed.asOf);
  times.add(end);

  let ordered = [...times].filter((t) => t <= end).sort((a, b) => a - b);
  if (ordered.length > maxPoints) {
    const step = (ordered.length - 1) / (maxPoints - 1);
    ordered = Array.from({ length: maxPoints }, (_, index) => ordered[Math.round(index * step)]);
  }

  return ordered.map((t) => {
    const pnl = positions.reduce((total, position) => {
      const start = opened.get(position.id);
      const history = trades.get(position.market.id) ?? [];
      if (start !== null && start !== undefined && t < start) return total;
      if ((start === null || start === undefined) && (history.length === 0 || t < history[0].time)) return total;
      const last = [...history].reverse().find((trade) => trade.time <= t);
      const level = t === end && position.markPrice !== null ? position.markPrice : (last?.price ?? position.entryPrice);
      const price = forwardPnl(position.side, position.lots, position.entryPrice, level, rangeTerms(position.market));
      return total + round(price) + position.pnl.fees;
    }, 0);
    return { t, pnl: round(pnl) };
  });
}
