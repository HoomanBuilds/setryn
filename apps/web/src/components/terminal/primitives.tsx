"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { Firmness, LiquiditySource, Qualification } from "@/lib/terminal/types";

export const SOURCE_LABEL: Record<LiquiditySource, string> = {
  DIRECT: "Direct",
  IMPLIED: "Implied",
  SOLVER_FIRM: "Solver",
};

export const FIRMNESS_LABEL: Record<Firmness, string> = {
  FIRM: "Firm",
  CAPACITY_BACKED: "Backed",
  INDICATIVE: "Indicative",
};

export const QUALIFICATION_LABEL: Record<Qualification, string> = {
  QUALIFIED: "Qualified",
  CONDITIONAL: "Conditional",
  SUSPENDED: "Suspended",
};

/**
 * Liquidity source stays monochrome: the shape carries the class so the book
 * never spends a colour on provenance.
 */
export function SourceMark({ source }: { source: LiquiditySource }) {
  if (source === "DIRECT") {
    return (
      <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
        <rect x="0.5" y="0.5" width="7" height="7" fill="currentColor" />
      </svg>
    );
  }
  if (source === "IMPLIED") {
    return (
      <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
        <rect x="0.75" y="0.75" width="6.5" height="6.5" fill="none" stroke="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="shrink-0">
      <path d="M4 0.4 L7.6 4 L4 7.6 L0.4 4 Z" fill="currentColor" />
    </svg>
  );
}

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${ok ? "bg-up" : "bg-down"}`}
    />
  );
}

/** Exactly zero is not a gain: it stays neutral so only real moves take colour. */
export function tone(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-dim";
}

export function Delta({ value, className = "" }: { value: number; className?: string }) {
  const positive = value >= 0;
  return (
    <span
      className={`tnum font-mono ${positive ? "text-up" : "text-down"} ${className}`}
    >
      {`${positive ? "+" : "-"}${Math.abs(value).toFixed(2)}%`}
    </span>
  );
}

/** Muted metadata joined by thin separators instead of a row of badges. */
export function MetaLine({ items, className = "" }: { items: ReactNode[]; className?: string }) {
  const visible = items.filter(Boolean);
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint ${className}`}>
      {visible.map((item, index) => (
        <span key={index} className="flex items-center gap-x-2">
          {index > 0 ? (
            <span aria-hidden="true" className="text-off">
              /
            </span>
          ) : null}
          <span>{item}</span>
        </span>
      ))}
    </p>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">{children}</span>
  );
}

export function Field({
  label,
  value,
  align = "right",
  className = "",
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  align?: "left" | "right";
  className?: string;
  title?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`} title={title}>
      <div className="truncate text-xs text-faint">{label}</div>
      <div
        className={`tnum truncate font-mono text-sm text-ink ${align === "right" ? "text-right" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

export function DataRow({
  label,
  value,
  tone = "default",
  title,
  dense = false,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "default" | "up" | "down" | "muted";
  title?: string;
  /** Ticket density: smaller values and tighter rows. */
  dense?: boolean;
}) {
  const valueTone =
    tone === "up"
      ? "text-up"
      : tone === "down"
        ? "text-down"
        : tone === "muted"
          ? "text-dim"
          : "text-ink";
  return (
    <div className={`flex items-baseline justify-between gap-4 ${dense ? "py-[3px]" : "py-[5px]"}`} title={title}>
      <span className={`min-w-0 text-xs ${dense ? "text-faint" : "text-dim"}`}>{label}</span>
      <span className={`tnum shrink-0 font-mono ${dense ? "text-xs" : "text-sm"} ${valueTone}`}>{value}</span>
    </div>
  );
}

export interface TabItem {
  id: string;
  label: string;
  badge?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  idBase,
  className = "",
  grow = false,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  idBase: string;
  className?: string;
  grow?: boolean;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next].id);
    document.getElementById(`${idBase}-tab-${items[next].id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={`flex ${className}`}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={`${idBase}-tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={`focus-ring relative inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap text-sm transition-colors lg:h-9 ${
              grow ? "min-w-0 flex-1 px-1 lg:flex-none lg:shrink-0 lg:px-3" : "shrink-0 px-3"
            } ${selected ? "text-ink" : "text-faint hover:text-dim"}`}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 ? (
              <span className="tnum font-mono text-xs text-off">{item.badge}</span>
            ) : null}
            <span
              aria-hidden="true"
              className={`absolute inset-x-2 bottom-0 h-[2px] rounded-t-sm ${
                selected ? "bg-brand" : "bg-transparent"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  tone = "neutral",
  disabled = false,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  tone?: "neutral" | "direction";
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={`grid gap-1 rounded-md bg-inset p-1 ${disabled ? "opacity-65" : ""}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const directional =
          tone === "direction"
            ? index === 0
              ? "bg-up-soft text-up"
              : "bg-down-soft text-down"
            : "bg-raised text-ink";
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`focus-ring truncate rounded-sm px-2 font-medium transition-colors ${
              size === "sm" ? "h-9 text-xs lg:h-7" : "h-11 text-sm lg:h-8"
            } ${selected ? directional : "text-faint hover:text-dim"} ${disabled ? "cursor-not-allowed" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function CheckRow({
  checked,
  onChange,
  label,
  description,
  icon,
  title,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  icon?: ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={`focus-ring flex w-full items-center gap-2.5 rounded-md px-1 py-2 text-left transition-colors hover:bg-raised ${disabled ? "cursor-not-allowed opacity-65 hover:bg-transparent" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
          checked ? "border-brand bg-brand-soft" : "border-line-strong"
        }`}
      >
        {checked ? <span className="h-[8px] w-[8px] rounded-[1px] bg-brand" /> : null}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm text-ink">
          {icon}
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-snug text-faint">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group border-t border-line" open={defaultOpen}>
      <summary className="focus-ring flex h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs text-dim transition-colors hover:text-ink lg:h-9">
        {summary}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="shrink-0 text-faint transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-28 items-center justify-center px-6 text-center text-sm text-faint">
      {children}
    </div>
  );
}
