"use client";

import Link from "next/link";
import { ArrowUpRight, Info } from "lucide-react";
import { Panel } from "@/components/strategies/desk/Desk";
import type { ExposureValidation, HandoffLinks, HedgeCandidate } from "@/lib/hedges/types";

interface HandoffBarProps {
  candidate: HedgeCandidate | null;
  validation: ExposureValidation;
  handoff: HandoffLinks | null;
}

export function HandoffBar({ candidate, validation, handoff }: HandoffBarProps) {
  const studioReady = candidate !== null && validation.valid && handoff !== null;
  const tradeReady = studioReady && handoff.tradeHref !== null;
  const blockReason = !validation.valid
    ? (validation.reasons[0] ?? "Resolve exposure inputs.")
    : candidate === null
      ? "Select a package candidate."
      : (handoff?.tradeBlockedReason ?? null);

  return (
    <Panel label="Package handoff" delay={200} className="xl:sticky xl:bottom-0 xl:z-10 xl:shadow-[0_-12px_24px_rgba(10,9,13,0.8)]">
      <div className="space-y-2 p-3">
        {tradeReady && handoff.tradeHref ? (
          <Link
            href={handoff.tradeHref}
            className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-semibold text-app transition-[filter] duration-150 hover:brightness-110"
          >
            Open in Trade
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            title={blockReason ?? "No listed market maps to this exposure."}
            className="flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md bg-raised px-3 text-sm font-semibold text-off"
          >
            Open in Trade
          </button>
        )}

        {studioReady ? (
          <Link
            href={handoff.studioHref}
            className="focus-ring flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line-strong px-3 text-[13px] font-medium text-ink transition-colors hover:border-brand-edge hover:bg-raised"
          >
            Review package in Strategy Studio
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            title={blockReason ?? "Resolve exposure inputs."}
            className="flex h-9 w-full cursor-not-allowed items-center justify-center rounded-md border border-line px-3 text-[13px] font-medium text-off"
          >
            Review package in Strategy Studio
          </button>
        )}

        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-faint">
          <Info size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-off" />
          {blockReason && !tradeReady
            ? blockReason
            : "Handoff carries market, direction, and lots as URL parameters only. No order is created here and nothing is executed."}
        </p>
      </div>
    </Panel>
  );
}
