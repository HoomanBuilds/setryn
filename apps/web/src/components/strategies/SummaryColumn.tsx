"use client";

import Link from "next/link";
import { ArrowUpRight, Check, ShieldCheck, X } from "lucide-react";
import { SourceMark, SOURCE_LABEL } from "@/components/terminal/primitives";
import {
  Chip,
  Flash,
  Meter,
  Metric,
  Panel,
  PanelHead,
  Row,
  compact,
  signTone,
} from "@/components/strategies/desk/Desk";
import { formatMove, type PayoffSummary } from "@/components/strategies/studio-model";
import {
  formatCompactUsd,
  formatLots,
  formatMultiple,
  formatNumber,
  formatShare,
  formatSigned,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import type { CompiledPackageDraft, PackageDraft } from "@/lib/strategies/types";
import type { PackageMarket, Qualification, RouteQuote } from "@/lib/terminal/types";

function qualificationTone(qualification: Qualification): "up" | "brand" | "down" {
  if (qualification === "QUALIFIED") return "up";
  if (qualification === "CONDITIONAL") return "brand";
  return "down";
}

function guaranteeLabel(guarantee: CompiledPackageDraft["guarantee"]): string {
  if (guarantee === "PACKAGE_ATOMIC") return "package atomic";
  if (guarantee === "SOLVER_BONDED") return "solver bonded";
  return "leg sequenced";
}

export function SummaryColumn({
  draft,
  compiled,
  market,
  allInPrice,
  summary,
  route,
  canOpen,
  primaryHref,
}: {
  draft: PackageDraft;
  compiled: CompiledPackageDraft;
  market: PackageMarket;
  allInPrice: number;
  summary: PayoffSummary;
  route: RouteQuote | undefined;
  canOpen: boolean;
  primaryHref: string;
}) {
  const notional = market.notionalPerLot * draft.lots * compiled.graphScale;
  const collateralShare = notional > 0 ? compiled.collateral / notional : 0;
  const unit = priceUnitSuffix(market.priceUnit);

  return (
    <>
      <Panel label="Pre-trade economics" delay={60}>
        <PanelHead
          title="Pre-trade economics"
          tools={
            <Chip tone={compiled.allInPriceLabel === "EXECUTABLE" ? "up" : "brand"}>
              {compiled.allInPriceLabel.toLowerCase()}
            </Chip>
          }
        />
        <div className="px-3 pt-3 pb-2">
          <div className="text-[11px] text-faint">All-in net price</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tnum font-mono text-[28px] leading-8 text-ink">
              <Flash value={allInPrice}>{formatNumber(allInPrice, market.priceDecimals)}</Flash>
            </span>
            <span className="text-sm text-faint">{unit}</span>
            <span className={`ml-auto text-xs ${draft.direction === "LONG" ? "text-up" : "text-down"}`}>
              {draft.direction === "LONG" ? "Long" : "Short"} {formatLots(draft.lots)} lots
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-faint">
            {compiled.executable
              ? `${formatLots(compiled.firmDepthLots)} lots currently qualified at available sources`
              : "Reference-series model. Request an executable quote before signing."}
          </p>
        </div>
        <div className="border-t border-line-soft px-3 py-1.5">
          <Row label="Initial collateral" value={formatCompactUsd(compiled.collateral)} />
          <Row label="Max terminal residual" value={formatCompactUsd(compiled.maxResidual)} />
          <Row label="Package notional" value={formatCompactUsd(notional)} />
          <Row label="Modelled ratio scale" value={formatShare(compiled.graphScale)} />
          <div className="pt-1.5 pb-1">
            <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
              <span className="text-faint">Collateral / notional</span>
              <span className="tnum font-mono text-dim">{formatShare(collateralShare)}</span>
            </div>
            <Meter value={collateralShare} tone="brand" label="Collateral as a share of notional" />
          </div>
        </div>
      </Panel>

      <Panel label="Risk profile" delay={100}>
        <PanelHead title="Risk" tools={<Chip title="Derived from the listed payoff profile">Modeled</Chip>} />
        <div className="grid grid-cols-2 divide-x divide-line [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-line">
          <Metric
            label="Net delta"
            value={formatSigned(compiled.netDelta, 2)}
            tone={signTone(compiled.netDelta)}
            note="Leg delta per lot, signed"
          />
          <Metric
            label="P&L per 1% move"
            value={compact(summary.slopePerPoint, true)}
            tone={signTone(summary.slopePerPoint)}
            note="Slope at spot, USDC"
          />
          <Metric
            label="Carry at 0%"
            value={compact(summary.carryAtZero, true)}
            tone={signTone(summary.carryAtZero)}
            note="Unchanged underlying"
          />
          <Metric
            label="Breakeven"
            value={summary.breakevens.length > 0 ? formatMove(summary.breakevens[0]) : "None"}
            note={summary.breakevens.length > 1 ? `${summary.breakevens.length} crossings` : "Underlying move"}
          />
          <Metric
            label="Max gain"
            value={compact(summary.maxGain, true)}
            tone={signTone(summary.maxGain)}
            note="Capped at expiry"
          />
          <Metric
            label="Max loss"
            value={compact(summary.maxLoss, true)}
            tone={signTone(summary.maxLoss)}
            note={summary.rewardRisk !== null ? `Reward / risk ${formatMultiple(summary.rewardRisk)}` : "Floored at expiry"}
          />
        </div>
      </Panel>

      <Panel label="Qualification and settlement" delay={140}>
        <PanelHead
          title="Qualification and settlement"
          tools={<ShieldCheck size={14} aria-hidden="true" className="text-faint" />}
        />
        <div className="px-3 py-1.5">
          <Row
            label="Leg qualification"
            value={compiled.qualification.toLowerCase()}
            tone={qualificationTone(compiled.qualification)}
          />
          <Row label="Settlement class" value={compiled.settlementClass === "CASH_USDC_NDF" ? "cash NDF" : "cash USDC"} />
          <Row label="Completion" value={guaranteeLabel(compiled.guarantee)} />
          <Row
            label="Liquidity state"
            value={compiled.executable ? "firm route available" : "quote required"}
            tone={compiled.executable ? "up" : "brand"}
          />
          <div className="border-t border-line-soft py-2">
            <div className="text-[11px] text-faint">Fixing</div>
            <div className="mt-0.5 text-xs leading-snug text-dim">{market.fixingSource}</div>
          </div>
        </div>
      </Panel>

      <Panel label="Compiled route context" delay={180}>
        <PanelHead
          title="Route context"
          tools={
            route ? (
              <span className="flex items-center gap-1.5 text-[11px] text-faint">
                <SourceMark source={route.source} />
                {SOURCE_LABEL[route.source]}
              </span>
            ) : null
          }
        />
        {route ? (
          <div className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-ink">{route.label}</span>
              <span className="tnum shrink-0 font-mono text-[11px] text-dim">{route.etaLabel}</span>
            </div>
            <div className="mt-1.5 border-t border-line-soft pt-1">
              <Row label="Protocol fee" value={`${formatNumber(route.protocolFeeBps, 1)} bp`} />
              <Row label="Counterparty" value={`${formatNumber(route.counterpartyFeeBps, 1)} bp`} />
              <Row label="Intermediate risk" value={formatShare(route.intermediateExposureRate)} />
            </div>
            <Meter
              value={route.intermediateExposureRate}
              tone={route.intermediateExposureRate > 0 ? "down" : "up"}
              label="Intermediate exposure while filling"
              className="mt-1.5"
            />
          </div>
        ) : (
          <p className="px-3 py-3 text-xs leading-snug text-faint">
            No route can be represented until the graph matches a listed strategy series.
          </p>
        )}
      </Panel>

      <Panel label="Package handoff" delay={220} className="xl:sticky xl:bottom-0 xl:z-10 xl:shadow-[0_-12px_24px_rgba(10,9,13,0.8)]">
        <div className="p-3">
          {compiled.validation.length > 0 ? (
            <div className="mb-3 rounded-md border border-down/30 bg-down-soft p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-down">
                <X size={13} aria-hidden="true" />
                Cannot form execution request
              </div>
              <ul className="mt-1.5 space-y-1 text-xs leading-snug text-dim">
                {compiled.validation.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {canOpen ? (
            <Link
              href={primaryHref}
              className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand px-3 text-sm font-semibold text-app transition-[filter] duration-150 hover:brightness-110"
            >
              {compiled.executable ? "Open executable package" : "Open reference market"}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md bg-raised px-3 text-sm font-semibold text-off"
            >
              Resolve package constraints
            </button>
          )}
          <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-faint">
            <Check size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-up" />
            {compiled.executable
              ? "The trade handoff carries the canonical draft, direction, and lot size. The terminal still requires its own final route selection."
              : "The trade handoff carries this modeled draft only. It cannot create an order until a listed market or firm quote is selected."}
          </div>
        </div>
      </Panel>
    </>
  );
}
