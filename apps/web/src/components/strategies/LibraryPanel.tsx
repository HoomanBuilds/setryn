"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Delta } from "@/components/terminal/primitives";
import { Panel, PanelHead, deskMotion } from "@/components/strategies/desk/Desk";
import { changePercent, formatPrice } from "@/lib/terminal/format";
import type { PackageMarket, Qualification } from "@/lib/terminal/types";
import { MarketMark } from "@/components/portfolio/MarketMark";

const FILTERS: { id: "ALL" | Qualification; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "QUALIFIED", label: "Qualified" },
  { id: "CONDITIONAL", label: "Conditional" },
];

function dotTone(qualification: Qualification): string {
  if (qualification === "QUALIFIED") return "bg-up";
  if (qualification === "CONDITIONAL") return "bg-brand";
  return "bg-down";
}

/**
 * Listed package templates with marks from the shared preview board, so the
 * library, the studio header and the terminal read the same feed.
 */
export function LibraryPanel({
  templates,
  marketId,
  onSelect,
  className = "",
}: {
  templates: PackageMarket[];
  marketId: string;
  onSelect: (marketId: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | Qualification>("ALL");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter(
      (market) =>
        (filter === "ALL" || market.qualification === filter) &&
        (needle.length === 0 ||
          market.code.toLowerCase().includes(needle) ||
          market.name.toLowerCase().includes(needle) ||
          market.underlying.toLowerCase().includes(needle)),
    );
  }, [filter, query, templates]);

  return (
    <Panel label="Package library" className={`min-h-0 overflow-hidden ${className}`}>
      <PanelHead
        title="Package library"
        tools={<span className="tnum font-mono text-[11px] text-faint">{`${visible.length}/${templates.length}`}</span>}
      />
      <div className="space-y-2 border-b border-line px-2 py-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-inset px-2 transition-colors focus-within:border-line-strong">
          <Search size={13} aria-hidden="true" className="shrink-0 text-faint" />
          <span className="sr-only">Search packages</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search code, name, asset"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-off"
          />
        </label>
        <div className="flex gap-1" role="group" aria-label="Qualification filter">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`focus-ring h-6 rounded-[4px] px-2 text-[11px] transition-colors ${
                filter === item.id ? "bg-raised text-ink" : "text-faint hover:text-dim"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid h-6 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[10px] text-off">
        <span>Package</span>
        <span className="text-right">Mark / 24h</span>
      </div>
      <ul tabIndex={0} className="focus-ring scroll-thin min-h-0 flex-1 overflow-y-auto" aria-label="Listed package templates">
        {visible.map((market) => {
          const selected = market.id === marketId;
          return (
            <li key={market.id}>
              <button
                type="button"
                onClick={() => onSelect(market.id)}
                aria-current={selected ? "true" : undefined}
                className={`focus-ring group relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 border-b border-line-soft px-3 py-2 text-left transition-colors duration-150 ${
                  selected ? "bg-raised" : "hover:bg-raised/50"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand transition-opacity duration-200 ${
                    selected ? "opacity-100" : "opacity-0"
                  }`}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone(market.qualification)}`} />
                    <MarketMark underlying={market.underlying} size={14} />
                    <span className="truncate font-mono text-xs text-ink">{market.code}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-dim">{market.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-faint">
                    {`${market.legs.length} legs / ${market.settlementAsset} / ${market.tenorLabel}`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tnum block font-mono text-xs text-ink">{formatPrice(market.netPrice, market)}</span>
                  <Delta value={changePercent(market.netPrice, market.priorNetPrice)} className="text-[11px]" />
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className={`${deskMotion.fade} px-3 py-6 text-center text-xs text-faint`}>No listed package matches.</li>
        ) : null}
      </ul>
    </Panel>
  );
}
