"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  TickMarkType,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  formatNumber,
  formatUtcClock,
  formatUtcStamp,
  previewTimeline,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";
import { CHART_THEME } from "./chart-theme";

interface Hover {
  value: number;
  time: number;
}

/**
 * Pads the series with enough logical slack that the outermost axis label always
 * clears the frame. A 320px axis needs far more slack in bars than a 1536px one.
 */
function applyRange(chart: IChartApi, width: number, points: number) {
  const spacing = width / Math.max(1, points);
  const slack = Math.max(1.5, 24 / Math.max(spacing, 0.5));
  chart.timeScale().setVisibleLogicalRange({ from: -slack, to: points - 1 + slack });
}

export function PackagePriceChart({ market }: { market: PackageMarket }) {
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const pointsRef = useRef(market.priceHistory.length);
  const [hover, setHover] = useState<Hover | null>(null);

  const unit = priceUnitSuffix(market.priceUnit);
  const rising = market.netPrice >= market.priorNetPrice;

  useEffect(() => {
    const element = holder.current;
    if (!element) return;

    const chart = createChart(element, {
      /* Sized explicitly rather than with autoSize: a tab panel can be mounted at
         zero height, and a chart that misses that first box never paints. */
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
        scaleMargins: { top: 0.24, bottom: 0.12 },
      },
      timeScale: {
        visible: true,
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        /* Day and clock ticks are formatted apart so a 320px axis never clips a label. */
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) =>
          tickMarkType >= TickMarkType.Time
            ? formatUtcClock(time as number)
            : formatUtcStamp(time as number, false),
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: CHART_THEME.crosshair,
          width: 1,
          style: LineStyle.Solid,
          labelBackgroundColor: CHART_THEME.raised,
        },
        horzLine: {
          color: CHART_THEME.crosshair,
          width: 1,
          style: LineStyle.Solid,
          labelBackgroundColor: CHART_THEME.raised,
        },
      },
      localization: {
        timeFormatter: (time: Time) => formatUtcStamp(time as number),
      },
    });

    const series = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1,
      lastValueVisible: true,
      crosshairMarkerRadius: 3,
      crosshairMarkerBorderWidth: 1,
    });

    const onMove = (param: MouseEventParams) => {
      const point = param.seriesData.get(series);
      if (!point || param.time === undefined) {
        setHover(null);
        return;
      }
      setHover({ value: (point as { value: number }).value, time: param.time as number });
    };
    chart.subscribeCrosshairMove(onMove);

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 2 || box.height < 2) return;
      chart.resize(Math.floor(box.width), Math.floor(box.height));
      applyRange(chart, box.width, pointsRef.current);
    });
    observer.observe(element);

    chartRef.current = chart;
    seriesRef.current = series;

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
    const series = seriesRef.current;
    if (!chart || !series) return;

    const stroke = rising ? CHART_THEME.up : CHART_THEME.down;
    series.applyOptions({
      lineColor: stroke,
      topColor: rising ? CHART_THEME.upFill : CHART_THEME.downFill,
      bottomColor: CHART_THEME.transparent,
      priceLineColor: stroke,
      crosshairMarkerBackgroundColor: stroke,
      crosshairMarkerBorderColor: CHART_THEME.panel,
      priceFormat: {
        type: "price",
        precision: market.priceDecimals,
        /* Ticks, not the axis: a tick-sized minMove would round the last value
           and the prior close away from the prices the rest of the terminal shows. */
        minMove: 10 ** -market.priceDecimals,
      },
    });

    const times = previewTimeline(market.priceHistory.length);
    series.setData(
      market.priceHistory.map((value, index) => ({
        time: times[index] as UTCTimestamp,
        value,
      })),
    );

    const priorLine = series.createPriceLine({
      price: market.priorNetPrice,
      color: CHART_THEME.off,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "prior",
    });

    pointsRef.current = market.priceHistory.length;
    applyRange(chart, chart.paneSize().width, pointsRef.current);
    setHover(null);

    return () => {
      // The mount effect disposes the chart first on unmount, so only detach
      // the price line while the chart is still alive.
      if (chartRef.current) series.removePriceLine(priorLine);
    };
  }, [market, rising]);

  const readout = hover ?? {
    value: market.netPrice,
    time: previewTimeline(market.priceHistory.length).at(-1) ?? 0,
  };

  return (
    <div className="relative min-h-0 w-full flex-1">
      <div
        ref={holder}
        className="absolute inset-0"
        role="img"
        aria-label={`Net package price for ${market.name}, ${formatNumber(market.netPrice, market.priceDecimals)} ${unit}, over 48 hours of preview snapshots at 30 minute intervals against a prior close of ${formatNumber(market.priorNetPrice, market.priceDecimals)} ${unit}`}
      />

      <div className="pointer-events-none absolute top-0 left-0 z-10 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-panel/85 px-3 pt-2 pb-1 text-xs lg:px-4">
        <span className="text-faint">{`Net package price, ${unit}`}</span>
        <span className="tnum font-mono text-ink">
          {formatNumber(readout.value, market.priceDecimals)}
        </span>
        <span className="tnum font-mono text-off">{formatUtcStamp(readout.time)}</span>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-0 z-10 hidden items-center gap-3 bg-panel/85 px-3 py-1 text-xs text-off sm:flex lg:px-4">
        <span>48h of preview snapshots, 30m interval</span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-px w-3 bg-off" />
          prior close
        </span>
      </div>
    </div>
  );
}
