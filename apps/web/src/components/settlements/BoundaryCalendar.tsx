"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { BUTTON_QUIET } from "@/components/activity/ledger-ui";
import { Panel, PanelHead } from "@/components/strategies/desk/Desk";
import { positionHref } from "@/lib/positions/dossier";
import { formatCountdownMs, formatUtcSession, monthLabel } from "@/lib/settlements/calendar";
import type { ScheduleBoundary, SettlementCenter } from "@/lib/settlements/types";
import { formatLots } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
import { OriginChip, ProvenanceChip } from "./trust";
import { MarketMark } from "@/components/portfolio/MarketMark";

function monthStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function addMonths(ms: number, months: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function heldLots(boundary: ScheduleBoundary): number {
  return boundary.held.reduce((total, held) => total + held.lots, 0);
}

function Marker({
  boundary,
  left,
  selected,
  onSelect,
}: {
  boundary: ScheduleBoundary;
  left: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const held = boundary.held.length > 0;
  const conditional = boundary.market.qualification !== "QUALIFIED";
  const fixing = boundary.kind === "FIXING";
  const label = `${boundary.market.code}, ${boundary.label}, ${boundary.timingLabel}${
    held ? `, ${formatLots(heldLots(boundary))} lots held` : ""
  }${conditional ? `, ${boundary.market.qualification.toLowerCase()}` : ""}`;
  return (
    <button
      type="button"
      onClick={() => onSelect(boundary.id)}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      style={{ left }}
      className="focus-ring group absolute top-1/2 z-[2] flex h-7 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm"
    >
      {held && fixing ? (
        <span className="tnum pointer-events-none absolute -top-2.5 left-1/2 -translate-x-1/2 font-mono text-[9.5px] whitespace-nowrap text-brand">
          {formatLots(heldLots(boundary))}
        </span>
      ) : null}
      {fixing ? (
        <span
          className={`block rounded-full transition-transform duration-150 group-hover:scale-125 ${
            held
              ? "h-[11px] w-[11px] border-2 border-brand bg-brand-soft"
              : `h-[9px] w-[9px] border bg-panel ${conditional ? "border-dashed border-dim" : "border-dim"}`
          } ${selected ? "ring-2 ring-ink ring-offset-2 ring-offset-panel" : ""}`}
        />
      ) : (
        <span
          className={`block h-[7px] w-[7px] rotate-45 rounded-[1px] border transition-transform duration-150 group-hover:scale-125 ${
            boundary.state === "WINDOW_OPEN" ? "border-brand bg-brand" : "border-faint bg-panel"
          } ${selected ? "ring-2 ring-ink ring-offset-2 ring-offset-panel" : ""}`}
        />
      )}
    </button>
  );
}

function Detail({ boundary, nowMs }: { boundary: ScheduleBoundary; nowMs: number }) {
  const market = boundary.market;
  const remaining = boundary.atMs !== null ? boundary.atMs - nowMs : null;
  return (
    <div key={boundary.id} className="panel-in grid gap-3 border-t border-line px-3 py-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] lg:items-start lg:px-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono text-sm text-ink">
            <MarketMark underlying={market.underlying} size={16} />
            {market.code}
          </span>
          <span className="text-xs text-faint">{boundary.label}</span>
          <ProvenanceChip provenance={boundary.provenance} source={boundary.source} compact />
          {market.qualification !== "QUALIFIED" ? (
            <span className="rounded-[4px] border border-line-strong px-1.5 font-mono text-[10px] leading-[16px] tracking-[0.05em] text-dim uppercase">
              {market.qualification.toLowerCase()}
            </span>
          ) : null}
        </div>
        <p className="tnum mt-1 font-mono text-xs text-dim">
          {boundary.timingLabel}
          {remaining !== null ? <span className="text-faint">{remaining > 0 ? `  ·  in ${formatCountdownMs(remaining)}` : "  ·  passed"}</span> : null}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-faint">
          {boundary.kind === "FIXING"
            ? `${market.fixingSource}. The fixing window opens ${boundary.windowOpensMs !== null ? formatUtcSession(boundary.windowOpensMs) : "ahead of expiry"} and closes at expiry. Settles in cash ${market.settlementAsset}.`
            : boundary.kind === "LAST_TRADE"
              ? `The ${market.code} book stops clearing. ${boundary.source}.`
              : `The long elects on its fixed lots in this window. ${boundary.source}.`}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Held exposure</p>
        {boundary.held.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {boundary.held.map((held) => (
              <li key={held.positionId}>
                <Link
                  href={positionHref(held.positionId)}
                  className="focus-ring group flex items-center gap-2 rounded-sm text-xs text-ink hover:text-brand"
                >
                  <OriginChip origin={held.origin} />
                  <span className="tnum font-mono">{`${held.side === "LONG" ? "+" : "-"}${formatLots(held.lots)} lots`}</span>
                  <span className="truncate text-faint group-hover:text-brand">{held.label}</span>
                  <ArrowUpRight size={11} aria-hidden="true" className="shrink-0 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-faint">No position in this series.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <Link href={tradeHref(market)} className={BUTTON_QUIET}>
          Open market
          <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Every listed maturity on one time axis, one row per underlying family. Held
 * series are ringed with their size and carry their last trade and election
 * boundaries, and the platform clock runs as the vertical rule.
 */
export type CalendarHorizon = "3M" | "6M" | "ALL";

const HORIZON_MONTHS: Record<CalendarHorizon, number | null> = { "3M": 3, "6M": 6, ALL: null };

export function BoundaryCalendar({
  center,
  selectedId,
  onSelect,
  className = "",
}: {
  center: SettlementCenter;
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const [horizon, setHorizon] = useState<CalendarHorizon>("ALL");
  const { nowMs } = center;
  const dated = center.boundaries.filter((boundary) => boundary.atMs !== null);
  const lastMs = Math.max(nowMs, ...dated.map((boundary) => boundary.atMs ?? nowMs));
  const startMs = monthStart(nowMs);
  const fullEndMs = addMonths(monthStart(lastMs), 1);
  const horizonMonths = HORIZON_MONTHS[horizon];
  const endMs = horizonMonths === null ? fullEndMs : Math.min(fullEndMs, addMonths(startMs, horizonMonths + 1));
  const visible = (ms: number | null) => ms !== null && ms >= startMs && ms < endMs;
  const span = endMs - startMs;
  const at = (ms: number) => `${((ms - startMs) / span) * 100}%`;
  const months: number[] = [];
  for (let cursor = startMs; cursor < endMs; cursor = addMonths(cursor, 1)) months.push(cursor);
  const selected =
    center.boundaries.find((boundary) => boundary.id === selectedId) ??
    center.kpis.nextHeldFixing ??
    center.kpis.nextFixing ??
    null;

  return (
    <Panel label="Fixing and expiry calendar" className={className}>
      <PanelHead
        title="Fixing calendar"
        tools={
          <span className="flex items-center gap-3 text-[11px] text-faint">
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <span className="h-[9px] w-[9px] rounded-full border-2 border-brand bg-brand-soft" aria-hidden="true" />
              held
            </span>
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <span className="h-[8px] w-[8px] rounded-full border border-dashed border-dim" aria-hidden="true" />
              conditional
            </span>
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <span className="h-[7px] w-[7px] rotate-45 rounded-[1px] border border-faint" aria-hidden="true" />
              last trade, election
            </span>
            <span role="radiogroup" aria-label="Calendar horizon" className="flex rounded-md border border-line bg-inset p-0.5">
              {(Object.keys(HORIZON_MONTHS) as CalendarHorizon[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={horizon === option}
                  onClick={() => setHorizon(option)}
                  className={`focus-ring tnum h-6 rounded-[4px] px-2 font-mono text-[10.5px] transition-colors ${
                    horizon === option ? "bg-raised text-ink" : "text-faint hover:text-dim"
                  }`}
                >
                  {option === "ALL" ? "All" : option}
                </button>
              ))}
            </span>
          </span>
        }
      />
      <div className="scroll-thin overflow-x-auto">
        <div className="min-w-[880px] px-3 pt-2 pb-6 lg:min-w-[760px] lg:px-4">
          <div className="grid grid-cols-[132px_minmax(0,1fr)] items-end">
            <span className="sticky left-0 z-[3] self-stretch bg-panel pt-2 pb-1 text-[11px] text-faint">Family</span>
            <div className="relative h-6">
              {months.map((month, index) => (
                <span
                  key={month}
                  className={`tnum absolute bottom-1 font-mono text-[10.5px] ${index === 0 || new Date(month).getUTCMonth() === 0 ? "text-dim" : "text-faint"}`}
                  style={{ left: `calc(${at(month)} + 4px)` }}
                >
                  {index === 0 || new Date(month).getUTCMonth() === 0 ? monthLabel(month) : monthLabel(month).slice(0, 3)}
                </span>
              ))}
            </div>
          </div>
          <div className="relative grid grid-cols-[132px_minmax(0,1fr)]">
            <div className="sticky left-0 z-[3] flex flex-col bg-panel shadow-[8px_0_8px_-8px_rgba(0,0,0,0.6)] lg:shadow-none">
              {center.families.map((family) => (
                <div key={family.id} className="flex h-11 min-w-0 items-center gap-2 border-t border-line-soft pr-2">
                  <MarketMark underlying={family.underlying} size={16} />
                  <span className="flex min-w-0 flex-col justify-center">
                    <span className="truncate text-xs text-ink">{family.label}</span>
                    <span className="truncate font-mono text-[10.5px] text-faint">{family.underlying}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="relative">
              {months.map((month) => (
                <span key={month} aria-hidden="true" className="absolute inset-y-0 w-px bg-line-soft" style={{ left: at(month) }} />
              ))}
              {center.families.map((family) => (
                <div key={family.id} className="relative h-11 border-t border-line-soft">
                  <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line" />
                  {center.boundaries
                    .filter((boundary) => boundary.family === family.id && visible(boundary.atMs))
                    .map((boundary) => (
                      <Marker
                        key={boundary.id}
                        boundary={boundary}
                        left={at(boundary.atMs ?? nowMs)}
                        selected={selected?.id === boundary.id}
                        onSelect={onSelect}
                      />
                    ))}
                </div>
              ))}
              <span aria-hidden="true" className="absolute inset-y-0 z-[1] w-px bg-brand/70" style={{ left: at(nowMs) }} />
              <span
                className="tnum absolute -bottom-[18px] z-[1] -translate-x-1/2 rounded-[3px] bg-brand px-1 font-mono text-[9.5px] leading-[14px] font-medium text-app"
                style={{ left: at(nowMs) }}
              >
                Now
              </span>
            </div>
          </div>
        </div>
      </div>
      {selected ? <Detail boundary={selected} nowMs={nowMs} /> : null}
    </Panel>
  );
}
