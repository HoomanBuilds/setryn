"use client";

import Link from "next/link";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import {
  Aggregate,
  DivergingBar,
  Panel,
  PlaneFooter,
  PlaneNote,
  ShareBar,
  StateTag,
  TABLE,
} from "@/components/portfolio/panels";
import { SummaryStrip, type SummaryMetric } from "@/components/portfolio/SummaryStrip";
import { DataRow, tone } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatMultiple,
  formatShare,
  formatSignedUsd,
  formatUsd,
} from "@/lib/terminal/format";
import { portfolioRuntime, positionOrigin } from "@/lib/portfolio/runtime";
import type { PnlBreakdown, Position } from "@/lib/portfolio/types";

const COMPONENTS: { key: keyof Omit<PnlBreakdown, "total">; label: string }[] = [
  { key: "price", label: "Mark to market" },
  { key: "carry", label: "Carry" },
  { key: "funding", label: "Funding" },
  { key: "fees", label: "Fees" },
  { key: "residual", label: "Residual" },
];

function Metrics({ portfolio }: { portfolio: ReturnType<typeof portfolioRuntime> }) {
  const { account, runtimePnl } = portfolio;
  const metrics: SummaryMetric[] = [
    {
      label: "Account equity",
      value: formatUsd(account.equity, 0),
      note: "runtime account value",
    },
    {
      label: "Eligible collateral",
      value: formatUsd(account.eligible, 0),
      note: "USDC only in this session",
    },
    {
      label: "Reserved",
      value: formatUsd(account.reserved, 0),
      note: `${formatShare(account.marginUsage)} of eligible`,
    },
    {
      label: "Available",
      value: formatUsd(account.available, 0),
      note: `${formatSignedUsd(runtimePnl.total, 0)} runtime PnL`,
      noteTone: tone(runtimePnl.total),
    },
  ];
  return <SummaryStrip metrics={metrics} />;
}

function PositionRows({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <div className="px-3 py-7 text-center text-xs text-faint lg:px-4">
        No runtime packages yet. Reference observations remain available in the full position book.
      </div>
    );
  }
  return (
    <table className={`${TABLE} min-w-[600px] table-fixed`}>
      <thead className="bg-panel text-faint">
        <tr className="border-b border-line">
          <th className="h-8 px-3 text-left text-xs font-normal">Package</th>
          <th className="h-8 px-2 text-right text-xs font-normal">Lots</th>
          <th className="h-8 px-2 text-right text-xs font-normal">Entry</th>
          <th className="h-8 px-2 text-right text-xs font-normal">PnL</th>
          <th className="h-8 px-3 text-left text-xs font-normal">Lifecycle</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-soft">
        {positions.map((position) => (
          <tr key={position.id} className="hover:bg-raised/60">
            <th className="px-3 py-2 text-left text-xs font-normal">
              <Link href={position.href} className="focus-ring flex min-w-0 flex-col">
                <span className="truncate text-ink">{position.label}</span>
                <span className="truncate font-mono text-xs text-faint">{positionOrigin(position)}</span>
              </Link>
            </th>
            <td className={`px-2 py-2 text-right font-mono text-xs ${position.side === "LONG" ? "text-up" : "text-down"}`}>
              {`${position.signedLots > 0 ? "+" : ""}${position.signedLots}`}
            </td>
            <td className="px-2 py-2 text-right font-mono text-xs text-dim">{position.entryPrice.toLocaleString()}</td>
            <td className={`px-2 py-2 text-right font-mono text-xs ${tone(position.pnl.total)}`}>
              {formatSignedUsd(position.pnl.total, 0)}
            </td>
            <td className="px-3 py-2 text-xs"><StateTag state={position.state} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RuntimeHealth({ portfolio }: { portfolio: ReturnType<typeof portfolioRuntime> }) {
  const { account, runtimePnl } = portfolio;
  const scale = Math.max(...COMPONENTS.map((component) => Math.abs(runtimePnl[component.key])), 1);
  return (
    <aside className="flex min-w-0 flex-col border-line lg:border-l">
      <Panel title="Runtime account" note="Observable local session state">
        <div className="px-3 py-3 lg:px-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-dim">Reservation utilisation</span>
            <span className="font-mono text-sm text-ink">{formatShare(account.marginUsage)}</span>
          </div>
          <div className="mt-2 mb-3"><ShareBar value={account.marginUsage} /></div>
          <div className="divide-y divide-line border-t border-line">
            <DataRow label="Posted" value={formatUsd(account.postedValue, 0)} />
            <DataRow label="Eligible" value={formatUsd(account.eligible, 0)} />
            <DataRow label="Reserved" value={formatUsd(account.reserved, 0)} />
            <DataRow label="Available" value={formatUsd(account.available, 0)} />
            <DataRow label="Runtime packages" value={String(portfolio.runtimePositions.length)} />
            <DataRow
              label="Maintenance health"
              value={account.maintenanceMargin === 0 ? "No active requirement" : formatMultiple(account.healthFactor)}
              tone="muted"
            />
          </div>
        </div>
      </Panel>
      <Panel title="Runtime PnL" note="Marks are simulated, not oracle observations">
        <table className={TABLE}>
          <tbody className="divide-y divide-line-soft">
            {COMPONENTS.map((component) => {
              const value = runtimePnl[component.key];
              return (
                <tr key={component.key}>
                  <th className="px-3 py-2 text-left text-xs font-normal text-dim lg:px-4">{component.label}</th>
                  <td className="w-[34%] px-2 py-2"><DivergingBar value={value} scale={scale} /></td>
                  <td className={`px-3 py-2 text-right font-mono text-xs lg:px-4 ${tone(value)}`}>{formatSignedUsd(value, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </aside>
  );
}

export function OverviewView() {
  const snapshot = useGatewaySnapshot();
  const portfolio = portfolioRuntime(snapshot);

  return (
    <div className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <Metrics portfolio={portfolio} />
      <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:flex-row lg:overflow-hidden">
        <section className="scroll-thin flex min-w-0 flex-1 flex-col lg:overflow-y-auto">
          <Panel
            title="Runtime packages"
            note="Created through this browser session"
            aside={<Link href="/portfolio/positions" className="focus-ring text-xs text-dim hover:text-ink">Full book</Link>}
          >
            <div className="scroll-thin overflow-x-auto"><PositionRows positions={portfolio.runtimePositions} /></div>
          </Panel>
          <Panel title="Reference package observations" note="Simulated market and attribution data, separate from account equity">
            <div className="scroll-thin overflow-x-auto"><PositionRows positions={portfolio.referencePositions.slice(0, 4)} /></div>
          </Panel>
          <PlaneFooter>
            <Aggregate label="Runtime gross" value={formatCompactUsd(portfolio.runtimeGross)} />
            <Aggregate label="Runtime net" value={formatSignedUsd(portfolio.runtimeNet, 0)} valueTone={tone(portfolio.runtimeNet)} />
            <Aggregate label="Reference PnL" value={formatSignedUsd(portfolio.referencePnl.total, 0)} valueTone={tone(portfolio.referencePnl.total)} />
          </PlaneFooter>
        </section>
        <RuntimeHealth portfolio={portfolio} />
      </div>
      <PlaneNote>
        Runtime account values come from the local execution gateway. Reference observations are retained for market analysis and are not withdrawable balances or live settlement data.
      </PlaneNote>
    </div>
  );
}
