"use client";

import Link from "next/link";
import { AssetIcon, UnderlyingIcon } from "@/components/icons/AssetIcon";
import { QualificationTag } from "@/components/markets/controls";
import { Delta, SectionLabel } from "@/components/terminal/primitives";
import { formatAnalytic, strategyAnalytic } from "@/lib/market-data/analytics";
import {
  changePercent,
  daysToExpiry,
  formatExpiry,
  formatLots,
  formatNumber,
  platformNowSeconds,
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
import { Chip, motion } from "@/components/markets/ui";

const VIEW_W = 1000;
const VIEW_H = 320;

interface Plotted {
  market: PackageMarket;
  days: number;
  /** Percent of the plot box, so the HTML marker layer can sit on the SVG. */
  left: number;
  top: number;
  /** Whether the mark is traded (book mid or last fill); otherwise it sits on the reference. */
  traded: boolean;
}

function isTraded(market: PackageMarket): boolean {
  return market.markSource === "MID" || market.markSource === "LAST";
}

const SOURCE_SHORT: Record<PackageMarket["markSource"], string> = { MID: "Mid", LAST: "Last", REFERENCE: "Ref", NONE: "—" };

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
  /** The live Chainlink spot of the family's underlying, and its height in the plot; NaN when unread. */
  spot: number;
  spotTop: number;
} {
  const days = family.markets.map((market) => daysToExpiry(market.expiryIso));
  const spot = family.markets.find((market) => Number.isFinite(market.referencePrice))?.referencePrice ?? Number.NaN;
  const prices = [...family.markets.map((market) => market.netPrice), spot].filter((value) => Number.isFinite(value));
  const price = bounds(prices.length > 0 ? prices : [0], 0.18);
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
      top: toTop(Number.isFinite(market.netPrice) ? market.netPrice : spot),
      traded: isTraded(market),
    })),
    low: price.min,
    high: price.max,
    spot,
    spotTop: toTop(spot),
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
    <div className="min-w-0 px-3 pb-2 lg:px-4">
      {families.map((family) => (
        <CurvePanel key={family.key} family={family} />
      ))}
    </div>
  );
}

function CurvePanel({ family }: { family: CurveFamily }) {
  const unit = priceUnitSuffix(family.priceUnit);
  const { points, low, high, spot, spotTop } = plot(family);
  const decimals = family.markets[0]?.priceDecimals ?? 1;
  /* Interior lines only: an edge tick would collide with the axis labels. */
  const gridLines = ticks(low, high, 4).slice(1, -1);
  /* Only traded marks form a term structure; a maturity marked at the reference sits on the spot line. */
  const traded = points.filter((point) => point.traded);
  const curved = traded.length > 1;
  const line = traded.map((point) => ({
    x: (point.left / 100) * VIEW_W,
    y: (point.top / 100) * VIEW_H,
  }));
  const spotY = (spotTop / 100) * VIEW_H;

  return (
    <section className={`${motion.enter} border-b border-line py-4 last:border-b-0`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="flex items-baseline gap-2">
            <UnderlyingIcon underlying={family.underlying} size={16} className="self-center" />
            <SectionLabel>{family.label}</SectionLabel>
          </span>
          <span className="flex flex-wrap items-baseline gap-x-1 text-xs text-faint">
            {`${points.length} ${points.length === 1 ? "maturity" : "maturities"} /`}
            <AssetIcon symbol="USDC" size={12} className="self-center" />
            {`${settlementShort(family.settlementClass)} / forward level in ${unit} against days to expiry`}
          </span>
        </div>
        <span className="flex items-center gap-3 text-[11px] text-faint">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-[2px] w-4 rounded-full bg-brand" />
            Traded marks
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-4 border-t border-dashed border-off" />
            {`Chainlink ${family.markets[0]?.referencePair ?? "reference"}`}
          </span>
          <Chip tone="muted">{traded.length === 0 ? "No trades yet" : `${traded.length} traded`}</Chip>
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
                className="tnum absolute left-0 -translate-y-1/2 bg-panel pr-1.5 font-mono text-xs text-off"
              >
                {formatNumber(value, decimals)}
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
                ? `Term structure of ${family.label}, traded forward levels in ${unit} from ${formatNumber(low, decimals)} to ${formatNumber(high, decimals)} across ${traded.length} maturities of ${family.underlying}. The dashed line is the Chainlink spot reference. The equivalent table follows.`
                : `${family.label} has ${traded.length === 0 ? "no traded maturity" : "one traded maturity"}, so no term structure is drawn. The dashed line is the Chainlink spot reference. The equivalent table follows.`
            }
          >
            {Number.isFinite(spot) ? (
              <path
                d={`M0 ${spotY} L${VIEW_W} ${spotY}`}
                fill="none"
                stroke="var(--color-off)"
                strokeWidth={1.2}
                strokeDasharray="4 5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {curved ? (
              <path
                d={linePath(line)}
                fill="none"
                stroke="var(--color-brand)"
                strokeWidth={1.7}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>

          {points.map((point) => (
            <Link
              key={point.market.id}
              href={tradeHref(point.market)}
              title={`${point.market.name}, ${point.market.tenorLabel}, ${formatNumber(point.market.netPrice, point.market.priceDecimals)} ${unit}${
                point.traded ? "" : ", marked at the reference: no book or trades yet"
              }`}
              style={{ left: `${point.left}%`, top: `${point.top}%` }}
              className="focus-ring absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-sm px-1.5 py-1"
            >
              <span
                aria-hidden="true"
                className={`h-[7px] w-[7px] rotate-45 border bg-panel ${point.traded ? "border-brand" : "border-off"}`}
              />
              <span
                className={`tnum bg-panel px-1 whitespace-nowrap font-mono text-xs text-dim ${labelShift(point.left)}`}
              >
                {point.market.tenorLabel}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-1 flex items-baseline justify-between text-xs text-off">
        <span className="tnum font-mono">{points.length > 1 ? `${points[0].days}d` : ""}</span>
        <span className="truncate">
          {points.length > 1 ? "days to expiry" : `${points[0]?.days ?? 0}d to expiry`}
        </span>
        <span className="tnum font-mono">
          {points.length > 1 ? `${points[points.length - 1].days}d` : ""}
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
              {`Mark (${unit})`}
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              Source
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              24h
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              {family.markets[0] ? strategyAnalytic(family.markets[0], Number.NaN, Number.NaN, 0).label : "View"}
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              Spread
            </th>
            <th scope="col" className="h-8 px-2 text-right text-xs font-normal text-faint">
              Depth
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
              <td className="px-2 text-right text-xs text-off">{SOURCE_SHORT[market.markSource]}</td>
              <td className="px-2 text-right">
                <Delta
                  value={isTraded(market) ? changePercent(market.netPrice, market.priorNetPrice) : Number.NaN}
                  className="text-xs"
                />
              </td>
              <td className="tnum px-2 text-right font-mono text-xs whitespace-nowrap text-dim">
                {isTraded(market)
                  ? formatAnalytic(strategyAnalytic(market, market.netPrice, market.referencePrice, platformNowSeconds()))
                  : "—"}
              </td>
              <td className="tnum px-2 text-right font-mono text-xs text-dim">
                {formatNumber(spreadOf(market), market.priceDecimals)}
              </td>
              <td className="tnum px-2 text-right font-mono text-xs text-dim">
                {`${formatLots(market.firmDepthLots)} lots`}
              </td>
              <td className="px-2">
                <QualificationTag market={market} bare />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
