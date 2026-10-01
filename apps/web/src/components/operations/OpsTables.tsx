"use client";

import type { ReactNode } from "react";
import { Check, CircleAlert, Info, OctagonAlert } from "lucide-react";
import { MarketMark } from "@/components/portfolio/MarketMark";
import { Chip, LiveDot, Meter, Panel, PanelHead, TH, TH_NUM } from "@/components/strategies/desk/Desk";
import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import type { SeriesStatus } from "@/lib/market-data/types";
import {
  SERIES_EVENT_ACTION,
  SERIES_EVENT_LABEL,
  SERIES_PHASE_LABEL,
  type DeploymentEvidence,
  type SeriesEvent,
  type SeriesPhase,
} from "@/lib/operations/deployment";
import type { SeriesRow } from "@/lib/operations/model";
import type { AlertSeverity, AlertState, DependencyHealth, EvidenceKind, HealthState, OperationalAlert } from "@/lib/operations/types";
import { formatLots, formatNumber } from "@/lib/terminal/format";
import { TONE_TEXT, countdown, freshnessGauge, shortHex, stateLabel, stateTone, utc, type Detail } from "./ops-model";

export function Evidence({ value }: { value: EvidenceKind }) {
  const tone = value === "OBSERVED" ? "up" : value === "SCHEDULED" ? "brand" : "dim";
  return <Chip tone={tone}>{value === "OBSERVED" ? "live" : value.toLowerCase()}</Chip>;
}

export function StateMark({ state, label }: { state: HealthState | AlertSeverity | AlertState | SeriesStatus | SeriesPhase; label?: string }) {
  const tone = stateTone(state);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${TONE_TEXT[tone]}`}>
      <LiveDot tone={tone} live={state === "HEALTHY" || state === "ACTIVE"} />
      {label ?? stateLabel(state)}
    </span>
  );
}

function selected(detail: Detail | null, kind: Detail["kind"], id: string): boolean {
  return detail?.kind === kind && detail.id === id;
}

function SelectRow({ active, onSelect, children, label }: { active: boolean; onSelect: () => void; children: ReactNode; label: string }) {
  return (
    <tr
      tabIndex={0}
      aria-selected={active}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`focus-ring relative cursor-pointer transition-colors duration-150 ${active ? "bg-raised" : "hover:bg-raised/50"}`}
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
  rows,
  detail,
  onSelect,
}: {
  rows: DependencyHealth[];
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  return (
    <Panel label="Dependency health" delay={40}>
      <PanelHead title="Dependency health" tools={<span className="text-[11px] text-faint">Checked live</span>} />
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
            {rows.map((dependency) => {
              const active = selected(detail, "DEPENDENCY", dependency.id);
              const gauge = freshnessGauge(dependency.freshness);
              return (
                <SelectRow key={dependency.id} active={active} label={`Inspect ${dependency.label}`} onSelect={() => onSelect({ kind: "DEPENDENCY", id: dependency.id })}>
                  <td className="relative h-12 px-3">
                    <Accent on={active} />
                    <span className="block truncate text-[13px] text-ink">{dependency.label}</span>
                    <span className="block truncate text-[11px] text-faint">{dependency.service}</span>
                  </td>
                  <td className="px-3">
                    <StateMark state={dependency.state} />
                  </td>
                  <td className="px-3 font-mono text-[11px] text-dim">{dependency.checkpoint}</td>
                  <td className="px-3">
                    <span className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                      <span className={dependency.freshness.withinThreshold ? "text-dim" : "text-down"}>{dependency.freshness.ageLabel}</span>
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

export function SeriesTable({
  rows,
  now,
  detail,
  onSelect,
  compact = false,
}: {
  rows: SeriesRow[];
  now: number;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
  compact?: boolean;
}) {
  const visible = compact ? rows.slice(0, 8) : rows;
  return (
    <Panel label="Listed series" delay={60}>
      <PanelHead
        title="Listed series"
        tools={
          <span className="text-[11px] text-faint">
            {`${rows.filter((row) => row.status === "ACTIVE").length} active / ${rows.length} listed`}
          </span>
        }
      />
      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-faint">No markets are listed by this deployment.</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Series</th>
                <th scope="col" className={TH}>Registry</th>
                <th scope="col" className={TH}>Phase</th>
                <th scope="col" className={TH_NUM}>Range</th>
                <th scope="col" className={TH_NUM}>Versions</th>
                <th scope="col" className={TH_NUM}>Book / OI</th>
                <th scope="col" className={TH_NUM}>Next event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {visible.map((row) => {
                const active = selected(detail, "SERIES", row.marketKey);
                const decimals = row.floor !== null && row.floor < 10 ? 2 : 0;
                return (
                  <SelectRow key={row.marketKey} active={active} label={`Inspect ${row.marketKey}`} onSelect={() => onSelect({ kind: "SERIES", id: row.marketKey })}>
                    <td className="relative h-12 px-3">
                      <Accent on={active} />
                      <span className="flex items-center gap-2">
                        <MarketMark underlying={row.underlying} size={15} />
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[12px] text-ink">{row.marketKey}</span>
                          <span className="block truncate text-[11px] text-faint">{row.onchain ? row.strategyLabel : "Not in the runtime"}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3">
                      <StateMark state={row.status} label={row.status === "UNKNOWN" ? "Not read" : undefined} />
                      {row.tradable === false ? <span className="block text-[10px] text-brand">not clearing</span> : null}
                    </td>
                    <td className="px-3">
                      <StateMark state={row.phase} label={SERIES_PHASE_LABEL[row.phase]} />
                    </td>
                    <td className="tnum px-3 text-right font-mono text-dim">
                      {row.floor !== null && row.cap !== null ? `${formatNumber(row.floor, decimals)} – ${formatNumber(row.cap, decimals)}` : "-"}
                    </td>
                    <td className="tnum px-3 text-right font-mono text-dim">
                      {row.seriesVersion !== null ? `s${row.seriesVersion}` : "-"}
                      <span className="text-off">{row.feeScheduleVersion !== null ? ` / f${row.feeScheduleVersion}` : ""}</span>
                    </td>
                    <td className="tnum px-3 text-right font-mono text-dim">
                      {`${row.restingOrders} / ${row.openInterestLots !== null ? formatLots(row.openInterestLots) : "-"}`}
                    </td>
                    <td className="px-3 text-right">
                      {row.next ? (
                        <>
                          <span className="tnum block font-mono text-ink">{countdown(row.next.at - now)}</span>
                          <span className="block text-[10px] text-faint">{SERIES_EVENT_LABEL[row.next.kind]}</span>
                        </>
                      ) : (
                        <span className="text-faint">None scheduled</span>
                      )}
                    </td>
                  </SelectRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {compact && rows.length > visible.length ? (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">{`${rows.length - visible.length} more in the Series view`}</p>
      ) : null}
    </Panel>
  );
}

export function EventTable({
  events,
  now,
  scheduled,
  onSelect,
}: {
  events: SeriesEvent[];
  now: number;
  /** Whether the runtime or listing publishes the schedule instants (otherwise they follow the series terms from expiry). */
  scheduled: boolean;
  onSelect: (next: Detail) => void;
}) {
  const horizon = Math.max(1, ...events.map((event) => event.at - now));
  return (
    <Panel label="Keeper schedule" delay={40}>
      <PanelHead title="Keeper schedule" tools={<span className="text-[11px] text-faint">From the series schedules, soonest first</span>} />
      {events.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-faint">No scheduled series events ahead.</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>When</th>
                <th scope="col" className={TH}>Series</th>
                <th scope="col" className={TH}>Event</th>
                <th scope="col" className={TH}>Callable work</th>
                <th scope="col" className={`${TH_NUM} w-[160px]`}>In</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {events.map((event) => (
                <tr
                  key={`${event.marketKey}-${event.kind}`}
                  onClick={() => onSelect({ kind: "SERIES", id: event.marketKey })}
                  className="cursor-pointer transition-colors duration-150 hover:bg-raised/50"
                >
                  <td className="tnum h-10 px-3 font-mono text-[11px] text-dim">{utc(event.at)}</td>
                  <td className="px-3">
                    <span className="flex items-center gap-2">
                      <MarketMark code={event.marketKey} size={14} />
                      <span className="font-mono text-[12px] text-ink">{event.marketKey}</span>
                    </span>
                  </td>
                  <td className="px-3 text-ink">{SERIES_EVENT_LABEL[event.kind]}</td>
                  <td className="max-w-[300px] truncate px-3 text-[11px] text-faint" title={SERIES_EVENT_ACTION[event.kind]}>
                    {SERIES_EVENT_ACTION[event.kind]}
                  </td>
                  <td className="px-3">
                    <span className="tnum block text-right font-mono text-ink">{countdown(event.at - now)}</span>
                    <Meter value={1 - (event.at - now) / horizon} tone={event.at - now < 86_400 ? "brand" : "dim"} label={`${event.marketKey} ${event.kind} countdown`} className="mt-1" height="h-[3px]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-3 py-1.5 text-[11px] leading-snug text-faint">
        {scheduled
          ? "Every call after a deadline is permissionless; the operator worker runs them on schedule, and anyone can."
          : "Windows follow the series terms from each listed expiry (08:00 UTC). Every call after a deadline is permissionless."}
      </p>
    </Panel>
  );
}

const ADDRESS_FIELDS: [keyof SetrynRuntime, string][] = [
  ["collateralVault", "Collateral vault"],
  ["orderState", "Order state"],
  ["atomicClearingEngine", "Atomic clearing engine"],
  ["publicOrderBook", "Public order book"],
  ["privateRfqBook", "Private RFQ book"],
  ["privateRfqValidationGate", "Private RFQ validation gate"],
  ["positionEngine", "Position engine"],
  ["signedLifecycleEngine", "Signed lifecycle engine"],
  ["lifecyclePolicyValidator", "Lifecycle policy validator"],
  ["portfolioRiskEngine", "Portfolio risk engine"],
  ["riskAdmissionBindingRegistry", "Risk admission bindings"],
  ["executionPolicyRegistry", "Execution policy registry"],
  ["tradingSessionPolicy", "Trading session policy"],
  ["fundedFeeEngine", "Funded fee engine"],
  ["feeScheduleRegistry", "Fee schedule registry"],
  ["seriesRegistry", "Series registry"],
  ["marketRegistry", "Market registry"],
  ["marketAdapter", "Market adapter"],
  ["fixingEngine", "Fixing engine"],
  ["fixingAdapter", "Fixing adapter"],
  ["riskAdapter", "Risk adapter"],
  ["cashSettlementCoordinator", "Cash settlement coordinator"],
  ["positionLifecycleExecutor", "Position lifecycle executor"],
  ["settlementToken", "Settlement token"],
  ["operator", "Operator"],
  ["treasuryController", "Treasury controller"],
];

export function ContractTable({
  runtime,
  evidence,
  detail,
  onSelect,
}: {
  runtime: SetrynRuntime | null;
  evidence: DeploymentEvidence | null;
  detail: Detail | null;
  onSelect: (next: Detail) => void;
}) {
  const byAddress = new Map((evidence?.contracts ?? []).filter((entry) => entry.address).map((entry) => [entry.address!.toLowerCase(), entry]));
  const rows = runtime
    ? ADDRESS_FIELDS.map(([field, label]) => ({ field, label, address: runtime[field] as string | undefined })).filter(
        (row): row is { field: keyof SetrynRuntime; label: string; address: string } => typeof row.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(row.address),
      )
    : [];
  return (
    <Panel label="Contracts" delay={40}>
      <PanelHead
        title="Contracts"
        tools={
          <span className="text-[11px] text-faint">
            {evidence ? `${evidence.contracts.filter((entry) => entry.state === "MATCHES").length}/${evidence.contracts.length} hashes match` : "No evidence manifest"}
          </span>
        }
      />
      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-faint">The runtime has not loaded.</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={TH}>Contract</th>
                <th scope="col" className={TH}>Address</th>
                <th scope="col" className={TH}>Code evidence</th>
                <th scope="col" className={TH}>Live hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((row) => {
                const check = byAddress.get(row.address.toLowerCase()) ?? null;
                const active = selected(detail, "CONTRACT", row.address);
                return (
                  <SelectRow key={`${row.field}`} active={active} label={`Inspect ${row.label}`} onSelect={() => onSelect({ kind: "CONTRACT", id: row.address })}>
                    <td className="relative h-10 px-3">
                      <Accent on={active} />
                      <span className="text-[12px] text-ink">{row.label}</span>
                      {check ? <span className="ml-2 font-mono text-[10px] text-off">{check.name}</span> : null}
                    </td>
                    <td className="tnum px-3 font-mono text-[11px] text-dim" title={row.address}>{row.address}</td>
                    <td className="px-3">
                      {check ? (
                        <StateMark
                          state={check.state === "MATCHES" ? "HEALTHY" : check.state === "MISMATCH" ? "DEGRADED" : "UNAVAILABLE"}
                          label={check.state === "MATCHES" ? "Matches" : check.state === "MISMATCH" ? "Differs" : "No code"}
                        />
                      ) : (
                        <span className="text-[11px] text-faint">Not in manifest</span>
                      )}
                    </td>
                    <td className="tnum px-3 font-mono text-[11px] text-off">{check ? shortHex(check.liveHash, 10, 6) : "-"}</td>
                  </SelectRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === "CRITICAL") return <OctagonAlert size={14} aria-label="Critical" className="shrink-0 text-down" />;
  if (severity === "WARNING") return <CircleAlert size={14} aria-label="Warning" className="shrink-0 text-brand" />;
  return <Info size={14} aria-label="Notice" className="shrink-0 text-faint" />;
}

export function AlertTable({
  alerts,
  detail,
  onSelect,
  onAcknowledge,
  compact = false,
}: {
  alerts: OperationalAlert[];
  detail: Detail | null;
  onSelect: (next: Detail) => void;
  onAcknowledge: (id: string) => void;
  compact?: boolean;
}) {
  const open = alerts.filter((alert) => alert.state === "OPEN").length;
  const visible = compact ? alerts.slice(0, 6) : alerts;
  return (
    <Panel label="Alerts" delay={100} className="min-w-0">
      <PanelHead
        title="Alerts"
        tools={
          <>
            {open > 0 ? <Chip tone="down" dot>{`${open} open`}</Chip> : null}
            <span className="hidden text-[11px] text-faint sm:inline">Raised by live checks</span>
          </>
        }
      />
      {alerts.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-faint">
          <Check size={14} className="text-up" aria-hidden="true" />
          No conditions need attention.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {visible.map((alert) => {
            const active = selected(detail, "ALERT", alert.id);
            return (
              <li
                key={alert.id}
                className={`relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors duration-150 ${active ? "bg-raised" : "hover:bg-raised/50"}`}
              >
                <Accent on={active} />
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "ALERT", id: alert.id })}
                  aria-pressed={active}
                  className="focus-ring flex min-w-0 items-start gap-2.5 rounded-sm text-left"
                >
                  <span className="mt-0.5">
                    <SeverityIcon severity={alert.severity} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[13px] text-ink ${compact ? "truncate" : ""}`}>{alert.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                      <StateMark state={alert.state} />
                      <span className="font-mono">{alert.source}</span>
                      {compact ? null : <span className="whitespace-normal">{alert.detail}</span>}
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
                  ) : (
                    <span className="text-[11px] text-faint">{alert.acknowledgedAt ? `Ack ${alert.acknowledgedAt}` : stateLabel(alert.state)}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {compact && alerts.length > visible.length ? (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">{`${alerts.length - visible.length} more in the Alerts view`}</p>
      ) : null}
    </Panel>
  );
}
