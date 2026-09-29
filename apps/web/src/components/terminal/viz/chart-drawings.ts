import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import { CHART_THEME } from "./chart-theme";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export type DrawingKind = "trend" | "ray" | "hline" | "vline" | "rect" | "fib" | "measure";

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  points: DrawingPoint[];
}

export const DRAWING_KINDS: DrawingKind[] = ["trend", "ray", "hline", "vline", "rect", "fib", "measure"];

export const DRAWING_LABEL: Record<DrawingKind, string> = {
  trend: "Trend line",
  ray: "Ray",
  hline: "Horizontal line",
  vline: "Vertical line",
  rect: "Rectangle",
  fib: "Fib retracement",
  measure: "Price range",
};

/** Anchors each tool needs. One-anchor tools are placed with a single click. */
export const DRAWING_ANCHORS: Record<DrawingKind, 1 | 2> = {
  trend: 2,
  ray: 2,
  hline: 1,
  vline: 1,
  rect: 2,
  fib: 2,
  measure: 2,
};

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ["#8a857e", "#ff5d7a", "#e8a068", "#3fd9a4", "#5fd4e0", "#6ea8fe", "#8a857e"];

export const DRAWING_COLOR = "#7ea6ff";
const DRAWING_FILL = "rgba(126, 166, 255, 0.1)";
const SELECTED_COLOR = "#c1ff12";

function isPoint(value: unknown): value is DrawingPoint {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(record.time) && Number.isFinite(record.price);
}

/** Accepts the current format and the earlier list of horizontal-line prices. */
export function parseDrawings(value: unknown): Drawing[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const drawings: Drawing[] = [];
  value.forEach((entry, index) => {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      drawings.push({ id: `legacy-${index}`, kind: "hline", points: [{ time: 0, price: entry }] });
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    const kind = record.kind as DrawingKind;
    if (typeof record.id !== "string" || !DRAWING_KINDS.includes(kind) || !Array.isArray(record.points)) return;
    const points = record.points.filter(isPoint).slice(0, DRAWING_ANCHORS[kind]);
    if (points.length !== DRAWING_ANCHORS[kind]) return;
    drawings.push({ id: record.id, kind, points: points.map((point) => ({ time: point.time, price: point.price })) });
  });
  return drawings;
}

export interface DrawingProjection {
  /** Horizontal pixel for a timestamp, extrapolated past either end of the data. */
  x: (time: number) => number | null;
  y: (price: number) => number | null;
  width: number;
  height: number;
}

interface Pixel {
  x: number;
  y: number;
}

function project(point: DrawingPoint, projection: DrawingProjection): Pixel | null {
  const x = projection.x(point.time);
  const y = projection.y(point.price);
  return x === null || y === null ? null : { x, y };
}

/** Far end of a ray from `a` through `b`, clipped to a box a little larger than the pane. */
function rayEnd(a: Pixel, b: Pixel, width: number, height: number): Pixel {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return b;
  const reach = (width + height) * 4;
  const length = Math.hypot(dx, dy);
  return { x: a.x + (dx / length) * reach, y: a.y + (dy / length) * reach };
}

function segmentDistance(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export interface DrawingHit {
  id: string;
  /** Anchor index under the pointer, or -1 when the pointer is on the body. */
  anchor: number;
  distance: number;
}

const HIT_TOLERANCE = 6;
const ANCHOR_TOLERANCE = 8;

export function hitTestDrawing(drawing: Drawing, pointer: Pixel, projection: DrawingProjection): DrawingHit | null {
  const pixels = drawing.points.map((point) => project(point, projection));
  for (let index = 0; index < pixels.length; index += 1) {
    const pixel = pixels[index];
    if (!pixel) continue;
    if (drawing.kind === "hline" || drawing.kind === "vline") break;
    const distance = Math.hypot(pointer.x - pixel.x, pointer.y - pixel.y);
    if (distance <= ANCHOR_TOLERANCE) return { id: drawing.id, anchor: index, distance };
  }
  const [a, b] = pixels;
  let distance = Number.POSITIVE_INFINITY;
  switch (drawing.kind) {
    case "hline":
      if (a) distance = Math.abs(pointer.y - a.y);
      break;
    case "vline":
      if (a) distance = Math.abs(pointer.x - a.x);
      break;
    case "trend":
      if (a && b) distance = segmentDistance(pointer, a, b);
      break;
    case "ray":
      if (a && b) distance = segmentDistance(pointer, a, rayEnd(a, b, projection.width, projection.height));
      break;
    case "rect":
    case "measure": {
      if (!a || !b) break;
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      const top = Math.min(a.y, b.y);
      const bottom = Math.max(a.y, b.y);
      const inside = pointer.x >= left && pointer.x <= right && pointer.y >= top && pointer.y <= bottom;
      distance = inside ? 0 : Number.POSITIVE_INFINITY;
      if (!inside && drawing.kind === "rect") {
        distance = Math.min(
          segmentDistance(pointer, { x: left, y: top }, { x: right, y: top }),
          segmentDistance(pointer, { x: left, y: bottom }, { x: right, y: bottom }),
          segmentDistance(pointer, { x: left, y: top }, { x: left, y: bottom }),
          segmentDistance(pointer, { x: right, y: top }, { x: right, y: bottom }),
        );
      }
      break;
    }
    case "fib": {
      if (!a || !b) break;
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      if (pointer.x < left - HIT_TOLERANCE || pointer.x > right + HIT_TOLERANCE) break;
      for (const level of FIB_LEVELS) {
        const y = b.y + (a.y - b.y) * level;
        distance = Math.min(distance, Math.abs(pointer.y - y));
      }
      break;
    }
  }
  return distance <= HIT_TOLERANCE ? { id: drawing.id, anchor: -1, distance } : null;
}

export interface DrawingScene {
  drawings: Drawing[];
  draft: Drawing | null;
  selectedId: string | null;
  hoveredId: string | null;
  visible: boolean;
  priceDecimals: number;
  /** Resolved monospace family for canvas labels. */
  fontFamily: string;
  /** Bars between two timestamps on the current interval, for the price-range readout. */
  barsBetween: (from: number, to: number) => number;
  formatTime: (time: number) => string;
  countdown: { price: number; text: string; color: string } | null;
}

const EMPTY_SCENE: DrawingScene = {
  drawings: [],
  draft: null,
  selectedId: null,
  hoveredId: null,
  visible: true,
  priceDecimals: 2,
  fontFamily: "ui-monospace, monospace",
  barsBetween: () => 0,
  formatTime: () => "",
  countdown: null,
};

function formatPrice(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDuration(seconds: number): string {
  const total = Math.abs(Math.round(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function roundedLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  background: string,
  color: string,
  fontFamily: string,
) {
  ctx.font = `11px ${fontFamily}`;
  const lines = text.split("\n");
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 14;
  const height = lines.length * 15 + 8;
  const left = x - width / 2;
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(left, y, width, height, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((line, index) => ctx.fillText(line, x, y + 5 + index * 15));
}

function anchorDot(ctx: CanvasRenderingContext2D, pixel: Pixel, color: string) {
  ctx.beginPath();
  ctx.arc(pixel.x, pixel.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = CHART_THEME.panel;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  drawing: Drawing,
  projection: DrawingProjection,
  scene: DrawingScene,
  emphasis: "none" | "hover" | "selected" | "draft",
) {
  const pixels = drawing.points.map((point) => project(point, projection));
  const [a, b] = pixels;
  const color = emphasis === "selected" ? SELECTED_COLOR : DRAWING_COLOR;
  ctx.lineWidth = emphasis === "hover" || emphasis === "selected" ? 2 : 1.5;
  ctx.strokeStyle = color;
  ctx.setLineDash([]);

  switch (drawing.kind) {
    case "hline": {
      if (!a) return;
      ctx.beginPath();
      ctx.moveTo(0, a.y);
      ctx.lineTo(projection.width, a.y);
      ctx.stroke();
      break;
    }
    case "vline": {
      if (!a) return;
      ctx.beginPath();
      ctx.moveTo(a.x, 0);
      ctx.lineTo(a.x, projection.height);
      ctx.stroke();
      break;
    }
    case "trend":
    case "ray": {
      if (!a || !b) return;
      const end = drawing.kind === "ray" ? rayEnd(a, b, projection.width, projection.height) : b;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }
    case "rect": {
      if (!a || !b) return;
      ctx.fillStyle = emphasis === "selected" ? "rgba(193, 255, 18, 0.07)" : DRAWING_FILL;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      break;
    }
    case "fib": {
      if (!a || !b) return;
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      const [start, end] = drawing.points;
      ctx.font = `10px ${scene.fontFamily}`;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      FIB_LEVELS.forEach((level, index) => {
        const y = b.y + (a.y - b.y) * level;
        if (index > 0) {
          const previous = b.y + (a.y - b.y) * FIB_LEVELS[index - 1];
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = FIB_COLORS[index];
          ctx.fillRect(left, Math.min(previous, y), right - left, Math.abs(y - previous));
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = emphasis === "selected" ? SELECTED_COLOR : FIB_COLORS[index];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        const price = end.price + (start.price - end.price) * level;
        ctx.fillStyle = FIB_COLORS[index];
        ctx.fillText(`${level} (${formatPrice(price, scene.priceDecimals)})`, left + 4, y - 2);
      });
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(242, 240, 237, 0.25)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "measure": {
      if (!a || !b) return;
      const [start, end] = drawing.points;
      const delta = end.price - start.price;
      const up = delta >= 0;
      const tone = up ? CHART_THEME.up : CHART_THEME.down;
      ctx.fillStyle = up ? "rgba(63, 217, 164, 0.12)" : "rgba(255, 93, 122, 0.12)";
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeStyle = tone;
      ctx.lineWidth = 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      ctx.beginPath();
      ctx.moveTo(midX, a.y);
      ctx.lineTo(midX, b.y);
      ctx.moveTo(a.x, midY);
      ctx.lineTo(b.x, midY);
      ctx.stroke();
      // Arrow heads on the price and time axes of the box.
      const arrow = (x: number, y: number, dx: number, dy: number) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - dx * 5 - dy * 4, y - dy * 5 - dx * 4);
        ctx.moveTo(x, y);
        ctx.lineTo(x - dx * 5 + dy * 4, y - dy * 5 + dx * 4);
        ctx.stroke();
      };
      arrow(midX, b.y, 0, Math.sign(b.y - a.y) || 1);
      arrow(b.x, midY, Math.sign(b.x - a.x) || 1, 0);
      const percent = start.price !== 0 ? (delta / Math.abs(start.price)) * 100 : 0;
      const bars = scene.barsBetween(start.time, end.time);
      const text = `${up ? "+" : ""}${formatPrice(delta, scene.priceDecimals)} (${up ? "+" : ""}${percent.toFixed(2)}%)\n${bars} bars, ${formatDuration(end.time - start.time)}`;
      const labelY = up ? Math.min(a.y, b.y) - 44 : Math.max(a.y, b.y) + 8;
      roundedLabel(
        ctx,
        text,
        midX,
        Math.max(4, Math.min(projection.height - 42, labelY)),
        tone,
        "#0e0e10",
        scene.fontFamily,
      );
      break;
    }
  }

  if (emphasis !== "none" && drawing.kind !== "hline" && drawing.kind !== "vline") {
    for (const pixel of pixels) if (pixel) anchorDot(ctx, pixel, color);
  }
}

class DrawingsRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly scene: DrawingScene,
    private readonly projection: DrawingProjection | null,
  ) {}

  draw(target: RenderTarget) {
    const projection = this.projection;
    if (!projection) return;
    const scene = this.scene;
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      if (scene.visible) {
        for (const drawing of scene.drawings) {
          const emphasis =
            drawing.id === scene.selectedId ? "selected" : drawing.id === scene.hoveredId ? "hover" : "none";
          drawOne(context, drawing, projection, scene, emphasis);
        }
      }
      if (scene.draft) drawOne(context, scene.draft, projection, scene, "draft");
      context.restore();
    });
  }
}

class DrawingsPaneView implements IPrimitivePaneView {
  constructor(private readonly owner: DrawingsPrimitive) {}

  zOrder() {
    return "top" as const;
  }

  renderer() {
    return new DrawingsRenderer(this.owner.scene, this.owner.projection());
  }
}

class AxisLabel implements ISeriesPrimitiveAxisView {
  constructor(
    private readonly at: number,
    private readonly label: string,
    private readonly background: string,
    private readonly foreground = "#0e0e10",
  ) {}

  coordinate() {
    return this.at;
  }

  text() {
    return this.label;
  }

  textColor() {
    return this.foreground;
  }

  backColor() {
    return this.background;
  }
}

/**
 * Renders every drawing on the price pane from one scene object. The component owns the drawings and pointer
 * interaction; this primitive only projects and paints, so the chart stays the single source of pixels.
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  scene: DrawingScene = EMPTY_SCENE;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views: IPrimitivePaneView[] = [new DrawingsPaneView(this)];
  private priceViews: ISeriesPrimitiveAxisView[] = [];
  private timeViews: ISeriesPrimitiveAxisView[] = [];

  constructor(private readonly timeToX: (time: number) => number | null) {}

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setScene(scene: DrawingScene) {
    this.scene = scene;
    this.requestUpdate?.();
  }

  projection(): DrawingProjection | null {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return null;
    const pane = chart.panes()[0];
    return {
      x: this.timeToX,
      y: (price) => series.priceToCoordinate(price),
      width: chart.timeScale().width(),
      height: pane?.getHeight() ?? 0,
    };
  }

  updateAllViews() {
    const projection = this.projection();
    const scene = this.scene;
    const prices: ISeriesPrimitiveAxisView[] = [];
    const times: ISeriesPrimitiveAxisView[] = [];
    if (projection) {
      if (scene.countdown) {
        const y = projection.y(scene.countdown.price);
        if (y !== null) prices.push(new AxisLabel(y + 17, scene.countdown.text, scene.countdown.color));
      }
      const labelled = scene.visible ? scene.drawings : [];
      for (const drawing of [...labelled, ...(scene.draft ? [scene.draft] : [])]) {
        const active = drawing === scene.draft || drawing.id === scene.selectedId;
        const color = drawing.id === scene.selectedId ? SELECTED_COLOR : DRAWING_COLOR;
        for (const point of drawing.points) {
          if (drawing.kind === "hline" || (active && drawing.kind !== "vline")) {
            const y = projection.y(point.price);
            if (y !== null) prices.push(new AxisLabel(y, formatPrice(point.price, scene.priceDecimals), color));
          }
          if (drawing.kind === "vline" || (active && drawing.kind !== "hline")) {
            const x = projection.x(point.time);
            if (x !== null) times.push(new AxisLabel(x, scene.formatTime(point.time), color));
          }
        }
      }
    }
    this.priceViews = prices;
    this.timeViews = times;
  }

  paneViews() {
    return this.views;
  }

  priceAxisViews() {
    return this.priceViews;
  }

  timeAxisViews() {
    return this.timeViews;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const projection = this.projection();
    if (!projection || !this.scene.visible) return null;
    let best: DrawingHit | null = null;
    for (const drawing of this.scene.drawings) {
      const hit = hitTestDrawing(drawing, { x, y }, projection);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    if (!best) return null;
    const drawing = this.scene.drawings.find((item) => item.id === best.id);
    const selected = best.id === this.scene.selectedId;
    return {
      externalId: best.id,
      zOrder: "top",
      distance: best.distance,
      hitTestPriority: best.anchor >= 0 ? 2 : 1,
      cursorStyle:
        selected && best.anchor >= 0
          ? "grab"
          : drawing?.kind === "hline"
            ? "ns-resize"
            : drawing?.kind === "vline"
              ? "ew-resize"
              : "pointer",
    };
  }
}
