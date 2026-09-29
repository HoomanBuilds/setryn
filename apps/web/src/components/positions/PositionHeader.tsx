"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, ChevronRight, Receipt } from "lucide-react";
import { BUTTON_QUIET, CopyButton, EnvironmentChip } from "@/components/activity/ledger-ui";
import { AssetGlyph } from "@/components/markets/ui";
import { Flash, Meter, Panel } from "@/components/strategies/desk/Desk";
import { OriginChip, ProvenanceChip } from "@/components/settlements/trust";
import { formatCountdownMs, formatUtcDate, formatUtcSession, formatUtcShort } from "@/lib/settlements/calendar";
import { receiptHref, type PositionDossier } from "@/lib/positions/dossier";
import type { PositionMetrics } from "@/lib/positions/economics";
import type { LifeProgress, LifecycleStep } from "@/lib/positions/timeline";
import { formatCompactUsd, formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket, Provenance } from "@/lib/terminal/types";
import { PhaseTag, SideTag, price, shortId, signedUsd, toneOf, usd, type PhaseTone } from "./parts";

function Tile({
  label,
  provenance,
  source,
  value,
  note,
  tone = "text-ink",
  children,
}: {
  label: string;
  provenance: Provenance;
  source?: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2.5 lg:px-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-faint">{label}</span>
        <ProvenanceChip provenance={provenance} source={source} compact />
      </div>
      <div className={`tnum mt-1 truncate font-mono text-[15px] leading-5 ${tone}`}>{value}</div>
      {note ? <div className="mt-0.5 truncate text-[11px] text-off">{note}</div> : null}
      {children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}

export function phaseOf(dossier: PositionDossier, metrics: PositionMetrics, nowMs: number): { label: string; tone: PhaseTone } {
  if (dossier.phase === "CLOSED") return { label: "Closed", tone: "closed" };
  if (nowMs >= metrics.fixingMs) return { label: "Awaiting fixing record", tone: "attention" };
  if (nowMs >= metrics.windowOpensMs) return { label: "Fixing window", tone: "window" };
  if (dossier.reference?.health === "WINDOW_OPEN") return { label: "Window open", tone: "window" };
  return { label: "Active", tone: "live" };
}

/**
 * Time from opening (or now, when the opening is not recorded) to the fixing
 * print, with the scheduled boundaries in between marked where they fall.
 */
function LifeBar({
  steps,
  progress,
  metrics,
  nowMs,
}: {
  steps: LifecycleStep[];
  progress: LifeProgress;
  metrics: PositionMetrics;
  nowMs: number;
}) {
  const startMs = progress.startMs !== null ? Math.min(progress.startMs, nowMs) : nowMs;
  const endMs = metrics.fixingMs;
  const span = Math.max(1, endMs - startMs);
  const at = (ms: number) => `${Math.max(0, Math.min(1, (ms - startMs) / span)) * 100}%`;
  const remaining = endMs - nowMs;
  const marks = steps.filter(
    (step) => step.kind === "BOUNDARY" && step.atMs !== null && step.atMs > startMs && step.atMs < endMs,
  );
  return (
    <div className="border-t border-line px-3 py-2.5 lg:px-4">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="truncate text-faint">
          {progress.startMs !== null
            ? `Opened ${formatUtcDate(new Date(progress.startMs).toISOString().slice(0, 10))}`
            : "Now · opening not recorded"}
        </span>
        <span className="tnum shrink-0 font-mono text-dim">
          {remaining > 0 ? `Fixing in ${formatCountdownMs(remaining)}` : "Fixing print passed"}
        </span>
        <span className="hidden truncate text-right text-faint sm:block">{`Fixing ${formatUtcSession(endMs)}`}</span>
      </div>
      <div className="relative mt-2.5 mb-1 h-[3px] rounded-full bg-line">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-ink/50 transition-[width] duration-500 ease-out"
          style={{ width: at(nowMs) }}
        />
        {marks.map((step) => (
          <span
            key={step.id}
            title={`${step.label}, ${step.atLabel}`}
            className={`absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border ${
              step.attention ? "border-brand bg-brand-soft" : "border-line-strong bg-panel"
            }`}
            style={{ left: at(step.atMs ?? startMs) }}
          >
            <span className="sr-only">{`${step.label}, ${step.atLabel}`}</span>
          </span>
        ))}
        <span
          title="Now, on the preview feed clock"
          className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-brand"
          style={{ left: at(nowMs) }}
        />
        <span aria-hidden="true" className="absolute top-1/2 right-0 h-[11px] w-px -translate-y-1/2 bg-ink/70" />
      </div>
    </div>
  );
}

export function PositionHeader({
  dossier,
  market,
  metrics,
  progress,
  steps,
  nowMs,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  metrics: PositionMetrics;
  progress: LifeProgress;
  steps: LifecycleStep[];
  nowMs: number;
}) {
  const phase = phaseOf(dossier, metrics, nowMs);
  const unit = priceUnitSuffix(market.priceUnit);
  const record = metrics.recordProvenance;
  const derived = metrics.derivedProvenance;
  const recordSource = dossier.sourceLabel;
  const opening = dossier.fills.find((fill) => fill.kind === "OPEN") ?? null;
  const closed = dossier.phase === "CLOSED";
  const signedLots = dossier.side === "LONG" ? dossier.lots : -dossier.lots;

  return (
    <Panel label="Position summary">
      <div className="flex flex-col gap-3 px-3 pt-3 pb-3 lg:flex-row lg:items-start lg:justify-between lg:px-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
            <Link href="/portfolio" className="focus-ring rounded-sm transition-colors hover:text-ink">
              Portfolio
            </Link>
            <ChevronRight size={11} aria-hidden="true" className="shrink-0 text-off" />
            <Link href="/portfolio/positions" className="focus-ring rounded-sm transition-colors hover:text-ink">
              Positions
            </Link>
            <ChevronRight size={11} aria-hidden="true" className="shrink-0 text-off" />
            <span className="truncate font-mono tracking-normal normal-case">{shortId(dossier.id)}</span>
          </nav>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
            <AssetGlyph underlying={market.underlying} size={26} />
            <h1 className="min-w-0 font-serif text-[26px] leading-[30px] font-normal tracking-[-0.01em] text-ink lg:text-[30px] lg:leading-[34px]">
              {`${market.name} ${market.tenorLabel}`}
            </h1>
            <span className="flex flex-wrap items-center gap-1.5">
              <SideTag side={dossier.side} />
              <PhaseTag label={phase.label} tone={phase.tone} />
            </span>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            <span className="font-mono text-dim">{market.code}</span>
            <span aria-hidden="true" className="text-off">/</span>
            <span className="inline-flex min-w-0 items-center">
              <span title={dossier.id} className="tnum truncate font-mono">
                {shortId(dossier.id)}
              </span>
              <CopyButton value={dossier.id} label="position ID" size={11} className="h-5 w-5" />
            </span>
            <span aria-hidden="true" className="text-off">/</span>
            <span>{market.strategyLabel}</span>
            <span aria-hidden="true" className="hidden text-off sm:inline">/</span>
            <span className="hidden sm:inline">{dossier.sourceLabel}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {dossier.origin === "REFERENCE" ? (
            <>
              <OriginChip origin="REFERENCE" />
              <span
                title="Reference records are static lifecycle preview data, independent of the connected runtime."
                className="inline-flex h-7 shrink-0 items-center gap-2 rounded-md border border-dashed border-line-strong px-2.5 text-xs text-dim"
              >
                <span className="text-ink">{dossier.environmentLabel}</span>
                <span className="text-off">/</span>
                <span className="font-mono text-faint">{`${dossier.evidenceLabel.toLowerCase()} record`}</span>
              </span>
            </>
          ) : (
            <EnvironmentChip />
          )}
          {opening ? (
            <Link href={receiptHref(opening.receipt.id)} className={BUTTON_QUIET}>
              <Receipt size={12} aria-hidden="true" />
              Opening receipt
            </Link>
          ) : null}
          <Link href={tradeHref(market)} className={BUTTON_QUIET}>
            Open market
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4 xl:grid-cols-8">
        <Tile
          label={closed ? "Open lots" : "Size"}
          provenance={record}
          source={recordSource}
          value={closed ? "0 lots" : `${signedLots > 0 ? "+" : ""}${formatLots(signedLots)} lots`}
          tone={closed ? "text-dim" : dossier.side === "LONG" ? "text-up" : "text-down"}
          note={closed ? `${formatLots(dossier.openedLots)} lots at opening` : `${formatCompactUsd(metrics.notional)} notional`}
        />
        <Tile
          label="Entry"
          provenance={record}
          source={recordSource}
          value={price(dossier.entryPrice, market)}
          note={dossier.openedAt ? `opened ${formatUtcShort(Date.parse(dossier.openedAt))} UTC` : "opening not recorded"}
        />
        <Tile
          label="Mark"
          provenance="ESTIMATED"
          source="Package mark, shared preview board"
          value={<Flash value={market.netPrice}>{price(market.netPrice, market)}</Flash>}
          note={
            closed
              ? "current series mark"
              : `close ${formatNumber(metrics.closeTouch, market.priceDecimals)} ${dossier.side === "LONG" ? "bid" : "ask"}`
          }
        />
        {closed ? (
          <Tile
            label="Realized PnL"
            provenance="OBSERVED"
            source="Exit receipts"
            value={dossier.realizedPnl !== null ? signedUsd(dossier.realizedPnl, 2) : "Not recorded"}
            tone={dossier.realizedPnl !== null ? toneOf(dossier.realizedPnl) : "text-faint"}
            note={`fees ${usd(dossier.fees, 2)}`}
          />
        ) : (
          <Tile
            label="Open PnL"
            provenance={derived}
            source="Entry against the package mark, less fees"
            value={<Flash value={metrics.totalPnl}>{signedUsd(metrics.totalPnl)}</Flash>}
            tone={toneOf(metrics.totalPnl)}
            note={`${signedUsd(metrics.touchPnl)} at the ${dossier.side === "LONG" ? "bid" : "ask"}`}
          />
        )}
        {closed ? (
          <Tile
            label="Collateral released"
            provenance="OBSERVED"
            source="Exit receipts"
            value={dossier.collateralReleased !== null ? usd(dossier.collateralReleased) : "Not recorded"}
            tone={dossier.collateralReleased !== null ? "text-ink" : "text-faint"}
            note="returned to available"
          />
        ) : (
          <Tile
            label="Collateral"
            provenance={record}
            source={recordSource}
            value={usd(dossier.collateral)}
            note={`floor ${formatCompactUsd(metrics.maintenance)}`}
          />
        )}
        {closed ? (
          <Tile label="Fees paid" provenance="OBSERVED" source="Linked receipts" value={usd(dossier.fees, 2)} note={`${dossier.fills.length} linked fills`} />
        ) : (
          <Tile
            label="Health"
            provenance={derived}
            source="Equity buffer over the maintenance floor"
            value={`${formatNumber(metrics.bufferShare * 100, 1)}% buffer`}
            tone={metrics.bufferShare < 0.1 ? "text-down" : "text-ink"}
          >
            <Meter
              value={metrics.bufferShare}
              tone={metrics.bufferShare < 0.1 ? "down" : metrics.bufferShare < 0.2 ? "brand" : "up"}
              label="Risk buffer share of equity"
            />
          </Tile>
        )}
        {closed ? (
          <Tile
            label="Closed"
            provenance="OBSERVED"
            source={recordSource}
            value={dossier.closedAt ? formatUtcSession(Date.parse(dossier.closedAt)).slice(0, 11) : "Terminal"}
            note="before its fixing"
          />
        ) : (
          <Tile
            label="Liquidation"
            provenance={derived}
            source="Mark less the buffer in package points"
            value={metrics.liquidationPrice === null ? "No quote level" : price(metrics.liquidationPrice, market)}
            note={
              metrics.liquidationPrice === null
                ? "buffer runs through zero"
                : `${formatNumber(Math.abs(market.netPrice - metrics.liquidationPrice), market.priceDecimals)} ${unit} away`
            }
          />
        )}
        <Tile
          label="Fixing"
          provenance="MODELED"
          source="Scheduled from series terms"
          value={closed ? "Not applicable" : formatCountdownMs(metrics.msToFixing)}
          tone={closed ? "text-faint" : metrics.msToFixing < 7 * 86_400_000 ? "text-brand" : "text-ink"}
          note={formatUtcSession(metrics.fixingMs)}
        />
      </div>
      {closed ? null : <LifeBar steps={steps} progress={progress} metrics={metrics} nowMs={nowMs} />}
    </Panel>
  );
}
