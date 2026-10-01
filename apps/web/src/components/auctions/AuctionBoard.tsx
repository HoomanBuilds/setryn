"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarX2, Gavel, X } from "lucide-react";
import { BUTTON_QUIET, Kpi, KpiStrip, PageHeader, Panel, PanelHeader, PanelTitle, middleTruncate, motion } from "@/components/activity/ledger-ui";
import { useChainNow, useMarketBoard } from "@/components/market-data/MarketDataProvider";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { LIVE_STATUSES, auctionHouseOf, readAuctions } from "@/lib/auctions/reader";
import type { AuctionRecord } from "@/lib/auctions/types";
import { networkLabel } from "@/lib/operations/deployment";
import { useDeploymentRuntime } from "@/lib/operations/hooks";
import { formatLots } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";
import { AuctionDetail } from "./AuctionDetail";
import { AuctionStatusChip, PhaseClock, ProvenanceChip, countdownText, kindCopy, sideCopy } from "./board-kit";

const POLL_MS = 15_000;

interface AuctionState {
  house: string | null;
  records: AuctionRecord[];
  loading: boolean;
  error: string | null;
}

/** The runtime's auction house and its auctions, re-read on a slow poll. No house means no auctions. */
function useAuctions(): AuctionState {
  const runtime = useDeploymentRuntime();
  const house = auctionHouseOf(runtime.data);
  const [state, setState] = useState<{ records: AuctionRecord[]; loading: boolean; error: string | null }>({ records: [], loading: true, error: null });

  useEffect(() => {
    if (!runtime.data || !house) return;
    const setryn = runtime.data;
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const records = await readAuctions(setryn, house);
        if (active) setState({ records, loading: false, error: null });
      } catch (error) {
        if (active) setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message.split("\n")[0] : "AUCTIONS_UNAVAILABLE" }));
      } finally {
        if (active) timer = window.setTimeout(load, POLL_MS);
      }
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [house, runtime.data]);

  if (!house) return { house: null, records: [], loading: runtime.loading, error: runtime.data ? null : runtime.error };
  return { house, ...state };
}

function marketFor(markets: readonly PackageMarket[], record: AuctionRecord): PackageMarket | null {
  return record.marketId ? (markets.find((market) => market.id === record.marketId) ?? null) : null;
}

function nextDeadline(record: AuctionRecord, now: number): { label: string; at: number } | null {
  const definition = record.version.definition;
  const steps = [
    { label: "Commit opens", at: definition.commitOpensAt },
    { label: "Commit closes", at: definition.commitClosesAt },
    { label: "Reveal closes", at: definition.revealClosesAt },
    { label: "Clear by", at: definition.clearDeadline },
    { label: "Settle by", at: definition.settlementDeadline },
  ];
  return steps.find((step) => step.at > now) ?? null;
}

function AuctionRow({
  record,
  market,
  now,
  selected,
  onSelect,
}: {
  record: AuctionRecord;
  market: PackageMarket | null;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const definition = record.version.definition;
  const side = sideCopy(definition.auctionSide);
  const next = nextDeadline(record, now);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`focus-ring grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(140px,1fr)_auto] items-center gap-3 border-b border-line px-3 py-2.5 text-left transition-colors ${
          selected ? "bg-raised/70 shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-raised/40"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {market ? <MarketMark underlying={market.underlying} size={16} /> : <Gavel size={14} aria-hidden="true" className="text-faint" />}
          <span className="min-w-0">
            <span className="block truncate text-xs text-ink">{market ? market.id : "Package auction"}</span>
            <span className="tnum block truncate font-mono text-[11px] text-faint">{`${middleTruncate(record.id, 8, 4)} v${record.version.version} · ${kindCopy(record)}`}</span>
          </span>
        </span>
        <span className="min-w-0 text-[11px]">
          <span className={`block ${side.className}`}>{`${side.label} ${formatLots(definition.totalLots)} lots`}</span>
          <span className="block text-faint">{`${record.version.commitmentCount} committed / ${record.version.revealCount} revealed`}</span>
        </span>
        <span className="min-w-0">
          <PhaseClock record={record} epoch={now} compact />
          <span className="tnum mt-1 block truncate font-mono text-[10px] text-faint">{next ? `${next.label} in ${countdownText(next.at - now)}` : "All windows passed"}</span>
        </span>
        <AuctionStatusChip status={record.version.status} />
      </button>
    </li>
  );
}

function EmptyBoard({ reason, network }: { reason: "NO_HOUSE" | "NO_AUCTIONS" | "UNAVAILABLE"; network: string }) {
  return (
    <Panel label="Auctions" className={motion.mount}>
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <CalendarX2 size={22} aria-hidden="true" className="text-faint" />
        <p className="mt-3 text-sm text-ink">No auctions scheduled</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">
          {reason === "NO_HOUSE"
            ? `The ${network} deployment does not list a sealed auction house, so there are no auction rounds. Trading runs on the public books and private requests.`
            : reason === "NO_AUCTIONS"
              ? "The auction house has not scheduled any rounds yet. Rounds appear here as soon as they are scheduled onchain."
              : "The auction house could not be read right now. The board retries on its own."}
        </p>
        <div className="mt-4 flex gap-2">
          <Link href="/rfqs" className={BUTTON_QUIET}>
            Request a quote
          </Link>
          <Link href="/solver" className={BUTTON_QUIET}>
            Solver desk
          </Link>
        </div>
      </div>
    </Panel>
  );
}

export function AuctionBoard() {
  const board = useMarketBoard();
  const now = useChainNow();
  const runtime = useDeploymentRuntime();
  const { house, records, loading, error } = useAuctions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const network = networkLabel(runtime.data?.chainId ?? board.snapshot?.chainId ?? null, runtime.data?.network ?? board.snapshot?.network ?? null);

  const keyOf = (record: AuctionRecord) => `${record.id}:${record.version.version}`;
  const live = useMemo(() => records.filter((record) => LIVE_STATUSES.has(record.version.status)), [records]);
  const history = useMemo(() => records.filter((record) => !LIVE_STATUSES.has(record.version.status)), [records]);
  const selected = records.find((record) => keyOf(record) === selectedId) ?? live[0] ?? records[0] ?? null;
  const selectedMarket = selected ? marketFor(board.markets, selected) : null;

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const select = (record: AuctionRecord) => {
    setSelectedId(keyOf(record));
    setSheetOpen(true);
  };

  const commitments = live.reduce((total, record) => total + record.version.commitmentCount, 0);
  const allocated = history.reduce((total, record) => total + (record.result?.totalAllocatedLots ?? 0), 0);
  const offered = history.reduce((total, record) => total + record.version.definition.totalLots, 0);
  const settled = history.filter((record) => record.version.status === "SETTLED").length;
  const failed = history.filter((record) => record.version.status === "FAILED").length;

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="flex min-h-full flex-col gap-1">
        <PageHeader
          eyebrow={
            <>
              <Gavel size={11} aria-hidden="true" />
              Sealed auctions
            </>
          }
          title="Auction board"
          description="Sealed-bid package auctions read from the deployment's auction house. Bids stay sealed until reveal, then clear by the contract's ranking rule."
          right={
            <>
              <ProvenanceChip value="OBSERVED" title="Read from the SealedAuctionHouse named by the network runtime." />
              <span className="inline-flex h-7 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-xs text-dim">
                <span className="text-faint">House</span>
                <span className="tnum font-mono text-ink">{house ? middleTruncate(house, 6, 4) : "Not listed"}</span>
              </span>
              <Link href="/solver" className={BUTTON_QUIET}>
                Solver desk
              </Link>
            </>
          }
        >
          <KpiStrip>
            <Kpi label="Live auctions" value={live.length} tone={live.length > 0 ? "text-brand" : "text-ink"} sub={house ? network : "No auction house"} />
            <Kpi label="Sealed commitments" value={commitments} sub="contents hidden until reveal" />
            <Kpi label="Allocated" value={`${formatLots(allocated)} lots`} sub={offered > 0 ? `${Math.round((allocated / offered) * 100)}% of ${formatLots(offered)} offered` : "no cleared rounds"} />
            <Kpi label="Settled" value={settled} tone={settled > 0 ? "text-up" : "text-ink"} sub={`${failed} failed`} />
          </KpiStrip>
        </PageHeader>

        {!house ? (
          loading ? (
            <Panel label="Auctions" className="px-4 py-10 text-center text-xs text-faint">Reading the network runtime.</Panel>
          ) : (
            <EmptyBoard reason={runtime.data ? "NO_HOUSE" : "UNAVAILABLE"} network={network} />
          )
        ) : records.length === 0 ? (
          loading ? (
            <Panel label="Auctions" className="px-4 py-10 text-center text-xs text-faint">Reading the auction house.</Panel>
          ) : (
            <EmptyBoard reason={error ? "UNAVAILABLE" : "NO_AUCTIONS"} network={network} />
          )
        ) : (
          <div className="grid min-h-0 flex-1 gap-1 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="flex min-w-0 flex-col gap-1">
              {[
                { id: "live", title: "Live and upcoming", rows: live, empty: "No auction is open or scheduled." },
                { id: "history", title: "History", rows: history, empty: "No completed auctions yet." },
              ].map((section) => (
                <Panel key={section.id} label={section.title}>
                  <PanelHeader right={<span className="text-[11px] text-faint">{`${section.rows.length} rounds`}</span>}>
                    <PanelTitle>{section.title}</PanelTitle>
                  </PanelHeader>
                  {section.rows.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-faint">{section.empty}</p>
                  ) : (
                    <ul>
                      {section.rows.map((record) => (
                        <AuctionRow
                          key={keyOf(record)}
                          record={record}
                          market={marketFor(board.markets, record)}
                          now={now}
                          selected={selected !== null && keyOf(selected) === keyOf(record)}
                          onSelect={() => select(record)}
                        />
                      ))}
                    </ul>
                  )}
                </Panel>
              ))}
              {error ? <p className="px-2 text-[11px] text-down">{`Last read failed: ${error}. Showing the previous reading.`}</p> : null}
            </div>

            <Panel as="aside" label="Auction detail" className={`hidden min-h-0 flex-col lg:sticky lg:top-0 lg:flex lg:max-h-[calc(100dvh-96px)] ${motion.mount}`}>
              <PanelHeader right={selected?.marketId ? <span className="tnum font-mono text-[11px] text-faint">{selected.marketId}</span> : null}>
                <PanelTitle>Auction detail</PanelTitle>
              </PanelHeader>
              {selected ? (
                <AuctionDetail record={selected} now={now} market={selectedMarket} />
              ) : (
                <p className="px-4 py-10 text-center text-xs text-faint">Select an auction to inspect its bids and clearing.</p>
              )}
            </Panel>
          </div>
        )}
      </div>

      {sheetOpen && selected ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true" aria-label="Auction detail">
          <button type="button" aria-label="Close auction detail" onClick={() => setSheetOpen(false)} className={`absolute inset-0 bg-app/70 backdrop-blur-[2px] ${motion.scrim}`} />
          <div className={`relative flex max-h-[88dvh] flex-col overflow-hidden rounded-t-xl border-t border-line-strong bg-panel ${motion.sheet}`}>
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
              <span className="text-sm font-medium text-ink">Auction detail</span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close auction detail"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-md text-faint hover:text-ink"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <AuctionDetail record={selected} now={now} market={selectedMarket} />
          </div>
        </div>
      ) : null}
    </main>
  );
}
