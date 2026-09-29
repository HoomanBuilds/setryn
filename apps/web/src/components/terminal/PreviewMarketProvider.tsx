"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import { MARKETS } from "@/lib/terminal/markets";
import {
  advancePreviewStream,
  derivePreviewMarket,
  initialPreviewStream,
  type PreviewStreamState,
} from "@/lib/terminal/preview-market";
import {
  PREVIEW_TRADE_LIMIT,
  nextPreviewTrade,
  seedPreviewTrades,
  type PreviewTrade,
} from "@/lib/terminal/preview-trades";
import type { PackageMarket } from "@/lib/terminal/types";

interface PreviewMarketState {
  tick: number;
  streams: Record<string, PreviewStreamState>;
  trades: Record<string, PreviewTrade[]>;
}

interface PreviewMarketContextValue {
  markets: PackageMarket[];
  tick: number;
  previewEpochSeconds: number;
  trades: Record<string, PreviewTrade[]>;
}

const SCENARIO_EPOCH_SECONDS = Math.floor(Date.parse(SCENARIO_CLOCK_ISO) / 1_000);

const PreviewMarketContext = createContext<PreviewMarketContextValue | null>(null);

function initialState(): PreviewMarketState {
  return {
    tick: 0,
    streams: Object.fromEntries(
      MARKETS.map((market) => [market.id, initialPreviewStream(market.id)]),
    ),
    trades: Object.fromEntries(
      MARKETS.map((market) => [market.id, seedPreviewTrades(market, SCENARIO_EPOCH_SECONDS)]),
    ),
  };
}

export function PreviewMarketProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewMarketState>(initialState);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((current) => {
        const tick = current.tick + 1;
        const streams: Record<string, PreviewStreamState> = {};
        const trades: Record<string, PreviewTrade[]> = {};
        for (const market of MARKETS) {
          const previous = current.streams[market.id] ?? initialPreviewStream(market.id);
          const next = advancePreviewStream(market.id, previous);
          streams[market.id] = next;
          // The print sits at the new mark, so the tape, the candle, and the book mid move together.
          const print = nextPreviewTrade(
            derivePreviewMarket(market, next),
            tick,
            derivePreviewMarket(market, previous).netPrice,
            SCENARIO_EPOCH_SECONDS + tick,
          );
          trades[market.id] = [print, ...(current.trades[market.id] ?? [])].slice(0, PREVIEW_TRADE_LIMIT);
        }
        return { tick, streams, trades };
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const markets = useMemo(
    () =>
      MARKETS.map((base) =>
        derivePreviewMarket(base, state.streams[base.id] ?? initialPreviewStream(base.id)),
      ),
    [state.streams],
  );

  const value = useMemo<PreviewMarketContextValue>(() => {
    const previewEpochSeconds = SCENARIO_EPOCH_SECONDS + state.tick;
    return { markets, tick: state.tick, previewEpochSeconds, trades: state.trades };
  }, [markets, state.tick, state.trades]);

  return <PreviewMarketContext.Provider value={value}>{children}</PreviewMarketContext.Provider>;
}

function usePreviewContext(): PreviewMarketContextValue {
  const value = useContext(PreviewMarketContext);
  if (!value) throw new Error("PreviewMarketProvider is missing");
  return value;
}

/** Live board for every package market plus the shared tick. */
export function usePreviewBoard(): PreviewMarketContextValue {
  return usePreviewContext();
}

/** Shared tick and its preview epoch. */
export function usePreviewTick(): { tick: number; previewEpochSeconds: number } {
  const { tick, previewEpochSeconds } = usePreviewContext();
  return { tick, previewEpochSeconds };
}

/** Recent prints for one market, newest first, from the same stream as its marks. */
export function usePreviewTrades(marketId: string): PreviewTrade[] {
  return usePreviewContext().trades[marketId] ?? [];
}

/** One live market from the shared board, with its static base for history. */
export function usePreviewMarket(marketId: string): {
  baseMarket: PackageMarket;
  liveMarket: PackageMarket;
  tick: number;
  previewEpochSeconds: number;
} {
  const { markets, tick, previewEpochSeconds } = usePreviewContext();
  const baseMarket = MARKETS.find((candidate) => candidate.id === marketId);
  if (!baseMarket) throw new Error(`Unknown preview market: ${marketId}`);
  const liveMarket = markets.find((candidate) => candidate.id === marketId) ?? baseMarket;
  return { baseMarket, liveMarket, tick, previewEpochSeconds };
}
