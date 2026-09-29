"use client";

import { Chip, Panel, PanelHead, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import { formatNumber, formatSignedCompactUsd } from "@/lib/terminal/format";
import type { HedgeCandidate, ScenarioRow } from "@/lib/hedges/types";

interface ImpactScenarioProps {
  candidate: HedgeCandidate | null;
  rows: ScenarioRow[];
  activeMove?: number;
  onSelectMove?: (move: number) => void;
}

function tone(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-dim";
}

function compactUsd(value: number): string {
  return formatSignedCompactUsd(value).replace(" USDC", "");
}

export function ImpactScenario({ candidate, rows, activeMove, onSelectMove }: ImpactScenarioProps) {
  const extent = Math.max(1, ...rows.flatMap((row) => [Math.abs(row.unhedged), Math.abs(row.netModeled)]));
  const nearest =
    activeMove === undefined || rows.length === 0
      ? null
      : rows.reduce((best, row) => (Math.abs(row.movePct - activeMove) < Math.abs(best.movePct - activeMove) ? row : best)).movePct;

  return (
    <Panel label="Scenario impact" delay={160}>
      <PanelHead title="Scenario impact" tools={<Chip title="Model output, not an executable quote">Modeled</Chip>} />

      {!candidate || rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-faint">
          Select a package candidate to compare unhedged versus hedged outcomes.
        </p>
      ) : (
        <>
          <table className="w-full table-fixed border-collapse text-xs">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={`${TH} w-[64px]`}>Move</th>
                <th scope="col" className={TH_NUM}>Unhedged</th>
                <th scope="col" className={TH_NUM}>Package</th>
                <th scope="col" className={TH_NUM}>Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((row) => {
                const active = nearest === row.movePct;
                return (
                  <tr
                    key={row.movePct}
                    onClick={onSelectMove ? () => onSelectMove(row.movePct) : undefined}
                    className={`transition-colors duration-150 ${onSelectMove ? "cursor-pointer" : ""} ${
                      active ? "bg-brand-soft" : "hover:bg-raised/50"
                    }`}
                  >
                    <td className={`tnum h-9 px-3 font-mono ${active ? "text-brand" : "text-faint"}`}>
                      {`${row.movePct > 0 ? "+" : ""}${formatNumber(row.movePct, 0)}%`}
                    </td>
                    <td className="tnum px-3 text-right font-mono text-dim">{compactUsd(row.unhedged)}</td>
                    <td className="tnum px-3 text-right font-mono text-dim">{compactUsd(row.packageModeled)}</td>
                    <td className="px-3 text-right">
                      <span className={`tnum block font-mono ${tone(row.netModeled)}`}>{compactUsd(row.netModeled)}</span>
                      <span aria-hidden="true" className="mt-1 ml-auto block h-[2px] w-full rounded-full bg-line">
                        <span
                          className={`ml-auto block h-full rounded-full transition-[width] duration-200 ease-out ${
                            row.netModeled >= 0 ? "bg-up/70" : "bg-down/70"
                          }`}
                          style={{ width: `${(Math.abs(row.netModeled) / extent) * 100}%` }}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-faint">
            Modeled at expiry for {candidate.market.code} ({candidate.packageDirection.toLowerCase()},{" "}
            {candidate.lots} lots). Unhedged is the bare cash-flow move; package and net are model
            outputs, not executable quotes.
          </p>
        </>
      )}
    </Panel>
  );
}
