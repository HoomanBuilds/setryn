"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, CircleAlert, CircleCheck, Info } from "lucide-react";
import { BUTTON_PRIMARY, BUTTON_QUIET } from "@/components/activity/ledger-ui";
import { DeskTabs, Panel, RangeField, Stepper, TabBody } from "@/components/strategies/desk/Desk";
import { ProvenanceChip } from "@/components/settlements/trust";
import { SCHEDULE_SOURCE_LABEL, formatUtcDate, formatUtcSession, seriesSchedule } from "@/lib/settlements/calendar";
import { TerminalLifecycle } from "@/components/lifecycle/TerminalLifecycle";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { useMarketBoard } from "@/components/market-data/MarketDataProvider";
import type { OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import type { LiveMarketData } from "@/lib/market-data/types";
import { markOf } from "@/lib/portfolio/forward";
import type { PositionDossier } from "@/lib/positions/dossier";
import {
  closeHandoffHref,
  closePreview,
  rollOpenHandoffHref,
  rollPreview,
  rollTargets,
  settlementCashAt,
  settlementPnlAt,
  type PositionMetrics,
} from "@/lib/positions/economics";
import { GUARANTEE_COPY } from "@/lib/terminal/economics";
import { formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
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
  "The terminal re-quotes the book, runs preflight again and asks for your signature. Nothing is submitted from this page, and success shows only when the protocol records the terminal state.";

function maybePrice(value: number | null, market: PackageMarket): string {
  return value === null ? "—" : price(value, market);
}

function maybeUsd(value: number | null, decimals = 0): string {
  return value === null ? "—" : usd(value, decimals);
}

/* ------------------------------------------------------------------ */
/* Close                                                               */
/* ------------------------------------------------------------------ */

function CloseTab({
  dossier,
  market,
  live,
  metrics,
  nowMs,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  live: LiveMarketData | null;
  metrics: PositionMetrics;
  nowMs: number;
}) {
  const snapshot = useGatewaySnapshot();
  const economics = snapshot.onchainMarkets[market.id] ?? null;
  // Closes settle the whole position against the maker's firm quote in one transaction; there is no partial close.
  const canPartial = false;
  const [mode, setMode] = useState<"FULL" | "PARTIAL">("FULL");
  const [partialLots, setPartialLots] = useState(() => Math.max(1, Math.floor(dossier.lots / 2)));
  const partial = mode === "PARTIAL" && canPartial;
  const lots = partial ? Math.min(Math.max(1, partialLots), dossier.lots - 1) : dossier.lots;
  const preview = closePreview(dossier, market, live, economics, lots, nowMs, metrics.schedule);
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
            title: "A close settles the whole position in one transaction.",
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
          label={`Close at the maker ${sideWord}`}
          note={preview.price === null ? `no firm ${sideWord}` : `${formatLots(preview.fillableLots)} lots close in one transaction`}
          value={maybePrice(preview.price, market)}
          tone={preview.price === null ? "text-faint" : "text-ink"}
          provenance={preview.price === null ? undefined : "EXECUTABLE"}
          source="Firm maker quote, settled atomically with the close"
        />
        <TrustRow
          label="Closing / remaining"
          value={`${formatLots(preview.lots)} / ${formatLots(preview.remainingLots)} lots`}
        />
        <TrustRow
          label="Taker fee"
          value={maybeUsd(preview.fees, 2)}
          tone={preview.fees === null ? "text-faint" : "text-ink"}
          provenance={preview.fees === null ? undefined : "ESTIMATED"}
          source="Active onchain fee schedule, on the consideration"
        />
        <TrustRow
          label="Realized PnL at this price"
          value={preview.realizedPnl === null ? "—" : signedUsd(preview.realizedPnl, 2)}
          tone={preview.realizedPnl === null ? "text-faint" : toneOf(preview.realizedPnl)}
          provenance={preview.realizedPnl === null ? undefined : "ESTIMATED"}
          source="Entry against the close price, less the fee"
        />
        <TrustRow
          label="Collateral released"
          value={usd(preview.collateralRelease)}
          provenance="ESTIMATED"
          source="Pro rata share of locked collateral"
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
  live,
  metrics,
  nowMs,
}: {
  dossier: PositionDossier;
  market: PackageMarket;
  markets: readonly PackageMarket[];
  live: LiveMarketData | null;
  metrics: PositionMetrics;
  nowMs: number;
}) {
  const snapshot = useGatewaySnapshot();
  const { snapshot: feed } = useMarketBoard();
  const targets = rollTargets(market, markets);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [rollLots, setRollLots] = useState<number | null>(null);
  const target = targets.find((candidate) => candidate.id === targetId) ?? targets[0] ?? null;
  const liveOf = (id: string) => feed?.markets.find((candidate) => candidate.marketKey === id) ?? null;

  if (!target) {
    return (
      <div className="flex flex-col gap-3 p-3 lg:p-4">
        <p className="text-sm text-ink">No later maturity is listed.</p>
        <p className="text-xs leading-relaxed text-faint">
          {`${market.underlying} has no maturity listed after ${market.tenorLabel}. Close the position before its last trade or hold it to cash settlement.`}
        </p>
      </div>
    );
  }

  const lots = Math.min(dossier.lots, Math.max(1, rollLots ?? dossier.lots));
  const targetLive = liveOf(target.id);
  const roll = rollPreview(
    dossier,
    market,
    live,
    target,
    targetLive,
    { current: snapshot.onchainMarkets[market.id] ?? null, target: snapshot.onchainMarkets[target.id] ?? null },
    lots,
    nowMs,
    metrics.schedule,
  );
  const targetSchedule = seriesSchedule(target);
  const unit = priceUnitSuffix(market.priceUnit);
  const openBlockers = roll.openBlockers.filter((blocker) => !roll.close.blockers.includes(blocker));

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      <div>
        <SubHead>Target maturity</SubHead>
        <div role="radiogroup" aria-label="Roll target" className="mt-2 flex flex-col gap-1">
          {targets.map((candidate) => {
            const active = candidate.id === target.id;
            const candidateLive = liveOf(candidate.id);
            const candidateMark = markOf(candidateLive).price;
            const depth = (candidateLive?.book ?? [])
              .filter((row) => row.executable && row.side === (dossier.side === "LONG" ? "ASK" : "BID"))
              .reduce((total, row) => total + row.lots, 0);
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
                    {candidateLive && candidateLive.seriesStatus !== "ACTIVE" && candidateLive.seriesStatus !== "UNKNOWN" ? (
                      <span className="rounded-[3px] border border-line-strong px-1 font-mono text-[9.5px] tracking-[0.05em] text-dim uppercase">
                        {candidateLive.seriesStatus.toLowerCase()}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-faint">{`Fixes ${formatUtcDate(seriesSchedule(candidate).fixingMs)}`}</span>
                </span>
                <span className="tnum text-right font-mono text-xs text-ink">
                  {candidateMark === null ? <span className="text-faint">No quote</span> : price(candidateMark, candidate, false)}
                  <span className="block text-[10.5px] text-faint">{`${depth.toLocaleString("en-US")} lots ${dossier.side === "LONG" ? "offered" : "bid"}`}</span>
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
          note={roll.close.price === null ? "nothing rests to close against" : `${formatLots(roll.close.fillableLots)} lots on the book`}
          value={maybePrice(roll.close.price, market)}
          tone={roll.close.price === null ? "text-faint" : "text-ink"}
          provenance={roll.close.price === null ? undefined : "EXECUTABLE"}
          source="Exit, onchain public book"
        />
        <TrustRow
          label={`Open ${target.code}`}
          note={roll.openPrice === null ? "nothing rests to open against" : `${formatLots(roll.openFillableLots)} lots on the book`}
          value={maybePrice(roll.openPrice, target)}
          tone={roll.openPrice === null ? "text-faint" : "text-ink"}
          provenance={roll.openPrice === null ? undefined : "EXECUTABLE"}
          source="Entry, onchain public book"
        />
        <TrustRow
          label="Roll spread"
          note="target entry less current exit"
          value={
            roll.rollSpread === null
              ? "—"
              : `${roll.rollSpread >= 0 ? "+" : "-"}${formatNumber(Math.abs(roll.rollSpread), market.priceDecimals)} ${unit}`
          }
        />
        <TrustRow label="Crossing cost" note="mark to fill, both tickets" value={maybeUsd(roll.crossingCost)} provenance={roll.crossingCost === null ? undefined : "ESTIMATED"} />
        <TrustRow label="Fees, both tickets" value={maybeUsd(roll.fees, 2)} provenance={roll.fees === null ? undefined : "ESTIMATED"} source="Active onchain fee schedule" />
        <TrustRow
          label="Released / required"
          value={`${usd(roll.collateralRelease)} / ${roll.collateralRequired === null ? "—" : formatNumber(roll.collateralRequired, 0)}`}
          provenance="ESTIMATED"
        />
        <TrustRow
          label="Net collateral change"
          value={roll.netCollateral === null ? "—" : signedUsd(roll.netCollateral)}
          tone={roll.netCollateral !== null && roll.netCollateral > 0 ? "text-ink" : "text-dim"}
          provenance={roll.netCollateral === null ? undefined : "ESTIMATED"}
        />
        <TrustRow
          label="New fixing"
          note={`+${roll.extensionDays} days`}
          value={formatUtcSession(targetSchedule.fixingMs).replace(" UTC", "")}
          provenance={targetSchedule.source === "EXPIRY_RULE" ? "MODELED" : "OBSERVED"}
          source={SCHEDULE_SOURCE_LABEL[targetSchedule.source]}
        />
      </div>

      <Preflight
        title="Preflight, both tickets"
        blockers={[...roll.close.blockers.map((text) => `Close: ${text}`), ...openBlockers.map((text) => `Open: ${text}`)]}
        notices={[
          ...roll.close.notices,
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
  const terms = metrics.terms;
  const anchor = metrics.mark ?? dossier.entryPrice;
  const span = Math.max(market.tickSize * 20, Math.abs(anchor) * 0.25);
  const snap = (value: number) => Math.round(value / market.tickSize) * market.tickSize;
  /* The payoff is flat beyond the bounds, so the slider spans the range itself when it is published. */
  const min = snap(terms.floor ?? Math.max(0, anchor - span));
  const max = snap(terms.cap ?? anchor + span);
  const [level, setLevel] = useState<number | null>(null);
  const fixing = level ?? Math.min(max, Math.max(min, anchor));
  const schedule = metrics.schedule;
  const unit = priceUnitSuffix(market.priceUnit);
  const guarantee = GUARANTEE_COPY[dossier.guarantee];
  const cash = settlementCashAt(dossier, market, fixing);
  const scheduled = schedule.source === "POSITION" ? "OBSERVED" : "MODELED";

  return (
    <div className="flex flex-col gap-3 p-3 lg:p-4">
      {lifecycle ? (
        <TerminalLifecycle view={lifecycle} />
      ) : (
        <>
        <div className="rounded-md border border-line bg-inset px-3 py-2.5">
          <p className="text-[13px] text-ink">Cash settlement at the fixing</p>
          <p className="mt-1 text-xs leading-relaxed text-faint">
            {`The ${formatLots(dossier.lots)} lots settle in ${market.settlementAsset} against ${market.fixingSource}. The long elects in the window after the fixing; settlement then completes permissionlessly before its deadline.`}
          </p>
        </div>

        <div className="divide-y divide-line-soft">
          <TrustRow label="Last trade" value={formatUtcSession(schedule.lastTradingMs)} provenance={scheduled} source={SCHEDULE_SOURCE_LABEL[schedule.source]} />
          <TrustRow
            label="Fixing window"
            value={`${formatUtcSession(schedule.windowOpensMs).slice(0, 11)}, ${formatUtcSession(schedule.windowOpensMs).slice(13, 18)}–${formatUtcSession(schedule.fixingMs).slice(13)}`}
            note={`${schedule.windowMinutes} min observation`}
            provenance={scheduled}
            source={SCHEDULE_SOURCE_LABEL[schedule.source]}
          />
          <TrustRow
            label="Holder election"
            value={`${formatUtcSession(schedule.electionOpensMs).slice(13, 18)}–${formatUtcSession(schedule.electionClosesMs).slice(13)}`}
            note={dossier.side === "LONG" ? "the long elects" : "the long side elects"}
            provenance={scheduled}
            source={SCHEDULE_SOURCE_LABEL[schedule.source]}
          />
          <TrustRow label="Settlement deadline" value={formatUtcSession(schedule.settlementDeadlineMs)} provenance={scheduled} source={SCHEDULE_SOURCE_LABEL[schedule.source]} />
          <TrustRow label="Completion path" value="Permissionless" note="after the fixing is committed" />
          <TrustRow label="Guarantee" value={guarantee.label} />
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
            value={metrics.mark === null ? "No mark yet" : signedUsd(settlementPnlAt(dossier, market, metrics.mark))}
            tone={metrics.mark === null ? "text-faint" : toneOf(settlementPnlAt(dossier, market, metrics.mark))}
            provenance={metrics.mark === null ? undefined : metrics.markProvenance}
          />
          <TrustRow
            label={`PnL at ${formatNumber(fixing, market.priceDecimals)} ${unit}`}
            value={signedUsd(settlementPnlAt(dossier, market, fixing))}
            tone={toneOf(settlementPnlAt(dossier, market, fixing))}
            provenance="MODELED"
          />
          <TrustRow
            label="Cash received at settlement"
            note={dossier.side === "LONG" ? "lots x lot x (fixing - floor)" : "lots x lot x (cap - fixing)"}
            value={cash === null ? "Range not published" : usd(cash)}
            tone={cash === null ? "text-faint" : "text-ink"}
            provenance={cash === null ? undefined : "MODELED"}
          />
          <TrustRow label="Sensitivity" value={`${formatNumber(Math.abs(metrics.perPoint), 4)} USDC per 1 ${unit}`} note="inside the range; flat beyond it" />
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
  live,
  nowMs,
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
  live: LiveMarketData | null;
  nowMs: number;
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
          <ProvenanceChip provenance="EXECUTABLE" source="Onchain public book" compact />
        </span>
      </div>
      <TabBody idBase="manage" key={action}>
        {action === "close" ? <CloseTab dossier={dossier} market={market} live={live} metrics={metrics} nowMs={nowMs} /> : null}
        {action === "roll" ? (
          <RollTab dossier={dossier} market={market} markets={markets} live={live} metrics={metrics} nowMs={nowMs} />
        ) : null}
        {action === "settle" ? <SettleTab dossier={dossier} market={market} metrics={metrics} lifecycle={lifecycle} /> : null}
      </TabBody>
    </Panel>
  );
}
