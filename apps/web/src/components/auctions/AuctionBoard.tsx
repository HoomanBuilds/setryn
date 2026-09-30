"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Gavel, Layers, X } from "lucide-react";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import {
  BUTTON_QUIET,
  Kpi,
  KpiStrip,
  PageHeader,
  Panel,
  PanelHeader,
  PanelTitle,
  motion,
} from "@/components/activity/ledger-ui";
import { DeskTabs, Flash } from "@/components/strategies/desk/Desk";
import { ticksToPrice } from "@/lib/auctions/feed";
import { auctionBoard, findAuction, marketOf, nextDeadline, type BatchLane } from "@/lib/auctions/schedule";
import type { AuctionRecord } from "@/lib/auctions/types";
import { formatLots, formatNumber } from "@/lib/terminal/format";
import { packageLabel } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { AuctionDetail } from "./AuctionDetail";
import {
  AuctionStatusChip,
  PhaseClock,
  ProvenanceChip,
  clockText,
  countdownText,
  kindCopy,
  priceText,
  sideCopy,
  signedPrice,
  ticksText,
} from "./board-kit";

const HISTORY_WINDOW_SECONDS = 3_600;

function deadlineCopy(record: AuctionRecord, epoch: number): string {
  const definition = record.version.definition;
  const next = nextDeadline(record, epoch);
  const left = countdownText(next - epoch);
  switch (record.version.status) {
    case "SCHEDULED":
      return `Commit opens in ${left}`;
    case "COMMIT_OPEN":
      return `Commit closes in ${left}`;
    case "REVEAL_OPEN":
      return `Reveal closes in ${left}`;
    case "READY_TO_CLEAR":
      return `Clears in ${left}`;
    case "CLEARED":
      return epoch > definition.settlementDeadline ? "Settlement deadline passed" : `Settles in ${left}`;
    case "SETTLED":
      return `Settled ${clockText(record.keeper.settleAt)}`;
    case "FAILED":
      return record.result ? "Settlement failed" : "No eligible bids";
    case "CANCELLED":
      return "No eligible bids";
    default:
      return "";
  }
}

function live(markets: PackageMarket[], id: string): PackageMarket | null {
  return markets.find((market) => market.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Batch lanes                                                         */
/* ------------------------------------------------------------------ */

const LANE_GRID =
  "lg:grid lg:grid-cols-[minmax(190px,1.1fr)_minmax(130px,0.7fr)_minmax(230px,1.5fr)_84px_minmax(210px,1.25fr)] lg:items-center lg:gap-4";

function LastClear({ lane }: { lane: BatchLane }) {
  const previous = lane.previous;
  const market = marketOf(lane.current);
  if (!previous) return <span className="text-xs text-faint">No cleared round yet</span>;
  if (!previous.result) {
    return <span className="text-xs text-faint">{`${previous.label.split(" ").pop()} cleared nothing`}</span>;
  }
  const definition = previous.version.definition;
  const clearing = ticksToPrice(previous.result.uniformPriceTicks, market);
  const reference = ticksToPrice(previous.referenceTicks, market);
  const residual = definition.totalLots - previous.result.totalAllocatedLots;
  const fill = previous.result.totalAllocatedLots / definition.totalLots;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="tnum font-mono text-sm text-ink">
          <Flash value={previous.result.uniformPriceTicks}>{priceText(clearing, market)}</Flash>
        </span>
        <span className="tnum font-mono text-[11px] text-faint">{`${signedPrice(clearing - reference, market)} vs open`}</span>
      </span>
      <span className="relative h-[3px] overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 rounded-full bg-ink/70" style={{ width: `${fill * 100}%` }} />
      </span>
      <span className="tnum flex justify-between gap-2 font-mono text-[10px] text-faint">
        <span>{`${formatLots(previous.result.totalAllocatedLots)} matched`}</span>
        <span>{`${formatLots(residual)} residual`}</span>
      </span>
    </span>
  );
}

function BatchLanes({
  lanes,
  markets,
  epoch,
  selectedId,
  onSelect,
}: {
  lanes: BatchLane[];
  markets: PackageMarket[];
  epoch: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel className={motion.mount} label="Batch clearing rounds">
      <PanelHeader right={<ProvenanceChip value="MODELED" title="Round cadence scheduled from market fixtures; bids price off the shared preview feed." />}>
        <PanelTitle icon={<Layers size={14} aria-hidden="true" />}>Batch clearing rounds</PanelTitle>
        <span className="hidden text-[11px] text-faint sm:inline">Uniform price, sealed bids, fixed cadence</span>
      </PanelHeader>
      <div className={`hidden border-b border-line px-3 py-1.5 text-[11px] text-faint ${LANE_GRID}`}>
        <span>Market</span>
        <span>Round</span>
        <span>Round clock</span>
        <span className="text-right">Bids</span>
        <span>Last clear</span>
      </div>
      <ul>
        {lanes.map((lane) => {
          const market = marketOf(lane.current);
          const liveMarket = live(markets, market.id);
          const current = lane.current;
          const selected = selectedId === current.id || selectedId === lane.previous?.id;
          return (
            <li key={lane.family.key} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(current.id)}
                aria-pressed={selected}
                className={`focus-ring grid w-full gap-3 px-3 py-3 text-left transition-colors duration-150 ${LANE_GRID} ${
                  selected ? "bg-raised/70 shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-raised/40"
                }`}
              >
                <span className="flex min-w-0 items-start justify-between gap-3 lg:block">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{packageLabel(market)}</span>
                    <span className="tnum block truncate font-mono text-[11px] text-faint">{market.code}</span>
                  </span>
                  <span className="tnum shrink-0 text-right font-mono text-xs text-dim lg:mt-1 lg:block lg:text-left">
                    <span className="text-faint">mark </span>
                    {liveMarket ? <Flash value={liveMarket.netPrice}>{priceText(liveMarket.netPrice, market)}</Flash> : "—"}
                  </span>
                </span>
                <span className="flex items-center gap-2 lg:flex-col lg:items-start lg:gap-1">
                  <span className="tnum font-mono text-xs text-ink">{current.label.split(" ").pop()}</span>
                  <AuctionStatusChip status={current.version.status} />
                </span>
                <span className="min-w-0">
                  <PhaseClock record={current} epoch={epoch} />
                  <span className="tnum mt-1 block font-mono text-[11px] text-dim">
                    {`${deadlineCopy(current, epoch)} · ${sideCopy(current.version.definition.auctionSide).label.toLowerCase()} ${formatLots(current.version.definition.totalLots)}`}
                  </span>
                </span>
                <span className="tnum flex items-baseline gap-2 font-mono text-xs lg:flex-col lg:items-end lg:gap-0">
                  <span className="text-ink">{current.version.commitmentCount}</span>
                  <span className="text-[10px] text-faint">{`${current.version.revealCount} revealed`}</span>
                </span>
                <LastClear lane={lane} />
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Sealed auctions                                                     */
/* ------------------------------------------------------------------ */

const SEALED_GRID =
  "grid grid-cols-[112px_minmax(190px,1.4fr)_104px_72px_minmax(190px,1.3fr)_86px_84px] items-center gap-3";

function SealedAuctions({
  records,
  markets,
  epoch,
  selectedId,
  onSelect,
}: {
  records: AuctionRecord[];
  markets: PackageMarket[];
  epoch: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel className={motion.mount} label="Sealed auctions">
      <PanelHeader right={<ProvenanceChip value="MODELED" title="Scheduled from market fixtures on the shared preview clock." />}>
        <PanelTitle icon={<Gavel size={14} aria-hidden="true" />}>Sealed auctions</PanelTitle>
        <span className="hidden text-[11px] text-faint sm:inline">Commit, reveal, clear</span>
      </PanelHeader>
      <div className="scroll-thin overflow-x-auto">
        <div className="min-w-[900px] max-lg:hidden">
          <div className={`${SEALED_GRID} border-b border-line px-3 py-1.5 text-[11px] text-faint`}>
            <span>State</span>
            <span>Auction</span>
            <span>Side</span>
            <span className="text-right">Size</span>
            <span>Window</span>
            <span className="text-right">Bidders</span>
            <span className="text-right">Bond</span>
          </div>
          <ul>
            {records.map((record, index) => {
              const market = marketOf(record);
              const liveMarket = live(markets, market.id);
              const definition = record.version.definition;
              const side = sideCopy(definition.auctionSide);
              const selected = selectedId === record.id;
              return (
                <li key={record.id} style={{ ["--i" as string]: index }} className={motion.stagger}>
                  <button
                    type="button"
                    onClick={() => onSelect(record.id)}
                    aria-pressed={selected}
                    className={`focus-ring ${SEALED_GRID} w-full border-b border-line px-3 py-2.5 text-left transition-colors duration-150 ${
                      selected ? "bg-raised/70 shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-raised/40"
                    }`}
                  >
                    <span>
                      <AuctionStatusChip status={record.version.status} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-ink">{packageLabel(market)}</span>
                      <span className="tnum block truncate font-mono text-[11px] text-faint">
                        {`${kindCopy(record)} · #${record.label.split("#").pop()}`}
                        {liveMarket ? ` · mark ${priceText(liveMarket.netPrice, market)}` : ""}
                      </span>
                    </span>
                    <span className={`text-xs ${side.className}`}>{side.label}</span>
                    <span className="tnum text-right font-mono text-xs text-ink">{formatLots(definition.totalLots)}</span>
                    <span className="min-w-0">
                      <PhaseClock record={record} epoch={epoch} compact />
                      <span className="tnum mt-1 block truncate font-mono text-[11px] text-dim">{deadlineCopy(record, epoch)}</span>
                    </span>
                    <span className="tnum text-right font-mono text-xs">
                      <span className="text-ink">{record.version.commitmentCount}</span>
                      <span className="text-faint">{` / ${definition.maximumBids}`}</span>
                      <span className="block text-[10px] text-faint">{`${record.version.revealCount} revealed`}</span>
                    </span>
                    <span className="tnum text-right font-mono text-xs text-dim">{formatNumber(definition.requiredBondAmount / 1_000_000, 0)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <ul className="lg:hidden">
          {records.map((record) => {
            const market = marketOf(record);
            const definition = record.version.definition;
            const side = sideCopy(definition.auctionSide);
            return (
              <li key={record.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelect(record.id)}
                  className="focus-ring flex w-full flex-col gap-2 px-3 py-3 text-left hover:bg-raised/40"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink">{packageLabel(market)}</span>
                      <span className="block truncate text-[11px] text-faint">{kindCopy(record)}</span>
                    </span>
                    <AuctionStatusChip status={record.version.status} />
                  </span>
                  <PhaseClock record={record} epoch={epoch} compact />
                  <span className="tnum flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className={side.className}>{`${side.label} ${formatLots(definition.totalLots)}`}</span>
                    <span className="text-dim">{deadlineCopy(record, epoch)}</span>
                    <span className="text-faint">{`${record.version.commitmentCount} bids`}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

type HistoryTab = "ALL" | "BATCH" | "SEALED";

const HISTORY_GRID =
  "grid grid-cols-[72px_minmax(180px,1.3fr)_104px_96px_92px_80px_72px_72px_70px] items-center gap-3";

function History({
  records,
  selectedId,
  onSelect,
}: {
  records: AuctionRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<HistoryTab>("ALL");
  const visible = records.filter((record) =>
    tab === "ALL" ? true : tab === "BATCH" ? record.family.startsWith("batch") : record.family.startsWith("sealed"),
  );
  const count = (predicate: (record: AuctionRecord) => boolean) => records.filter(predicate).length;
  return (
    <Panel className={`flex min-h-[320px] flex-col ${motion.mount}`} label="Auction history">
      <div className="flex h-10 shrink-0 items-stretch justify-between border-b border-line pr-3">
        <DeskTabs
          idBase="auction-history"
          value={tab}
          onChange={(id) => setTab(id as HistoryTab)}
          items={[
            { id: "ALL", label: "History", badge: records.length },
            { id: "BATCH", label: "Batch", badge: count((record) => record.family.startsWith("batch")) },
            { id: "SEALED", label: "Sealed", badge: count((record) => record.family.startsWith("sealed")) },
          ]}
        />
        <span className="flex items-center gap-2">
          <span className="hidden text-[11px] text-faint sm:inline">Last 60 min</span>
          <ProvenanceChip value="MODELED" />
        </span>
      </div>
      <div
        id="auction-history-panel"
        role="tabpanel"
        aria-label="Auction history rounds"
        className="scroll-thin max-h-[420px] min-h-0 flex-1 overflow-auto"
      >
        <div className="min-w-[860px]">
          <div className={`${HISTORY_GRID} sticky top-0 z-[1] border-b border-line bg-panel px-3 py-1.5 text-[11px] text-faint`}>
            <span>Cleared</span>
            <span>Auction</span>
            <span>Kind</span>
            <span>State</span>
            <span className="text-right">Price</span>
            <span className="text-right">vs open</span>
            <span className="text-right">Matched</span>
            <span className="text-right">Residual</span>
            <span className="text-right">Winners</span>
          </div>
          {visible.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-faint">No rounds closed in this window.</p>
          ) : (
            <ul>
              {visible.map((record) => {
                const market = marketOf(record);
                const definition = record.version.definition;
                const result = record.result;
                const delta = result ? ticksToPrice(result.uniformPriceTicks - record.referenceTicks, market) : null;
                const selected = selectedId === record.id;
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(record.id)}
                      aria-pressed={selected}
                      className={`focus-ring ${HISTORY_GRID} w-full border-b border-line px-3 py-2 text-left transition-colors duration-150 ${
                        selected ? "bg-raised/70 shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-raised/40"
                      }`}
                    >
                      <span className="tnum font-mono text-[11px] text-dim">{clockText(record.keeper.clearAt)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-ink">{record.label}</span>
                        <span className={`block text-[10px] ${sideCopy(definition.auctionSide).className}`}>
                          {`${sideCopy(definition.auctionSide).label} ${formatLots(definition.totalLots)}`}
                        </span>
                      </span>
                      <span className="truncate text-[11px] text-dim">{kindCopy(record)}</span>
                      <span>
                        <AuctionStatusChip status={record.version.status} />
                      </span>
                      <span className="tnum text-right font-mono text-xs text-ink">
                        {result ? ticksText(result.uniformPriceTicks, market) : "—"}
                      </span>
                      <span className="tnum text-right font-mono text-[11px] text-faint">
                        {delta !== null ? signedPrice(delta, market) : "—"}
                      </span>
                      <span className="tnum text-right font-mono text-xs text-ink">
                        {result ? formatLots(result.totalAllocatedLots) : "0"}
                      </span>
                      <span className="tnum text-right font-mono text-xs text-dim">
                        {formatLots(definition.totalLots - (result?.totalAllocatedLots ?? 0))}
                      </span>
                      <span className="tnum text-right font-mono text-xs text-dim">
                        {`${result?.winnerCount ?? 0}/${record.version.commitmentCount}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function AuctionBoard() {
  const { markets, previewEpochSeconds: epoch } = usePreviewBoard();
  const board = useMemo(() => auctionBoard(epoch, HISTORY_WINDOW_SECONDS), [epoch]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const defaultRecord =
    board.sealed.find((record) => record.version.status === "COMMIT_OPEN") ?? board.sealed[0] ?? board.lanes[0]?.current ?? null;
  const selected = (selectedId ? findAuction(board, selectedId) : null) ?? defaultRecord;

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const select = (id: string) => {
    setSelectedId(id);
    setSheetOpen(true);
  };

  const liveSealed = board.sealed.filter((record) =>
    ["COMMIT_OPEN", "REVEAL_OPEN", "READY_TO_CLEAR"].includes(record.version.status),
  );
  const scheduled = board.sealed.filter((record) => record.version.status === "SCHEDULED").length;
  const commitments = liveSealed.reduce((sum, record) => sum + record.version.commitmentCount, 0);
  const nextClear = [...board.lanes]
    .map((lane) => ({ lane, at: lane.current.keeper.clearAt }))
    .sort((left, right) => left.at - right.at)[0];
  const batchHistory = board.history.filter((record) => record.family.startsWith("batch") && record.result);
  const matched = batchHistory.reduce((sum, record) => sum + (record.result?.totalAllocatedLots ?? 0), 0);
  const offered = batchHistory.reduce((sum, record) => sum + record.version.definition.totalLots, 0);
  const settled = board.history.filter((record) => record.version.status === "SETTLED").length;
  const failed = board.history.filter((record) => record.version.status === "FAILED").length;
  const cancelled = board.history.filter((record) => record.version.status === "CANCELLED").length;
  const selectedLive = selected ? live(markets, selected.marketId) : null;

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="flex min-h-full flex-col gap-1">
        <PageHeader
          eyebrow={
            <>
              <Gavel size={11} aria-hidden="true" />
              Sealed and batch auctions
            </>
          }
          title="Auction board"
          description="Sealed-bid auctions and uniform-price batch rounds for package markets. Bids stay sealed until reveal, then clear by the contract's ranking rule. This build models the schedule; it does not read the auction contracts."
          right={
            <>
              <ProvenanceChip
                value="MODELED"
                title="The web gateway does not read SealedAuctionHouse or BatchClearingEngine yet. Rounds are scheduled from the market fixtures and bids price off the shared preview feed."
              />
              <span className="inline-flex h-7 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-xs text-dim">
                <span aria-hidden="true" className="live-dot h-1.5 w-1.5 rounded-full bg-brand text-brand" />
                <span className="text-faint">Preview clock</span>
                <span className="tnum font-mono text-ink">{`${clockText(epoch)} UTC`}</span>
              </span>
              <Link href="/solver" className={BUTTON_QUIET}>
                Solver desk
              </Link>
            </>
          }
        >
          <KpiStrip>
            <Kpi
              label="Live sealed auctions"
              value={liveSealed.length}
              tone={liveSealed.length > 0 ? "text-brand" : "text-ink"}
              sub={`${scheduled} scheduled`}
            />
            <Kpi label="Sealed commitments" value={commitments} sub="contents hidden until reveal" />
            <Kpi
              label="Next batch clear"
              value={nextClear ? countdownText(nextClear.at - epoch) : "—"}
              sub={nextClear ? marketOf(nextClear.lane.current).code : "no lanes"}
            />
            <Kpi
              label="Batch matched, 60 min"
              value={`${formatLots(matched)} lots`}
              sub={offered > 0 ? `${Math.round((matched / offered) * 100)}% of ${formatLots(offered)} offered` : "no rounds"}
            />
            <Kpi
              label="Settled, 60 min"
              value={settled}
              tone={settled > 0 ? "text-up" : "text-ink"}
              sub={`${failed} failed · ${cancelled} cancelled`}
            />
          </KpiStrip>
        </PageHeader>

        <div className="grid min-h-0 flex-1 gap-1 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-w-0 flex-col gap-1">
            <BatchLanes
              lanes={board.lanes}
              markets={markets}
              epoch={epoch}
              selectedId={selected?.id ?? null}
              onSelect={select}
            />
            <SealedAuctions
              records={board.sealed}
              markets={markets}
              epoch={epoch}
              selectedId={selected?.id ?? null}
              onSelect={select}
            />
            <History records={board.history} selectedId={selected?.id ?? null} onSelect={select} />
          </div>

          <Panel
            as="aside"
            label="Auction detail"
            className={`hidden min-h-0 flex-col lg:sticky lg:top-0 lg:flex lg:max-h-[calc(100dvh-96px)] ${motion.mount}`}
          >
            <PanelHeader right={selected ? <span className="tnum font-mono text-[11px] text-faint">{selected.marketId}</span> : null}>
              <PanelTitle>Auction detail</PanelTitle>
            </PanelHeader>
            {selected ? (
              <AuctionDetail record={selected} epoch={epoch} liveMarket={selectedLive} />
            ) : (
              <p className="px-4 py-10 text-center text-xs text-faint">Select an auction to inspect its bids and clearing.</p>
            )}
          </Panel>
        </div>
      </div>

      {sheetOpen && selected ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true" aria-label="Auction detail">
          <button
            type="button"
            aria-label="Close auction detail"
            onClick={() => setSheetOpen(false)}
            className={`absolute inset-0 bg-app/70 backdrop-blur-[2px] ${motion.scrim}`}
          />
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
            <AuctionDetail record={selected} epoch={epoch} liveMarket={selectedLive} />
          </div>
        </div>
      ) : null}
    </main>
  );
}
