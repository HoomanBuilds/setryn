"use client";

import { Chip, Panel, PanelHead, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import { formatMinorUsdc, formatStamp, shortHash, type RevenueReport } from "./api";

/**
 * Revenue reconciliation. Fees are OBSERVED from FillCleared records on the settlement chain; the partner share accrues
 * from each deployment's fee-share setting. No payout exists onchain yet, so every accrual is unpaid.
 */
export function RevenuePanel({ report }: { report: RevenueReport | null }) {
  return (
    <div className="grid min-w-0 gap-1">
      <Panel label="Revenue reconciliation">
        <PanelHead
          title="Revenue reconciliation"
          tools={
            <>
              <Chip tone="brand" title="Partner share accrues from observed onchain fees at the fee-share setting; no onchain payout exists yet">Accrued, unpaid</Chip>
              <Chip tone="dim">
                {report?.available ? `${report.totalFills} fills to block ${report.scannedToBlock}` : "chain unavailable"}
              </Chip>
            </>
          }
        />
        {report && !report.available ? <p role="status" className="px-3 py-2 text-xs text-dim">{report.reason}</p> : null}
        <div role="region" aria-label="Revenue reconciliation table" tabIndex={0} className="focus-ring scroll-thin min-w-0 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Partner</th>
                <th scope="col" className={TH_NUM}>Attributed fills</th>
                <th scope="col" className={TH_NUM}>Lots</th>
                <th scope="col" className={TH_NUM}>Protocol fees (observed)</th>
                <th scope="col" className={TH_NUM}>Fee share</th>
                <th scope="col" className={TH_NUM}>Partner share (accrued)</th>
                <th scope="col" className={TH}>Reconciliation</th>
              </tr>
            </thead>
            <tbody>
              {!report || report.rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-dim">No partner deployments to reconcile.</td></tr>
              ) : (
                report.rows.map((row) => (
                  <tr key={row.partner} className="border-b border-line-soft">
                    <td className="px-3 py-2">
                      <span className="block text-ink">{row.name}</span>
                      <span className="block font-mono text-[11px] text-faint">{row.partner}</span>
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono text-ink">{row.fills}</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-dim">{row.lots}</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-ink">{formatMinorUsdc(row.feesMinor)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-dim">{(row.revShareBps / 100).toFixed(2)}%</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-brand">{formatMinorUsdc(row.accruedShareMinor)}</td>
                    <td className="px-3 py-2"><Chip tone="brand">Accrued · unpaid</Chip></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-3 py-2 text-[11px] text-faint">
          A fill side is attributed when its order account is listed on the deployment. Fees are the fill record&apos;s charge minus rebate for that side.
        </p>
      </Panel>
      <Panel label="Attributed fills">
        <PanelHead title="Attributed fills" tools={<Chip tone="dim">{report?.fills.length ?? 0}</Chip>} />
        <div role="region" aria-label="Attributed fills table" tabIndex={0} className="focus-ring scroll-thin max-h-[420px] min-w-0 overflow-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Fill</th>
                <th scope="col" className={TH}>Partner</th>
                <th scope="col" className={TH}>Side</th>
                <th scope="col" className={TH_NUM}>Lots</th>
                <th scope="col" className={TH_NUM}>Fee (observed)</th>
                <th scope="col" className={TH_NUM}>Share (accrued)</th>
                <th scope="col" className={TH}>Cleared</th>
              </tr>
            </thead>
            <tbody>
              {!report || report.fills.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-dim">No fills attributed to a partner account yet.</td></tr>
              ) : (
                report.fills.map((fill) => (
                  <tr key={`${fill.fillId}-${fill.partner}-${fill.role}`} className="border-b border-line-soft">
                    <td className="px-3 py-2 font-mono text-ink" title={fill.fillId}>{shortHash(fill.fillId, 10, 6)}</td>
                    <td className="px-3 py-2 font-mono text-dim">{fill.partner}</td>
                    <td className="px-3 py-2 text-dim">{fill.role}</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-dim">{fill.lots}</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-ink">{formatMinorUsdc(fill.feeMinor)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono text-brand">{formatMinorUsdc(fill.accruedShareMinor)}</td>
                    <td className="tnum px-3 py-2 font-mono text-[11px] text-dim">{formatStamp(fill.clearedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
