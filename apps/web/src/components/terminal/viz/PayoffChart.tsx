"use client";

import { useId } from "react";
import { formatNumber } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";
import { VIEW_H, VIEW_W, linePath, makeScale } from "./chart-utils";

export function PayoffChart({ market, lots }: { market: PackageMarket; lots: number }) {
  const clipId = useId();
  if (market.payoff.length === 0) {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center justify-center text-xs text-faint">
        The payoff needs a mark and a reference reading.
      </div>
    );
  }
  return <PayoffCurve market={market} lots={lots} clipId={clipId} />;
}

function PayoffCurve({ market, lots, clipId }: { market: PackageMarket; lots: number; clipId: string }) {
  const scale = Math.max(1, lots);
  const values = market.payoff.map((point) => point.value * scale);
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 0);
  const span = hi - lo || 1;
  const moves = market.payoff.map((point) => point.move);

  const x = makeScale(Math.min(...moves), Math.max(...moves), VIEW_W);
  const y = makeScale(lo - span * 0.12, hi + span * 0.12, VIEW_H, true);
  const points = market.payoff.map((point) => ({ x: x(point.move), y: y(point.value * scale) }));
  const zeroY = y(0);
  const breakEvenX = x(
    Math.max(Math.min(market.breakEvenMove, Math.max(...moves)), Math.min(...moves)),
  );

  return (
    <div className="relative min-h-0 w-full flex-1 pt-5 pb-5">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label={`Payoff at expiry of ${lots} long lots bought at the mark, bounded between ${formatNumber(lo, 0)} and ${formatNumber(hi, 0)} USDC`}
      >
        <defs>
          <clipPath id={`${clipId}-up`}>
            <rect x="0" y="0" width={VIEW_W} height={Math.max(0, zeroY)} />
          </clipPath>
          <clipPath id={`${clipId}-down`}>
            <rect x="0" y={zeroY} width={VIEW_W} height={Math.max(0, VIEW_H - zeroY)} />
          </clipPath>
        </defs>

        <path
          d={`${linePath(points)} L${VIEW_W} ${zeroY} L0 ${zeroY} Z`}
          fill="var(--color-up)"
          opacity={0.13}
          clipPath={`url(#${clipId}-up)`}
        />
        <path
          d={`${linePath(points)} L${VIEW_W} ${zeroY} L0 ${zeroY} Z`}
          fill="var(--color-down)"
          opacity={0.13}
          clipPath={`url(#${clipId}-down)`}
        />
        <line
          x1={0}
          x2={VIEW_W}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--color-line-strong)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x(0)}
          x2={x(0)}
          y1={0}
          y2={VIEW_H}
          stroke="var(--color-line)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={breakEvenX}
          x2={breakEvenX}
          y1={0}
          y2={VIEW_H}
          stroke="var(--color-dim)"
          strokeWidth={1}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={linePath(points)}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={1.7}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="pointer-events-none absolute top-0 left-0 flex items-baseline gap-3 text-xs">
        <span className="text-faint">{`Payoff at expiry, ${lots} long ${lots === 1 ? "lot" : "lots"} at the mark, USDC`}</span>
        <span className="tnum font-mono text-up">{`max +${formatNumber(hi, 0)}`}</span>
        <span className="tnum font-mono text-down">{formatNumber(lo, 0)}</span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 text-xs text-off">
        <span className="tnum font-mono">{`${formatNumber(Math.min(...moves), 0)}%`}</span>
        <span className="tnum hidden truncate font-mono text-dim sm:inline">
          {`break even ${formatNumber(market.breakEvenMove, 1)}%`}
        </span>
        <span className="tnum truncate font-mono">
          {`${market.payoffMoveUnit}, +${formatNumber(Math.max(...moves), 0)}%`}
        </span>
      </div>
    </div>
  );
}
