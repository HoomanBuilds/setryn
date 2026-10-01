"use client";

import { Ban, CheckCircle2 } from "lucide-react";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { Chip, Panel, PanelHead } from "@/components/strategies/desk/Desk";
import { SERIES_EVENT_ACTION, SERIES_EVENT_LABEL, SERIES_PHASE_LABEL, seriesEvents } from "@/lib/operations/deployment";
import type { SeriesRow } from "@/lib/operations/model";
import { formatLots } from "@/lib/terminal/format";
import { countdown, stateTone, utc, type Detail } from "./ops-model";

/**
 * Series in their terminal windows: trading has closed and the fixing, election and settlement deadlines run in order.
 * Each card shows the schedule and the permissionless call that completes it, next to the stop on new risk.
 */
export function TerminalBoard({
  rows,
  now,
  detail,
  onSelect,
}: {
  rows: SeriesRow[];
  now: number;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  return (
    <Panel label="Terminal windows" delay={40}>
      <PanelHead title="Terminal windows" tools={<span className="text-[11px] text-faint">Terminal paths stay permissionless</span>} />
      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-faint">
          No series has reached last trading. Fixing and settlement windows appear here as each expiry approaches.
        </p>
      ) : (
        <div className="grid gap-px bg-line lg:grid-cols-2">
          {rows.map((row) => {
            const active = detail?.kind === "SERIES" && detail.id === row.marketKey;
            const tone = stateTone(row.phase);
            const events = seriesEvents(row.schedule);
            const nextIndex = events.findIndex((event) => event.at >= now);
            return (
              <article key={row.marketKey} className={`relative min-w-0 bg-panel transition-colors duration-150 ${active ? "bg-raised" : ""}`}>
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`}
                />
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "SERIES", id: row.marketKey })}
                  aria-pressed={active}
                  className="focus-ring block w-full px-3 pt-3 pb-2 text-left transition-colors duration-150 hover:bg-raised/40"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <MarketMark underlying={row.underlying} size={18} />
                      <span className="min-w-0">
                        <span className="tnum block font-mono text-[14px] text-ink">{row.marketKey}</span>
                        <span className="block text-[11px] text-faint">{row.name}</span>
                      </span>
                    </span>
                    <Chip tone={tone === "dim" ? "neutral" : tone} dot>
                      {SERIES_PHASE_LABEL[row.phase]}
                    </Chip>
                  </span>
                  <span className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <span className="min-w-0">
                      <span className="block text-faint">Open interest</span>
                      <span className="tnum block truncate font-mono text-dim">{row.openInterestLots !== null ? `${formatLots(row.openInterestLots)} lots` : "Not reported"}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-faint">Next deadline</span>
                      <span className="tnum block truncate font-mono text-dim">
                        {row.next ? `${SERIES_EVENT_LABEL[row.next.kind]} in ${countdown(row.next.at - now)}` : "None ahead"}
                      </span>
                    </span>
                  </span>
                  <span className="mt-2.5 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-[4px] bg-down-soft px-1.5 py-0.5 text-[11px] text-down">
                      <Ban size={11} aria-hidden="true" />
                      New orders closed
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-[4px] bg-up-soft px-1.5 py-0.5 text-[11px] text-up">
                      <CheckCircle2 size={11} aria-hidden="true" />
                      Terminal completion permissionless
                    </span>
                  </span>
                </button>
                {events.length > 0 ? (
                  <ol className="relative border-t border-line-soft px-3 py-2" aria-label={`${row.marketKey} schedule`}>
                    <span aria-hidden="true" className="absolute top-4 bottom-4 left-[19px] w-px bg-line" />
                    {events.map((event, index) => {
                      const passed = event.at < now;
                      const isNext = index === nextIndex;
                      return (
                        <li key={event.kind} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 py-1">
                          <span className="flex justify-center pt-1">
                            <span
                              className={`relative z-[1] h-2 w-2 rounded-full border ${
                                isNext ? "border-brand bg-brand" : passed ? "border-ink/60 bg-ink/60" : "border-ink/40 bg-panel"
                              }`}
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              <span className="tnum font-mono text-[10px] text-faint">{utc(event.at)}</span>
                              <span className={`text-xs ${passed ? "text-dim" : "text-ink"}`}>{SERIES_EVENT_LABEL[event.kind]}</span>
                            </span>
                            <span className="block text-[11px] leading-snug text-faint">{SERIES_EVENT_ACTION[event.kind]}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
