"use client";

import { Chip, Panel, PanelHead, TH, TH_NUM, deskMotion } from "@/components/strategies/desk/Desk";
import { formatCompactUsd, formatNumber, formatShare, priceUnitSuffix } from "@/lib/terminal/format";
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

function qualificationDot(qualification: HedgeCandidate["qualification"]): string {
  if (qualification === "QUALIFIED") return "bg-up";
  if (qualification === "CONDITIONAL") return "bg-brand";
  return "bg-down";
}

export function CandidateTable({ candidates, selectedId, onSelect }: CandidateTableProps) {
  if (candidates.length === 0) {
    return (
      <Panel label="Package candidates" delay={120}>
        <PanelHead title="Package candidates" tools={<Chip>Listed templates</Chip>} />
        <p className="px-3 py-8 text-center text-xs text-faint">
          Resolve the exposure inputs to list listed package templates.
        </p>
      </Panel>
    );
  }

  const selected = candidates.find((candidate) => candidate.market.id === selectedId) ?? candidates[0];

  return (
    <Panel label="Package candidates" delay={120}>
      <PanelHead
        title="Package candidates"
        tools={
          <>
            <span className="hidden text-[11px] text-faint sm:inline">Ranked by objective</span>
            <Chip>Listed templates</Chip>
          </>
        }
      />

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${TH} w-10`}>Rank</th>
              <th scope="col" className={TH}>Package</th>
              <th scope="col" className={TH_NUM}>Exec. price</th>
              <th scope="col" className={TH_NUM}>Coverage</th>
              <th scope="col" className={TH_NUM}>Est. collateral</th>
              <th scope="col" className={TH_NUM}>Residual</th>
              <th scope="col" className={TH}>Qualification</th>
              <th scope="col" className={TH_NUM}>Tenor gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {candidates.map((candidate) => {
              const active = candidate.market.id === selected.market.id;
              return (
                <tr
                  key={candidate.market.id}
                  className={`relative transition-colors duration-150 ${active ? "bg-raised" : "hover:bg-raised/50"}`}
                >
                  <td className="relative px-3 py-2">
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand transition-opacity duration-200 ${
                        active ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <span className={`tnum font-mono ${active ? "text-brand" : "text-off"}`}>{candidate.rank}</span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onSelect(candidate.market.id)}
                      aria-pressed={active}
                      className="focus-ring block w-full rounded-sm text-left after:absolute after:inset-0 after:content-['']"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-[13px] text-ink">{candidate.market.code}</span>
                        {candidate.assetMatch ? null : <Chip tone="down">Off-asset</Chip>}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-faint">
                        {`${candidate.market.strategyLabel} / ${candidate.packageDirection.toLowerCase()} / ${candidate.lots} lots`}
                      </span>
                    </button>
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-ink">
                    {`${formatNumber(candidate.executablePrice, candidate.market.priceDecimals)} ${priceUnitSuffix(candidate.market.priceUnit)}`}
                    <span className="block text-[10px] text-faint">executable</span>
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-dim">
                    {formatShare(candidate.coverageRatio, 0)}
                    <span className="block text-[10px] text-faint">{formatCompactUsd(candidate.notionalCovered)}</span>
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-dim">
                    {formatCompactUsd(candidate.collateralEstimate)}
                    <span className="block text-[10px] text-faint">modeled</span>
                  </td>
                  <td className="tnum px-3 py-2 text-right font-mono text-dim">
                    {formatCompactUsd(candidate.residualEstimate)}
                    <span className="block text-[10px] text-faint">modeled</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1.5 ${qualificationTone(candidate.qualification)}`}>
                      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${qualificationDot(candidate.qualification)}`} />
                      {candidate.qualification.toLowerCase()}
                    </span>
                    <span className="block text-[10px] text-faint">
                      {candidate.settlementClass === "CASH_USDC_NDF" ? "NDF cash" : "cash USDC"}
                    </span>
                  </td>
                  <td
                    className={`tnum px-3 py-2 text-right font-mono ${
                      candidate.tenorGapDays === 0 ? "text-up" : candidate.tenorGapDays > 30 ? "text-brand" : "text-dim"
                    }`}
                  >
                    {`${candidate.tenorGapDays}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div key={selected.market.id} className={`${deskMotion.fade} border-t border-line`}>
        <div className="flex h-8 items-center justify-between px-3">
          <span className="text-[11px] text-faint">{`Selected package legs / ${selected.market.code}`}</span>
          <span className="tnum font-mono text-[11px] text-off">{`${selected.market.legs.length} legs`}</span>
        </div>
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          {selected.market.legs.map((leg) => (
            <li key={leg.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-1.5">
              <span
                className={`inline-flex h-5 items-center justify-center rounded-[4px] font-mono text-[10px] ${
                  leg.side === "BUY" ? "bg-up-soft text-up" : "bg-down-soft text-down"
                }`}
              >
                {leg.side === "BUY" ? "Buy" : "Sell"}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">{leg.instrument}</span>
                <span className="block truncate text-[11px] text-faint">
                  {`${formatNumber(leg.ratio, 2)}x / ${leg.family.toLowerCase().replaceAll("_", " ")}`}
                </span>
              </span>
              <span className="tnum shrink-0 font-mono text-xs text-dim">
                {`${formatNumber(leg.mark, leg.markUnit === "USD" ? (leg.mark < 10 ? 4 : 2) : 1)} ${priceUnitSuffix(leg.markUnit)}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-faint">
          Executable price, qualification, and settlement are listed market data. Collateral and
          residual are modeled estimates for the sized lots.
        </p>
      </div>
    </Panel>
  );
}
