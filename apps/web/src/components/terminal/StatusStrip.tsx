"use client";

import Link from "next/link";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { pendingActions, serviceHealth } from "@/components/shell/signals";
import type { HealthState } from "@/lib/operations/types";
import { formatCompactUsd, formatNumber, formatUtcClock } from "@/lib/terminal/format";

const HEALTH_DOT: Record<HealthState, string> = {
  HEALTHY: "bg-up",
  DEGRADED: "bg-brand",
  UNAVAILABLE: "bg-down",
};

/**
 * Exchange-style status bar: connection and environment on the left, a live ticker of every package market from the
 * shared preview feed in the middle, and the feed clock on the right.
 */
export function StatusStrip() {
  const snapshot = useGatewaySnapshot();
  const { markets, previewEpochSeconds } = usePreviewBoard();
  const connected = snapshot.wallet.status === "CONNECTED";
  const pending = pendingActions(snapshot).filter((action) => action.id !== "connect");
  const services = serviceHealth();
  const reservedShare = snapshot.account.posted > 0 ? snapshot.account.reserved / snapshot.account.posted : 0;
  const accountHealth = !connected
    ? null
    : snapshot.account.posted <= 0
      ? { label: "Unfunded", tone: "text-faint" }
      : reservedShare >= 0.9
        ? { label: "At limit", tone: "text-down" }
        : reservedShare >= 0.7
          ? { label: "Watch", tone: "text-brand" }
          : { label: "Healthy", tone: "text-up" };
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
        <span aria-hidden="true" className="live-dot h-1.5 w-1.5 rounded-full bg-up text-up shadow-[0_0_6px_var(--color-up)]" />
        <span className="text-dim">{snapshot.environment.label}</span>
        <span className="tnum hidden font-mono xl:inline">{`chain ${snapshot.environment.chainId}`}</span>
        <span className="hidden text-off xl:inline">·</span>
        <span className="hidden 2xl:inline">{connected ? "wallet connected" : "wallet not connected"}</span>
        <span className="hidden text-off 2xl:inline">·</span>
        <span className="hidden xl:inline">mainnet writes disabled</span>
      </div>
      <div className="flex h-full shrink-0 items-center gap-3 border-r border-line px-3 text-faint">
        <span title="Collateral available for new risk in the connected account">
          Avail{" "}
          <span className="tnum font-mono text-dim">
            {connected ? `${formatCompactUsd(snapshot.account.available)} ${snapshot.account.collateralAsset}` : "–"}
          </span>
        </span>
        <span title="Reserved collateral as a share of posted collateral">
          Health <span className={accountHealth?.tone ?? "text-off"}>{accountHealth?.label ?? "–"}</span>
        </span>
        {services.map((service) => (
          <span key={service.id} className="flex items-center gap-1.5" title={`${service.detail} Recorded operations snapshot.`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[service.state]}`} />
            {service.label}
          </span>
        ))}
        <span
          className="flex items-center gap-1.5"
          title="Private RFQ and firm quote service on the local devnet runtime"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-up" />
          Private exec
        </span>
        {pending.length > 0 ? (
          <Link href="/app" className="focus-ring rounded-sm text-brand transition-colors hover:text-ink">
            {`${pending.length} pending`}
          </Link>
        ) : null}
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
