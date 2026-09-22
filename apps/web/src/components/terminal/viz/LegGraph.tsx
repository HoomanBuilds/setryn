"use client";

import { formatNumber, formatPriceWithUnit, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";

const ROW_H = 58;
const GAP = 10;
const PKG_W = 196;
const LEG_X = 276;
const LEG_W = 392;

export function LegGraph({ market }: { market: PackageMarket }) {
  const legs = market.legs;
  const legsHeight = legs.length * ROW_H + (legs.length - 1) * GAP;
  const graphHeight = Math.max(legsHeight, 150);
  const settlementY = graphHeight + 26;
  const height = settlementY + 48;
  const pkgH = 84;
  const pkgY = graphHeight / 2 - pkgH / 2;
  const pkgCenterY = pkgY + pkgH / 2;

  return (
    <div className="relative min-h-0 w-full flex-1 pt-5">
      <svg
        viewBox={`0 0 684 ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label={`Leg graph for ${market.name}: ${legs.length} legs settling as one package in ${market.settlementAsset}`}
      >
        {legs.map((leg, index) => {
          const legY = index * (ROW_H + GAP) + (graphHeight - legsHeight) / 2;
          const legCenterY = legY + ROW_H / 2;
          return (
            <path
              key={`edge-${leg.id}`}
              d={`M${8 + PKG_W} ${pkgCenterY} C${LEG_X - 40} ${pkgCenterY} ${LEG_X - 40} ${legCenterY} ${LEG_X} ${legCenterY}`}
              fill="none"
              stroke="var(--color-line-strong)"
              strokeWidth={1.2}
              strokeDasharray={leg.venueClass === "NATIVE_BOOK" ? undefined : "3 3"}
            />
          );
        })}

        <path
          d={`M${8 + PKG_W / 2} ${pkgY + pkgH} L${8 + PKG_W / 2} ${settlementY}`}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth={1.2}
        />

        <rect
          x={8}
          y={pkgY}
          width={PKG_W}
          height={pkgH}
          fill="var(--color-raised)"
          stroke="var(--color-line-strong)"
          strokeWidth={1}
          rx={6}
        />
        <text x={20} y={pkgY + 21} fill="var(--color-faint)" fontSize={12}>
          Package
        </text>
        <text x={20} y={pkgY + 41} fill="var(--color-ink)" fontSize={14} fontWeight={500}>
          {market.code}
        </text>
        <text
          x={20}
          y={pkgY + 62}
          fill="var(--color-ink)"
          fontSize={16}
          fontFamily="var(--font-mono)"
        >
          {formatPriceWithUnit(market.netPrice, market)}
        </text>
        <text x={20} y={pkgY + 77} fill="var(--color-faint)" fontSize={12}>
          {`one net price, ${legs.length} legs`}
        </text>

        {legs.map((leg, index) => {
          const legY = index * (ROW_H + GAP) + (graphHeight - legsHeight) / 2;
          const sideColor = leg.side === "BUY" ? "var(--color-up)" : "var(--color-down)";
          return (
            <g key={leg.id}>
              <rect
                x={LEG_X}
                y={legY}
                width={LEG_W}
                height={ROW_H}
                fill="var(--color-raised)"
                stroke="var(--color-line)"
                strokeWidth={1}
                rx={6}
              />
              <rect x={LEG_X} y={legY + 8} width={2} height={ROW_H - 16} fill={sideColor} />
              <text x={LEG_X + 14} y={legY + 21} fill={sideColor} fontSize={12}>
                {`${leg.side === "BUY" ? "Buy" : "Sell"} ${formatNumber(leg.ratio, 2)}x`}
              </text>
              <text x={LEG_X + 14} y={legY + 38} fill="var(--color-ink)" fontSize={13}>
                {leg.instrument}
              </text>
              <text x={LEG_X + 14} y={legY + 52} fill="var(--color-faint)" fontSize={12}>
                {leg.venueClass === "NATIVE_BOOK" ? "Native leg book" : "Implied component"}
              </text>
              <text
                x={LEG_X + LEG_W - 14}
                y={legY + 38}
                fill="var(--color-dim)"
                fontSize={13}
                fontFamily="var(--font-mono)"
                textAnchor="end"
              >
                {`${formatNumber(leg.mark, leg.markUnit === "USD" ? (leg.mark < 10 ? 4 : 2) : 1)} ${priceUnitSuffix(leg.markUnit)}`}
              </text>
              <text
                x={LEG_X + LEG_W - 14}
                y={legY + 52}
                fill="var(--color-off)"
                fontSize={12}
                textAnchor="end"
              >
                {leg.qualification === "QUALIFIED" ? "qualified" : "conditional"}
              </text>
            </g>
          );
        })}

        <rect
          x={8}
          y={settlementY}
          width={660}
          height={40}
          fill="var(--color-inset)"
          stroke="var(--color-line)"
          strokeWidth={1}
          rx={6}
        />
        <text x={20} y={settlementY + 17} fill="var(--color-faint)" fontSize={12}>
          Settlement
        </text>
        <text x={20} y={settlementY + 33} fill="var(--color-ink)" fontSize={13}>
          {`${market.settlementClass === "CASH_USDC_NDF" ? "Non-deliverable cash" : "Cash"} in ${market.settlementAsset}, ${market.fixingSource}`}
        </text>
      </svg>

      <div className="pointer-events-none absolute top-0 left-0 text-xs text-faint">
        Package structure and settlement path
      </div>
    </div>
  );
}
