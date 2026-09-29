"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Info } from "lucide-react";
import { FlashValue } from "@/components/terminal/motion";
import { usePreviewTrades } from "@/components/terminal/PreviewMarketProvider";
import { FIRMNESS_LABEL, SOURCE_LABEL, SourceMark } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatLots,
  formatNumber,
  formatPrice,
  formatUtcClock,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { PreviewTrade } from "@/lib/terminal/preview-trades";
import type { BookRow, LiquiditySource, PackageMarket } from "@/lib/terminal/types";

type SourceFilter = "ALL" | LiquiditySource;
type BookView = "BOTH" | "BIDS" | "ASKS";
type SizeUnit = "LOTS" | "USDC";
type PanelTab = "BOOK" | "TRADES";

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DIRECT", label: "Direct" },
  { value: "IMPLIED", label: "Implied" },
  { value: "SOLVER_FIRM", label: "Solver" },
];

const GROUP_STEPS = [1, 2, 5, 10];
const ROW = "grid h-[22px] grid-cols-[14px_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)] items-center gap-2 px-3";

interface LevelRow extends BookRow {
  cumulative: number;
}

function groupLevels(rows: BookRow[], step: number, side: "BID" | "ASK", decimals: number): BookRow[] {
  if (step <= 0) return rows;
  const buckets = new Map<number, BookRow & { weight: number }>();
  for (const row of rows) {
    const scaled = row.price / step;
    const bucket = Number((side === "ASK" ? Math.ceil(scaled - 1e-9) : Math.floor(scaled + 1e-9)) * step);
    const price = Number(bucket.toFixed(decimals));
    const current = buckets.get(price);
    if (!current) {
      buckets.set(price, { ...row, id: `${side}-${price}`, price, weight: row.lots });
      continue;
    }
    current.lots += row.lots;
    current.executable = current.executable || row.executable;
    if (row.lots > current.weight) {
      current.source = row.source;
      current.firmness = row.firmness;
      current.origin = row.origin;
      current.weight = row.lots;
    }
  }
  return [...buckets.values()].map((bucket) => {
    const row: BookRow = { ...bucket };
    delete (row as Partial<typeof bucket>).weight;
    return row;
  });
}

function withCumulative(rows: BookRow[]): LevelRow[] {
  let total = 0;
  return rows.map((row) => {
    total += row.lots;
    return { ...row, cumulative: total };
  });
}

function sizeLabel(lots: number, unit: SizeUnit, market: PackageMarket): string {
  return unit === "LOTS" ? formatLots(lots) : formatCompactUsd(lots * market.notionalPerLot);
}

function Level({
  row,
  maxCumulative,
  market,
  unit,
  active,
  onSelect,
}: {
  row: LevelRow;
  maxCumulative: number;
  market: PackageMarket;
  unit: SizeUnit;
  active: boolean;
  onSelect: (row: BookRow) => void;
}) {
  const depth = `${Math.max(2, (row.cumulative / maxCumulative) * 100)}%`;
  const ask = row.side === "ASK";
  const tone = ask ? "text-down" : "text-up";
  const fill = ask ? "bg-down/12" : "bg-up/12";
  const describe = `${SOURCE_LABEL[row.source]}, ${FIRMNESS_LABEL[row.firmness]}${
    row.ttlSeconds ? `, quote valid ${row.ttlSeconds}s` : ""
  }${row.origin ? `, from ${row.origin}` : ""}`;

  const cells = (
    <>
      <span aria-hidden="true" className={`absolute inset-y-px right-0 ${fill}`} style={{ width: depth }} />
      <span className="relative flex justify-center text-off" title={describe}>
        <SourceMark source={row.source} />
      </span>
      <span className={`tnum relative truncate font-mono text-xs ${tone}`}>{formatPrice(row.price, market)}</span>
      <span className="tnum relative truncate text-right font-mono text-xs text-dim">
        {sizeLabel(row.lots, unit, market)}
      </span>
      <span className="tnum relative truncate text-right font-mono text-xs text-faint">
        {sizeLabel(row.cumulative, unit, market)}
      </span>
    </>
  );

  if (!row.executable) {
    return (
      <div className={`${ROW} relative opacity-40`} title={`Indicative. ${describe}. Not executable depth.`}>
        {cells}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      title={`${describe}. Select to set the ticket price.`}
      className={`${ROW} focus-ring relative w-full cursor-pointer text-left transition-colors hover:bg-white/[0.04] ${
        active ? "bg-white/[0.06]" : ""
      }`}
    >
      {cells}
    </button>
  );
}

function ViewIcon({ view }: { view: BookView }) {
  const up = "var(--color-up)";
  const down = "var(--color-down)";
  const bars =
    view === "BOTH"
      ? [down, down, up, up]
      : view === "BIDS"
        ? [up, up, up, up]
        : [down, down, down, down];
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {bars.map((color, index) => (
        <rect key={index} x="1" y={1 + index * 3.2} width="12" height="2.2" rx="0.5" fill={color} opacity="0.85" />
      ))}
    </svg>
  );
}

function Menu<T extends string | number>({
  label,
  value,
  options,
  onChange,
  align = "right",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
        className="focus-ring flex h-6 items-center gap-1 rounded-sm px-1.5 font-mono text-[11px] whitespace-nowrap text-dim transition-colors hover:bg-raised hover:text-ink"
      >
        {current?.label}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open ? (
        <>
          <button type="button" aria-label={`Close ${label}`} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div
            className={`absolute top-full z-50 mt-1 min-w-32 rounded-md border border-line-strong bg-raised p-1 shadow-[0_18px_40px_rgba(0,0,0,0.55)] ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {options.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`focus-ring flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-panel ${
                  option.value === value ? "text-ink" : "text-dim"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TradesTape({ market, trades }: { market: PackageMarket; trades: PreviewTrade[] }) {
  // The seeded history renders still; only prints that arrive while the tape is open animate in.
  const [firstId] = useState(() => trades[0]?.id ?? null);
  const animateHead = trades[0]?.id !== firstId;
  return (
    <div className="panel-in flex min-h-0 flex-1 flex-col">
      <div className="grid h-7 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] items-center gap-2 px-3 text-[11px] text-faint">
        <span>{`Price (${priceUnitSuffix(market.priceUnit)})`}</span>
        <span className="text-right">Size (lots)</span>
        <span className="text-right">Time</span>
      </div>
      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto" aria-label="Recent trades">
        {trades.map((trade, index) => (
          <li
            key={trade.id}
            className={`grid h-[22px] grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] items-center gap-2 px-3 ${
              index === 0 && animateHead ? (trade.side === "BUY" ? "trade-in-up" : "trade-in-down") : ""
            }`}
          >
            <span className={`tnum font-mono text-xs ${trade.side === "BUY" ? "text-up" : "text-down"}`}>
              {formatPrice(trade.price, market)}
            </span>
            <span className="tnum text-right font-mono text-xs text-dim">{formatLots(trade.lots)}</span>
            <span className="tnum text-right font-mono text-xs text-faint">
              {`${formatUtcClock(trade.time)}:${String(trade.time % 60).padStart(2, "0")}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BookNotes() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="How this book counts depth"
        className="focus-ring grid h-6 w-6 place-items-center rounded-sm text-faint transition-colors hover:text-ink"
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close book notes" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 z-50 mt-1.5 w-[min(300px,calc(100vw-24px))] space-y-2 rounded-lg border border-line-strong bg-raised p-3 text-xs leading-snug text-dim shadow-[0_24px_48px_rgba(0,0,0,0.55)]">
            <p className="text-ink">One package book, three liquidity sources.</p>
            <p className="flex items-center gap-2">
              <SourceMark source="DIRECT" /> Direct resting package orders.
            </p>
            <p className="flex items-center gap-2">
              <SourceMark source="IMPLIED" /> Implied from the component leg books, capacity backed.
            </p>
            <p className="flex items-center gap-2">
              <SourceMark source="SOLVER_FIRM" /> Solver firm quotes, signed and time limited.
            </p>
            <p className="text-faint">Faded rows are indicative and never count as executable depth.</p>
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
  const [tab, setTab] = useState<PanelTab>("BOOK");
  const [source, setSource] = useState<SourceFilter>("ALL");
  const [view, setView] = useState<BookView>("BOTH");
  const [groupStep, setGroupStep] = useState(1);
  const [unit, setUnit] = useState<SizeUnit>("LOTS");
  const trades = usePreviewTrades(market.id);

  const book = useMemo(() => {
    const rows = [...market.book.filter((row) => row.source !== "DIRECT"), ...directOrders].filter(
      (row) => source === "ALL" || row.source === source,
    );
    const step = market.tickSize * groupStep;
    const asks = withCumulative(
      groupLevels(rows.filter((row) => row.side === "ASK"), groupStep === 1 ? 0 : step, "ASK", market.priceDecimals).sort(
        (left, right) => left.price - right.price,
      ),
    );
    const bids = withCumulative(
      groupLevels(rows.filter((row) => row.side === "BID"), groupStep === 1 ? 0 : step, "BID", market.priceDecimals).sort(
        (left, right) => right.price - left.price,
      ),
    );
    const askLots = asks.filter((row) => row.executable).reduce((sum, row) => sum + row.lots, 0);
    const bidLots = bids.filter((row) => row.executable).reduce((sum, row) => sum + row.lots, 0);
    return {
      asks,
      bids,
      maxCumulative: Math.max(1, asks.at(-1)?.cumulative ?? 0, bids.at(-1)?.cumulative ?? 0),
      bidShare: bidLots + askLots > 0 ? bidLots / (bidLots + askLots) : 0.5,
    };
  }, [directOrders, groupStep, market, source]);

  const spread = market.bestAsk - market.bestBid;
  const mid = (market.bestAsk + market.bestBid) / 2;
  const spreadPercent = mid !== 0 ? (spread / Math.abs(mid)) * 100 : 0;
  const unitSuffix = priceUnitSuffix(market.priceUnit);
  const last = trades[0];
  const lastUp = last ? last.side === "BUY" : true;
  const bidPercent = Math.round(book.bidShare * 100);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel" aria-label="Order book and trades">
      <div className="flex h-10 shrink-0 items-stretch border-b border-line" role="tablist" aria-label="Book panel">
        {(["BOOK", "TRADES"] as PanelTab[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`focus-ring relative flex-1 text-xs font-medium transition-colors ${
              tab === id ? "text-ink" : "text-faint hover:text-dim"
            }`}
          >
            {id === "BOOK" ? "Order book" : "Trades"}
            {tab === id ? <span aria-hidden="true" className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-brand" /> : null}
          </button>
        ))}
      </div>

      {tab === "TRADES" ? (
        <TradesTape market={market} trades={trades} />
      ) : (
        <div className="panel-in flex min-h-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center gap-1 px-2">
            {(["BOTH", "BIDS", "ASKS"] as BookView[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                aria-pressed={view === option}
                aria-label={option === "BOTH" ? "Show bids and asks" : option === "BIDS" ? "Show bids only" : "Show asks only"}
                className={`focus-ring grid h-6 w-6 place-items-center rounded-sm transition-opacity ${
                  view === option ? "bg-raised opacity-100" : "opacity-45 hover:opacity-80"
                }`}
              >
                <ViewIcon view={option} />
              </button>
            ))}
            <span className="flex-1" />
            <Menu
              label="Liquidity source"
              value={source}
              options={SOURCE_FILTERS}
              onChange={setSource}
            />
            <Menu
              label="Price grouping"
              value={groupStep}
              options={GROUP_STEPS.map((step) => ({
                value: step,
                label: formatNumber(step * market.tickSize, market.priceDecimals),
              }))}
              onChange={setGroupStep}
            />
            <Menu
              label="Size unit"
              value={unit}
              options={[
                { value: "LOTS", label: "Lots" },
                { value: "USDC", label: "USDC" },
              ]}
              onChange={setUnit}
            />
            <BookNotes />
          </div>

          <div className={`${ROW} h-6 shrink-0 text-[11px] text-faint`} aria-hidden="true">
            <span />
            <span>{`Price (${unitSuffix})`}</span>
            <span className="text-right">{unit === "LOTS" ? "Size (lots)" : "Size (USDC)"}</span>
            <span className="text-right">Total</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {view !== "BIDS" ? (
              <div className={`flex min-h-0 flex-col-reverse overflow-hidden ${view === "ASKS" ? "flex-1" : "flex-1 basis-0"}`}>
                {book.asks.map((row) => (
                  <Level
                    key={row.id}
                    row={row}
                    maxCumulative={book.maxCumulative}
                    market={market}
                    unit={unit}
                    active={row.executable && row.price === activePrice}
                    onSelect={onSelectRow}
                  />
                ))}
              </div>
            ) : null}

            <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-y border-line bg-inset px-3">
              <span className={`tnum flex items-center gap-1 font-mono text-base font-medium ${lastUp ? "text-up" : "text-down"}`}>
                <FlashValue value={last?.price ?? mid}>{formatPrice(last?.price ?? mid, market)}</FlashValue>
                {lastUp ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
              </span>
              <span className="text-[11px] text-faint">
                Spread
                <span className="tnum ml-1.5 font-mono text-dim">
                  {`${formatNumber(spread, market.priceDecimals)} ${unitSuffix}`}
                </span>
                <span className="tnum ml-1 font-mono text-off">{`${spreadPercent.toFixed(3)}%`}</span>
              </span>
            </div>

            {view !== "ASKS" ? (
              <div className={`flex min-h-0 flex-col overflow-hidden ${view === "BIDS" ? "flex-1" : "flex-1 basis-0"}`}>
                {book.bids.map((row) => (
                  <Level
                    key={row.id}
                    row={row}
                    maxCumulative={book.maxCumulative}
                    market={market}
                    unit={unit}
                    active={row.executable && row.price === activePrice}
                    onSelect={onSelectRow}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line px-3" aria-label={`Executable depth ${bidPercent}% bids`}>
            <span className="tnum font-mono text-[11px] text-up">{`B ${bidPercent}%`}</span>
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-down/70">
              <span className="h-full rounded-l-full bg-up/80" style={{ width: `${bidPercent}%` }} />
            </div>
            <span className="tnum font-mono text-[11px] text-down">{`${100 - bidPercent}% S`}</span>
          </div>
        </div>
      )}
    </section>
  );
}
