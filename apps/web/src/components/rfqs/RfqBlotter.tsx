"use client";

import { ChevronRight } from "lucide-react";
import { formatLots } from "@/lib/terminal/format";
import {
  Chip,
  TtlBar,
  formatUtcClockTime,
  middleTruncate,
  motion,
  useChangeCount,
} from "@/components/activity/ledger-ui";
import {
  STATUS_LABEL,
  STATUS_TONE,
  priceText,
  signedPriceText,
  type RfqView,
} from "./rfq-view";

const GRID =
  "grid grid-cols-[112px_minmax(170px,1.25fr)_104px_64px_100px_minmax(150px,1fr)_76px_minmax(150px,0.9fr)_78px] items-center";

const HEAD = [
  { label: "State" },
  { label: "Request" },
  { label: "Direction" },
  { label: "Size", right: true },
  { label: "Limit", right: true },
  { label: "Best firm quote", right: true },
  { label: "Makers", right: true },
  { label: "Time to expiry" },
  { label: "Created", right: true },
];

export function StatusChip({ view }: { view: RfqView }) {
  return (
    <Chip tone={STATUS_TONE[view.status]} dot live={view.status === "OPEN"}>
      {STATUS_LABEL[view.status]}
    </Chip>
  );
}

/** Makers who answered, as a count and a small pip per firm quote. */
function MakerPips({ view }: { view: RfqView }) {
  const pips = view.quotes.slice(0, 5);
  return (
    <span className="flex items-center justify-end gap-1.5">
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {pips.map((entry) => (
          <span
            key={entry.quote.id}
            className={`h-2.5 w-[3px] rounded-[1px] ${
              entry.isBest ? "bg-brand" : entry.expired ? "bg-off" : "bg-dim"
            }`}
          />
        ))}
      </span>
      <span className="tnum font-mono text-xs text-ink">{view.quotes.length}</span>
    </span>
  );
}

function BestQuoteCell({ view }: { view: RfqView }) {
  const best = view.best;
  if (!best) {
    return <span className="text-xs text-faint">{view.active ? "Awaiting quotes" : "No firm quotes"}</span>;
  }
  const tone = best.improvement > 0 ? "text-up" : best.improvement < 0 ? "text-down" : "text-faint";
  return (
    <span className="flex min-w-0 flex-col items-end">
      <span className="tnum font-mono text-xs text-ink">
        {priceText(best.quote.packagePrice, view.market)}
      </span>
      <span className={`tnum font-mono text-[11px] ${tone}`}>
        {`${signedPriceText(best.improvement, view.market)} vs limit`}
      </span>
    </span>
  );
}

function ExpiryCell({ view, now }: { view: RfqView; now: number }) {
  if (view.status === "EXECUTED" || view.status === "CANCELLED") {
    return <span className="text-xs text-faint">{view.status === "EXECUTED" ? "Settled" : "Closed"}</span>;
  }
  return (
    <TtlBar
      startMs={view.createdMs}
      endMs={view.expiresMs}
      now={now}
      className="pr-2"
    />
  );
}

function BlotterRow({
  view,
  now,
  index,
  selected,
  onSelect,
}: {
  view: RfqView;
  now: number;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const intent = view.request.authorization.intent;
  const changes = useChangeCount(`${view.status}:${view.request.quotes.length}:${view.request.selectedQuoteId ?? ""}`);
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={() => onSelect(view.request.id)}
      style={{ ["--i" as string]: Math.min(index, 12) }}
      className={`${GRID} ${motion.stagger} ${motion.row} relative min-h-12 cursor-pointer border-b border-line-soft ${
        selected ? `bg-raised ${motion.rowSelected}` : "hover:bg-raised/60"
      }`}
    >
      {changes > 0 ? (
        <span key={changes} aria-hidden="true" className={`pointer-events-none absolute inset-0 ${motion.flash}`} />
      ) : null}
      <span role="cell" className="relative px-3">
        <StatusChip view={view} />
      </span>
      <span role="cell" className="relative min-w-0 px-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(view.request.id);
          }}
          className="focus-ring block max-w-full truncate rounded-sm text-left text-[13px] text-ink"
        >
          {intent.packageCode}
        </button>
        <span title={view.request.id} className="tnum block truncate font-mono text-[11px] text-faint">
          {middleTruncate(view.request.id, 8, 6)}
        </span>
      </span>
      <span role="cell" className="relative min-w-0 px-3 text-xs">
        <span className={view.action === "BUY" ? "text-up" : "text-down"}>
          {`${view.intentLabel} ${view.sideLabel}`}
        </span>
        <span className="block text-[11px] text-faint">{`${view.actionLabel} · private`}</span>
      </span>
      <span role="cell" className="tnum relative px-3 text-right font-mono text-xs text-ink">
        {formatLots(intent.lots)}
      </span>
      <span role="cell" className="tnum relative px-3 text-right font-mono text-xs text-dim">
        {priceText(intent.limitPrice, view.market)}
      </span>
      <span role="cell" className="relative min-w-0 px-3">
        <BestQuoteCell view={view} />
      </span>
      <span role="cell" className="relative px-3">
        <MakerPips view={view} />
      </span>
      <span role="cell" className="relative min-w-0 px-3">
        <ExpiryCell view={view} now={now} />
      </span>
      <span
        role="cell"
        title={new Date(view.createdMs).toISOString()}
        className="tnum relative px-3 text-right font-mono text-xs text-faint"
      >
        {formatUtcClockTime(view.request.createdAt)}
      </span>
    </div>
  );
}

/** Narrow screens: two dense lines per request instead of nine columns. */
function CompactRow({
  view,
  now,
  index,
  selected,
  onSelect,
}: {
  view: RfqView;
  now: number;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const intent = view.request.authorization.intent;
  const changes = useChangeCount(`${view.status}:${view.request.quotes.length}:${view.request.selectedQuoteId ?? ""}`);
  return (
    <li className="relative border-b border-line-soft">
      {changes > 0 ? (
        <span key={changes} aria-hidden="true" className={`pointer-events-none absolute inset-0 ${motion.flash}`} />
      ) : null}
      <button
        type="button"
        onClick={() => onSelect(view.request.id)}
        aria-current={selected || undefined}
        style={{ ["--i" as string]: Math.min(index, 12) }}
        className={`focus-ring relative flex w-full items-center gap-3 px-3 py-2.5 text-left ${motion.stagger} ${motion.row} ${
          selected ? `bg-raised ${motion.rowSelected}` : "active:bg-raised"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <StatusChip view={view} />
            <span className="truncate text-[13px] text-ink">{intent.packageCode}</span>
          </span>
          <span className="mt-1.5 flex items-center gap-2 text-xs">
            <span className={view.action === "BUY" ? "text-up" : "text-down"}>
              {`${view.intentLabel} ${view.sideLabel}`}
            </span>
            <span className="tnum font-mono text-dim">{`${formatLots(intent.lots)} lots`}</span>
            <span className="text-off">/</span>
            <span className="tnum font-mono text-faint">{`lmt ${priceText(intent.limitPrice, view.market, false)}`}</span>
          </span>
        </span>
        <span className="flex w-[132px] shrink-0 flex-col items-end gap-1.5">
          <span className="tnum font-mono text-xs text-ink">
            {view.best ? priceText(view.best.quote.packagePrice, view.market) : `${view.quotes.length} quotes`}
          </span>
          {view.status === "EXECUTED" || view.status === "CANCELLED" ? (
            <span className="text-[11px] text-faint">{formatUtcClockTime(view.request.createdAt)}</span>
          ) : (
            <TtlBar startMs={view.createdMs} endMs={view.expiresMs} now={now} className="w-full" />
          )}
        </span>
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-off" />
      </button>
    </li>
  );
}

export function RfqBlotter({
  views,
  now,
  selectedId,
  onSelect,
  empty,
}: {
  views: RfqView[];
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: React.ReactNode;
}) {
  return (
    <>
      <div className="scroll-thin hidden min-h-0 flex-1 overflow-auto md:block">
        <div role="table" aria-label="Private RFQ requests" className="min-w-[1010px]">
          <div role="rowgroup" className="sticky top-0 z-10 bg-panel">
            <div role="row" className={`${GRID} h-8 border-b border-line text-[11px] text-faint`}>
              {HEAD.map((cell) => (
                <span
                  key={cell.label}
                  role="columnheader"
                  className={`truncate px-3 font-normal ${cell.right ? "text-right" : ""}`}
                >
                  {cell.label}
                </span>
              ))}
            </div>
          </div>
          <div role="rowgroup">
            {views.length === 0
              ? (
                  <div role="row">
                    <div role="cell">{empty}</div>
                  </div>
                )
              : views.map((view, index) => (
                  <BlotterRow
                    key={view.request.id}
                    view={view}
                    now={now}
                    index={index}
                    selected={view.request.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}
          </div>
        </div>
      </div>
      <div className="md:hidden">
        {views.length === 0 ? (
          empty
        ) : (
          <ul aria-label="Private RFQ requests">
            {views.map((view, index) => (
              <CompactRow
                key={view.request.id}
                view={view}
                now={now}
                index={index}
                selected={view.request.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
