"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Chip } from "@/components/markets/ui";
import {
  Aggregate,
  DivergingBar,
  EmptyBook,
  NUM,
  Panel,
  PlaneFooter,
  PlaneNote,
  ROW,
  STICKY_HEAD,
  StateTag,
  TABLE,
  TD,
  TH,
} from "@/components/portfolio/panels";
import { usePortfolio } from "@/components/portfolio/usePortfolio";
import { tone } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatPrice,
  formatSigned,
  formatSignedUsd,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { MARK_SOURCE_LABEL } from "@/lib/portfolio/forward";
import { positionOrigin } from "@/lib/portfolio/runtime";
import type { PnlBreakdown, Position } from "@/lib/portfolio/types";
import { MarketMark } from "@/components/portfolio/MarketMark";

/* A dated range forward's PnL is its price term against the mark and the fees paid at the fill. */
const COMPONENTS: { key: keyof Omit<PnlBreakdown, "total">; label: string }[] = [
  { key: "price", label: "Mark to market" },
  { key: "fees", label: "Fees" },
];

function markText(position: Position): string {
  return position.markPrice === null ? "—" : formatPrice(position.markPrice, position.market);
}

const ACTION =
  "focus-ring flex h-11 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors duration-150 lg:h-8 lg:text-xs";

function PositionRows({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <EmptyBook title="No positions yet">
        <Link href="/markets" className={`${ACTION} border-line-strong bg-raised text-ink hover:border-brand-edge`}>
          Browse markets
        </Link>
        <Link href="/trade" className={`${ACTION} border-line text-dim hover:border-line-strong hover:text-ink`}>
          Open the terminal
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </EmptyBook>
    );
  }
  return (
    <>
      <table className={`${TABLE} hidden min-w-[640px] md:table`}>
        <caption className="sr-only">Open account positions with size, entry, mark, and profit and loss.</caption>
        <thead>
          <tr>
            <th scope="col" className={`${TH} ${STICKY_HEAD}`}>Package</th>
            <th scope="col" className={`${TH} ${STICKY_HEAD} text-right`}>Size</th>
            <th scope="col" className={`${TH} ${STICKY_HEAD} text-right`}>Entry</th>
            <th scope="col" className={`${TH} ${STICKY_HEAD} text-right`}>Mark</th>
            <th scope="col" className={`${TH} ${STICKY_HEAD} text-right`}>PnL</th>
            <th scope="col" className={`${TH} ${STICKY_HEAD}`}>Lifecycle</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.id} className={ROW}>
              <th scope="row" className={`${TD} h-10 font-normal`}>
                <Link href={position.href} className="focus-ring flex min-w-0 items-center gap-2 rounded-sm">
                  <MarketMark underlying={position.market.underlying} size={16} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] leading-4 text-ink">{position.label}</span>
                    <span className="truncate text-[11px] leading-[14px] text-faint">{positionOrigin(position)}</span>
                  </span>
                </Link>
              </th>
              <td className={`${NUM} ${position.side === "LONG" ? "text-up" : "text-down"}`}>
                {`${formatSigned(position.signedLots, 0)} lots`}
              </td>
              <td className={`${NUM} text-dim`}>{formatPrice(position.entryPrice, position.market)}</td>
              <td className={`${NUM} ${position.markPrice === null ? "text-faint" : "text-ink"}`} title={MARK_SOURCE_LABEL[position.markSource]}>
                {markText(position)}
                <span className="ml-1 text-[10px] text-off">{priceUnitSuffix(position.market.priceUnit)}</span>
              </td>
              <td className={`${NUM} ${tone(position.pnl.total)}`}>{formatSignedUsd(position.pnl.total, 0)}</td>
              <td className={TD}>
                <StateTag state={position.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="md:hidden">
        {positions.map((position) => (
          <li key={position.id} className="border-b border-line-soft last:border-b-0">
            <Link href={position.href} className="focus-ring flex min-h-14 items-center gap-3 px-3 py-2.5">
              <MarketMark underlying={position.market.underlying} size={18} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm text-ink">{position.label}</span>
                <span className="flex items-center gap-2 text-[11px]">
                  <span className={`tnum font-mono ${position.side === "LONG" ? "text-up" : "text-down"}`}>
                    {`${formatSigned(position.signedLots, 0)} lots`}
                  </span>
                  <StateTag state={position.state} />
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className={`tnum font-mono text-[13px] ${tone(position.pnl.total)}`}>
                  {formatSignedUsd(position.pnl.total, 0)}
                </span>
                <span className="tnum font-mono text-[11px] text-faint">
                  {`${formatPrice(position.entryPrice, position.market)} → ${markText(position)}`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function Attribution({ pnl }: { pnl: PnlBreakdown }) {
  const scale = Math.max(...COMPONENTS.map((component) => Math.abs(pnl[component.key])), 1);
  return (
    <table className={TABLE}>
      <caption className="sr-only">Account profit and loss by component, at live marks.</caption>
      <tbody>
        {COMPONENTS.map((component) => {
          const value = pnl[component.key];
          return (
            <tr key={component.key} className={ROW}>
              <th scope="row" className={`${TD} h-8 font-normal text-dim`}>{component.label}</th>
              <td className="w-[36%] px-2">
                <DivergingBar value={value} scale={scale} />
              </td>
              <td className={`${NUM} ${tone(value)}`}>{formatSignedUsd(value, 0)}</td>
            </tr>
          );
        })}
        <tr className="border-t border-line">
          <th scope="row" className={`${TD} h-9 font-medium text-ink`}>Total</th>
          <td />
          <td className={`${NUM} font-medium ${tone(pnl.total)}`}>{formatSignedUsd(pnl.total, 0)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function OverviewView() {
  const { portfolio } = usePortfolio();

  return (
    <div className="flex min-w-0 flex-col">
      <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          title="Open positions"
          note="Read from the connected account onchain"
          aside={
            <Link
              href="/portfolio/positions"
              className="focus-ring flex items-center gap-1 rounded-sm text-xs text-dim transition-colors hover:text-ink"
            >
              Full book
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          }
        >
          <PositionRows positions={portfolio.runtimePositions} />
        </Panel>
        <div className="border-t border-line lg:border-t-0 lg:border-l">
          <Panel
            title="PnL attribution"
            note={<Chip tone="muted">Live marks</Chip>}
            delay={40}
          >
            <Attribution pnl={portfolio.runtimePnl} />
          </Panel>
        </div>
      </div>
      <PlaneFooter>
        <Aggregate label="Gross exposure" value={formatCompactUsd(portfolio.runtimeGross)} />
        <Aggregate
          label="Net exposure"
          value={formatSignedUsd(portfolio.runtimeNet, 0)}
          valueTone={tone(portfolio.runtimeNet)}
        />
        <Aggregate
          label="Account PnL"
          value={formatSignedUsd(portfolio.runtimePnl.total, 0)}
          valueTone={tone(portfolio.runtimePnl.total)}
        />
      </PlaneFooter>
      <PlaneNote
        chips={
          <>
            <Chip tone="muted">Onchain balances</Chip>
            <Chip tone="muted">Live marks</Chip>
          </>
        }
      >
        Balances and reservations are read from the onchain account. Positions are marked at the
        book mid, else the last onchain fill, else the Chainlink reference. Marks are not settlement
        values: each series settles against its fixing.
      </PlaneNote>
    </div>
  );
}
