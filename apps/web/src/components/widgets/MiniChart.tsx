"use client";

import { useMarketCandles } from "@/components/market-data/MarketDataProvider";
import type { PackageMarket } from "@/lib/terminal/types";

const BARS = 96;

/**
 * Compact 24-hour line of 15-minute closes from the market-data feed: the market's onchain fills, or, while it has none,
 * its underlying's Chainlink reference (labelled as such). It reads the same bars as the terminal chart, so the two
 * never disagree. With no bars at all it says so instead of drawing a line.
 */
export function MiniChart({ market, height = 72 }: { market: PackageMarket; height?: number }) {
  const { candles, source, loading, reference } = useMarketCandles(market.id, "15m");
  const closes = candles.slice(-BARS).map((bar) => bar.close);

  if (closes.length < 2) {
    return (
      <div className="flex w-full items-center justify-center text-[11px] text-faint" style={{ height }}>
        {loading ? "Loading" : "No trades yet"}
      </div>
    );
  }

  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const span = high - low || Math.abs(high) * 0.001 || 1;
  const width = 300;
  const points = closes.map((close, index) => {
    const x = (index / Math.max(1, closes.length - 1)) * width;
    const y = 4 + (1 - (close - low) / span) * (height - 8);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const change = closes[closes.length - 1] - closes[0];
  const up = change >= 0;
  const stroke = up ? "var(--color-up)" : "var(--color-down)";
  const fill = up ? "var(--color-up-soft)" : "var(--color-down-soft)";
  const subject = source === "REFERENCE" && reference ? `Chainlink ${reference.pair} reference` : market.code;

  return (
    <div className="relative">
      <svg
        role="img"
        aria-label={`${subject}, last ${closes.length} fifteen-minute bars, ${up ? "up" : "down"} ${Math.abs(change).toFixed(market.priceDecimals)} ${market.priceUnit}`}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
      >
        <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={fill} />
        <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {source === "REFERENCE" && reference ? (
        <span className="pointer-events-none absolute top-0 right-0 rounded-sm bg-panel/85 px-1 text-[10px] text-faint">
          {`Reference · ${reference.pair}`}
        </span>
      ) : null}
    </div>
  );
}
