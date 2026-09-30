"use client";

import { Check } from "lucide-react";

export type RfqStageId = "BUILD" | "INVITE" | "COMPETE" | "PREFLIGHT" | "CLEAR" | "RECEIPT";

export type RfqStageState = "done" | "current" | "upcoming" | "failed";

const STAGES: { id: RfqStageId; label: string }[] = [
  { id: "BUILD", label: "Build" },
  { id: "INVITE", label: "Invite" },
  { id: "COMPETE", label: "Compete" },
  { id: "PREFLIGHT", label: "Preflight" },
  { id: "CLEAR", label: "Clear" },
  { id: "RECEIPT", label: "Receipt" },
];

/** The six visible stages of a private multi-maker RFQ, with the current one lit. */
export function RfqStages({
  states,
  className = "",
}: {
  states: Partial<Record<RfqStageId, RfqStageState>>;
  className?: string;
}) {
  return (
    <ol
      tabIndex={0}
      className={`focus-ring no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto ${className}`}
      aria-label="RFQ stages"
    >
      {STAGES.map((stage, index) => {
        const state = states[stage.id] ?? "upcoming";
        return (
          <li key={stage.id} className="flex shrink-0 items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={`h-px w-3 sm:w-5 ${state === "done" || state === "current" ? "bg-line-strong" : "bg-line"}`}
              />
            ) : null}
            <span
              className={`inline-flex h-6 items-center gap-1.5 rounded-full border pr-2.5 pl-1 text-[11px] transition-colors duration-200 ${
                state === "current"
                  ? "border-brand-edge bg-brand-soft text-ink"
                  : state === "done"
                    ? "border-line-strong text-dim"
                    : state === "failed"
                      ? "border-down/40 bg-down-soft text-down"
                      : "border-line text-faint"
              }`}
            >
              <span
                className={`tnum flex h-4 w-4 items-center justify-center rounded-full font-mono text-[9px] ${
                  state === "current"
                    ? "bg-brand text-app"
                    : state === "done"
                      ? "bg-raised text-up"
                      : state === "failed"
                        ? "bg-down/20 text-down"
                        : "bg-raised text-faint"
                }`}
              >
                {state === "done" ? <Check size={9} strokeWidth={3} aria-hidden="true" /> : index + 1}
              </span>
              {stage.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
