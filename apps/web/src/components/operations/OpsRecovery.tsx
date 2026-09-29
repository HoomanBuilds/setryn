"use client";

import { Ban, CheckCircle2 } from "lucide-react";
import { Chip, Panel, PanelHead } from "@/components/strategies/desk/Desk";
import type { OperationsSnapshot } from "@/lib/operations/types";
import { Evidence } from "./OpsTables";
import { stateLabel, stateTone, type Detail } from "./ops-model";

/**
 * Recovery cases as incident cards: boundary, authority and a per-case event
 * timeline, so the permissionless terminal path is visible next to the stop.
 */
export function RecoveryBoard({
  snapshot,
  detail,
  onSelect,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  return (
    <Panel label="Recovery cases" delay={40}>
      <PanelHead title="Recovery cases" tools={<span className="text-[11px] text-faint">Terminal paths remain available</span>} />
      <div className="grid gap-px bg-line lg:grid-cols-2">
        {snapshot.recoveryCases.map((caseItem) => {
          const selected = detail?.kind === "RECOVERY" && detail.id === caseItem.id;
          const tone = stateTone(caseItem.state);
          return (
            <article
              key={caseItem.id}
              className={`relative min-w-0 bg-panel transition-colors duration-150 ${selected ? "bg-raised" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand transition-opacity duration-200 ${selected ? "opacity-100" : "opacity-0"}`}
              />
              <button
                type="button"
                onClick={() => onSelect({ kind: "RECOVERY", id: caseItem.id })}
                aria-pressed={selected}
                className="focus-ring block w-full px-3 pt-3 pb-2 text-left transition-colors duration-150 hover:bg-raised/40"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="tnum block font-mono text-[15px] text-ink">{caseItem.id}</span>
                    <span className="block text-[11px] text-faint">{caseItem.packageCode}</span>
                  </span>
                  <Chip tone={tone === "dim" ? "neutral" : tone} dot>
                    {stateLabel(caseItem.state)}
                  </Chip>
                </span>
                <span className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <span className="min-w-0">
                    <span className="block text-faint">Residual</span>
                    <span className="tnum block truncate font-mono text-dim">{caseItem.residual}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-faint">Deadline</span>
                    <span className="tnum block truncate font-mono text-dim">{caseItem.deadline}</span>
                  </span>
                  <span className="col-span-2 min-w-0">
                    <span className="block text-faint">Risk boundary</span>
                    <span className="block truncate font-mono text-dim">{caseItem.riskBoundary}</span>
                  </span>
                </span>
                <span className="mt-2.5 flex flex-wrap gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] ${
                      caseItem.newRiskBlocked ? "bg-down-soft text-down" : "bg-raised text-dim"
                    }`}
                  >
                    <Ban size={11} aria-hidden="true" />
                    {caseItem.newRiskBlocked ? "New risk stopped" : "New risk permitted"}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] ${
                      caseItem.terminalResolutionPermitted ? "bg-up-soft text-up" : "bg-down-soft text-down"
                    }`}
                  >
                    <CheckCircle2 size={11} aria-hidden="true" />
                    {caseItem.terminalResolutionPermitted ? "Terminal completion permitted" : "Terminal completion unavailable"}
                  </span>
                </span>
              </button>
              <ol className="relative border-t border-line-soft px-3 py-2" aria-label={`${caseItem.id} event timeline`}>
                <span aria-hidden="true" className="absolute top-4 bottom-4 left-[19px] w-px bg-line" />
                {caseItem.events.map((event, index) => (
                  <li key={event.id} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 py-1">
                    <span className="flex justify-center pt-1">
                      <span
                        className={`relative z-[1] h-2 w-2 rounded-full border ${
                          index === caseItem.events.length - 1 ? "border-brand bg-brand" : "border-ink/60 bg-panel"
                        }`}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="tnum font-mono text-[10px] text-faint">{event.at}</span>
                        <span className="text-xs text-ink">{event.label}</span>
                      </span>
                      <span className="block text-[11px] leading-snug text-dim">{event.detail}</span>
                      <span className="mt-1 block">
                        <Evidence value={event.evidence} />
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="border-t border-line-soft px-3 py-1.5 text-[11px] text-faint">
                <span className="text-off">Authority </span>
                {caseItem.writeAuthority}
                <span className="text-off">{` / freshness ${caseItem.freshness.ageLabel}`}</span>
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}
