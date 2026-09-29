"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Wallet } from "lucide-react";
import { BUTTON_INK, EnvironmentChip, formatUtcTime, useWalletPrompt } from "@/components/activity/ledger-ui";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { usePreviewBoard } from "@/components/terminal/PreviewMarketProvider";
import { DeskTabs, Panel, TabBody, type DeskTab } from "@/components/strategies/desk/Desk";
import { LIFECYCLE_STRATEGIES } from "@/lib/lifecycle/fixtures";
import { formatCountdownMs, formatUtcShort } from "@/lib/settlements/calendar";
import { settlementCenter } from "@/lib/settlements/center";
import type { Provenance } from "@/lib/terminal/types";
import { formatNumber } from "@/lib/terminal/format";
import { BoundaryCalendar } from "./BoundaryCalendar";
import { SettlementPipeline } from "./SettlementPipeline";
import {
  ConnectPrompt,
  ExceptionsList,
  ObservationsTable,
  PayoutsTable,
  ReconciliationTable,
  UpcomingTable,
} from "./SettlementTables";
import { ProvenanceChip } from "./trust";

type SettlementTab = "upcoming" | "observations" | "payouts" | "reconciliation" | "exceptions";

const TABS: readonly SettlementTab[] = ["upcoming", "observations", "payouts", "reconciliation", "exceptions"];

function isTab(value: string | null): value is SettlementTab {
  return value !== null && (TABS as readonly string[]).includes(value);
}

function signedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value), 0)} USDC`;
}

function tone(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-ink";
}

function Kpi({
  label,
  value,
  note,
  provenance,
  source,
  valueTone = "text-ink",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  provenance?: Provenance;
  source?: string;
  valueTone?: string;
}) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2.5 lg:px-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-faint">{label}</span>
        {provenance ? <ProvenanceChip provenance={provenance} source={source} compact /> : null}
      </div>
      <div className={`tnum mt-1 truncate font-mono text-[15px] leading-5 ${valueTone}`}>{value}</div>
      {note ? <div className="mt-0.5 truncate text-[11px] text-off">{note}</div> : null}
    </div>
  );
}

function Pills<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string; count?: number }[];
}) {
  return (
    <span role="radiogroup" aria-label={label} className="flex rounded-md border border-line bg-inset p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`focus-ring inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2 text-[11px] whitespace-nowrap transition-colors ${
            value === option.id ? "bg-raised text-ink" : "text-faint hover:text-dim"
          }`}
        >
          {option.label}
          {option.count !== undefined ? <span className="tnum font-mono text-[10.5px] text-faint">{option.count}</span> : null}
        </button>
      ))}
    </span>
  );
}

/**
 * `/settlements`: the fixing schedule, the observations behind each fixing,
 * payouts, cross-record reconciliation and exceptions, for the connected
 * account and the static reference book, on the shared feed clock.
 */
export function SettlementsWorkspace() {
  const snapshot = useGatewaySnapshot();
  const wallet = useWalletPrompt();
  const { markets, previewEpochSeconds } = usePreviewBoard();
  const nowMs = previewEpochSeconds * 1000;
  const center = useMemo(
    () => settlementCenter({ snapshot, markets, references: LIFECYCLE_STRATEGIES, nowMs }),
    [snapshot, markets, nowMs],
  );

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: SettlementTab = isTab(requested) ? requested : "upcoming";
  const setTab = (next: SettlementTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "upcoming") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [upcomingScope, setUpcomingScope] = useState<"ALL" | "HELD">("ALL");
  const [observationScope, setObservationScope] = useState<"HELD" | "ALL">("HELD");
  const [exceptionScope, setExceptionScope] = useState<"ACTION" | "ALL">("ACTION");

  const upcoming = center.boundaries.filter((row) => row.state !== "PASSED");
  const upcomingHeld = upcoming.filter((row) => row.held.length > 0);
  const upcomingRows = upcomingScope === "HELD" ? upcomingHeld : upcoming;
  const heldGroups = center.observations.filter((group) => group.held.length > 0);
  const observationRows = observationScope === "HELD" ? heldGroups : center.observations;
  const actionable = center.exceptions.filter((row) => row.severity !== "NOTICE");
  const exceptionRows = exceptionScope === "ACTION" ? actionable : center.exceptions;
  const { kpis } = center;

  const tabs: DeskTab[] = [
    { id: "upcoming", label: "Upcoming fixings", badge: upcoming.filter((row) => row.kind === "FIXING").length },
    { id: "observations", label: "Observations", badge: heldGroups.length },
    { id: "payouts", label: "Payouts", badge: center.payouts.length },
    { id: "reconciliation", label: "Reconciliation", badge: center.accountConnected ? center.reconciliation.length : undefined },
    {
      id: "exceptions",
      label: "Exceptions",
      badge: actionable.length,
      badgeTone: kpis.exceptionCounts.CRITICAL > 0 ? "down" : actionable.length > 0 ? "brand" : "neutral",
    },
  ];

  const next = kpis.nextHeldFixing ?? kpis.nextFixing;
  const connectLabel = wallet.connecting
    ? "Connecting..."
    : snapshot.wallet.status === "WRONG_NETWORK"
      ? "Switch network"
      : "Connect wallet";
  const nextRemaining = next?.atMs != null ? next.atMs - nowMs : null;

  let tools: ReactNode = null;
  if (tab === "upcoming") {
    tools = (
      <Pills
        label="Upcoming scope"
        value={upcomingScope}
        onChange={setUpcomingScope}
        options={[
          { id: "ALL", label: "All listed", count: upcoming.length },
          { id: "HELD", label: "Held", count: upcomingHeld.length },
        ]}
      />
    );
  } else if (tab === "observations") {
    tools = (
      <Pills
        label="Observation scope"
        value={observationScope}
        onChange={setObservationScope}
        options={[
          { id: "HELD", label: "Held series", count: heldGroups.length },
          { id: "ALL", label: "All listed", count: center.observations.length },
        ]}
      />
    );
  } else if (tab === "exceptions") {
    tools = (
      <Pills
        label="Exception scope"
        value={exceptionScope}
        onChange={setExceptionScope}
        options={[
          { id: "ACTION", label: "Needs action", count: actionable.length },
          { id: "ALL", label: "All", count: center.exceptions.length },
        ]}
      />
    );
  }

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-1">
        <Panel label="Settlement center summary">
          <div className="flex flex-col gap-3 px-3 pt-3.5 pb-3 lg:flex-row lg:items-end lg:justify-between lg:px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
                <CalendarRange size={11} aria-hidden="true" />
                Lifecycle and settlement center
              </div>
              <h1 className="mt-1 font-serif text-[28px] leading-8 font-normal tracking-[-0.01em] text-ink lg:text-[30px]">Settlements</h1>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-dim">
                Fixing schedule, the observations behind each fixing, payouts, reconciliation and exceptions. Scheduled values stay labeled as modeled until a fixing record is observed.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <span
                title="All countdowns run on the shared preview feed clock"
                className="inline-flex h-7 items-center gap-2 rounded-md border border-line px-2.5 text-xs text-dim"
              >
                <span aria-hidden="true" className="live-dot relative h-[6px] w-[6px] rounded-full bg-up text-up" />
                <span className="text-faint">Feed clock</span>
                <span className="tnum font-mono text-ink">{`${formatUtcTime(new Date(nowMs).toISOString())} UTC`}</span>
              </span>
              <EnvironmentChip />
              {center.accountConnected ? null : (
                <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className={`${BUTTON_INK} h-7`}>
                  <Wallet size={12} aria-hidden="true" />
                  {connectLabel}
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label={kpis.nextHeldFixing ? "Next held fixing" : "Next fixing"}
              value={nextRemaining !== null ? (nextRemaining > 0 ? formatCountdownMs(nextRemaining) : "now") : "None"}
              valueTone={nextRemaining !== null && nextRemaining < 7 * 86_400_000 ? "text-brand" : "text-ink"}
              note={next?.atMs != null ? `${next.market.code} · ${formatUtcShort(next.atMs)}` : undefined}
              provenance="MODELED"
              source="Scheduled from series terms"
            />
            <Kpi
              label="Held series"
              value={`${kpis.heldSeries}`}
              note={`${center.accountPositions} account · ${center.referencePositions} reference · ${kpis.heldWithin30d} fix in 30d`}
            />
            <Kpi
              label="Account payout at mark"
              value={kpis.projectedAccount === null ? "Not connected" : signedUsd(kpis.projectedAccount)}
              valueTone={kpis.projectedAccount === null ? "text-faint" : tone(kpis.projectedAccount)}
              note={`reference book ${signedUsd(kpis.projectedReference)}, modeled`}
              provenance="ESTIMATED"
              source="Entry against the package mark, price term only"
            />
            <Kpi
              label="Realized payouts"
              value={kpis.realized === null ? "Not connected" : signedUsd(kpis.realized)}
              valueTone={kpis.realized === null ? "text-faint" : tone(kpis.realized)}
              note={`${kpis.realizedCount} exit receipt${kpis.realizedCount === 1 ? "" : "s"}`}
              provenance="OBSERVED"
              source="Exit receipts"
            />
            <Kpi
              label="Reconciliation"
              value={center.accountConnected ? `${kpis.reconMatched} / ${kpis.reconTotal}` : "Not connected"}
              valueTone={!center.accountConnected ? "text-faint" : kpis.reconMismatch > 0 ? "text-down" : "text-ink"}
              note={center.accountConnected ? `${kpis.reconMismatch} mismatch${kpis.reconMismatch === 1 ? "" : "es"}` : "account records only"}
              provenance="OBSERVED"
              source="Connected chain account state"
            />
            <Kpi
              label="Open exceptions"
              value={`${kpis.exceptionCounts.CRITICAL + kpis.exceptionCounts.ACTION}`}
              valueTone={kpis.exceptionCounts.CRITICAL > 0 ? "text-down" : kpis.exceptionCounts.ACTION > 0 ? "text-brand" : "text-ink"}
              note={`${kpis.exceptionCounts.CRITICAL} critical · ${kpis.exceptionCounts.NOTICE} notices`}
            />
          </div>
        </Panel>

        <div className="grid gap-1 xl:grid-cols-[minmax(0,1fr)_320px]">
          <BoundaryCalendar center={center} selectedId={selectedId} onSelect={setSelectedId} />
          <SettlementPipeline center={center} />
        </div>

        <Panel label="Settlement records" delay={120}>
          <div className="flex min-h-10 shrink-0 flex-col border-b border-line sm:flex-row sm:items-stretch">
            <div className="flex h-10 min-w-0 items-stretch">
              <DeskTabs items={tabs} value={tab} onChange={(id) => setTab(id as SettlementTab)} idBase="settlements" />
            </div>
            {tools ? <div className="flex items-center px-3 pb-2 sm:ml-auto sm:pb-0">{tools}</div> : null}
          </div>
          <TabBody idBase="settlements" key={tab}>
            {tab === "upcoming" ? (
              <UpcomingTable rows={upcomingRows} nowMs={nowMs} selectedId={selectedId} onSelect={setSelectedId} />
            ) : null}
            {tab === "observations" ? <ObservationsTable groups={observationRows} nowMs={nowMs} /> : null}
            {tab === "payouts" ? (
              <>
                {center.accountConnected ? null : (
                  <ConnectPrompt
                    compact
                    title="Account payouts need a connected wallet."
                    detail="The reference book below is modeled from static lifecycle records."
                    connecting={wallet.connecting}
                    label={connectLabel}
                    error={wallet.error}
                    onConnect={wallet.connect}
                  />
                )}
                <PayoutsTable rows={center.payouts} nowMs={nowMs} />
              </>
            ) : null}
            {tab === "reconciliation" ? (
              center.accountConnected ? (
                <ReconciliationTable rows={center.reconciliation} />
              ) : (
                <ConnectPrompt
                  title="Connect a wallet to reconcile account records."
                  detail="Positions, fills, receipts, orders and RFQs are cross-checked against the connected chain state. Reference records carry no evidence to reconcile."
                  connecting={wallet.connecting}
                  label={connectLabel}
                  error={wallet.error}
                  onConnect={wallet.connect}
                />
              )
            ) : null}
            {tab === "exceptions" ? <ExceptionsList rows={exceptionRows} nowMs={nowMs} /> : null}
          </TabBody>
        </Panel>
      </div>
    </main>
  );
}
