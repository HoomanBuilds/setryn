"use client";

import { useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import { ChainIcon } from "@/components/icons/AssetIcon";
import { Chip, DeskTabs, TabBody, deskMotion } from "@/components/strategies/desk/Desk";
import { NETWORK_OPERATOR_LABEL } from "@/lib/operations/deployment";
import { networkOfInput, terminalRows, upcomingEvents, writePolicies } from "@/lib/operations/model";
import type { OperationalAlert } from "@/lib/operations/types";
import { DetailPane, FeePanel, Journal, PolicyBoundary, RuntimeStatus, SignerPanel, WritePolicies } from "./OpsPanels";
import { TerminalBoard } from "./OpsRecovery";
import { AlertTable, ContractTable, DependencyTable, EventTable, SeriesTable } from "./OpsTables";
import { OpsTiles } from "./OpsTiles";
import type { Detail, ViewId } from "./ops-model";
import { useOperationsView } from "./useOperations";

export function OperationsConsole() {
  const { input, rows, alerts: liveAlerts, dependencies, journal } = useOperationsView();
  const [view, setView] = useState<ViewId>("OVERVIEW");
  const [detail, setDetail] = useState<Detail | null>(null);
  // Acknowledgments are this browser's own notes; an alert clears only when its check passes.
  const [acknowledged, setAcknowledged] = useState<Record<string, string>>({});

  const network = networkOfInput(input);
  const policies = useMemo(() => writePolicies(network), [network]);
  const policy = policies.find((item) => (network === "local" ? item.environment === "LOCAL" : network === "arbitrum-sepolia" ? item.environment === "ARBITRUM_SEPOLIA" : item.environment === "ARBITRUM_ONE")) ?? policies[0];
  const activeEnvironment = network === "local" ? "LOCAL" : network === "arbitrum-sepolia" ? "ARBITRUM_SEPOLIA" : network === "arbitrum-one" ? "ARBITRUM_ONE" : null;
  const alerts = useMemo<OperationalAlert[]>(
    () => liveAlerts.map((alert) => (acknowledged[alert.id] ? { ...alert, state: "ACKNOWLEDGED", acknowledgedAt: acknowledged[alert.id] } : alert)),
    [acknowledged, liveAlerts],
  );
  const events = useMemo(() => upcomingEvents(rows, input.now), [input.now, rows]);
  const terminal = useMemo(() => terminalRows(rows), [rows]);
  const scheduled = rows.some((row) => row.schedule.source !== "EXPIRY_RULE");
  const status = input.status.data;
  const fees = input.feed?.fees ?? null;

  const acknowledge = (id: string) => setAcknowledged((current) => ({ ...current, [id]: `${new Date(input.now * 1000).toISOString().slice(11, 19)} UTC` }));

  const openAlerts = alerts.filter((alert) => alert.state === "OPEN").length;
  const views = [
    { id: "OVERVIEW", label: "Overview" },
    { id: "SERIES", label: "Series", badge: rows.length },
    { id: "SCHEDULE", label: "Schedule", badge: events.filter((event) => event.at - input.now < 86_400).length || undefined, badgeTone: "brand" as const },
    { id: "TERMINAL", label: "Terminal", badge: terminal.length || undefined, badgeTone: "brand" as const },
    { id: "CONTRACTS", label: "Contracts" },
    { id: "POLICY", label: "Policy" },
    { id: "ALERTS", label: "Alerts", badge: openAlerts || undefined, badgeTone: "down" as const },
  ];

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Operations</h1>
            <span className="hidden truncate text-xs text-faint sm:inline">Deployment, schedule and signer status</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Chip tone={status?.healthy ? "up" : status ? "down" : "dim"} dot>
              {status?.healthy ? "Chain live" : status?.chainUnavailable ? "Chain not answering" : status ? "Degraded" : "Connecting"}
            </Chip>
            <span className="tnum truncate font-mono text-[11px] text-faint">
              {status?.checkedAt ? `Checked ${status.checkedAt.slice(11, 19)} UTC` : input.status.error ? "Operator status unavailable" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2 lg:ml-auto">
            <span className="flex h-8 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-xs text-dim">
              <ChainIcon size={15} />
              {network ? `${NETWORK_OPERATOR_LABEL[network]} · ${status?.chainId ?? input.runtime.data?.chainId ?? "-"}` : "Network unknown"}
            </span>
            <span
              className={`flex h-8 items-center rounded-md border px-2.5 text-xs transition-colors duration-200 ${
                policy.writesAllowed ? "border-brand-edge/60 bg-brand-soft text-brand" : "border-down/40 bg-down-soft text-down"
              }`}
            >
              {policy.writesAllowed ? policy.policyLabel : "No mainnet writes"}
            </span>
          </div>
        </div>
        <div className="border-t border-line">
          <DeskTabs idBase="operations-view" items={views} value={view} onChange={(id) => setView(id as ViewId)} className="h-10" />
        </div>
      </header>

      <div className={`${deskMotion.rise} flex shrink-0 items-start gap-2 rounded-lg border border-line bg-inset px-3 py-2 text-xs leading-relaxed text-dim`}>
        <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
        <span>
          Every figure is read from the runtime file, the chain and the market-data feed as this page polls. New-risk
          controls never block terminal completion, unwind, collateral release or evidence publication.
        </span>
      </div>

      <OpsTiles
        status={status}
        evidence={input.evidence.data}
        dependencies={dependencies}
        rows={rows}
        nextEvent={events[0] ?? null}
        alerts={alerts}
        fees={fees}
        policy={policy}
        now={input.now}
        onView={setView}
      />

      <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <TabBody key={view} idBase="operations-view" className="flex min-w-0 flex-col gap-1">
          {view === "OVERVIEW" ? (
            <>
              <RuntimeStatus status={input.status} runtime={input.runtime.data} evidence={input.evidence.data} />
              <DependencyTable rows={dependencies} detail={detail} onSelect={setDetail} />
              <div className="grid min-w-0 gap-1 2xl:grid-cols-2">
                <SeriesTable rows={rows} now={input.now} detail={detail} onSelect={setDetail} compact />
                <AlertTable alerts={alerts} detail={detail} onSelect={setDetail} onAcknowledge={acknowledge} compact />
              </div>
            </>
          ) : null}
          {view === "SERIES" ? <SeriesTable rows={rows} now={input.now} detail={detail} onSelect={setDetail} /> : null}
          {view === "SCHEDULE" ? (
            <>
              <EventTable events={events} now={input.now} scheduled={scheduled} onSelect={setDetail} />
              <SessionDays sessionDaysPath={input.runtime.data?.sessionDaysPath ?? null} />
            </>
          ) : null}
          {view === "TERMINAL" ? <TerminalBoard rows={terminal} now={input.now} detail={detail} onSelect={setDetail} /> : null}
          {view === "CONTRACTS" ? (
            <ContractTable runtime={input.runtime.data} evidence={input.evidence.data} detail={detail} onSelect={setDetail} />
          ) : null}
          {view === "POLICY" ? (
            <>
              <SignerPanel status={input.status} runtime={input.runtime.data} />
              <WritePolicies policies={policies} active={activeEnvironment} />
              <Journal entries={journal.entries} error={journal.error} limit={12} />
            </>
          ) : null}
          {view === "ALERTS" ? <AlertTable alerts={alerts} detail={detail} onSelect={setDetail} onAcknowledge={acknowledge} /> : null}
        </TabBody>

        <aside className="flex min-w-0 flex-col gap-1">
          <PolicyBoundary policy={policy} />
          <DetailPane detail={detail} dependencies={dependencies} rows={rows} alerts={alerts} evidence={input.evidence.data} now={input.now} />
          <FeePanel fees={fees} feeChanges={status?.feeChanges ?? null} />
          {view !== "POLICY" ? <Journal entries={journal.entries} error={journal.error} /> : null}
        </aside>
      </div>
    </main>
  );
}

function SessionDays({ sessionDaysPath }: { sessionDaysPath: string | null }) {
  return (
    <div className={`${deskMotion.rise} rounded-lg border border-line bg-panel px-3 py-2.5 text-xs leading-relaxed text-dim`}>
      <span className="text-ink">Session days. </span>
      {sessionDaysPath
        ? `The bootstrap wrote session-day proofs to ${sessionDaysPath}. The keeper publishes any missing day from today to today + 3 through TradingSessionPolicy.publishSessionDay; anyone can. Published coverage is not exposed to the web app yet.`
        : "This runtime does not reference a session-day proofs file, so session coverage is not reported."}
    </div>
  );
}
