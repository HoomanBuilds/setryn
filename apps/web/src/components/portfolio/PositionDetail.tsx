"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Chip } from "@/components/markets/ui";
import { DivergingBar, StateTag, TABLE } from "@/components/portfolio/panels";
import { tone } from "@/components/terminal/primitives";
import {
  formatCompactUsd,
  formatExpiry,
  formatNumber,
  formatShare,
  formatSigned,
  formatSignedUsd,
  formatUsd,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { positionScenarioImpact } from "@/lib/portfolio/model";
import { positionOrigin } from "@/lib/portfolio/runtime";
import type { PnlBreakdown, Position, ScenarioResult } from "@/lib/portfolio/types";
import { MarketMark } from "@/components/portfolio/MarketMark";

const COMPONENTS: { key: keyof Omit<PnlBreakdown, "total">; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "carry", label: "Carry" },
  { key: "funding", label: "Funding" },
  { key: "fees", label: "Fees" },
  { key: "residual", label: "Residual" },
];

function Heading({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-medium text-dim">{children}</h4>;
}

function Figure({ label, value, valueTone = "text-ink" }: { label: string; value: string; valueTone?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-[11px] text-faint">{label}</span>
      <span className={`tnum truncate font-mono text-xs ${valueTone}`}>{value}</span>
    </div>
  );
}

function Attribution({
  selected,
  portfolio,
  label,
}: {
  selected: PnlBreakdown;
  portfolio: PnlBreakdown;
  label: string;
}) {
  const scale = Math.max(
    ...COMPONENTS.map((component) => Math.abs(selected[component.key])),
    1,
  );

  return (
    <table className={TABLE}>
      <caption className="sr-only">
        {`Profit and loss attribution for ${label} against the whole book. Estimated from the index snapshot.`}
      </caption>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="h-7 text-left text-xs font-normal text-faint">
            Component
          </th>
          <th scope="col" className="h-7 w-[64px] text-left text-xs font-normal text-faint">
            <span className="sr-only">Share of position</span>
          </th>
          <th scope="col" className="h-7 text-right text-xs font-normal text-faint">
            Position
          </th>
          <th scope="col" className="h-7 text-right text-xs font-normal text-faint">
            Book
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-soft">
        {COMPONENTS.map((component) => {
          const value = selected[component.key];
          return (
            <tr key={component.key}>
              <th scope="row" className="py-1.5 text-left text-xs font-normal text-dim">
                {component.label}
              </th>
              <td className="py-1.5 pr-2 pl-2">
                <DivergingBar value={value} scale={scale} />
              </td>
              <td className={`tnum py-1.5 text-right font-mono text-xs ${tone(value)}`}>
                {formatSignedUsd(value, 0)}
              </td>
              <td className={`tnum py-1.5 pl-3 text-right font-mono text-xs ${tone(portfolio[component.key])}`}>
                {formatSignedUsd(portfolio[component.key], 0)}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-line">
          <th scope="row" className="py-1.5 text-left text-xs font-normal text-ink">
            Total
          </th>
          <td />
          <td className={`tnum py-1.5 text-right font-mono text-xs ${tone(selected.total)}`}>
            {formatSignedUsd(selected.total, 0)}
          </td>
          <td className={`tnum py-1.5 pl-3 text-right font-mono text-xs ${tone(portfolio.total)}`}>
            {formatSignedUsd(portfolio.total, 0)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function Legs({ position }: { position: Position }) {
  return (
    <table className={TABLE}>
      <caption className="sr-only">{`Legs of ${position.label}, filled as one package.`}</caption>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="h-7 text-left text-xs font-normal text-faint">
            Leg
          </th>
          <th scope="col" className="h-7 text-right text-xs font-normal text-faint">
            Ratio
          </th>
          <th scope="col" className="h-7 text-right text-xs font-normal text-faint">
            Mark
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-soft">
        {position.market.legs.map((leg) => (
          <tr key={leg.id}>
            <th scope="row" className="min-w-0 py-1.5 text-left font-normal">
              <span className="block truncate text-xs text-ink">{leg.instrument}</span>
              <span className="block truncate text-xs text-faint">
                {`${leg.side === "BUY" ? "Buy" : "Sell"} / ${
                  leg.venueClass === "NATIVE_BOOK" ? "native leg book" : "implied component"
                }`}
              </span>
            </th>
            <td className="tnum py-1.5 pl-2 text-right font-mono text-xs text-dim">
              {`${formatNumber(leg.ratio, 2)}x`}
            </td>
            <td className="tnum py-1.5 pl-2 text-right font-mono text-xs text-dim">
              {`${formatNumber(leg.mark, leg.markUnit === "USD" ? (leg.mark < 10 ? 4 : 2) : 1)} ${priceUnitSuffix(leg.markUnit)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The details pane for whichever position is selected. The same block renders
 * inline under a narrow-width row, where the row above already names the
 * package, so the inline variant drops the repeated title.
 */
export function PositionDetail({
  position,
  portfolioPnl,
  binding,
  variant = "pane",
}: {
  position: Position;
  portfolioPnl: PnlBreakdown;
  binding: ScenarioResult;
  variant?: "pane" | "inline";
}) {
  const unit = priceUnitSuffix(position.market.priceUnit);
  const decimals = position.market.priceDecimals;
  const stress = positionScenarioImpact(position, binding.scenario);

  return (
    <div className="flex min-w-0 flex-col gap-4 px-3 py-3 lg:px-4">
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <MarketMark underlying={position.market.underlying} size={variant === "pane" ? 20 : 16} className="mt-0.5" />
            <div className="min-w-0">
            {variant === "pane" ? (
              <h3 className="text-sm leading-5 font-medium text-ink">{position.label}</h3>
            ) : null}
            <p className="tnum truncate font-mono text-[11px] text-faint">
              {`${position.market.code} / ${position.id}`}
            </p>
            </div>
          </div>
          <StateTag state={position.state} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone="muted">{position.market.strategyLabel}</Chip>
          <Chip tone="muted">{positionOrigin(position)}</Chip>
          <Chip tone="muted">
            <span className="tnum font-mono">{`${formatExpiry(position.market.expiryIso)}, ${position.daysToExpiry}d`}</span>
          </Chip>
        </div>

        <div className={`grid gap-2 ${position.exitHref ? "grid-cols-2" : "grid-cols-1"}`}>
          <Link
            href={position.href}
            aria-label={`Open the ${position.label} terminal`}
            className="focus-ring flex h-11 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-xs text-ink transition-colors duration-150 hover:border-brand-edge lg:h-8"
          >
            Manage package
            <ArrowUpRight size={13} aria-hidden="true" className="shrink-0" />
          </Link>
          {position.exitHref ? (
            <Link
              href={position.exitHref}
              aria-label={`Exit the ${position.label} package in the terminal`}
              className="focus-ring flex h-11 items-center justify-center gap-1 rounded-md border border-line px-2 text-xs text-dim transition-colors duration-150 hover:border-down/50 hover:text-down lg:h-8"
            >
              Exit package
              <ArrowUpRight size={13} aria-hidden="true" className="shrink-0" />
            </Link>
          ) : null}
        </div>

        {position.receiptId ? (
          <Link
            href={`/activity/receipts/${position.receiptId}`}
            className="focus-ring inline-flex self-start text-xs text-dim underline underline-offset-2 hover:text-ink"
          >
            Inspect execution receipt
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-soft bg-line-soft [&>div]:bg-panel [&>div]:px-2.5 [&>div]:py-1.5">
        <Figure
          label="Size"
          value={`${formatSigned(position.signedLots, 0)} lots`}
          valueTone={position.side === "LONG" ? "text-up" : "text-down"}
        />
        <Figure label="Gross notional" value={formatCompactUsd(position.grossNotional)} />
        <Figure label="Entry" value={`${formatNumber(position.entryPrice, decimals)} ${unit}`} />
        <Figure label="Mark" value={`${formatNumber(position.markPrice, decimals)} ${unit}`} />
        <Figure label="Collateral" value={formatUsd(position.collateral, 0)} />
        <Figure label="Position equity" value={formatUsd(position.equity, 0)} />
        <Figure label="Initial margin" value={formatUsd(position.initialMargin, 0)} />
        <Figure label="Maintenance margin" value={formatUsd(position.maintenanceMargin, 0)} />
        <Figure
          label="Risk buffer"
          value={`${formatUsd(position.bufferUsdc, 0)}, ${formatShare(position.bufferShare, 0)}`}
        />
        <Figure
          label="Liquidation"
          value={
            position.liquidationPrice === null
              ? "No quote level"
              : `${formatNumber(position.liquidationPrice, decimals)} ${unit}`
          }
        />
        <Figure
          label={`${binding.scenario.label} impact`}
          value={formatSignedUsd(stress, 0)}
          valueTone={tone(stress)}
        />
        <Figure
          label="Buffer move"
          value={`${formatNumber(position.bufferPoints, decimals)} ${unit}`}
        />
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <Heading>PnL attribution</Heading>
          <Chip tone="muted">
            {position.source === "ONCHAIN_RUNTIME" ? "Development feed mark" : "Reference observation"}
          </Chip>
        </div>
        <div className="mt-1">
          <Attribution selected={position.pnl} portfolio={portfolioPnl} label={position.label} />
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <Heading>Leg decomposition</Heading>
          <span className="truncate text-[11px] text-off">
            {`${position.market.legs.length} legs, one package`}
          </span>
        </div>
        <div className="mt-1">
          <Legs position={position} />
        </div>
      </div>

      <div className="min-w-0 border-t border-line-soft pt-2.5">
        <Heading>Next lifecycle event</Heading>
        <p className="mt-1 text-xs leading-relaxed text-dim">{position.nextEvent}</p>
      </div>
    </div>
  );
}
