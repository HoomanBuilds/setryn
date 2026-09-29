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

/** Movers and depth from the shared live board, so every figure matches the terminal, charts, and ticker. */
export function Opportunities({ markets }: { markets: readonly PackageMarket[] }) {
  const move = (market: PackageMarket) => changePercent(market.netPrice, market.priorNetPrice);
  const movers = [...markets].sort((a, b) => Math.abs(move(b)) - Math.abs(move(a))).slice(0, 5);
  const deepest = [...markets].sort((a, b) => b.firmDepthLots - a.firmDepthLots).slice(0, 5);

  return (
    <div className="grid min-w-0 gap-1 md:grid-cols-2">
      <Panel label="Top movers" delay={90}>
        <PanelHead
          title="Top movers"
          tools={
            <span className="flex items-center gap-2">
              <ProvenanceChip kind="OBSERVED" title="Package marks from the coherent preview feed, against the prior close." />
              <PanelLink href="/markets">Markets</PanelLink>
            </span>
          }
        />
        <ul className="py-1">
          {movers.map((market) => (
            <MarketRow key={market.id} market={market} figure={priceFigure(market)} />
          ))}
        </ul>
      </Panel>
      <Panel label="Deepest firm books" delay={120}>
        <PanelHead
          title="Deepest books"
          tools={
            <span className="flex items-center gap-2">
              <ProvenanceChip kind="EXECUTABLE" title="Firm executable lots resting on each package book." />
              <span className="text-[11px] text-faint">firm lots</span>
            </span>
          }
        />
        <ul className="py-1">
          {deepest.map((market) => (
            <MarketRow
              key={market.id}
              market={market}
              figure={
                <span className="flex flex-col items-end" title={`Spread ${formatNumber(spreadOf(market), market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`}>
                  <span className="tnum font-mono text-xs text-ink">{formatLots(market.firmDepthLots)}</span>
                  <span className="tnum font-mono text-[10px] text-off">{`${formatNumber(spreadOf(market), market.priceDecimals)} wide`}</span>
                </span>
              }
            />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
