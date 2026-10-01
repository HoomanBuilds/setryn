"use client";

import { useMemo } from "react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { portfolioRuntime } from "@/lib/portfolio/runtime";

/**
 * One read of the account for every portfolio surface: the onchain snapshot, the market-data board it is marked
 * against, the platform clock, and the derived book.
 */
export function usePortfolio() {
  const snapshot = useGatewaySnapshot();
  const board = useMarketBoard();
  const nowSeconds = useChainNow();
  const { markets, snapshot: feed } = board;
  /* Positions are re-marked on each feed snapshot; the clock only moves their day counts, so it is read per minute. */
  const minute = Math.floor(nowSeconds / 60);
  const portfolio = useMemo(
    () => portfolioRuntime(snapshot, markets, { live: feed, nowMs: minute * 60_000 }),
    [snapshot, markets, feed, minute],
  );
  return { snapshot, markets, board, nowSeconds, portfolio };
}

export type PortfolioRead = ReturnType<typeof usePortfolio>;
