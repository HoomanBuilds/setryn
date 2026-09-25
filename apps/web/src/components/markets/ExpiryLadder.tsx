"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { QualificationTag, SourceMarks } from "@/components/markets/controls";
import { Delta } from "@/components/terminal/primitives";
import {
  changePercent,
  daysToExpiry,
  formatExpiry,
  formatLots,
  formatNumber,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { groupByUnderlying, settlementShort, spreadOf } from "@/lib/terminal/discovery";
import { tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";

/* Expiry and qualification are the two free-text tracks, so the width a desk
   has spare goes to them and neither has to truncate. Open interest only earns
   a track at xl, so the lg grid still fits at 1024. */
const RUNG =
  "grid items-center gap-x-4 px-4 lg:grid-cols-[68px_minmax(190px,1.6fr)_60px_64px_64px_64px_52px_76px_minmax(96px,0.35fr)_52px_18px] xl:grid-cols-[68px_minmax(190px,1.6fr)_60px_64px_64px_64px_52px_76px_88px_minmax(96px,0.35fr)_52px_18px]";

function HeadCell({
  children,
  align = "right",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <span
      className={`truncate text-xs text-faint ${align === "right" ? "text-right" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

/** Only claimed when the whole group quotes in one unit, which is per family. */
function groupUnit(markets: PackageMarket[]): string | null {
  const units = new Set(markets.map((market) => market.priceUnit));
  return units.size === 1 ? priceUnitSuffix(markets[0].priceUnit) : null;
}

/**
 * Grouped by underlying, then ordered by maturity, so each block reads as one
 * ladder of tenors with its executable quote and qualification on every rung.
 */
export function ExpiryLadder({ markets }: { markets: PackageMarket[] }) {
  const groups = groupByUnderlying(markets);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className={`${RUNG} sticky top-0 z-20 hidden h-8 border-b border-line bg-panel lg:grid`}>
        <HeadCell align="left">Tenor</HeadCell>
        <HeadCell align="left">Expiry</HeadCell>
        <HeadCell>Net</HeadCell>
        <HeadCell>Change</HeadCell>
        <HeadCell>Bid</HeadCell>
        <HeadCell>Offer</HeadCell>
        <HeadCell>Spread</HeadCell>
        <HeadCell>Firm depth</HeadCell>
        <HeadCell className="hidden xl:block">Open interest</HeadCell>
        <HeadCell align="left">Qualification</HeadCell>
        <HeadCell align="left">Sources</HeadCell>
        <span />
      </div>

      {groups.map((group) => {
        const unit = groupUnit(group.markets);
        return (
          <section key={group.underlying}>
            <h2 className="sticky top-0 z-10 flex h-9 items-center gap-2.5 border-b border-line bg-inset px-3 lg:top-8 lg:px-4">
              <span className="shrink-0 text-[13px] font-semibold text-ink">
                {group.underlying}
              </span>
              <span className="truncate text-xs text-faint">
                {`${group.markets.length} ${group.markets.length === 1 ? "tenor" : "tenors"}${
                  unit ? ` / quoted in ${unit}` : ""
                }`}
              </span>
            </h2>

            {group.markets.map((market, index) => (
              <Link
                key={market.id}
                href={tradeHref(market)}
                aria-label={`Open the ${market.name} terminal, ${market.tenorLabel}`}
                className={`focus-ring group block border-b border-line-soft transition-colors hover:bg-raised ${
                  index % 2 === 1 ? "bg-panel/45" : "bg-app"
                }`}
              >
                <CompactRung market={market} />
                <DenseRung market={market} />
              </Link>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Narrow widths keep the same rung data on two lines instead of a shrunken grid. */
function CompactRung({ market }: { market: PackageMarket }) {
  const unit = priceUnitSuffix(market.priceUnit);
  return (
    <span className="flex min-h-11 flex-col justify-center gap-1 py-2 pr-2 pl-3 lg:hidden">
      <span className="flex items-baseline justify-between gap-3">
        <span className="tnum shrink-0 font-mono text-[13px] text-ink">{market.tenorLabel}</span>
        <span className="tnum truncate font-mono text-xs">
          <span className="text-up">{formatNumber(market.bestBid, market.priceDecimals)}</span>
          <span className="mx-1 text-off">/</span>
          <span className="text-down">{formatNumber(market.bestAsk, market.priceDecimals)}</span>
          <span className="ml-1 text-off">{unit}</span>
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-3">
        <span className="tnum truncate font-mono text-xs text-faint">
          {`${formatExpiry(market.expiryIso)} / ${daysToExpiry(market.expiryIso)}d`}
        </span>
        <span className="tnum shrink-0 font-mono text-xs text-dim">
          {`${formatLots(market.firmDepthLots)} lots firm`}
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-3">
        <QualificationTag market={market} />
        <Delta
          value={changePercent(market.netPrice, market.priorNetPrice)}
          className="shrink-0 text-xs"
        />
      </span>
    </span>
  );
}

function DenseRung({ market }: { market: PackageMarket }) {
  return (
    <span className={`${RUNG} hidden h-9 lg:grid`}>
      <span className="tnum truncate font-mono text-xs text-ink">{market.tenorLabel}</span>

      <span className="flex min-w-0 items-baseline gap-2">
        <span className="tnum truncate font-mono text-xs text-dim">
          {formatExpiry(market.expiryIso)}
        </span>
        <span className="truncate text-xs text-off">
          {`${daysToExpiry(market.expiryIso)}d / ${settlementShort(market.settlementClass)}`}
        </span>
      </span>

      <span className="tnum truncate text-right font-mono text-xs text-ink">
        {formatNumber(market.netPrice, market.priceDecimals)}
      </span>
      <Delta
        value={changePercent(market.netPrice, market.priorNetPrice)}
        className="truncate text-right text-xs"
      />
      <span className="tnum truncate text-right font-mono text-xs text-up">
        {formatNumber(market.bestBid, market.priceDecimals)}
      </span>
      <span className="tnum truncate text-right font-mono text-xs text-down">
        {formatNumber(market.bestAsk, market.priceDecimals)}
      </span>
      <span className="tnum truncate text-right font-mono text-xs text-dim">
        {formatNumber(spreadOf(market), market.priceDecimals)}
      </span>
      <span className="tnum truncate text-right font-mono text-xs text-dim">
        {`${formatLots(market.firmDepthLots)} lots`}
      </span>
      <span className="tnum hidden truncate text-right font-mono text-xs text-dim xl:block">
        {`${formatLots(market.openInterestLots)} lots`}
      </span>

      <QualificationTag market={market} />

      <SourceMarks market={market} />

      <ChevronRight
        size={14}
        aria-hidden="true"
        className="shrink-0 justify-self-end text-off transition-colors group-hover:text-dim"
      />
    </span>
  );
}
