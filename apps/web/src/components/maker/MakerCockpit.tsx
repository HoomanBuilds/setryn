"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CirclePause, CirclePlay, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { makerCockpitSnapshot } from "@/lib/maker/fixtures";
import type {
  CapacityKind,
  ConnectivityState,
  KillSwitchScope,
  MakerSeries,
  QuoteLevel,
  QuoteSessionState,
} from "@/lib/maker/types";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const signedMoney = (value: number) => `${value >= 0 ? "+" : "-"}${money.format(Math.abs(value))}`;
const signedNumber = (value: number, digits = 0) => `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)}`;

function OriginTag({ label = "SIMULATED" }: { label?: string }) {
  return (
    <span className="inline-flex h-5 items-center border border-line-strong px-1.5 font-mono text-[10px] tracking-[0.06em] text-dim uppercase">
      {label}
    </span>
  );
}

function StateDot({ state }: { state: ConnectivityState }) {
  const tone = state === "HEALTHY" ? "bg-up" : state === "DEGRADED" ? "bg-brand" : "bg-down";
  return <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone}`} />;
}

function SessionState({ state }: { state: QuoteSessionState }) {
  const stateLabel = state === "QUOTING" ? "Quoting" : state === "PAUSED" ? "Paused" : "Risk paused";
  const stateTone = state === "QUOTING" ? "text-up" : state === "PAUSED" ? "text-dim" : "text-down";

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${stateTone}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${state === "QUOTING" ? "bg-up" : state === "PAUSED" ? "bg-dim" : "bg-down"}`} />
      {stateLabel}
    </span>
  );
}

function Pane({
  title,
  note,
  tools,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 border border-line bg-panel ${className}`}>
      <header className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-3 lg:px-4">
        <div className="min-w-0">
          <h2 className="text-xs font-medium tracking-[0.08em] text-faint uppercase">{title}</h2>
          {note ? <p className="mt-0.5 truncate text-[11px] text-off">{note}</p> : null}
        </div>
        {tools ? <div className="flex shrink-0 items-center gap-2">{tools}</div> : null}
      </header>
      {children}
    </section>
  );
}

function AssetStrip({
  series,
  selected,
  onSelect,
}: {
  series: MakerSeries[];
  selected: string;
  onSelect: (seriesId: string) => void;
}) {
  return (
    <div className="no-scrollbar flex overflow-x-auto border-b border-line bg-inset">
      {series.map((item) => {
        const active = item.id === selected;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`focus-ring relative flex min-w-[204px] shrink-0 cursor-pointer flex-col gap-0.5 border-r border-line px-3 py-2 text-left transition-colors ${
              active ? "bg-panel" : "hover:bg-raised"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-ink">{item.displayName}</span>
              <span className="font-mono text-[10px] text-faint">{item.expiry}</span>
            </span>
            <span className="truncate font-mono text-[11px] text-dim">{item.template}</span>
            <span
              aria-hidden="true"
              className={`absolute right-0 bottom-0 left-0 h-px ${active ? "bg-brand" : "bg-transparent"}`}
            />
          </button>
        );
      })}
    </div>
  );
}

function CapacityValue({ kind, amount }: { kind: CapacityKind; amount: number }) {
  const label = kind === "FIRM" ? "Firm sim." : kind === "INDICATIVE" ? "Indicative" : "Reserved";
  const tone = kind === "FIRM" ? "text-ink" : kind === "INDICATIVE" ? "text-dim" : "text-brand";

  return (
    <div className="flex items-baseline justify-end gap-1.5">
      <span className={`tnum font-mono text-xs ${tone}`}>{money.format(amount)}</span>
      <span className="text-[10px] text-off">{label}</span>
    </div>
  );
}

function QuoteLadder({ levels, quoteUnit }: { levels: QuoteLevel[]; quoteUnit: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <caption className="sr-only">Simulated quote surface and capacity ladder</caption>
        <thead className="border-b border-line bg-inset text-[10px] tracking-[0.07em] text-faint uppercase">
          <tr>
            <th className="h-8 px-3 font-medium lg:px-4">Package size</th>
            <th className="h-8 px-2 text-right font-medium">Bid</th>
            <th className="h-8 px-2 text-right font-medium">Ask</th>
            <th className="h-8 px-2 text-right font-medium">Width</th>
            <th className="h-8 px-2 text-right font-medium">Firm capacity</th>
            <th className="h-8 px-2 text-right font-medium">Indicative depth</th>
            <th className="h-8 px-2 text-right font-medium">Expiry</th>
            <th className="h-8 px-3 text-right font-medium lg:px-4">Hedge cost</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level) => (
            <tr key={level.sizeLabel} className="border-b border-line-soft last:border-0 hover:bg-raised/55">
              <td className="h-11 px-3 lg:px-4">
                <span className="font-mono text-xs text-ink">{level.sizeLabel}</span>
                <span className="ml-2 text-[10px] text-off">{money.format(level.notionalUsd)}</span>
              </td>
              <td className="tnum px-2 text-right font-mono text-xs text-up">{level.bid.toFixed(1)}</td>
              <td className="tnum px-2 text-right font-mono text-xs text-down">{level.ask.toFixed(1)}</td>
              <td className="tnum px-2 text-right font-mono text-xs text-dim">{level.spreadBps.toFixed(1)} {quoteUnit}</td>
              <td className="px-2"><CapacityValue kind="FIRM" amount={level.firmCapacityUsd} /></td>
              <td className="px-2"><CapacityValue kind="INDICATIVE" amount={level.indicativeCapacityUsd} /></td>
              <td className="tnum px-2 text-right font-mono text-xs text-dim">{level.expirySeconds}s</td>
              <td className="tnum px-3 text-right font-mono text-xs text-dim lg:px-4">{level.expectedHedgeCostBps.toFixed(1)} bp</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuotePolicy({
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
    <div className="p-3 lg:p-4">
      <div className="grid gap-4">
        <div className="flex items-center justify-between gap-3 border-b border-line-soft pb-3">
          <div>
            <p className="text-xs text-dim">Current session</p>
            <div className="mt-1"><SessionState state={sessionState} /></div>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className={`focus-ring inline-flex h-8 cursor-pointer items-center gap-1.5 border px-2.5 text-xs font-medium transition-colors ${
              paused ? "border-up/40 bg-up-soft text-up hover:bg-up/20" : "border-down/40 bg-down-soft text-down hover:bg-down/20"
            }`}
          >
            {paused ? <CirclePlay size={14} aria-hidden="true" /> : <CirclePause size={14} aria-hidden="true" />}
            {paused ? "Resume simulated" : "Pause simulated"}
          </button>
        </div>

        <label className="grid gap-2">
          <span className="flex items-center justify-between text-xs text-dim">
            Quote skew
            <span className="tnum font-mono text-ink">{signedNumber(skew, 1)} bp</span>
          </span>
          <input
            type="range"
            min="-20"
            max="20"
            step="0.5"
            value={skew}
            onChange={(event) => onSkew(Number(event.target.value))}
            className="h-2 w-full cursor-pointer accent-brand"
            aria-label="Quote skew in basis points"
          />
          <span className="flex justify-between font-mono text-[10px] text-off"><span>Bid support</span><span>Ask support</span></span>
        </label>

        <label className="grid gap-2">
          <span className="flex items-center justify-between text-xs text-dim">
            Quote expiry
            <span className="tnum font-mono text-ink">{expiry}s</span>
          </span>
          <input
            type="range"
            min="5"
            max="45"
            step="1"
            value={expiry}
            onChange={(event) => onExpiry(Number(event.target.value))}
            className="h-2 w-full cursor-pointer accent-brand"
            aria-label="Quote expiry in seconds"
          />
          <span className="flex justify-between font-mono text-[10px] text-off"><span>5 sec</span><span>45 sec</span></span>
        </label>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-soft pt-3">
          <div>
            <dt className="text-[10px] tracking-[0.06em] text-faint uppercase">Matching</dt>
            <dd className="mt-1 font-mono text-xs text-dim">Private RFQ + book</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.06em] text-faint uppercase">Reservation</dt>
            <dd className="mt-1 font-mono text-xs text-dim">Required for firm</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.06em] text-faint uppercase">Hedge mode</dt>
            <dd className="mt-1 font-mono text-xs text-dim">Bounded route</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-[0.06em] text-faint uppercase">Authority</dt>
            <dd className="mt-1 font-mono text-xs text-dim">Policy fixture</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function RfqQueue({ selectedSeries }: { selectedSeries: string }) {
  const requests = makerCockpitSnapshot.rfqs.filter((rfq) => rfq.seriesId === selectedSeries);
  const series = makerCockpitSnapshot.series.find((item) => item.id === selectedSeries);
  const snapshot = useGatewaySnapshot();
  const localRequests = useMemo(
    () =>
      [...snapshot.rfqRequests]
        .filter((request) => request.authorization.intent.marketId.toLowerCase() === selectedSeries.toLowerCase())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [snapshot.rfqRequests, selectedSeries],
  );
  const runtimeOrigin = snapshot.environment.label;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <caption className="sr-only">Active simulated RFQ queue</caption>
          <thead className="border-b border-line bg-inset text-[10px] tracking-[0.07em] text-faint uppercase">
            <tr>
              <th className="h-8 px-3 font-medium lg:px-4">Request</th>
              <th className="h-8 px-2 font-medium">Side</th>
              <th className="h-8 px-2 text-right font-medium">Size</th>
              <th className="h-8 px-2 text-right font-medium">Time left</th>
              <th className="h-8 px-2 text-right font-medium">Hedge cost</th>
              <th className="h-8 px-3 text-right font-medium lg:px-4">Modeled edge</th>
            </tr>
          </thead>
          <tbody>
            {requests.length > 0 ? requests.map((rfq) => (
              <tr key={rfq.id} className="border-b border-line-soft last:border-0 hover:bg-raised/55">
                <td className="h-11 px-3 lg:px-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink">{rfq.id.toUpperCase()}</span>
                    <OriginTag label="SIMULATED" />
                  </div>
                  <span className="mt-0.5 block text-[10px] text-off">{rfq.counterpartyScope}</span>
                </td>
                <td className={`px-2 font-mono text-xs ${rfq.side === "BUY" ? "text-up" : "text-down"}`}>{rfq.side}</td>
                <td className="tnum px-2 text-right font-mono text-xs text-dim">{rfq.sizeLabel}</td>
                <td className="tnum px-2 text-right font-mono text-xs text-brand">{rfq.expiresInSeconds}s</td>
                <td className="tnum px-2 text-right font-mono text-xs text-dim">{rfq.modeledHedgeCostBps.toFixed(1)} bp</td>
                <td className="tnum px-3 text-right font-mono text-xs text-up lg:px-4">+{rfq.modeledEdgeBps.toFixed(1)} bp</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-xs text-faint">No active simulated RFQs for {series?.displayName}.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-3 py-2 lg:px-4">
          <span className="text-[10px] tracking-[0.07em] text-faint uppercase">Local user RFQs · read-only</span>
          <span className="tnum font-mono text-xs text-dim">{localRequests.length}</span>
        </div>
        <p className="border-b border-line-soft px-3 py-2 text-[10px] leading-snug text-off lg:px-4">
          Private RFQ records from {runtimeOrigin}; visible here for context only. This screen does not control, create, or clear them.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">Local user private RFQ records for the selected series</caption>
            <thead className="border-b border-line bg-inset text-[10px] tracking-[0.07em] text-faint uppercase">
              <tr>
                <th className="h-8 px-3 font-medium lg:px-4">Request</th>
                <th className="h-8 px-2 font-medium">Side</th>
                <th className="h-8 px-2 text-right font-medium">Lots</th>
                <th className="h-8 px-2 font-medium">State</th>
                <th className="h-8 px-2 text-right font-medium">Expiry / terminal</th>
                <th className="h-8 px-3 text-right font-medium lg:px-4">Selected solver</th>
              </tr>
            </thead>
            <tbody>
              {localRequests.length > 0 ? localRequests.map((request) => {
                const sideLabel = request.authorization.intent.side === "ENTER" ? "Enter" : "Exit";
                const lotsLabel = `${request.authorization.intent.lots}`;
                const selectedQuote = request.selectedQuoteId
                  ? (request.quotes.find((quote) => quote.id === request.selectedQuoteId) ?? null)
                  : null;
                const isTerminal = request.state === "EXECUTED" || request.state === "CANCELLED";
                const expired = Date.parse(request.expiresAt) <= Date.now();
                const expiryLabel = isTerminal
                  ? (request.state === "EXECUTED"
                    ? (request.receiptId ? `Executed · ${request.receiptId}` : "Executed")
                    : "Cancelled")
                  : (expired ? "Expired" : new Date(request.expiresAt).toLocaleTimeString());
                return (
                  <tr key={request.id} className="border-b border-line-soft last:border-0 hover:bg-raised/55">
                    <td className="h-11 px-3 lg:px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-ink">{request.id}</span>
                        <OriginTag label={runtimeOrigin.toUpperCase()} />
                      </div>
                      <span className="mt-0.5 block text-[10px] text-off">{runtimeOrigin}</span>
                    </td>
                    <td className="px-2 font-mono text-xs text-dim">{sideLabel}</td>
                    <td className="tnum px-2 text-right font-mono text-xs text-dim">{lotsLabel}</td>
                    <td className="px-2 font-mono text-xs text-dim">{request.state}</td>
                    <td className="tnum px-2 text-right font-mono text-xs text-dim">{expiryLabel}</td>
                    <td className="tnum px-3 text-right font-mono text-xs text-dim lg:px-4">
                      {selectedQuote ? selectedQuote.solverLabel : "-"}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-xs text-faint">No local user RFQs for {series?.displayName} in {runtimeOrigin}.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InventoryAndRisk({ selectedSeries }: { selectedSeries: string }) {
  const inventory = makerCockpitSnapshot.inventory.filter((position) => position.seriesId === selectedSeries);
  const risk = makerCockpitSnapshot.marketRisk.find((item) => item.seriesId === selectedSeries);

  return (
    <div className="grid divide-y divide-line lg:grid-cols-[1.12fr_0.88fr] lg:divide-x lg:divide-y-0">
      <div className="min-w-0">
        <div className="border-b border-line-soft px-3 py-2 lg:px-4">
          <span className="text-[10px] tracking-[0.07em] text-faint uppercase">Inventory and hedge exposure</span>
        </div>
        {inventory.map((position) => (
          <div key={position.id} className="grid grid-cols-[1.2fr_0.75fr_0.8fr] gap-3 px-3 py-3 lg:px-4">
            <div className="min-w-0">
              <p className="truncate text-xs text-ink">{position.label}</p>
              <p className="mt-1 truncate text-[10px] text-off">{position.hedgeVenue} / {position.hedgeStatus.toLowerCase()}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-faint">Net packages</p>
              <p className="tnum mt-1 font-mono text-xs text-dim">{signedNumber(position.netPackageQuantity, 2)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-faint">Delta</p>
              <p className={`tnum mt-1 font-mono text-xs ${position.deltaUsd >= 0 ? "text-up" : "text-down"}`}>{signedMoney(position.deltaUsd)}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 lg:p-4">
        <span className="text-[10px] tracking-[0.07em] text-faint uppercase">Per-market risk</span>
        {risk ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt className="text-[10px] text-faint">Quote utilization</dt>
              <dd className="tnum mt-1 font-mono text-sm text-ink">{risk.utilization.toFixed(1)}%</dd>
            </div>
            <div>
              <dt className="text-[10px] text-faint">Stress loss</dt>
              <dd className="tnum mt-1 font-mono text-sm text-down">{money.format(risk.stressLossUsd)}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-faint">Expected hedge</dt>
              <dd className="tnum mt-1 font-mono text-sm text-dim">{risk.expectedHedgeCostBps.toFixed(1)} bp</dd>
            </div>
            <div>
              <dt className="text-[10px] text-faint">Risk state</dt>
              <dd className={`mt-1 font-mono text-xs ${risk.state === "WITHIN_LIMIT" ? "text-up" : risk.state === "WATCH" ? "text-brand" : "text-down"}`}>{risk.state.replace("_", " ")}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </div>
  );
}

function CapitalPlane() {
  const total = makerCockpitSnapshot.capital.reduce((sum, item) => sum + item.amountUsd, 0);

  return (
    <div className="grid divide-y divide-line lg:grid-cols-4 lg:divide-x lg:divide-y-0">
      {makerCockpitSnapshot.capital.map((bucket) => {
        const tone = bucket.state === "AVAILABLE" ? "text-up" : bucket.state === "RECOVERY" ? "text-brand" : "text-dim";
        const share = Math.max(2, (bucket.amountUsd / total) * 100);
        return (
          <div key={bucket.state} className="px-3 py-3 lg:px-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-dim">{bucket.label}</span>
              <span className="text-[10px] text-off">{((bucket.amountUsd / total) * 100).toFixed(0)}%</span>
            </div>
            <p className={`tnum mt-1 font-mono text-base ${tone}`}>{money.format(bucket.amountUsd)}</p>
            <div aria-hidden="true" className="mt-2 h-0.5 bg-line-soft"><div className={`h-full ${bucket.state === "AVAILABLE" ? "bg-up" : bucket.state === "RECOVERY" ? "bg-brand" : "bg-dim"}`} style={{ width: `${share}%` }} /></div>
            <p className="mt-2 text-[10px] leading-snug text-off">{bucket.description}</p>
          </div>
        );
      })}
    </div>
  );
}

function SessionHealth() {
  return (
    <div className="divide-y divide-line-soft">
      {makerCockpitSnapshot.health.map((check) => (
        <div key={check.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5 lg:px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StateDot state={check.state} />
              <span className="truncate text-xs text-ink">{check.label}</span>
            </div>
            <span className="mt-1 block truncate pl-3.5 text-[10px] text-off">{check.source}</span>
          </div>
          <span className="tnum font-mono text-xs text-dim">{check.latencyMs === null ? "-" : `${check.latencyMs}ms`}</span>
          <span className="tnum font-mono text-[10px] text-faint">{check.lastUpdate}</span>
        </div>
      ))}
    </div>
  );
}

function KillSwitches({
  pausedScopes,
  onToggle,
}: {
  pausedScopes: Set<string>;
  onToggle: (scope: KillSwitchScope) => void;
}) {
  return (
    <div className="divide-y divide-line-soft">
      {makerCockpitSnapshot.killSwitches.map((scope) => {
        const paused = scope.active || pausedScopes.has(scope.id);
        return (
          <div key={scope.id} className="flex items-center justify-between gap-3 px-3 py-2.5 lg:px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-down" : "bg-up"}`} />
                <span className="truncate text-xs text-ink">{scope.label}</span>
              </div>
              <p className="mt-1 truncate pl-3.5 text-[10px] text-off">{scope.description}</p>
            </div>
            <button
              type="button"
              onClick={() => onToggle(scope)}
              className={`focus-ring h-7 shrink-0 cursor-pointer border px-2 font-mono text-[10px] transition-colors ${
                paused ? "border-line-strong text-dim hover:bg-raised" : "border-down/40 text-down hover:bg-down-soft"
              }`}
            >
              {paused ? "Resume sim." : "Pause sim."}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function MakerCockpit() {
  const [selectedSeriesId, setSelectedSeriesId] = useState(makerCockpitSnapshot.series[0].id);
  const [skew, setSkew] = useState(1.5);
  const [expiry, setExpiry] = useState(20);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [pausedScopes, setPausedScopes] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("No policy changes staged.");

  const selectedSeries = useMemo(
    () => makerCockpitSnapshot.series.find((series) => series.id === selectedSeriesId) ?? makerCockpitSnapshot.series[0],
    [selectedSeriesId],
  );
  const selectedRisk = makerCockpitSnapshot.marketRisk.find((risk) => risk.seriesId === selectedSeries.id);
  const sessionState: QuoteSessionState = sessionPaused ? "PAUSED" : makerCockpitSnapshot.session.state;

  const toggleSession = () => {
    setSessionPaused((wasPaused) => {
      const nextPaused = !wasPaused;
      setNotice(nextPaused ? "Simulated quote policy paused. No external route was called." : "Simulated quote policy resumed. No external route was called.");
      return nextPaused;
    });
  };

  const toggleScope = (scope: KillSwitchScope) => {
    setPausedScopes((current) => {
      const next = new Set(current);
      if (next.has(scope.id)) {
        next.delete(scope.id);
        setNotice(`${scope.label} simulated pause cleared. No external route was called.`);
      } else {
        next.add(scope.id);
        setNotice(`${scope.label} simulated pause staged. No external route was called.`);
      }
      return next;
    });
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app" aria-label="Setryn maker cockpit">
      <div className="mx-auto flex w-full max-w-[1720px] flex-col">
        <div className="flex flex-col gap-3 border-b border-line bg-app px-3 py-3 lg:flex-row lg:items-end lg:justify-between lg:px-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] tracking-[0.08em] text-faint uppercase">
              <span>Maker</span><span className="text-off">/</span><span>Quote operations</span><span className="text-off">/</span><span>Arbitrum Sepolia</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-lg font-medium text-ink">{selectedSeries.displayName}</h1>
              <span className="font-mono text-xs text-dim">{selectedSeries.template}</span>
              <OriginTag />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span className="flex items-center gap-1.5 text-dim"><span className="text-faint">Session</span><SessionState state={sessionState} /></span>
            <span className="tnum font-mono text-dim"><span className="font-sans text-faint">Snapshot </span>{(makerCockpitSnapshot.snapshot.ageMs / 1000).toFixed(1)}s</span>
            <span className="font-mono text-[10px] tracking-[0.06em] text-brand uppercase">Testnet simulation</span>
          </div>
        </div>

        <AssetStrip series={makerCockpitSnapshot.series} selected={selectedSeriesId} onSelect={setSelectedSeriesId} />

        <div className="grid border-b border-line bg-panel sm:grid-cols-2 xl:grid-cols-5 xl:divide-x xl:divide-line">
          <div className="border-b border-line px-3 py-2.5 sm:border-r sm:border-line xl:border-b-0 lg:px-4">
            <p className="text-[10px] tracking-[0.07em] text-faint uppercase">Firm quote capacity</p>
            <p className="tnum mt-1 font-mono text-base text-ink">{money.format(makerCockpitSnapshot.quoteLevels[selectedSeries.id].reduce((sum, level) => sum + level.firmCapacityUsd, 0))}</p>
            <p className="mt-0.5 text-[10px] text-off">Simulated reservation budget</p>
          </div>
          <div className="border-b border-line px-3 py-2.5 sm:border-b sm:border-line xl:border-b-0 lg:px-4">
            <p className="text-[10px] tracking-[0.07em] text-faint uppercase">Available capital</p>
            <p className="tnum mt-1 font-mono text-base text-up">{money.format(makerCockpitSnapshot.capital[0].amountUsd)}</p>
            <p className="mt-0.5 text-[10px] text-off">Before policy buffers</p>
          </div>
          <div className="border-b border-line px-3 py-2.5 sm:border-r sm:border-line xl:border-b-0 lg:px-4">
            <p className="text-[10px] tracking-[0.07em] text-faint uppercase">Quote utilization</p>
            <p className="tnum mt-1 font-mono text-base text-ink">{selectedRisk?.utilization.toFixed(1)}%</p>
            <p className="mt-0.5 text-[10px] text-off">{selectedRisk?.state.replace("_", " ").toLowerCase()}</p>
          </div>
          <div className="border-b border-line px-3 py-2.5 sm:border-b sm:border-line xl:border-b-0 lg:px-4">
            <p className="text-[10px] tracking-[0.07em] text-faint uppercase">Expected PnL</p>
            <p className="tnum mt-1 font-mono text-base text-up">{signedMoney(makerCockpitSnapshot.session.expectedPnlUsd)}</p>
            <p className="mt-0.5 text-[10px] text-off">Current simulated session</p>
          </div>
          <div className="px-3 py-2.5 lg:px-4">
            <p className="text-[10px] tracking-[0.07em] text-faint uppercase">Fill / toxicity</p>
            <p className="tnum mt-1 font-mono text-base text-ink">{makerCockpitSnapshot.quoteLevels[selectedSeries.id][0].fillProbability}% <span className="text-dim">/</span> {makerCockpitSnapshot.quoteLevels[selectedSeries.id][0].toxicityScore}</p>
            <p className="mt-0.5 text-[10px] text-off">First size level, modeled</p>
          </div>
        </div>

        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1.64fr)_minmax(330px,0.76fr)] lg:gap-4 lg:p-4">
          <Pane
            title="Quote surface"
            note={`${selectedSeries.quoteConvention} / ${selectedSeries.venueScope}`}
            tools={<><OriginTag /><span className="font-mono text-[10px] text-faint">{makerCockpitSnapshot.quoteLevels[selectedSeries.id][0].capacityOrigin.source}</span></>}
          >
            <QuoteLadder levels={makerCockpitSnapshot.quoteLevels[selectedSeries.id]} quoteUnit={selectedSeries.quoteUnit} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-inset px-3 py-2 lg:px-4">
              <span className="text-[10px] text-faint">All capacity is simulated and cannot execute.</span>
              <span className="text-[10px] text-off">Firm sim. requires a hypothetical reservation.</span>
            </div>
          </Pane>

          <Pane title="Quote policy" note="Local preview controls only" tools={<SlidersHorizontal size={15} className="text-faint" aria-hidden="true" />}>
            <QuotePolicy skew={skew} expiry={expiry} sessionState={sessionState} onSkew={setSkew} onExpiry={setExpiry} onToggle={toggleSession} />
          </Pane>

          <Pane title="Active RFQs" note="Requests remaining eligible under the simulated policy" tools={<span className="font-mono text-xs text-brand">{makerCockpitSnapshot.rfqs.filter((rfq) => rfq.seriesId === selectedSeries.id).length}</span>}>
            <RfqQueue selectedSeries={selectedSeries.id} />
          </Pane>

          <Pane title="Inventory discipline" note="Net package and hedge condition" tools={<OriginTag />}>
            <InventoryAndRisk selectedSeries={selectedSeries.id} />
          </Pane>

          <Pane title="Capital allocation" note="Maker capacity by state" className="lg:col-span-2" tools={<span className="font-mono text-[10px] text-faint">SIMULATED LEDGER</span>}>
            <CapitalPlane />
          </Pane>

          <Pane title="Session health" note="Dependency visibility, not an execution guarantee">
            <SessionHealth />
          </Pane>

          <Pane
            title="Scoped quote stops"
            note="Local control state only"
            tools={<ShieldAlert size={15} className="text-faint" aria-hidden="true" />}
          >
            <KillSwitches pausedScopes={pausedScopes} onToggle={toggleScope} />
          </Pane>
        </div>

        <div className="sticky bottom-0 z-10 flex min-h-9 items-center justify-between gap-3 border-t border-line bg-inset px-3 py-2 lg:px-4">
          <p aria-live="polite" className="min-w-0 truncate text-xs text-dim">{notice}</p>
          <span className="shrink-0 font-mono text-[10px] text-off">{makerCockpitSnapshot.session.id} / {makerCockpitSnapshot.snapshot.source}</span>
        </div>
      </div>
    </main>
  );
}
