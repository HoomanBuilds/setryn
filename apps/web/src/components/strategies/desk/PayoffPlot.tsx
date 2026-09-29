"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";

export type PlotTone = "ink" | "dim" | "faint" | "brand" | "up" | "down";

export interface PlotSeries {
  id: string;
  label: string;
  /** Points sorted by x. */
  points: { x: number; y: number }[];
  tone: PlotTone;
  dashed?: boolean;
  /** The primary series gets the gain/loss fill, split stroke and breakevens. */
  primary?: boolean;
}

const STROKE: Record<PlotTone, string> = {
  ink: "var(--color-ink)",
  dim: "var(--color-dim)",
  faint: "var(--color-faint)",
  brand: "var(--color-brand)",
  up: "var(--color-up)",
  down: "var(--color-down)",
};

const PAD = { top: 16, right: 58, bottom: 24, left: 10 };

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = norm < 1.5 ? 1 : norm < 2.25 ? 2 : norm < 3.5 ? 2.5 : norm < 7 ? 5 : 10;
  return step * magnitude;
}

function niceTicks(min: number, max: number, count: number): number[] {
  const step = niceStep(max - min, count);
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let value = start; value <= max + step * 1e-6; value += step) {
    out.push(Number(value.toFixed(10)));
    if (out.length > 24) break;
  }
  return out;
}

/** Linear interpolation of a sorted series at x, clamped to its ends. */
export function valueAt(points: { x: number; y: number }[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    if (x <= right.x) {
      const left = points[index - 1];
      const span = right.x - left.x || 1;
      return left.y + ((right.y - left.y) * (x - left.x)) / span;
    }
  }
  return last.y;
}

/** Zero crossings of a sorted series, found by linear interpolation. */
export function breakevens(points: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (left.y === 0) continue;
    if (right.y === 0) {
      const next = points[index + 1];
      if (next && next.y !== 0 && Math.sign(next.y) !== Math.sign(left.y)) out.push(right.x);
      continue;
    }
    if (Math.sign(left.y) !== Math.sign(right.y)) {
      out.push(left.x + ((0 - left.y) * (right.x - left.x)) / (right.y - left.y));
    }
  }
  return out;
}

/**
 * Tweens flattened numeric arrays toward the latest target so payoff curves
 * glide between states. Snaps when shapes differ or reduced motion is set.
 */
function parseKey(value: string): number[][] {
  return value.length === 0 ? [] : value.split("|").map((row) => (row ? row.split(",").map(Number) : []));
}

function useTween(key: string, duration = 220): number[][] {
  const [shown, setShown] = useState<number[][]>(() => parseKey(key));
  const shownRef = useRef<number[][]>(shown);

  useEffect(() => {
    const target = parseKey(key);
    const from = shownRef.current;
    const compatible =
      from.length === target.length && from.every((row, index) => row.length === target[index].length);
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    if (!compatible || reduce) {
      frame = window.requestAnimationFrame(() => {
        shownRef.current = target;
        setShown(target);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = target.map((row, i) => row.map((value, j) => from[i][j] + (value - from[i][j]) * eased));
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [key, duration]);

  return shown;
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function pathFor(points: { x: number; y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

export function PayoffPlot({
  series,
  marker,
  onMarker,
  markerStep = 1,
  xFormat,
  yFormat,
  yTooltipFormat,
  ariaLabel,
  spotLabel = "spot",
  className = "",
}: {
  series: PlotSeries[];
  marker?: number | null;
  onMarker?: (x: number) => void;
  markerStep?: number;
  xFormat: (x: number) => string;
  yFormat: (y: number) => string;
  yTooltipFormat?: (y: number) => string;
  ariaLabel: string;
  spotLabel?: string;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { ref, size } = useSize();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const key = useMemo(
    () => series.map((item) => item.points.flatMap((point) => [point.x, point.y]).join(",")).join("|"),
    [series],
  );
  const tweened = useTween(key);
  const shown = useMemo(
    () =>
      series.map((item, index) => {
        const flat = tweened[index];
        if (!flat || flat.length !== item.points.length * 2) return item;
        const points: { x: number; y: number }[] = [];
        for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
        return { ...item, points };
      }),
    [series, tweened],
  );

  const primary = shown.find((item) => item.primary) ?? shown[0];
  const allPoints = shown.flatMap((item) => item.points);
  const xs = allPoints.map((point) => point.x);
  const ys = allPoints.map((point) => point.y);
  const xMin = xs.length ? Math.min(...xs) : -1;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const rawLo = Math.min(0, ...(ys.length ? ys : [0]));
  const rawHi = Math.max(0, ...(ys.length ? ys : [0]));
  const pad = (rawHi - rawLo || Math.abs(rawHi) || 1) * 0.12;
  const yMin = rawLo - pad;
  const yMax = rawHi + pad;

  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);
  const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;
  const invX = (px: number) => xMin + ((px - PAD.left) / plotW) * (xMax - xMin);

  const yTicks = niceTicks(yMin, yMax, height < 200 ? 3 : 5);
  const xTicks = niceTicks(xMin, xMax, width < 420 ? 4 : 8);
  const zeroY = sy(0);
  const crossings = primary ? breakevens(primary.points) : [];
  const ready = width > 0 && height > 0;

  const snap = (value: number) => Math.round(value / markerStep) * markerStep;
  const clampX = (value: number) => Math.min(xMax, Math.max(xMin, value));

  const locate = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clampX(invX(event.clientX - rect.left + PAD.left));
  };

  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    const x = locate(event);
    setHoverX(x);
    if (dragging && onMarker) onMarker(snap(x));
  };

  const onPointerDown = (event: PointerEvent<SVGRectElement>) => {
    if (!onMarker) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    onMarker(snap(locate(event)));
  };

  const tipX = hoverX;
  const tipPx = tipX !== null ? sx(tipX) : 0;
  const tipLeft = tipPx > width - 200;
  const tipFormat = yTooltipFormat ?? yFormat;

  const areaPath = primary
    ? `${pathFor(primary.points.map((point) => ({ x: sx(point.x), y: sy(point.y) })))} L${sx(
        primary.points[primary.points.length - 1]?.x ?? xMax,
      ).toFixed(1)} ${zeroY.toFixed(1)} L${sx(primary.points[0]?.x ?? xMin).toFixed(1)} ${zeroY.toFixed(1)} Z`
    : "";

  return (
    <div
      ref={ref}
      className={`relative h-full min-h-[180px] w-full select-none ${className}`}
    >
      {ready ? (
        <svg width={width} height={height} className="absolute inset-0 block" role="img" aria-label={ariaLabel}>
          <defs>
            <clipPath id={`${uid}-plot`}>
              <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
            </clipPath>
            <clipPath id={`${uid}-above`}>
              <rect x={0} y={0} width={width} height={Math.max(0, zeroY)} />
            </clipPath>
            <clipPath id={`${uid}-below`}>
              <rect x={0} y={zeroY} width={width} height={Math.max(0, height - zeroY)} />
            </clipPath>
            <linearGradient id={`${uid}-gain`} gradientUnits="userSpaceOnUse" x1="0" y1={PAD.top} x2="0" y2={zeroY}>
              <stop offset="0" stopColor="var(--color-up)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--color-up)" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={`${uid}-loss`} gradientUnits="userSpaceOnUse" x1="0" y1={zeroY} x2="0" y2={PAD.top + plotH}>
              <stop offset="0" stopColor="var(--color-down)" stopOpacity="0.02" />
              <stop offset="1" stopColor="var(--color-down)" stopOpacity="0.22" />
            </linearGradient>
          </defs>

          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={sy(tick)}
                y2={sy(tick)}
                stroke="var(--color-line-soft)"
                strokeWidth={1}
              />
              <text
                x={PAD.left + plotW + 8}
                y={sy(tick)}
                dominantBaseline="middle"
                className="fill-faint font-mono text-[10px]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {yFormat(tick)}
              </text>
            </g>
          ))}

          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                x1={sx(tick)}
                x2={sx(tick)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--color-line-soft)"
                strokeWidth={1}
              />
              <text
                x={sx(tick)}
                y={height - 7}
                textAnchor="middle"
                className="fill-faint font-mono text-[10px]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {xFormat(tick)}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${uid}-plot)`}>
            {primary ? (
              <>
                <path d={areaPath} fill={`url(#${uid}-gain)`} clipPath={`url(#${uid}-above)`} />
                <path d={areaPath} fill={`url(#${uid}-loss)`} clipPath={`url(#${uid}-below)`} />
              </>
            ) : null}

            {xMin <= 0 && xMax >= 0 ? (
              <line
                x1={sx(0)}
                x2={sx(0)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--color-line-strong)"
                strokeWidth={1}
              />
            ) : null}

            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={zeroY}
              y2={zeroY}
              stroke="var(--color-line-strong)"
              strokeWidth={1}
            />

            {shown
              .filter((item) => !item.primary)
              .map((item) => (
                <path
                  key={item.id}
                  d={pathFor(item.points.map((point) => ({ x: sx(point.x), y: sy(point.y) })))}
                  fill="none"
                  stroke={STROKE[item.tone]}
                  strokeWidth={1.25}
                  strokeDasharray={item.dashed ? "4 4" : undefined}
                  strokeLinejoin="round"
                  opacity={0.9}
                />
              ))}

            {primary ? (
              <>
                <path
                  d={pathFor(primary.points.map((point) => ({ x: sx(point.x), y: sy(point.y) })))}
                  fill="none"
                  stroke="var(--color-up)"
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  clipPath={`url(#${uid}-above)`}
                />
                <path
                  d={pathFor(primary.points.map((point) => ({ x: sx(point.x), y: sy(point.y) })))}
                  fill="none"
                  stroke="var(--color-down)"
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  clipPath={`url(#${uid}-below)`}
                />
              </>
            ) : null}

            {crossings.map((x) => (
              <g key={`be-${x.toFixed(4)}`}>
                <line
                  x1={sx(x)}
                  x2={sx(x)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--color-dim)"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
                <circle cx={sx(x)} cy={zeroY} r={3} fill="var(--color-panel)" stroke="var(--color-ink)" strokeWidth={1.25} />
              </g>
            ))}

            {marker !== null && marker !== undefined && marker >= xMin && marker <= xMax ? (
              <g>
                <line
                  x1={sx(marker)}
                  x2={sx(marker)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--color-brand)"
                  strokeWidth={1}
                  opacity={0.85}
                />
                {primary ? (
                  <circle
                    cx={sx(marker)}
                    cy={sy(valueAt(primary.points, marker))}
                    r={4}
                    fill="var(--color-brand)"
                    stroke="var(--color-panel)"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            ) : null}

            {tipX !== null ? (
              <g pointerEvents="none">
                <line
                  x1={tipPx}
                  x2={tipPx}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--color-faint)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {shown.map((item) => (
                  <circle
                    key={`tip-${item.id}`}
                    cx={tipPx}
                    cy={sy(valueAt(item.points, tipX))}
                    r={3}
                    fill={item.primary ? "var(--color-ink)" : STROKE[item.tone]}
                    stroke="var(--color-panel)"
                    strokeWidth={1.5}
                  />
                ))}
              </g>
            ) : null}
          </g>

          {crossings.map((x) => {
            const label = `BE ${xFormat(x)}`;
            const px = sx(x);
            const w = label.length * 6 + 10;
            const left = Math.min(Math.max(px - w / 2, PAD.left), PAD.left + plotW - w);
            return (
              <g key={`be-label-${x.toFixed(4)}`} pointerEvents="none">
                <rect x={left} y={1} width={w} height={14} rx={3} fill="var(--color-raised)" stroke="var(--color-line-strong)" />
                <text
                  x={left + w / 2}
                  y={8}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-ink font-mono text-[10px]"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {label}
                </text>
              </g>
            );
          })}

          {xMin <= 0 && xMax >= 0 && !crossings.some((x) => Math.abs(sx(x) - sx(0)) < 48) ? (
            <text x={sx(0) + 4} y={PAD.top + 10} className="fill-off font-mono text-[10px]">
              {spotLabel}
            </text>
          ) : null}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            style={{ cursor: onMarker ? "crosshair" : "default", touchAction: onMarker ? "none" : "auto" }}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            onPointerLeave={() => {
              setHoverX(null);
            }}
          />
        </svg>
      ) : null}

      {tipX !== null && ready ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[150px] rounded-md border border-line-strong bg-raised/95 px-2.5 py-2 text-xs shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-sm"
          style={{
            top: PAD.top + 6,
            left: tipLeft ? undefined : tipPx + 12,
            right: tipLeft ? width - tipPx + 12 : undefined,
          }}
        >
          <div className="tnum mb-1 font-mono text-[11px] text-faint">{xFormat(tipX)}</div>
          {shown.map((item) => {
            const value = valueAt(item.points, tipX);
            return (
              <div key={`row-${item.id}`} className="flex items-center justify-between gap-4 py-px">
                <span className="flex items-center gap-1.5 text-dim">
                  <span
                    aria-hidden="true"
                    className="inline-block h-0.5 w-2.5 rounded-full"
                    style={{ background: item.primary ? "var(--color-ink)" : STROKE[item.tone] }}
                  />
                  {item.label}
                </span>
                <span
                  className={`tnum font-mono ${value > 0 ? "text-up" : value < 0 ? "text-down" : "text-dim"}`}
                >
                  {tipFormat(value)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
