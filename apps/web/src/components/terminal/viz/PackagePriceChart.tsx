"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  Sigma,
  Trash2,
  X,
} from "lucide-react";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  PriceScaleMode,
  TickMarkType,
  createChart,
  createTextWatermark,
  type BarData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ITextWatermarkPluginApi,
  type LineData,
  type Logical,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { usePreviewTrades } from "@/components/terminal/PreviewMarketProvider";
import { usePersistentState } from "@/lib/terminal/use-persistent-state";
import {
  formatLots,
  formatNumber,
  formatUtcClock,
  formatUtcStamp,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";
import { executableAction } from "@/lib/terminal/economics";
import { CHART_THEME } from "./chart-theme";
import {
  DRAWING_ANCHORS,
  DRAWING_KINDS,
  DRAWING_LABEL,
  DrawingsPrimitive,
  hitTestDrawing,
  orderHandleAt,
  parseDrawings,
  type Drawing,
  type DrawingHit,
  type DrawingKind,
  type DrawingPoint,
} from "./chart-drawings";
import { ChartStyleIcon, CursorIcon, DrawingIcon } from "./chart-icons";
import {
  ALL_INTERVALS,
  CHART_STYLES,
  FAVORITE_INTERVALS,
  INTERVAL_GROUPS,
  RANGES,
  formatCountdown,
  heikinAshi,
  heikinAshiBar,
  intervalLabel,
  intervalName,
  isOhlcStyle,
  type ChartStyle,
} from "./chart-styles";
import { INDICATORS, INDICATOR_BY_ID, computeIndicator, type IndicatorId } from "./indicators";
import {
  barOpenTime,
  buildPreviewHistory,
  buildPreviewSeries,
  candleAtPrice,
  INTERVAL_SECONDS,
  type ChartInterval,
  type PreviewCandle,
} from "./preview-price-data";

type ScaleMode = "normal" | "percent" | "log";
type Tool = "cursor" | DrawingKind;
type Menu = "interval" | "style" | "indicators" | null;
type IndicatorValues = Partial<Record<IndicatorId, Record<string, number>>>;

interface ActiveSeries {
  style: ChartStyle;
  api: ISeriesApi<SeriesType>;
}

const CHART_PREFS_KEY = "setryn:chart-prefs";
const DRAWINGS_KEY = "setryn:chart-drawings";
const INDICATOR_TAIL = 1_600;
const OSCILLATOR_STRETCH = 0.32;
const DRAG_THRESHOLD = 4;
const TOOL_SHORTCUTS: Partial<Record<DrawingKind, string>> = {
  trend: "Alt+T",
  hline: "Alt+H",
  vline: "Alt+V",
  rect: "Alt+R",
  fib: "Alt+F",
};
const SHORTCUT_TOOLS: Record<string, DrawingKind> = {
  KeyT: "trend",
  KeyH: "hline",
  KeyV: "vline",
  KeyR: "rect",
  KeyF: "fib",
};

/** Canvas fonts cannot read CSS variables, so the chart gets the resolved next/font family names. */
function resolvedFont(element: HTMLElement, variable: string, fallback: string): string {
  const family = getComputedStyle(element).getPropertyValue(variable).trim();
  return family ? `${family}, ${fallback}` : fallback;
}

export interface PositionPriceOverlay {
  id: string;
  entryPrice: number;
  lots: number;
  side: "LONG" | "SHORT";
}

export interface WorkingOrderPriceOverlay {
  id: string;
  limitPrice: number;
  lots: number;
  side: "ENTER" | "EXIT";
  packageSide: "LONG" | "SHORT";
}

function shortOverlayId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 4) return trimmed.toUpperCase();
  return trimmed.slice(-4).toUpperCase();
}

function formatOverlayLots(lots: number): string {
  if (!Number.isFinite(lots)) return "0";
  const bounded = Number(lots.toFixed(4));
  return bounded.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function toBar(candle: PreviewCandle): BarData<UTCTimestamp> {
  return { time: candle.time as UTCTimestamp, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
}

function toLine(candle: PreviewCandle): LineData<UTCTimestamp> {
  return { time: candle.time as UTCTimestamp, value: candle.close };
}

function setSeriesData(series: ActiveSeries, candles: PreviewCandle[]) {
  if (isOhlcStyle(series.style)) series.api.setData(candles.map(toBar));
  else series.api.setData(candles.map(toLine));
}

function updateSeries(series: ActiveSeries, candle: PreviewCandle) {
  if (isOhlcStyle(series.style)) series.api.update(toBar(candle));
  else series.api.update(toLine(candle));
}

function resetVisibleRange(chart: IChartApi, points: number) {
  const visible = Math.min(points, 120);
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, points - visible), to: points + 6 });
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function newDrawingId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

interface ChartPrefs {
  interval: ChartInterval;
  style: ChartStyle;
  indicators: IndicatorId[];
  scale: ScaleMode;
  magnet: boolean;
}

const DEFAULT_PREFS: ChartPrefs = {
  interval: "15m",
  style: "candles",
  indicators: ["volume", "ma7", "ma25"],
  scale: "normal",
  magnet: false,
};
const NO_DRAWINGS: Drawing[] = [];

function parsePrefs(value: unknown): ChartPrefs | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  // Earlier preferences stored `mode` and always drew volume.
  const legacy = record.style === undefined && typeof record.mode === "string";
  const styleValue = legacy ? record.mode : record.style;
  const indicators = Array.isArray(record.indicators)
    ? (record.indicators as string[]).filter((id): id is IndicatorId => INDICATOR_BY_ID.has(id as IndicatorId))
    : DEFAULT_PREFS.indicators;
  return {
    interval: ALL_INTERVALS.includes(record.interval as ChartInterval)
      ? (record.interval as ChartInterval)
      : DEFAULT_PREFS.interval,
    style: CHART_STYLES.some((option) => option.id === styleValue) ? (styleValue as ChartStyle) : DEFAULT_PREFS.style,
    indicators: legacy && !indicators.includes("volume") ? ["volume", ...indicators] : indicators,
    scale:
      record.scale === "normal" || record.scale === "percent" || record.scale === "log"
        ? record.scale
        : DEFAULT_PREFS.scale,
    magnet: record.magnet === true,
  };
}

interface Readout {
  candle: PreviewCandle;
  previousClose: number;
}

function indicatorDecimals(id: IndicatorId, priceDecimals: number): number {
  if (id === "rsi") return 2;
  if (id === "macd") return priceDecimals + 1;
  return priceDecimals;
}

function ToolbarButton({
  label,
  active = false,
  onClick,
  children,
  className = "",
  shortcut,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`focus-ring grid h-7 min-w-7 shrink-0 place-items-center rounded-[5px] px-1 transition-colors duration-150 ${
        active ? "bg-brand/12 text-brand" : "text-faint hover:bg-raised hover:text-ink"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function MenuPanel({
  onClose,
  className = "",
  children,
}: {
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
      <div
        className={`menu-pop absolute top-full z-50 mt-1 rounded-lg border border-line-strong bg-raised p-1 shadow-[0_18px_48px_rgba(0,0,0,0.6)] ${className}`}
      >
        {children}
      </div>
    </>
  );
}

export function PackagePriceChart({
  market,
  baseMarket,
  previewEpochSeconds,
  positionOverlays = [],
  orderOverlays = [],
  onAmendOrderPrice,
}: {
  market: PackageMarket;
  baseMarket: PackageMarket;
  previewEpochSeconds: number;
  positionOverlays?: PositionPriceOverlay[];
  orderOverlays?: WorkingOrderPriceOverlay[];
  /** Dragging a working order's line proposes this limit price; the ticket still confirms and signs the amendment. */
  onAmendOrderPrice?: (orderId: string, price: number) => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ActiveSeries | null>(null);
  const primitiveRef = useRef<DrawingsPrimitive | null>(null);
  const watermarkRef = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  const indicatorRefs = useRef<Map<IndicatorId, ISeriesApi<SeriesType>[]>>(new Map());
  const candlesRef = useRef<PreviewCandle[]>([]);
  const displayedRef = useRef<PreviewCandle[]>([]);
  const intervalRef = useRef<ChartInterval>(DEFAULT_PREFS.interval);
  const pendingRangeRef = useRef<number | null | undefined>(undefined);
  /** What the range effect does once every series holds the new bars. */
  const rangeActionRef = useRef<{ type: "reset" } | { type: "restore"; from: number; to: number } | null>(null);
  const loadedHistoryRef = useRef<PreviewCandle[] | null>(null);
  const lastTradeRef = useRef<string | null>(null);
  const fontsRef = useRef({ mono: "ui-monospace, monospace", serif: "Georgia, serif" });
  const setDrawingsRef = useRef<(next: Drawing[] | ((current: Drawing[]) => Drawing[])) => void>(() => undefined);
  const live = useRef({
    tool: "cursor" as Tool,
    magnet: false,
    locked: false,
    visible: true,
    drawings: NO_DRAWINGS,
    selectedId: null as string | null,
    draft: null as Drawing | null,
    decimals: baseMarket.priceDecimals,
    tick: baseMarket.tickSize,
    orders: [] as WorkingOrderPriceOverlay[],
    onAmend: undefined as ((orderId: string, price: number) => void) | undefined,
  });

  const [prefs, setPrefs] = usePersistentState(CHART_PREFS_KEY, DEFAULT_PREFS, parsePrefs);
  const { interval, style, indicators, scale, magnet } = prefs;
  const [autoScale, setAutoScale] = useState(true);
  const [menu, setMenu] = useState<Menu>(null);
  const [indicatorQuery, setIndicatorQuery] = useState("");
  const [activeRange, setActiveRange] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("cursor");
  const [storedDrawings, setDrawings] = usePersistentState(`${DRAWINGS_KEY}:${market.id}`, NO_DRAWINGS, parseDrawings);
  const [editing, setEditing] = useState<Drawing[] | null>(null);
  const drawings = editing ?? storedDrawings;
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [orderPreview, setOrderPreview] = useState<{ price: number; label: string; color: string } | null>(null);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [locked, setLocked] = useState(false);
  const [hover, setHover] = useState<Readout | null>(null);
  const [latest, setLatest] = useState<Readout | null>(null);
  const [hoverValues, setHoverValues] = useState<IndicatorValues | null>(null);
  const [latestValues, setLatestValues] = useState<IndicatorValues>({});
  const [paneLegends, setPaneLegends] = useState<{ id: IndicatorId; top: number }[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const trades = usePreviewTrades(market.id);

  const chooseInterval = (next: ChartInterval) => {
    setActiveRange(null);
    setMenu(null);
    setPrefs((current) => ({ ...current, interval: next }));
  };
  const chooseStyle = (next: ChartStyle) => {
    setMenu(null);
    setPrefs((current) => ({ ...current, style: next }));
  };
  const setScale = (next: ScaleMode) => setPrefs((current) => ({ ...current, scale: next }));
  const toggleMagnet = () => setPrefs((current) => ({ ...current, magnet: !current.magnet }));
  const toggleIndicator = (id: IndicatorId) =>
    setPrefs((current) => ({
      ...current,
      indicators: current.indicators.includes(id)
        ? current.indicators.filter((item) => item !== id)
        : [...current.indicators, id],
    }));
  const chooseTool = useCallback((next: Tool) => {
    setDraft(null);
    setSelectedId(null);
    setTool((current) => (current === next ? "cursor" : next));
  }, []);

  useEffect(() => {
    setDrawingsRef.current = setDrawings;
    intervalRef.current = interval;
    live.current = {
      tool,
      magnet,
      locked,
      visible: drawingsVisible,
      drawings,
      selectedId,
      draft,
      decimals: baseMarket.priceDecimals,
      tick: baseMarket.tickSize,
      orders: orderOverlays,
      onAmend: onAmendOrderPrice,
    };
  });

  useEffect(() => {
    chartRef.current?.applyOptions({
      crosshair: { mode: magnet ? CrosshairMode.Magnet : CrosshairMode.Normal },
    });
  }, [magnet]);

  const series = useMemo(
    () => buildPreviewSeries(baseMarket),
    // The history is a pure function of these fields; the live market only moves the last candle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseMarket.id, baseMarket.netPrice, baseMarket.priorNetPrice, baseMarket.priceDecimals, baseMarket.tickSize],
  );
  const history = useMemo(() => buildPreviewHistory(series, interval), [series, interval]);
  const unit = priceUnitSuffix(market.priceUnit);
  const rising = baseMarket.netPrice >= baseMarket.priorNetPrice;

  /** Fractional bar index of a timestamp, extrapolated past either end of the loaded bars. */
  const timeToLogical = useCallback((time: number): number | null => {
    const candles = candlesRef.current;
    if (candles.length === 0) return null;
    const step = INTERVAL_SECONDS[intervalRef.current];
    const lastIndex = candles.length - 1;
    const first = candles[0].time;
    const last = candles[lastIndex].time;
    if (time <= first) return (time - first) / step;
    if (time >= last) return lastIndex + (time - last) / step;
    let low = 0;
    let high = lastIndex;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (candles[middle].time <= time) low = middle;
      else high = middle;
    }
    const span = candles[high].time - candles[low].time;
    return low + (span > 0 ? (time - candles[low].time) / span : 0);
  }, []);

  const logicalToTime = useCallback((logical: number): number | null => {
    const candles = candlesRef.current;
    if (candles.length === 0) return null;
    const index = Math.round(logical);
    const step = INTERVAL_SECONDS[intervalRef.current];
    const lastIndex = candles.length - 1;
    if (index < 0) return candles[0].time + index * step;
    if (index > lastIndex) return candles[lastIndex].time + (index - lastIndex) * step;
    return candles[index].time;
  }, []);

  const applyRange = useCallback((seconds: number | null) => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || candles.length === 0) return;
    if (seconds === null) {
      chart.timeScale().fitContent();
      return;
    }
    const to = candles[candles.length - 1].time;
    chart.timeScale().setVisibleRange({
      from: Math.max(candles[0].time, to - seconds) as UTCTimestamp,
      to: (to + INTERVAL_SECONDS[intervalRef.current] * 4) as UTCTimestamp,
    });
  }, []);

  const updatePaneLayout = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const tops: number[] = [];
    let top = 0;
    for (const pane of chart.panes()) {
      tops.push(top);
      top += pane.getHeight() + 1;
    }
    const legends: { id: IndicatorId; top: number }[] = [];
    for (const [id, list] of indicatorRefs.current) {
      if (INDICATOR_BY_ID.get(id)?.placement !== "pane" || !list[0]) continue;
      const index = list[0].getPane().paneIndex();
      if (index > 0 && tops[index] !== undefined) legends.push({ id, top: tops[index] });
    }
    setPaneLegends(legends);
  }, []);

  // One chart per price precision. Pointer handling for drawings lives here because it needs the chart instance.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    const monoFont = resolvedFont(element, "--font-plex-mono", "ui-monospace, SFMono-Regular, Menlo, monospace");
    const serifFont = resolvedFont(element, "--font-newsreader", "Georgia, serif");
    fontsRef.current = { mono: monoFont, serif: serifFont };
    // The canvas background follows the panel token, so the chart never drifts from the surrounding surface.
    const panelColor = getComputedStyle(element).getPropertyValue("--color-panel").trim() || CHART_THEME.panel;
    const chart = createChart(element, {
      width: Math.max(1, Math.floor(element.clientWidth)),
      height: Math.max(1, Math.floor(element.clientHeight)),
      layout: {
        background: { type: ColorType.Solid, color: panelColor },
        textColor: CHART_THEME.faint,
        fontFamily: monoFont,
        fontSize: 11,
        attributionLogo: false,
        panes: {
          separatorColor: CHART_THEME.border,
          separatorHoverColor: "rgba(193, 255, 18, 0.18)",
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: CHART_THEME.grid },
        horzLines: { color: CHART_THEME.grid },
      },
      rightPriceScale: {
        visible: true,
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.08, bottom: 0.2 },
      },
      timeScale: {
        visible: true,
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
          tickMarkType >= TickMarkType.Time
            ? formatUtcClock(time as number)
            : formatUtcStamp(time as number, false),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CHART_THEME.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#303036",
        },
        horzLine: {
          color: CHART_THEME.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#303036",
        },
      },
      localization: {
        timeFormatter: (time: Time) => formatUtcStamp(time as number),
      },
    });
    chartRef.current = chart;
    watermarkRef.current = createTextWatermark(chart.panes()[0], {
      horzAlign: "center",
      vertAlign: "center",
      lines: [
        {
          text: "",
          color: "rgba(242, 240, 237, 0.035)",
          fontSize: 44,
          fontFamily: serifFont,
          fontStyle: "",
        },
      ],
    });
    const primitive = new DrawingsPrimitive((time) => {
      const logical = timeToLogical(time);
      return logical === null ? null : chart.timeScale().logicalToCoordinate(logical as Logical);
    });
    primitiveRef.current = primitive;

    const onMove = (param: MouseEventParams) => {
      const info = param.hoveredInfo;
      setHoveredId(info?.sourceKind === "series-primitive" && typeof info.objectId === "string" ? info.objectId : null);
      const active = seriesRef.current;
      if (!active || param.time === undefined) {
        setHover(null);
        setHoverValues(null);
        return;
      }
      const point = param.seriesData.get(active.api);
      if (!point) {
        setHover(null);
        setHoverValues(null);
        return;
      }
      const index = Math.round(timeToLogical(param.time as number) ?? -1);
      const raw = candlesRef.current[index];
      const shown =
        "open" in point
          ? { open: point.open, high: point.high, low: point.low, close: point.close }
          : {
              open: (point as LineData<Time>).value,
              high: (point as LineData<Time>).value,
              low: (point as LineData<Time>).value,
              close: (point as LineData<Time>).value,
            };
      const previous = displayedRef.current[index - 1];
      setHover({
        candle: { time: param.time as number, ...shown, volume: raw?.volume ?? 0 },
        previousClose: previous ? previous.close : shown.open,
      });
      const values: IndicatorValues = {};
      for (const [id, list] of indicatorRefs.current) {
        const spec = INDICATOR_BY_ID.get(id);
        if (!spec) continue;
        const row: Record<string, number> = {};
        list.forEach((item, line) => {
          const data = param.seriesData.get(item) as LineData<Time> | HistogramData<Time> | undefined;
          if (data && "value" in data) row[spec.lines[line].key] = data.value;
        });
        values[id] = row;
      }
      setHoverValues(values);
    };
    chart.subscribeCrosshairMove(onMove);

    // Drawing interaction. The chart pans on mousedown, so a press that starts or edits a drawing stops that
    // mousedown before it reaches the chart; the crosshair keeps following the pointer.
    type Gesture =
      | { type: "create"; start: { x: number; y: number }; moved: boolean }
      | { type: "order"; id: string; start: { x: number; y: number }; moved: boolean; price: number; color: string }
      | {
          type: "edit";
          id: string;
          anchor: number;
          origin: DrawingPoint;
          originLogical: number;
          base: Drawing[];
          start: { x: number; y: number };
          moved: boolean;
          result: Drawing[] | null;
        };
    let gesture: Gesture | null = null;
    let swallowMouseDown = false;

    const localPoint = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const inPricePane = (point: { x: number; y: number }) => {
      const height = chart.panes()[0]?.getHeight() ?? 0;
      return point.x >= 0 && point.x <= chart.timeScale().width() && point.y >= 0 && point.y <= height;
    };
    const anchorAt = (point: { x: number; y: number }, snap: boolean): DrawingPoint | null => {
      const active = seriesRef.current;
      if (!active) return null;
      const logical = chart.timeScale().coordinateToLogical(point.x);
      if (logical === null) return null;
      const index = Math.round(logical);
      const time = logicalToTime(index);
      const raw = active.api.coordinateToPrice(point.y);
      if (time === null || raw === null) return null;
      let price: number = raw;
      const bar = snap ? displayedRef.current[index] : undefined;
      if (bar) {
        let best = Number.POSITIVE_INFINITY;
        for (const value of [bar.open, bar.high, bar.low, bar.close]) {
          const y = active.api.priceToCoordinate(value);
          if (y !== null && Math.abs(y - point.y) < best) {
            best = Math.abs(y - point.y);
            price = value;
          }
        }
      }
      return { time, price: roundTo(price, live.current.decimals) };
    };
    const lockChart = (on: boolean) => chart.applyOptions({ handleScroll: !on, handleScale: !on });
    const claim = (event: PointerEvent) => {
      event.stopPropagation();
      swallowMouseDown = true;
    };
    const setLiveDraft = (next: Drawing | null) => {
      live.current.draft = next;
      setDraft(next);
    };
    const commit = (drawing: Drawing) => {
      setDrawingsRef.current((current) => [...current, drawing]);
      setSelectedId(drawing.id);
      setLiveDraft(null);
      setTool("cursor");
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const point = localPoint(event);
      if (!inPricePane(point)) return;
      const state = live.current;
      if (state.tool !== "cursor") {
        const anchor = anchorAt(point, state.magnet);
        if (!anchor) return;
        claim(event);
        if (state.draft) {
          commit({ ...state.draft, points: [state.draft.points[0], anchor] });
          return;
        }
        const kind = state.tool;
        if (DRAWING_ANCHORS[kind] === 1) {
          commit({ id: newDrawingId(), kind, points: [anchor] });
          return;
        }
        setLiveDraft({ id: newDrawingId(), kind, points: [anchor, anchor] });
        gesture = { type: "create", start: point, moved: false };
        lockChart(true);
        return;
      }
      const projection = primitiveRef.current?.projection();
      if (!projection) return;
      if (state.onAmend) {
        const handle = orderHandleAt(
          state.orders.map((order) => ({ id: order.id, price: order.limitPrice })),
          point.y,
          projection,
        );
        const order = handle ? state.orders.find((item) => item.id === handle.id) : undefined;
        if (handle && order) {
          claim(event);
          gesture = {
            type: "order",
            id: handle.id,
            start: point,
            moved: false,
            price: handle.price,
            color: executableAction(order.side, order.packageSide) === "BUY" ? CHART_THEME.up : CHART_THEME.down,
          };
          lockChart(true);
          return;
        }
      }
      if (state.locked || !state.visible) return;
      let hit: DrawingHit | null = null;
      for (const drawing of state.drawings) {
        const candidate = hitTestDrawing(drawing, point, projection);
        if (!candidate) continue;
        const better =
          !hit ||
          (candidate.anchor >= 0 && hit.anchor < 0) ||
          ((candidate.anchor >= 0) === (hit.anchor >= 0) && candidate.distance < hit.distance);
        if (better) hit = candidate;
      }
      if (!hit) {
        if (state.selectedId) setSelectedId(null);
        return;
      }
      const origin = anchorAt(point, false);
      const originLogical = chart.timeScale().coordinateToLogical(point.x);
      claim(event);
      setSelectedId(hit.id);
      if (!origin || originLogical === null) return;
      gesture = {
        type: "edit",
        id: hit.id,
        anchor: hit.anchor,
        origin,
        originLogical: Math.round(originLogical),
        base: state.drawings,
        start: point,
        moved: false,
        result: null,
      };
      lockChart(true);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!swallowMouseDown) return;
      swallowMouseDown = false;
      event.stopPropagation();
    };

    const onPointerMove = (event: PointerEvent) => {
      const state = live.current;
      if (!gesture && !state.draft) return;
      const point = localPoint(event);
      if (gesture?.type === "order") {
        if (!gesture.moved && Math.abs(point.y - gesture.start.y) < DRAG_THRESHOLD) return;
        gesture.moved = true;
        const raw = seriesRef.current?.api.coordinateToPrice(point.y);
        if (raw === null || raw === undefined) return;
        const price = roundTo(Math.round(raw / state.tick) * state.tick, state.decimals);
        gesture.price = price;
        setOrderPreview({ price, label: `Amend to ${price.toFixed(state.decimals)}`, color: gesture.color });
        return;
      }
      if (gesture?.type === "edit") {
        if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < DRAG_THRESHOLD) return;
        gesture.moved = true;
        const { anchor, id, origin, originLogical, base } = gesture;
        const target = anchorAt(point, state.magnet && anchor >= 0);
        const logicalNow = chart.timeScale().coordinateToLogical(point.x);
        if (!target || logicalNow === null) return;
        const shift = Math.round(logicalNow) - originLogical;
        const priceShift = target.price - origin.price;
        const moved = base.map((drawing) => {
          if (drawing.id !== id) return drawing;
          const points = drawing.points.map((existing, index) => {
            if (anchor >= 0) return index === anchor ? target : existing;
            const logical = timeToLogical(existing.time);
            const time =
              drawing.kind === "hline" || logical === null ? existing.time : (logicalToTime(Math.round(logical) + shift) ?? existing.time);
            const price = drawing.kind === "vline" ? existing.price : roundTo(existing.price + priceShift, state.decimals);
            return { time, price };
          });
          return { ...drawing, points };
        });
        gesture.result = moved;
        setEditing(moved);
        return;
      }
      if (!state.draft) return;
      if (gesture?.type === "create" && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) >= DRAG_THRESHOLD) {
        gesture.moved = true;
      }
      const anchor = anchorAt(point, state.magnet);
      if (anchor) setLiveDraft({ ...state.draft, points: [state.draft.points[0], anchor] });
    };

    const onPointerUp = () => {
      if (!gesture) {
        updatePaneLayout();
        return;
      }
      const finished = gesture;
      gesture = null;
      lockChart(false);
      if (finished.type === "order") {
        setOrderPreview(null);
        if (finished.moved) live.current.onAmend?.(finished.id, finished.price);
        return;
      }
      if (finished.type === "create") {
        // Press, drag, release draws in one gesture; a plain click waits for the second click.
        if (finished.moved && live.current.draft) commit(live.current.draft);
        return;
      }
      if (finished.moved && finished.result) setDrawingsRef.current(finished.result);
      setEditing(null);
    };

    element.addEventListener("pointerdown", onPointerDown, true);
    element.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 2 || box.height < 2) return;
      chart.resize(Math.floor(box.width), Math.floor(box.height));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePaneLayout);
    });
    observer.observe(element);
    const indicatorSeries = indicatorRefs.current;

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("pointerdown", onPointerDown, true);
      element.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      chart.unsubscribeCrosshairMove(onMove);
      watermarkRef.current?.detach();
      watermarkRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
      indicatorSeries.clear();
    };
  }, [baseMarket.priceDecimals, logicalToTime, timeToLogical, updatePaneLayout]);

  useEffect(() => {
    watermarkRef.current?.applyOptions({
      lines: [
        {
          text: `${market.id} · ${intervalLabel(interval)}`,
          color: "rgba(242, 240, 237, 0.035)",
          fontSize: 44,
          fontFamily: fontsRef.current.serif,
          fontStyle: "",
        },
      ],
    });
  }, [market.id, interval, baseMarket.priceDecimals]);

  // Main series: rebuilt when the style or the loaded bars change.
  useEffect(() => {
    const chart = chartRef.current;
    const primitive = primitiveRef.current;
    if (!chart || !primitive) return;
    // A style change keeps the viewport; new bars (interval or market) get a fresh one.
    const visible = chart.timeScale().getVisibleLogicalRange();
    rangeActionRef.current =
      loadedHistoryRef.current === history && visible
        ? { type: "restore", from: visible.from, to: visible.to }
        : { type: "reset" };
    loadedHistoryRef.current = history;
    if (seriesRef.current) {
      seriesRef.current.api.detachPrimitive(primitive);
      chart.removeSeries(seriesRef.current.api);
      seriesRef.current = null;
    }

    const priceFormat = {
      type: "price" as const,
      precision: baseMarket.priceDecimals,
      minMove: 10 ** -baseMarket.priceDecimals,
    };
    const common = {
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1 as const,
      lastValueVisible: true,
      priceFormat,
    };
    const lineColor = rising ? CHART_THEME.up : CHART_THEME.down;
    const lineCommon = {
      ...common,
      lineWidth: 2 as const,
      crosshairMarkerRadius: 3,
      crosshairMarkerBorderColor: CHART_THEME.panel,
      crosshairMarkerBackgroundColor: lineColor,
      priceLineColor: lineColor,
    };
    let api: ISeriesApi<SeriesType>;
    switch (style) {
      case "candles":
      case "heikin":
        api = chart.addSeries(CandlestickSeries, {
          ...common,
          upColor: CHART_THEME.up,
          downColor: CHART_THEME.down,
          wickUpColor: CHART_THEME.up,
          wickDownColor: CHART_THEME.down,
          borderVisible: false,
        });
        break;
      case "hollow":
        api = chart.addSeries(CandlestickSeries, {
          ...common,
          upColor: CHART_THEME.transparent,
          downColor: CHART_THEME.down,
          borderVisible: true,
          borderUpColor: CHART_THEME.up,
          borderDownColor: CHART_THEME.down,
          wickUpColor: CHART_THEME.up,
          wickDownColor: CHART_THEME.down,
        });
        break;
      case "bars":
        api = chart.addSeries(BarSeries, {
          ...common,
          upColor: CHART_THEME.up,
          downColor: CHART_THEME.down,
          thinBars: false,
          openVisible: true,
        });
        break;
      case "line":
      case "step":
        api = chart.addSeries(LineSeries, {
          ...lineCommon,
          color: lineColor,
          lineType: style === "step" ? LineType.WithSteps : LineType.Simple,
        });
        break;
      case "area":
        api = chart.addSeries(AreaSeries, {
          ...lineCommon,
          lineColor,
          topColor: rising ? CHART_THEME.upFill : CHART_THEME.downFill,
          bottomColor: CHART_THEME.transparent,
        });
        break;
      case "baseline":
        api = chart.addSeries(BaselineSeries, {
          ...lineCommon,
          baseValue: { type: "price", price: baseMarket.priorNetPrice },
          topLineColor: CHART_THEME.up,
          topFillColor1: "rgba(63, 217, 164, 0.22)",
          topFillColor2: "rgba(63, 217, 164, 0.02)",
          bottomLineColor: CHART_THEME.down,
          bottomFillColor1: "rgba(255, 93, 122, 0.02)",
          bottomFillColor2: "rgba(255, 93, 122, 0.22)",
        });
        break;
    }
    const active: ActiveSeries = { style, api };

    const candles = history.map((candle) => ({ ...candle }));
    const displayed = style === "heikin" ? heikinAshi(candles) : candles;
    candlesRef.current = candles;
    displayedRef.current = displayed;
    setSeriesData(active, displayed);
    api.createPriceLine({
      price: baseMarket.priorNetPrice,
      color: CHART_THEME.off,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: "prior",
    });
    api.attachPrimitive(primitive);
    seriesRef.current = active;
    const last = displayed[displayed.length - 1];
    setLatest(last ? { candle: { ...last, volume: candles[candles.length - 1].volume }, previousClose: displayed[displayed.length - 2]?.close ?? last.open } : null);
    setHover(null);

    return () => {
      if (chartRef.current && seriesRef.current === active) {
        api.detachPrimitive(primitive);
        chart.removeSeries(api);
        seriesRef.current = null;
      }
    };
  }, [baseMarket.priceDecimals, baseMarket.priorNetPrice, history, style, rising]);

  // Indicators are recomputed from the same raw bars the chart draws, on the price pane or their own panes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const existing = indicatorRefs.current;
    for (const list of existing.values()) for (const item of list) chart.removeSeries(item);
    existing.clear();

    const values: IndicatorValues = {};
    for (const spec of INDICATORS) {
      if (!indicators.includes(spec.id)) continue;
      const output = computeIndicator(spec.id, candlesRef.current);
      const precision = indicatorDecimals(spec.id, baseMarket.priceDecimals);
      const priceFormat = { type: "price" as const, precision, minMove: 10 ** -precision };
      const paneIndex = spec.placement === "pane" ? chart.panes().length : 0;
      const created: ISeriesApi<SeriesType>[] = [];
      const row: Record<string, number> = {};
      spec.lines.forEach((line, lineIndex) => {
        const target = lineIndex === 0 ? paneIndex : created[0].getPane().paneIndex();
        let item: ISeriesApi<SeriesType>;
        if (spec.placement === "volume") {
          item = chart.addSeries(
            HistogramSeries,
            { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false },
            0,
          );
          chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
        } else if (line.kind === "histogram") {
          item = chart.addSeries(
            HistogramSeries,
            { color: line.color, priceFormat, lastValueVisible: false, priceLineVisible: false },
            target,
          );
        } else {
          item = chart.addSeries(
            LineSeries,
            {
              color: line.color,
              lineWidth: spec.placement === "pane" ? 2 : 1,
              priceLineVisible: false,
              lastValueVisible: spec.placement === "pane",
              crosshairMarkerVisible: spec.placement === "pane",
              crosshairMarkerRadius: 2,
              priceFormat,
            },
            target,
          );
        }
        const points = output[line.key] ?? [];
        item.setData(
          points.map((point) =>
            point.color
              ? { time: point.time as UTCTimestamp, value: point.value, color: point.color }
              : { time: point.time as UTCTimestamp, value: point.value },
          ),
        );
        const last = points[points.length - 1];
        if (last) row[line.key] = last.value;
        created.push(item);
      });
      if (spec.placement === "pane" && created[0]) {
        created[0].getPane().setStretchFactor(OSCILLATOR_STRETCH);
        const guideHost = created.find((_, index) => spec.lines[index].kind === "line") ?? created[0];
        for (const guide of spec.guides ?? []) {
          guideHost.createPriceLine({
            price: guide,
            color: "rgba(242, 240, 237, 0.18)",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: "",
          });
        }
      }
      existing.set(spec.id, created);
      values[spec.id] = row;
    }
    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.08, bottom: indicators.includes("volume") ? 0.2 : 0.06 },
    });
    setLatestValues(values);
    const frame = requestAnimationFrame(updatePaneLayout);
    return () => cancelAnimationFrame(frame);
  }, [indicators, history, baseMarket.priceDecimals, updatePaneLayout]);

  // The viewport is set after the price and indicator series hold the same bars; the time scale is the union of
  // every series, so a range applied earlier would be measured against the previous interval.
  useEffect(() => {
    const chart = chartRef.current;
    const action = rangeActionRef.current;
    if (!chart || !action) return;
    rangeActionRef.current = null;
    if (pendingRangeRef.current !== undefined) {
      applyRange(pendingRangeRef.current);
      pendingRangeRef.current = undefined;
    } else if (action.type === "restore") {
      chart.timeScale().setVisibleLogicalRange({ from: action.from, to: action.to });
    } else {
      resetVisibleRange(chart, candlesRef.current.length);
    }
  }, [applyRange, history, style]);

  // Live: every preview print moves the last bar and adds its lots to the volume bar.
  useEffect(() => {
    const active = seriesRef.current;
    const candles = candlesRef.current;
    const previous = candles[candles.length - 1];
    if (!active || !previous) return;
    const print = trades[0];
    const fresh = print && print.id !== lastTradeRef.current ? print : null;
    if (fresh) lastTradeRef.current = fresh.id;
    const next = candleAtPrice(previous, previewEpochSeconds, market.netPrice, interval, fresh?.lots ?? 0);
    const appended = next.time !== previous.time;
    if (appended) candles.push(next);
    else candles[candles.length - 1] = next;

    let shown = next;
    if (active.style === "heikin") {
      const displayed = displayedRef.current;
      if (appended) {
        shown = heikinAshiBar(next, displayed[displayed.length - 1]);
        displayed.push(shown);
      } else {
        shown = heikinAshiBar(next, displayed[displayed.length - 2]);
        displayed[displayed.length - 1] = shown;
      }
    } else {
      displayedRef.current = candles;
    }
    updateSeries(active, shown);

    const values: IndicatorValues = {};
    const tail = candles.slice(-INDICATOR_TAIL);
    for (const [id, list] of indicatorRefs.current) {
      const spec = INDICATOR_BY_ID.get(id);
      if (!spec) continue;
      const output = computeIndicator(id, tail);
      const row: Record<string, number> = {};
      list.forEach((item, index) => {
        const point = output[spec.lines[index].key]?.at(-1);
        if (!point) return;
        item.update(
          point.color
            ? { time: point.time as UTCTimestamp, value: point.value, color: point.color }
            : { time: point.time as UTCTimestamp, value: point.value },
        );
        row[spec.lines[index].key] = point.value;
      });
      values[id] = row;
    }
    setLatestValues(values);
    const displayed = displayedRef.current;
    setLatest({
      candle: { ...shown, volume: next.volume },
      previousClose: displayed[displayed.length - 2]?.close ?? shown.open,
    });
    // Driven by the shared market clock and prints only.
  }, [interval, market.netPrice, previewEpochSeconds, trades]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale("right").applyOptions({
      mode:
        scale === "log"
          ? PriceScaleMode.Logarithmic
          : scale === "percent"
            ? PriceScaleMode.Percentage
            : PriceScaleMode.Normal,
      autoScale,
    });
  }, [scale, autoScale]);

  // Positions and working orders as labelled price lines.
  useEffect(() => {
    const active = seriesRef.current;
    if (!active) return;
    const lines: IPriceLine[] = [];
    for (const position of positionOverlays) {
      if (!Number.isFinite(position.entryPrice)) continue;
      const entryLabel = position.side === "LONG" ? "Long position" : "Short position";
      lines.push(
        active.api.createPriceLine({
          price: position.entryPrice,
          color: CHART_THEME.brand,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${entryLabel} ${shortOverlayId(position.id)} ${formatOverlayLots(position.lots)} lots`,
        }),
      );
    }
    for (const order of orderOverlays) {
      if (!Number.isFinite(order.limitPrice)) continue;
      const sideLabel = order.packageSide === "LONG" ? "Long" : "Short";
      const intentLabel = order.side === "ENTER" ? "entry" : "exit";
      const action = executableAction(order.side, order.packageSide);
      lines.push(
        active.api.createPriceLine({
          price: order.limitPrice,
          color: action === "BUY" ? CHART_THEME.up : CHART_THEME.down,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${action === "BUY" ? "Buy" : "Sell"} limit, ${sideLabel.toLowerCase()} ${intentLabel} ${shortOverlayId(order.id)} ${formatOverlayLots(order.lots)} lots`,
        }),
      );
    }
    return () => {
      for (const line of lines) {
        try {
          active.api.removePriceLine(line);
        } catch {
          continue;
        }
      }
    };
  }, [positionOverlays, orderOverlays, style, history, rising]);

  // Everything the drawing layer paints, including the bar-close countdown on the price axis.
  const barsBetween = useCallback(
    (from: number, to: number) => {
      const start = timeToLogical(from);
      const end = timeToLogical(to);
      return start === null || end === null ? 0 : Math.round(end - start);
    },
    [timeToLogical],
  );
  const countdownSeconds = barOpenTime(previewEpochSeconds, interval) + INTERVAL_SECONDS[interval] - previewEpochSeconds;
  const latestCandle = latest?.candle ?? null;
  useEffect(() => {
    primitiveRef.current?.setScene({
      drawings,
      draft,
      selectedId,
      hoveredId,
      visible: drawingsVisible,
      priceDecimals: baseMarket.priceDecimals,
      fontFamily: fontsRef.current.mono,
      barsBetween,
      formatTime: (time) => formatUtcStamp(time),
      countdown: latestCandle
        ? {
            price: latestCandle.close,
            text: formatCountdown(countdownSeconds),
            color: isOhlcStyle(style)
              ? latestCandle.close >= latestCandle.open
                ? CHART_THEME.up
                : CHART_THEME.down
              : rising
                ? CHART_THEME.up
                : CHART_THEME.down,
          }
        : null,
      orderHandles: onAmendOrderPrice
        ? orderOverlays.map((order) => ({ id: order.id, price: order.limitPrice }))
        : [],
      orderPreview,
    });
  }, [
    orderOverlays,
    onAmendOrderPrice,
    orderPreview,
    drawings,
    draft,
    selectedId,
    hoveredId,
    drawingsVisible,
    baseMarket.priceDecimals,
    barsBetween,
    latestCandle,
    countdownSeconds,
    style,
    history,
    rising,
  ]);

  const removeSelected = useCallback(() => {
    const id = live.current.selectedId;
    if (!id) return;
    setDrawingsRef.current((current) => current.filter((drawing) => drawing.id !== id));
    setSelectedId(null);
  }, []);

  const reset = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    setAutoScale(true);
    setActiveRange(null);
    resetVisibleRange(chart, candlesRef.current.length);
  }, []);

  // Keyboard: Esc cancels, Delete removes the selected drawing, Alt shortcuts pick tools while the chart is hovered.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const state = live.current;
      if (event.key === "Escape") {
        if (state.draft) setDraft(null);
        else if (state.tool !== "cursor") setTool("cursor");
        else if (state.selectedId) setSelectedId(null);
        else return;
        event.preventDefault();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId && !state.locked) {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (!event.altKey || !shell.current?.matches(":hover")) return;
      if (event.code === "KeyX") {
        event.preventDefault();
        reset();
        return;
      }
      const next = SHORTCUT_TOOLS[event.code];
      if (next) {
        event.preventDefault();
        chooseTool(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chooseTool, removeSelected, reset]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const showRange = (range: (typeof RANGES)[number]) => {
    setActiveRange(range.label);
    if (range.interval !== interval) {
      pendingRangeRef.current = range.seconds;
      setPrefs((current) => ({ ...current, interval: range.interval }));
      return;
    }
    applyRange(range.seconds);
  };
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === shell.current) void document.exitFullscreen();
    else if (!document.fullscreenElement) void shell.current?.requestFullscreen();
  }, []);
  const screenshot = useCallback(() => {
    const canvas = chartRef.current?.takeScreenshot();
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `setryn-${market.id}-${interval}.png`;
    link.click();
  }, [interval, market.id]);

  const readoutState = hover ?? latest;
  const readout = readoutState?.candle ?? null;
  const previousClose = readoutState?.previousClose ?? null;
  const change = readout && previousClose !== null ? readout.close - previousClose : 0;
  const changePercent = readout && previousClose ? (change / Math.abs(previousClose)) * 100 : 0;
  const changeTone = change >= 0 ? "text-up" : "text-down";
  const values = hoverValues ?? latestValues;
  const overlays = INDICATORS.filter((spec) => spec.placement === "overlay" && indicators.includes(spec.id));
  const inlineIntervals = FAVORITE_INTERVALS.includes(interval) ? FAVORITE_INTERVALS : [...FAVORITE_INTERVALS, interval];
  const activeStyle = CHART_STYLES.find((option) => option.id === style) ?? CHART_STYLES[0];
  const query = indicatorQuery.trim().toLowerCase();
  const indicatorMatches = (placement: "price" | "pane") =>
    INDICATORS.filter(
      (spec) =>
        (placement === "pane" ? spec.placement === "pane" : spec.placement !== "pane") &&
        (!query || `${spec.label} ${spec.describe}`.toLowerCase().includes(query)),
    );
  const selectedDrawing = selectedId ? drawings.find((drawing) => drawing.id === selectedId) : undefined;
  const drawingHint =
    tool === "cursor"
      ? null
      : draft
        ? `${DRAWING_LABEL[tool]}: click to place the second point. Esc cancels.`
        : `${DRAWING_LABEL[tool]}: ${DRAWING_ANCHORS[tool] === 1 ? "click to place" : "click, or press and drag, to place"}.`;

  const formatValue = (id: IndicatorId, value: number | undefined) =>
    value === undefined ? "–" : formatNumber(value, indicatorDecimals(id, baseMarket.priceDecimals));

  return (
    <div ref={shell} className="flex min-h-0 w-full flex-1 flex-col bg-panel">
      <div className="relative z-30 flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
        <div role="group" aria-label="Chart interval" className="hidden items-center gap-0.5 sm:flex">
          {inlineIntervals.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => chooseInterval(option)}
              aria-pressed={interval === option}
              title={intervalName(option)}
              className={`focus-ring h-7 rounded-[5px] px-1.5 font-mono text-xs transition-colors duration-150 ${
                interval === option ? "bg-raised text-ink" : "text-faint hover:bg-raised hover:text-dim"
              }`}
            >
              {intervalLabel(option)}
            </button>
          ))}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu(menu === "interval" ? null : "interval")}
            aria-expanded={menu === "interval"}
            aria-label={`Interval: ${intervalName(interval)}. All intervals`}
            title="All intervals"
            className={`focus-ring flex h-7 items-center gap-1 rounded-[5px] px-1.5 transition-colors duration-150 ${
              menu === "interval" ? "bg-raised text-ink" : "text-faint hover:bg-raised hover:text-ink"
            }`}
          >
            <span className="font-mono text-xs text-ink sm:hidden">{intervalLabel(interval)}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {menu === "interval" ? (
            <MenuPanel onClose={() => setMenu(null)} className="left-0 w-48">
              {INTERVAL_GROUPS.map((group) => (
                <div key={group.label} className="py-0.5">
                  <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-[0.08em] text-off uppercase">{group.label}</div>
                  {group.intervals.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => chooseInterval(option)}
                      className={`flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-left text-xs transition-colors hover:bg-panel ${
                        interval === option ? "text-ink" : "text-dim"
                      }`}
                    >
                      <span>{intervalName(option)}</span>
                      {interval === option ? <Check size={13} className="text-brand" aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              ))}
            </MenuPanel>
          ) : null}
        </div>
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu(menu === "style" ? null : "style")}
            aria-expanded={menu === "style"}
            aria-label={`Chart type: ${activeStyle.label}`}
            title={activeStyle.label}
            className={`focus-ring flex h-7 items-center gap-0.5 rounded-[5px] px-1 transition-colors duration-150 ${
              menu === "style" ? "bg-raised text-ink" : "text-dim hover:bg-raised hover:text-ink"
            }`}
          >
            <ChartStyleIcon style={style} />
            <ChevronDown size={11} aria-hidden="true" className="text-faint" />
          </button>
          {menu === "style" ? (
            <MenuPanel onClose={() => setMenu(null)} className="left-0 w-48">
              {CHART_STYLES.map((option, index) => (
                <div key={option.id}>
                  {index === 4 ? <div aria-hidden="true" className="mx-2 my-1 h-px bg-line" /> : null}
                  <button
                    type="button"
                    onClick={() => chooseStyle(option.id)}
                    className={`flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left text-xs transition-colors hover:bg-panel ${
                      style === option.id ? "text-ink" : "text-dim"
                    }`}
                  >
                    <span className={style === option.id ? "text-brand" : "text-faint"}>
                      <ChartStyleIcon style={option.id} />
                    </span>
                    <span className="flex-1">{option.label}</span>
                    {style === option.id ? <Check size={13} className="text-brand" aria-hidden="true" /> : null}
                  </button>
                </div>
              ))}
            </MenuPanel>
          ) : null}
        </div>
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setIndicatorQuery("");
              setMenu(menu === "indicators" ? null : "indicators");
            }}
            aria-expanded={menu === "indicators"}
            className={`focus-ring flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-xs transition-colors duration-150 ${
              menu === "indicators" ? "bg-raised text-ink" : "text-dim hover:bg-raised hover:text-ink"
            }`}
          >
            <Sigma size={14} aria-hidden="true" />
            Indicators
            {indicators.length > 0 ? (
              <span className="tnum rounded-sm bg-panel px-1 font-mono text-[10px] text-faint">{indicators.length}</span>
            ) : null}
          </button>
          {menu === "indicators" ? (
            <MenuPanel onClose={() => setMenu(null)} className="left-0 w-80">
              <label className="mb-1 flex items-center gap-2 rounded-[5px] border border-line bg-inset px-2 py-1.5">
                <Search size={13} aria-hidden="true" className="text-faint" />
                <input
                  autoFocus
                  value={indicatorQuery}
                  onChange={(event) => setIndicatorQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setMenu(null);
                  }}
                  placeholder="Search indicators"
                  aria-label="Search indicators"
                  className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-off"
                />
              </label>
              {(["price", "pane"] as const).map((placement) => {
                const matches = indicatorMatches(placement);
                if (matches.length === 0) return null;
                return (
                  <div key={placement} className="py-0.5">
                    <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-[0.08em] text-off uppercase">
                      {placement === "price" ? "On price" : "Oscillators, own pane"}
                    </div>
                    {matches.map((spec) => {
                      const on = indicators.includes(spec.id);
                      return (
                        <button
                          key={spec.id}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={on}
                          onClick={() => toggleIndicator(spec.id)}
                          className="flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left text-xs transition-colors hover:bg-panel"
                        >
                          <span
                            aria-hidden="true"
                            className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors ${
                              on ? "border-brand bg-brand text-app" : "border-line-strong"
                            }`}
                          >
                            {on ? <Check size={10} strokeWidth={3} /> : null}
                          </span>
                          <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: spec.lines[spec.lines.length > 1 && spec.id === "macd" ? 1 : 0].color }} />
                          <span className="shrink-0 text-ink">{spec.label}</span>
                          <span className="ml-auto truncate pl-2 text-[11px] text-off">{spec.describe}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </MenuPanel>
          ) : null}
        </div>
        <span className="flex-1" />
        <ToolbarButton label="Save chart image" onClick={screenshot}>
          <Camera size={14} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="Reset chart" shortcut="Alt+X" onClick={reset}>
          <RotateCcw size={13} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </ToolbarButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          role="toolbar"
          aria-label="Drawing tools"
          aria-orientation="vertical"
          className="no-scrollbar hidden w-10 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line py-1.5 sm:flex"
        >
          <ToolbarButton label="Cursor" active={tool === "cursor"} onClick={() => chooseTool("cursor")}>
            <CursorIcon />
          </ToolbarButton>
          <span aria-hidden="true" className="my-1 h-px w-5 shrink-0 bg-line" />
          {DRAWING_KINDS.map((kind) => (
            <ToolbarButton
              key={kind}
              label={DRAWING_LABEL[kind]}
              shortcut={TOOL_SHORTCUTS[kind]}
              active={tool === kind}
              onClick={() => chooseTool(kind)}
            >
              <DrawingIcon kind={kind} />
            </ToolbarButton>
          ))}
          <span aria-hidden="true" className="my-1 h-px w-5 shrink-0 bg-line" />
          <ToolbarButton label="Magnet: snap to open, high, low, close" active={magnet} onClick={toggleMagnet}>
            <Magnet size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            label={locked ? "Unlock drawings" : "Lock drawings"}
            active={locked}
            onClick={() => {
              setSelectedId(null);
              setLocked((value) => !value);
            }}
          >
            {locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
          </ToolbarButton>
          <ToolbarButton
            label={drawingsVisible ? "Hide drawings" : "Show drawings"}
            active={!drawingsVisible}
            onClick={() => setDrawingsVisible((visible) => !visible)}
          >
            {drawingsVisible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
          </ToolbarButton>
          <ToolbarButton
            label="Remove all drawings"
            onClick={() => {
              setSelectedId(null);
              setDraft(null);
              setDrawings([]);
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
          </ToolbarButton>
        </div>

        <div className={`relative min-h-0 min-w-0 flex-1 ${tool !== "cursor" ? "cursor-crosshair" : ""}`}>
          <div
            ref={holder}
            className="absolute inset-0"
            role="img"
            aria-label={`${intervalName(interval)} ${activeStyle.label.toLowerCase()} chart for ${market.name}. Current package price ${formatNumber(market.netPrice, market.priceDecimals)} ${unit}.`}
          />
          {readout ? (
            <div className="pointer-events-none absolute top-0 left-0 z-10 flex max-w-[calc(100%-72px)] flex-col gap-0.5 px-3 py-1.5 [text-shadow:0_0_4px_var(--color-panel),0_0_8px_var(--color-panel)]">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 font-mono text-[11px]">
                <span className="font-sans text-xs text-dim">
                  <span className="text-ink">{market.id}</span>
                  {` · ${intervalLabel(interval)} · ${activeStyle.label}`}
                </span>
                <span className="text-faint">
                  O <span className={changeTone}>{formatNumber(readout.open, market.priceDecimals)}</span>
                </span>
                <span className="text-faint">
                  H <span className={changeTone}>{formatNumber(readout.high, market.priceDecimals)}</span>
                </span>
                <span className="text-faint">
                  L <span className={changeTone}>{formatNumber(readout.low, market.priceDecimals)}</span>
                </span>
                <span className="text-faint">
                  C <span className={changeTone}>{formatNumber(readout.close, market.priceDecimals)}</span>
                </span>
                <span className={`tnum ${changeTone}`}>
                  {`${change >= 0 ? "+" : ""}${formatNumber(change, market.priceDecimals)} (${change >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)`}
                </span>
              </div>
              {indicators.includes("volume") ? (
                <div className="font-mono text-[11px] text-faint">
                  Vol <span className="text-dim">{`${formatLots(readout.volume)} lots`}</span>
                </div>
              ) : null}
              {overlays.map((spec) => (
                <div key={spec.id} className="group pointer-events-auto flex w-fit items-baseline gap-2 font-mono text-[11px]">
                  <span className="text-faint">{spec.label}</span>
                  {spec.lines.map((line) => (
                    <span key={line.key} style={{ color: line.color }}>
                      {formatValue(spec.id, values[spec.id]?.[line.key])}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => toggleIndicator(spec.id)}
                    aria-label={`Remove ${spec.label}`}
                    className="focus-ring grid h-4 w-4 place-items-center rounded-sm text-off opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {paneLegends.map(({ id, top }) => {
            const spec = INDICATOR_BY_ID.get(id);
            if (!spec) return null;
            return (
              <div
                key={id}
                className="group pointer-events-none absolute left-0 z-10 flex items-baseline gap-2 px-3 py-1 font-mono text-[11px]"
                style={{ top }}
              >
                <span className="text-dim">{spec.label}</span>
                {spec.lines.map((line) => (
                  <span key={line.key} style={{ color: line.kind === "histogram" ? CHART_THEME.dim : line.color }}>
                    {formatValue(id, values[id]?.[line.key])}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => toggleIndicator(id)}
                  aria-label={`Remove ${spec.label}`}
                  className="focus-ring pointer-events-auto grid h-4 w-4 place-items-center rounded-sm text-off opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {drawingHint ? (
            <div className="chip-in pointer-events-none absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-md border border-line-strong bg-raised/95 px-2.5 py-1 text-[11px] whitespace-nowrap text-dim shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
              {drawingHint}
            </div>
          ) : selectedDrawing && !locked ? (
            <div className="chip-in absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-line-strong bg-raised/95 py-0.5 pr-0.5 pl-2.5 text-[11px] whitespace-nowrap text-dim shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
              <span className="text-ink">{DRAWING_LABEL[selectedDrawing.kind]}</span>
              <span className="text-off">drag to move, anchors to reshape</span>
              <button
                type="button"
                onClick={removeSelected}
                aria-label="Delete drawing"
                title="Delete drawing (Del)"
                className="focus-ring ml-1 grid h-6 w-6 place-items-center rounded-[5px] text-faint transition-colors hover:bg-down/15 hover:text-down"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="no-scrollbar flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-t border-line px-1.5">
        <div role="group" aria-label="Visible range" className="flex items-center gap-0.5">
          {RANGES.map((range) => (
            <button
              key={range.label}
              type="button"
              onClick={() => showRange(range)}
              aria-pressed={activeRange === range.label}
              title={`${range.label} at ${intervalName(range.interval)}`}
              className={`focus-ring h-6 rounded-[5px] px-1.5 font-mono text-[11px] transition-colors duration-150 ${
                activeRange === range.label ? "bg-raised text-ink" : "text-faint hover:bg-raised hover:text-ink"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <span className="tnum mr-2 shrink-0 font-mono text-[11px] text-faint">
          {`${formatUtcClock(previewEpochSeconds)}:${String(previewEpochSeconds % 60).padStart(2, "0")} UTC`}
        </span>
        <span aria-hidden="true" className="mr-1 h-3.5 w-px shrink-0 bg-line" />
        <button
          type="button"
          onClick={() => setScale(scale === "percent" ? "normal" : "percent")}
          aria-pressed={scale === "percent"}
          title="Percentage scale"
          className={`focus-ring h-6 rounded-[5px] px-1.5 font-mono text-[11px] transition-colors ${scale === "percent" ? "text-brand" : "text-faint hover:text-ink"}`}
        >
          %
        </button>
        <button
          type="button"
          onClick={() => setScale(scale === "log" ? "normal" : "log")}
          aria-pressed={scale === "log"}
          title="Logarithmic scale"
          className={`focus-ring h-6 rounded-[5px] px-1.5 font-mono text-[11px] transition-colors ${scale === "log" ? "text-brand" : "text-faint hover:text-ink"}`}
        >
          log
        </button>
        <button
          type="button"
          onClick={() => setAutoScale((value) => !value)}
          aria-pressed={autoScale}
          title="Auto-fit the price scale"
          className={`focus-ring h-6 rounded-[5px] px-1.5 font-mono text-[11px] transition-colors ${autoScale ? "text-brand" : "text-faint hover:text-ink"}`}
        >
          auto
        </button>
      </div>
    </div>
  );
}
