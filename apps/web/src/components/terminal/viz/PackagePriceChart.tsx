"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  TickMarkType,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  formatNumber,
  formatUtcClock,
  formatUtcStamp,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";
import { CHART_THEME } from "./chart-theme";
import {
  buildPreviewHistory,
  buildPreviewMinuteHistory,
  candleAtPrice,
  type ChartInterval,
  type PreviewCandle,
} from "./preview-price-data";

type ChartMode = "candles" | "line" | "area";

type ActiveSeries =
  | { mode: "candles"; api: ISeriesApi<"Candlestick"> }
  | { mode: "line"; api: ISeriesApi<"Line"> }
  | { mode: "area"; api: ISeriesApi<"Area"> };

const INTERVALS: ChartInterval[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const MODES: { id: ChartMode; label: string }[] = [
  { id: "candles", label: "Candles" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
];

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

function setSeriesData(series: ActiveSeries, candles: PreviewCandle[]) {
  if (series.mode === "candles") {
    series.api.setData(candles.map(toCandlestickData));
  } else {
    series.api.setData(candles.map(toLineData));
  }
}

function updateSeries(series: ActiveSeries, candle: PreviewCandle) {
  if (series.mode === "candles") series.api.update(toCandlestickData(candle));
  else series.api.update(toLineData(candle));
}

function resetVisibleRange(chart: IChartApi, points: number) {
  const visible = Math.min(points, 140);
  chart.timeScale().setVisibleLogicalRange({
    from: Math.max(0, points - visible),
    to: points + 4,
  });
}

function ReadoutValue({
  label,
  value,
  decimals,
}: {
  label: string;
  value: number;
  decimals: number;
}) {
  return (
    <span className="tnum inline-flex items-baseline gap-1 font-mono text-xs text-ink">
      <span className="font-sans text-faint">{label}</span>
      {formatNumber(value, decimals)}
    </span>
  );
}

export function PackagePriceChart({
  market,
  baseMarket,
  previewEpochSeconds,
}: {
  market: PackageMarket;
  baseMarket: PackageMarket;
  previewEpochSeconds: number;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ActiveSeries | null>(null);
  const currentCandleRef = useRef<PreviewCandle | null>(null);
  const pointsRef = useRef(0);
  const [interval, setInterval] = useState<ChartInterval>("15m");
  const [mode, setMode] = useState<ChartMode>("candles");
  const [hover, setHover] = useState<PreviewCandle | null>(null);
  const [latest, setLatest] = useState<PreviewCandle | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const minuteHistory = useMemo(
    () => buildPreviewMinuteHistory(baseMarket),
    [
      baseMarket.id,
      baseMarket.netPrice,
      baseMarket.priorNetPrice,
      baseMarket.priceDecimals,
      baseMarket.tickSize,
    ],
  );
  const history = useMemo(
    () => buildPreviewHistory(minuteHistory, interval),
    [minuteHistory, interval],
  );
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
        scaleMargins: { top: 0.2, bottom: 0.12 },
      },
      timeScale: {
        visible: true,
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
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

    const onMove = (param: MouseEventParams) => {
      const active = seriesRef.current;
      if (!active || param.time === undefined) {
        setHover(null);
        return;
      }

      const point = param.seriesData.get(active.api);
      if (!point) {
        setHover(null);
        return;
      }

      if (active.mode === "candles") {
        const candle = point as CandlestickData<Time>;
        setHover({
          time: param.time as number,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });
      } else {
        const line = point as LineData<Time>;
        setHover({
          time: param.time as number,
          open: line.value,
          high: line.value,
          low: line.value,
          close: line.value,
        });
      }
    };
    chart.subscribeCrosshairMove(onMove);

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 2 || box.height < 2) return;
      chart.resize(Math.floor(box.width), Math.floor(box.height));
    });
    observer.observe(element);
    chartRef.current = chart;

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

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
          priceLineColor: rising ? CHART_THEME.up : CHART_THEME.down,
        }),
      };
    } else if (mode === "line") {
      const lineColor = rising ? CHART_THEME.up : CHART_THEME.down;
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
      const lineColor = rising ? CHART_THEME.up : CHART_THEME.down;
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

    setSeriesData(active, history);
    active.api.createPriceLine({
      price: baseMarket.priorNetPrice,
      color: CHART_THEME.off,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "prior",
    });
    seriesRef.current = active;
    currentCandleRef.current = history[history.length - 1] ?? null;
    pointsRef.current = history.length;
    setLatest(history[history.length - 1] ?? null);
    setHover(null);
    resetVisibleRange(chart, history.length);

    return () => {
      if (chartRef.current && seriesRef.current === active) {
        chart.removeSeries(active.api);
        seriesRef.current = null;
      }
    };
  }, [baseMarket.priceDecimals, baseMarket.priorNetPrice, history, mode, rising]);

  useEffect(() => {
    const active = seriesRef.current;
    const previous = currentCandleRef.current;
    if (!active || !previous) return;

    const next = candleAtPrice(previous, previewEpochSeconds, market.netPrice, interval);
    if (next.time !== previous.time) pointsRef.current += 1;
    currentCandleRef.current = next;
    updateSeries(active, next);
    setLatest(next);
  }, [interval, market.netPrice, previewEpochSeconds, mode]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const fit = useCallback(() => chartRef.current?.timeScale().fitContent(), []);
  const reset = useCallback(() => {
    const chart = chartRef.current;
    if (chart) resetVisibleRange(chart, pointsRef.current);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === shell.current) {
      void document.exitFullscreen();
    } else if (!document.fullscreenElement) {
      void shell.current?.requestFullscreen();
    }
  }, []);

  const readout = hover ?? latest;

  return (
    <div ref={shell} className="flex min-h-0 w-full flex-1 flex-col bg-panel">
      <div className="no-scrollbar flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2">
        <div role="group" aria-label="Chart interval" className="flex items-center gap-0.5">
          {INTERVALS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setInterval(option)}
              aria-pressed={interval === option}
              className={`focus-ring h-7 rounded-sm px-2 font-mono text-xs transition-colors ${
                interval === option
                  ? "bg-raised text-ink"
                  : "text-faint hover:bg-raised hover:text-dim"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />

        <div role="group" aria-label="Chart mode" className="flex items-center gap-0.5">
          {MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={mode === option.id}
              className={`focus-ring h-7 rounded-sm px-2 text-xs transition-colors ${
                mode === option.id
                  ? "bg-raised text-ink"
                  : "text-faint hover:bg-raised hover:text-dim"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />

        <button
          type="button"
          onClick={fit}
          className="focus-ring h-7 rounded-sm px-2 text-xs text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label="Reset chart to latest prices"
          title="Reset to latest prices"
          className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          <RotateCcw size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit fullscreen chart" : "Open fullscreen chart"}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          {fullscreen ? (
            <Minimize2 size={14} aria-hidden="true" />
          ) : (
            <Maximize2 size={14} aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={holder}
          className="absolute inset-0"
          role="img"
          aria-label={`${interval} ${mode} chart for ${market.name}. Current package price ${formatNumber(market.netPrice, market.priceDecimals)} ${unit}. Prior close ${formatNumber(market.priorNetPrice, market.priceDecimals)} ${unit}.`}
        />

        {readout ? (
          <div className="pointer-events-none absolute top-0 left-0 z-10 flex max-w-[calc(100%-54px)] flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-panel/90 px-3 py-1.5 lg:px-4">
            <span className="tnum font-mono text-xs text-off">
              {formatUtcStamp(readout.time)}
            </span>
            {mode === "candles" ? (
              <>
                <ReadoutValue label="O" value={readout.open} decimals={market.priceDecimals} />
                <ReadoutValue label="H" value={readout.high} decimals={market.priceDecimals} />
                <ReadoutValue label="L" value={readout.low} decimals={market.priceDecimals} />
                <ReadoutValue label="C" value={readout.close} decimals={market.priceDecimals} />
              </>
            ) : (
              <ReadoutValue label={unit} value={readout.close} decimals={market.priceDecimals} />
            )}
          </div>
        ) : null}

        <div className="pointer-events-none absolute bottom-6 left-0 z-10 hidden items-center gap-3 bg-panel/90 px-3 py-1 text-xs text-off sm:flex lg:px-4">
          <span>{`${interval} package price, preview stream`}</span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-px w-3 bg-off" />
            prior close
          </span>
        </div>
      </div>
    </div>
  );
}
