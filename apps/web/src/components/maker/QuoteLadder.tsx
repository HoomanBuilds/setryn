"use client";

import { Chip, Panel, PanelHead, TH, TH_NUM, deskMotion } from "@/components/strategies/desk/Desk";
import type { MakerSeries, QuoteLevel } from "@/lib/maker/types";
import { usdCompact } from "./format";

/**
 * Two-sided quote surface. Levels track the index mark so the ladder and the
 * terminal book read one feed; widths, capacity and costs are fixture values.
 */
export function QuoteLadder({
  series,
  levels,
  drift,
  previewMark,
  skew,
}: {
  series: MakerSeries;
  levels: QuoteLevel[];
  drift: number;
  previewMark: number | null;
  skew: number;
}) {
  const bids = levels.map((level) => level.bid + drift);
  const asks = levels.map((level) => level.ask + drift);
  const lo = Math.min(...bids);
  const hi = Math.max(...asks);
  const span = hi - lo || 1;
  const pos = (value: number) => ((value - lo) / span) * 100;
  const maxCapacity = Math.max(1, ...levels.map((level) => level.indicativeCapacityUsd + level.firmCapacityUsd));
  const origin = levels[0]?.capacityOrigin;

  return (
    <Panel label="Quote surface" delay={60}>
      <PanelHead
        title="Quote surface"
        tools={
          <>
            <span className="hidden truncate text-[11px] text-faint md:inline">{`${series.quoteConvention} / ${series.venueScope}`}</span>
            <Chip title={origin ? `${origin.source}, ${(origin.ageMs / 1000).toFixed(1)}s old` : undefined}>Simulated</Chip>
          </>
        }
      />
      <div role="region" tabIndex={0} aria-label="Quote surface" className="focus-ring scroll-thin overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-xs whitespace-nowrap">
          <caption className="sr-only">Simulated quote surface and capacity ladder</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Package size</th>
              <th scope="col" className={TH_NUM}>Bid</th>
              <th scope="col" className={`${TH} w-[136px] text-center`}>
                <span className="sr-only">Bid to ask band</span>
                <span aria-hidden="true">Band</span>
              </th>
              <th scope="col" className={`${TH} pl-0`}>Ask</th>
              <th scope="col" className={TH_NUM}>Width</th>
              <th scope="col" className={`${TH} w-[156px]`}>Firm sim. / indicative</th>
              <th scope="col" className={TH_NUM}>Fill</th>
              <th scope="col" className={TH_NUM}>Tox.</th>
              <th scope="col" className={TH_NUM}>Edge</th>
              <th scope="col" className={TH_NUM}>Hedge cost</th>
              <th scope="col" className={TH_NUM}>Expiry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {levels.map((level, index) => {
              const bid = bids[index];
              const ask = asks[index];
              const mid = (bid + ask) / 2;
              const skewed = mid + skew;
              const firm = (level.firmCapacityUsd / maxCapacity) * 100;
              const indicative = (level.indicativeCapacityUsd / maxCapacity) * 100;
              return (
                <tr key={level.sizeLabel} className="transition-colors duration-150 hover:bg-raised/50">
                  <td className="h-11 px-3">
                    <span className="tnum font-mono text-[13px] text-ink">{level.sizeLabel}</span>
                    <span className="tnum ml-2 font-mono text-[10px] text-off">{usdCompact(level.notionalUsd)}</span>
                  </td>
                  <td className="tnum px-3 text-right font-mono text-[13px] text-up">
                    {bid.toFixed(1)}
                  </td>
                  <td className="px-2">
                    <div className="relative h-5" aria-hidden="true">
                      <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
                      <span
                        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-linear-to-r from-up/60 to-down/60 transition-[left,width] duration-200 ease-out"
                        style={{ left: `${pos(bid)}%`, width: `${Math.max(1, pos(ask) - pos(bid))}%` }}
                      />
                      <span
                        className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink/70 transition-[left] duration-200 ease-out"
                        style={{ left: `${pos(mid)}%` }}
                      />
                      <span
                        title={`Skewed mid ${skewed.toFixed(1)}`}
                        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] bg-brand transition-[left] duration-200 ease-out"
                        style={{ left: `${Math.min(100, Math.max(0, pos(skewed)))}%` }}
                      />
                    </div>
                  </td>
                  <td className="tnum pr-3 font-mono text-[13px] text-down">
                    {ask.toFixed(1)}
                  </td>
                  <td className="tnum px-3 text-right font-mono text-dim">{`${level.spreadBps.toFixed(1)} ${series.quoteUnit}`}</td>
                  <td className="px-3">
                    <div className="relative h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <span
                        className={`${deskMotion.hatch} absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out`}
                        style={{ width: `${firm + indicative}%` }}
                      />
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-ink/80 transition-[width] duration-200 ease-out"
                        style={{ width: `${firm}%` }}
                      />
                    </div>
                    <div className="tnum mt-1 flex justify-between gap-2 font-mono text-[10px]">
                      <span className="text-ink">{`${usdCompact(level.firmCapacityUsd)} firm`}</span>
                      <span className="text-faint">{`${usdCompact(level.indicativeCapacityUsd)} ind.`}</span>
                    </div>
                  </td>
                  <td className="tnum px-3 text-right font-mono text-dim">{`${level.fillProbability}%`}</td>
                  <td
                    className={`tnum px-3 text-right font-mono ${
                      level.toxicityScore >= 45 ? "text-down" : level.toxicityScore >= 30 ? "text-brand" : "text-dim"
                    }`}
                  >
                    {level.toxicityScore}
                  </td>
                  <td className="tnum px-3 text-right font-mono text-up">{`+${level.expectedEdgeBps.toFixed(1)} bp`}</td>
                  <td className="tnum px-3 text-right font-mono text-dim">{`${level.expectedHedgeCostBps.toFixed(1)} bp`}</td>
                  <td className="tnum px-3 text-right font-mono text-dim">{`${level.expirySeconds}s`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rotate-45 rounded-[1px] bg-brand" />
          {`Skewed mid ${skew >= 0 ? "+" : ""}${skew.toFixed(1)} bp`}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-ink/80" />
          Firm sim.
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`${deskMotion.hatch} h-1.5 w-3 rounded-full`} />
          Indicative
        </span>
        <span className="text-off">
          {previewMark !== null
            ? `Levels track the index mark ${previewMark.toFixed(1)}. All capacity is simulated and cannot execute; firm sim. requires a hypothetical reservation.`
            : "All capacity is simulated and cannot execute; firm sim. requires a hypothetical reservation."}
        </span>
      </div>
    </Panel>
  );
}
