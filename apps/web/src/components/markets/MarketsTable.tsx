"use client";

import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronDown, Star } from "lucide-react";
import { AssetIcon, AssetLabel } from "@/components/icons/AssetIcon";
import { QualificationTag, SourceMarks } from "@/components/markets/controls";
import {
  AssetGlyph,
  Flash,
  Sparkline,
  liveSeries,
  motion,
  sparkTone,
} from "@/components/markets/ui";
import { SOURCE_LABEL } from "@/components/terminal/primitives";
import {
  changePercent,
  daysToExpiry,
  formatExpiry,
  formatLots,
  formatNumber,
  platformNowSeconds,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { formatAnalytic, strategyAnalytic } from "@/lib/market-data/analytics";
import { settlementShort, sourceClasses, spreadOf } from "@/lib/terminal/discovery";
import { lastTradedPrice, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";

type SortDirection = "asc" | "desc";

interface Column {
  id: string;
  label: string;
  title?: string;
  numeric?: boolean;
  /** Sort key. A column without one is not sortable. */
  key?: (market: PackageMarket) => number | string;
  cell: (market: PackageMarket) => ReactNode;
  /** Applied to the header and every body cell so the column hides as one. */
  hide?: string;
  width?: string;
}

function unit(market: PackageMarket) {
  return priceUnitSuffix(market.priceUnit);
}

/** The 24-hour move of the modeled mark; NaN while the day-old mark is unknown. */
function change(market: PackageMarket) {
  return changePercent(market.netPrice, market.priorNetPrice);
}

/** Sort key that keeps missing values (NaN) last in either direction. */
function sortable(value: number): number {
  return Number.isFinite(value) ? value : Number.NaN;
}

const MARK_TITLE: Record<PackageMarket["markSource"], string> = {
  MODEL: "Modeled mark: the capped-forward model from the Chainlink spot, with MODELED volatility, rate and carry.",
  NONE: "No mark is available.",
};

/**
 * The market-implied view (implied carry, basis, forward points) from the last traded price against the live reference.
 * The modeled mark would only echo the model's own inputs back, so a market that has not traded shows none.
 */
function analyticOf(market: PackageMarket) {
  return strategyAnalytic(market, lastTradedPrice(market), market.referencePrice, platformNowSeconds());
}

function analyticText(market: PackageMarket): string {
  if (!Number.isFinite(lastTradedPrice(market))) return "—";
  return formatAnalytic(analyticOf(market));
}

/** Signed percent that keeps a zero neutral, so only a real move takes colour. */
export function ChangeText({ market, className = "" }: { market: PackageMarket; className?: string }) {
  const value = change(market);
  if (!Number.isFinite(value)) return <span className={`tnum font-mono text-off ${className}`}>—</span>;
  const tone = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-dim";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return (
    <span className={`tnum font-mono ${tone} ${className}`}>
      {`${sign}${Math.abs(value).toFixed(2)}%`}
    </span>
  );
}

/** Mobile reads the move as a filled pill, the way a phone exchange list does. */
export function ChangePill({ market }: { market: PackageMarket }) {
  const value = change(market);
  const known = Number.isFinite(value);
  const tone = !known
    ? "bg-raised text-faint"
    : value > 0
      ? "bg-up-soft text-up"
      : value < 0
        ? "bg-down-soft text-down"
        : "bg-raised text-dim";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return (
    <span
      title={known ? undefined : MARK_TITLE[market.markSource]}
      className={`tnum inline-flex h-[22px] min-w-[64px] items-center justify-center rounded-sm px-1.5 font-mono text-xs font-medium ${tone}`}
    >
      {known ? `${sign}${Math.abs(value).toFixed(2)}%` : "—"}
    </span>
  );
}

export function TenorChip({ market }: { market: PackageMarket }) {
  return (
    <span className="tnum inline-flex h-4 shrink-0 items-center rounded-[3px] bg-raised px-1 font-mono text-[10px] leading-none tracking-[0.02em] text-dim">
      {market.tenorLabel}
    </span>
  );
}

const COLUMNS: Column[] = [
  {
    id: "market",
    label: "Market",
    key: (market) => market.name,
    width: "w-[25%] lg:w-[22%] 2xl:w-[18%]",
    cell: (market) => (
      <Link
        href={tradeHref(market)}
        className="focus-ring flex min-w-0 items-center gap-2 rounded-sm"
        aria-label={`Open the ${market.name} ${market.tenorLabel} terminal`}
      >
        <AssetGlyph underlying={market.underlying} size={20} />
        <span className="flex min-w-0 flex-col justify-center">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] leading-4 font-medium text-ink">{market.name}</span>
            <TenorChip market={market} />
          </span>
          <span className="tnum truncate font-mono text-[11px] leading-[14px] text-faint">{market.code}</span>
        </span>
      </Link>
    ),
  },
  {
    id: "price",
    label: "Mark",
    title: "Modeled mark in USD: the capped-forward model of this expiry from the Chainlink spot.",
    numeric: true,
    key: (market) => sortable(market.netPrice),
    cell: (market) => (
      <span className="flex items-baseline justify-end gap-1 whitespace-nowrap" title={MARK_TITLE[market.markSource]}>
        <Flash
          value={market.netPrice}
          className={`tnum px-1 font-mono text-[13px] ${market.markSource === "NONE" ? "text-dim" : "text-ink"}`}
        >
          {formatNumber(market.netPrice, market.priceDecimals)}
        </Flash>
        <span className="w-[22px] text-left text-[10.5px] text-off">{unit(market)}</span>
      </span>
    ),
  },
  {
    id: "change",
    label: "24h",
    title: "Change of the modeled mark against the same model 24 hours earlier.",
    numeric: true,
    key: (market) => sortable(change(market)),
    cell: (market) => <ChangeText market={market} className="text-xs" />,
  },
  {
    id: "analytic",
    label: "Carry / basis",
    title:
      "Market-implied view from the last traded price against the live Chainlink reference: implied annualized carry for carry markets, F - S for basis, forward points for FX. Shown only once the market has traded.",
    numeric: true,
    key: (market) => (Number.isFinite(lastTradedPrice(market)) ? sortable(analyticOf(market).value) : Number.NaN),
    hide: "hidden xl:table-cell",
    cell: (market) => (
      <span className="tnum font-mono text-xs whitespace-nowrap text-dim" title={analyticOf(market).describe}>
        {analyticText(market)}
      </span>
    ),
  },
  {
    id: "trend",
    label: "Fills",
    title: "Recent onchain fills, oldest to newest. Empty until the market trades.",
    hide: "hidden lg:table-cell",
    width: "w-[112px]",
    cell: (market) => (
      <Sparkline values={liveSeries(market)} tone={sparkTone(market)} width={92} height={24} />
    ),
  },
  {
    id: "bid",
    label: "Bid",
    title: "Best resting bid on the onchain book.",
    numeric: true,
    key: (market) => sortable(market.bestBid),
    cell: (market) => (
      <span className="tnum font-mono text-xs text-up">
        {formatNumber(market.bestBid, market.priceDecimals)}
      </span>
    ),
  },
  {
    id: "ask",
    label: "Offer",
    title: "Best resting offer on the onchain book.",
    numeric: true,
    key: (market) => sortable(market.bestAsk),
    cell: (market) => (
      <span className="tnum font-mono text-xs text-down">
        {formatNumber(market.bestAsk, market.priceDecimals)}
      </span>
    ),
  },
  {
    id: "spread",
    label: "Spread",
    title: "Best resting offer minus best resting bid on the onchain book.",
    numeric: true,
    key: (market) => sortable(spreadOf(market)),
    hide: "hidden lg:table-cell",
    cell: (market) => (
      <span className="tnum font-mono text-xs text-dim">
        {formatNumber(spreadOf(market), market.priceDecimals)}
      </span>
    ),
  },
  {
    id: "depth",
    label: "Firm depth",
    title: "Lots resting on the onchain book, both sides.",
    numeric: true,
    key: (market) => market.firmDepthLots,
    hide: "hidden lg:table-cell",
    cell: (market) => (
      <span className="tnum font-mono text-xs text-dim">{formatLots(market.firmDepthLots)}</span>
    ),
  },
  {
    id: "openInterest",
    label: "Open int.",
    title: "Open positions in lots, from the position engine.",
    numeric: true,
    key: (market) => sortable(market.openInterestLots),
    hide: "hidden xl:table-cell",
    cell: (market) => (
      <span className="tnum font-mono text-xs text-dim">{formatLots(market.openInterestLots)}</span>
    ),
  },
  {
    id: "expiry",
    label: "Expiry",
    numeric: true,
    key: (market) => daysToExpiry(market.expiryIso),
    cell: (market) => (
      <span className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
        <span className="tnum font-mono text-xs text-dim">{formatExpiry(market.expiryIso)}</span>
        <span className="tnum w-[34px] text-right font-mono text-[11px] text-off">
          {`${daysToExpiry(market.expiryIso)}d`}
        </span>
      </span>
    ),
  },
  {
    id: "qualification",
    label: "Status",
    title: "Qualification of the package for entry.",
    key: (market) => market.qualification,
    width: "w-[118px]",
    cell: (market) => <QualificationTag market={market} bare />,
  },
  {
    id: "settlement",
    label: "Settlement",
    key: (market) => settlementShort(market.settlementClass),
    hide: "hidden 2xl:table-cell",
    cell: (market) => (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-dim" title={market.fixingSource}>
        <AssetIcon symbol="USDC" size={13} />
        <span className="truncate">{settlementShort(market.settlementClass)}</span>
      </span>
    ),
  },
  {
    id: "sources",
    label: "Sources",
    title: "Liquidity resting on the onchain book.",
    key: (market) => market.book.filter((row) => row.executable).length,
    hide: "hidden 2xl:table-cell",
    cell: (market) => <SourceMarks market={market} />,
  },
  {
    id: "observation",
    label: "Obs",
    title: "Age of the chain read behind this row.",
    numeric: true,
    key: (market) => (market.listedOnchain ? market.snapshotAgeSeconds : Number.NaN),
    hide: "hidden 2xl:table-cell",
    width: "w-[52px]",
    cell: (market) => (
      <span className="tnum font-mono text-[11px] text-off">{market.listedOnchain ? `${market.snapshotAgeSeconds}s` : "—"}</span>
    ),
  },
];

function compare(column: Column, direction: SortDirection) {
  const key = column.key;
  if (!key) return () => 0;
  const sign = direction === "asc" ? 1 : -1;
  return (a: PackageMarket, b: PackageMarket) => {
    const left = key(a);
    const right = key(b);
    if (typeof left === "string" || typeof right === "string") {
      return sign * String(left).localeCompare(String(right));
    }
    // Missing values sort last whichever way the column runs.
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return Number.isFinite(left) === Number.isFinite(right) ? 0 : Number.isFinite(left) ? -1 : 1;
    }
    return sign * (left - right);
  };
}

/** Two stacked carets; the active direction lights, the other stays a hairline. */
function SortGlyph({ direction }: { direction: SortDirection | null }) {
  return (
    <svg width="6" height="9" viewBox="0 0 6 9" aria-hidden="true" className="shrink-0">
      <path
        d="M3 0.5 L5.6 3.6 H0.4 Z"
        fill="currentColor"
        opacity={direction === "asc" ? 1 : 0.28}
      />
      <path
        d="M3 8.5 L0.4 5.4 H5.6 Z"
        fill="currentColor"
        opacity={direction === "desc" ? 1 : 0.28}
      />
    </svg>
  );
}

export function FavouriteButton({
  market,
  active,
  onToggle,
  className = "",
}: {
  market: PackageMarket;
  active: boolean;
  onToggle: (id: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(market.id)}
      aria-pressed={active}
      aria-label={`${active ? "Remove" : "Add"} ${market.name} ${market.tenorLabel} ${active ? "from" : "to"} favourites`}
      title={active ? "Remove from favourites" : "Add to favourites"}
      className={`focus-ring grid shrink-0 place-items-center rounded-sm transition-[color,transform] duration-150 active:scale-90 ${
        active ? "text-brand" : "text-off hover:text-dim"
      } ${className}`}
    >
      <Star size={13} aria-hidden="true" fill={active ? "currentColor" : "none"} strokeWidth={1.75} />
    </button>
  );
}

const STICKY: CSSProperties = { top: "var(--sticky-top, 0px)" };

export function MarketsTable({
  markets,
  favourites,
  onToggleFavourite,
}: {
  markets: PackageMarket[];
  favourites: ReadonlySet<string>;
  onToggleFavourite: (id: string) => void;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ id: string; direction: SortDirection }>({
    id: "expiry",
    direction: "asc",
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const column = COLUMNS.find((candidate) => candidate.id === sort.id);
    if (!column) return markets;
    return [...markets].sort(compare(column, sort.direction));
  }, [markets, sort]);

  /* A fresh column opens on its natural reading: largest first for numbers, A to Z for text. */
  const toggleSort = (column: Column) => {
    if (!column.key) return;
    setSort((current) =>
      current.id === column.id
        ? { id: column.id, direction: current.direction === "asc" ? "desc" : "asc" }
        : { id: column.id, direction: column.numeric ? "desc" : "asc" },
    );
  };

  const openRow = (event: MouseEvent<HTMLTableRowElement>, market: PackageMarket) => {
    if ((event.target as HTMLElement).closest("a,button")) return;
    router.push(tradeHref(market));
  };

  const head = "bg-panel shadow-[inset_0_-1px_0_var(--color-line)]";

  return (
    <>
      <table className="hidden w-full border-collapse text-left md:table">
        <caption className="sr-only">
          Package markets, sortable by price, liquidity, maturity, and qualification. Press a row
          to open its terminal.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={STICKY} className={`${head} sticky z-10 h-8 w-9 pl-3`}>
              <span className="sr-only">Favourite</span>
            </th>
            {COLUMNS.map((column) => {
              const active = sort.id === column.id;
              return (
                <th
                  key={column.id}
                  scope="col"
                  style={STICKY}
                  aria-sort={
                    active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={`${column.hide ?? ""} ${column.width ?? ""} ${head} sticky z-10 h-8 px-2.5 font-normal`}
                >
                  {column.key ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      title={column.title}
                      className={`focus-ring flex h-8 w-full items-center gap-1.5 rounded-sm text-[11px] whitespace-nowrap transition-colors duration-150 hover:text-ink ${
                        column.numeric ? "justify-end" : "justify-start"
                      } ${active ? "text-ink" : "text-faint"}`}
                    >
                      {column.label}
                      <SortGlyph direction={active ? sort.direction : null} />
                    </button>
                  ) : (
                    <span
                      title={column.title}
                      className={`flex text-[11px] text-faint ${column.numeric ? "justify-end" : ""}`}
                    >
                      {column.label}
                    </span>
                  )}
                </th>
              );
            })}
            <th scope="col" style={STICKY} className={`${head} sticky z-10 hidden h-8 w-[76px] pr-3 lg:table-cell`}>
              <span className="sr-only">Open terminal</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {sorted.map((market, index) => (
            <tr
              key={market.id}
              onClick={(event) => openRow(event, market)}
              style={{ animationDelay: `${Math.min(index, 18) * 14}ms` }}
              className={`${motion.enter} group cursor-pointer border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/70`}
            >
              <td className="h-10 pl-3 align-middle">
                <FavouriteButton
                  market={market}
                  active={favourites.has(market.id)}
                  onToggle={onToggleFavourite}
                  className="h-6 w-6"
                />
              </td>
              {COLUMNS.map((column) => (
                <td
                  key={column.id}
                  className={`${column.hide ?? ""} h-10 px-2.5 align-middle ${column.numeric ? "text-right" : ""}`}
                >
                  {column.id === "market" ? (
                    column.cell(market)
                  ) : (
                    <span
                      className={`flex min-w-0 items-center ${
                        column.numeric ? "justify-end" : "justify-start"
                      }`}
                    >
                      {column.cell(market)}
                    </span>
                  )}
                </td>
              ))}
              <td className="hidden h-10 pr-3 text-right align-middle lg:table-cell">
                <Link
                  href={tradeHref(market)}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="inline-flex h-6 items-center gap-1 rounded-sm border border-brand-edge bg-brand-soft px-2 text-[11px] text-brand opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  Trade
                  <ArrowUpRight size={11} aria-hidden="true" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <MobileMarketList
        markets={sorted}
        expanded={expanded}
        onExpand={(id) => setExpanded((current) => (current === id ? null : id))}
        favourites={favourites}
        onToggleFavourite={onToggleFavourite}
      />
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[5px]">
      <span className="shrink-0 text-xs text-faint">{label}</span>
      <span className="tnum min-w-0 truncate text-right font-mono text-xs text-dim">{value}</span>
    </div>
  );
}

/** Mobile keeps the decision columns inline and parks the rest behind one toggle. */
function MobileMarketList({
  markets,
  expanded,
  onExpand,
  favourites,
  onToggleFavourite,
}: {
  markets: PackageMarket[];
  expanded: string | null;
  onExpand: (id: string) => void;
  favourites: ReadonlySet<string>;
  onToggleFavourite: (id: string) => void;
}) {
  return (
    <ul className="md:hidden">
      {markets.map((market, index) => {
        const open = expanded === market.id;
        return (
          <li
            key={market.id}
            style={{ animationDelay: `${Math.min(index, 12) * 16}ms` }}
            className={`${motion.enter} border-b border-line-soft last:border-b-0`}
          >
            <div className="flex items-stretch">
              <FavouriteButton
                market={market}
                active={favourites.has(market.id)}
                onToggle={onToggleFavourite}
                className="w-9 pl-1"
              />
              <Link
                href={tradeHref(market)}
                className="focus-ring flex min-h-[60px] min-w-0 flex-1 items-center gap-2.5 py-2 pr-1"
              >
                <AssetGlyph underlying={market.underlying} size={22} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm leading-4 font-medium text-ink">{market.name}</span>
                    <TenorChip market={market} />
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-[14px]">
                    <QualificationTag market={market} bare />
                    <span className="text-off">/</span>
                    <span className="tnum truncate font-mono text-faint">
                      {`${daysToExpiry(market.expiryIso)}d`}
                    </span>
                  </span>
                </span>
                <Sparkline
                  values={liveSeries(market)}
                  tone={sparkTone(market)}
                  width={52}
                  height={22}
                  area={false}
                  className="max-[359px]:hidden"
                />
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="flex items-baseline gap-1 whitespace-nowrap">
                    <Flash value={market.netPrice} className="tnum font-mono text-[13px] text-ink">
                      {formatNumber(market.netPrice, market.priceDecimals)}
                    </Flash>
                    <span className="text-[10px] text-off">{unit(market)}</span>
                  </span>
                  <ChangePill market={market} />
                </span>
              </Link>

              <button
                type="button"
                onClick={() => onExpand(market.id)}
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} detail for ${market.name} ${market.tenorLabel}`}
                className="focus-ring grid w-10 shrink-0 place-items-center text-faint transition-colors hover:text-ink"
              >
                <ChevronDown
                  size={15}
                  aria-hidden="true"
                  className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {open ? (
              <div className={`${motion.fade} mx-3 mb-2.5 rounded-md border border-line bg-inset px-3 py-1.5`}>
                <DetailRow label="Code" value={market.code} />
                <DetailRow
                  label="Bid / offer"
                  value={
                    <>
                      <span className="text-up">{formatNumber(market.bestBid, market.priceDecimals)}</span>
                      <span className="mx-1 text-off">/</span>
                      <span className="text-down">{formatNumber(market.bestAsk, market.priceDecimals)}</span>
                    </>
                  }
                />
                <DetailRow label="Strategy" value={market.strategyLabel} />
                <DetailRow label={analyticOf(market).label} value={analyticText(market)} />
                <DetailRow
                  label="Reference"
                  value={`${formatNumber(market.referencePrice, market.priceDecimals + 1)} ${market.referencePair}`}
                />
                <DetailRow
                  label="Spread"
                  value={Number.isFinite(spreadOf(market)) ? `${formatNumber(spreadOf(market), market.priceDecimals)} ${unit(market)}` : "—"}
                />
                <DetailRow label="Firm depth" value={`${formatLots(market.firmDepthLots)} lots`} />
                <DetailRow
                  label="Open interest"
                  value={Number.isFinite(market.openInterestLots) ? `${formatLots(market.openInterestLots)} lots` : "—"}
                />
                <DetailRow label="Expiry" value={formatExpiry(market.expiryIso)} />
                <DetailRow
                  label="Settlement"
                  value={
                    <AssetLabel symbol="USDC" size={12} className="gap-1.5">
                      {settlementShort(market.settlementClass)}
                    </AssetLabel>
                  }
                />
                <DetailRow label="Fixing" value={market.fixingSource} />
                <DetailRow
                  label="Sources"
                  value={sourceClasses(market)
                    .map((source) => SOURCE_LABEL[source])
                    .join(", ") || "No resting orders"}
                />
                <DetailRow
                  label="Mark"
                  value={MARK_TITLE[market.markSource].replace(/\.$/, "")}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
