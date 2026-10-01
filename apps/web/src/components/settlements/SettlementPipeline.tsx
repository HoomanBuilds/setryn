"use client";

import { Panel, PanelHead } from "@/components/strategies/desk/Desk";
import { SETTLEMENT_STAGES } from "@/lib/settlements/center";
import { STAGE_COPY } from "@/lib/settlements/stages";
import type { SettlementCenter } from "@/lib/settlements/types";
import { ProvenanceLegend } from "./trust";

/**
 * The dated settlement state machine with the open positions counted on it.
 * The main path runs top to bottom; fallback and recovery branches sit
 * indented beside the stage they leave from.
 */
export function SettlementPipeline({ center, className = "" }: { center: SettlementCenter; className?: string }) {
  const total = SETTLEMENT_STAGES.reduce((sum, stage) => sum + center.stages[stage], 0);
  return (
    <Panel label="Settlement state machine" className={className} delay={60}>
      <PanelHead
        title="Settlement path"
        tools={<span className="tnum font-mono text-[11px] text-faint">{`${total} open`}</span>}
      />
      <ol className="px-3 py-2.5 lg:px-4">
        {SETTLEMENT_STAGES.map((stage, index) => {
          const copy = STAGE_COPY[stage];
          const count = center.stages[stage];
          const active = count > 0;
          const nextMain = SETTLEMENT_STAGES.slice(index + 1).some((candidate) => !STAGE_COPY[candidate].branch);
          return (
            <li
              key={stage}
              title={copy.detail}
              className={`relative grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2.5 py-[5px] ${copy.branch ? "pl-4" : ""}`}
            >
              {!copy.branch && nextMain ? (
                <span aria-hidden="true" className="absolute top-[18px] -bottom-[6px] left-[6.5px] w-px bg-line-strong" />
              ) : null}
              {copy.branch ? (
                <span aria-hidden="true" className="absolute top-1/2 left-[7px] w-[18px] border-t border-dashed border-line-strong" />
              ) : null}
              <span className="relative z-[1] flex h-[14px] w-[14px] items-center justify-center">
                <span
                  className={`block rounded-full ${
                    copy.branch
                      ? `h-[7px] w-[7px] border ${active ? "border-down bg-down-soft" : "border-dashed border-line-strong bg-panel"}`
                      : `h-[9px] w-[9px] ${active ? (stage === "RECONCILED" ? "bg-up" : "live-dot relative bg-brand text-brand") : "border border-line-strong bg-panel"}`
                  }`}
                />
              </span>
              <span className={`min-w-0 truncate text-xs ${active ? "text-ink" : copy.branch ? "text-off" : "text-faint"}`}>
                {copy.label}
              </span>
              <span className={`tnum font-mono text-xs ${active ? (copy.branch ? "text-down" : "text-ink") : "text-off"}`}>
                {count}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-auto border-t border-line px-3 py-2.5 lg:px-4">
        <p className="text-[11px] leading-relaxed text-faint">
          Counts cover the account&apos;s open positions. Success is claimed only at Reconciled, never at signature or broadcast.
        </p>
        <ProvenanceLegend className="mt-2" />
      </div>
    </Panel>
  );
}
