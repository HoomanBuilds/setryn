"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
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
    <section aria-label="Package handoff" className="border border-line bg-panel">
      <div className="border-b border-line px-3 py-2.5">
        <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">
          Package handoff
        </span>
      </div>
      <div className="space-y-2 p-3">
        {studioReady ? (
          <Link
            href={handoff.studioHref}
            className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-ink transition-colors hover:border-brand-edge"
          >
            Review package in Strategy Studio
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            title={blockReason ?? "Resolve exposure inputs."}
            className="flex h-10 w-full items-center justify-center rounded-md bg-raised px-3 text-sm font-medium text-off"
          >
            Review package in Strategy Studio
          </button>
        )}

        {tradeReady && handoff.tradeHref ? (
          <Link
            href={handoff.tradeHref}
            className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-semibold text-app"
          >
            Open in Trade
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            title={blockReason ?? "No listed market maps to this exposure."}
            className="flex h-10 w-full items-center justify-center rounded-md bg-raised px-3 text-sm font-semibold text-off"
          >
            Open in Trade
          </button>
        )}

        {blockReason && !tradeReady ? (
          <p className="text-xs leading-snug text-faint">{blockReason}</p>
        ) : (
          <p className="text-xs leading-snug text-faint">
            Handoff carries market, direction, and lots as URL parameters only. No order is
            created here and nothing is executed.
          </p>
        )}
      </div>
    </section>
  );
}
