"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { platformNow } from "@/lib/terminal/clock";
import { MARKETS } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import type {
  ChartInterval,
  LiveMarketData,
  MarketCandle,
  MarketCandlesResponse,
  MarketDataSnapshot,
  MarketFeedStatus,
  MarketTrade,
  ReferenceQuote,
} from "@/lib/market-data/types";

/*
 * The one market-data feed every page reads (docs/plans/network-runtime-real-data.md, section 4): the static runtime
 * catalog (`MARKETS`) overlaid with the onchain book, onchain fills, and Chainlink references from `/api/market-data`.
 * Marks, quotes, books, routes, and charts all derive from the same snapshot, so they never contradict each other.
 */

const POLL_MS = 3_000;
/** A snapshot older than this (by the browser clock) is reported as stale. */
const STALE_MS = 15_000;

interface MarketDataContextValue {
  markets: PackageMarket[];
  snapshot: MarketDataSnapshot | null;
  status: MarketFeedStatus;
  receivedAt: number;
}

const MarketDataContext = createContext<MarketDataContextValue | null>(null);

/** Overlays one market's live state on its catalog entry. Fields without live data keep the catalog's values. */
export function applyLiveMarket(base: PackageMarket, live: LiveMarketData | undefined): PackageMarket {
  if (!live) return base;
  const mark = live.mark ?? base.netPrice;
  return {
    ...base,
    netPrice: mark,
    priorNetPrice: live.open24h ?? base.priorNetPrice,
    bestBid: live.bestBid ?? base.bestBid,
    bestAsk: live.bestAsk ?? base.bestAsk,
    book: live.book,
    openInterestLots: live.openInterestLots ?? base.openInterestLots,
    firmDepthLots: live.book.reduce((total, row) => total + (row.executable ? row.lots : 0), 0),
    priceHistory: live.trades.length > 0 ? [...live.trades].reverse().map((trade) => trade.price) : base.priceHistory,
    snapshotAgeSeconds: 0,
  };
}

export function MarketDataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<MarketDataSnapshot | null>(null);
  const [status, setStatus] = useState<MarketFeedStatus>("LOADING");
  const [receivedAt, setReceivedAt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/market-data", { cache: "no-store" });
        if (!response.ok) throw new Error(`MARKET_DATA_${response.status}`);
        const next = (await response.json()) as MarketDataSnapshot;
        if (cancelled) return;
        setSnapshot(next);
        setReceivedAt(Date.now());
        setStatus("LIVE");
      } catch {
        if (!cancelled) setStatus((current) => (current === "LOADING" ? "ERROR" : "STALE"));
      } finally {
        if (!cancelled) timer = window.setTimeout(load, POLL_MS);
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (status !== "LIVE") return;
    const timer = window.setInterval(() => {
      if (Date.now() - receivedAt > STALE_MS) setStatus("STALE");
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [receivedAt, status]);

  const markets = useMemo(() => {
    const live = new Map(snapshot?.markets.map((market) => [market.marketKey, market]) ?? []);
    return MARKETS.map((market) => applyLiveMarket(market, live.get(market.id)));
  }, [snapshot]);

  const value = useMemo<MarketDataContextValue>(() => ({ markets, snapshot, status, receivedAt }), [markets, snapshot, status, receivedAt]);
  return <MarketDataContext.Provider value={value}>{children}</MarketDataContext.Provider>;
}

function useMarketDataContext(): MarketDataContextValue {
  const value = useContext(MarketDataContext);
  if (!value) throw new Error("MarketDataProvider is missing");
  return value;
}

/** Every listed market with its live overlay, the feed status, and the references. */
export function useMarketBoard(): {
  markets: PackageMarket[];
  status: MarketFeedStatus;
  /** Chain time of the snapshot, unix seconds; 0 before the first snapshot. */
  asOf: number;
  references: Record<string, ReferenceQuote>;
  snapshot: MarketDataSnapshot | null;
} {
  const { markets, snapshot, status } = useMarketDataContext();
  return { markets, status, asOf: snapshot?.asOf ?? 0, references: snapshot?.references ?? {}, snapshot };
}

/** One market: its live overlay (the catalog entry until data arrives) and its raw live state. */
export function useLiveMarket(marketId: string): { market: PackageMarket; live: LiveMarketData | null; asOf: number } {
  const { markets, snapshot } = useMarketDataContext();
  const market = markets.find((candidate) => candidate.id === marketId);
  if (!market) throw new Error(`Unknown market: ${marketId}`);
  const live = snapshot?.markets.find((candidate) => candidate.marketKey === marketId) ?? null;
  return { market, live, asOf: snapshot?.asOf ?? 0 };
}

/** Recent onchain fills for one market, newest first. */
export function useMarketTrades(marketId: string): MarketTrade[] {
  const { snapshot } = useMarketDataContext();
  return snapshot?.markets.find((candidate) => candidate.marketKey === marketId)?.trades ?? [];
}

/** Chainlink references keyed by underlying ("BTC", "EUR/USD"). */
export function useReferencePrices(): Record<string, ReferenceQuote> {
  return useMarketDataContext().snapshot?.references ?? {};
}

/** OHLCV bars for one market and interval, refreshed with the feed. */
export function useMarketCandles(
  marketId: string,
  interval: ChartInterval,
): { candles: MarketCandle[]; source: MarketCandlesResponse["source"] | null; loading: boolean } {
  const { snapshot } = useMarketDataContext();
  const [state, setState] = useState<{ key: string; response: MarketCandlesResponse | null }>({ key: "", response: null });
  const key = `${marketId}:${interval}`;
  const blockNumber = snapshot?.blockNumber ?? 0;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market-data/candles?market=${encodeURIComponent(marketId)}&interval=${interval}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<MarketCandlesResponse>) : null))
      .then((response) => {
        if (!cancelled && response) setState({ key, response });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [blockNumber, interval, key, marketId]);

  const response = state.key === key ? state.response : null;
  return { candles: response?.candles ?? [], source: response?.source ?? null, loading: response === null };
}

/** The platform clock (chain-corrected), in unix seconds, ticking once a second. */
export function useChainNow(): number {
  const [now, setNow] = useState(() => Math.floor(platformNow() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(platformNow() / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
