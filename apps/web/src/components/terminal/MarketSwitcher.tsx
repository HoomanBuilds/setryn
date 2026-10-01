"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { UnderlyingIcon } from "@/components/icons/AssetIcon";
import { Delta } from "@/components/terminal/primitives";
import { changePercent, formatPrice, priceUnitSuffix } from "@/lib/terminal/format";
import { useMarketBoard } from "@/components/market-data/MarketDataProvider";
import type { PackageMarket } from "@/lib/terminal/types";

function matches(market: PackageMarket, query: string): boolean {
  const haystack = `${market.name} ${market.code} ${market.tenorLabel} ${market.underlying} ${market.strategyLabel}`;
  return haystack.toLowerCase().includes(query);
}

export function MarketSwitcher({
  market,
  onSelect,
}: {
  market: PackageMarket;
  onSelect: (market: PackageMarket) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const { markets } = useMarketBoard();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? markets.filter((candidate) => matches(candidate, needle)) : markets;
  }, [markets, query]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus();
  }, []);

  const openMenu = () => {
    setQuery("");
    setActive(Math.max(0, markets.findIndex((candidate) => candidate.id === market.id)));
    setOpen(true);
  };

  const choose = (next: PackageMarket) => {
    if (next.id !== market.id) onSelect(next);
    close(true);
  };

  /* Keeps the keyboard cursor inside the scroll viewport as it walks the list. */
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${baseId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, baseId]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      close(event.key === "Escape");
      return;
    }
    if (visible.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : visible.length - 1;
      setActive((index) => (index + step) % visible.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : visible.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(visible[active] ?? visible[0]);
    }
  };

  return (
    <div className="relative min-w-0 shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`focus-ring flex h-11 max-w-[210px] min-w-0 items-center gap-2 rounded-md border px-2.5 text-left transition-colors lg:h-9 lg:max-w-[340px] ${
          open
            ? "border-brand-edge bg-raised"
            : "border-line bg-raised hover:border-line-strong"
        }`}
      >
        <UnderlyingIcon underlying={market.underlying} size={18} />
        <span className="flex min-w-0 flex-col items-start lg:flex-row lg:items-baseline lg:gap-2">
          <span className="w-full truncate text-sm font-medium text-ink lg:w-auto lg:min-w-0">
            {market.name}
          </span>
          <span className="tnum w-full truncate font-mono text-xs text-faint lg:w-auto lg:shrink-0">
            {market.code}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close market list"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => close(false)}
          />
          <div
            onKeyDown={onKeyDown}
            className="absolute top-full left-0 z-50 mt-1.5 w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-lg border border-line-strong bg-panel shadow-[0_24px_48px_rgba(0,0,0,0.55)]"
          >
            <div className="relative border-b border-line p-2">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
              />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                placeholder="Search markets"
                aria-label="Search package markets"
                role="combobox"
                aria-expanded={open}
                aria-controls={`${baseId}-listbox`}
                aria-activedescendant={
                  visible.length > 0 ? `${baseId}-option-${active}` : undefined
                }
                aria-autocomplete="list"
                className="focus-ring h-9 w-full rounded-sm border border-line bg-inset pr-2 pl-7 text-sm text-ink placeholder:text-off"
              />
            </div>

            <div
              id={`${baseId}-listbox`}
              role="listbox"
              aria-label="Package markets"
              className="scroll-thin max-h-[286px] overflow-y-auto"
            >
              {visible.length === 0 ? (
                <p className="px-3 py-5 text-center text-xs text-faint">
                  {`No package market matches "${query.trim()}"`}
                </p>
              ) : (
                visible.map((candidate, index) => {
                  const selected = candidate.id === market.id;
                  const cursored = index === active;
                  return (
                    <button
                      key={candidate.id}
                      id={`${baseId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(candidate)}
                      className={`relative flex w-full items-center justify-between gap-3 border-l-2 py-2 pr-3 pl-2.5 text-left transition-colors ${
                        selected ? "border-brand" : "border-transparent"
                      } ${cursored ? "bg-raised" : ""}`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="flex w-[30px] shrink-0 justify-start">
                          <UnderlyingIcon underlying={candidate.underlying} size={20} />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span
                            className={`truncate text-sm ${selected ? "text-ink" : "text-dim"}`}
                          >
                            {candidate.name}
                          </span>
                          <span className="tnum truncate font-mono text-xs text-off">
                            {candidate.code}
                          </span>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        <span className="tnum font-mono text-sm text-ink">
                          {formatPrice(candidate.netPrice, candidate)}
                          <span className="ml-1 text-xs text-faint">
                            {priceUnitSuffix(candidate.priceUnit)}
                          </span>
                        </span>
                        <span className="flex items-baseline gap-2">
                          <span className="text-xs text-off">{candidate.tenorLabel}</span>
                          {candidate.markSource === "REFERENCE" ? (
                            <span className="text-xs text-off" title="Marked at the Chainlink reference: no book or trades yet">
                              Reference
                            </span>
                          ) : (
                            <Delta
                              value={changePercent(candidate.netPrice, candidate.priorNetPrice)}
                              className="text-xs"
                            />
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
