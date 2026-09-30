"use client";

import { useMemo } from "react";
import { buildPreviewHistory, buildPreviewSeries, candleAtPrice } from "@/components/terminal/viz/preview-price-data";
import type { PackageMarket } from "@/lib/terminal/types";

const BARS = 96;

/**
 * Compact 24-hour line of 15-minute closes. History comes from the same deterministic preview series as the terminal
 * chart, and the last bar follows the live mark exactly as the terminal's candle does, so the widget never disagrees
 * with the price column or the full chart.
 */
export function MiniChart({
  baseMarket,
  liveMarket,
  previewEpochSeconds,
  height = 72,
}: {
  baseMarket: PackageMarket;
  liveMarket: PackageMarket;
  previewEpochSeconds: number;
  height?: number;
}) {
  const history = useMemo(() => buildPreviewHistory(buildPreviewSeries(baseMarket), "15m").slice(-BARS), [baseMarket]);
  // The last bar is the history's final bar moved to the live mark at the shared market clock.
  const previous = history[history.length - 1];
  const next = previous ? candleAtPrice(previous, previewEpochSeconds, liveMarket.netPrice, "15m") : null;
  const bars = next ? (next.time === previous.time ? [...history.slice(0, -1), next] : [...history.slice(1), next]) : history;

  const closes = bars.map((bar) => bar.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const span = high - low || Math.abs(high) * 0.001 || 1;
  const width = 300;
  const points = closes.map((close, index) => {
    const x = (index / Math.max(1, closes.length - 1)) * width;
    const y = 4 + (1 - (close - low) / span) * (height - 8);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const up = liveMarket.netPrice >= (closes[0] ?? liveMarket.netPrice);
  const stroke = up ? "var(--color-up)" : "var(--color-down)";
  const fill = up ? "var(--color-up-soft)" : "var(--color-down-soft)";
  const change = closes.length > 1 ? closes[closes.length - 1] - closes[0] : 0;

  return (
    <svg
      role="img"
      aria-label={`${baseMarket.code} last 24 hours, ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(baseMarket.priceDecimals)} ${baseMarket.priceUnit}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
    >
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={fill} />
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
