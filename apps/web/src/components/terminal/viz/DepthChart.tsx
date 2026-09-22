"use client";

import { formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import type { BookRow, PackageMarket } from "@/lib/terminal/types";
import { VIEW_H, VIEW_W, makeScale, stepPath } from "./chart-utils";

function cumulative(rows: BookRow[], side: "BID" | "ASK") {
  const sorted = rows
    .filter((row) => row.side === side && row.executable)
    .sort((a, b) => (side === "BID" ? b.price - a.price : a.price - b.price));
  let total = 0;
  return sorted.map((row) => {
    total += row.lots;
    return { row, total };
  });
}

/** Provenance is carried by shape, never by colour. */
function SourceNode({ source, cx, cy }: { source: BookRow["source"]; cx: number; cy: number }) {
  if (source === "DIRECT") {
    return <rect x={cx - 2.5} y={cy - 2.5} width={5} height={5} fill="var(--color-dim)" />;
  }
  if (source === "IMPLIED") {
    return (
      <rect
        x={cx - 2.5}
        y={cy - 2.5}
        width={5}
        height={5}
        fill="var(--color-panel)"
        stroke="var(--color-dim)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return (
    <path
      d={`M${cx} ${cy - 3.4} L${cx + 3.4} ${cy} L${cx} ${cy + 3.4} L${cx - 3.4} ${cy} Z`}
      fill="var(--color-dim)"
    />
  );
}

export function DepthChart({ market }: { market: PackageMarket }) {
  const bids = cumulative(market.book, "BID");
  const asks = cumulative(market.book, "ASK");
  const prices = [...bids, ...asks].map((entry) => entry.row.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const maxLots = Math.max(...bids.map((b) => b.total), ...asks.map((a) => a.total));

  const x = makeScale(minPrice, maxPrice, VIEW_W);
  const y = makeScale(0, maxLots * 1.12, VIEW_H, true);
  const midX = x((market.bestBid + market.bestAsk) / 2);

  const bidPoints = bids.map((entry) => ({ x: x(entry.row.price), y: y(entry.total) }));
  const askPoints = asks.map((entry) => ({ x: x(entry.row.price), y: y(entry.total) }));

  const close = (points: { x: number; y: number }[], edge: number) =>
    points.length === 0
      ? ""
      : `${stepPath(points)} L${edge.toFixed(2)} ${points[points.length - 1].y.toFixed(2)} L${edge.toFixed(2)} ${VIEW_H} L${points[0].x.toFixed(2)} ${VIEW_H} Z`;

  return (
    <div className="relative min-h-0 w-full flex-1 pt-5 pb-5">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label={`Executable package depth, ${formatLots(market.firmDepthLots)} lots across direct, implied, and solver liquidity`}
      >
        <path d={close(bidPoints, 0)} fill="var(--color-up)" opacity={0.1} />
        <path d={close(askPoints, VIEW_W)} fill="var(--color-down)" opacity={0.1} />
        <path
          d={stepPath(bidPoints)}
          fill="none"
          stroke="var(--color-up)"
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={stepPath(askPoints)}
          fill="none"
          stroke="var(--color-down)"
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={midX}
          x2={midX}
          y1={0}
          y2={VIEW_H}
          stroke="var(--color-line-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        {[...bids, ...asks].map((entry, index) => (
          <SourceNode
            key={`${entry.row.id}-${index}`}
            source={entry.row.source}
            cx={x(entry.row.price)}
            cy={y(entry.total)}
          />
        ))}
      </svg>

      <div className="pointer-events-none absolute top-0 left-0 flex items-baseline gap-3 text-xs">
        <span className="text-faint">Executable depth, cumulative lots</span>
        <span className="tnum font-mono text-off">{`peak ${formatLots(maxLots)}`}</span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 text-xs text-off">
        <span className="tnum font-mono">{formatNumber(minPrice, market.priceDecimals)}</span>
        <span className="hidden truncate sm:inline">
          square direct, outline implied, diamond solver
        </span>
        <span className="tnum font-mono">
          {`${formatNumber(maxPrice, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`}
        </span>
      </div>
    </div>
  );
}
