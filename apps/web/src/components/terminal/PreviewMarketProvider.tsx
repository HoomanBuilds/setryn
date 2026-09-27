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
import type { PackageMarket } from "@/lib/terminal/types";

interface PreviewMarketState {
  tick: number;
  streams: Record<string, PreviewStreamState>;
}

interface PreviewMarketContextValue {
  markets: PackageMarket[];
  tick: number;
  previewEpochSeconds: number;
}

const PreviewMarketContext = createContext<PreviewMarketContextValue | null>(null);

function initialState(): PreviewMarketState {
  return {
    tick: 0,
    streams: Object.fromEntries(
      MARKETS.map((market) => [market.id, initialPreviewStream(market.id)]),
    ),
  };
}

export function PreviewMarketProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewMarketState>(initialState);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((current) => {
        const streams: Record<string, PreviewStreamState> = {};
        for (const market of MARKETS) {
          const previous = current.streams[market.id] ?? initialPreviewStream(market.id);
          streams[market.id] = advancePreviewStream(market.id, previous);
        }
        return { tick: current.tick + 1, streams };
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
    const previewEpochSeconds =
      Math.floor(Date.parse(SCENARIO_CLOCK_ISO) / 1_000) + state.tick;
    return { markets, tick: state.tick, previewEpochSeconds };
  }, [markets, state.tick]);

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
