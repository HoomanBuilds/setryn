"use client";

import { useMemo } from "react";
import {
  Chip,
  Flash,
  Panel,
  PanelHead,
  RangeField,
  compact,
} from "@/components/strategies/desk/Desk";
import { PayoffPlot, breakevens, valueAt } from "@/components/strategies/desk/PayoffPlot";
import { formatMove, formatTick } from "@/components/strategies/studio-model";
import { formatNumber } from "@/lib/terminal/format";
import { packageValueAt, unhedgedValueAt } from "@/lib/hedges/engine";
import type { ExposureInput, HedgeCandidate } from "@/lib/hedges/types";

export interface HedgeCurves {
  unhedged: { x: number; y: number }[];
  pkg: { x: number; y: number }[];
  net: { x: number; y: number }[];
  moveMin: number;
  moveMax: number;
}

/** Moves of the reference, in percent, the chart spans: both range kinks plus a margin, at least +/-20%. */
function moveRange(candidate: HedgeCandidate): number {
  if (!candidate.terms || candidate.reference === null || candidate.reference <= 0) return 20;
  const reach = Math.max(Math.abs(candidate.terms.floor / candidate.reference - 1), Math.abs(candidate.terms.cap / candidate.reference - 1));
  return Math.max(20, Math.min(95, Math.ceil(reach * 110)));
}

/**
 * The engine's scenario rows as continuous curves: the bare cash flow, the package's payoff at each fixing (bending at
 * the range's floor and cap), and their sum, sampled so the chart and the table agree.
 */
export function hedgeCurves(candidate: HedgeCandidate, exposure: ExposureInput): HedgeCurves {
  const range = moveRange(candidate);
  const moves = new Set<number>();
  for (let index = 0; index <= 60; index += 1) moves.add(Number((-range + (2 * range * index) / 60).toFixed(3)));
  if (candidate.terms && candidate.reference !== null && candidate.reference > 0) {
    for (const bound of [candidate.terms.floor, candidate.terms.cap]) {
      const move = Number(((bound / candidate.reference - 1) * 100).toFixed(3));
      if (move > -range && move < range) moves.add(move);
    }
  }
  const unhedged: { x: number; y: number }[] = [];
  const pkg: { x: number; y: number }[] = [];
  const net: { x: number; y: number }[] = [];
  for (const move of [...moves].sort((left, right) => left - right)) {
    const bare = unhedgedValueAt(exposure, move);
    const value = packageValueAt(candidate, move);
    unhedged.push({ x: move, y: bare });
    pkg.push({ x: move, y: value });
    net.push({ x: move, y: bare + value });
  }
  return { unhedged, pkg, net, moveMin: -range, moveMax: range };
}

function signed(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value), 0)}`;
}

function tone(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-dim";
}

const LEGEND = [
  { id: "net", label: "Hedged net", swatch: "bg-ink" },
  { id: "unhedged", label: "Unhedged", swatch: "bg-dim", dashed: true },
  { id: "package", label: "Package", swatch: "bg-faint" },
];

export function HedgePayoff({
  candidate,
  exposure,
  curves,
  move,
  onMove,
  referenceLabel,
}: {
  candidate: HedgeCandidate | null;
  exposure: ExposureInput;
  curves: HedgeCurves | null;
  move: number;
  onMove: (move: number) => void;
  referenceLabel: string;
}) {
  const series = useMemo(
    () =>
      curves
        ? [
            { id: "net", label: "Hedged net", points: curves.net, tone: "ink" as const, primary: true },
            { id: "unhedged", label: "Unhedged", points: curves.unhedged, tone: "dim" as const, dashed: true },
            { id: "package", label: "Package", points: curves.pkg, tone: "faint" as const },
          ]
        : [],
    [curves],
  );

  const netAt = curves ? valueAt(curves.net, move) : 0;
  const bareAt = curves ? valueAt(curves.unhedged, move) : 0;
  const pkgAt = curves ? valueAt(curves.pkg, move) : 0;
  const crossings = curves ? breakevens(curves.net) : [];

  return (
    <Panel label="Hedged payoff" delay={80}>
      <PanelHead
        title="Hedged payoff"
        tools={
          <>
            <span className="hidden items-center gap-3 md:flex">
              {LEGEND.map((item) => (
                <span key={item.id} className="flex items-center gap-1.5 text-[11px] text-faint">
                  <span
                    aria-hidden="true"
                    className={`inline-block w-3 ${item.dashed ? "h-0 border-t border-dashed border-dim" : `h-0.5 rounded-full ${item.swatch}`}`}
                  />
                  {item.label}
                </span>
              ))}
            </span>
            <Chip title="The contract's payoff at each fixing, at the hedge's entry level">At expiry</Chip>
          </>
        }
      />

      {!candidate || !curves ? (
        <p className="px-3 py-12 text-center text-xs text-faint">
          Resolve the exposure and select a candidate to see the hedged outcome.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            <div className="min-w-0 bg-panel px-3 py-2">
              <div className="truncate text-[11px] text-faint">{`Hedged net at ${formatMove(move)}`}</div>
              <div className={`tnum mt-0.5 font-mono text-[15px] ${tone(netAt)}`}>
                <Flash value={Math.round(netAt)} neutral>
                  {signed(netAt)}
                </Flash>
              </div>
            </div>
            <div className="min-w-0 bg-panel px-3 py-2">
              <div className="truncate text-[11px] text-faint">Unhedged</div>
              <div className={`tnum mt-0.5 font-mono text-[15px] ${tone(bareAt)}`}>{signed(bareAt)}</div>
            </div>
            <div className="min-w-0 bg-panel px-3 py-2">
              <div className="truncate text-[11px] text-faint">Package offset</div>
              <div className={`tnum mt-0.5 font-mono text-[15px] ${tone(pkgAt)}`}>{signed(pkgAt)}</div>
            </div>
            <div className="min-w-0 bg-panel px-3 py-2">
              <div className="truncate text-[11px] text-faint">Net breakeven</div>
              <div className="tnum mt-0.5 truncate font-mono text-[15px] text-ink">
                {crossings.length > 0 ? crossings.map((value) => formatMove(value)).join(" / ") : "None in range"}
              </div>
            </div>
          </div>

          <div className="h-[260px] px-2 pt-2 sm:h-[280px]">
            <PayoffPlot
              series={series}
              marker={move}
              onMarker={onMove}
              markerStep={0.5}
              xFormat={formatTick}
              yFormat={(value) => compact(value, true)}
              yTooltipFormat={(value) => `${signed(value)} ${exposure.settlementAssetId}`}
              spotLabel="today"
              ariaLabel={`Modeled ${exposure.direction.toLowerCase()} outcome for ${referenceLabel}, hedged with ${candidate.market.code}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 md:hidden">
            {LEGEND.map((item) => (
              <span key={item.id} className="flex items-center gap-1.5 text-[11px] text-faint">
                <span
                  aria-hidden="true"
                  className={`inline-block w-3 ${item.dashed ? "h-0 border-t border-dashed border-dim" : `h-0.5 rounded-full ${item.swatch}`}`}
                />
                {item.label}
              </span>
            ))}
          </div>

          <div className="border-t border-line px-3 pt-2 pb-3">
            <RangeField
              label={`Scenario: ${referenceLabel} move`}
              value={move}
              min={curves.moveMin}
              max={curves.moveMax}
              step={0.5}
              origin={0}
              onChange={onMove}
              ariaLabel="Scenario reference move in percent"
              readout={formatMove(move)}
              minLabel={formatTick(curves.moveMin)}
              maxLabel={formatTick(curves.moveMax)}
            />
          </div>
        </>
      )}
    </Panel>
  );
}
