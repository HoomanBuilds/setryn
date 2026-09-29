"use client";

import { useMemo } from "react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { portfolioRuntime } from "@/lib/portfolio/runtime";

/**
 * One read of the account for every portfolio surface: the onchain snapshot,
 * the coherent preview board it is marked against, and the derived book.
 */
export function usePortfolio() {
  const snapshot = useGatewaySnapshot();
  const { markets, tick, previewEpochSeconds } = usePreviewBoard();
  const portfolio = useMemo(() => portfolioRuntime(snapshot, markets), [snapshot, markets]);
  return { snapshot, markets, tick, previewEpochSeconds, portfolio };
}

export type PortfolioRead = ReturnType<typeof usePortfolio>;
