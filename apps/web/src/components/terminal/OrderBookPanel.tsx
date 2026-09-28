"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import {
  FIRMNESS_LABEL,
  SOURCE_LABEL,
  SectionLabel,
  SourceMark,
} from "@/components/terminal/primitives";
import { formatLots, formatNumber, formatPrice, priceUnitSuffix } from "@/lib/terminal/format";
import type { BookRow, LiquiditySource, PackageMarket } from "@/lib/terminal/types";

type Filter = "ALL" | LiquiditySource;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DIRECT", label: "Direct" },
  { value: "IMPLIED", label: "Implied" },
  { value: "SOLVER_FIRM", label: "Solver" },
];

const GRID = "grid grid-cols-[minmax(0,1fr)_46px_70px_62px] items-center gap-2 px-3 lg:px-4";
const ROW_HEIGHT = "h-11 lg:h-7";

function Row({
  row,
  maxLots,
  market,
  active,
  onSelect,
}: {
  row: BookRow;
  maxLots: number;
  market: PackageMarket;
  active: boolean;
  onSelect: (row: BookRow) => void;
}) {
  const width = `${Math.max(3, (row.lots / maxLots) * 100)}%`;
  const priceTone = row.side === "ASK" ? "text-down" : "text-up";
  const tint = row.side === "ASK" ? "bg-down-soft" : "bg-up-soft";

  const cells = (
    <>
      <span aria-hidden="true" className={`absolute inset-y-0 right-0 ${tint}`} style={{ width }} />
      <span className={`tnum relative truncate font-mono text-xs ${priceTone}`}>
        {formatPrice(row.price, market)}
      </span>
      <span className="tnum relative text-right font-mono text-xs text-dim">
        {formatLots(row.lots)}
      </span>
      <span className="relative flex items-center gap-1.5 text-xs text-faint">
        <SourceMark source={row.source} />
        <span className="truncate">{SOURCE_LABEL[row.source]}</span>
      </span>
      <span className="relative truncate text-right text-xs text-off">
        {row.ttlSeconds
          ? `${FIRMNESS_LABEL[row.firmness]} ${row.ttlSeconds}s`
          : FIRMNESS_LABEL[row.firmness]}
      </span>
    </>
  );

  if (!row.executable) {
    return (
      <div
        className={`${GRID} ${ROW_HEIGHT} relative opacity-50`}
        title="Indicative estimate. Excluded from executable depth and not selectable."
      >
        {cells}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      title={
        row.origin
          ? `${SOURCE_LABEL[row.source]} liquidity from ${row.origin}. Selecting this row sets the ticket limit.`
          : "Resting package liquidity. Selecting this row sets the ticket limit."
      }
      className={`${GRID} ${ROW_HEIGHT} focus-ring relative w-full cursor-pointer text-left transition-colors hover:bg-raised ${
        active ? "bg-raised" : ""
      }`}
    >
      {cells}
    </button>
  );
}

function BookInfo() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="How this book counts depth"
        className="focus-ring -mr-1 grid h-7 w-7 place-items-center rounded-sm text-faint transition-colors hover:text-ink"
      >
        <Info size={14} aria-hidden="true" />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close book notes"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full right-0 z-50 mt-1.5 w-[min(290px,calc(100vw-24px))] space-y-1.5 rounded-lg border border-line-strong bg-panel p-3 text-xs leading-snug text-dim shadow-[0_24px_48px_rgba(0,0,0,0.55)]">
            <p>Source counts are executable lots.</p>
            <p>Indicative rows are listed but never counted as executable depth.</p>
            <p className="text-faint">Hover a row for its firmness, origin, and quote life.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function OrderBookPanel({
  market,
  directOrders,
  activePrice,
  onSelectRow,
}: {
  market: PackageMarket;
  directOrders: readonly BookRow[];
  activePrice: number;
  onSelectRow: (row: BookRow) => void;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");

  const { asks, bids, maxLots, counts } = useMemo(() => {
    const book = [
      ...market.book.filter((row) => row.source !== "DIRECT"),
      ...directOrders,
    ];
    const visible = book.filter((row) => filter === "ALL" || row.source === filter);
    const executable = book.filter((row) => row.executable);
    const bySource = (source: LiquiditySource) =>
      executable.filter((row) => row.source === source).reduce((sum, row) => sum + row.lots, 0);
    return {
      asks: visible.filter((r) => r.side === "ASK").sort((a, b) => b.price - a.price),
      bids: visible.filter((r) => r.side === "BID").sort((a, b) => b.price - a.price),
      maxLots: Math.max(1, ...visible.map((row) => row.lots)),
      counts: {
        ALL: executable.reduce((sum, row) => sum + row.lots, 0),
        DIRECT: bySource("DIRECT"),
        IMPLIED: bySource("IMPLIED"),
        SOLVER_FIRM: bySource("SOLVER_FIRM"),
      } as Record<Filter, number>,
    };
  }, [directOrders, market, filter]);

  const spread = market.bestAsk - market.bestBid;
  const mid = (market.bestAsk + market.bestBid) / 2;
  const unit = priceUnitSuffix(market.priceUnit);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3 lg:h-9 lg:px-4">
        <SectionLabel>Order book</SectionLabel>
        <BookInfo />
      </div>

      <div
        role="radiogroup"
        aria-label="Filter liquidity by source"
        className="no-scrollbar flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1.5 py-1.5 lg:px-2.5"
      >
        {FILTERS.map((option) => {
          const selected = option.value === filter;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${option.label}, ${formatLots(counts[option.value])} executable lots`}
              onClick={() => setFilter(option.value)}
              className={`focus-ring flex h-8 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors lg:h-7 ${
                selected ? "bg-raised text-ink" : "text-faint hover:text-dim"
              }`}
            >
              {option.label}
              <span className={`tnum font-mono ${selected ? "text-dim" : "text-off"}`}>
                {formatLots(counts[option.value])}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`${GRID} h-7 shrink-0 border-b border-line text-xs text-faint`}
        aria-hidden="true"
      >
        <span>{`Price, ${unit}`}</span>
        <span className="text-right">Lots</span>
        <span>Source</span>
        <span className="text-right">Firmness</span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {asks.length + bids.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-faint">
            No {filter === "ALL" ? "" : `${FILTERS.find((option) => option.value === filter)?.label.toLowerCase()} `}
            liquidity is available.
          </div>
        ) : null}
        {asks.map((row) => (
          <Row
            key={row.id}
            row={row}
            maxLots={maxLots}
            market={market}
            active={row.executable && row.price === activePrice}
            onSelect={onSelectRow}
          />
        ))}

        <div className="flex h-11 items-center justify-between gap-2 border-y border-line bg-inset px-3 lg:h-9 lg:px-4">
          <span className="tnum font-mono text-sm text-ink">{formatPrice(mid, market)}</span>
          <span className="text-xs text-faint">
            spread
            <span className="tnum ml-1.5 font-mono text-dim">
              {`${formatNumber(spread, market.priceDecimals)} ${unit}`}
            </span>
          </span>
        </div>

        {bids.map((row) => (
          <Row
            key={row.id}
            row={row}
            maxLots={maxLots}
            market={market}
            active={row.executable && row.price === activePrice}
            onSelect={onSelectRow}
          />
        ))}
      </div>
    </section>
  );
}
