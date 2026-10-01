"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Check, FileSearch, Minus, Wallet, X } from "lucide-react";
import { BUTTON_INK, BUTTON_QUIET, CopyButton, formatUtcTime, middleTruncate } from "@/components/activity/ledger-ui";
import { TH, TH_NUM } from "@/components/strategies/desk/Desk";
import { positionHref, receiptHref } from "@/lib/positions/dossier";
import { formatCountdownMs, formatUtcShort } from "@/lib/settlements/calendar";
import { MARK_SOURCE_LABEL, markProvenance } from "@/lib/portfolio/forward";
import { STAGE_COPY } from "@/lib/settlements/stages";
import type {
  HeldExposure,
  ObservationGroup,
  PayoutRow,
  ReconStatus,
  ReconciliationRow,
  ScheduleBoundary,
  SettlementException,
} from "@/lib/settlements/types";
import { formatLots, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { OriginChip, ProvenanceChip, SeverityChip } from "./trust";
import { CollateralMark, MarketMark, WithMark } from "@/components/portfolio/MarketMark";

function priceText(value: number, market: PackageMarket, withUnit = true): string {
  const text = formatNumber(value, market.priceDecimals);
  return withUnit ? `${text} ${priceUnitSuffix(market.priceUnit)}` : text;
}

function signed(value: number, decimals = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value), decimals)}`;
}

function tone(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-dim";
}

const ROW = "border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-raised/50";

export function EmptyTab({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="text-faint">{icon ?? <FileSearch size={18} aria-hidden="true" />}</span>
      <p className="mt-3 text-sm text-ink">{title}</p>
      {children ? <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">{children}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ConnectPrompt({
  title,
  detail,
  connecting,
  label = "Connect wallet",
  error,
  onConnect,
  compact = false,
}: {
  title: string;
  detail: string;
  connecting: boolean;
  label?: string;
  error: string | null;
  onConnect: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-col gap-2 border-b border-line bg-inset/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between lg:px-4">
        <span className="flex min-w-0 items-start gap-2 text-xs text-dim">
          <Wallet size={13} aria-hidden="true" className="mt-[1px] shrink-0 text-faint" />
          <span>
            <span className="text-ink">{title}</span> {detail}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {error ? <span className="text-[11px] text-down">{error}</span> : null}
          <button type="button" onClick={onConnect} disabled={connecting} className={BUTTON_INK}>
            {connecting ? "Connecting..." : label}
          </button>
        </span>
      </div>
    );
  }
  return (
    <EmptyTab
      icon={<Wallet size={18} aria-hidden="true" />}
      title={title}
      action={
        <>
          <button type="button" onClick={onConnect} disabled={connecting} className={BUTTON_INK}>
            {connecting ? "Connecting..." : label}
          </button>
          <Link href="/activity" className={BUTTON_QUIET}>
            Open activity
          </Link>
        </>
      }
    >
      {detail}
      {error ? <span className="mt-2 block text-down">{error}</span> : null}
    </EmptyTab>
  );
}

function HeldCell({ held }: { held: HeldExposure[] }) {
  if (held.length === 0) return <span className="text-xs text-off">None</span>;
  return (
    <span className="flex flex-col gap-1">
      {held.map((exposure) => (
        <Link
          key={exposure.positionId}
          href={positionHref(exposure.positionId)}
          className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-xs text-ink hover:text-brand"
        >
          <OriginChip origin={exposure.origin} />
          <span className={`tnum font-mono ${exposure.side === "LONG" ? "text-up" : "text-down"}`}>
            {`${exposure.side === "LONG" ? "+" : "-"}${formatLots(exposure.lots)}`}
          </span>
        </Link>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Upcoming fixings                                                    */
/* ------------------------------------------------------------------ */

const KIND_LABEL: Record<ScheduleBoundary["kind"], string> = {
  FIXING: "Fixing",
  LAST_TRADE: "Last trade",
  ELECTION: "Election",
};

/** Rows in the current year read "25 Sep 08:00"; later years carry the year. */
function rowDate(ms: number, nowMs: number): string {
  const short = formatUtcShort(ms);
  const year = new Date(ms).getUTCFullYear();
  if (year === new Date(nowMs).getUTCFullYear()) return short;
  return `${short.slice(0, 6)} ${year} ${short.slice(7)}`;
}

function whenCell(row: ScheduleBoundary, nowMs: number): { primary: string; secondary: string; urgent: boolean } {
  if (row.state === "WINDOW_OPEN") return { primary: row.timingLabel, secondary: "window open", urgent: true };
  if (row.atMs === null) return { primary: row.timingLabel, secondary: "unscheduled", urgent: false };
  const remaining = row.atMs - nowMs;
  return {
    primary: rowDate(row.atMs, nowMs),
    secondary: remaining > 0 ? `in ${formatCountdownMs(remaining)}` : "passed",
    urgent: remaining > 0 && remaining < 7 * 86_400_000,
  };
}

export function UpcomingTable({ rows, nowMs, selectedId, onSelect }: { rows: ScheduleBoundary[]; nowMs: number; selectedId: string | null; onSelect: (id: string) => void }) {
  if (rows.length === 0) {
    return <EmptyTab title="No boundary in this view">Held series appear here with their last trade, fixing and election boundaries.</EmptyTab>;
  }
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="relative w-full min-w-[900px] border-collapse text-left">
          <caption className="sr-only">Upcoming fixing and lifecycle boundaries, soonest first.</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>When (UTC)</th>
              <th scope="col" className={TH}>Series</th>
              <th scope="col" className={TH}>Boundary</th>
              <th scope="col" className={TH}>Window opens</th>
              <th scope="col" className={TH}>Held</th>
              <th scope="col" className={TH}>Fixing source</th>
              <th scope="col" className={TH}>Class</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const when = whenCell(row, nowMs);
              const selected = row.id === selectedId;
              return (
                <tr
                  key={row.id}
                  className={`${ROW} cursor-pointer ${selected ? "bg-raised/70 shadow-[inset_2px_0_0_var(--color-brand)]" : ""}`}
                  onClick={() => onSelect(row.id)}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="tnum block font-mono text-xs text-ink">{when.primary}</span>
                    <span className={`tnum block font-mono text-[11px] ${when.urgent ? "text-brand" : "text-faint"}`}>{when.secondary}</span>
                  </td>
                  <td className="px-3">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(row.id);
                      }}
                      className="focus-ring flex items-center gap-2 rounded-sm text-left"
                      aria-pressed={selected}
                    >
                      <MarketMark underlying={row.market.underlying} size={16} />
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-ink">{row.market.code}</span>
                        <span className="block text-[11px] text-faint">{row.market.name}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-3">
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-dim">{KIND_LABEL[row.kind]}</span>
                      {row.market.qualification !== "QUALIFIED" && row.kind === "FIXING" ? (
                        <span className="rounded-[3px] border border-line-strong px-1 font-mono text-[9.5px] tracking-[0.05em] text-dim uppercase">
                          {row.market.qualification.toLowerCase()}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[11px] text-faint">{row.label}</span>
                  </td>
                  <td className="tnum px-3 font-mono text-[11px] whitespace-nowrap text-dim">
                    {row.windowOpensMs !== null ? rowDate(row.windowOpensMs, nowMs) : "n/a"}
                  </td>
                  <td className="px-3 py-2">
                    <HeldCell held={row.held} />
                  </td>
                  <td className="max-w-[220px] truncate px-3 text-[11px] text-faint" title={row.source}>
                    {row.kind === "FIXING" ? row.market.fixingSource : row.source}
                  </td>
                  <td className="px-3">
                    <ProvenanceChip provenance={row.provenance} source={row.source} compact />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {rows.map((row) => {
          const when = whenCell(row, nowMs);
          return (
            <li key={row.id} className="flex flex-col gap-1.5 border-b border-line-soft px-3 py-2.5 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <WithMark underlying={row.market.underlying} className="font-mono text-xs text-ink">{row.market.code}</WithMark>
                <span className={`tnum font-mono text-xs ${when.urgent ? "text-brand" : "text-dim"}`}>{when.secondary}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
                <span className="truncate">{`${KIND_LABEL[row.kind]} · ${row.label}`}</span>
                <span className="tnum shrink-0 font-mono">{when.primary}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <HeldCell held={row.held} />
                <span className="flex items-center gap-1.5">
                  <ProvenanceChip provenance={row.provenance} source={row.source} compact />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Observations                                                        */
/* ------------------------------------------------------------------ */

const FIXING_STATE: Record<ObservationGroup["fixingState"], string> = {
  PENDING: "Not observed",
  WINDOW_OPEN: "Window open",
  AWAITING_RECORD: "Awaiting record",
  PROPOSED: "Proposed",
  DISPUTED: "Disputed",
  FINALIZED: "Final",
};

function ageText(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 120) return `${seconds}s`;
  if (seconds < 7_200) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h`;
}

export function ObservationsTable({ groups, nowMs }: { groups: ObservationGroup[]; nowMs: number }) {
  if (groups.length === 0) {
    return <EmptyTab title="No series in this view">Switch to all listed series to inspect every live input.</EmptyTab>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="relative w-full min-w-[820px] border-collapse text-left">
        <caption className="sr-only">Live inputs behind each series&apos; mark and fixing, grouped by series.</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={TH}>Series / input</th>
            <th scope="col" className={TH}>Role</th>
            <th scope="col" className={TH_NUM}>Value</th>
            <th scope="col" className={TH_NUM}>Age</th>
            <th scope="col" className={TH}>Source</th>
            <th scope="col" className={TH}>Class</th>
          </tr>
        </thead>
        {groups.map((group) => {
          const remaining = group.fixingMs - nowMs;
          return (
            <tbody key={group.market.id} className="border-b border-line last:border-b-0">
              <tr className="bg-inset/50">
                <th scope="rowgroup" className="px-3 py-2 text-left font-normal">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={tradeHref(group.market)} className="focus-ring flex items-center gap-1.5 rounded-sm font-mono text-xs text-ink hover:text-brand">
                      <MarketMark underlying={group.market.underlying} size={14} />
                      {group.market.code}
                    </Link>
                    {group.held.map((held) => (
                      <OriginChip key={held.positionId} origin={held.origin} />
                    ))}
                  </span>
                </th>
                <td className="px-3 text-[11px] text-faint">Fixing record</td>
                <td className="tnum px-3 text-right font-mono text-xs text-faint">
                  {group.fixingValue !== null ? (
                    <span className="text-ink">{priceText(group.fixingValue, group.market, false)}</span>
                  ) : (
                    <span title="No fixing value is shown before it is recorded onchain.">{FIXING_STATE[group.fixingState]}</span>
                  )}
                </td>
                <td className="tnum px-3 text-right font-mono text-[11px] whitespace-nowrap text-dim">
                  {remaining > 0 ? `print in ${formatCountdownMs(remaining)}` : "print passed"}
                </td>
                <td className="px-3 text-[11px] text-faint">{group.market.fixingSource}</td>
                <td className="px-3">
                  <ProvenanceChip
                    provenance={group.fixingValue !== null ? "OBSERVED" : "MODELED"}
                    source={group.fixingValue !== null ? "Fixing engine record on the held position" : "Print time from the series schedule; no value recorded"}
                    compact
                  />
                </td>
              </tr>
              <tr className={ROW}>
                <td className="px-3 py-1.5 pl-6 text-xs text-dim">Mark</td>
                <td className="px-3 text-[11px] text-faint">Mark to market</td>
                <td className={`tnum px-3 text-right font-mono text-xs ${group.packageMark === null ? "text-faint" : "text-ink"}`}>
                  {group.packageMark === null ? "No quote" : priceText(group.packageMark, group.market)}
                </td>
                <td className="tnum px-3 text-right font-mono text-[11px] text-dim">{group.packageMark === null ? "—" : ageText(group.markAgeSeconds)}</td>
                <td className="px-3 text-[11px] text-faint">{MARK_SOURCE_LABEL[group.markSource]}</td>
                <td className="px-3">
                  {group.packageMark === null ? null : (
                    <ProvenanceChip provenance={markProvenance(group.markSource)} source={MARK_SOURCE_LABEL[group.markSource]} compact />
                  )}
                </td>
              </tr>
              {group.inputs.map((input) => (
                <tr key={input.id} className={ROW}>
                  <td className="px-3 py-1.5 pl-6">
                    <span className="block text-xs text-dim">{input.label}</span>
                  </td>
                  <td className="px-3 text-[11px] whitespace-nowrap text-faint">{input.role}</td>
                  <td className={`tnum px-3 text-right font-mono text-xs whitespace-nowrap ${input.value === null ? "text-faint" : "text-ink"}`}>
                    {input.value === null ? "—" : `${formatNumber(input.value, input.decimals)} ${input.unit}`}
                  </td>
                  <td className="tnum px-3 text-right font-mono text-[11px] text-dim">{ageText(input.ageSeconds)}</td>
                  <td className="px-3 text-[11px] text-faint">{input.source}</td>
                  <td className="px-3">
                    {input.value === null ? null : <ProvenanceChip provenance={input.provenance} source={input.source} compact />}
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payouts                                                             */
/* ------------------------------------------------------------------ */

export function PayoutsTable({ rows, nowMs }: { rows: PayoutRow[]; nowMs: number }) {
  if (rows.length === 0) {
    return <EmptyTab title="No payout in this view">Open positions project their settlement payout here; exits record realized cash.</EmptyTab>;
  }
  const projected = rows.filter((row) => row.kind === "PROJECTED");
  const realized = rows.filter((row) => row.kind === "REALIZED");
  const section = (title: string, note: string, list: PayoutRow[]) =>
    list.length > 0 ? (
      <tbody className="border-b border-line last:border-b-0">
        <tr className="bg-inset/50">
          <th scope="rowgroup" colSpan={9} className="px-3 py-1.5 text-left font-normal">
            <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">{title}</span>
            <span className="ml-2 text-[11px] text-off">{note}</span>
          </th>
        </tr>
        {list.map((row) => (
          <tr key={row.id} className={ROW}>
            <td className="px-3 py-2">
              <Link href={positionHref(row.positionId)} className="focus-ring flex items-center gap-1.5 rounded-sm text-xs text-ink hover:text-brand">
                <MarketMark underlying={row.market.underlying} size={14} />
                <span className="truncate">{row.label}</span>
              </Link>
              <span className="mt-0.5 flex items-center gap-1.5">
                <OriginChip origin={row.origin} />
                <span className="font-mono text-[10.5px] text-faint">{row.market.code}</span>
              </span>
            </td>
            <td className={`tnum px-3 text-right font-mono text-xs ${row.side === "LONG" ? "text-up" : "text-down"}`}>
              {`${row.side === "LONG" ? "+" : "-"}${formatLots(row.lots)}`}
            </td>
            <td className="tnum px-3 text-right font-mono text-xs text-dim">{priceText(row.entryPrice, row.market, false)}</td>
            <td className={`tnum px-3 text-right font-mono text-xs ${row.referencePrice === null ? "text-faint" : "text-ink"}`}>
              {row.referencePrice === null ? "—" : priceText(row.referencePrice, row.market, false)}
              <span className="block text-[10.5px] text-faint">{row.referenceLabel.toLowerCase()}</span>
            </td>
            <td className={`tnum px-3 text-right font-mono text-xs ${tone(row.amount)}`}>{`${signed(row.amount, row.kind === "REALIZED" ? 2 : 0)}`}</td>
            <td className="tnum px-3 text-right font-mono text-[11px] text-dim">{formatNumber(row.perPoint, row.perPoint < 10 ? 2 : 1)}</td>
            <td className="tnum px-3 text-right font-mono text-xs text-dim">{formatNumber(row.collateral, 0)}</td>
            <td className="px-3 text-[11px] whitespace-nowrap">
              {row.kind === "REALIZED" ? (
                row.receiptId ? (
                  <Link href={receiptHref(row.receiptId)} className="focus-ring inline-flex items-center gap-1 rounded-sm text-ink hover:text-brand">
                    Receipt
                    <ArrowUpRight size={11} aria-hidden="true" />
                  </Link>
                ) : (
                  <span className="text-faint">Recorded</span>
                )
              ) : (
                <span className="text-dim">
                  {row.stage ? STAGE_COPY[row.stage].label : "Open"}
                  <span className="tnum block font-mono text-[10.5px] text-faint">
                    {row.fixingMs > nowMs ? `fix in ${formatCountdownMs(row.fixingMs - nowMs)}` : "print passed"}
                  </span>
                </span>
              )}
            </td>
            <td className="px-3">
              <ProvenanceChip
                provenance={row.provenance}
                source={row.kind === "REALIZED" ? "Exit receipt" : `Entry against the ${row.referenceLabel.toLowerCase()}`}
                compact
              />
            </td>
          </tr>
        ))}
      </tbody>
    ) : null;
  const mobile = (title: string, list: PayoutRow[]) =>
    list.length > 0 ? (
      <div key={title}>
        <p className="border-b border-line-soft bg-inset/50 px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">{title}</p>
        <ul>
          {list.map((row) => (
            <li key={row.id} className="flex flex-col gap-1.5 border-b border-line-soft px-3 py-2.5 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <Link href={positionHref(row.positionId)} className="focus-ring flex min-w-0 items-center gap-1.5 rounded-sm text-xs text-ink">
                  <MarketMark underlying={row.market.underlying} size={14} />
                  <span className="truncate">{row.label}</span>
                </Link>
                <span className={`tnum flex shrink-0 items-center gap-1 font-mono text-sm ${tone(row.amount)}`}>
                  <CollateralMark size={13} />
                  {`${signed(row.amount, row.kind === "REALIZED" ? 2 : 0)} USDC`}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
                <span className="tnum font-mono">
                  {`${row.side === "LONG" ? "+" : "-"}${formatLots(row.lots)} lots · ${priceText(row.entryPrice, row.market, false)} → ${row.referencePrice === null ? "—" : priceText(row.referencePrice, row.market, false)}`}
                </span>
                <span className="tnum shrink-0 font-mono">
                  {row.kind === "REALIZED" ? "realized" : row.fixingMs > nowMs ? `fix in ${formatCountdownMs(row.fixingMs - nowMs)}` : "print passed"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <OriginChip origin={row.origin} />
                <ProvenanceChip provenance={row.provenance} compact />
              </div>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <>
      <div className="md:hidden">
        {mobile("Projected at fixing", projected)}
        {mobile("Realized", realized)}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="relative w-full min-w-[860px] border-collapse text-left">
          <caption className="sr-only">Projected settlement payouts at the current mark and realized payouts from exits.</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Position</th>
              <th scope="col" className={TH_NUM}>Lots</th>
              <th scope="col" className={TH_NUM}>Entry</th>
              <th scope="col" className={TH_NUM}>Reference</th>
              <th scope="col" className={TH_NUM}>
                <span className="inline-flex items-center gap-1">
                  <CollateralMark size={11} />
                  Payout, USDC
                </span>
              </th>
              <th scope="col" className={TH_NUM} title="USDC per 1.00 move in the fixing, inside the payoff range">Per 1.0 move</th>
              <th scope="col" className={TH_NUM}>Collateral</th>
              <th scope="col" className={TH}>Stage</th>
              <th scope="col" className={TH}>Class</th>
            </tr>
          </thead>
          {section("Projected at fixing", "price term at the live mark or the final fixing; the fixing sets the amount", projected)}
          {section("Realized", "exits recorded onchain", realized)}
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

const RECON_COPY: Record<ReconStatus, { label: string; tone: string }> = {
  MATCHED: { label: "Matched", tone: "text-dim" },
  OPEN: { label: "Open", tone: "text-brand" },
  PENDING: { label: "Pending", tone: "text-brand" },
  MISMATCH: { label: "Mismatch", tone: "text-down" },
};

export function ReconciliationTable({ rows }: { rows: ReconciliationRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyTab title="Nothing to reconcile">
        The connected account has no positions, fills, orders or RFQs yet. Each one is cross-checked here once it exists.
      </EmptyTab>
    );
  }
  return (
    <>
      <ul className="md:hidden">
        {rows.map((row) => {
          const copy = RECON_COPY[row.status];
          const passed = row.checks.filter((check) => check.ok).length;
          return (
            <li key={row.id} className="flex flex-col gap-1.5 border-b border-line-soft px-3 py-2.5 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs ${copy.tone}`}>{`${copy.label} · ${row.subjectKind.toLowerCase()}`}</span>
                <span className="tnum font-mono text-[11px] text-faint">{`${passed}/${row.checks.length} checks`}</span>
              </div>
              <span title={row.subject} className="tnum truncate font-mono text-xs text-ink">{middleTruncate(row.subject, 10, 6)}</span>
              <span className="truncate text-[11px] text-faint">{row.description}</span>
              {row.receiptId ? (
                <Link href={receiptHref(row.receiptId)} className="focus-ring inline-flex items-center gap-1 self-start rounded-sm text-xs text-ink">
                  Receipt
                  <ArrowUpRight size={11} aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="relative w-full min-w-[860px] border-collapse text-left">
          <caption className="sr-only">Cross-record checks between positions, fills, receipts, orders and RFQs.</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Status</th>
              <th scope="col" className={TH}>Record</th>
              <th scope="col" className={TH}>Checks</th>
              <th scope="col" className={TH}>Time (UTC)</th>
              <th scope="col" className={TH}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const copy = RECON_COPY[row.status];
              const passed = row.checks.filter((check) => check.ok).length;
              return (
                <tr key={row.id} className={`${ROW} ${row.status === "MISMATCH" ? "shadow-[inset_2px_0_0_var(--color-down)]" : ""}`}>
                  <td className="px-3 py-2">
                    <span className={`text-xs ${copy.tone}`}>{copy.label}</span>
                    <span className="block font-mono text-[10.5px] tracking-[0.04em] text-faint uppercase">{row.subjectKind}</span>
                  </td>
                  <td className="max-w-[340px] px-3">
                    <span className="flex min-w-0 items-center">
                      <span title={row.subject} className="tnum truncate font-mono text-xs text-ink">
                        {middleTruncate(row.subject, 10, 6)}
                      </span>
                      <CopyButton value={row.subject} label={`${row.subjectKind.toLowerCase()} identifier`} size={11} className="h-5 w-5" />
                    </span>
                    <span className="block truncate text-[11px] text-faint">{row.description}</span>
                  </td>
                  <td className="px-3">
                    <span className="flex flex-wrap items-center gap-1" title={row.checks.map((check) => `${check.ok ? "Pass" : "Fail"}: ${check.label}`).join("\n")}>
                      {row.checks.map((check) => (
                        <span
                          key={check.label}
                          className={`flex h-4 w-4 items-center justify-center rounded-full ${check.ok ? "bg-raised text-dim" : "bg-down-soft text-down"}`}
                        >
                          {check.ok ? <Check size={9} strokeWidth={3} aria-hidden="true" /> : <X size={9} strokeWidth={3} aria-hidden="true" />}
                          <span className="sr-only">{`${check.ok ? "Pass" : "Fail"}: ${check.label}`}</span>
                        </span>
                      ))}
                      <span className="tnum ml-1 font-mono text-[11px] text-faint">{`${passed}/${row.checks.length}`}</span>
                    </span>
                  </td>
                  <td className="tnum px-3 font-mono text-[11px] whitespace-nowrap text-dim">
                    {row.atMs !== null ? formatUtcTime(new Date(row.atMs).toISOString()) : "Not recorded"}
                  </td>
                  <td className="px-3 text-xs">
                    <span className="flex items-center gap-2">
                      {row.receiptId ? (
                        <Link href={receiptHref(row.receiptId)} className="focus-ring inline-flex items-center gap-1 rounded-sm text-ink hover:text-brand">
                          Receipt
                          <ArrowUpRight size={11} aria-hidden="true" />
                        </Link>
                      ) : (
                        <span className="text-faint">
                          <Minus size={11} aria-hidden="true" className="inline" /> no receipt
                        </span>
                      )}
                      {row.positionId ? (
                        <Link href={positionHref(row.positionId)} className="focus-ring rounded-sm text-dim hover:text-ink">
                          Position
                        </Link>
                      ) : null}
                      <ProvenanceChip provenance="OBSERVED" source="Connected chain account state" compact />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Exceptions                                                          */
/* ------------------------------------------------------------------ */

export function ExceptionsList({ rows, nowMs }: { rows: SettlementException[]; nowMs: number }) {
  if (rows.length === 0) {
    return <EmptyTab title="No exception in this view">Missing fixings, open elections and claims, paused series and reconciliation breaks land here.</EmptyTab>;
  }
  return (
    <ul className="divide-y divide-line-soft">
      {rows.map((row) => (
        <li
          key={row.id}
          className={`grid gap-x-4 gap-y-2 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_150px] lg:px-4 ${
            row.severity === "CRITICAL" ? "shadow-[inset_2px_0_0_var(--color-down)]" : row.severity === "ACTION" ? "shadow-[inset_2px_0_0_var(--color-brand)]" : ""
          }`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityChip severity={row.severity} />
              <span className="text-[13px] text-ink">{row.title}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-faint">{row.detail}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Next action</p>
            <p className="mt-0.5 text-xs leading-relaxed text-dim">{row.nextAction}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-off">
              <ProvenanceChip provenance={row.provenance} source={row.source} compact />
              {row.origin ? <OriginChip origin={row.origin} /> : null}
              <span className="truncate">{row.source}</span>
              {row.atMs !== null ? (
                <span className="tnum font-mono">{row.atMs > nowMs ? `· in ${formatCountdownMs(row.atMs - nowMs)}` : `· ${formatUtcShort(row.atMs)}`}</span>
              ) : null}
            </p>
          </div>
          {row.href ? (
            <div className="flex items-start lg:justify-end">
              <Link href={row.href} className={BUTTON_QUIET}>
                {row.hrefLabel ?? "Open"}
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
