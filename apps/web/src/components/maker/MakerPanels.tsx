"use client";

import { CirclePause, CirclePlay, ShieldAlert, SlidersHorizontal } from "lucide-react";
import {
  Chip,
  LiveDot,
  Meter,
  Panel,
  PanelHead,
  RangeField,
  Switch,
  TH,
  TH_NUM,
  deskMotion,
} from "@/components/strategies/desk/Desk";
import { makerCockpitSnapshot } from "@/lib/maker/fixtures";
import type {
  CapitalBucket,
  ConnectivityState,
  KillSwitchScope,
  MarketRisk,
  QuoteSessionState,
} from "@/lib/maker/types";
import { signedNumber, signedUsd, usd, usdCompact } from "./format";

export function SessionBadge({ state }: { state: QuoteSessionState }) {
  const label = state === "QUOTING" ? "Quoting" : state === "PAUSED" ? "Paused" : "Risk paused";
  const tone = state === "QUOTING" ? "text-up" : state === "PAUSED" ? "text-dim" : "text-down";
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${tone}`}>
      <LiveDot tone={state === "QUOTING" ? "up" : state === "PAUSED" ? "dim" : "down"} live={state === "QUOTING"} />
      {label}
    </span>
  );
}

export function QuotePolicy({
  skew,
  expiry,
  sessionState,
  onSkew,
  onExpiry,
  onToggle,
}: {
  skew: number;
  expiry: number;
  sessionState: QuoteSessionState;
  onSkew: (next: number) => void;
  onExpiry: (next: number) => void;
  onToggle: () => void;
}) {
  const paused = sessionState !== "QUOTING";
  return (
    <Panel label="Quote policy" delay={60}>
      <PanelHead
        title="Quote policy"
        tools={
          <>
            <span className="hidden text-[11px] text-faint sm:inline">Local preview controls</span>
            <SlidersHorizontal size={14} className="text-faint" aria-hidden="true" />
          </>
        }
      />
      <div className="space-y-4 p-3">
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-inset px-3 py-2">
          <div>
            <p className="text-[11px] text-faint">Current session</p>
            <div className="mt-0.5">
              <SessionBadge state={sessionState} />
            </div>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className={`focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 ${
              paused
                ? "border-up/40 bg-up-soft text-up hover:bg-up/20"
                : "border-down/40 bg-down-soft text-down hover:bg-down/20"
            }`}
          >
            {paused ? <CirclePlay size={14} aria-hidden="true" /> : <CirclePause size={14} aria-hidden="true" />}
            {paused ? "Resume simulated" : "Pause simulated"}
          </button>
        </div>

        <RangeField
          label="Quote skew"
          value={skew}
          min={-20}
          max={20}
          step={0.5}
          origin={0}
          onChange={onSkew}
          ariaLabel="Quote skew in basis points"
          readout={`${signedNumber(skew, 1)} bp`}
          minLabel="Bid support"
          maxLabel="Ask support"
        />

        <RangeField
          label="Quote expiry"
          value={expiry}
          min={5}
          max={45}
          step={1}
          onChange={onExpiry}
          ariaLabel="Quote expiry in seconds"
          readout={`${expiry}s`}
          minLabel="5 sec"
          maxLabel="45 sec"
        />

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
          {[
            ["Matching", "Private RFQ + book"],
            ["Reservation", "Required for firm"],
            ["Hedge mode", "Bounded route"],
            ["Authority", "Policy fixture"],
          ].map(([term, detail]) => (
            <div key={term} className="bg-panel px-2.5 py-2">
              <dt className="text-[11px] text-faint">{term}</dt>
              <dd className="mt-0.5 font-mono text-[11px] text-dim">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

function riskTone(state: MarketRisk["state"]): "up" | "brand" | "down" {
  if (state === "WITHIN_LIMIT") return "up";
  if (state === "WATCH") return "brand";
  return "down";
}

export function RiskLimits({ selected, onSelect }: { selected: string; onSelect: (seriesId: string) => void }) {
  return (
    <Panel label="Risk limits" delay={100}>
      <PanelHead title="Risk limits" tools={<Chip>Simulated</Chip>} />
      <ul className="divide-y divide-line-soft">
        {makerCockpitSnapshot.marketRisk.map((risk) => {
          const series = makerCockpitSnapshot.series.find((item) => item.id === risk.seriesId);
          const active = risk.seriesId === selected;
          const tone = riskTone(risk.state);
          return (
            <li key={risk.seriesId}>
              <button
                type="button"
                onClick={() => onSelect(risk.seriesId)}
                aria-current={active ? "true" : undefined}
                className={`focus-ring relative block w-full px-3 py-2.5 text-left transition-colors duration-150 ${
                  active ? "bg-raised" : "hover:bg-raised/50"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`}
                />
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-ink">{series?.displayName ?? risk.seriesId}</span>
                  <Chip tone={tone}>{risk.state.replace("_", " ")}</Chip>
                </span>
                <span className="mt-2 flex items-baseline justify-between text-[11px]">
                  <span className="text-faint">Gross vs quote limit</span>
                  <span className="tnum font-mono text-dim">
                    {`${usdCompact(risk.grossNotionalUsd)} / ${usdCompact(risk.quoteLimitUsd)}`}
                    <span className={`ml-1.5 ${tone === "up" ? "text-ink" : tone === "brand" ? "text-brand" : "text-down"}`}>
                      {`${risk.utilization.toFixed(1)}%`}
                    </span>
                  </span>
                </span>
                <Meter value={risk.utilization / 100} tone={tone} label={`${series?.displayName ?? risk.seriesId} quote utilization`} className="mt-1.5" />
                <span className="tnum mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
                  <span>
                    <span className="block font-sans text-[10px] text-faint">Net delta</span>
                    <span className={risk.netDeltaUsd >= 0 ? "text-up" : "text-down"}>{signedUsd(risk.netDeltaUsd)}</span>
                  </span>
                  <span>
                    <span className="block font-sans text-[10px] text-faint">Stress loss</span>
                    <span className="text-down">{usd(risk.stressLossUsd)}</span>
                  </span>
                  <span className="text-right">
                    <span className="block font-sans text-[10px] text-faint">Exp. hedge</span>
                    <span className="text-dim">{`${risk.expectedHedgeCostBps.toFixed(1)} bp`}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function KillSwitches({
  isPaused,
  onToggle,
}: {
  isPaused: (scope: KillSwitchScope) => boolean;
  onToggle: (scope: KillSwitchScope) => void;
}) {
  return (
    <Panel label="Scoped quote stops" delay={140}>
      <PanelHead
        title="Scoped quote stops"
        tools={
          <>
            <span className="hidden text-[11px] text-faint sm:inline">Local control state</span>
            <ShieldAlert size={14} className="text-faint" aria-hidden="true" />
          </>
        }
      />
      <ul className="divide-y divide-line-soft">
        {makerCockpitSnapshot.killSwitches.map((scope) => {
          const paused = isPaused(scope);
          return (
            <li
              key={scope.id}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 transition-colors duration-200 ${paused ? "bg-down-soft/60" : ""}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <LiveDot tone={paused ? "down" : "up"} />
                  <span className="truncate text-xs text-ink">{scope.label}</span>
                  <span className={`font-mono text-[10px] ${paused ? "text-down" : "text-faint"}`}>
                    {paused ? "stopped sim." : "quoting"}
                  </span>
                </div>
                <p className="mt-0.5 truncate pl-3.5 text-[11px] text-faint">
                  {`${scope.description} / protects ${usdCompact(scope.protectedNotionalUsd)}`}
                </p>
              </div>
              <Switch
                checked={!paused}
                onChange={() => onToggle(scope)}
                label={`${scope.label} quoting ${paused ? "stopped" : "active"}. Toggle simulated stop.`}
                tone="up"
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function healthTone(state: ConnectivityState): "up" | "brand" | "down" {
  if (state === "HEALTHY") return "up";
  if (state === "DEGRADED") return "brand";
  return "down";
}

export function SessionHealth() {
  const maxLatency = Math.max(250, ...makerCockpitSnapshot.health.map((check) => check.latencyMs ?? 0));
  return (
    <Panel label="Session health" delay={180}>
      <PanelHead title="Session health" tools={<span className="text-[11px] text-faint">Visibility, not a guarantee</span>} />
      <ul className="grid gap-px bg-line-soft sm:grid-cols-2">
        {makerCockpitSnapshot.health.map((check) => {
          const tone = healthTone(check.state);
          return (
            <li key={check.id} className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 bg-panel px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <LiveDot tone={tone} live={check.state === "HEALTHY"} />
                  <span className="truncate text-xs text-ink">{check.label}</span>
                </div>
                <span className="mt-0.5 block truncate pl-3.5 text-[11px] text-faint">{`${check.source} / ${check.lastUpdate}`}</span>
              </div>
              <div className="text-right">
                <span className={`tnum font-mono text-xs ${tone === "brand" ? "text-brand" : "text-dim"}`}>
                  {check.latencyMs === null ? "-" : `${check.latencyMs}ms`}
                </span>
                <Meter
                  value={(check.latencyMs ?? 0) / maxLatency}
                  tone={tone}
                  label={`${check.label} latency`}
                  className="mt-1"
                  height="h-[3px]"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function Inventory({ selected }: { selected: string }) {
  return (
    <Panel label="Inventory discipline" delay={140} className="min-w-0">
      <PanelHead title="Inventory and hedges" tools={<Chip>Simulated</Chip>} />
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH}>Position</th>
              <th scope="col" className={TH_NUM}>Net pkgs</th>
              <th scope="col" className={TH_NUM}>Delta</th>
              <th scope="col" className={TH_NUM}>Funding</th>
              <th scope="col" className={TH_NUM}>Close cost</th>
              <th scope="col" className={TH}>Hedge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {makerCockpitSnapshot.inventory.map((position) => {
              const active = position.seriesId === selected;
              return (
                <tr key={position.id} className={`transition-colors duration-150 ${active ? "bg-raised" : "hover:bg-raised/40"}`}>
                  <td className="h-11 px-3">
                    <span className={`block truncate text-xs ${active ? "text-ink" : "text-dim"}`}>{position.label}</span>
                    <span className="block truncate text-[11px] text-faint">{position.hedgeVenue}</span>
                  </td>
                  <td className="tnum px-3 text-right font-mono text-dim">{signedNumber(position.netPackageQuantity, 2)}</td>
                  <td className={`tnum px-3 text-right font-mono ${position.deltaUsd >= 0 ? "text-up" : "text-down"}`}>
                    {signedUsd(position.deltaUsd)}
                  </td>
                  <td className={`tnum px-3 text-right font-mono ${position.fundingExposureUsd >= 0 ? "text-up" : "text-down"}`}>
                    {signedUsd(position.fundingExposureUsd)}
                  </td>
                  <td className="tnum px-3 text-right font-mono text-dim">{`${position.closeCostBps.toFixed(1)} bp`}</td>
                  <td className="px-3">
                    <Chip tone={position.hedgeStatus === "COVERED" ? "up" : position.hedgeStatus === "PENDING" ? "brand" : "down"}>
                      {position.hedgeStatus.toLowerCase()}
                    </Chip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const BUCKET_FILL: Record<CapitalBucket["state"], string> = {
  AVAILABLE: "bg-up",
  RESERVED: "bg-ink/70",
  WITHDRAWAL_DELAY: deskMotion.hatch,
  RECOVERY: "bg-brand",
};

export function CapitalPlane() {
  const total = makerCockpitSnapshot.capital.reduce((sum, item) => sum + item.amountUsd, 0);
  return (
    <Panel label="Capital allocation" delay={180} className="min-w-0">
      <PanelHead
        title="Capital allocation"
        tools={
          <>
            <span className="tnum font-mono text-[11px] text-dim">{usd(total)}</span>
            <Chip>Simulated ledger</Chip>
          </>
        }
      />
      <div className="px-3 pt-3 pb-2">
        <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          {makerCockpitSnapshot.capital.map((bucket) => (
            <span
              key={bucket.state}
              className={`h-full transition-[flex-grow] duration-200 ease-out ${BUCKET_FILL[bucket.state]}`}
              style={{ flexGrow: bucket.amountUsd, flexBasis: 0 }}
            />
          ))}
        </div>
      </div>
      <ul className="divide-y divide-line-soft">
        {makerCockpitSnapshot.capital.map((bucket) => (
          <li key={bucket.state} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-2.5 px-3 py-2">
            <span aria-hidden="true" className={`mt-1 h-2 w-2 rounded-[2px] ${BUCKET_FILL[bucket.state]}`} />
            <span className="min-w-0">
              <span className="block truncate text-xs text-ink">{bucket.label}</span>
              <span className="block truncate text-[11px] text-faint">{bucket.description}</span>
            </span>
            <span className="text-right">
              <span
                className={`tnum block font-mono text-xs ${
                  bucket.state === "AVAILABLE" ? "text-up" : bucket.state === "RECOVERY" ? "text-brand" : "text-dim"
                }`}
              >
                {usd(bucket.amountUsd)}
              </span>
              <span className="tnum block font-mono text-[10px] text-off">{`${((bucket.amountUsd / total) * 100).toFixed(0)}%`}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
