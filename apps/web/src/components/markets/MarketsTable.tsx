"use client";

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PriceCell, QualificationTag, SourceMarks } from "@/components/markets/controls";
import { Delta, SOURCE_LABEL } from "@/components/terminal/primitives";
import {
  changePercent,
  daysToExpiry,
  formatExpiry,
  formatLots,
  formatNumber,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { settlementShort, sourceClasses, spreadOf } from "@/lib/terminal/discovery";
import { tradeHref } from "@/lib/terminal/markets";
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

const COLUMNS: Column[] = [
  {
    id: "market",
    label: "Market",
    key: (market) => market.name,
    width: "w-[218px]",
    cell: (market) => (
      <Link
        href={tradeHref(market)}
        className="focus-ring flex min-w-0 flex-col py-1.5 pr-2"
        aria-label={`Open the ${market.name} terminal`}
      >
        <span className="truncate text-[13px] text-ink">{market.name}</span>
        <span className="tnum truncate font-mono text-xs text-faint">{market.code}</span>
      </Link>
    ),
  },
  {
    id: "price",
    label: "Package price",
    numeric: true,
    key: (market) => market.netPrice,
    cell: (market) => (
      <span className="whitespace-nowrap">
        <PriceCell market={market} />
        <span className="ml-1 text-xs text-off">{unit(market)}</span>
      </span>
    ),
  },
  {
    id: "change",
    label: "Change",
    numeric: true,
    key: (market) => changePercent(market.netPrice, market.priorNetPrice),
    cell: (market) => (
      <Delta value={changePercent(market.netPrice, market.priorNetPrice)} className="text-xs" />
    ),
  },
  {
    id: "bid",
    label: "Best bid",
    numeric: true,
    key: (market) => market.bestBid,
    cell: (market) => (
      <span className="tnum font-mono text-xs text-up">
        {formatNumber(market.bestBid, market.priceDecimals)}
      </span>
    ),
  },
  {
    id: "ask",
    label: "Best offer",
    numeric: true,
    key: (market) => market.bestAsk,
    cell: (market) => (
      <span className="tnum font-mono text-xs text-down">
        {formatNumber(market.bestAsk, market.priceDecimals)}
      </span>
    ),
  },
  {
    id: "spread",
    label: "Spread",
    title: "Best executable offer minus best executable bid across every source class.",
    numeric: true,
    key: spreadOf,
    cell: (market) => (
      <span className="tnum font-mono text-xs text-dim">
        {formatNumber(spreadOf(market), market.priceDecimals)}
      </span>
    ),
  },
  {
    id: "depth",
    label: "Firm depth",
    title: "Executable lots only. Indicative rows are never counted.",
    numeric: true,
    key: (market) => market.firmDepthLots,
    cell: (market) => (
      <span className="tnum font-mono text-xs text-dim">{formatLots(market.firmDepthLots)}</span>
    ),
  },
  {
    id: "openInterest",
    label: "Open interest",
    numeric: true,
    key: (market) => market.openInterestLots,
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
    width: "w-[132px]",
    cell: (market) => (
      <span className="flex flex-col items-end whitespace-nowrap">
        <span className="tnum font-mono text-xs text-dim">{formatExpiry(market.expiryIso)}</span>
        <span className="tnum font-mono text-xs text-off">
          {`${market.tenorLabel}, ${daysToExpiry(market.expiryIso)}d`}
        </span>
      </span>
    ),
  },
  {
    id: "qualification",
    label: "Qualification",
    key: (market) => market.qualification,
    cell: (market) => <QualificationTag market={market} />,
  },
  {
    id: "settlement",
    label: "Settlement",
    key: (market) => settlementShort(market.settlementClass),
    hide: "hidden 2xl:table-cell",
    cell: (market) => (
      <span className="truncate text-xs text-dim" title={market.fixingSource}>
        {settlementShort(market.settlementClass)}
      </span>
    ),
  },
  {
    id: "sources",
    label: "Sources",
    title: "Source classes with executable size: direct, implied, solver firm.",
    key: (market) => market.book.filter((row) => row.executable).length,
    hide: "hidden xl:table-cell",
    cell: (market) => <SourceMarks market={market} />,
  },
  {
    id: "observation",
    label: "Obs",
    title: "Age of the preview fixture snapshot behind this row.",
    numeric: true,
    key: (market) => market.snapshotAgeSeconds,
    hide: "hidden 2xl:table-cell",
    cell: (market) => (
      <span className="tnum font-mono text-xs text-off">{`${market.snapshotAgeSeconds}s`}</span>
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
    return sign * (left - right);
  };
}

export function MarketsTable({ markets }: { markets: PackageMarket[] }) {
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

  return (
    <>
      <div className="scroll-thin hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full min-w-[940px] border-collapse text-left">
          <caption className="sr-only">
            Package markets, sortable by price, liquidity, maturity, and qualification.
          </caption>
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line">
              {COLUMNS.map((column) => {
                const active = sort.id === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined
                    }
                    className={`${column.hide ?? ""} ${column.width ?? ""} h-8 px-3 font-normal`}
                  >
                    {column.key ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        title={column.title}
                        className={`focus-ring flex h-8 w-full items-center gap-1 text-xs whitespace-nowrap transition-colors hover:text-ink ${
                          column.numeric ? "justify-end" : "justify-start"
                        } ${active ? "text-ink" : "text-faint"}`}
                      >
                        {column.label}
                        {active ? (
                          sort.direction === "asc" ? (
                            <ChevronUp size={12} aria-hidden="true" className="shrink-0" />
                          ) : (
                            <ChevronDown size={12} aria-hidden="true" className="shrink-0" />
                          )
                        ) : null}
                      </button>
                    ) : (
                      <span className="text-xs text-faint">{column.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sorted.map((market) => (
              <tr
                key={market.id}
                onClick={(event) => openRow(event, market)}
                className="cursor-pointer border-b border-line-soft transition-colors hover:bg-raised"
              >
                {COLUMNS.map((column) => (
                  <td
                    key={column.id}
                    className={`${column.hide ?? ""} ${column.width ?? ""} px-3 align-middle ${
                      column.numeric ? "text-right" : ""
                    }`}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MobileMarketList
        markets={sorted}
        expanded={expanded}
        onExpand={(id) => setExpanded((current) => (current === id ? null : id))}
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
}: {
  markets: PackageMarket[];
  expanded: string | null;
  onExpand: (id: string) => void;
}) {
  return (
    <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto md:hidden">
      {markets.map((market) => {
        const open = expanded === market.id;
        return (
          <li key={market.id} className="border-b border-line">
            <div className="flex items-stretch">
              <Link
                href={tradeHref(market)}
                className="focus-ring flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-1 py-2 pr-2 pl-3"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-ink">{market.name}</span>
                  <span className="shrink-0 whitespace-nowrap">
                    <PriceCell market={market} />
                    <span className="ml-1 text-xs text-off">{unit(market)}</span>
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="tnum truncate font-mono text-xs text-faint">
                    {`${market.code} / ${daysToExpiry(market.expiryIso)}d`}
                  </span>
                  <Delta
                    value={changePercent(market.netPrice, market.priorNetPrice)}
                    className="shrink-0 text-xs"
                  />
                </span>
                {/* Qualification is the state the row is read for, so it holds its
                    width and the quote line shortens instead. The lot unit is
                    spelled out again in the detail below. */}
                <span className="flex items-baseline justify-between gap-2">
                  <span className="tnum truncate font-mono text-xs text-dim">
                    <span className="text-up">
                      {formatNumber(market.bestBid, market.priceDecimals)}
                    </span>
                    <span className="mx-1 text-off">/</span>
                    <span className="text-down">
                      {formatNumber(market.bestAsk, market.priceDecimals)}
                    </span>
                    <span className="ml-2 text-off">{`${formatLots(market.firmDepthLots)} firm`}</span>
                  </span>
                  <QualificationTag market={market} className="shrink-0" />
                </span>
              </Link>

              <button
                type="button"
                onClick={() => onExpand(market.id)}
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} detail for ${market.name}`}
                className="focus-ring grid w-11 shrink-0 place-items-center border-l border-line-soft text-faint transition-colors hover:text-ink"
              >
                <ChevronDown
                  size={15}
                  aria-hidden="true"
                  className={`transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {open ? (
              <div className="divide-y divide-line border-t border-line bg-inset px-3 py-1.5">
                <DetailRow label="Strategy" value={market.strategyLabel} />
                <DetailRow
                  label="Spread"
                  value={`${formatNumber(spreadOf(market), market.priceDecimals)} ${unit(market)}`}
                />
                <DetailRow
                  label="Firm depth"
                  value={`${formatLots(market.firmDepthLots)} lots`}
                />
                <DetailRow
                  label="Open interest"
                  value={`${formatLots(market.openInterestLots)} lots`}
                />
                <DetailRow label="Expiry" value={formatExpiry(market.expiryIso)} />
                <DetailRow label="Settlement" value={settlementShort(market.settlementClass)} />
                <DetailRow label="Fixing" value={market.fixingSource} />
                <DetailRow
                  label="Sources"
                  value={sourceClasses(market)
                    .map((source) => SOURCE_LABEL[source])
                    .join(", ")}
                />
                <DetailRow
                  label="Observation"
                  value={`preview fixture, ${market.snapshotAgeSeconds}s`}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
