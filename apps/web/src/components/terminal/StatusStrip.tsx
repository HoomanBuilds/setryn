"use client";

import Link from "next/link";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { formatNumber, formatUtcClock } from "@/lib/terminal/format";

/**
 * Exchange-style status bar: connection and environment on the left, a live ticker of every package market from the
 * shared preview feed in the middle, and the feed clock on the right.
 */
export function StatusStrip() {
  const snapshot = useGatewaySnapshot();
  const { markets, previewEpochSeconds } = usePreviewBoard();
  const connected = snapshot.wallet.status === "CONNECTED";
  const tape = markets.map((market) => {
    const change = market.priorNetPrice !== 0 ? ((market.netPrice - market.priorNetPrice) / Math.abs(market.priorNetPrice)) * 100 : 0;
    return (
      <Link
        key={market.id}
        href={`/trade/${market.id}`}
        className="flex shrink-0 items-baseline gap-1.5 px-3 text-[11px] text-faint transition-colors hover:text-ink"
      >
        <span className="text-dim">{market.id}</span>
        <span className="tnum font-mono text-ink">{formatNumber(market.netPrice, market.priceDecimals)}</span>
        <span className={`tnum font-mono ${change >= 0 ? "text-up" : "text-down"}`}>
          {`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
        </span>
      </Link>
    );
  });

  return (
    <footer className="relative z-30 hidden h-7 shrink-0 items-center border-t border-line bg-app text-[11px] lg:flex" aria-label="Status">
      <div
        className="flex h-full shrink-0 items-center gap-2 border-r border-line px-3 text-faint"
        title={`${snapshot.environment.label}: collateral and public orders settle onchain. Market observations use the development feed. Mainnet writes are disabled.`}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-up shadow-[0_0_6px_var(--color-up)]" />
        <span className="text-dim">{snapshot.environment.label}</span>
        <span className="tnum font-mono">{`chain ${snapshot.environment.chainId}`}</span>
        <span className="text-off">·</span>
        <span>{connected ? "wallet connected" : "wallet not connected"}</span>
        <span className="text-off">·</span>
        <span>mainnet writes disabled</span>
      </div>
      <div className="ticker-mask relative min-w-0 flex-1 overflow-hidden" aria-label="Market ticker">
        <div className="ticker-track flex w-max">
          {tape}
          <div aria-hidden="true" className="flex">
            {tape}
          </div>
        </div>
      </div>
      <div className="flex h-full shrink-0 items-center gap-2 border-l border-line px-3 text-faint">
        <span className="text-dim">Preview feed</span>
        <span className="tnum font-mono">
          {`${formatUtcClock(previewEpochSeconds)}:${String(previewEpochSeconds % 60).padStart(2, "0")} UTC`}
        </span>
      </div>
    </footer>
  );
}
