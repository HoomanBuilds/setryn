import type { BookRow } from "@/lib/terminal/types";

/*
 * Wire types of the market-data feed (docs/plans/network-runtime-real-data.md, section 4). Every value is read from
 * chain state or a Chainlink aggregator; a market with no orders or fills reports empty lists, never a stand-in.
 */

/** One onchain fill on a market, newest first in every list. */
export interface MarketTrade {
  /** Unique per fill: the clearing fill id, else `${txHash}:${logIndex}`. */
  id: string;
  /** Unix seconds of the block that cleared the fill. */
  time: number;
  price: number;
  lots: number;
  /** Aggressor side: a buy lifts the offer, a sell hits the bid. */
  side: "BUY" | "SELL";
  txHash: `0x${string}`;
  blockNumber: number;
}

export type ChartInterval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d" | "1w";

export interface MarketCandle {
  /** Unix seconds of the bar's open. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Traded lots in the bar; zero for reference bars. */
  volume: number;
}

/** Where a market's mark came from, most to least direct. */
export type MarkSource = "MID" | "LAST" | "REFERENCE" | "NONE";

export type SeriesStatus = "ACTIVE" | "PAUSED" | "DEPRECATED" | "EXPIRED" | "UNKNOWN";

/** A Chainlink reading of one underlying (for example "BTC" or "EUR/USD"). */
export interface ReferenceQuote {
  underlying: string;
  price: number;
  /** Unix seconds the aggregator last updated. */
  updatedAt: number;
  roundId: string;
  source: "chainlink";
  /** Aggregator proxy address. */
  feed: `0x${string}`;
  /** Chain the aggregator lives on (42161 for Arbitrum One). */
  chainId: number;
}

/** Live state of one runtime market at one block. */
export interface LiveMarketData {
  marketKey: string;
  seriesStatus: SeriesStatus;
  /** Resting public-book orders of the active series version, best first per side (asks then bids). */
  book: BookRow[];
  bestBid: number | null;
  bestAsk: number | null;
  last: number | null;
  mark: number | null;
  markSource: MarkSource;
  /** First fill price at or after 24 hours ago, for the day's change; null without fills in the window. */
  open24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24hLots: number;
  /** Open interest in lots, when the position engine reports it. */
  openInterestLots: number | null;
  /** Most recent fills, newest first (at most 80). */
  trades: MarketTrade[];
}

/** `GET /api/market-data` response. */
export interface MarketDataSnapshot {
  network: string;
  chainId: number;
  blockNumber: number;
  /** Chain time of the block the snapshot read, unix seconds. */
  asOf: number;
  markets: LiveMarketData[];
  /** Keyed by underlying ("BTC", "EUR/USD"). Missing when the reference RPC could not be read. */
  references: Record<string, ReferenceQuote>;
}

/** `GET /api/market-data/candles` response. */
export interface MarketCandlesResponse {
  marketKey: string;
  interval: ChartInterval;
  /** "FILLS" when the bars are onchain fills; "REFERENCE" when the market has none and the bars are the underlying's. */
  source: "FILLS" | "REFERENCE";
  candles: MarketCandle[];
}

export type MarketFeedStatus = "LOADING" | "LIVE" | "STALE" | "ERROR";
