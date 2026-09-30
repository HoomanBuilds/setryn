"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useGatewaySnapshot, useInternalGateway } from "@/components/gateway/InternalGatewayProvider";
import { StatusDot } from "@/components/terminal/primitives";
import motion from "./ledger.module.css";
import { platformNow } from "@/lib/terminal/clock";

export { motion };

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/** A terminal panel: rounded, hairline edged, sitting on the 4px app gutter. */
export function Panel({
  children,
  className = "",
  as: Tag = "section",
  label,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "aside" | "div" | "article";
  label?: string;
}) {
  return (
    <Tag aria-label={label} className={`min-w-0 overflow-hidden rounded-lg border border-line bg-panel ${className}`}>
      {children}
    </Tag>
  );
}

/** 40px panel header: a title or tabs on the left, quiet controls on the right. */
export function PanelHeader({
  children,
  right,
  className = "",
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-3 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function PanelTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
      {icon ? <span className="shrink-0 text-faint">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

export type ChipTone = "neutral" | "brand" | "up" | "down" | "muted" | "ink";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "border-line-strong text-dim",
  brand: "border-brand-edge bg-brand-soft text-brand",
  up: "border-transparent bg-up-soft text-up",
  down: "border-transparent bg-down-soft text-down",
  muted: "border-line text-faint",
  ink: "border-line-strong bg-raised text-ink",
};

const DOT_TONE: Record<ChipTone, string> = {
  neutral: "bg-dim",
  brand: "bg-brand",
  up: "bg-up",
  down: "bg-down",
  muted: "bg-off",
  ink: "bg-ink",
};

/** Compact state or honesty label. Use sparingly; one chip per fact. */
export function Chip({
  tone = "neutral",
  children,
  dot = false,
  live = false,
  title,
  className = "",
}: {
  tone?: ChipTone;
  children: ReactNode;
  dot?: boolean;
  live?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap ${CHIP_TONE[tone]} ${className}`}
    >
      {dot || live ? (
        <span
          aria-hidden="true"
          className={`inline-block h-[5px] w-[5px] shrink-0 rounded-full ${DOT_TONE[tone]} ${live ? motion.live : ""}`}
        />
      ) : null}
      {children}
    </span>
  );
}

/** The runtime environment as one quiet chip, the same on every ledger page. */
export function EnvironmentChip() {
  const snapshot = useGatewaySnapshot();
  return (
    <span
      className="inline-flex h-7 shrink-0 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-xs text-dim"
      title={`${snapshot.environment.label}, chain ${snapshot.environment.chainId}, ${snapshot.environment.evidence.toLowerCase()} evidence`}
    >
      <StatusDot ok />
      <span className="text-ink">{snapshot.environment.label}</span>
      <span className="text-off">/</span>
      <span className="tnum font-mono text-faint">{snapshot.environment.evidence.toLowerCase()} evidence</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Page header and figures                                             */
/* ------------------------------------------------------------------ */

export function PageHeader({
  eyebrow,
  title,
  description,
  right,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Panel as="div" className={motion.mount}>
      <div className="flex flex-col gap-3 px-4 pt-3.5 pb-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
            {eyebrow}
          </div>
          <h1 className="mt-1 font-serif text-[26px] leading-[30px] font-normal tracking-[-0.01em] text-ink">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-dim">{description}</p>
          ) : null}
        </div>
        {right ? <div className="flex flex-wrap items-center gap-2 lg:justify-end">{right}</div> : null}
      </div>
      {children}
    </Panel>
  );
}

/** Figure strip: label over a mono tabular value, hairline separated. */
export function KpiStrip({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3 lg:flex lg:divide-x lg:divide-line">
      {children}
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone = "text-ink",
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="min-w-0 border-b border-line px-4 py-2.5 odd:border-r sm:border-r lg:flex-1 lg:border-r-0 lg:border-b-0"
    >
      <div className="truncate text-[11px] text-faint">{label}</div>
      <div className={`tnum mt-0.5 truncate font-mono text-base ${tone}`}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-off">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hashes and clipboard                                                */
/* ------------------------------------------------------------------ */

export function middleTruncate(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function CopyButton({
  value,
  label,
  className = "",
  size = 12,
}: {
  value: string;
  label: string;
  className?: string;
  size?: number;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      className={`focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors ${
        copied ? "text-up" : "text-faint hover:bg-raised hover:text-ink"
      } ${className}`}
    >
      {copied ? <Check size={size} aria-hidden="true" /> : <Copy size={size} aria-hidden="true" />}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

/** Mono hash, truncated in the middle, with the full value on hover and a copy affordance. */
export function Hash({
  value,
  label,
  head = 10,
  tail = 6,
  copy = true,
  className = "",
}: {
  value: string;
  label: string;
  head?: number;
  tail?: number;
  copy?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-0.5 ${className}`}>
      <span title={`${label}: ${value}`} className="tnum min-w-0 truncate font-mono text-xs text-dim">
        {middleTruncate(value, head, tail)}
      </span>
      {copy ? <CopyButton value={value} label={label} /> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "29 Sep 17:43:05" in UTC, matching the terminal's fills tape. */
export function formatUtcTime(iso: string | null | undefined, withSeconds = true): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${withSeconds ? `:${pad(date.getUTCSeconds())}` : ""}`;
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${time}`;
}

export function formatUtcClockTime(iso: string | null | undefined): string {
  if (!iso) return "--:--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function formatUtcFull(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** UTC day key and label for date-grouped blotters. */
export function utcDay(iso: string, now: number): { key: string; label: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { key: "unknown", label: "Undated" };
  const key = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const today = new Date(now);
  const todayKey = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;
  const yesterday = new Date(now - 86_400_000);
  const yesterdayKey = `${yesterday.getUTCFullYear()}-${pad(yesterday.getUTCMonth() + 1)}-${pad(yesterday.getUTCDate())}`;
  const dated = `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  if (key === todayKey) return { key, label: `Today · ${dated}` };
  if (key === yesterdayKey) return { key, label: `Yesterday · ${dated}` };
  return { key, label: dated };
}

/** Compact countdown: 42s, 4m 05s, 1h 02m. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${pad(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${pad(hours % 24)}h`;
}

/** One shared one-second clock for live countdowns. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => platformNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(platformNow()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Returns a counter that increments whenever `value` changes after mount, so a
 * keyed element can replay a highlight without flashing on first render.
 */
export function useChangeCount(value: string): number {
  const [previous, setPrevious] = useState(value);
  const [count, setCount] = useState(0);
  if (previous !== value) {
    setPrevious(value);
    setCount((current) => current + 1);
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Countdown bar                                                       */
/* ------------------------------------------------------------------ */

/**
 * Remaining share of a validity window as a thin bar. It turns lime while
 * healthy, paper when under a quarter, and rose in the final ten seconds.
 */
export function TtlBar({
  startMs,
  endMs,
  now,
  showLabel = true,
  className = "",
  terminalLabel = "Expired",
}: {
  startMs: number;
  endMs: number;
  now: number;
  showLabel?: boolean;
  className?: string;
  terminalLabel?: string;
}) {
  const total = Math.max(1, endMs - startMs);
  const remainingMs = Math.max(0, endMs - now);
  const share = Math.max(0, Math.min(1, remainingMs / total));
  const seconds = Math.ceil(remainingMs / 1000);
  const expired = remainingMs <= 0;
  const fill = expired ? "bg-off" : seconds <= 10 ? "bg-down" : share < 0.25 ? "bg-ink" : "bg-brand";
  const text = expired ? "text-faint" : seconds <= 10 ? "text-down" : "text-ink";
  const style: CSSProperties = { transform: `scaleX(${share})` };
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <span
        role="meter"
        aria-label="Time remaining"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="relative h-[3px] min-w-8 flex-1 overflow-hidden rounded-full bg-line-strong"
      >
        <span className={`absolute inset-0 rounded-full ${fill} ${motion.ttlFill}`} style={style} />
      </span>
      {showLabel ? (
        <span className={`tnum w-[52px] shrink-0 text-right font-mono text-xs ${text}`}>
          {expired ? terminalLabel : formatCountdown(seconds)}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Wallet prompt                                                       */
/* ------------------------------------------------------------------ */

/** Ledger data is read per wallet, so a disconnected session gets a connect action. */
export function useWalletPrompt(): {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => void;
} {
  const gateway = useInternalGateway();
  const snapshot = useGatewaySnapshot();
  const [error, setError] = useState<string | null>(null);
  const connect = () => {
    setError(null);
    gateway.connectWallet().catch(() => {
      setError("Wallet connection was not completed. Try again from your wallet.");
    });
  };
  return {
    connected: snapshot.wallet.status === "CONNECTED",
    connecting: snapshot.wallet.status === "CONNECTING",
    error,
    connect,
  };
}

export function ButtonLink({
  children,
  tone = "quiet",
  className = "",
}: {
  children: ReactNode;
  tone?: "quiet" | "primary";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-[color,border-color,background-color,filter] duration-150 ${
        tone === "primary"
          ? "bg-brand text-app hover:brightness-105"
          : "border border-line-strong text-dim hover:border-ink/30 hover:text-ink"
      } ${className}`}
    >
      {children}
    </span>
  );
}

export const BUTTON_QUIET =
  "focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-line-strong px-3 text-xs text-dim transition-colors duration-150 hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_PRIMARY =
  "focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-brand px-3 text-xs font-semibold text-app transition-[filter] duration-150 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60";

export const BUTTON_INK =
  "focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-ink px-3 text-xs font-semibold text-app transition-[filter] duration-150 hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-60";
