"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChartSpline, Rows3, SlidersHorizontal, Star, Table2 } from "lucide-react";
import { UnderlyingIcon } from "@/components/icons/AssetIcon";
import { ExpiryLadder } from "@/components/markets/ExpiryLadder";
import { Highlights } from "@/components/markets/Highlights";
import { MarketsTable } from "@/components/markets/MarketsTable";
import { TermCurve } from "@/components/markets/TermCurve";
import { FilterSelect, SearchField } from "@/components/markets/controls";
import {
  useFavourites,
  useMarketsCategory,
  useMarketsView,
  type ViewId,
} from "@/components/markets/preferences";
import { Chip, LiveDot, motion } from "@/components/markets/ui";
import { SOURCE_LABEL, SourceMark } from "@/components/terminal/primitives";
import { useMarketBoard, useMarketFeed } from "@/components/market-data/MarketDataProvider";
import { changePercent, formatLots, formatUtcStamp } from "@/lib/terminal/format";
import {
  ANY,
  EMPTY_FILTERS,
  applyFilters,
  expiryOptions,
  filtersActive,
  qualificationOptions,
  sourceOptions,
  strategyOptions,
  summarize,
  underlyingOptions,
  type DirectoryFilters,
} from "@/lib/terminal/discovery";

const VIEWS: { id: ViewId; label: string; Icon: typeof Table2 }[] = [
  { id: "table", label: "Table", Icon: Table2 },
  { id: "ladder", label: "Expiry ladder", Icon: Rows3 },
  { id: "curve", label: "Term curve", Icon: ChartSpline },
];

const FAVOURITES = "FAVOURITES";
const ALL = "ALL";

/** Tabs drop the "Dated" prefix every listed package shares; the select keeps the full name. */
function categoryLabel(label: string): string {
  const short = label.replace(/^Dated /i, "");
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function selectedCount(filters: DirectoryFilters): number {
  return [filters.underlying, filters.expiry, filters.qualification, filters.source].filter(
    (value) => value !== ANY,
  ).length;
}

const FEED_CHIP: Record<ReturnType<typeof useMarketFeed>["status"], { label: string; tone: "up" | "muted" | "down" }> = {
  LOADING: { label: "Connecting", tone: "muted" },
  LIVE: { label: "Onchain feed", tone: "up" },
  STALE: { label: "Feed stale", tone: "muted" },
  ERROR: { label: "Chain unavailable", tone: "down" },
};

export function MarketsDirectory() {
  const { markets } = useMarketBoard();
  const feed = useMarketFeed();
  const [view, setView] = useMarketsView();
  const [category, setCategory] = useMarketsCategory();
  const { favourites, toggle } = useFavourites();
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const searchWide = useRef<HTMLInputElement>(null);
  const searchNarrow = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);

  const strategies = useMemo(() => strategyOptions(markets), [markets]);
  /* A stored category that no longer exists reads as All rather than an empty board. */
  const activeCategory =
    category === FAVOURITES || strategies.some((option) => option.value === category)
      ? category
      : ALL;

  /* The category tab is the strategy dimension; favourites narrow on top of it. */
  const effective = useMemo<DirectoryFilters>(
    () => ({
      ...filters,
      strategy: activeCategory === ALL || activeCategory === FAVOURITES ? ANY : activeCategory,
    }),
    [filters, activeCategory],
  );

  const options = useMemo(
    () => ({
      underlying: underlyingOptions(markets),
      expiry: expiryOptions(markets),
      qualification: qualificationOptions(markets),
      source: sourceOptions(markets),
    }),
    [markets],
  );

  const visible = useMemo(() => {
    const filtered = applyFilters(markets, effective);
    return activeCategory === FAVOURITES
      ? filtered.filter((market) => favourites.has(market.id))
      : filtered;
  }, [markets, effective, activeCategory, favourites]);
  const summary = useMemo(() => summarize(visible), [visible]);
  const board = useMemo(() => summarize(markets), [markets]);
  const unmarked = useMemo(() => markets.filter((market) => market.markSource === "NONE").length, [markets]);
  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    markets.forEach((market) => {
      const move = changePercent(market.netPrice, market.priorNetPrice);
      if (move > 0) up += 1;
      else if (move < 0) down += 1;
    });
    return { up, down, flat: markets.length - up - down };
  }, [markets]);
  const dirty = filtersActive(filters);
  const chosen = selectedCount(filters);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      event.preventDefault();
      /* Only one of the two fields is laid out at a time; focus the visible one. */
      const target = [searchWide.current, searchNarrow.current].find(
        (node) => node !== null && node.offsetParent !== null,
      );
      target?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* The table header sticks under the toolbar, whose height changes as filters wrap. */
  useEffect(() => {
    const node = toolbar.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setToolbarHeight(Math.round(entry.target.getBoundingClientRect().height));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const patch = (next: Partial<DirectoryFilters>) =>
    setFilters((current) => ({ ...current, ...next }));

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setCategory(ALL);
  };

  const categories = [
    { id: FAVOURITES, label: "Favourites", count: favourites.size },
    { id: ALL, label: "All", count: markets.length },
    ...strategies.map((option) => ({
      id: option.value,
      label: categoryLabel(option.label),
      count: option.count,
    })),
  ];

  const feedChip = FEED_CHIP[feed.status];

  return (
    <main
      className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app"
      style={{ "--sticky-top": `${toolbarHeight}px` } as CSSProperties}
    >
      <div className="flex flex-col gap-1 pb-1 lg:p-1">
        {/* Title bar: the name echoes the landing serif, the board figures read as a strip. */}
        <header
          className={`${motion.enter} flex flex-col gap-3 px-3 pt-4 pb-3 lg:flex-row lg:items-end lg:gap-6 lg:px-3 lg:pt-3 lg:pb-2`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="font-serif text-[30px] leading-none font-medium tracking-[-0.015em] text-ink lg:text-[32px]">
              Markets
            </h1>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Chip
                tone={feedChip.tone}
                title={
                  feed.status === "ERROR"
                    ? "The chain did not answer: marks show the Chainlink reference and books are unknown."
                    : "One feed for marks, quotes, books, routes, and charts: the onchain book and fills, and Chainlink references."
                }
              >
                {feed.status === "LIVE" ? <LiveDot /> : null}
                {feedChip.label}
              </Chip>
              {feed.asOf > 0 ? (
                <Chip tone="muted" title={`Chain time of the last read, block ${feed.blockNumber.toLocaleString("en-US")}.`}>
                  <span className="tnum font-mono">{`${formatUtcStamp(feed.asOf)} UTC`}</span>
                </Chip>
              ) : null}
              <Chip
                tone="muted"
                title="Every expiry is marked by the versioned capped-forward model from the Chainlink spot. Its volatility, rate and carry inputs are MODELED testnet assumptions, not observed market data."
              >
                Modeled marks
              </Chip>
              {unmarked > 0 ? <Chip tone="muted" title="Markets without a Chainlink spot or model inputs.">{`${unmarked} unmarked`}</Chip> : null}
            </span>
          </div>

          <dl
            tabIndex={0}
            aria-label="Market totals"
            className="focus-ring no-scrollbar -mx-3 flex items-stretch gap-0 overflow-x-auto px-3 lg:mx-0 lg:ml-auto lg:px-0"
          >
            <BoardStat label="Listed" value={String(markets.length)} />
            <BoardStat
              label="Breadth"
              value={
                <span className="flex items-center gap-2">
                  <span className="text-up">{breadth.up}</span>
                  <span
                    aria-hidden="true"
                    className="flex h-1 w-14 overflow-hidden rounded-full bg-line-strong"
                  >
                    <span
                      className="h-full bg-up transition-[width] duration-300 ease-out"
                      style={{ width: `${(breadth.up / Math.max(1, markets.length)) * 100}%` }}
                    />
                    <span
                      className="h-full bg-down transition-[width] duration-300 ease-out"
                      style={{ width: `${(breadth.down / Math.max(1, markets.length)) * 100}%` }}
                    />
                  </span>
                  <span className="text-down">{breadth.down}</span>
                </span>
              }
              title={`${breadth.up} advancing, ${breadth.down} declining, ${breadth.flat} unchanged over 24 hours of fills`}
            />
            <BoardStat label="Firm depth" value={`${formatLots(board.firmDepthLots)} lots`} />
            <BoardStat
              label="Open interest"
              value={Number.isFinite(board.openInterestLots) ? `${formatLots(board.openInterestLots)} lots` : "—"}
            />
            <BoardStat
              label="Qualified"
              value={`${board.qualification.find((entry) => entry.value === "QUALIFIED")?.count ?? 0} / ${markets.length}`}
            />
          </dl>
        </header>

        <div className="px-3 pt-2 md:px-0 md:pt-0">
          <Highlights markets={markets} />
        </div>

        <div
          style={{ animationDelay: "120ms" }}
          className={`${motion.enter} flex min-w-0 flex-col border-y border-line bg-panel md:overflow-clip lg:rounded-lg lg:border`}
        >
          <div ref={toolbar} className="sticky top-0 z-20 border-b border-line bg-panel">
            <div className="flex h-11 items-stretch gap-2 border-b border-line-soft pr-2 lg:h-10 lg:pr-3">
              <CategoryTabs items={categories} value={activeCategory} onChange={setCategory} />
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <SearchField
                  value={filters.query}
                  onChange={(query) => patch({ query })}
                  inputRef={searchWide}
                  className="hidden lg:flex lg:w-[240px]"
                />
                <ViewSwitch value={view} onChange={setView} />
              </div>
            </div>

            <div className="flex flex-col gap-2 px-3 py-2 lg:h-10 lg:flex-row lg:items-center lg:py-0">
              <div className="flex items-center gap-2 lg:hidden">
                <SearchField
                  value={filters.query}
                  onChange={(query) => patch({ query })}
                  inputRef={searchNarrow}
                  className="min-w-0 flex-1"
                />
                <button
                  type="button"
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-expanded={filtersOpen}
                  aria-controls="market-filters"
                  className={`focus-ring flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors ${
                    chosen > 0 ? "border-brand-edge bg-brand-soft text-ink" : "border-line text-dim"
                  }`}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  Filters
                  {chosen > 0 ? <span className="tnum font-mono text-brand">{chosen}</span> : null}
                </button>
              </div>

              <div
                id="market-filters"
                className={`${filtersOpen ? "grid" : "hidden"} grid-cols-2 gap-2 lg:flex lg:items-center lg:gap-1.5`}
              >
                <FilterSelect
                  label="Asset"
                  value={filters.underlying}
                  options={options.underlying}
                  onChange={(underlying) => patch({ underlying })}
                  icon={
                    filters.underlying !== ANY ? <UnderlyingIcon underlying={filters.underlying} size={14} /> : null
                  }
                  className="lg:w-[148px]"
                />
                <FilterSelect
                  label="Expiry"
                  value={filters.expiry}
                  options={options.expiry}
                  onChange={(expiry) => patch({ expiry })}
                  className="lg:w-[150px]"
                />
                <FilterSelect
                  label="Status"
                  value={filters.qualification}
                  options={options.qualification}
                  onChange={(qualification) => patch({ qualification })}
                  className="lg:w-[156px]"
                />
                <FilterSelect
                  label="Source"
                  value={filters.source}
                  options={options.source}
                  onChange={(source) => patch({ source })}
                  className="lg:w-[142px]"
                />
                {dirty ? (
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                    className={`${motion.fade} focus-ring col-span-2 h-11 shrink-0 rounded-md px-2 text-xs text-dim underline-offset-2 transition-colors hover:text-ink hover:underline lg:col-span-1 lg:h-7`}
                  >
                    Reset
                  </button>
                ) : null}
              </div>

              <span className="tnum hidden shrink-0 font-mono text-[11px] text-faint lg:ml-auto lg:block">
                {`${visible.length} of ${markets.length} markets`}
              </span>
            </div>
          </div>

          <div
            id={`markets-view-panel-${view}`}
            role="tabpanel"
            aria-labelledby={`markets-view-tab-${view}`}
            className="min-w-0"
          >
            {visible.length === 0 ? (
              <NoMatches
                filters={filters}
                favouritesOnly={activeCategory === FAVOURITES}
                noFavourites={favourites.size === 0}
                onClear={clearAll}
              />
            ) : view === "table" ? (
              <MarketsTable markets={visible} favourites={favourites} onToggleFavourite={toggle} />
            ) : view === "ladder" ? (
              <ExpiryLadder markets={visible} />
            ) : (
              <TermCurve markets={visible} />
            )}
          </div>

          {visible.length > 0 ? (
            <footer
              tabIndex={0}
              aria-label="Directory summary"
              className="focus-ring no-scrollbar sticky bottom-0 z-10 flex h-8 shrink-0 items-center gap-5 overflow-x-auto border-t border-line bg-panel px-3"
            >
              <Aggregate label="Shown" value={`${visible.length} of ${markets.length}`} />
              <Aggregate label="Firm depth" value={`${formatLots(summary.firmDepthLots)} lots`} />
              <Aggregate
                label="Open interest"
                value={Number.isFinite(summary.openInterestLots) ? `${formatLots(summary.openInterestLots)} lots` : "—"}
              />
              <Aggregate
                label="Status"
                value={summary.qualification.map((entry) => `${entry.label} ${entry.count}`).join(", ")}
              />
              <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap lg:ml-auto">
                <span className="text-[11px] text-faint">Sources</span>
                <span className="flex items-center gap-2.5 text-[11px] text-dim">
                  {summary.sources.map((source) => (
                    <span key={source} className="flex items-center gap-1.5">
                      <span className="text-faint">
                        <SourceMark source={source} />
                      </span>
                      {SOURCE_LABEL[source]}
                    </span>
                  ))}
                </span>
              </span>
            </footer>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function BoardStat({
  label,
  value,
  title,
}: {
  label: string;
  value: ReactNode;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="flex shrink-0 flex-col gap-1 border-l border-line-soft px-4 first:border-l-0 first:pl-0 lg:first:border-l lg:first:pl-4"
    >
      <dt className="text-[11px] whitespace-nowrap text-faint">{label}</dt>
      <dd className="tnum font-mono text-[13px] leading-4 whitespace-nowrap text-ink">{value}</dd>
    </div>
  );
}

/**
 * Underline tabs in the terminal idiom. The underline grows from the centre
 * instead of snapping, and arrow keys move between categories.
 */
function CategoryTabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string; count: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next].id);
    document.getElementById(`markets-category-${items[next].id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Market category"
      onKeyDown={onKeyDown}
      className="no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto pl-1 lg:pl-2"
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={`markets-category-${item.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={`focus-ring relative flex shrink-0 items-center gap-1.5 px-2.5 text-[13px] whitespace-nowrap transition-colors duration-150 ${
              selected ? "text-ink" : "text-faint hover:text-dim"
            }`}
          >
            {item.id === FAVOURITES ? (
              <Star
                size={12}
                aria-hidden="true"
                className={selected ? "text-brand" : ""}
                fill={selected ? "currentColor" : "none"}
              />
            ) : null}
            {item.label}
            <span className={`tnum font-mono text-[10.5px] ${selected ? "text-dim" : "text-off"}`}>
              {item.count}
            </span>
            <span
              aria-hidden="true"
              className={`absolute inset-x-2 bottom-0 h-[2px] origin-center rounded-t-sm bg-brand transition-transform duration-200 ease-out ${
                selected ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

function ViewSwitch({ value, onChange }: { value: ViewId; onChange: (view: ViewId) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = VIEWS.findIndex((item) => item.id === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % VIEWS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + VIEWS.length) % VIEWS.length;
    else return;
    event.preventDefault();
    onChange(VIEWS[next].id);
    document.getElementById(`markets-view-tab-${VIEWS[next].id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Directory view"
      onKeyDown={onKeyDown}
      className="flex h-8 items-center gap-0.5 rounded-md border border-line bg-inset p-0.5 lg:h-7"
    >
      {VIEWS.map(({ id, label, Icon }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            id={`markets-view-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`markets-view-panel-${id}`}
            aria-label={label}
            title={label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={`focus-ring grid h-full w-8 place-items-center rounded-[4px] transition-colors duration-150 lg:w-7 ${
              selected ? "bg-raised text-ink" : "text-faint hover:text-dim"
            }`}
          >
            <Icon size={14} aria-hidden="true" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}

function Aggregate({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="tnum font-mono text-[11px] text-dim">{value}</span>
    </span>
  );
}

function NoMatches({
  filters,
  favouritesOnly,
  noFavourites,
  onClear,
}: {
  filters: DirectoryFilters;
  favouritesOnly: boolean;
  noFavourites: boolean;
  onClear: () => void;
}) {
  if (favouritesOnly && noFavourites) {
    return (
      <div className={`${motion.fade} flex flex-col items-center justify-center gap-3 px-4 py-16 text-center`}>
        <Star size={18} aria-hidden="true" className="text-off" />
        <p className="max-w-[360px] text-sm text-dim">
          No favourites yet. Star a market in the table to pin it here.
        </p>
        <button
          type="button"
          onClick={onClear}
          className="focus-ring h-11 rounded-md border border-line-strong bg-raised px-3.5 text-sm text-ink transition-colors hover:border-brand-edge lg:h-8 lg:text-xs"
        >
          Show all markets
        </button>
      </div>
    );
  }

  const narrowed = [
    favouritesOnly ? "your favourites" : null,
    filters.query.trim() ? `search "${filters.query.trim()}"` : null,
    filters.underlying !== ANY ? `asset ${filters.underlying}` : null,
    filters.expiry !== ANY ? "the selected expiry bucket" : null,
    filters.qualification !== ANY ? "the selected status" : null,
    filters.source !== ANY ? "the selected source class" : null,
  ].filter((item): item is string => item !== null);

  return (
    <div className={`${motion.fade} flex flex-col items-center justify-center gap-3 px-4 py-16 text-center`}>
      <p className="max-w-[420px] text-sm text-dim">
        {narrowed.length > 0
          ? `No listed package market matches ${narrowed.join(", ")}.`
          : "No listed package market in this category."}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="focus-ring h-11 rounded-md border border-line-strong bg-raised px-3.5 text-sm text-ink transition-colors hover:border-brand-edge lg:h-8 lg:text-xs"
      >
        Clear filters
      </button>
    </div>
  );
}
