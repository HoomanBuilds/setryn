"use client";

import type { ReactNode } from "react";
import { Check, CircleAlert, Database, Info, OctagonAlert } from "lucide-react";
import { Chip, LiveDot, Meter, Panel, PanelHead, Switch, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import type {
  AlertSeverity,
  AlertState,
  EvidenceKind,
  HealthState,
  KillSwitch,
  KillSwitchState,
  OperationsSnapshot,
} from "@/lib/operations/types";
import { TONE_TEXT, freshnessGauge, stateLabel, stateTone, type Detail } from "./ops-model";

export function Evidence({ value }: { value: EvidenceKind }) {
  const tone = value === "RECORDED" ? "dim" : value === "MODELED" ? "brand" : "neutral";
  return <Chip tone={tone}>{value.toLowerCase()}</Chip>;
}

export function StateMark({ state }: { state: HealthState | AlertSeverity | AlertState | KillSwitchState }) {
  const tone = stateTone(state);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${TONE_TEXT[tone]}`}>
      <LiveDot tone={tone === "dim" ? "dim" : tone} live={state === "HEALTHY"} />
      {stateLabel(state)}
    </span>
  );
}

function selectable(detail: Detail | null, kind: Detail["kind"], id: string): boolean {
  return detail?.kind === kind && detail.id === id;
}

function SelectRow({
  selected,
  onSelect,
  children,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`focus-ring relative cursor-pointer transition-colors duration-150 ${selected ? "bg-raised" : "hover:bg-raised/50"}`}
    >
      {children}
    </tr>
  );
}

function Accent({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand transition-opacity duration-200 ${on ? "opacity-100" : "opacity-0"}`}
    />
  );
}

export function DependencyTable({
  snapshot,
  detail,
  onSelect,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  return (
    <Panel label="Dependency health" delay={40}>
      <PanelHead title="Dependency health" tools={<span className="text-[11px] text-faint">Recorded snapshot</span>} />
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Dependency</th>
              <th scope="col" className={TH}>State</th>
              <th scope="col" className={TH}>Checkpoint</th>
              <th scope="col" className={`${TH} w-[190px]`}>Freshness vs threshold</th>
              <th scope="col" className={`${TH} text-right`}>Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {snapshot.dependencies.map((dependency) => {
              const selected = selectable(detail, "DEPENDENCY", dependency.id);
              const gauge = freshnessGauge(dependency.freshness);
              return (
                <SelectRow
                  key={dependency.id}
                  selected={selected}
                  label={`Inspect ${dependency.label}`}
                  onSelect={() => onSelect({ kind: "DEPENDENCY", id: dependency.id })}
                >
                  <td className="relative h-12 px-3">
                    <Accent on={selected} />
                    <span className="block truncate text-[13px] text-ink">{dependency.label}</span>
                    <span className="block truncate text-[11px] text-faint">{dependency.service}</span>
                  </td>
                  <td className="px-3">
                    <StateMark state={dependency.state} />
                  </td>
                  <td className="px-3 font-mono text-[11px] text-dim">{dependency.checkpoint}</td>
                  <td className="px-3">
                    <span className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                      <span className={dependency.freshness.withinThreshold ? "text-dim" : "text-down"}>
                        {dependency.freshness.ageLabel}
                      </span>
                      <span className="text-off">{dependency.freshness.thresholdLabel}</span>
                    </span>
                    {gauge ? (
                      <Meter
                        value={gauge.fill}
                        limit={gauge.tick}
                        tone={dependency.freshness.withinThreshold ? "up" : "down"}
                        label={`${dependency.label} freshness against threshold`}
                        className="mt-1.5"
                        height="h-[3px]"
                      />
                    ) : null}
                  </td>
                  <td className="px-3 text-right">
                    <Evidence value={dependency.evidence} />
                  </td>
                </SelectRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function IndexerTable({ snapshot }: { snapshot: OperationsSnapshot }) {
  return (
    <Panel label="Indexer checkpoints" delay={80} className="min-w-0">
      <PanelHead title="Indexer checkpoints" tools={<Database size={14} aria-hidden="true" className="text-faint" />} />
      <ul className="divide-y divide-line-soft">
        {snapshot.indexerStreams.map((stream) => {
          const over = stream.lagBlocks > stream.allowedLagBlocks;
          const scale = Math.max(stream.lagBlocks, stream.allowedLagBlocks) * 1.2;
          return (
            <li key={stream.id} className="px-3 py-2.5 transition-colors duration-150 hover:bg-raised/40">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <LiveDot tone={stateTone(stream.state) === "up" ? "up" : "brand"} />
                  <span className="truncate text-[13px] text-ink">{stream.label}</span>
                </span>
                <Evidence value={stream.evidence} />
              </div>
              <div className="tnum mt-1.5 grid grid-cols-3 gap-2 font-mono text-[11px]">
                <span>
                  <span className="block font-sans text-[10px] text-faint">Head</span>
                  <span className="text-dim">{stream.headBlock.toLocaleString("en-US")}</span>
                </span>
                <span>
                  <span className="block font-sans text-[10px] text-faint">Projected</span>
                  <span className="text-dim">{stream.projectedBlock.toLocaleString("en-US")}</span>
                </span>
                <span className="text-right">
                  <span className="block font-sans text-[10px] text-faint">Lag / allowed</span>
                  <span className={over ? "text-down" : "text-dim"}>{`${stream.lagBlocks} / ${stream.allowedLagBlocks}`}</span>
                </span>
              </div>
              <Meter
                value={stream.lagBlocks / scale}
                limit={stream.allowedLagBlocks / scale}
                tone={over ? "down" : "up"}
                label={`${stream.label} projection lag`}
                className="mt-1.5"
                height="h-[3px]"
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function QueueTable({
  snapshot,
  detail,
  onSelect,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  const max = Math.max(1, ...snapshot.jobQueues.map((queue) => queue.queued + queue.leased + queue.delayed));
  return (
    <Panel label="Operator queues" delay={40}>
      <PanelHead title="Operator queues" tools={<span className="text-[11px] text-faint">No external runner connected</span>} />
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Queue</th>
              <th scope="col" className={TH}>State</th>
              <th scope="col" className={TH_NUM}>Queued</th>
              <th scope="col" className={TH_NUM}>Leased</th>
              <th scope="col" className={TH_NUM}>Delayed</th>
              <th scope="col" className={`${TH} w-[140px]`}>Load</th>
              <th scope="col" className={TH_NUM}>Last completion</th>
              <th scope="col" className={TH_NUM}>Next checkpoint</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {snapshot.jobQueues.map((queue) => {
              const selected = selectable(detail, "QUEUE", queue.id);
              return (
                <SelectRow
                  key={queue.id}
                  selected={selected}
                  label={`Inspect ${queue.label}`}
                  onSelect={() => onSelect({ kind: "QUEUE", id: queue.id })}
                >
                  <td className="relative h-12 px-3">
                    <Accent on={selected} />
                    <span className="block text-[13px] text-ink">{queue.label}</span>
                    <span className="block font-mono text-[11px] text-faint">{stateLabel(queue.runner)}</span>
                  </td>
                  <td className="px-3">
                    <StateMark state={queue.state} />
                  </td>
                  <td className="tnum px-3 text-right font-mono text-dim">{queue.queued}</td>
                  <td className="tnum px-3 text-right font-mono text-up">{queue.leased}</td>
                  <td className={`tnum px-3 text-right font-mono ${queue.delayed > 0 ? "text-brand" : "text-dim"}`}>{queue.delayed}</td>
                  <td className="px-3">
                    <span className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <span className="bg-dim/70 transition-[width] duration-200" style={{ width: `${(queue.queued / max) * 100}%` }} />
                      <span className="bg-up transition-[width] duration-200" style={{ width: `${(queue.leased / max) * 100}%` }} />
                      <span className="bg-brand transition-[width] duration-200" style={{ width: `${(queue.delayed / max) * 100}%` }} />
                    </span>
                  </td>
                  <td className="tnum px-3 text-right font-mono text-[11px] text-dim">{queue.lastCompletion}</td>
                  <td className="tnum px-3 text-right font-mono text-[11px] text-dim">{queue.nextCheckpoint}</td>
                </SelectRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-[11px] text-faint">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-dim/70" />Queued</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-up" />Leased</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-3 rounded-full bg-brand" />Delayed</span>
      </div>
    </Panel>
  );
}

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === "CRITICAL") return <OctagonAlert size={14} aria-label="Critical" className="shrink-0 text-down" />;
  if (severity === "WARNING") return <CircleAlert size={14} aria-label="Warning" className="shrink-0 text-brand" />;
  return <Info size={14} aria-label="Notice" className="shrink-0 text-faint" />;
}

export function AlertTable({
  snapshot,
  detail,
  onSelect,
  onAcknowledge,
  onResolve,
  compact = false,
}: {
  snapshot: OperationsSnapshot;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  compact?: boolean;
}) {
  const open = snapshot.alerts.filter((alert) => alert.state === "OPEN").length;
  return (
    <Panel label="Alerts" delay={100} className="min-w-0">
      <PanelHead
        title="Alerts"
        tools={
          <>
            {open > 0 ? <Chip tone="down" dot>{`${open} open`}</Chip> : null}
            <span className="hidden text-[11px] text-faint sm:inline">Journaled fixture actions</span>
          </>
        }
      />
      <ul className="divide-y divide-line-soft">
        {snapshot.alerts.map((alert) => {
          const selected = selectable(detail, "ALERT", alert.id);
          return (
            <li
              key={alert.id}
              className={`relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors duration-150 ${
                selected ? "bg-raised" : "hover:bg-raised/50"
              }`}
            >
              <Accent on={selected} />
              <button
                type="button"
                onClick={() => onSelect({ kind: "ALERT", id: alert.id })}
                aria-pressed={selected}
                className="focus-ring flex min-w-0 items-start gap-2.5 rounded-sm text-left"
              >
                <span className="mt-0.5">
                  <SeverityIcon severity={alert.severity} />
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13px] text-ink ${compact ? "truncate" : ""}`}>{alert.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                    <span className="font-mono">{alert.id}</span>
                    <StateMark state={alert.state} />
                    <span className="font-mono">{alert.openedAt}</span>
                    {compact ? null : <span>{alert.source}</span>}
                  </span>
                </span>
              </button>
              <span className="flex items-center justify-end gap-1">
                {alert.state === "OPEN" ? (
                  <button
                    type="button"
                    onClick={() => onAcknowledge(alert.id)}
                    className="focus-ring h-7 rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-brand-edge hover:text-brand"
                  >
                    Acknowledge
                  </button>
                ) : null}
                {alert.state !== "RESOLVED" ? (
                  <button
                    type="button"
                    onClick={() => onResolve(alert.id)}
                    className="focus-ring h-7 rounded-md border border-line px-2 text-[11px] text-dim transition-colors hover:border-up/50 hover:text-up"
                  >
                    Resolve
                  </button>
                ) : (
                  <Check size={15} aria-label="Resolved" className="text-up" />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function PolicyTable({
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
    <Panel label="Scoped kill switches" delay={40}>
      <PanelHead title="Scoped kill switches" tools={<Chip>Local staging only</Chip>} />
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Scope</th>
              <th scope="col" className={TH}>State</th>
              <th scope="col" className={TH}>Stops</th>
              <th scope="col" className={TH}>Still permits</th>
              <th scope="col" className={TH_NUM}>Changed</th>
              <th scope="col" className={TH_NUM}>Admit new risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {snapshot.killSwitches.map((item) => {
              const selected = selectable(detail, "POLICY", item.id);
              return (
                <SelectRow
                  key={item.id}
                  selected={selected}
                  label={`Inspect ${item.label}`}
                  onSelect={() => onSelect({ kind: "POLICY", id: item.id })}
                >
                  <td className="relative h-14 px-3">
                    <Accent on={selected} />
                    <span className="block text-[13px] text-ink">{item.label}</span>
                    <span className="block font-mono text-[11px] text-faint">{stateLabel(item.scope)}</span>
                  </td>
                  <td className="px-3">
                    <StateMark state={item.state} />
                  </td>
                  <td className="max-w-[240px] min-w-[180px] px-3 text-[11px] leading-snug whitespace-normal text-dim">{item.stops}</td>
                  <td className="max-w-[260px] min-w-[200px] px-3 text-[11px] leading-snug whitespace-normal text-up">{item.permits}</td>
                  <td className="tnum px-3 text-right font-mono text-[11px] text-faint">
                    {item.changedAt}
                    <span className="block text-off">{item.actor}</span>
                  </td>
                  <td className="px-3 text-right" onClick={(event) => event.stopPropagation()}>
                    <span className="inline-flex items-center gap-2">
                      <span className={`text-[11px] ${item.state === "ARMED" ? "text-faint" : "text-down"}`}>
                        {item.state === "ARMED" ? "Admitting" : "Stop staged"}
                      </span>
                      <Switch
                        checked={item.state === "ARMED"}
                        onChange={() => onToggle(item)}
                        label={item.state === "ARMED" ? `Stage stop for ${item.label}` : `Re-arm ${item.label} locally`}
                        tone="up"
                      />
                    </span>
                  </td>
                </SelectRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
