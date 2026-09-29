"use client";

import type { ReactNode } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { CopyButton, middleTruncate, motion } from "./ledger-ui";

export type StepState = "done" | "active" | "pending" | "failed";

export interface TimelineStep {
  id: string;
  label: string;
  detail?: ReactNode;
  hash?: string;
  hashLabel?: string;
  meta?: ReactNode;
  state: StepState;
}

function Node({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className={`flex h-4 w-4 items-center justify-center rounded-full bg-up-soft text-up ring-1 ring-up/40 ${motion.pop}`}>
        <Check size={10} strokeWidth={2.5} aria-hidden="true" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className={`flex h-4 w-4 items-center justify-center rounded-full bg-down-soft text-down ring-1 ring-down/50 ${motion.pop}`}>
        <CircleAlert size={10} aria-hidden="true" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-soft text-brand ring-1 ring-brand-edge">
        <LoaderCircle size={10} aria-hidden="true" className="animate-spin" />
      </span>
    );
  }
  return <span className="h-4 w-4 rounded-full border border-dashed border-line-strong bg-panel" />;
}

/**
 * Vertical execution chronology. Completed steps reveal in order with the rail
 * growing between them, so a fresh receipt reads as a staged progression.
 */
export function StepTimeline({
  steps,
  dense = false,
  className = "",
}: {
  steps: TimelineStep[];
  dense?: boolean;
  className?: string;
}) {
  return (
    <ol className={className}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const next = steps[index + 1];
        const railDone = step.state === "done" && next && next.state !== "pending";
        return (
          <li
            key={step.id}
            style={{ ["--i" as string]: index }}
            className={`relative grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 ${dense ? "pb-2.5" : "pb-3.5"} last:pb-0 ${motion.step}`}
          >
            {!last ? (
              <span
                aria-hidden="true"
                style={{ ["--i" as string]: index }}
                className={`absolute top-[18px] bottom-[2px] left-[7.5px] w-px ${motion.rail} ${
                  railDone ? "bg-up/45" : "bg-line-strong"
                }`}
              />
            ) : null}
            <span className="relative mt-[1px]">
              <Node state={step.state} />
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline justify-between gap-2">
                <span
                  className={`min-w-0 truncate text-xs ${
                    step.state === "pending" ? "text-faint" : step.state === "failed" ? "text-down" : "text-ink"
                  }`}
                >
                  {step.label}
                </span>
                {step.meta ? <span className="tnum shrink-0 font-mono text-[11px] text-faint">{step.meta}</span> : null}
              </span>
              {step.detail ? (
                <span className="mt-0.5 block text-[11px] leading-snug text-faint">{step.detail}</span>
              ) : null}
              {step.hash ? (
                <span className="mt-0.5 flex min-w-0 items-center">
                  <span
                    title={`${step.hashLabel ?? "Reference"}: ${step.hash}`}
                    className="tnum truncate font-mono text-[11px] text-dim"
                  >
                    {middleTruncate(step.hash, 10, 6)}
                  </span>
                  <CopyButton value={step.hash} label={step.hashLabel ?? "reference"} size={11} className="h-5 w-5" />
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
