"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { platformNow } from "@/lib/terminal/clock";
import { overlaySnapshot } from "@/lib/market-data/overlay";
import { MARKETS } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import type {
  ChartInterval,
  LiveMarketData,
  MarketCandle,
  MarketCandlesResponse,
  MarketChainState,
  MarketDataSnapshot,
  MarketFeeSchedule,
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
/** Reference bars move with the aggregator, not with blocks, so they refresh on a timer. */
const REFERENCE_CANDLES_REFRESH_MS = 60_000;

interface MarketDataContextValue {
  markets: PackageMarket[];
  snapshot: MarketDataSnapshot | null;
  status: MarketFeedStatus;
  receivedAt: number;
  refresh: () => void;
}

const MarketDataContext = createContext<MarketDataContextValue | null>(null);

export { applyLiveMarket, deriveRoutes, type LiveMarketContext } from "@/lib/market-data/overlay";

function feedStatus(snapshot: MarketDataSnapshot): MarketFeedStatus {
  return snapshot.chain.status === "LIVE" ? "LIVE" : "ERROR";
}

export function MarketDataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<MarketDataSnapshot | null>(null);
  const [status, setStatus] = useState<MarketFeedStatus>("LOADING");
  const [receivedAt, setReceivedAt] = useState(0);
  const loadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let inflight = false;
    const load = async () => {
      if (inflight) return;
      inflight = true;
      window.clearTimeout(timer);
      try {
        const response = await fetch("/api/market-data", { cache: "no-store" });
        if (!response.ok) throw new Error(`MARKET_DATA_${response.status}`);
        const next = (await response.json()) as MarketDataSnapshot;
        if (cancelled) return;
        setSnapshot(next);
        setReceivedAt(Date.now());
        setStatus(feedStatus(next));
      } catch {
        if (!cancelled) setStatus((current) => (current === "LOADING" || current === "ERROR" ? "ERROR" : "STALE"));
      } finally {
        inflight = false;
        if (!cancelled) timer = window.setTimeout(load, POLL_MS);
      }
    };
    loadRef.current = () => void load();
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

  const markets = useMemo(() => (snapshot ? overlaySnapshot(MARKETS, snapshot) : MARKETS), [snapshot]);

  const refresh = useCallback(() => loadRef.current(), []);
  const value = useMemo<MarketDataContextValue>(
    () => ({ markets, snapshot, status, receivedAt, refresh }),
    [markets, snapshot, status, receivedAt, refresh],
  );
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
  /** Chain time of the snapshot, unix seconds; 0 before the first snapshot or while the chain is unavailable. */
  asOf: number;
  references: Record<string, ReferenceQuote>;
  snapshot: MarketDataSnapshot | null;
} {
  const { markets, snapshot, status } = useMarketDataContext();
  return { markets, status, asOf: snapshot?.asOf ?? 0, references: snapshot?.references ?? {}, snapshot };
}

/** Feed health for status displays: whether the chain answered, at which block, and when the browser last heard. */
export function useMarketFeed(): {
  status: MarketFeedStatus;
  chain: MarketChainState | null;
  network: string | null;
  blockNumber: number;
  asOf: number;
  /** Browser milliseconds of the last snapshot; 0 before the first. */
  receivedAt: number;
  fees: MarketFeeSchedule | null;
  referenceCount: number;
} {
  const { snapshot, status, receivedAt } = useMarketDataContext();
  return {
    status,
    chain: snapshot?.chain ?? null,
    network: snapshot?.network ?? null,
    blockNumber: snapshot?.blockNumber ?? 0,
    asOf: snapshot?.asOf ?? 0,
    receivedAt,
    fees: snapshot?.fees ?? null,
    referenceCount: snapshot ? Object.keys(snapshot.references).length : 0,
  };
}

/** Re-reads the feed now, for example right after the viewer's own order changes the book. */
export function useMarketDataRefresh(): () => void {
  return useMarketDataContext().refresh;
}

/** One market: its live overlay (the catalog entry until data arrives) and its raw live state. */
export function useLiveMarket(marketId: string): { market: PackageMarket; live: LiveMarketData | null; asOf: number } {
  const { markets, snapshot } = useMarketDataContext();
  const market = markets.find((candidate) => candidate.id === marketId);
  if (!market) throw new Error(`Unknown market: ${marketId}`);
  const live = snapshot?.markets.find((candidate) => candidate.marketKey === marketId) ?? null;
  return { market, live, asOf: snapshot?.asOf ?? 0 };
}

const NO_TRADES: MarketTrade[] = [];

/** Recent onchain fills for one market, newest first. */
export function useMarketTrades(marketId: string): MarketTrade[] {
  const { snapshot } = useMarketDataContext();
  return snapshot?.markets.find((candidate) => candidate.marketKey === marketId)?.trades ?? NO_TRADES;
}

const NO_REFERENCES: Record<string, ReferenceQuote> = {};

/** Chainlink references keyed by underlying ("BTC", "EUR/USD"). */
export function useReferencePrices(): Record<string, ReferenceQuote> {
  return useMarketDataContext().snapshot?.references ?? NO_REFERENCES;
}

/** OHLCV bars for one market and interval, refreshed with the feed. */
export function useMarketCandles(
  marketId: string,
  interval: ChartInterval,
): {
  candles: MarketCandle[];
  source: MarketCandlesResponse["source"] | null;
  loading: boolean;
  reference: MarketCandlesResponse["reference"] | null;
} {
  const { snapshot } = useMarketDataContext();
  const [state, setState] = useState<{ key: string; response: MarketCandlesResponse | null }>({ key: "", response: null });
  const [minute, setMinute] = useState(0);
  const key = `${marketId}:${interval}`;
  const blockNumber = snapshot?.blockNumber ?? 0;
  const tradeCount = snapshot?.markets.find((candidate) => candidate.marketKey === marketId)?.trades[0]?.id ?? "";

  useEffect(() => {
    const timer = window.setInterval(() => setMinute((value) => value + 1), REFERENCE_CANDLES_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

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
  }, [blockNumber, tradeCount, interval, key, marketId, minute]);

  const response = state.key === key ? state.response : null;
  return {
    candles: response?.candles ?? [],
    source: response?.source ?? null,
    loading: response === null,
    reference: response?.reference ?? null,
  };
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
