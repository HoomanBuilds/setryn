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
import { positionOrigin } from "@/lib/portfolio/runtime";
import type { PnlBreakdown, Position } from "@/lib/portfolio/types";
import { MarketMark } from "@/components/portfolio/MarketMark";

const COMPONENTS: { key: keyof Omit<PnlBreakdown, "total">; label: string }[] = [
  { key: "price", label: "Mark to market" },
  { key: "carry", label: "Carry" },
  { key: "funding", label: "Funding" },
  { key: "fees", label: "Fees" },
  { key: "residual", label: "Residual" },
];

const ACTION =
  "focus-ring flex h-11 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors duration-150 lg:h-8 lg:text-xs";

function PositionRows({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <EmptyBook title="No open packages in this account">
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
        <caption className="sr-only">Active account packages with size, entry, mark, and profit and loss.</caption>
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
              <td className={`${NUM} text-ink`}>
                {formatPrice(position.markPrice, position.market)}
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
                  {`${formatPrice(position.entryPrice, position.market)} → ${formatPrice(position.markPrice, position.market)}`}
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
      <caption className="sr-only">Account profit and loss by component, marked against the index feed.</caption>
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
          title="Active packages"
          note="Reconstructed from the connected account"
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
            note={<Chip tone="muted">Index marks</Chip>}
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
            <Chip tone="muted">Index marks</Chip>
          </>
        }
      >
        Balances and reservations are read from the onchain account. Position marks use the
        current index feed and are not oracle settlement values.
      </PlaneNote>
    </div>
  );
}
