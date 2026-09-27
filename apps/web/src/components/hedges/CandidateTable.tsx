"use client";

import { formatCompactUsd, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import type { HedgeCandidate } from "@/lib/hedges/types";

interface CandidateTableProps {
  candidates: HedgeCandidate[];
  selectedId: string | null;
  onSelect: (marketId: string) => void;
}

function qualificationTone(qualification: HedgeCandidate["qualification"]): string {
  if (qualification === "QUALIFIED") return "text-up";
  if (qualification === "CONDITIONAL") return "text-brand";
  return "text-down";
}

export function CandidateTable({ candidates, selectedId, onSelect }: CandidateTableProps) {
  if (candidates.length === 0) {
    return (
      <section aria-label="Package candidates" className="border border-line bg-panel">
        <div className="border-b border-line px-3 py-2.5">
          <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">
            Package candidates
          </span>
        </div>
        <p className="px-3 py-6 text-center text-xs text-faint">
          Resolve the exposure inputs to list listed package templates.
        </p>
      </section>
    );
  }

  const selected = candidates.find((candidate) => candidate.market.id === selectedId) ?? candidates[0];

  return (
    <section aria-label="Package candidates" className="border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">
          Package candidates
        </span>
        <span className="text-xs text-off">listed templates only</span>
      </div>

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-line text-left text-faint">
              <th scope="col" className="px-3 py-2 font-medium">Package</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Exec. price</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Est. collateral</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Residual</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Qualification</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Tenor gap</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => {
              const active = candidate.market.id === selected.market.id;
              return (
                <tr key={candidate.market.id} className={`border-b border-line last:border-b-0 ${active ? "bg-raised" : ""}`}>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onSelect(candidate.market.id)}
                      aria-pressed={active}
                      className="focus-ring block w-full rounded-sm text-left"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${candidate.qualification === "QUALIFIED" ? "bg-up" : candidate.qualification === "CONDITIONAL" ? "bg-brand" : "bg-down"}`}
                        />
                        <span className="truncate font-mono text-ink">{candidate.market.code}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-faint">
                        {`${candidate.market.strategyLabel} · ${candidate.packageDirection.toLowerCase()} · ${candidate.lots} lots`}
                        {candidate.assetMatch ? "" : " · off-asset"}
                      </span>
                    </button>
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-ink">
                    {`${formatNumber(candidate.executablePrice, candidate.market.priceDecimals)} ${priceUnitSuffix(candidate.market.priceUnit)}`}
                    <span className="block text-faint">executable</span>
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-dim">
                    {formatCompactUsd(candidate.collateralEstimate)}
                    <span className="block text-faint">modeled</span>
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-dim">
                    {formatCompactUsd(candidate.residualEstimate)}
                    <span className="block text-faint">modeled</span>
                  </td>
                  <td className={`tnum px-3 py-2 text-right font-mono uppercase ${qualificationTone(candidate.qualification)}`}>
                    {candidate.qualification.toLowerCase()}
                    <span className="block font-sans normal-case text-faint">
                      {candidate.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "cash USDC"}
                    </span>
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-dim">
                    {`${candidate.tenorGapDays}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line px-3 py-2.5">
        <span className="text-xs font-medium tracking-[0.08em] text-faint uppercase">
          Selected package legs
        </span>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {selected.market.legs.map((leg) => (
            <li key={leg.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">{leg.instrument}</span>
                <span className="block text-xs text-faint">
                  {`${leg.side === "BUY" ? "Buy" : "Sell"} ${formatNumber(leg.ratio, 2)}x / ${leg.family.toLowerCase().replaceAll("_", " ")}`}
                </span>
              </span>
              <span className="tnum shrink-0 font-mono text-xs text-dim">
                {`${formatNumber(leg.mark, leg.markUnit === "USD" ? (leg.mark < 10 ? 4 : 2) : 1)} ${priceUnitSuffix(leg.markUnit)}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-snug text-faint">
          Executable price, qualification, and settlement are listed market data. Collateral and
          residual are modeled estimates for the sized lots.
        </p>
      </div>
    </section>
  );
}
