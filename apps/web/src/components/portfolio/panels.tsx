"use client";

import type { ReactNode } from "react";
import { motion } from "@/components/markets/ui";
import type { PositionState } from "@/lib/terminal/types";

export const TH =
  "h-8 px-2.5 text-left align-middle text-[11px] font-normal whitespace-nowrap text-faint first:pl-3 last:pr-3 lg:first:pl-4 lg:last:pr-4";
export const TD = "px-2.5 align-middle text-xs first:pl-3 last:pr-3 lg:first:pl-4 lg:last:pr-4";
export const NUM =
  "tnum px-2.5 text-right align-middle font-mono text-xs whitespace-nowrap first:pl-3 last:pr-3 lg:first:pl-4 lg:last:pr-4";

/** Header cells stick under the view switcher and keep their rule while stuck. */
export const STICKY_HEAD =
  "sticky top-[var(--sticky-top,0px)] z-10 bg-panel shadow-[inset_0_-1px_0_var(--color-line)]";

/**
 * A screen-reader-only caption is absolutely positioned, so without a
 * containing block it resolves against the document, escapes the pane it was
 * written in, and drags the page past the frame it is meant to sit in.
 */
export const TABLE = "relative w-full border-collapse text-left";

/** Dense body row, in the terminal's blotter rhythm. */
export const ROW = "border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/60";

export function Panel({
  title,
  note,
  aside,
  children,
  className = "",
  delay = 0,
}: {
  title: string;
  note?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      style={{ animationDelay: `${delay}ms` }}
      className={`${motion.enter} flex min-h-0 min-w-0 flex-col ${className}`}
    >
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-3 px-3 py-2 lg:px-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="min-w-0 shrink-0 text-[13px] font-medium text-ink">{title}</h2>
          {note ? <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-faint">{note}</span> : null}
        </div>
        {aside ? <span className="flex shrink-0 items-center gap-2">{aside}</span> : null}
      </header>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** One muted track. Concentration is read from the number; the bar only ranks. */
export function ShareBar({ value }: { value: number }) {
  return (
    <span aria-hidden="true" className="block h-[3px] w-full min-w-[32px] overflow-hidden rounded-full bg-line">
      <span
        className="block h-full rounded-full bg-dim transition-[width] duration-300 ease-out"
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
        className={`absolute top-[2px] bottom-[2px] transition-[width] duration-300 ease-out ${
          positive ? "left-1/2 rounded-r-[2px] bg-up/80" : "right-1/2 rounded-l-[2px] bg-down/80"
        }`}
        style={{ width: `${magnitude}%` }}
      />
    </span>
  );
}

const STATE_COPY: Record<PositionState, { label: string; tone: string; dot: string }> = {
  ACTIVE: { label: "Active", tone: "text-dim", dot: "bg-up" },
  FIXING_WINDOW: { label: "Fixing window", tone: "text-brand", dot: "bg-brand" },
  CLOSING: { label: "Closing", tone: "text-ink", dot: "bg-dim" },
};

export function StateTag({ state }: { state: PositionState }) {
  const { label, tone, dot } = STATE_COPY[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${tone}`}>
      <span aria-hidden="true" className={`h-[5px] w-[5px] shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  );
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
      <span className="text-[11px] text-faint">{label}</span>
      <span className={`tnum font-mono text-[11px] ${valueTone}`}>{value}</span>
    </span>
  );
}

/** Closes a plane at the foot of its column, so a short book still reads as bounded. */
export function PlaneFooter({ children }: { children: ReactNode }) {
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label="Panel summary"
      className="focus-ring no-scrollbar flex h-8 shrink-0 items-center gap-5 overflow-x-auto border-t border-line px-3 lg:px-4"
    >
      {children}
    </div>
  );
}

/** Provenance at the foot of a view: a short line, not a paragraph. */
export function PlaneNote({ children, chips }: { children: ReactNode; chips?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2.5 lg:flex-row lg:items-center lg:gap-3 lg:px-4">
      {chips ? <span className="flex shrink-0 flex-wrap items-center gap-1.5">{chips}</span> : null}
      <p className="text-[11px] leading-snug text-faint">{children}</p>
    </div>
  );
}

/** The narrow-width substitute for a table row: one bordered block per record. */
export function StackRow({ children }: { children: ReactNode }) {
  return <li className="flex min-w-0 flex-col gap-2 border-b border-line-soft px-3 py-2.5">{children}</li>;
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
      <span className="truncate text-[11px] text-faint">{label}</span>
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

/** Empty book: a quiet line and the next step, the way an exchange blotter reads. */
export function EmptyBook({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={`${motion.fade} flex flex-col items-center justify-center gap-3 px-4 py-12 text-center`}>
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full border border-line-strong">
        <span className="h-3 w-3 rounded-[3px] border border-faint" />
      </span>
      <p className="text-sm text-dim">{title}</p>
      {children ? <div className="flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}
