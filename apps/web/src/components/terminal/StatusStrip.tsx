"use client";

import Link from "next/link";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { ChainIcon, UnderlyingIcon, chainLabelOf } from "@/components/icons/AssetIcon";
import { useChainNow, useMarketBoard, useMarketFeed } from "@/components/market-data/MarketDataProvider";
import { pendingActions, serviceHealth } from "@/components/shell/signals";
import type { HealthState } from "@/lib/operations/types";
import { changePercent, formatCompactAsset, formatNumber, formatUtcClock } from "@/lib/terminal/format";

const FEED_STATE: Record<ReturnType<typeof useMarketFeed>["status"], { label: string; dot: string }> = {
  LOADING: { label: "Connecting", dot: "bg-faint" },
  LIVE: { label: "Onchain feed", dot: "bg-up" },
  STALE: { label: "Feed stale", dot: "bg-brand" },
  ERROR: { label: "Chain unavailable", dot: "bg-down" },
};

const HEALTH_DOT: Record<HealthState, string> = {
  HEALTHY: "bg-up",
  DEGRADED: "bg-brand",
  UNAVAILABLE: "bg-down",
};

/**
 * Exchange-style status bar: connection and environment on the left, a live ticker of every listed market from the
 * market-data feed in the middle, and the feed state and chain clock on the right.
 */
export function StatusStrip() {
  const snapshot = useGatewaySnapshot();
  const { markets } = useMarketBoard();
  const feed = useMarketFeed();
  const now = useChainNow();
  const connected = snapshot.wallet.status === "CONNECTED";
  const pending = pendingActions(snapshot).filter((action) => action.id !== "connect");
  const services = serviceHealth({
    status: feed.status,
    chainStatus: feed.chain?.status ?? null,
    chainReason: feed.chain?.reason,
    blockNumber: feed.blockNumber,
    referenceCount: feed.referenceCount,
    referenceExpected: new Set(markets.map((market) => market.underlying)).size,
  });
  const feedState = FEED_STATE[feed.status];
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
  // The ticker loops by repeating its tape; the repeat is hidden from assistive technology and the tab order.
  const tape = (repeat: boolean) => markets.map((market) => {
    const change = changePercent(market.netPrice, market.priorNetPrice);
    return (
      <Link
        key={market.id}
        href={`/trade/${market.id}`}
        tabIndex={repeat ? -1 : undefined}
        className="flex shrink-0 items-baseline gap-1.5 px-3 text-[11px] text-faint transition-colors hover:text-ink"
      >
        <UnderlyingIcon underlying={market.underlying} size={12} className="self-center" />
        <span className="text-dim">{market.id}</span>
        <span className="tnum font-mono text-ink">{formatNumber(market.netPrice, market.priceDecimals)}</span>
        {market.markSource === "REFERENCE" ? (
          <span className="text-off" title="No book or trades yet: marked at the Chainlink reference">
            ref
          </span>
        ) : Number.isFinite(change) ? (
          <span className={`tnum font-mono ${change >= 0 ? "text-up" : "text-down"}`}>
            {`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
          </span>
        ) : null}
      </Link>
    );
  });

  return (
    <footer className="relative z-30 hidden h-7 shrink-0 items-center border-t border-line bg-app text-[11px] lg:flex" aria-label="Status">
      <div
        className="flex h-full shrink-0 items-center gap-2 border-r border-line px-3 text-faint"
        title={`${snapshot.environment.label}: collateral and public orders settle onchain. Marks come from the onchain book and fills, else the Chainlink reference.`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${feedState.dot} ${feed.status === "LIVE" ? "live-dot text-up shadow-[0_0_6px_var(--color-up)]" : ""}`}
        />
        <ChainIcon size={13} />
        <span className="text-dim">{chainLabelOf(snapshot.environment.chainId)}</span>
        <span className="hidden text-off xl:inline">·</span>
        <span className="hidden 2xl:inline">{connected ? "wallet connected" : "wallet not connected"}</span>
      </div>
      <div className="flex h-full shrink-0 items-center gap-3 border-r border-line px-3 text-faint">
        <span title="Collateral available for new risk in the connected account">
          Avail{" "}
          <span className="tnum font-mono text-dim">
            {connected ? formatCompactAsset(snapshot.account.available, snapshot.account.collateralAsset) : "–"}
          </span>
        </span>
        <span title="Reserved collateral as a share of posted collateral">
          Health <span className={accountHealth?.tone ?? "text-off"}>{accountHealth?.label ?? "–"}</span>
        </span>
        {services.map((service) => (
          <span key={service.id} className="flex items-center gap-1.5" title={service.detail}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[service.state]}`} />
            {service.id === "sequencer" ? <ChainIcon size={11} mono className="text-faint" /> : null}
            {service.label}
          </span>
        ))}
        {pending.length > 0 ? (
          <Link href="/app" className="focus-ring rounded-sm text-brand transition-colors hover:text-ink">
            {`${pending.length} pending`}
          </Link>
        ) : null}
      </div>
      <div className="ticker-mask relative min-w-0 flex-1 overflow-hidden" aria-label="Market ticker">
        <div className="ticker-track flex w-max">
          {tape(false)}
          <div aria-hidden="true" className="flex">
            {tape(true)}
          </div>
        </div>
      </div>
      <div
        className="flex h-full shrink-0 items-center gap-2 border-l border-line px-3 text-faint"
        title={feed.blockNumber > 0 ? `Block ${feed.blockNumber.toLocaleString("en-US")}` : undefined}
      >
        <span className="text-dim">{feedState.label}</span>
        <span className="tnum font-mono" suppressHydrationWarning>
          {`${formatUtcClock(now)}:${String(now % 60).padStart(2, "0")} UTC`}
        </span>
      </div>
    </footer>
  );
}
