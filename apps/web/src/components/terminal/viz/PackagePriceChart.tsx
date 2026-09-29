"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Camera,
  CandlestickChart,
  ChevronDown,
  Crosshair,
  Eye,
  EyeOff,
  LineChart,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  RotateCcw,
  Sigma,
  Trash2,
} from "lucide-react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  TickMarkType,
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
import { INDICATORS, computeIndicator, type IndicatorId } from "./indicators";
import {
  buildPreviewHistory,
  buildPreviewMinuteHistory,
  candleAtPrice,
  INTERVAL_SECONDS,
  type ChartInterval,
  type PreviewCandle,
} from "./preview-price-data";

type ChartMode = "candles" | "line" | "area";
type ScaleMode = "normal" | "percent" | "log";
type Tool = "cross" | "magnet" | "hline";

type ActiveSeries =
  | { mode: "candles"; api: ISeriesApi<"Candlestick"> }
  | { mode: "line"; api: ISeriesApi<"Line"> }
  | { mode: "area"; api: ISeriesApi<"Area"> };

const INTERVALS: ChartInterval[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const MODES: { id: ChartMode; label: string; icon: typeof CandlestickChart }[] = [
  { id: "candles", label: "Candles", icon: CandlestickChart },
  { id: "line", label: "Line", icon: LineChart },
  { id: "area", label: "Area", icon: AreaChart },
];
const RANGES: { label: string; seconds: number | null }[] = [
  { label: "1D", seconds: 86_400 },
  { label: "3D", seconds: 3 * 86_400 },
  { label: "1W", seconds: 7 * 86_400 },
  { label: "2W", seconds: 14 * 86_400 },
  { label: "1M", seconds: 30 * 86_400 },
  { label: "All", seconds: null },
];

const CHART_PREFS_KEY = "setryn:chart-prefs";
const DRAWINGS_KEY = "setryn:chart-drawings";
const INDICATOR_TAIL = 1_600;

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

function toCandlestickData(candle: PreviewCandle): CandlestickData<UTCTimestamp> {
  return {
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function toLineData(candle: PreviewCandle): LineData<UTCTimestamp> {
  return { time: candle.time as UTCTimestamp, value: candle.close };
}

function toVolumeData(candle: PreviewCandle): HistogramData<UTCTimestamp> {
  return {
    time: candle.time as UTCTimestamp,
    value: candle.volume,
    color: candle.close >= candle.open ? CHART_THEME.upVolume : CHART_THEME.downVolume,
  };
}

function setSeriesData(series: ActiveSeries, candles: PreviewCandle[]) {
  if (series.mode === "candles") series.api.setData(candles.map(toCandlestickData));
  else series.api.setData(candles.map(toLineData));
}

function updateSeries(series: ActiveSeries, candle: PreviewCandle) {
  if (series.mode === "candles") series.api.update(toCandlestickData(candle));
  else series.api.update(toLineData(candle));
}

function resetVisibleRange(chart: IChartApi, points: number) {
  const visible = Math.min(points, 120);
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, points - visible), to: points + 6 });
}

interface ChartPrefs {
  interval: ChartInterval;
  mode: ChartMode;
  indicators: IndicatorId[];
  scale: ScaleMode;
}

const DEFAULT_PREFS: ChartPrefs = { interval: "15m", mode: "candles", indicators: ["ma7", "ma25"], scale: "normal" };
const NO_DRAWINGS: number[] = [];

function parsePrefs(value: unknown): ChartPrefs | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    interval: (INTERVALS as string[]).includes(record.interval as string)
      ? (record.interval as ChartInterval)
      : DEFAULT_PREFS.interval,
    mode: MODES.some((option) => option.id === record.mode) ? (record.mode as ChartMode) : DEFAULT_PREFS.mode,
    indicators: Array.isArray(record.indicators)
      ? (record.indicators as string[]).filter((id): id is IndicatorId =>
          INDICATORS.some((indicator) => indicator.id === id),
        )
      : DEFAULT_PREFS.indicators,
    scale:
      record.scale === "normal" || record.scale === "percent" || record.scale === "log"
        ? record.scale
        : DEFAULT_PREFS.scale,
  };
}

function parseDrawings(value: unknown): number[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is number => Number.isFinite(entry)) : undefined;
}

interface Readout {
  candle: PreviewCandle;
  previousClose: number;
}

function ToolbarButton({
  label,
  active = false,
  onClick,
  children,
  className = "",
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`focus-ring grid h-7 min-w-7 shrink-0 place-items-center rounded-sm px-1.5 transition-colors ${
        active ? "bg-raised text-ink" : "text-faint hover:bg-raised hover:text-ink"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function PackagePriceChart({
  market,
  baseMarket,
  previewEpochSeconds,
  positionOverlays = [],
  orderOverlays = [],
}: {
  market: PackageMarket;
  baseMarket: PackageMarket;
  previewEpochSeconds: number;
  positionOverlays?: PositionPriceOverlay[];
  orderOverlays?: WorkingOrderPriceOverlay[];
}) {
  const shell = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ActiveSeries | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const indicatorRefs = useRef<Map<IndicatorId, ISeriesApi<"Line">>>(new Map());
  const candlesRef = useRef<PreviewCandle[]>([]);
  const pointsRef = useRef(0);
  const toolRef = useRef<Tool>("cross");
  const lastTradeRef = useRef<string | null>(null);
  const [prefs, setPrefs] = usePersistentState(CHART_PREFS_KEY, DEFAULT_PREFS, parsePrefs);
  const { interval, mode, indicators, scale } = prefs;
  const setInterval = (next: ChartInterval) => setPrefs((current) => ({ ...current, interval: next }));
  const setMode = (next: ChartMode) => setPrefs((current) => ({ ...current, mode: next }));
  const setScale = (next: ScaleMode) => setPrefs((current) => ({ ...current, scale: next }));
  const [autoScale, setAutoScale] = useState(true);
  const [indicatorMenu, setIndicatorMenu] = useState(false);
  const [tool, setTool] = useState<Tool>("cross");
  const [drawings, setDrawings] = usePersistentState(`${DRAWINGS_KEY}:${market.id}`, NO_DRAWINGS, parseDrawings);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [hover, setHover] = useState<Readout | null>(null);
  const [latest, setLatest] = useState<Readout | null>(null);
  const [indicatorValues, setIndicatorValues] = useState<Partial<Record<IndicatorId, number>>>({});
  const [fullscreen, setFullscreen] = useState(false);
  const trades = usePreviewTrades(market.id);

  useEffect(() => {
    toolRef.current = tool;
    chartRef.current?.applyOptions({
      crosshair: { mode: tool === "magnet" ? CrosshairMode.Magnet : CrosshairMode.Normal },
    });
  }, [tool]);

  const minuteHistory = useMemo(
    () => buildPreviewMinuteHistory(baseMarket),
    // The history is a pure function of these fields; the live market only moves the last candle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseMarket.id, baseMarket.netPrice, baseMarket.priorNetPrice, baseMarket.priceDecimals, baseMarket.tickSize],
  );
  const history = useMemo(() => buildPreviewHistory(minuteHistory, interval), [minuteHistory, interval]);
  const unit = priceUnitSuffix(market.priceUnit);
  const rising = baseMarket.netPrice >= baseMarket.priorNetPrice;

  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    const chart = createChart(element, {
      width: Math.max(1, Math.floor(element.clientWidth)),
      height: Math.max(1, Math.floor(element.clientHeight)),
      layout: {
        background: { type: ColorType.Solid, color: CHART_THEME.panel },
        textColor: CHART_THEME.faint,
        fontFamily: "var(--font-plex-mono), ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: CHART_THEME.grid },
        horzLines: { color: CHART_THEME.grid },
      },
      rightPriceScale: {
        visible: true,
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.08, bottom: 0.24 },
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
          labelBackgroundColor: CHART_THEME.raised,
        },
        horzLine: {
          color: CHART_THEME.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: CHART_THEME.raised,
        },
      },
      localization: {
        timeFormatter: (time: Time) => formatUtcStamp(time as number),
      },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
    volumeRef.current = volume;

    const onMove = (param: MouseEventParams) => {
      const active = seriesRef.current;
      if (!active || param.time === undefined) {
        setHover(null);
        return;
      }
      const point = param.seriesData.get(active.api);
      const bar = param.seriesData.get(volume) as HistogramData<Time> | undefined;
      if (!point) {
        setHover(null);
        return;
      }
      const candles = candlesRef.current;
      const index = candles.findIndex((candle) => candle.time === param.time);
      const hovered: PreviewCandle =
        active.mode === "candles"
          ? {
              time: param.time as number,
              open: (point as CandlestickData<Time>).open,
              high: (point as CandlestickData<Time>).high,
              low: (point as CandlestickData<Time>).low,
              close: (point as CandlestickData<Time>).close,
              volume: bar?.value ?? 0,
            }
          : {
              time: param.time as number,
              open: (point as LineData<Time>).value,
              high: (point as LineData<Time>).value,
              low: (point as LineData<Time>).value,
              close: (point as LineData<Time>).value,
              volume: bar?.value ?? 0,
            };
      setHover({ candle: hovered, previousClose: index > 0 ? candles[index - 1].close : hovered.open });
    };
    chart.subscribeCrosshairMove(onMove);

    const onClick = (param: MouseEventParams) => {
      if (toolRef.current !== "hline" || !param.point) return;
      const price = seriesRef.current?.api.coordinateToPrice(param.point.y);
      if (price === null || price === undefined || !Number.isFinite(price)) return;
      setDrawings((current) => [...current, Number(price.toFixed(baseMarket.priceDecimals))]);
      setTool("cross");
    };
    chart.subscribeClick(onClick);

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 2 || box.height < 2) return;
      chart.resize(Math.floor(box.width), Math.floor(box.height));
    });
    observer.observe(element);
    chartRef.current = chart;
    const indicatorSeries = indicatorRefs.current;

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      indicatorSeries.clear();
    };
    // The chart is created once per price precision; drawings persist through their own store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMarket.priceDecimals]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (seriesRef.current) chart.removeSeries(seriesRef.current.api);

    const common = {
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1 as const,
      lastValueVisible: true,
      priceFormat: {
        type: "price" as const,
        precision: baseMarket.priceDecimals,
        minMove: 10 ** -baseMarket.priceDecimals,
      },
    };
    const lineColor = rising ? CHART_THEME.up : CHART_THEME.down;
    let active: ActiveSeries;
    if (mode === "candles") {
      active = {
        mode,
        api: chart.addSeries(CandlestickSeries, {
          ...common,
          upColor: CHART_THEME.up,
          downColor: CHART_THEME.down,
          wickUpColor: CHART_THEME.up,
          wickDownColor: CHART_THEME.down,
          borderVisible: false,
          priceLineColor: lineColor,
        }),
      };
    } else if (mode === "line") {
      active = {
        mode,
        api: chart.addSeries(LineSeries, {
          ...common,
          color: lineColor,
          lineWidth: 2,
          crosshairMarkerRadius: 3,
          crosshairMarkerBorderColor: CHART_THEME.panel,
          crosshairMarkerBackgroundColor: lineColor,
          priceLineColor: lineColor,
        }),
      };
    } else {
      active = {
        mode,
        api: chart.addSeries(AreaSeries, {
          ...common,
          lineColor,
          lineWidth: 2,
          topColor: rising ? CHART_THEME.upFill : CHART_THEME.downFill,
          bottomColor: CHART_THEME.transparent,
          crosshairMarkerRadius: 3,
          crosshairMarkerBorderColor: CHART_THEME.panel,
          crosshairMarkerBackgroundColor: lineColor,
          priceLineColor: lineColor,
        }),
      };
    }

    const candles = history.map((candle) => ({ ...candle }));
    candlesRef.current = candles;
    setSeriesData(active, candles);
    volumeRef.current?.setData(candles.map(toVolumeData));
    active.api.createPriceLine({
      price: baseMarket.priorNetPrice,
      color: CHART_THEME.off,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: "prior",
    });
    seriesRef.current = active;
    pointsRef.current = candles.length;
    const last = candles[candles.length - 1];
    setLatest(last ? { candle: last, previousClose: candles[candles.length - 2]?.close ?? last.open } : null);
    setHover(null);
    resetVisibleRange(chart, candles.length);

    return () => {
      if (chartRef.current && seriesRef.current === active) {
        chart.removeSeries(active.api);
        seriesRef.current = null;
      }
    };
  }, [baseMarket.priceDecimals, baseMarket.priorNetPrice, history, mode, rising]);

  // Indicator overlays are recomputed from the same candles the chart draws.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const existing = indicatorRefs.current;
    for (const [id, series] of existing) {
      if (!indicators.includes(id)) {
        chart.removeSeries(series);
        existing.delete(id);
      }
    }
    const values: Partial<Record<IndicatorId, number>> = {};
    for (const spec of INDICATORS) {
      if (!indicators.includes(spec.id)) continue;
      let series = existing.get(spec.id);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: spec.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: {
            type: "price",
            precision: baseMarket.priceDecimals,
            minMove: 10 ** -baseMarket.priceDecimals,
          },
        });
        existing.set(spec.id, series);
      }
      const points = computeIndicator(spec.id, candlesRef.current);
      series.setData(points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
      values[spec.id] = points[points.length - 1]?.value;
    }
    setIndicatorValues(values);
  }, [indicators, history, mode, baseMarket.priceDecimals]);

  // Live: every preview print moves the last candle and adds its lots to the volume bar.
  useEffect(() => {
    const active = seriesRef.current;
    const candles = candlesRef.current;
    const previous = candles[candles.length - 1];
    if (!active || !previous) return;
    const print = trades[0];
    const fresh = print && print.id !== lastTradeRef.current ? print : null;
    if (fresh) lastTradeRef.current = fresh.id;
    const next = candleAtPrice(previous, previewEpochSeconds, market.netPrice, interval, fresh?.lots ?? 0);
    if (next.time !== previous.time) {
      candles.push(next);
      pointsRef.current += 1;
    } else {
      candles[candles.length - 1] = next;
    }
    updateSeries(active, next);
    volumeRef.current?.update(toVolumeData(next));
    const values: Partial<Record<IndicatorId, number>> = {};
    const tail = candles.slice(-INDICATOR_TAIL);
    for (const [id, series] of indicatorRefs.current) {
      const point = computeIndicator(id, tail).at(-1);
      if (!point) continue;
      series.update({ time: point.time as UTCTimestamp, value: point.value });
      values[id] = point.value;
    }
    setIndicatorValues(values);
    setLatest({ candle: next, previousClose: candles[candles.length - 2]?.close ?? next.open });
    // Driven by the shared preview clock and prints only.
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

  useEffect(() => {
    const active = seriesRef.current;
    if (!active) return;
    const lines: IPriceLine[] = [];
    for (const position of positionOverlays) {
      if (!Number.isFinite(position.entryPrice)) continue;
      const entryLabel = position.side === "LONG" ? "Long entry" : "Short entry";
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
          title: `${sideLabel} ${intentLabel} ${shortOverlayId(order.id)} ${formatOverlayLots(order.lots)} lots`,
        }),
      );
    }
    if (drawingsVisible) {
      for (const price of drawings) {
        lines.push(
          active.api.createPriceLine({
            price,
            color: CHART_THEME.dim,
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: "",
          }),
        );
      }
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
  }, [positionOverlays, orderOverlays, drawings, drawingsVisible, mode, history, rising]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const reset = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    setAutoScale(true);
    resetVisibleRange(chart, pointsRef.current);
  }, []);
  const showRange = useCallback((seconds: number | null) => {
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
      to: (to + INTERVAL_SECONDS[interval] * 4) as UTCTimestamp,
    });
  }, [interval]);
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
  const toggleIndicator = (id: IndicatorId) =>
    setPrefs((current) => ({
      ...current,
      indicators: current.indicators.includes(id)
        ? current.indicators.filter((item) => item !== id)
        : [...current.indicators, id],
    }));

  const readoutState = hover ?? latest;
  const readout = readoutState?.candle ?? null;
  const previousClose = readoutState?.previousClose ?? null;
  const change = readout && previousClose !== null ? readout.close - previousClose : 0;
  const changePercent = readout && previousClose ? (change / previousClose) * 100 : 0;
  const changeTone = change >= 0 ? "text-up" : "text-down";

  return (
    <div ref={shell} className="flex min-h-0 w-full flex-1 flex-col bg-panel">
      <div className="no-scrollbar flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2">
        <div role="group" aria-label="Chart interval" className="flex items-center gap-0.5">
          {INTERVALS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setInterval(option)}
              aria-pressed={interval === option}
              className={`focus-ring h-7 rounded-sm px-1.5 font-mono text-xs transition-colors ${
                interval === option ? "text-brand" : "text-faint hover:bg-raised hover:text-dim"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-line" />
        <div role="group" aria-label="Chart type" className="flex items-center gap-0.5">
          {MODES.map((option) => {
            const Icon = option.icon;
            return (
              <ToolbarButton
                key={option.id}
                label={option.label}
                active={mode === option.id}
                onClick={() => setMode(option.id)}
              >
                <Icon size={15} aria-hidden="true" />
              </ToolbarButton>
            );
          })}
        </div>
        <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-line" />
        <div className="relative">
          <button
            type="button"
            onClick={() => setIndicatorMenu((open) => !open)}
            aria-expanded={indicatorMenu}
            className="focus-ring flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs text-dim transition-colors hover:bg-raised hover:text-ink"
          >
            <Sigma size={14} aria-hidden="true" />
            Indicators
            {indicators.length > 0 ? (
              <span className="tnum rounded-sm bg-raised px-1 font-mono text-[11px] text-faint">
                {indicators.length}
              </span>
            ) : null}
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {indicatorMenu ? (
            <>
              <button
                type="button"
                aria-label="Close indicators"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setIndicatorMenu(false)}
              />
              <div className="absolute top-full left-0 z-50 mt-1 w-60 rounded-md border border-line-strong bg-raised p-1 shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
                {INDICATORS.map((spec) => (
                  <label
                    key={spec.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-xs text-dim hover:bg-panel"
                  >
                    <input
                      type="checkbox"
                      checked={indicators.includes(spec.id)}
                      onChange={() => toggleIndicator(spec.id)}
                      className="accent-[var(--color-brand)]"
                    />
                    <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: spec.color }} />
                    <span className="text-ink">{spec.label}</span>
                    <span className="ml-auto truncate text-[11px] text-off">{spec.describe}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <span className="flex-1" />
        <ToolbarButton label="Save chart image" onClick={screenshot}>
          <Camera size={14} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label="Reset view" onClick={reset}>
          <RotateCcw size={13} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </ToolbarButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          role="toolbar"
          aria-label="Chart tools"
          aria-orientation="vertical"
          className="hidden w-10 shrink-0 flex-col items-center gap-1 border-r border-line py-2 sm:flex"
        >
          <ToolbarButton label="Crosshair" active={tool === "cross"} onClick={() => setTool("cross")}>
            <Crosshair size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton label="Magnet to candle values" active={tool === "magnet"} onClick={() => setTool("magnet")}>
            <Magnet size={15} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            label="Horizontal line: click the chart to place"
            active={tool === "hline"}
            onClick={() => setTool(tool === "hline" ? "cross" : "hline")}
          >
            <Minus size={15} aria-hidden="true" />
          </ToolbarButton>
          <span aria-hidden="true" className="my-1 h-px w-5 bg-line" />
          <ToolbarButton
            label={drawingsVisible ? "Hide drawings" : "Show drawings"}
            active={!drawingsVisible}
            onClick={() => setDrawingsVisible((visible) => !visible)}
          >
            {drawingsVisible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
          </ToolbarButton>
          <ToolbarButton label="Remove all drawings" onClick={() => setDrawings([])}>
            <Trash2 size={14} aria-hidden="true" />
          </ToolbarButton>
        </div>

        <div className={`relative min-h-0 min-w-0 flex-1 ${tool === "hline" ? "cursor-crosshair" : ""}`}>
          <div
            ref={holder}
            className="absolute inset-0"
            role="img"
            aria-label={`${interval} ${mode} chart for ${market.name}. Current package price ${formatNumber(market.netPrice, market.priceDecimals)} ${unit}.`}
          />
          {readout ? (
            <div className="pointer-events-none absolute top-0 left-0 z-10 flex max-w-[calc(100%-64px)] flex-col gap-0.5 px-3 py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 font-mono text-[11px]">
                <span className="font-sans text-xs text-dim">{`${market.id} · ${interval} · Setryn`}</span>
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
              <div className="flex flex-wrap items-baseline gap-x-2.5 font-mono text-[11px]">
                <span className="text-faint">
                  Vol <span className="text-dim">{`${formatLots(readout.volume)} lots`}</span>
                </span>
                {INDICATORS.filter((spec) => indicators.includes(spec.id)).map((spec) => (
                  <span key={spec.id} className="text-faint">
                    {spec.label}{" "}
                    <span style={{ color: spec.color }}>
                      {indicatorValues[spec.id] !== undefined
                        ? formatNumber(indicatorValues[spec.id] as number, market.priceDecimals)
                        : "–"}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="no-scrollbar flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-t border-line px-2">
        <div role="group" aria-label="Visible range" className="flex items-center gap-0.5">
          {RANGES.map((range) => (
            <button
              key={range.label}
              type="button"
              onClick={() => showRange(range.seconds)}
              className="focus-ring h-6 rounded-sm px-1.5 font-mono text-[11px] text-faint transition-colors hover:bg-raised hover:text-ink"
            >
              {range.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <span className="tnum mr-2 shrink-0 font-mono text-[11px] text-faint">
          {`${formatUtcClock(previewEpochSeconds)}:${String(previewEpochSeconds % 60).padStart(2, "0")} (UTC)`}
        </span>
        <span aria-hidden="true" className="mr-1 h-3.5 w-px shrink-0 bg-line" />
        <button
          type="button"
          onClick={() => setScale(scale === "percent" ? "normal" : "percent")}
          aria-pressed={scale === "percent"}
          className={`focus-ring h-6 rounded-sm px-1.5 font-mono text-[11px] ${scale === "percent" ? "text-brand" : "text-faint hover:text-ink"}`}
        >
          %
        </button>
        <button
          type="button"
          onClick={() => setScale(scale === "log" ? "normal" : "log")}
          aria-pressed={scale === "log"}
          className={`focus-ring h-6 rounded-sm px-1.5 font-mono text-[11px] ${scale === "log" ? "text-brand" : "text-faint hover:text-ink"}`}
        >
          log
        </button>
        <button
          type="button"
          onClick={() => setAutoScale((value) => !value)}
          aria-pressed={autoScale}
          className={`focus-ring h-6 rounded-sm px-1.5 font-mono text-[11px] ${autoScale ? "text-brand" : "text-faint hover:text-ink"}`}
        >
          auto
        </button>
      </div>
    </div>
  );
}
