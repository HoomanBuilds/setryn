"use client";

import { useState } from "react";
import {
  Chip,
  DeskTabs,
  Flash,
  Panel,
  PanelHead,
  RangeField,
  TabBody,
  TH,
  TH_NUM,
  compact,
} from "@/components/strategies/desk/Desk";
import { PayoffPlot, valueAt } from "@/components/strategies/desk/PayoffPlot";
import { formatMove, formatTick, type PayoffSummary } from "@/components/strategies/studio-model";
import { formatNumber, formatShare } from "@/lib/terminal/format";

const QUICK_MOVES = [-20, -10, -5, 0, 5, 10, 20];

function signedUsd(value: number, decimals = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value), decimals)}`;
}

function toneFor(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-dim";
}

export function PayoffPanel({
  summary,
  move,
  onMove,
  lots,
  collateral,
  moveUnit,
  className = "",
}: {
  summary: PayoffSummary;
  move: number;
  onMove: (move: number) => void;
  lots: number;
  collateral: number;
  moveUnit: string;
  className?: string;
}) {
  const [tab, setTab] = useState("PAYOFF");
  const pnl = valueAt(summary.points, move);
  const underlying = moveUnit.replace(/,?\s*percent$/i, "");
  const quick = QUICK_MOVES.filter((value) => value >= summary.moveMin && value <= summary.moveMax);
  const gridRows = summary.points.filter((_, index) => index % 4 === 0 || index === summary.points.length - 1);

  return (
    <Panel label="Scenario payoff" delay={80} className={className}>
      <PanelHead
        tabs={
          <DeskTabs
            idBase="studio-payoff"
            value={tab}
            onChange={setTab}
            items={[
              { id: "PAYOFF", label: "Payoff" },
              { id: "GRID", label: "Scenario grid" },
            ]}
          />
        }
        tools={
          <>
            <span className="hidden text-[11px] text-faint sm:inline">At expiry, USDC</span>
            <Chip title="Model output, not an executable quote">Modeled</Chip>
          </>
        }
      />

      {summary.points.length === 0 ? (
        <p className="px-3 py-12 text-center text-xs text-faint">
          No mark or reference has been read for this market yet. The payoff draws as soon as the feed reports one.
        </p>
      ) : tab === "PAYOFF" ? (
        <TabBody idBase="studio-payoff" className="flex min-h-0 flex-1 flex-col">
          <div className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
            <div className="min-w-0 border-r border-line px-3 py-2">
              <div className="truncate text-[11px] text-faint">{`P&L at ${formatMove(move)}`}</div>
              <div className={`tnum mt-0.5 font-mono text-[15px] ${toneFor(pnl)}`}>
                <Flash value={Math.round(pnl)} neutral>
                  {signedUsd(pnl)}
                </Flash>
              </div>
            </div>
            <div className="min-w-0 px-3 py-2 sm:border-r sm:border-line">
              <div className="truncate text-[11px] text-faint">Breakeven</div>
              <div className="tnum mt-0.5 truncate font-mono text-[15px] text-ink">
                {summary.breakevens.length > 0 ? summary.breakevens.map((value) => formatMove(value)).join(" / ") : "None in range"}
              </div>
            </div>
            <div className="min-w-0 border-t border-r border-line px-3 py-2 sm:border-t-0">
              <div className="truncate text-[11px] text-faint">Max gain</div>
              <div className={`tnum mt-0.5 font-mono text-[15px] ${toneFor(summary.maxGain)}`}>{signedUsd(summary.maxGain)}</div>
            </div>
            <div className="min-w-0 border-t border-line px-3 py-2 sm:border-t-0">
              <div className="truncate text-[11px] text-faint">Max loss</div>
              <div className={`tnum mt-0.5 font-mono text-[15px] ${toneFor(summary.maxLoss)}`}>{signedUsd(summary.maxLoss)}</div>
            </div>
          </div>

          <div className="h-[260px] min-h-0 px-2 pt-2 sm:h-[300px] xl:h-auto xl:min-h-[240px] xl:flex-1">
            <PayoffPlot
              series={[{ id: "package", label: "Package", points: summary.points, tone: "ink", primary: true }]}
              marker={move}
              onMarker={onMove}
              markerStep={0.5}
              xFormat={formatTick}
              yFormat={(value) => compact(value, true)}
              yTooltipFormat={(value) => `${signedUsd(value)} USDC`}
              spotLabel="spot"
              ariaLabel={`Modeled payoff at expiry for ${lots} lots against ${underlying.toLowerCase()}`}
            />
          </div>

          <div className="grid gap-3 border-t border-line px-3 pt-2.5 pb-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <RangeField
              label={`Scenario: ${underlying}`}
              value={move}
              min={summary.moveMin}
              max={summary.moveMax}
              step={0.5}
              origin={0}
              onChange={onMove}
              ariaLabel="Scenario underlying move in percent"
              readout={formatMove(move)}
              minLabel={formatTick(summary.moveMin)}
              maxLabel={formatTick(summary.moveMax)}
            />
            <div className="no-scrollbar flex gap-1 overflow-x-auto" role="group" aria-label="Scenario presets">
              {quick.map((value) => {
                const at = valueAt(summary.points, value);
                const active = Math.abs(move - value) < 0.01;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onMove(value)}
                    aria-pressed={active}
                    className={`focus-ring min-w-[58px] shrink-0 rounded-md border px-2 py-1 text-left transition-colors duration-150 ${
                      active ? "border-brand-edge bg-brand-soft" : "border-line hover:border-line-strong hover:bg-raised"
                    }`}
                  >
                    <span className={`tnum block font-mono text-[10px] ${active ? "text-brand" : "text-faint"}`}>
                      {formatTick(value)}
                    </span>
                    <span className={`tnum block font-mono text-[11px] ${toneFor(at)}`}>{compact(at, true)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </TabBody>
      ) : (
        <TabBody idBase="studio-payoff" className="scroll-thin min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line">
                <th scope="col" className={TH}>{underlying}</th>
                <th scope="col" className={TH_NUM}>Package P&amp;L</th>
                <th scope="col" className={TH_NUM}>Per lot</th>
                <th scope="col" className={TH_NUM}>On collateral</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {gridRows.map((point) => {
                const active = Math.abs(point.x - move) < 0.84;
                return (
                  <tr
                    key={point.x}
                    onClick={() => onMove(point.x)}
                    className={`cursor-pointer transition-colors hover:bg-raised/60 ${active ? "bg-brand-soft" : ""}`}
                  >
                    <td className={`tnum h-7 px-3 font-mono ${active ? "text-brand" : "text-dim"}`}>{formatMove(point.x)}</td>
                    <td className={`tnum px-3 text-right font-mono ${toneFor(point.y)}`}>{signedUsd(point.y)}</td>
                    <td className="tnum px-3 text-right font-mono text-dim">{signedUsd(point.y / Math.max(1, lots), 2)}</td>
                    <td className={`tnum px-3 text-right font-mono ${toneFor(point.y)}`}>
                      {collateral > 0 ? `${point.y >= 0 ? "+" : "-"}${formatShare(Math.abs(point.y) / collateral)}` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TabBody>
      )}

      <p className="border-t border-line px-3 py-1.5 text-[11px] leading-snug text-faint">
        Baseline is zero package exposure. Values are model outputs, not executable quotes. Drag on the chart to move the scenario.
      </p>
    </Panel>
  );
}
