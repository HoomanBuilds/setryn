"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { MetaLine, SectionLabel, StatusDot, Tabs } from "@/components/terminal/primitives";
import { OPERATIONS_FIXTURE } from "@/lib/operations/fixture";
import type {
  AlertSeverity,
  AlertState,
  EvidenceKind,
  HealthState,
  KillSwitch,
  OperationsEnvironment,
  OperationsJournalEntry,
  OperationsSnapshot,
} from "@/lib/operations/types";

type ViewId = "OVERVIEW" | "QUEUES" | "RECOVERY" | "POLICY" | "ALERTS";
interface DevnetStatus {
  environment: "LOCAL_DEVNET";
  chainId: number;
  blockNumber: string;
  checkedAt: string;
  healthy: boolean;
  contracts: { label: string; address: string; healthy: boolean }[];
}
type Detail =
  | { kind: "DEPENDENCY"; id: string }
  | { kind: "QUEUE"; id: string }
  | { kind: "RECOVERY"; id: string }
  | { kind: "ALERT"; id: string }
  | { kind: "POLICY"; id: string };

const VIEWS = [
  { id: "OVERVIEW", label: "Overview" },
  { id: "QUEUES", label: "Queues" },
  { id: "RECOVERY", label: "Recovery" },
  { id: "POLICY", label: "Policy" },
  { id: "ALERTS", label: "Alerts" },
];

function stateClass(state: HealthState | AlertSeverity | AlertState | "ARMED" | "STOPPED"): string {
  if (state === "HEALTHY" || state === "RESOLVED" || state === "ARMED" || state === "NOTICE") {
    return "text-up";
  }
  if (state === "DEGRADED" || state === "WARNING" || state === "ACKNOWLEDGED") return "text-brand";
  return "text-down";
}

function stateLabel(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Evidence({ value }: { value: EvidenceKind }) {
  return <span className="font-mono text-xs text-faint">{value.toLowerCase()}</span>;
}

function Surface({
  label,
  children,
  action,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 border border-line bg-panel ${className}`}>
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-3 py-2">
        <SectionLabel>{label}</SectionLabel>
        {action}
      </div>
      {children}
    </section>
  );
}

function RowButton({
  children,
  onClick,
  selected,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  selected?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring w-full text-left transition-colors hover:bg-raised ${selected ? "bg-raised" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

function StateMark({ state }: { state: HealthState | AlertSeverity | AlertState | "ARMED" | "STOPPED" }) {
  const ok = state === "HEALTHY" || state === "RESOLVED" || state === "ARMED" || state === "NOTICE";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${stateClass(state)}`}>
      <StatusDot ok={ok} />
      {stateLabel(state)}
    </span>
  );
}

function PolicyBoundary({ policy }: { policy: OperationsSnapshot["writePolicies"][number] }) {
  return (
    <Surface
      label="Environment write boundary"
      action={<Evidence value={policy.evidence} />}
    >
      <div className="px-3 py-3">
        <div className="flex items-start gap-2.5">
          <LockKeyhole size={15} aria-hidden="true" className={policy.writesAllowed ? "mt-0.5 text-brand" : "mt-0.5 text-down"} />
          <div className="min-w-0">
            <p className="text-sm text-ink">{policy.label}</p>
            <p className={`mt-0.5 text-xs ${policy.writesAllowed ? "text-brand" : "text-down"}`}>{policy.policyLabel}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-dim">{policy.detail}</p>
        <div className="mt-3 border-t border-line pt-2.5 text-xs leading-relaxed text-faint">
          This screen is a browser fixture. It never invokes an operator runtime, wallet, RPC write, or mainnet deployment action.
        </div>
      </div>
    </Surface>
  );
}

function RuntimeStatus({ status }: { status: DevnetStatus | null }) {
  return (
    <Surface
      label="Connected devnet runtime"
      action={<span className="text-xs text-faint">{status ? `block ${status.blockNumber}` : "connecting"}</span>}
    >
      {status ? (
        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
          <div className="px-3 py-3"><p className="text-xs text-faint">Runtime</p><p className={`mt-1 text-sm ${status.healthy ? "text-up" : "text-down"}`}>{status.healthy ? "Healthy" : "Degraded"}</p></div>
          <div className="px-3 py-3"><p className="text-xs text-faint">Chain</p><p className="mt-1 font-mono text-sm text-ink">Local {status.chainId}</p></div>
          <div className="px-3 py-3"><p className="text-xs text-faint">Contracts</p><p className="mt-1 font-mono text-sm text-ink">{status.contracts.filter((item) => item.healthy).length}/{status.contracts.length}</p></div>
          <div className="px-3 py-3"><p className="text-xs text-faint">Evidence</p><p className="mt-1 text-sm text-ink">Live RPC</p></div>
        </div>
      ) : (
        <div className="px-3 py-4 text-xs text-dim">Waiting for the local protocol runtime.</div>
      )}
    </Surface>
  );
}

function DependencyTable({
  snapshot,
  detail,
  onSelect,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  return (
    <Surface label="Dependency health" action={<span className="text-xs text-faint">Recorded snapshot</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="border-b border-line text-xs text-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Dependency</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Checkpoint</th>
              <th className="px-3 py-2 text-right font-medium">Freshness</th>
              <th className="px-3 py-2 text-right font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {snapshot.dependencies.map((dependency) => (
              <tr key={dependency.id}>
                <td colSpan={5} className="p-0">
                  <RowButton
                    onClick={() => onSelect({ kind: "DEPENDENCY", id: dependency.id })}
                    selected={detail?.kind === "DEPENDENCY" && detail.id === dependency.id}
                    className="grid grid-cols-[minmax(240px,1.45fr)_120px_minmax(180px,1fr)_130px_80px] items-center"
                  >
                    <span className="min-w-0 px-3 py-2.5">
                      <span className="block truncate text-sm text-ink">{dependency.label}</span>
                      <span className="block truncate text-xs text-faint">{dependency.service}</span>
                    </span>
                    <span className="px-3 py-2.5"><StateMark state={dependency.state} /></span>
                    <span className="px-3 py-2.5 font-mono text-xs text-dim">{dependency.checkpoint}</span>
                    <span className={`px-3 py-2.5 text-right font-mono text-xs ${dependency.freshness.withinThreshold ? "text-dim" : "text-down"}`}>{dependency.freshness.ageLabel}</span>
                    <span className="px-3 py-2.5 text-right"><Evidence value={dependency.evidence} /></span>
                  </RowButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function IndexerTable({ snapshot }: { snapshot: OperationsSnapshot }) {
  return (
    <Surface label="Indexer checkpoints" action={<Database size={14} aria-hidden="true" className="text-faint" />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[580px] border-collapse text-left">
          <thead className="border-b border-line text-xs text-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Stream</th>
              <th className="px-3 py-2 text-right font-medium">Head</th>
              <th className="px-3 py-2 text-right font-medium">Projected</th>
              <th className="px-3 py-2 text-right font-medium">Lag</th>
              <th className="px-3 py-2 text-right font-medium">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {snapshot.indexerStreams.map((stream) => (
              <tr key={stream.id} className="hover:bg-raised">
                <td className="px-3 py-2.5 text-sm text-ink">{stream.label}</td>
                <td className="tnum px-3 py-2.5 text-right font-mono text-xs text-dim">{stream.headBlock.toLocaleString()}</td>
                <td className="tnum px-3 py-2.5 text-right font-mono text-xs text-dim">{stream.projectedBlock.toLocaleString()}</td>
                <td className={`tnum px-3 py-2.5 text-right font-mono text-xs ${stream.lagBlocks <= stream.allowedLagBlocks ? "text-dim" : "text-down"}`}>{stream.lagBlocks} / {stream.allowedLagBlocks}</td>
                <td className="px-3 py-2.5 text-right"><Evidence value={stream.evidence} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function QueueTable({
  snapshot,
  detail,
  onSelect,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  return (
    <Surface label="Operator queues" action={<span className="text-xs text-faint">No external runner connected</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="border-b border-line text-xs text-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Queue</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 text-right font-medium">Queued</th>
              <th className="px-3 py-2 text-right font-medium">Leased</th>
              <th className="px-3 py-2 text-right font-medium">Delayed</th>
              <th className="px-3 py-2 text-right font-medium">Next checkpoint</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {snapshot.jobQueues.map((queue) => (
              <tr key={queue.id}>
                <td colSpan={6} className="p-0">
                  <RowButton
                    onClick={() => onSelect({ kind: "QUEUE", id: queue.id })}
                    selected={detail?.kind === "QUEUE" && detail.id === queue.id}
                    className="grid grid-cols-[minmax(210px,1.5fr)_120px_80px_80px_80px_minmax(160px,1fr)] items-center"
                  >
                    <span className="min-w-0 px-3 py-2.5"><span className="block text-sm text-ink">{queue.label}</span><span className="block font-mono text-xs text-faint">{stateLabel(queue.runner)}</span></span>
                    <span className="px-3 py-2.5"><StateMark state={queue.state} /></span>
                    <span className="tnum px-3 py-2.5 text-right font-mono text-xs text-dim">{queue.queued}</span>
                    <span className="tnum px-3 py-2.5 text-right font-mono text-xs text-dim">{queue.leased}</span>
                    <span className={`tnum px-3 py-2.5 text-right font-mono text-xs ${queue.delayed > 0 ? "text-brand" : "text-dim"}`}>{queue.delayed}</span>
                    <span className="px-3 py-2.5 text-right font-mono text-xs text-dim">{queue.nextCheckpoint}</span>
                  </RowButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function RecoveryTable({
  snapshot,
  detail,
  onSelect,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  return (
    <Surface label="Recovery cases" action={<span className="text-xs text-faint">Terminal paths remain available</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse text-left">
          <thead className="border-b border-line text-xs text-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Case</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Residual</th>
              <th className="px-3 py-2 font-medium">Deadline</th>
              <th className="px-3 py-2 text-right font-medium">New risk</th>
              <th className="px-3 py-2 text-right font-medium">Terminal completion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {snapshot.recoveryCases.map((caseItem) => (
              <tr key={caseItem.id}>
                <td colSpan={6} className="p-0">
                  <RowButton
                    onClick={() => onSelect({ kind: "RECOVERY", id: caseItem.id })}
                    selected={detail?.kind === "RECOVERY" && detail.id === caseItem.id}
                    className="grid grid-cols-[170px_145px_minmax(160px,1fr)_minmax(150px,1fr)_100px_150px] items-center"
                  >
                    <span className="px-3 py-2.5"><span className="block font-mono text-sm text-ink">{caseItem.id}</span><span className="block text-xs text-faint">{caseItem.packageCode}</span></span>
                    <span className="px-3 py-2.5 text-xs text-brand">{stateLabel(caseItem.state)}</span>
                    <span className="px-3 py-2.5 font-mono text-xs text-dim">{caseItem.residual}</span>
                    <span className="px-3 py-2.5 font-mono text-xs text-dim">{caseItem.deadline}</span>
                    <span className={`px-3 py-2.5 text-right text-xs ${caseItem.newRiskBlocked ? "text-down" : "text-dim"}`}>{caseItem.newRiskBlocked ? "Stopped" : "Permitted"}</span>
                    <span className="px-3 py-2.5 text-right text-xs text-up">{caseItem.terminalResolutionPermitted ? "Permitted" : "Unavailable"}</span>
                  </RowButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function AlertTable({
  snapshot,
  detail,
  onSelect,
  onAcknowledge,
  onResolve,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  return (
    <Surface label="Alerts" action={<span className="text-xs text-faint">Journaled fixture actions</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[790px] border-collapse text-left">
          <thead className="border-b border-line text-xs text-faint"><tr><th className="px-3 py-2 font-medium">Alert</th><th className="px-3 py-2 font-medium">State</th><th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 font-medium">Opened</th><th className="px-3 py-2 text-right font-medium">Action</th></tr></thead>
          <tbody className="divide-y divide-line">
            {snapshot.alerts.map((alert) => (
              <tr key={alert.id}>
                <td colSpan={5} className="p-0">
                  <div className="grid grid-cols-[minmax(260px,1.6fr)_130px_minmax(140px,1fr)_110px_180px] items-center">
                    <RowButton onClick={() => onSelect({ kind: "ALERT", id: alert.id })} selected={detail?.kind === "ALERT" && detail.id === alert.id} className="col-span-4 grid grid-cols-subgrid items-center">
                      <span className="min-w-0 px-3 py-2.5"><span className="block truncate text-sm text-ink">{alert.title}</span><span className="block font-mono text-xs text-faint">{alert.id} · {stateLabel(alert.severity)}</span></span>
                      <span className="px-3 py-2.5"><StateMark state={alert.state} /></span>
                      <span className="px-3 py-2.5 text-xs text-dim">{alert.source}</span>
                      <span className="px-3 py-2.5 font-mono text-xs text-dim">{alert.openedAt}</span>
                    </RowButton>
                    <span className="flex items-center justify-end gap-1 px-3 py-2">
                      {alert.state === "OPEN" ? <button type="button" onClick={() => onAcknowledge(alert.id)} className="focus-ring h-8 rounded-md border border-line px-2 text-xs text-dim hover:border-line-strong hover:text-ink">Acknowledge</button> : null}
                      {alert.state !== "RESOLVED" ? <button type="button" onClick={() => onResolve(alert.id)} className="focus-ring h-8 rounded-md border border-line px-2 text-xs text-dim hover:border-line-strong hover:text-ink">Resolve</button> : <Check size={15} aria-label="Resolved" className="text-up" />}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function PolicyTable({
  snapshot,
  detail,
  onSelect,
  onToggle,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
  onToggle: (item: KillSwitch) => void;
}) {
  return (
    <Surface label="Scoped kill switches" action={<span className="text-xs text-faint">Local staging only</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] border-collapse text-left">
          <thead className="border-b border-line text-xs text-faint"><tr><th className="px-3 py-2 font-medium">Scope</th><th className="px-3 py-2 font-medium">State</th><th className="px-3 py-2 font-medium">Stops</th><th className="px-3 py-2 font-medium">Still permits</th><th className="px-3 py-2 text-right font-medium">Control</th></tr></thead>
          <tbody className="divide-y divide-line">
            {snapshot.killSwitches.map((item) => (
              <tr key={item.id}>
                <td colSpan={5} className="p-0">
                  <div className="grid grid-cols-[170px_100px_minmax(170px,1fr)_minmax(190px,1.1fr)_150px] items-center">
                    <RowButton onClick={() => onSelect({ kind: "POLICY", id: item.id })} selected={detail?.kind === "POLICY" && detail.id === item.id} className="col-span-4 grid grid-cols-subgrid items-center">
                      <span className="px-3 py-2.5"><span className="block text-sm text-ink">{item.label}</span><span className="block font-mono text-xs text-faint">{stateLabel(item.scope)}</span></span>
                      <span className="px-3 py-2.5"><StateMark state={item.state} /></span>
                      <span className="px-3 py-2.5 text-xs leading-snug text-dim">{item.stops}</span>
                      <span className="px-3 py-2.5 text-xs leading-snug text-up">{item.permits}</span>
                    </RowButton>
                    <span className="flex justify-end px-3 py-2"><button type="button" onClick={() => onToggle(item)} className={`focus-ring h-8 rounded-md border px-2 text-xs ${item.state === "ARMED" ? "border-line text-dim hover:border-down/60 hover:text-down" : "border-line-strong text-brand hover:text-ink"}`}>{item.state === "ARMED" ? "Stage stop" : "Re-arm locally"}</button></span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function Journal({ entries }: { entries: OperationsJournalEntry[] }) {
  return (
    <Surface label="Operational journal" action={<span className="text-xs text-faint">Most recent first</span>}>
      <ol className="divide-y divide-line">
        {entries.slice(0, 6).map((entry) => (
          <li key={entry.id} className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 px-3 py-2.5">
            <span className="font-mono text-xs text-faint">{entry.at}</span>
            <span className="min-w-0"><span className="block text-xs text-ink">{entry.action} <span className="font-mono text-faint">{entry.subject}</span></span><span className="mt-0.5 block text-xs leading-snug text-dim">{entry.detail}</span><span className="mt-1 block font-mono text-xs text-faint">{entry.actor} / {entry.evidence.toLowerCase()}</span></span>
          </li>
        ))}
      </ol>
    </Surface>
  );
}

function DetailPane({ snapshot, detail }: { snapshot: OperationsSnapshot; detail: Detail | null }) {
  const content = useMemo(() => {
    if (!detail) return null;
    if (detail.kind === "DEPENDENCY") {
      const item = snapshot.dependencies.find((entry) => entry.id === detail.id);
      return item ? { label: item.label, title: item.service, lines: [["State", stateLabel(item.state)], ["Checkpoint", item.checkpoint], ["Freshness", `${item.freshness.ageLabel} / ${item.freshness.thresholdLabel}`], ["Evidence", item.evidence.toLowerCase()]], detail: item.detail } : null;
    }
    if (detail.kind === "QUEUE") {
      const item = snapshot.jobQueues.find((entry) => entry.id === detail.id);
      return item ? { label: item.label, title: stateLabel(item.runner), lines: [["State", stateLabel(item.state)], ["Last completion", item.lastCompletion], ["Next checkpoint", item.nextCheckpoint], ["Evidence", item.evidence.toLowerCase()]], detail: item.detail } : null;
    }
    if (detail.kind === "RECOVERY") {
      const item = snapshot.recoveryCases.find((entry) => entry.id === detail.id);
      return item ? { label: item.id, title: item.packageCode, lines: [["State", stateLabel(item.state)], ["Risk boundary", item.riskBoundary], ["Residual", item.residual], ["Deadline", item.deadline], ["Authority", item.writeAuthority]], detail: item.events.map((event) => `${event.at}: ${event.label}. ${event.detail}`).join(" ") } : null;
    }
    if (detail.kind === "ALERT") {
      const item = snapshot.alerts.find((entry) => entry.id === detail.id);
      return item ? { label: item.id, title: item.title, lines: [["State", stateLabel(item.state)], ["Severity", stateLabel(item.severity)], ["Source", item.source], ["Opened", item.openedAt], ["Evidence", item.evidence.toLowerCase()]], detail: item.detail } : null;
    }
    const item = snapshot.killSwitches.find((entry) => entry.id === detail.id);
    return item ? { label: item.label, title: stateLabel(item.scope), lines: [["State", stateLabel(item.state)], ["Changed", item.changedAt], ["Actor", item.actor], ["Evidence", item.evidence.toLowerCase()]], detail: `${item.stops}. Terminal resolution remains permitted: ${item.permits}.` } : null;
  }, [detail, snapshot]);

  return (
    <Surface label="Inspection" action={<ShieldCheck size={14} aria-hidden="true" className="text-faint" />}>
      {content ? (
        <div className="px-3 py-3"><p className="text-sm text-ink">{content.label}</p><p className="mt-0.5 text-xs text-faint">{content.title}</p><dl className="mt-3 divide-y divide-line border-t border-line">{content.lines.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-4 py-2"><dt className="text-xs text-faint">{label}</dt><dd className="max-w-[60%] text-right font-mono text-xs text-dim">{value}</dd></div>)}</dl><p className="mt-3 text-xs leading-relaxed text-dim">{content.detail}</p></div>
      ) : <div className="px-3 py-5 text-xs leading-relaxed text-dim">Select a dependency, queue, recovery case, alert, or policy scope to inspect its evidence and operating boundary.</div>}
    </Surface>
  );
}

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
    setSnapshot((current) => ({ ...current, alerts: current.alerts.map((alert) => alert.id === id && alert.state === "OPEN" ? { ...alert, state: "ACKNOWLEDGED", acknowledgedAt: "Local fixture action" } : alert) }));
    appendJournal({ at: "Local fixture action", actor: "console-operator", subject: id, action: "Acknowledged alert", detail: "Acknowledgment is stored only in browser state. No runtime call was made.", evidence: "FIXTURE" });
  };

  const resolve = (id: string) => {
    setSnapshot((current) => ({ ...current, alerts: current.alerts.map((alert) => alert.id === id && alert.state !== "RESOLVED" ? { ...alert, state: "RESOLVED", resolvedAt: "Local fixture action" } : alert) }));
    appendJournal({ at: "Local fixture action", actor: "console-operator", subject: id, action: "Resolved alert", detail: "Resolution is stored only in browser state. No runtime call was made.", evidence: "FIXTURE" });
  };

  const toggleSwitch = (item: KillSwitch) => {
    const next = item.state === "ARMED" ? "STOPPED" : "ARMED";
    setSnapshot((current) => ({ ...current, killSwitches: current.killSwitches.map((switchItem) => switchItem.id === item.id ? { ...switchItem, state: next, changedAt: "Local fixture action", actor: "console-operator", evidence: "FIXTURE" } : switchItem) }));
    appendJournal({ at: "Local fixture action", actor: "console-operator", subject: item.label, action: next === "STOPPED" ? "Staged stop" : "Re-armed locally", detail: `${next === "STOPPED" ? item.stops : "New risk may be admitted in the local fixture"}. Terminal resolution remains permitted. No runtime call was made.`, evidence: "FIXTURE" });
  };

  const panel = view === "QUEUES" ? <QueueTable snapshot={snapshot} detail={detail} onSelect={setDetail} /> : view === "RECOVERY" ? <RecoveryTable snapshot={snapshot} detail={detail} onSelect={setDetail} /> : view === "POLICY" ? <PolicyTable snapshot={snapshot} detail={detail} onSelect={setDetail} onToggle={toggleSwitch} /> : view === "ALERTS" ? <AlertTable snapshot={snapshot} detail={detail} onSelect={setDetail} onAcknowledge={acknowledge} onResolve={resolve} /> : null;

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app">
      <div className="shrink-0 border-b border-line bg-panel">
        <div className="flex min-h-12 flex-col gap-2 px-3 py-2 lg:h-12 lg:flex-row lg:items-center lg:px-4 lg:py-0">
          <div className="flex min-w-0 items-center gap-3"><h1 className="shrink-0 text-sm font-semibold text-ink lg:text-base">Operations</h1><MetaLine items={["internal control plane", snapshot.captureLabel, "fixture only"]} className="hidden xl:flex" /></div>
          <div className="ml-auto flex items-center gap-2"><label className="sr-only" htmlFor="operations-environment">Operations environment</label><span className="relative"><select id="operations-environment" value={environment} onChange={(event) => setEnvironment(event.target.value as OperationsEnvironment)} className="focus-ring h-9 appearance-none rounded-md border border-line bg-raised py-0 pr-8 pl-2.5 text-xs text-dim hover:border-line-strong"><option value="ARBITRUM_SEPOLIA">Arbitrum Sepolia</option><option value="ARBITRUM_ONE">Arbitrum One</option></select><ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-faint" /></span><span className={`flex h-9 items-center rounded-md border px-2.5 text-xs ${policy.writesAllowed ? "border-brand-edge text-brand" : "border-down/40 text-down"}`}>{policy.writesAllowed ? "Testnet policy" : "No mainnet writes"}</span></div>
        </div>
        <div className="no-scrollbar overflow-x-auto border-t border-line lg:border-t-0"><Tabs items={VIEWS} value={view} onChange={(id) => setView(id as ViewId)} idBase="operations-view" /></div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line bg-inset px-3 py-2 lg:px-4"><div className="flex items-start gap-2 text-xs leading-relaxed text-dim"><CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" /><span>Evidence and freshness labels describe a recorded development fixture. New-risk controls never block terminal completion, unwind, collateral release, or evidence publication.</span></div></div>
        <div className="grid min-w-0 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-4">
          <div className="min-w-0 space-y-3">
            {view === "OVERVIEW" ? <><RuntimeStatus status={devnetStatus} /><DependencyTable snapshot={snapshot} detail={detail} onSelect={setDetail} /><div className="grid min-w-0 gap-3 xl:grid-cols-2"><IndexerTable snapshot={snapshot} /><AlertTable snapshot={snapshot} detail={detail} onSelect={setDetail} onAcknowledge={acknowledge} onResolve={resolve} /></div></> : panel}
            {view === "RECOVERY" ? <Journal entries={snapshot.journal.filter((entry) => entry.subject.startsWith("RCV"))} /> : null}
            {view === "POLICY" ? <Journal entries={snapshot.journal.filter((entry) => entry.actor === "risk-policy" || entry.actor === "console-operator")} /> : null}
            {view === "ALERTS" ? <Journal entries={snapshot.journal.filter((entry) => entry.subject.startsWith("ALT"))} /> : null}
          </div>
          <aside className="min-w-0 space-y-3"><PolicyBoundary policy={policy} /><DetailPane snapshot={snapshot} detail={detail} />{view !== "ALERTS" && view !== "POLICY" ? <Journal entries={snapshot.journal} /> : null}</aside>
        </div>
      </div>
    </main>
  );
}
