"use client";

import type { ReactNode } from "react";
import { SectionLabel } from "@/components/terminal/primitives";
import type { PositionState } from "@/lib/terminal/types";

export const TH = "h-8 px-2 text-left align-middle text-xs font-normal whitespace-nowrap text-faint";
export const TD = "px-2 align-middle text-xs";
export const NUM = "tnum px-2 text-right align-middle font-mono text-xs whitespace-nowrap";

/**
 * A screen-reader-only caption is absolutely positioned, so without a
 * containing block it resolves against the document, escapes the pane it was
 * written in, and drags the page past the frame it is meant to sit in.
 */
export const TABLE = "relative w-full border-collapse text-left";

export function Panel({
  title,
  note,
  aside,
  children,
  className = "",
}: {
  title: string;
  note?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col ${className}`}>
      <header className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3 py-1.5 lg:h-9 lg:px-4 lg:py-0">
        {/* Side by side only where both fit: below that the note takes its own
            line rather than losing its tail to an ellipsis. */}
        <div className="flex min-w-0 flex-1 flex-col lg:flex-row lg:items-baseline lg:gap-3">
          <h2 className="min-w-0 shrink-0">
            <SectionLabel>{title}</SectionLabel>
          </h2>
          {note ? <span className="truncate text-xs text-off">{note}</span> : null}
        </div>
        {aside ? <span className="shrink-0">{aside}</span> : null}
      </header>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** One muted track. Concentration is read from the number; the bar only ranks. */
export function ShareBar({ value }: { value: number }) {
  return (
    <span aria-hidden="true" className="block h-[3px] w-full min-w-[32px] bg-line-soft">
      <span
        className="block h-full bg-dim"
        style={{ width: `${Math.max(1.5, Math.min(1, value) * 100)}%` }}
      />
    </span>
  );
}

/** Zero is the centre rule, so a negative contribution reads as one on sight. */
export function DivergingBar({ value, scale }: { value: number; scale: number }) {
  const magnitude = scale === 0 ? 0 : Math.min(1, Math.abs(value) / scale) * 50;
  const positive = value >= 0;
  return (
    <span aria-hidden="true" className="relative block h-[10px] w-full min-w-[48px]">
      <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
      <span
        className={`absolute top-[3px] bottom-[3px] ${positive ? "left-1/2 bg-up" : "right-1/2 bg-down"}`}
        style={{ width: `${magnitude}%` }}
      />
    </span>
  );
}

const STATE_COPY: Record<PositionState, { label: string; tone: string }> = {
  ACTIVE: { label: "Active", tone: "text-dim" },
  FIXING_WINDOW: { label: "Fixing window", tone: "text-brand" },
  CLOSING: { label: "Closing", tone: "text-ink" },
};

export function StateTag({ state }: { state: PositionState }) {
  const { label, tone } = STATE_COPY[state];
  return <span className={`whitespace-nowrap text-xs ${tone}`}>{label}</span>;
}

/** A muted figure pair, for the aggregate line at the foot of a plane. */
export function Aggregate({
  label,
  value,
  valueTone = "text-dim",
}: {
  label: string;
  value: string;
  valueTone?: string;
}) {
  return (
    <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
      <span className="text-xs text-faint">{label}</span>
      <span className={`tnum font-mono text-xs ${valueTone}`}>{value}</span>
    </span>
  );
}

/** Closes a plane at the foot of its column, so a short book still reads as bounded. */
export function PlaneFooter({ children }: { children: ReactNode }) {
  return (
    <div className="no-scrollbar mt-auto flex h-9 shrink-0 items-center gap-5 overflow-x-auto border-t border-line bg-panel px-3 lg:px-4">
      {children}
    </div>
  );
}

/** The same foot of the plane, where the close is a sentence rather than figures. */
export function PlaneNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-auto shrink-0 border-t border-line bg-panel px-3 py-2.5 text-xs leading-snug text-faint lg:px-4">
      {children}
    </p>
  );
}

/** The narrow-width substitute for a table row: one bordered block per record. */
export function StackRow({ children }: { children: ReactNode }) {
  return <li className="flex min-w-0 flex-col gap-2 border-b border-line px-3 py-2.5">{children}</li>;
}

/** Label over value. Wrapping a figure never drags its own label out of line. */
export function Figure({
  label,
  value,
  valueTone = "text-dim",
}: {
  label: string;
  value: ReactNode;
  valueTone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-xs text-faint">{label}</span>
      <span className={`tnum truncate font-mono text-xs ${valueTone}`}>{value}</span>
    </div>
  );
}

export function FigureGrid({ cols = 3, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div className={`grid gap-x-3 gap-y-2 ${cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {children}
    </div>
  );
}
