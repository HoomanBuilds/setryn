"use client";

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { motion } from "@/components/markets/ui";

export interface ChartPoint {
  t: number;
  v: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Time of day for a span inside one day; date and time once the series runs longer. */
function clock(epochSeconds: number, multiDay = false): string {
  const date = new Date(epochSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  if (multiDay) return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${time}`;
  return `${time}:${pad(date.getUTCSeconds())}`;
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let value = first; value <= max + step * 1e-6; value += step) out.push(Number(value.toFixed(10)));
  return out;
}

/**
 * One series through time, drawn at its measured pixel width so the line
 * stays 2px and crisp. Points sit at their own times, so irregular
 * observations keep their true spacing. A crosshair and tooltip follow the pointer; the value
 * axis sits on the right like the terminal chart. Colour follows the sign of
 * the latest value against the baseline, never the series identity.
 */
export function SessionChart({
  points,
  format,
  baseline,
  empty,
  label,
}: {
  points: ChartPoint[];
  format: (value: number) => string;
  /** Reference level drawn as a dashed rule, and the level colour is judged from. */
  baseline: number;
  /** Replaces the plot with a quiet message when there is nothing to draw. */
  empty?: ReactNode;
  label: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const gradient = `session-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const axis = 64;
  const top = 10;
  const bottom = 20;
  const plotW = Math.max(0, width - axis);
  const plotH = height - top - bottom;

  const values = points.map((point) => point.v);
  const lo = Math.min(baseline, ...values);
  const hi = Math.max(baseline, ...values);
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.02);
  const min = lo - span * 0.14;
  const max = hi + span * 0.14;
  const y = (value: number) => top + (1 - (value - min) / (max - min)) * plotH;
  const first = points[0]?.t ?? 0;
  const spanT = (points[points.length - 1]?.t ?? first) - first;
  const multiDay = spanT > 86_400;
  const x = (index: number) =>
    points.length <= 1 || spanT <= 0 ? plotW : ((points[index].t - first) / spanT) * plotW;

  const last = points[points.length - 1];
  const rising = last ? last.v >= baseline : true;
  const stroke = last && last.v === baseline ? "var(--color-dim)" : rising ? "var(--color-up)" : "var(--color-down)";
  const coords = points.map((point, index) => ({ x: x(index), y: y(point.v) }));
  const line = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const base = y(baseline);
  const area =
    coords.length > 1
      ? `${line} L${coords[coords.length - 1].x.toFixed(1)} ${base.toFixed(1)} L${coords[0].x.toFixed(1)} ${base.toFixed(1)} Z`
      : "";
  /* Grid labels give way to the live value tag rather than printing under it. */
  const tagY = last ? y(last.v) : -100;
  const grid = empty
    ? []
    : niceTicks(min, max, 3).filter(
        (value) =>
          y(value) > top + 4 && y(value) < top + plotH - 4 && Math.abs(y(value) - tagY) > 14,
      );

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (points.length === 0 || plotW === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / plotW));
    const target = first + ratio * spanT;
    let nearest = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.t - target) < Math.abs(points[nearest].t - target)) nearest = index;
    });
    setHover(spanT <= 0 ? points.length - 1 : nearest);
  };

  const active = hover !== null && hover < points.length ? hover : null;
  const focus = active !== null ? coords[active] : null;

  return (
    <div
      ref={frame}
      className="relative h-full w-full select-none"
      onPointerMove={empty ? undefined : onMove}
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 && height > 0 ? (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={label}
          className={`${motion.fade} block`}
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={rising ? 0.2 : 0.02} />
              <stop offset="100%" stopColor={stroke} stopOpacity={rising ? 0.02 : 0.2} />
            </linearGradient>
          </defs>

          {grid.map((value) => (
            <g key={value}>
              <line
                x1={0}
                x2={plotW}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--color-line-soft)"
                strokeWidth={1}
              />
              <text
                x={plotW + 8}
                y={y(value) + 3.5}
                fill="var(--color-off)"
                fontSize={10}
                className="tnum font-mono"
              >
                {format(value)}
              </text>
            </g>
          ))}

          <line
            x1={0}
            x2={plotW}
            y1={base}
            y2={base}
            stroke="var(--color-line-strong)"
            strokeDasharray="3 4"
            strokeWidth={1}
          />

          {!empty && area ? <path d={area} fill={`url(#${gradient})`} /> : null}
          {!empty && coords.length > 1 ? (
            <path
              d={line}
              fill="none"
              stroke={stroke}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {!empty && last ? (
            <>
              <circle cx={x(points.length - 1)} cy={y(last.v)} r={3} fill={stroke} />
              <rect
                x={plotW + 2}
                y={y(last.v) - 8}
                width={axis - 4}
                height={16}
                rx={3}
                fill={stroke}
                opacity={0.16}
              />
              <text
                x={plotW + 8}
                y={y(last.v) + 3.5}
                fill={stroke}
                fontSize={10}
                className="tnum font-mono"
              >
                {format(last.v)}
              </text>
            </>
          ) : null}

          {focus && active !== null ? (
            <g pointerEvents="none">
              <line
                x1={focus.x}
                x2={focus.x}
                y1={top}
                y2={top + plotH}
                stroke="var(--color-line-strong)"
                strokeWidth={1}
              />
              <circle cx={focus.x} cy={focus.y} r={4} fill="var(--color-panel)" stroke={stroke} strokeWidth={2} />
            </g>
          ) : null}

          {points.length > 1 && !empty ? (
            <>
              <text x={0} y={height - 5} fill="var(--color-off)" fontSize={10} className="tnum font-mono">
                {clock(points[0].t, multiDay)}
              </text>
              <text
                x={plotW}
                y={height - 5}
                fill="var(--color-off)"
                fontSize={10}
                textAnchor="end"
                className="tnum font-mono"
              >
                {clock(points[points.length - 1].t, multiDay)}
              </text>
            </>
          ) : null}
        </svg>
      ) : null}

      {focus && active !== null ? (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-md border border-line-strong bg-raised/95 px-2 py-1 shadow-[0_12px_28px_rgba(0,0,0,0.45)]"
          style={{
            left: Math.min(Math.max(0, focus.x - 64), Math.max(0, plotW - 128)),
          }}
        >
          <div className="tnum font-mono text-[10px] text-faint">{`${clock(points[active].t, multiDay)} UTC`}</div>
          <div className="tnum font-mono text-xs text-ink">{format(points[active].v)}</div>
        </div>
      ) : null}

      {empty ? (
        <div className="absolute inset-0 flex items-center justify-center pr-16">{empty}</div>
      ) : null}
    </div>
  );
}
