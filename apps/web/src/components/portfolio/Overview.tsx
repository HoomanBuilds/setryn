"use client";

import Link from "next/link";
import {
  Aggregate,
  DivergingBar,
  NUM,
  Panel,
  PlaneFooter,
  PlaneNote,
  ShareBar,
  StateTag,
  TABLE,
  TD,
  TH,
} from "@/components/portfolio/panels";
import { SummaryStrip, type SummaryMetric } from "@/components/portfolio/SummaryStrip";
import { DataRow, tone } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatExpiry,
  formatMultiple,
  formatPrice,
  formatShare,
  formatSigned,
  formatSignedUsd,
  formatUsd,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import {
  ACCOUNT_SUMMARY,
  NEXT_EXPIRY,
  PORTFOLIO_PNL,
  POSITIONS,
} from "@/lib/portfolio/model";
import { MARK_AGE } from "@/lib/portfolio/provenance";
import type { PnlBreakdown, Position } from "@/lib/portfolio/types";

const ACCOUNT_METRICS: SummaryMetric[] = [
  {
    label: "Equity",
    value: formatUsd(ACCOUNT_SUMMARY.equity, 0),
    note: `${formatSignedUsd(PORTFOLIO_PNL.total, 0)} open`,
    noteTone: tone(PORTFOLIO_PNL.total),
  },
  {
    label: "Available collateral",
    value: formatUsd(ACCOUNT_SUMMARY.available, 0),
    note: `${formatShare(ACCOUNT_SUMMARY.available / ACCOUNT_SUMMARY.eligible)} of eligible`,
  },
  {
    label: "Initial margin",
    value: formatUsd(ACCOUNT_SUMMARY.initialMargin, 0),
    note: `${formatShare(ACCOUNT_SUMMARY.marginUsage)} of eligible`,
  },
  {
    label: "Health factor",
    value: formatMultiple(ACCOUNT_SUMMARY.healthFactor),
    note: "equity to maintenance",
  },
];

const COMPONENTS: { key: keyof Omit<PnlBreakdown, "total">; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "carry", label: "Carry" },
  { key: "funding", label: "Funding" },
  { key: "fees", label: "Fees" },
  { key: "residual", label: "Residual" },
];

const PNL_SCALE = Math.max(
  ...COMPONENTS.map((component) => Math.abs(PORTFOLIO_PNL[component.key])),
  1,
);

function mark(position: Position): string {
  return `${formatPrice(position.markPrice, position.market)} ${priceUnitSuffix(position.market.priceUnit)}`;
}

function sideTone(position: Position): string {
  return position.side === "LONG" ? "text-up" : "text-down";
}

function PositionsSnapshot() {
  return (
    <Panel
      title="Positions"
      note={`${POSITIONS.length} open packages`}
      aside={
        <Link
          href="/portfolio/positions"
          className="focus-ring text-xs text-dim transition-colors hover:text-ink"
        >
          View all positions
        </Link>
      }
    >
      <div className="scroll-thin hidden overflow-x-auto lg:block">
        <table className={`${TABLE} min-w-[560px] table-fixed`}>
          <caption className="sr-only">
            Every open package with its signed size, current mark, total profit and loss, risk
            buffer, and lifecycle state. The positions view carries the full book.
          </caption>
          <thead className="bg-panel">
            <tr className="border-b border-line">
              <th scope="col" className={TH}>
                Package
              </th>
              <th scope="col" className={`${TH} w-[96px] text-right`}>
                Size
              </th>
              <th scope="col" className={`${TH} w-[116px] text-right`}>
                Mark
              </th>
              <th scope="col" className={`${TH} w-[116px] text-right`}>
                Total PnL
              </th>
              <th scope="col" className={`${TH} w-[100px] text-right`}>
                Risk buffer
              </th>
              <th scope="col" className={`${TH} w-[112px]`}>
                State
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {POSITIONS.map((position) => (
              <tr key={position.id} className="transition-colors hover:bg-raised/60">
                <th scope="row" className={`${TD} h-12 text-left font-normal`}>
                  <Link
                    href={position.href}
                    aria-label={`Open the ${position.label} terminal`}
                    className="focus-ring flex min-w-0 flex-col"
                  >
                    <span className="truncate text-[13px] text-ink">{position.label}</span>
                    <span className="tnum truncate font-mono text-xs text-faint">
                      {position.market.code}
                    </span>
                  </Link>
                </th>
                <td className={`${NUM} ${sideTone(position)}`}>
                  {formatSigned(position.signedLots, 0)}
                </td>
                <td className={`${NUM} text-dim`}>{mark(position)}</td>
                <td className={`${NUM} ${tone(position.pnl.total)}`}>
                  {formatSignedUsd(position.pnl.total, 0)}
                </td>
                <td className={`${NUM} text-dim`}>{formatShare(position.bufferShare, 0)}</td>
                <td className={TD}>
                  <StateTag state={position.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="lg:hidden">
        {POSITIONS.map((position) => (
          <li key={position.id} className="border-b border-line">
            <Link
              href={position.href}
              aria-label={`Open the ${position.label} terminal`}
              className="focus-ring flex min-h-11 flex-col justify-center gap-1 px-3 py-2"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-ink">{position.label}</span>
                <span className={`tnum shrink-0 font-mono text-xs ${tone(position.pnl.total)}`}>
                  {formatSignedUsd(position.pnl.total, 0)}
                </span>
              </span>
              <span className="flex items-baseline justify-between gap-3">
                <span className="tnum truncate font-mono text-xs text-faint">
                  <span className={sideTone(position)}>
                    {formatSigned(position.signedLots, 0)}
                  </span>
                  {` lots / ${mark(position)}`}
                </span>
                <span className="tnum shrink-0 font-mono text-xs text-dim">
                  {`${formatShare(position.bufferShare, 0)} buffer`}
                </span>
              </span>
              <StateTag state={position.state} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function BookHealth() {
  return (
    <Panel title="Book health" note="Margin is isolated per position">
      <div className="flex flex-col px-3 py-3 lg:px-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-dim">Initial margin utilisation</span>
          <span className="tnum font-mono text-sm text-ink">
            {formatShare(ACCOUNT_SUMMARY.marginUsage)}
          </span>
        </div>
        <div className="mt-2 mb-3">
          <ShareBar value={ACCOUNT_SUMMARY.marginUsage} />
        </div>

        <div className="divide-y divide-line border-t border-line">
          <DataRow
            label="Reserved collateral"
            value={formatUsd(ACCOUNT_SUMMARY.reserved, 0)}
          />
          <DataRow
            label="Maintenance margin"
            value={formatUsd(ACCOUNT_SUMMARY.maintenanceMargin, 0)}
          />
          <DataRow
            label="Stress headroom"
            value={formatUsd(ACCOUNT_SUMMARY.stressHeadroom, 0)}
            title={`${formatMultiple(ACCOUNT_SUMMARY.stressHealthFactor)} modeled health factor`}
          />
          <DataRow
            label="Binding scenario"
            value={ACCOUNT_SUMMARY.bindingLabel}
            tone="muted"
          />
          <DataRow
            label="Next expiry"
            value={`${formatExpiry(NEXT_EXPIRY.expiryIso)}, ${NEXT_EXPIRY.days}d`}
            tone="muted"
            title={NEXT_EXPIRY.positions.map((position) => position.label).join(", ")}
          />
        </div>
      </div>
    </Panel>
  );
}

function PnlAttribution() {
  return (
    <Panel title="PnL attribution" note="Estimated, preview snapshot">
      <table className={`${TABLE} table-fixed`}>
        <caption className="sr-only">
          Profit and loss of the whole book split into its price, carry, funding, fee, and residual
          components. Estimated from the preview snapshot.
        </caption>
        <tbody className="divide-y divide-line-soft">
          {COMPONENTS.map((component) => {
            const value = PORTFOLIO_PNL[component.key];
            return (
              <tr key={component.key}>
                <th
                  scope="row"
                  className="py-2 pl-3 text-left text-xs font-normal text-dim lg:pl-4"
                >
                  {component.label}
                </th>
                <td className="w-[38%] px-3 py-2">
                  <DivergingBar value={value} scale={PNL_SCALE} />
                </td>
                <td
                  className={`tnum w-[128px] py-2 pr-3 text-right font-mono text-xs lg:pr-4 ${tone(value)}`}
                >
                  {formatSignedUsd(value, 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-inset">
            <th scope="row" className="py-2 pl-3 text-left text-xs font-normal text-ink lg:pl-4">
              Total
            </th>
            <td />
            <td
              className={`tnum py-2 pr-3 text-right font-mono text-xs lg:pr-4 ${tone(PORTFOLIO_PNL.total)}`}
            >
              {formatSignedUsd(PORTFOLIO_PNL.total, 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </Panel>
  );
}

export function OverviewView() {
  return (
    <div className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <SummaryStrip metrics={ACCOUNT_METRICS} />

      <div className="flex min-w-0 shrink-0 flex-col lg:grid lg:min-h-0 lg:shrink lg:grow lg:basis-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="scroll-thin flex min-w-0 shrink-0 flex-col lg:min-h-0 lg:overflow-y-auto">
          <PositionsSnapshot />
          <PlaneFooter>
            <Aggregate label="Packages" value={String(POSITIONS.length)} />
            <Aggregate label="Collateral" value={formatCompactUsd(ACCOUNT_SUMMARY.reserved)} />
            <Aggregate
              label="Open PnL"
              value={formatSignedUsd(PORTFOLIO_PNL.total, 0)}
              valueTone={tone(PORTFOLIO_PNL.total)}
            />
          </PlaneFooter>
        </div>

        <aside
          aria-label="Account summary"
          className="scroll-thin flex min-w-0 shrink-0 flex-col border-line lg:min-h-0 lg:overflow-y-auto lg:border-l"
        >
          <BookHealth />
          <div className="shrink-0 border-t border-line">
            <PnlAttribution />
          </div>
          <PlaneNote>{`Preview fixture, ${MARK_AGE}`}</PlaneNote>
        </aside>
      </div>
    </div>
  );
}
