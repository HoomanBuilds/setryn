"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { UnderlyingIcon } from "@/components/icons/AssetIcon";
import { useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { changePercent, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { ALL_ROUTES } from "./routes";

export const COMMAND_OPEN_EVENT = "setryn:command-open";

/** Opens the command search from anywhere, for example a header button. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(COMMAND_OPEN_EVENT));
}

interface Entry {
  id: string;
  section: "Markets" | "Pages" | "Actions";
  label: string;
  detail: string;
  haystack: string;
  run: () => void;
  trailing?: React.ReactNode;
  /** Leading mark, for example a market's underlying. */
  leading?: React.ReactNode;
}

function matches(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

export function CommandPalette() {
  const router = useRouter();
  const gateway = useInternalGateway();
  const { markets } = useMarketBoard();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setActive(0);
        setOpen((value) => !value);
      }
    };
    const onOpen = () => {
      setQuery("");
      setActive(0);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_OPEN_EVENT, onOpen);
    };
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    const marketEntries: Entry[] = markets.map((market) => {
      const change = changePercent(market.netPrice, market.priorNetPrice);
      return {
        id: `market-${market.id}`,
        section: "Markets",
        label: market.name,
        detail: market.id,
        haystack: `${market.id} ${market.name} ${market.underlying} ${market.code}`.toLowerCase(),
        run: go(`/trade/${market.id}`),
        leading: (
          <span className="flex w-7 shrink-0">
            <UnderlyingIcon underlying={market.underlying} size={20} />
          </span>
        ),
        trailing: (
          <span className="flex items-baseline gap-2 font-mono text-xs">
            <span className="tnum text-ink">
              {`${formatNumber(market.netPrice, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`}
            </span>
            <span className={`tnum w-14 text-right ${!Number.isFinite(change) ? "text-off" : change >= 0 ? "text-up" : "text-down"}`}>
              {Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
            </span>
          </span>
        ),
      };
    });
    const pageEntries: Entry[] = ALL_ROUTES.map((route) => ({
      id: `page-${route.id}`,
      section: "Pages",
      label: route.label,
      detail: route.description,
      haystack: `${route.label} ${route.description} ${route.keywords ?? ""} ${route.href}`.toLowerCase(),
      run: go(route.href),
    }));
    const actionEntries: Entry[] = [
      {
        id: "action-connect",
        section: "Actions",
        label: "Connect wallet",
        detail: "Load balances, orders, and positions",
        haystack: "connect wallet sign in account",
        run: () => {
          setOpen(false);
          void gateway.connectWallet().catch(() => undefined);
        },
      },
      {
        id: "action-deposit",
        section: "Actions",
        label: "Deposit collateral",
        detail: "Post collateral to the clearing vault",
        haystack: "deposit collateral fund usdc add",
        run: go("/portfolio/collateral"),
      },
      {
        id: "action-rfq",
        section: "Actions",
        label: "Request private quotes",
        detail: "Open the RFQ builder",
        haystack: "rfq request quote private makers new",
        run: go("/rfqs/new"),
      },
      {
        id: "action-protect",
        section: "Actions",
        label: "Protect an exposure",
        detail: "Hedge a dated cash flow",
        haystack: "hedge protect exposure cash flow",
        run: go("/hedges"),
      },
    ];
    return [...marketEntries, ...actionEntries, ...pageEntries];
  }, [gateway, markets, router]);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // Without a query, show the biggest movers, the actions, and the main pages.
      const movers = entries
        .filter((entry) => entry.section === "Markets")
        .slice(0, 6);
      return [...movers, ...entries.filter((entry) => entry.section === "Actions"), ...entries.filter((entry) => entry.section === "Pages").slice(0, 8)];
    }
    return entries.filter((entry) => matches(entry.haystack, trimmed)).slice(0, 40);
  }, [entries, query]);

  const selected = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (results.length === 0 ? 0 : (Math.min(index, results.length - 1) + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (results.length === 0 ? 0 : (Math.min(index, results.length - 1) - 1 + results.length) % results.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      results[selected]?.run();
    }
  };

  let lastSection: Entry["section"] | null = null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[12vh]" role="presentation">
      <button type="button" aria-label="Close search" className="absolute inset-0 cursor-default bg-black/55" onClick={() => setOpen(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command search"
        className="menu-pop relative w-full max-w-[620px] overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_32px_80px_rgba(0,0,0,0.65)]"
        onKeyDown={onKeyDown}
      >
        <label className="flex h-12 items-center gap-2.5 border-b border-line px-4">
          <Search size={16} aria-hidden="true" className="shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="Search markets, pages, and actions"
            aria-label="Search markets, pages, and actions"
            aria-controls="command-results"
            aria-activedescendant={results[selected] ? `command-${results[selected].id}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-off"
          />
          <kbd className="shrink-0 rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-[10px] text-faint">Esc</kbd>
        </label>
        <div id="command-results" ref={listRef} role="listbox" className="scroll-thin max-h-[min(460px,60vh)] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-faint">{`No match for "${query.trim()}".`}</p>
          ) : (
            results.map((entry, index) => {
              const heading = entry.section !== lastSection ? entry.section : null;
              lastSection = entry.section;
              return (
                <div key={entry.id}>
                  {heading ? (
                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-[0.08em] text-off uppercase">{heading}</div>
                  ) : null}
                  <button
                    type="button"
                    id={`command-${entry.id}`}
                    role="option"
                    aria-selected={index === selected}
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={entry.run}
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                      index === selected ? "bg-raised" : ""
                    }`}
                  >
                    {entry.leading}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{entry.label}</span>
                      <span className="block truncate text-xs text-faint">{entry.detail}</span>
                    </span>
                    {entry.trailing ?? (
                      <ArrowRight
                        size={14}
                        aria-hidden="true"
                        className={`shrink-0 transition-opacity ${index === selected ? "text-dim opacity-100" : "opacity-0"}`}
                      />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-off">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-line bg-inset px-1 font-mono text-[10px]">↑</kbd>
            <kbd className="rounded border border-line bg-inset px-1 font-mono text-[10px]">↓</kbd>
            move
          </span>
          <span className="flex items-center gap-1.5">
            <CornerDownLeft size={11} aria-hidden="true" />
            open
          </span>
          <span className="ml-auto">Live marks from the onchain feed</span>
        </div>
      </div>
    </div>
  );
}
