"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { ExpiryLadder } from "@/components/markets/ExpiryLadder";
import { MarketsTable } from "@/components/markets/MarketsTable";
import { TermCurve } from "@/components/markets/TermCurve";
import { FilterSelect, SearchField } from "@/components/markets/controls";
import { MetaLine, SOURCE_LABEL, SourceMark, Tabs } from "@/components/terminal/primitives";
import { formatLots } from "@/lib/terminal/format";
import {
  ANY,
  EMPTY_FILTERS,
  applyFilters,
  expiryOptions,
  filtersActive,
  observationRange,
  qualificationOptions,
  sourceOptions,
  strategyOptions,
  summarize,
  underlyingOptions,
  type DirectoryFilters,
} from "@/lib/terminal/discovery";
import type { PackageMarket } from "@/lib/terminal/types";

type ViewId = "table" | "ladder" | "curve";

const VIEWS = [
  { id: "table", label: "Table" },
  { id: "ladder", label: "Expiry ladder" },
  { id: "curve", label: "Term curve" },
];

function selectedCount(filters: DirectoryFilters): number {
  return [
    filters.underlying,
    filters.strategy,
    filters.expiry,
    filters.qualification,
    filters.source,
  ].filter((value) => value !== ANY).length;
}

export function MarketsDirectory({ markets }: { markets: PackageMarket[] }) {
  const [view, setView] = useState<ViewId>("table");
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const options = useMemo(
    () => ({
      underlying: underlyingOptions(markets),
      strategy: strategyOptions(markets),
      expiry: expiryOptions(markets),
      qualification: qualificationOptions(markets),
      source: sourceOptions(markets),
    }),
    [markets],
  );

  const visible = useMemo(() => applyFilters(markets, filters), [markets, filters]);
  const summary = useMemo(() => summarize(visible), [visible]);
  const observation = useMemo(() => observationRange(markets), [markets]);
  const dirty = filtersActive(filters);
  const chosen = selectedCount(filters);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const patch = (next: Partial<DirectoryFilters>) =>
    setFilters((current) => ({ ...current, ...next }));

  const provenance = [
    `${visible.length} of ${markets.length} markets`,
    "preview fixture",
    observation.min === observation.max
      ? `observed ${observation.min}s ago`
      : `observed ${observation.min}s to ${observation.max}s ago`,
  ];

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app">
      <div className="shrink-0 border-b border-line bg-panel">
        <div className="flex flex-col lg:h-12 lg:flex-row lg:items-center lg:gap-3 lg:px-4">
          <div className="flex h-12 min-w-0 items-center gap-3 px-3 lg:h-full lg:px-0">
            <h1 className="shrink-0 text-sm font-semibold text-ink lg:text-base">Markets</h1>
            <span className="hidden min-w-0 overflow-hidden xl:block">
              <MetaLine items={provenance} />
            </span>
          </div>

          {/* The bar scrolls inside itself at narrow widths, so a view label is
              always reachable in full and the document never gains a scrollbar. */}
          <div className="no-scrollbar w-full overflow-x-auto border-t border-line lg:ml-auto lg:w-auto lg:overflow-visible lg:border-t-0">
            <Tabs
              items={VIEWS}
              value={view}
              onChange={(id) => setView(id as ViewId)}
              idBase="markets-view"
            />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-line bg-panel px-3 py-2 lg:px-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="flex items-center gap-2 lg:contents">
            <SearchField
              value={filters.query}
              onChange={(query) => patch({ query })}
              inputRef={search}
              className="min-w-0 flex-1 lg:w-[300px] lg:flex-none"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-controls="market-filters"
              className={`focus-ring flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors lg:hidden ${
                chosen > 0 ? "border-brand-edge text-ink" : "border-line text-dim"
              }`}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              Filters
              {chosen > 0 ? <span className="tnum font-mono">{chosen}</span> : null}
            </button>
          </div>

          <div
            id="market-filters"
            className={`${filtersOpen ? "grid" : "hidden"} grid-cols-2 gap-2 lg:contents`}
          >
            <FilterSelect
              label="Asset"
              value={filters.underlying}
              options={options.underlying}
              onChange={(underlying) => patch({ underlying })}
              className="lg:w-[148px]"
            />
            <FilterSelect
              label="Strategy"
              value={filters.strategy}
              options={options.strategy}
              onChange={(strategy) => patch({ strategy })}
              className="lg:w-[190px]"
            />
            <FilterSelect
              label="Expiry"
              value={filters.expiry}
              options={options.expiry}
              onChange={(expiry) => patch({ expiry })}
              className="lg:w-[168px]"
            />
            <FilterSelect
              label="Qualification"
              value={filters.qualification}
              options={options.qualification}
              onChange={(qualification) => patch({ qualification })}
              className="lg:w-[196px]"
            />
            <FilterSelect
              label="Source"
              value={filters.source}
              options={options.source}
              onChange={(source) => patch({ source })}
              className="lg:w-[168px]"
            />
            {dirty ? (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="focus-ring col-span-2 h-11 shrink-0 rounded-md border border-line px-3 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink lg:col-span-1 lg:h-8"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-2 xl:hidden">
          <MetaLine items={provenance} />
        </div>
      </div>

      <div
        id={`markets-view-panel-${view}`}
        role="tabpanel"
        aria-labelledby={`markets-view-tab-${view}`}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {visible.length === 0 ? (
          <NoMatches filters={filters} onClear={() => setFilters(EMPTY_FILTERS)} />
        ) : view === "table" ? (
          <MarketsTable markets={visible} />
        ) : view === "ladder" ? (
          <ExpiryLadder markets={visible} />
        ) : (
          <TermCurve markets={visible} />
        )}
      </div>

      {visible.length > 0 ? (
        <footer className="no-scrollbar flex h-9 shrink-0 items-center gap-5 overflow-x-auto border-t border-line bg-panel px-3 lg:px-4">
          <Aggregate label="Firm depth" value={`${formatLots(summary.firmDepthLots)} lots`} />
          <Aggregate label="Open interest" value={`${formatLots(summary.openInterestLots)} lots`} />
          <Aggregate
            label="Qualification"
            value={summary.qualification.map((entry) => `${entry.label} ${entry.count}`).join(", ")}
          />
          <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="text-xs text-faint">Sources</span>
            <span className="flex items-center gap-2 text-xs text-dim">
              {summary.sources.map((source) => (
                <span key={source} className="flex items-center gap-1.5">
                  <SourceMark source={source} />
                  {SOURCE_LABEL[source]}
                </span>
              ))}
            </span>
          </span>
        </footer>
      ) : null}
    </section>
  );
}

function Aggregate({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
      <span className="text-xs text-faint">{label}</span>
      <span className="tnum font-mono text-xs text-dim">{value}</span>
    </span>
  );
}

function NoMatches({ filters, onClear }: { filters: DirectoryFilters; onClear: () => void }) {
  const narrowed = [
    filters.query.trim() ? `search "${filters.query.trim()}"` : null,
    filters.underlying !== ANY ? `asset ${filters.underlying}` : null,
    filters.strategy !== ANY ? "the selected strategy" : null,
    filters.expiry !== ANY ? "the selected expiry bucket" : null,
    filters.qualification !== ANY ? "the selected qualification" : null,
    filters.source !== ANY ? "the selected source class" : null,
  ].filter((item): item is string => item !== null);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p className="max-w-[420px] text-sm text-dim">
        {`No listed package market matches ${narrowed.join(", ")}.`}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="focus-ring h-11 rounded-md border border-line-strong bg-raised px-3.5 text-sm text-ink transition-colors hover:border-brand-edge lg:h-9"
      >
        Clear filters
      </button>
    </div>
  );
}
