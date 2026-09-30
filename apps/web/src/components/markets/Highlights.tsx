"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChangeText, TenorChip } from "@/components/markets/MarketsTable";
import { AssetGlyph, Flash, Sparkline, liveSeries, motion, sparkTone } from "@/components/markets/ui";
import { changePercent, formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { spreadOf } from "@/lib/terminal/discovery";
import { tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";

type Figure = (market: PackageMarket) => ReactNode;

interface Card {
  id: string;
  title: string;
  note: string;
  pick: (markets: PackageMarket[]) => PackageMarket[];
  figure: Figure;
}

const move = (market: PackageMarket) => changePercent(market.netPrice, market.priorNetPrice);

const price: Figure = (market) => (
  <span className="flex items-baseline justify-end gap-1">
    <Flash value={market.netPrice} className="tnum px-0.5 font-mono text-xs text-ink">
      {formatNumber(market.netPrice, market.priceDecimals)}
    </Flash>
    <span className="text-[10px] text-off">{priceUnitSuffix(market.priceUnit)}</span>
  </span>
);

const CARDS: Card[] = [
  {
    id: "gainers",
    title: "Top gainers",
    note: "vs prior close",
    pick: (markets) => markets.filter((m) => move(m) > 0).sort((a, b) => move(b) - move(a)).slice(0, 3),
    figure: price,
  },
  {
    id: "losers",
    title: "Top losers",
    note: "vs prior close",
    pick: (markets) => markets.filter((m) => move(m) < 0).sort((a, b) => move(a) - move(b)).slice(0, 3),
    figure: price,
  },
  {
    id: "interest",
    title: "Most open interest",
    note: "lots",
    pick: (markets) => [...markets].sort((a, b) => b.openInterestLots - a.openInterestLots).slice(0, 3),
    figure: (market) => (
      <span className="tnum font-mono text-xs text-ink">{formatLots(market.openInterestLots)}</span>
    ),
  },
  {
    id: "depth",
    title: "Deepest firm book",
    note: "executable lots",
    pick: (markets) => [...markets].sort((a, b) => b.firmDepthLots - a.firmDepthLots).slice(0, 3),
    figure: (market) => (
      <span
        className="tnum font-mono text-xs text-ink"
        title={`Spread ${formatNumber(spreadOf(market), market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`}
      >
        {formatLots(market.firmDepthLots)}
      </span>
    ),
  },
];

/**
 * Board-wide movers, independent of the directory filters, so the cards read
 * the same wherever the table below has been narrowed to.
 */
export function Highlights({ markets }: { markets: PackageMarket[] }) {
  return (
    <div className="no-scrollbar -mx-3 flex snap-x snap-mandatory gap-1 overflow-x-auto px-3 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-4">
      {CARDS.map((card, index) => {
        const rows = card.pick(markets);
        return (
          <section
            key={card.id}
            aria-label={card.title}
            style={{ animationDelay: `${40 + index * 40}ms` }}
            className={`${motion.enter} flex w-[82%] shrink-0 snap-start flex-col rounded-lg border border-line bg-panel md:w-auto`}
          >
            <header className="flex h-9 items-center justify-between gap-2 border-b border-line-soft px-3">
              <h2 className="text-xs font-medium text-dim">{card.title}</h2>
              <span className="text-[11px] text-off">{card.note}</span>
            </header>
            <ul className="flex flex-col py-1">
              {rows.length === 0 ? (
                <li className="flex h-[84px] items-center justify-center text-xs text-faint">
                  No market qualifies right now
                </li>
              ) : (
                rows.map((market) => (
                  <li key={market.id}>
                    <Link
                      href={tradeHref(market)}
                      className="focus-ring grid h-7 grid-cols-[minmax(0,1fr)_auto_58px] items-center gap-2.5 px-3 transition-colors duration-150 hover:bg-raised/70 md:grid-cols-[minmax(0,1fr)_48px_auto_58px] xl:grid-cols-[minmax(0,1fr)_auto_58px] 2xl:grid-cols-[minmax(0,1fr)_48px_auto_58px]"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <AssetGlyph underlying={market.underlying} size={15} />
                        <span className="truncate text-xs text-ink">{market.name}</span>
                        <TenorChip market={market} />
                      </span>
                      <Sparkline
                        values={liveSeries(market).slice(-48)}
                        tone={sparkTone(market)}
                        width={48}
                        height={16}
                        area={false}
                        className="hidden md:block xl:hidden 2xl:block"
                      />
                      <span className="text-right">{card.figure(market)}</span>
                      <ChangeText market={market} className="text-right text-xs" />
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
