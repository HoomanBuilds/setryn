"use client";

import { useId, useState, type ReactNode } from "react";
import { UnderlyingIcon } from "@/components/icons/AssetIcon";
import motion from "@/components/markets/motion.module.css";
import type { PackageMarket } from "@/lib/terminal/types";

/**
 * Small building blocks shared by the markets directory and the portfolio.
 * They sit beside the terminal primitives rather than inside them, so the
 * shared terminal module stays untouched.
 */

export { motion };

export type ChipTone = "neutral" | "brand" | "up" | "down" | "muted";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "border-line-strong text-dim",
  brand: "border-brand-edge bg-brand-soft text-brand",
  up: "border-up/30 bg-up-soft text-up",
  down: "border-down/30 bg-down-soft text-down",
  muted: "border-line text-faint",
};

/** Provenance and state read as one quiet capsule instead of a sentence. */
export function Chip({
  children,
  tone = "neutral",
  title,
  className = "",
}: {
  children: ReactNode;
  tone?: ChipTone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[10.5px] leading-none font-medium tracking-[0.02em] whitespace-nowrap ${CHIP_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function LiveDot({ tone = "up" }: { tone?: "up" | "brand" | "muted" }) {
  const colour = tone === "up" ? "bg-up" : tone === "brand" ? "bg-brand" : "bg-off";
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${colour} ${tone === "muted" ? "" : motion.pulse}`}
    />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block ${motion.skeleton} ${className}`} />;
}

/**
 * The market's stored history is pinned to its fixture mark. The live board
 * moves that mark, so the last sample is replaced with the current package
 * price: the line always ends exactly where the price column reads.
 */
export function liveSeries(market: PackageMarket): number[] {
  const history = market.priceHistory;
  if (history.length === 0) return [market.netPrice];
  return [...history.slice(0, -1), market.netPrice];
}

export type SparkTone = "up" | "down" | "flat";

export function sparkTone(market: PackageMarket): SparkTone {
  if (market.netPrice > market.priorNetPrice) return "up";
  if (market.netPrice < market.priorNetPrice) return "down";
  return "flat";
}

const STROKE: Record<SparkTone, string> = {
  up: "var(--color-up)",
  down: "var(--color-down)",
  flat: "var(--color-dim)",
};

/**
 * Inline SVG trend line drawn at its real pixel size, so the stroke stays crisp
 * and the draw-in animation can use a normalised path length.
 */
export function Sparkline({
  values,
  tone,
  width = 88,
  height = 24,
  area = true,
  className = "",
  label,
}: {
  values: number[];
  tone: SparkTone;
  width?: number;
  height?: number;
  area?: boolean;
  className?: string;
  label?: string;
}) {
  const gradient = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (values.length < 2) return <span style={{ width, height }} className="inline-block" />;

  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((value, index) => ({
    x: pad + index * step,
    y: pad + (1 - (value - min) / span) * (height - pad * 2),
  }));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const fillPath = `${line} L${last.x.toFixed(1)} ${height} L${points[0].x.toFixed(1)} ${height} Z`;
  const stroke = STROKE[tone];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`block shrink-0 overflow-visible ${className}`}
    >
      {area ? (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={fillPath} fill={`url(#${gradient})`} className={motion.fade} />
        </>
      ) : null}
      <path
        d={line}
        pathLength={1}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={motion.draw}
      />
      <circle cx={last.x} cy={last.y} r={1.75} fill={stroke} />
    </svg>
  );
}

/**
 * Tints its content for a moment whenever `value` moves. The previous value is
 * held in state and compared during render, which is how React derives state
 * from a changing prop without an effect; the key restarts the animation.
 */
export function Flash({
  value,
  children,
  className = "",
}: {
  value: number;
  children: ReactNode;
  className?: string;
}) {
  const [seen, setSeen] = useState(value);
  const [pulse, setPulse] = useState<{ up: boolean; count: number } | null>(null);
  if (value !== seen) {
    setSeen(value);
    setPulse({ up: value > seen, count: (pulse?.count ?? 0) + 1 });
  }
  const animation = pulse ? (pulse.up ? motion.flashUp : motion.flashDown) : "";
  return (
    <span key={pulse?.count ?? 0} className={`rounded-sm ${animation} ${className}`}>
      {children}
    </span>
  );
}

/**
 * The underlying's mark (a token, or a pair with the quote tucked behind the base) in a fixed-width slot, so single
 * assets and pairs start their names on the same column.
 */
export function AssetGlyph({ underlying, size = 22 }: { underlying: string; size?: number }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center" style={{ width: Math.round(size * 1.4), height: size }}>
      <UnderlyingIcon underlying={underlying} size={size} />
    </span>
  );
}
