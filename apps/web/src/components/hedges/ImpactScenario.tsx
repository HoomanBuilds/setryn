"use client";

import { formatNumber, formatSignedCompactUsd } from "@/lib/terminal/format";
import type { HedgeCandidate, ScenarioRow } from "@/lib/hedges/types";

interface ImpactScenarioProps {
  candidate: HedgeCandidate | null;
  rows: ScenarioRow[];
}

export function ImpactScenario({ candidate, rows }: ImpactScenarioProps) {
  return (
    <section aria-label="Scenario impact" className="border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">
          Scenario impact
        </span>
        <span className="text-xs text-off">modeled</span>
      </div>

      {!candidate || rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-faint">
          Select a package candidate to compare unhedged versus hedged outcomes.
        </p>
      ) : (
        <>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-line text-faint">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Ref. move</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Unhedged</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Package</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const netTone =
                    row.netModeled > 0 ? "text-up" : row.netModeled < 0 ? "text-down" : "text-dim";
                  return (
                    <tr key={row.movePct} className="border-b border-line last:border-b-0">
                      <td className="tnum px-3 py-2 font-mono text-faint">
                        {`${row.movePct > 0 ? "+" : ""}${formatNumber(row.movePct, 0)}%`}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-mono text-dim">
                        {formatSignedCompactUsd(row.unhedged)}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-mono text-dim">
                        {formatSignedCompactUsd(row.packageModeled)}
                      </td>
                      <td className={`tnum px-3 py-2 text-right font-mono ${netTone}`}>
                        {formatSignedCompactUsd(row.netModeled)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-3 py-2 text-xs leading-snug text-faint">
            Modeled at expiry for {candidate.market.code} ({candidate.packageDirection.toLowerCase()},{" "}
            {candidate.lots} lots). Unhedged is the bare cash-flow move; package and net are model
            outputs, not executable quotes.
          </p>
        </>
      )}
    </section>
  );
}
