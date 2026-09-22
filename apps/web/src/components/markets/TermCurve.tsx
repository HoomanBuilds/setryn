"use client";

import Link from "next/link";
import { QualificationTag } from "@/components/markets/controls";
import { Delta, SectionLabel } from "@/components/terminal/primitives";
import {
  changePercent,
  daysToExpiry,
  formatExpiry,
  formatLots,
  formatNumber,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import {
  groupByCurveFamily,
  settlementShort,
  spreadOf,
  type CurveFamily,
} from "@/lib/terminal/discovery";
import { tradeHref } from "@/lib/terminal/markets";
import { bounds, linePath, ticks } from "@/components/terminal/viz/chart-utils";
import type { PackageMarket } from "@/lib/terminal/types";

const VIEW_W = 1000;
const VIEW_H = 320;

interface Plotted {
  market: PackageMarket;
  days: number;
  /** Percent of the plot box, so the HTML marker layer can sit on the SVG. */
  left: number;
  top: number;
  priorTop: number;
}

/* Margins of the plot box, so an end maturity keeps its label inside it. */
const PLOT_START = 8;
const PLOT_END = 92;

/**
 * A label centred on an end mark would sit against the value gutter or the
 * right edge once the plot narrows to a phone, so end labels hinge on their
 * mark and swing inward. The mark itself never leaves its data coordinate,
 * and a plot wide enough to centre every label keeps them centred.
 */
function labelShift(left: number): string {
  if (left <= PLOT_START) return "translate-x-1/2 lg:translate-x-0";
  if (left >= PLOT_END) return "-translate-x-1/2 lg:translate-x-0";
  return "";
}

function plot(family: CurveFamily): {
  points: Plotted[];
  low: number;
  high: number;
} {
  const days = family.markets.map((market) => daysToExpiry(market.expiryIso));
  const prices = family.markets.flatMap((market) => [market.netPrice, market.priorNetPrice]);
  const price = bounds(prices, 0.18);
  const minDay = Math.min(...days);
  /* One point, or several sharing a maturity, would divide by a zero span. */
  const daySpan = Math.max(...days) - minDay || 1;
  const priceSpan = price.max - price.min || 1;

  const toTop = (value: number) => ((price.max - value) / priceSpan) * 100;

  return {
    points: family.markets.map((market, index) => ({
      market,
      days: days[index],
      left:
        family.markets.length === 1
          ? 50
          : PLOT_START + ((days[index] - minDay) / daySpan) * (PLOT_END - PLOT_START),
      top: toTop(market.netPrice),
      priorTop: toTop(market.priorNetPrice),
    })),
    low: price.min,
    high: price.max,
  };
}

/**
 * One panel per curve family: underlying, strategy kind, price unit, and
 * settlement class all have to match before two maturities may share an axis.
 * Marks and labels are HTML over a stretched SVG, so the geometry never skews.
 */
export function TermCurve({ markets }: { markets: PackageMarket[] }) {
  const families = groupByCurveFamily(markets);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4 lg:px-4">
      {families.map((family) => (
        <CurvePanel key={family.key} family={family} />
      ))}
    </div>
  );
}

function CurvePanel({ family }: { family: CurveFamily }) {
  const unit = priceUnitSuffix(family.priceUnit);
  const { points, low, high } = plot(family);
  /* Interior lines only: an edge tick would collide with the axis labels. */
  const gridLines = ticks(low, high, 4).slice(1, -1);
  /* A single maturity is a point, never a term structure, so no line is drawn. */
  const curved = points.length > 1;
  const line = points.map((point) => ({
    x: (point.left / 100) * VIEW_W,
    y: (point.top / 100) * VIEW_H,
  }));
  const priorLine = points.map((point) => ({
    x: (point.left / 100) * VIEW_W,
    y: (point.priorTop / 100) * VIEW_H,
  }));

  return (
    <section className="border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <SectionLabel>{family.label}</SectionLabel>
          <span className="text-xs text-faint">
            {`${points.length} ${points.length === 1 ? "maturity" : "maturities"} / ${settlementShort(
              family.settlementClass,
            )} / net price in ${unit} against days to expiry`}
          </span>
        </div>
        <span className="text-xs text-off">
          {curved ? "Solid line current, dashed line prior close" : "One maturity visible"}
        </span>
      </div>

      {/* Grid lines cross the whole box, but the value labels keep a gutter the
          plot never enters, so a maturity label cannot land on a grid value. */}
      <div className="relative mt-3 h-[150px] w-full lg:h-[196px]">
        {gridLines.map((value) => {
          const top = `${((high - value) / (high - low || 1)) * 100}%`;
          return (
            <span key={value} aria-hidden="true">
              <span
                style={{ top }}
                className="absolute inset-x-0 h-px -translate-y-1/2 bg-line"
              />
              <span
                style={{ top }}
                className="tnum absolute left-0 -translate-y-1/2 bg-app pr-1.5 font-mono text-xs text-off"
              >
                {formatNumber(value, 1)}
              </span>
            </span>
          );
        })}

        <div className="absolute inset-y-0 right-3 left-14">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label={
              curved
                ? `Term structure of ${family.label}, net price in ${unit} from ${formatNumber(low, 1)} to ${formatNumber(high, 1)} across ${points.length} maturities of ${family.underlying}. The equivalent table follows.`
                : `${family.label} has one visible maturity, so no term structure is drawn. The equivalent table follows.`
            }
          >
            {curved ? (
              <>
                <path
                  d={linePath(priorLine)}
                  fill="none"
                  stroke="var(--color-off)"
                  strokeWidth={1.2}
                  strokeDasharray="4 5"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={linePath(line)}
                  fill="none"
                  stroke="var(--color-brand)"
                  strokeWidth={1.7}
                  vectorEffect="non-scaling-stroke"
                />
              </>
            ) : null}
          </svg>

          {points.map((point) => (
            <Link
              key={point.market.id}
              href={tradeHref(point.market)}
              title={`${point.market.name}, ${point.market.tenorLabel}, ${formatNumber(point.market.netPrice, point.market.priceDecimals)} ${unit}`}
              style={{ left: `${point.left}%`, top: `${point.top}%` }}
              className="focus-ring absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-sm px-1.5 py-1"
            >
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] rotate-45 border border-brand bg-app"
              />
              <span
                className={`tnum bg-app px-1 whitespace-nowrap font-mono text-xs text-dim ${labelShift(point.left)}`}
              >
                {point.market.tenorLabel}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-1 flex items-baseline justify-between text-xs text-off">
        <span className="tnum font-mono">{curved ? `${points[0].days}d` : ""}</span>
        <span className="truncate">
          {curved ? "days to expiry" : `${points[0].days}d to expiry`}
        </span>
        <span className="tnum font-mono">
          {curved ? `${points[points.length - 1].days}d` : ""}
        </span>
      </div>

      <CurveTable family={family} points={points} unit={unit} />
    </section>
  );
}

/** The chart's table equivalent, always visible rather than behind a toggle. */
function CurveTable({
  family,
  points,
  unit,
}: {
  family: CurveFamily;
  points: Plotted[];
  unit: string;
}) {
  return (
    <div className="scroll-thin mt-3 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <caption className="sr-only">{`${family.label} term structure values in ${unit}`}</caption>
        <thead>
          <tr className="border-y border-line">
            <th scope="col" className="h-8 px-2 text-xs font-normal text-faint">
              Maturity
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              Days
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              {`Net (${unit})`}
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              Prior
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              Change
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              Spread
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              Firm depth
            </th>
            <th scope="col" className="h-8 px-2 text-xs font-normal text-faint">
              Qualification
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map(({ market, days }) => (
            <tr key={market.id} className="border-b border-line-soft">
              <td className="px-2">
                <Link
                  href={tradeHref(market)}
                  className="focus-ring flex min-w-0 items-baseline gap-2 py-1.5"
                >
                  <span className="tnum shrink-0 font-mono text-xs text-ink">
                    {market.tenorLabel}
                  </span>
                  <span className="tnum truncate font-mono text-xs text-off">
                    {formatExpiry(market.expiryIso)}
                  </span>
                </Link>
              </td>
              <td className="tnum px-2 text-right font-mono text-xs text-dim">{`${days}d`}</td>
              <td className="tnum px-2 text-right font-mono text-xs text-ink">
                {formatNumber(market.netPrice, market.priceDecimals)}
              </td>
              <td className="tnum px-2 text-right font-mono text-xs text-off">
                {formatNumber(market.priorNetPrice, market.priceDecimals)}
              </td>
              <td className="px-2 text-right">
                <Delta
                  value={changePercent(market.netPrice, market.priorNetPrice)}
                  className="text-xs"
                />
              </td>
              <td className="tnum px-2 text-right font-mono text-xs text-dim">
                {formatNumber(spreadOf(market), market.priceDecimals)}
              </td>
              <td className="tnum px-2 text-right font-mono text-xs text-dim">
                {`${formatLots(market.firmDepthLots)} lots`}
              </td>
              <td className="px-2">
                <QualificationTag market={market} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
