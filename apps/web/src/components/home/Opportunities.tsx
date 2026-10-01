"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ProvenanceChip, PanelLink } from "@/components/home/kit";
import { ChangeText, TenorChip } from "@/components/markets/MarketsTable";
import { AssetGlyph, Sparkline, liveSeries, sparkTone } from "@/components/markets/ui";
import { Flash, Panel, PanelHead } from "@/components/strategies/desk/Desk";
import { spreadOf } from "@/lib/terminal/discovery";
import { changePercent, formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";

function MarketRow({ market, figure }: { market: PackageMarket; figure: ReactNode }) {
  return (
    <li>
      <Link
        href={tradeHref(market)}
        className="focus-ring grid h-11 grid-cols-[minmax(0,1fr)_auto_64px] items-center gap-3 px-3 transition-colors duration-150 hover:bg-raised/60 sm:grid-cols-[minmax(0,1fr)_56px_auto_64px] lg:h-10"
      >
        <span className="flex min-w-0 items-center gap-2">
          <AssetGlyph underlying={market.underlying} size={20} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs text-ink">{market.name}</span>
              <TenorChip market={market} />
            </span>
            <span className="tnum block truncate font-mono text-[10.5px] text-faint">{market.code}</span>
          </span>
        </span>
        <Sparkline values={liveSeries(market).slice(-48)} tone={sparkTone(market)} width={56} height={18} area={false} className="hidden sm:block" />
        <span className="text-right">{figure}</span>
        <ChangeText market={market} className="text-right text-xs" />
      </Link>
    </li>
  );
}

function priceFigure(market: PackageMarket) {
  return (
    <span className="flex items-baseline justify-end gap-1">
      <Flash value={market.netPrice} className="tnum px-0.5 font-mono text-xs text-ink">
        {formatNumber(market.netPrice, market.priceDecimals)}
      </Flash>
      <span className="text-[10px] text-off">{priceUnitSuffix(market.priceUnit)}</span>
    </span>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <li className="flex h-[120px] items-center justify-center px-4 text-center text-xs text-faint">{children}</li>;
}

/** Movers and depth from the market-data feed, so every figure matches the terminal, charts, and ticker. */
export function Opportunities({ markets }: { markets: readonly PackageMarket[] }) {
  // Only traded marks move; a market marked at its reference has no 24-hour change to rank.
  const move = (market: PackageMarket) =>
    market.markSource === "MID" || market.markSource === "LAST" ? changePercent(market.netPrice, market.priorNetPrice) : Number.NaN;
  const movers = markets
    .filter((market) => Number.isFinite(move(market)) && move(market) !== 0)
    .sort((a, b) => Math.abs(move(b)) - Math.abs(move(a)))
    .slice(0, 5);
  const deepest = markets
    .filter((market) => market.firmDepthLots > 0)
    .sort((a, b) => b.firmDepthLots - a.firmDepthLots)
    .slice(0, 5);

  return (
    <div className="grid min-w-0 gap-1 md:grid-cols-2">
      <Panel label="Top movers" delay={90}>
        <PanelHead
          title="Top movers"
          tools={
            <span className="flex items-center gap-2">
              <ProvenanceChip kind="OBSERVED" title="Marks from the onchain book and fills, against the first fill of the last 24 hours." />
              <PanelLink href="/markets">Markets</PanelLink>
            </span>
          }
        />
        <ul className="py-1">
          {movers.length === 0 ? (
            <EmptyRow>No market has traded in the last 24 hours.</EmptyRow>
          ) : (
            movers.map((market) => <MarketRow key={market.id} market={market} figure={priceFigure(market)} />)
          )}
        </ul>
      </Panel>
      <Panel label="Deepest firm books" delay={120}>
        <PanelHead
          title="Deepest books"
          tools={
            <span className="flex items-center gap-2">
              <ProvenanceChip kind="EXECUTABLE" title="Lots resting on each market's onchain book." />
              <span className="text-[11px] text-faint">resting lots</span>
            </span>
          }
        />
        <ul className="py-1">
          {deepest.length === 0 ? <EmptyRow>No resting orders on any book yet.</EmptyRow> : null}
          {deepest.map((market) => (
            <MarketRow
              key={market.id}
              market={market}
              figure={
                <span className="flex flex-col items-end" title={`Spread ${formatNumber(spreadOf(market), market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`}>
                  <span className="tnum font-mono text-xs text-ink">{formatLots(market.firmDepthLots)}</span>
                  <span className="tnum font-mono text-[10px] text-off">
                    {Number.isFinite(spreadOf(market)) ? `${formatNumber(spreadOf(market), market.priceDecimals)} wide` : "one-sided"}
                  </span>
                </span>
              }
            />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
