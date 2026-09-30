"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, CalendarClock, CircleAlert, CircleCheck, Info } from "lucide-react";
import { BUTTON_PRIMARY, BUTTON_QUIET } from "@/components/activity/ledger-ui";
import { DeskTabs, Panel, RangeField, Stepper, TabBody } from "@/components/strategies/desk/Desk";
import { ProvenanceChip } from "@/components/settlements/trust";
import {
  ADJUSTMENT_RULE,
  FIXING_WINDOW_MINUTES,
  fixingSchedule,
  formatUtcDate,
  formatUtcSession,
} from "@/lib/settlements/calendar";
import { TerminalLifecycle } from "@/components/lifecycle/TerminalLifecycle";
import type { OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import type { PositionDossier } from "@/lib/positions/dossier";
import {
  closeHandoffHref,
  closePreview,
  rollOpenHandoffHref,
  rollPreview,
  rollTargets,
  type PositionMetrics,
} from "@/lib/positions/economics";
import { GUARANTEE_COPY } from "@/lib/terminal/economics";
import { formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { MARKETS, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { SubHead, TrustRow, price, signedUsd, toneOf, usd } from "./parts";
import { MarketMark } from "@/components/portfolio/MarketMark";

export type ManageAction = "close" | "roll" | "settle";

export const MANAGE_ACTIONS: readonly ManageAction[] = ["close", "roll", "settle"];

function Preflight({ title, blockers, notices }: { title: string; blockers: string[]; notices: string[] }) {
  const clear = blockers.length === 0;
  return (
    <div className="rounded-md border border-line bg-inset">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b border-line-soft px-3 py-1.5">
        <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">{title}</span>
        <span className={`tnum font-mono text-[11px] ${clear ? "text-dim" : "text-brand"}`}>
          {clear ? "clear at this quote" : `${blockers.length} to resolve`}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5 px-3 py-2.5">
        {clear ? (
          <li className="flex items-start gap-2 text-xs text-dim">
            <CircleCheck size={13} aria-hidden="true" className="mt-[1px] shrink-0 text-dim" />
            No blocking condition at the current quote. The terminal checks again at authorization.
          </li>
        ) : (
          blockers.map((blocker) => (
            <li key={blocker} className="flex items-start gap-2 text-xs leading-snug text-ink">
              <CircleAlert size={13} aria-hidden="true" className="mt-[1px] shrink-0 text-brand" />
              {blocker}
            </li>
          ))
        )}
        {notices.map((notice) => (
          <li key={notice} className="flex items-start gap-2 text-xs leading-snug text-faint">
            <Info size={13} aria-hidden="true" className="mt-[1px] shrink-0" />
            {notice}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Segment({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: string; label: ReactNode; disabled?: boolean; title?: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md border border-line bg-inset p-0.5">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.id)}
            className={`focus-ring h-9 rounded-[5px] px-2 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 lg:h-8 ${
              active ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-faint hover:text-dim"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const HANDOFF_NOTE =
  "The terminal re-quotes the route, runs preflight again and asks for your signature. Nothing is submitted from this page, and success shows only when the protocol records the terminal state.";

/* ------------------------------------------------------------------ */
/* Close                                                               */
/* ------------------------------------------------------------------ */

function CloseTab({ dossier, market }: { dossier: PositionDossier; market: PackageMarket }) {
  const canPartial = dossier.lots > 1;
  const [mode, setMode] = useState<"FULL" | "PARTIAL">("FULL");
  const [partialLots, setPartialLots] = useState(() => Math.max(1, Math.floor(dossier.lots / 2)));
  const partial = mode === "PARTIAL" && canPartial;
  const lots = partial ? Math.min(Math.max(1, partialLots), dossier.lots - 1) : dossier.lots;
  const preview = closePreview(dossier, market, lots);
  const sideWord = dossier.side === "LONG" ? "bid" : "ask";

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <Segment
        label="Close size"
        value={partial ? "PARTIAL" : "FULL"}
        onChange={(id) => setMode(id as "FULL" | "PARTIAL")}
        options={[
          { id: "FULL", label: <span className="tnum">{`Full · ${formatLots(dossier.lots)} lots`}</span> },
          {
            id: "PARTIAL",
            label: "Partial",
            disabled: !canPartial,
            title: canPartial ? undefined : "A one-lot position closes in full.",
          },
        ]}
      />
      {partial ? (
        <div className="flex flex-wrap items-center gap-2">
          <Stepper
            value={lots}
            onChange={(next) => setPartialLots(Math.round(next))}
            min={1}
            max={dossier.lots - 1}
            step={1}
            label="Lots to close"
            suffix="lots"
            className="w-[150px]"
          />
          <span className="flex gap-1">
            {[0.25, 0.5, 0.75].map((share) => {
              const target = Math.min(dossier.lots - 1, Math.max(1, Math.round(dossier.lots * share)));
              return (
                <button
                  key={share}
                  type="button"
                  onClick={() => setPartialLots(target)}
                  aria-pressed={lots === target}
                  className={`focus-ring tnum h-8 rounded-md border px-2 font-mono text-[11px] transition-colors ${
                    lots === target ? "border-line-strong bg-raised text-ink" : "border-line text-faint hover:text-dim"
                  }`}
                >
                  {`${share * 100}%`}
                </button>
              );
            })}
          </span>
        </div>
      ) : null}

      <div className="divide-y divide-line-soft">
        <TrustRow
          label={`Close at the ${sideWord}`}
          note={preview.route ? preview.route.label : "Best package touch"}
          value={price(preview.price, market)}
          provenance="EXECUTABLE"
          source={preview.route ? `${preview.route.label}, reference book` : "Package book touch"}
        />
        <TrustRow
          label="Closing / remaining"
          value={`${formatLots(preview.lots)} / ${formatLots(preview.remainingLots)} lots`}
        />
        <TrustRow label="Fees at this route" value={usd(preview.fees, 2)} provenance="ESTIMATED" source="Route fee schedule" />
        <TrustRow
          label="Realized PnL at this quote"
          value={signedUsd(preview.realizedPnl, 2)}
          tone={toneOf(preview.realizedPnl)}
          provenance={dossier.origin === "ACCOUNT" ? "ESTIMATED" : "MODELED"}
          source="Entry against the close price, less fees"
        />
        <TrustRow
          label="Collateral released"
          value={usd(preview.collateralRelease)}
          provenance={dossier.origin === "ACCOUNT" ? "ESTIMATED" : "MODELED"}
          source="Pro rata share of posted collateral"
        />
      </div>

      <Preflight title="Terminal preflight" blockers={preview.blockers} notices={preview.notices} />

      <Link
        href={closeHandoffHref(dossier, market, preview.lots, preview.fees)}
        className={`${BUTTON_PRIMARY} h-10 text-[13px] lg:h-9`}
      >
        {partial ? `Review ${formatLots(preview.lots)}-lot close in terminal` : "Review full close in terminal"}
        <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
      <p className="text-[11px] leading-relaxed text-faint">{HANDOFF_NOTE}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

function RollTab({
  dossier,
  market,
  markets,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  markets: readonly PackageMarket[];
}) {
  const targets = rollTargets(market, markets);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [rollLots, setRollLots] = useState<number | null>(null);
  const target = targets.find((candidate) => candidate.id === targetId) ?? targets[0] ?? null;

  if (!target) {
    return (
      <div className="flex flex-col gap-3 p-3 lg:p-4">
        <p className="text-sm text-ink">No later maturity is listed.</p>
        <p className="text-xs leading-relaxed text-faint">
          {`${market.name} has no maturity after ${market.tenorLabel}. Close the position before its fixing or hold it to cash settlement.`}
        </p>
      </div>
    );
  }

  const lots = Math.min(dossier.lots, Math.max(1, rollLots ?? dossier.lots));
  const roll = rollPreview(dossier, market, target, lots);
  const targetSchedule = fixingSchedule(target);
  const unit = priceUnitSuffix(market.priceUnit);
  const estimated = dossier.origin === "ACCOUNT" ? "ESTIMATED" : "MODELED";
  const openBlockers = roll.openBlockers.filter((blocker) => !roll.close.blockers.includes(blocker));

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <div>
        <SubHead>Target maturity</SubHead>
        <div role="radiogroup" aria-label="Roll target" className="mt-2 flex flex-col gap-1">
          {targets.map((candidate) => {
            const active = candidate.id === target.id;
            const schedule = fixingSchedule(candidate);
            return (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTargetId(candidate.id)}
                className={`focus-ring grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md border px-2.5 py-2 text-left transition-colors duration-150 ${
                  active ? "border-brand-edge bg-brand-soft/40" : "border-line hover:border-line-strong hover:bg-raised/50"
                }`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <MarketMark underlying={candidate.underlying} size={14} />
                    <span className={`font-mono text-xs ${active ? "text-ink" : "text-dim"}`}>{candidate.code}</span>
                    {candidate.qualification !== "QUALIFIED" ? (
                      <span className="rounded-[3px] border border-line-strong px-1 font-mono text-[9.5px] tracking-[0.05em] text-dim uppercase">
                        {candidate.qualification.toLowerCase()}
                      </span>
                    ) : null}
                    {schedule.adjustment ? (
                      <span title={`${schedule.adjustment.reason}. Modeled`} className="text-brand">
                        <CalendarClock size={12} aria-label="Fixing date falls on a closed session" />
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-faint">{`Fixes ${formatUtcDate(candidate.expiryIso)}`}</span>
                </span>
                <span className="tnum text-right font-mono text-xs text-ink">
                  {price(candidate.netPrice, candidate, false)}
                  <span className="block text-[10.5px] text-faint">{`${candidate.firmDepthLots.toLocaleString("en-US")} firm lots`}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-faint">Lots to roll</span>
        <Stepper
          value={lots}
          onChange={(next) => setRollLots(Math.round(next))}
          min={1}
          max={dossier.lots}
          step={1}
          label="Lots to roll"
          suffix="lots"
          className="w-[150px]"
        />
      </div>

      <div className="divide-y divide-line-soft">
        <TrustRow
          label={`Close ${market.code}`}
          note={roll.close.route?.label}
          value={price(roll.close.price, market)}
          provenance="EXECUTABLE"
          source="Exit touch, reference book"
        />
        <TrustRow
          label={`Open ${target.code}`}
          note={roll.openRoute?.label}
          value={price(roll.openPrice, target)}
          provenance="EXECUTABLE"
          source="Entry touch, reference book"
        />
        <TrustRow
          label="Roll spread"
          note="target entry less current exit"
          value={`${roll.rollSpread >= 0 ? "+" : "-"}${formatNumber(Math.abs(roll.rollSpread), market.priceDecimals)} ${unit}`}
        />
        <TrustRow label="Crossing cost" note="mark to touch, both tickets" value={usd(roll.crossingCost)} provenance={estimated} />
        <TrustRow label="Fees, both tickets" value={usd(roll.fees, 2)} provenance="ESTIMATED" source="Route fee schedules" />
        <TrustRow
          label="Released / required"
          value={`${usd(roll.collateralRelease)} / ${formatNumber(roll.collateralRequired, 0)}`}
          provenance={estimated}
        />
        <TrustRow
          label="Net collateral change"
          value={signedUsd(roll.netCollateral)}
          tone={roll.netCollateral > 0 ? "text-ink" : "text-dim"}
          provenance={estimated}
        />
        <TrustRow
          label="New fixing"
          note={`+${roll.extensionDays} days`}
          value={formatUtcSession(targetSchedule.fixingMs).replace(" UTC", "")}
          provenance="MODELED"
          source="Scheduled from series terms"
        />
      </div>

      {target.qualification !== "QUALIFIED" || targetSchedule.adjustment ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-brand-edge/40 bg-brand-soft/30 px-3 py-2.5">
          {target.qualification !== "QUALIFIED" ? (
            <p className="text-xs leading-snug text-ink">
              <span className="font-medium">{`${target.code} is ${target.qualification.toLowerCase()}. `}</span>
              <span className="text-dim">{target.qualificationNote}</span>
            </p>
          ) : null}
          {targetSchedule.adjustment ? (
            <p className="text-xs leading-snug text-dim">
              {`${formatUtcDate(targetSchedule.adjustment.scheduled)} is ${targetSchedule.adjustment.reason}. ${targetSchedule.adjustment.rule} would move the print to ${formatUtcDate(targetSchedule.adjustment.adjusted)} (modeled).`}
            </p>
          ) : null}
        </div>
      ) : null}

      <Preflight
        title="Preflight, both tickets"
        blockers={[...roll.close.blockers.map((text) => `Close: ${text}`), ...openBlockers.map((text) => `Open: ${text}`)]}
        notices={[
          ...roll.close.notices,
          ...(dossier.origin === "REFERENCE"
            ? ["Required collateral is the terminal's margin for the new ticket on the live route; the reference record's posted collateral uses its own basis."]
            : []),
          "Two terminal tickets, not one atomic package. Between them the rolled lots are flat, and the open ticket quotes at its own time.",
        ]}
      />

      <ol className="flex flex-col gap-1.5">
        <li>
          <Link href={closeHandoffHref(dossier, market, roll.lots, roll.close.fees)} className={`${BUTTON_PRIMARY} h-10 w-full justify-between text-[13px] lg:h-9`}>
            <span className="flex items-center gap-2">
              <span className="tnum grid h-4 w-4 place-items-center rounded-full bg-app/15 font-mono text-[10px]">1</span>
              {`Close ${formatLots(roll.lots)} lots, ${market.tenorLabel}`}
            </span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link href={rollOpenHandoffHref(dossier, target, roll.lots)} className={`${BUTTON_QUIET} h-10 w-full justify-between text-[13px] lg:h-9`}>
            <span className="flex items-center gap-2">
              <span className="tnum grid h-4 w-4 place-items-center rounded-full border border-line-strong font-mono text-[10px]">2</span>
              {`Open ${formatLots(roll.lots)} lots, ${target.tenorLabel}`}
            </span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </li>
      </ol>
      <p className="text-[11px] leading-relaxed text-faint">{HANDOFF_NOTE}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settlement                                                          */
/* ------------------------------------------------------------------ */

function SettleTab({
  dossier,
  market,
  metrics,
  lifecycle,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  metrics: PositionMetrics;
  lifecycle: OnchainPositionLifecycle | null;
}) {
  const base = MARKETS.find((candidate) => candidate.id === market.id) ?? market;
  const span = Math.max(market.tickSize * 20, Math.abs(base.netPrice) * 0.06);
  const snap = (value: number) => Math.round(value / market.tickSize) * market.tickSize;
  const min = snap(base.netPrice - span);
  const max = snap(base.netPrice + span);
  const [level, setLevel] = useState<number | null>(null);
  const fixing = level ?? Math.min(max, Math.max(min, market.netPrice));
  const payoutAt = (value: number) => (value - dossier.entryPrice) * metrics.perPoint * metrics.direction;
  const schedule = fixingSchedule(market);
  const unit = priceUnitSuffix(market.priceUnit);
  const guarantee = GUARANTEE_COPY[dossier.guarantee];

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      {lifecycle ? (
        <TerminalLifecycle view={lifecycle} />
      ) : (
        <>
        <div className="rounded-md border border-line bg-inset px-3 py-2.5">
          <p className="text-[13px] text-ink">No election on this series</p>
          <p className="mt-1 text-xs leading-relaxed text-faint">
            {`Cash-settled dated package. The ${formatLots(dossier.lots)} lots settle automatically against ${market.fixingSource}. Exercise, election and lapse do not apply, so there is no window to act in.`}
          </p>
        </div>

        <div className="divide-y divide-line-soft">
          <TrustRow
            label="Settlement class"
            value={market.settlementClass === "CASH_USDC_NDF" ? "Cash USDC, NDF" : "Cash USDC"}
            provenance="OBSERVED"
            source="Series terms"
          />
          <TrustRow label="Fixing session" value={formatUtcSession(schedule.fixingMs)} provenance="MODELED" source="Scheduled from series terms" />
          <TrustRow
            label="Observation window"
            value={`${FIXING_WINDOW_MINUTES} min to the print`}
            provenance="MODELED"
            source="Series terms schedule"
          />
          <TrustRow
            label="Business-day rule"
            note={schedule.adjustment ? `${formatUtcDate(schedule.adjustment.scheduled)}: ${schedule.adjustment.reason}` : ADJUSTMENT_RULE}
            value={schedule.adjustment ? `moves to ${formatUtcDate(schedule.adjustment.adjusted)}` : "No adjustment"}
            tone={schedule.adjustment ? "text-brand" : "text-ink"}
            provenance="MODELED"
            source="LDN business calendar v1"
          />
          <TrustRow label="Completion path" value="Permissionless" note="after the fixing is committed" />
          <TrustRow label="Guarantee" value={guarantee.label} note={dossier.reference?.recoveryClass} />
        </div>
        </>
      )}

      <div className="rounded-md border border-line px-3 py-3">
        <SubHead right={<ProvenanceChip provenance="MODELED" source="Hypothetical fixing level" compact />}>Payout at fixing</SubHead>
        <div className="mt-2.5">
          <RangeField
            label="Fixing level"
            value={fixing}
            min={min}
            max={max}
            step={market.tickSize}
            origin={dossier.entryPrice}
            onChange={(next) => setLevel(Number(next.toFixed(market.priceDecimals)))}
            readout={`${formatNumber(fixing, market.priceDecimals)} ${unit}`}
            minLabel={formatNumber(min, market.priceDecimals)}
            maxLabel={formatNumber(max, market.priceDecimals)}
            ariaLabel="Hypothetical fixing level"
          />
        </div>
        <div className="mt-2 divide-y divide-line-soft">
          <TrustRow
            label="At the current mark"
            value={signedUsd(payoutAt(market.netPrice))}
            tone={toneOf(payoutAt(market.netPrice))}
            provenance={metrics.derivedProvenance}
          />
          <TrustRow
            label={`At ${formatNumber(fixing, market.priceDecimals)} ${unit}`}
            value={signedUsd(payoutAt(fixing))}
            tone={toneOf(payoutAt(fixing))}
            provenance="MODELED"
          />
          <TrustRow label="Sensitivity" value={`${formatNumber(metrics.perPoint, 2)} USDC per 1 ${unit}`} />
        </div>
        {level !== null ? (
          <button type="button" onClick={() => setLevel(null)} className="focus-ring mt-1 rounded-sm text-[11px] text-faint underline underline-offset-2 hover:text-ink">
            Track the live mark
          </button>
        ) : null}
      </div>
      <Link href={tradeHref(market)} className={`${BUTTON_QUIET} h-9`}>
        Open the series market
        <ArrowUpRight size={12} aria-hidden="true" />
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Closed                                                              */
/* ------------------------------------------------------------------ */

function ClosedSummary({
  dossier,
  market,
  lifecycle,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  lifecycle: OnchainPositionLifecycle | null;
}) {
  const terminal = lifecycle !== null && lifecycle.phase !== "CLOSED";
  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <p className="text-[13px] text-ink">{terminal ? "This position reached its terminal outcome" : "This position is closed"}</p>
      <p className="text-xs leading-relaxed text-faint">
        {terminal
          ? "Its fixing, election and settlement are recorded onchain below. Any open claim or released collateral can still be taken from here."
          : "It reached a terminal state before its fixing, so no close, roll or settlement action remains. Its fills and receipts stay addressable here."}
      </p>
      {terminal ? <TerminalLifecycle view={lifecycle} /> : null}
      <div className="divide-y divide-line-soft">
        <TrustRow label="Lots at opening" value={`${formatLots(dossier.openedLots)} lots`} provenance="OBSERVED" />
        <TrustRow label="Entry" value={price(dossier.entryPrice, market)} provenance="OBSERVED" />
        <TrustRow
          label="Realized PnL"
          value={dossier.realizedPnl !== null ? signedUsd(dossier.realizedPnl, 2) : "Not recorded"}
          tone={dossier.realizedPnl !== null ? toneOf(dossier.realizedPnl) : "text-faint"}
          provenance="OBSERVED"
        />
        <TrustRow label="Fees paid" value={usd(dossier.fees, 2)} provenance="OBSERVED" />
      </div>
      <Link href={tradeHref(market)} className={`${BUTTON_QUIET} h-9`}>
        Open a new position
        <ArrowUpRight size={12} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function ManagePanel({
  dossier,
  market,
  markets,
  metrics,
  lifecycle = null,
  action,
  onAction,
  className = "",
  delay = 0,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  markets: readonly PackageMarket[];
  metrics: PositionMetrics;
  lifecycle?: OnchainPositionLifecycle | null;
  action: ManageAction;
  onAction: (action: ManageAction) => void;
  className?: string;
  delay?: number;
}) {
  const targets = rollTargets(market, markets);
  if (dossier.phase === "CLOSED") {
    return (
      <Panel id="manage" label="Position actions" className={className} delay={delay}>
        <div className="flex h-10 shrink-0 items-center border-b border-line px-3">
          <h2 className="text-[13px] font-medium text-ink">Position closed</h2>
        </div>
        <ClosedSummary dossier={dossier} market={market} lifecycle={lifecycle} />
      </Panel>
    );
  }
  return (
    <Panel id="manage" label="Manage position" className={className} delay={delay}>
      <div className="flex h-10 shrink-0 items-stretch border-b border-line pr-3">
        <DeskTabs
          idBase="manage"
          value={action}
          onChange={(id) => onAction(id as ManageAction)}
          items={[
            { id: "close", label: "Close" },
            { id: "roll", label: "Roll", badge: targets.length > 0 ? undefined : "none" },
            { id: "settle", label: lifecycle ? "Settlement and election" : "Settlement" },
          ]}
        />
        <span className="ml-auto flex items-center">
          <ProvenanceChip
            provenance={dossier.origin === "ACCOUNT" ? "EXECUTABLE" : "MODELED"}
            source={dossier.origin === "ACCOUNT" ? "Live package routes" : "Reference record against live routes"}
            compact
          />
        </span>
      </div>
      <TabBody idBase="manage" key={action}>
        {action === "close" ? <CloseTab dossier={dossier} market={market} /> : null}
        {action === "roll" ? <RollTab dossier={dossier} market={market} markets={markets} /> : null}
        {action === "settle" ? <SettleTab dossier={dossier} market={market} metrics={metrics} lifecycle={lifecycle} /> : null}
      </TabBody>
    </Panel>
  );
}
