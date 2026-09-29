"use client";

import Link from "next/link";
import { Check, CircleAlert, Minus } from "lucide-react";
import { CopyButton, middleTruncate } from "@/components/activity/ledger-ui";
import { Panel, PanelHead } from "@/components/strategies/desk/Desk";
import { ProvenanceChip, ProvenanceLegend } from "@/components/settlements/trust";
import { receiptHref } from "@/lib/positions/dossier";
import type { LifecycleStep, StepStatus } from "@/lib/positions/timeline";
import { LINK_QUIET } from "./parts";

function Node({ status, attention }: { status: StepStatus; attention?: boolean }) {
  if (status === "DONE") {
    return (
      <span className="relative z-[1] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-raised text-ink ring-1 ring-line-strong">
        <Check size={10} strokeWidth={2.75} aria-hidden="true" />
      </span>
    );
  }
  if (status === "CURRENT") {
    return (
      <span className="relative z-[1] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-soft ring-1 ring-brand-edge">
        <span className="live-dot relative h-[6px] w-[6px] rounded-full bg-brand text-brand" />
      </span>
    );
  }
  if (status === "SKIPPED") {
    return (
      <span className="relative z-[1] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-panel text-off ring-1 ring-line">
        <Minus size={10} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={`relative z-[1] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-dashed bg-panel ${
        attention ? "border-brand-edge text-brand" : "border-line-strong text-off"
      }`}
    >
      {attention ? <CircleAlert size={10} aria-hidden="true" /> : null}
    </span>
  );
}

const STATUS_LABEL: Record<StepStatus, string> = {
  DONE: "Recorded",
  CURRENT: "In progress",
  UPCOMING: "Scheduled",
  SKIPPED: "Not applicable",
};

/**
 * The position's life as a single ordered rail. Recorded entries carry their
 * receipt and transaction reference; scheduled entries carry their schedule
 * source and never a value that has not been observed.
 */
export function LifecyclePanel({
  steps,
  stageLabel,
  className = "",
  delay = 0,
}: {
  steps: LifecycleStep[];
  stageLabel: string;
  className?: string;
  delay?: number;
}) {
  const recorded = steps.filter((step) => step.status === "DONE").length;
  return (
    <Panel label="Position lifecycle" className={className} delay={delay}>
      <PanelHead
        title="Lifecycle"
        tools={
          <>
            <span className="hidden text-[11px] text-faint sm:inline">Settlement stage</span>
            <span className="inline-flex h-[18px] items-center rounded-[4px] border border-line-strong px-1.5 font-mono text-[10px] tracking-[0.05em] text-ink uppercase">
              {stageLabel}
            </span>
            <span className="tnum font-mono text-[11px] text-faint">{`${recorded}/${steps.length}`}</span>
          </>
        }
      />
      <ol className="px-3 py-3 lg:px-4">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const next = steps[index + 1];
          const solid = step.status === "DONE" && next !== undefined && next.status !== "UPCOMING";
          return (
            <li
              key={step.id}
              className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 pb-3.5 last:pb-0"
            >
              {!last ? (
                <span
                  aria-hidden="true"
                  className={`absolute top-[20px] bottom-[1px] left-[8.5px] ${
                    solid ? "w-px bg-ink/35" : "w-0 border-l border-dashed border-line-strong"
                  }`}
                />
              ) : null}
              <span className="mt-[1px]">
                <Node status={step.status} attention={step.attention} />
              </span>
              <div
                className={`min-w-0 rounded-md ${step.attention ? "-mx-2 -my-1 bg-brand-soft/40 px-2 py-1 ring-1 ring-brand-edge/30" : ""}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`truncate text-[13px] ${step.status === "UPCOMING" ? "text-dim" : "text-ink"}`}>
                      {step.label}
                    </span>
                    <span className="sr-only">{STATUS_LABEL[step.status]}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tnum font-mono text-[11px] text-faint">{step.atLabel}</span>
                    <ProvenanceChip provenance={step.provenance} compact />
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-faint">{step.detail}</p>
                {step.receiptId || step.transactionHash ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {step.receiptId ? (
                      <Link href={receiptHref(step.receiptId)} className={LINK_QUIET}>
                        Receipt
                        <span className="tnum font-mono text-[11px]">{middleTruncate(step.receiptId, 8, 4)}</span>
                      </Link>
                    ) : null}
                    {step.transactionHash ? (
                      <span className="inline-flex min-w-0 items-center text-[11px] text-faint">
                        <span className="mr-1">tx</span>
                        <span title={step.transactionHash} className="tnum truncate font-mono text-dim">
                          {middleTruncate(step.transactionHash, 8, 6)}
                        </span>
                        <CopyButton value={step.transactionHash} label="transaction reference" size={11} className="h-5 w-5" />
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-auto border-t border-line px-3 py-2 lg:px-4">
        <ProvenanceLegend>
          <span className="ml-auto hidden text-off xl:inline">Success shows only at a reconciled terminal state</span>
        </ProvenanceLegend>
      </div>
    </Panel>
  );
}
