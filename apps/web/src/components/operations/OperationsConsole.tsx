"use client";

import { useEffect, useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { Chip, DeskTabs, TabBody, deskMotion } from "@/components/strategies/desk/Desk";
import { OPERATIONS_FIXTURE } from "@/lib/operations/fixture";
import type {
  KillSwitch,
  OperationsEnvironment,
  OperationsJournalEntry,
  OperationsSnapshot,
} from "@/lib/operations/types";
import { DetailPane, Journal, PolicyBoundary, RuntimeStatus, WritePolicies } from "./OpsPanels";
import { RecoveryBoard } from "./OpsRecovery";
import { AlertTable, DependencyTable, IndexerTable, PolicyTable, QueueTable } from "./OpsTables";
import { OpsTiles } from "./OpsTiles";
import type { Detail, DevnetStatus, ViewId } from "./ops-model";
import { ChainIcon } from "@/components/icons/AssetIcon";

export function OperationsConsole() {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(OPERATIONS_FIXTURE);
  const [devnetStatus, setDevnetStatus] = useState<DevnetStatus | null>(null);
  const [view, setView] = useState<ViewId>("OVERVIEW");
  const [environment, setEnvironment] = useState<OperationsEnvironment>("ARBITRUM_SEPOLIA");
  const [detail, setDetail] = useState<Detail | null>(null);
  const policy = snapshot.writePolicies.find((item) => item.environment === environment) ?? snapshot.writePolicies[0];

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/internal/devnet/status", { cache: "no-store" });
        if (!response.ok) throw new Error("DEVNET_STATUS_UNAVAILABLE");
        const next = (await response.json()) as DevnetStatus;
        if (active) setDevnetStatus(next);
      } catch {
        if (active) setDevnetStatus(null);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const appendJournal = (entry: Omit<OperationsJournalEntry, "id">) => {
    setSnapshot((current) => ({ ...current, journal: [{ ...entry, id: `LOCAL-${current.journal.length + 1}` }, ...current.journal] }));
  };

  const acknowledge = (id: string) => {
    setSnapshot((current) => ({
      ...current,
      alerts: current.alerts.map((alert) =>
        alert.id === id && alert.state === "OPEN" ? { ...alert, state: "ACKNOWLEDGED", acknowledgedAt: "Local fixture action" } : alert,
      ),
    }));
    appendJournal({
      at: "Local fixture action",
      actor: "console-operator",
      subject: id,
      action: "Acknowledged alert",
      detail: "Acknowledgment is stored only in browser state. No runtime call was made.",
      evidence: "FIXTURE",
    });
  };

  const resolve = (id: string) => {
    setSnapshot((current) => ({
      ...current,
      alerts: current.alerts.map((alert) =>
        alert.id === id && alert.state !== "RESOLVED" ? { ...alert, state: "RESOLVED", resolvedAt: "Local fixture action" } : alert,
      ),
    }));
    appendJournal({
      at: "Local fixture action",
      actor: "console-operator",
      subject: id,
      action: "Resolved alert",
      detail: "Resolution is stored only in browser state. No runtime call was made.",
      evidence: "FIXTURE",
    });
  };

  const toggleSwitch = (item: KillSwitch) => {
    const next = item.state === "ARMED" ? "STOPPED" : "ARMED";
    setSnapshot((current) => ({
      ...current,
      killSwitches: current.killSwitches.map((switchItem) =>
        switchItem.id === item.id
          ? { ...switchItem, state: next, changedAt: "Local fixture action", actor: "console-operator", evidence: "FIXTURE" }
          : switchItem,
      ),
    }));
    appendJournal({
      at: "Local fixture action",
      actor: "console-operator",
      subject: item.label,
      action: next === "STOPPED" ? "Staged stop" : "Re-armed locally",
      detail: `${next === "STOPPED" ? item.stops : "New risk may be admitted in the local fixture"}. Terminal resolution remains permitted. No runtime call was made.`,
      evidence: "FIXTURE",
    });
  };

  const openAlerts = snapshot.alerts.filter((alert) => alert.state === "OPEN").length;
  const delayedJobs = snapshot.jobQueues.reduce((sum, queue) => sum + queue.delayed, 0);
  const activeCases = snapshot.recoveryCases.filter((item) => item.state !== "RESOLVED").length;
  const stopped = snapshot.killSwitches.filter((item) => item.state === "STOPPED").length;
  const views = [
    { id: "OVERVIEW", label: "Overview" },
    { id: "QUEUES", label: "Queues", badge: delayedJobs, badgeTone: "brand" as const },
    { id: "RECOVERY", label: "Recovery", badge: activeCases, badgeTone: "brand" as const },
    { id: "POLICY", label: "Policy", badge: stopped, badgeTone: "down" as const },
    { id: "ALERTS", label: "Alerts", badge: openAlerts, badgeTone: "down" as const },
  ];

  const selectView = (next: ViewId) => {
    setView(next);
  };

  return (
    <main className="scroll-thin flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-app p-1">
      <header className={`${deskMotion.rise} shrink-0 rounded-lg border border-line bg-panel`}>
        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 font-serif text-[22px] leading-7 text-ink">Operations</h1>
            <span className="hidden truncate text-xs text-faint sm:inline">Internal control plane</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Chip title={snapshot.captureLabel}>Browser fixture</Chip>
            <span className="tnum truncate font-mono text-[11px] text-faint">{snapshot.captureLabel}</span>
          </div>
          <div className="flex items-center gap-2 lg:ml-auto">
            <label className="sr-only" htmlFor="operations-environment">
              Operations environment
            </label>
            <span className="relative">
              <select
                id="operations-environment"
                value={environment}
                onChange={(event) => setEnvironment(event.target.value as OperationsEnvironment)}
                className="focus-ring h-8 appearance-none rounded-md border border-line bg-raised py-0 pr-8 pl-8 text-xs text-dim transition-colors hover:border-line-strong"
              >
                <option value="ARBITRUM_SEPOLIA">Arbitrum Sepolia</option>
                <option value="ARBITRUM_ONE">Arbitrum One</option>
              </select>
              <ChainIcon size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
              <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-faint" />
            </span>
            <span
              className={`flex h-8 items-center rounded-md border px-2.5 text-xs transition-colors duration-200 ${
                policy.writesAllowed ? "border-brand-edge/60 bg-brand-soft text-brand" : "border-down/40 bg-down-soft text-down"
              }`}
            >
              {policy.writesAllowed ? "Testnet policy" : "No mainnet writes"}
            </span>
          </div>
        </div>
        <div className="border-t border-line">
          <DeskTabs
            idBase="operations-view"
            items={views}
            value={view}
            onChange={(id) => selectView(id as ViewId)}
            className="h-10"
          />
        </div>
      </header>

      <div className={`${deskMotion.rise} flex shrink-0 items-start gap-2 rounded-lg border border-line bg-inset px-3 py-2 text-xs leading-relaxed text-dim`}>
        <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
        <span>
          Evidence and freshness labels describe a recorded development fixture. New-risk controls never block terminal
          completion, unwind, collateral release, or evidence publication.
        </span>
      </div>

      <OpsTiles snapshot={snapshot} status={devnetStatus} policy={policy} onView={selectView} />

      <div className="grid min-w-0 gap-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <TabBody key={view} idBase="operations-view" className="flex min-w-0 flex-col gap-1">
          {view === "OVERVIEW" ? (
            <>
              <RuntimeStatus status={devnetStatus} />
              <DependencyTable snapshot={snapshot} detail={detail} onSelect={setDetail} />
              <div className="grid min-w-0 gap-1 2xl:grid-cols-2">
                <IndexerTable snapshot={snapshot} />
                <AlertTable
                  snapshot={snapshot}
                  detail={detail}
                  onSelect={setDetail}
                  onAcknowledge={acknowledge}
                  onResolve={resolve}
                  compact
                />
              </div>
            </>
          ) : null}
          {view === "QUEUES" ? (
            <>
              <QueueTable snapshot={snapshot} detail={detail} onSelect={setDetail} />
              <IndexerTable snapshot={snapshot} />
            </>
          ) : null}
          {view === "RECOVERY" ? (
            <>
              <RecoveryBoard snapshot={snapshot} detail={detail} onSelect={setDetail} />
              <Journal
                title="Recovery timeline"
                entries={snapshot.journal.filter((entry) => entry.subject.startsWith("RCV"))}
              />
            </>
          ) : null}
          {view === "POLICY" ? (
            <>
              <PolicyTable snapshot={snapshot} detail={detail} onSelect={setDetail} onToggle={toggleSwitch} />
              <WritePolicies policies={snapshot.writePolicies} active={environment} />
              <Journal
                title="Policy journal"
                entries={snapshot.journal.filter((entry) => entry.actor === "risk-policy" || entry.actor === "console-operator")}
              />
            </>
          ) : null}
          {view === "ALERTS" ? (
            <>
              <AlertTable
                snapshot={snapshot}
                detail={detail}
                onSelect={setDetail}
                onAcknowledge={acknowledge}
                onResolve={resolve}
              />
              <Journal title="Alert timeline" entries={snapshot.journal.filter((entry) => entry.subject.startsWith("ALT"))} />
            </>
          ) : null}
        </TabBody>

        <aside className="flex min-w-0 flex-col gap-1">
          <PolicyBoundary policy={policy} />
          <DetailPane snapshot={snapshot} detail={detail} />
          {view !== "ALERTS" && view !== "POLICY" ? <Journal entries={snapshot.journal} title="Incident timeline" /> : null}
        </aside>
      </div>
    </main>
  );
}
