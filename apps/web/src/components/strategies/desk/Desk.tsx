"use client";

import {
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Minus, Plus } from "lucide-react";
import styles from "./desk.module.css";

/**
 * Desk kit shared by the builder, maker and operations pages. It mirrors the
 * redesigned terminal: rounded panels on a 4px gutter, 40px headers with lime
 * underline tabs, dense mono numbers and hairlines.
 */

export const deskMotion = styles;

type Tone = "neutral" | "dim" | "brand" | "up" | "down";

const TEXT_TONE: Record<Tone, string> = {
  neutral: "text-ink",
  dim: "text-dim",
  brand: "text-brand",
  up: "text-up",
  down: "text-down",
};

export function textTone(tone: Tone): string {
  return TEXT_TONE[tone];
}

export function signTone(value: number): Tone {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "dim";
}

/** Compact signed figure for charts and dense grids: +12.3k, -1.20M, +480. */
export function compact(value: number, signed = false): string {
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1_000_000) body = `${(abs / 1_000_000).toFixed(2)}M`;
  else if (abs >= 10_000) body = `${(abs / 1_000).toFixed(1)}k`;
  else if (abs >= 1_000) body = `${(abs / 1_000).toFixed(2)}k`;
  else body = abs.toFixed(0);
  return `${sign}${body}`;
}

export function Panel({
  children,
  className = "",
  label,
  delay = 0,
  id,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  /** Mount stagger in milliseconds. */
  delay?: number;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className={`${styles.rise} flex min-w-0 flex-col rounded-lg border border-line bg-panel ${className}`}
      style={{ "--rise-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </section>
  );
}

/** A panel header. A lone title reads as the single selected tab. */
export function PanelHead({
  title,
  tabs,
  tools,
  className = "",
}: {
  title?: ReactNode;
  tabs?: ReactNode;
  tools?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-10 shrink-0 items-stretch gap-3 border-b border-line pr-3 ${tabs ? "pl-0" : "pl-3"} ${className}`}
    >
      {tabs ?? (
        <h2 className="relative flex min-w-0 items-center truncate text-[13px] font-medium text-ink">
          {title}
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand" />
        </h2>
      )}
      {tools ? (
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">{tools}</div>
      ) : null}
    </div>
  );
}

export interface DeskTab {
  id: string;
  label: string;
  badge?: number | string;
  badgeTone?: Tone;
}

export function DeskTabs({
  items,
  value,
  onChange,
  idBase,
  className = "",
}: {
  items: DeskTab[];
  value: string;
  onChange: (id: string) => void;
  idBase: string;
  className?: string;
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
      className={`no-scrollbar flex min-w-0 items-stretch overflow-x-auto ${className}`}
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
            aria-controls={`${idBase}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={`focus-ring relative inline-flex shrink-0 items-center gap-1.5 px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
              selected ? "text-ink" : "text-faint hover:text-dim"
            }`}
          >
            {item.label}
            {item.badge !== undefined && item.badge !== 0 ? (
              <span
                className={`tnum rounded-[3px] px-1 font-mono text-[10px] leading-4 ${
                  item.badgeTone && item.badgeTone !== "neutral"
                    ? `${TEXT_TONE[item.badgeTone]} bg-raised`
                    : "bg-raised text-dim"
                }`}
              >
                {item.badge}
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className={`absolute inset-x-3 bottom-0 h-0.5 origin-center rounded-full bg-brand transition-transform duration-200 ease-out ${
                selected ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

const CHIP_TONE: Record<Tone, string> = {
  neutral: "border-line-strong text-faint",
  dim: "border-line bg-raised text-dim",
  brand: "border-brand-edge/50 bg-brand-soft text-brand",
  up: "border-up/25 bg-up-soft text-up",
  down: "border-down/25 bg-down-soft text-down",
};

/** Small provenance or state chip, e.g. SIMULATED, MODELED, browser fixture. */
export function Chip({
  children,
  tone = "neutral",
  title,
  dot = false,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] border px-1.5 font-mono text-[10px] leading-none tracking-[0.05em] whitespace-nowrap uppercase ${CHIP_TONE[tone]} ${className}`}
    >
      {dot ? <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-ink text-ink",
  dim: "bg-dim text-dim",
  brand: "bg-brand text-brand",
  up: "bg-up text-up",
  down: "bg-down text-down",
};

export function LiveDot({ tone = "up", live = false }: { tone?: Tone; live?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${DOT_TONE[tone]} ${live ? styles.pulse : ""}`}
    />
  );
}

const FILL_TONE: Record<Tone, string> = {
  neutral: "bg-ink/70",
  dim: "bg-dim/70",
  brand: "bg-brand",
  up: "bg-up",
  down: "bg-down",
};

/** Thin utilisation meter with an optional limit tick. Value and limit are fractions. */
export function Meter({
  value,
  tone = "up",
  limit,
  label,
  className = "",
  height = "h-1",
}: {
  value: number;
  tone?: Tone;
  limit?: number;
  label: string;
  className?: string;
  height?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={`relative w-full rounded-full bg-line ${height} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out ${FILL_TONE[tone]}`}
        style={{ width: `${clamped * 100}%` }}
      />
      {limit !== undefined ? (
        <span
          aria-hidden="true"
          className="absolute -top-[3px] -bottom-[3px] w-px bg-ink/60"
          style={{ left: `${Math.max(0, Math.min(1, limit)) * 100}%` }}
        />
      ) : null}
    </div>
  );
}

/** Dense metric tile: label, mono value, optional note and trailing visual. */
export function Metric({
  label,
  value,
  note,
  tone = "neutral",
  children,
  className = "",
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={`min-w-0 px-3 py-2.5 ${className}`} title={title}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
        <span className="truncate">{label}</span>
      </div>
      <div className={`tnum mt-1 truncate font-mono text-[15px] leading-5 ${TEXT_TONE[tone]}`}>{value}</div>
      {note ? <div className="mt-0.5 truncate text-[11px] text-off">{note}</div> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

/**
 * Wraps a value and tints it briefly whenever it changes. Direction comes from
 * the numeric delta; the span is re-keyed so the CSS animation restarts.
 */
export function Flash({
  value,
  children,
  className = "",
  neutral = false,
}: {
  value: number;
  children: ReactNode;
  className?: string;
  neutral?: boolean;
}) {
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState<0 | 1 | -1>(0);
  const [generation, setGeneration] = useState(0);
  if (previous !== value) {
    setDirection(value > previous ? 1 : -1);
    setPrevious(value);
    setGeneration((current) => current + 1);
  }
  const flash =
    direction === 0
      ? ""
      : neutral
        ? styles.flashNeutral
        : direction > 0
          ? styles.flashUp
          : styles.flashDown;
  return (
    <span key={generation} className={`rounded-[3px] ${flash} ${className}`}>
      {children}
    </span>
  );
}

/** Labelled range with a readout. The fill runs from `origin` to the value. */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  readout,
  origin,
  minLabel,
  maxLabel,
  disabled = false,
  ariaLabel,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  readout: ReactNode;
  origin?: number;
  minLabel?: ReactNode;
  maxLabel?: ReactNode;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const pct = (input: number) => ((input - min) / (max - min || 1)) * 100;
  const anchor = origin ?? min;
  const lo = Math.min(pct(anchor), pct(value));
  const hi = Math.max(pct(anchor), pct(value));
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-dim">{label}</span>
        <span className="tnum font-mono text-ink">{readout}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        className={styles.range}
        style={{ "--lo": `${lo}%`, "--hi": `${hi}%` } as CSSProperties}
      />
      {minLabel || maxLabel ? (
        <div className="flex justify-between font-mono text-[10px] text-off">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Numeric field with step buttons, sized for dense toolbars. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  label,
  suffix,
  disabled = false,
  decimals = 0,
  className = "",
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
  suffix?: string;
  disabled?: boolean;
  decimals?: number;
  className?: string;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Number(next.toFixed(decimals + 2))));
  return (
    <div
      className={`flex h-8 items-stretch overflow-hidden rounded-md border border-line bg-inset transition-colors focus-within:border-line-strong ${
        disabled ? "opacity-60" : "hover:border-line-strong"
      } ${className}`}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
        aria-label={`Decrease ${label}`}
        className="focus-ring grid w-7 shrink-0 place-items-center text-faint transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus size={12} aria-hidden="true" />
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-1 px-1">
        <span className="sr-only">{label}</span>
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(clamp(parsed));
          }}
          className="tnum w-full min-w-0 bg-transparent text-right font-mono text-xs text-ink outline-none disabled:cursor-not-allowed"
        />
        {suffix ? <span className="shrink-0 text-[11px] text-faint">{suffix}</span> : null}
      </label>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step))}
        aria-label={`Increase ${label}`}
        className="focus-ring grid w-7 shrink-0 place-items-center text-faint transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Compact on/off switch for scoped stops and toggles. */
export function Switch({
  checked,
  onChange,
  label,
  tone = "up",
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  tone?: "up" | "down" | "brand";
  disabled?: boolean;
}) {
  const on = tone === "down" ? "bg-down/80" : tone === "brand" ? "bg-brand" : "bg-up/85";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`focus-ring relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? on : "bg-line-strong"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-ink shadow-sm transition-transform duration-200 ease-out ${
          checked ? "translate-x-3" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** Dense label/value row with a hairline, in the ticket style. */
export function Row({
  label,
  value,
  tone = "neutral",
  title,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  title?: string;
  className?: string;
}) {
  return (
    <div
      title={title}
      className={`flex min-h-[26px] items-baseline justify-between gap-4 py-[3px] ${className}`}
    >
      <span className="min-w-0 truncate text-xs text-faint">{label}</span>
      <span className={`tnum shrink-0 text-right font-mono text-xs ${TEXT_TONE[tone]}`}>{value}</span>
    </div>
  );
}

/** Tab body wrapper that fades its content in whenever the key changes. */
export function TabBody({
  children,
  idBase,
  className = "",
}: {
  children: ReactNode;
  idBase: string;
  className?: string;
}) {
  return (
    <div id={`${idBase}-panel`} role="tabpanel" className={`${styles.fade} min-h-0 ${className}`}>
      {children}
    </div>
  );
}

export const TH = "h-8 px-3 text-left text-[11px] font-normal whitespace-nowrap text-faint";
export const TH_NUM = "h-8 px-3 text-right text-[11px] font-normal whitespace-nowrap text-faint";
