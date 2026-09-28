"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileSearch,
  Filter,
  RadioTower,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { SectionLabel, StatusDot } from "@/components/terminal/primitives";
import { activityAttemptsFromGateway, type ActivityAttemptView, type ActivityResultState } from "@/lib/activity/types";
import { formatLots, formatNumber, formatUsd, priceUnitSuffix } from "@/lib/terminal/format";
import { findMarket } from "@/lib/terminal/markets";

type ActivityFilter = "ALL" | "TERMINAL" | "SIMULATED" | "UNKNOWN";

const FILTERS: Array<{ id: ActivityFilter; label: string }> = [
  { id: "ALL", label: "All attempts" },
  { id: "TERMINAL", label: "Terminal" },
  { id: "SIMULATED", label: "Local demo" },
  { id: "UNKNOWN", label: "Unknown" },
];

function shortHash(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function timestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function resultLabel(result: ActivityResultState): string {
  if (result === "COMPLETE") return "Complete";
  if (result === "SIMULATED") return "Simulated";
  if (result === "FAILED") return "Failed";
  return "Unknown";
}

function resultClass(result: ActivityResultState): string {
  if (result === "COMPLETE") return "text-up";
  if (result === "SIMULATED") return "text-brand";
  if (result === "FAILED") return "text-down";
  return "text-dim";
}

function ResultMark({ result }: { result: ActivityResultState }) {
  if (result === "COMPLETE") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (result === "FAILED") return <CircleAlert size={14} aria-hidden="true" />;
  if (result === "UNKNOWN") return <Clock3 size={14} aria-hidden="true" />;
  return <RadioTower size={14} aria-hidden="true" />;
}

function ResultState({ result }: { result: ActivityResultState }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${resultClass(result)}`}>
      <ResultMark result={result} />
      {resultLabel(result)}
    </span>
  );
}

function HashValue({ value, title }: { value: string; title: string }) {
  return (
    <span title={`${title}: ${value}`} className="block max-w-full truncate font-mono text-xs text-dim">
      {shortHash(value)}
    </span>
  );
}

function Surface({
  label,
  action,
  children,
  className = "",
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
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

function SummaryStrip({ attempts }: { attempts: ActivityAttemptView[] }) {
  const terminal = attempts.filter((attempt) => attempt.result === "COMPLETE" || attempt.result === "SIMULATED").length;
  const unknown = attempts.filter((attempt) => attempt.result === "UNKNOWN").length;
  const receipts = attempts.filter((attempt) => attempt.receipt).length;

  return (
    <section className="grid border border-line bg-panel sm:grid-cols-3">
      <div className="border-b border-line px-3 py-3 sm:border-r sm:border-b-0">
        <span className="text-xs text-faint">Recorded attempts</span>
        <strong className="mt-1 block font-mono text-lg font-medium text-ink">{attempts.length}</strong>
        <p className="mt-1 text-xs text-faint">{terminal} terminal outcome{terminal === 1 ? "" : "s"}</p>
      </div>
      <div className="border-b border-line px-3 py-3 sm:border-r sm:border-b-0">
        <span className="text-xs text-faint">Receipt records</span>
        <strong className="mt-1 block font-mono text-lg font-medium text-ink">{receipts}</strong>
        <p className="mt-1 text-xs text-faint">Runtime evidence only</p>
      </div>
      <div className="px-3 py-3">
        <span className="text-xs text-faint">Unresolved state</span>
        <strong className={`mt-1 block font-mono text-lg font-medium ${unknown > 0 ? "text-down" : "text-ink"}`}>{unknown}</strong>
        <p className="mt-1 text-xs text-faint">Unknown results require reconciliation</p>
      </div>
    </section>
  );
}

function Ledger({
  attempts,
  selectedId,
  onSelect,
}: {
  attempts: ActivityAttemptView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (attempts.length === 0) {
    return (
      <div className="flex min-h-[290px] flex-col items-center justify-center px-5 text-center">
        <FileSearch size={20} aria-hidden="true" className="text-faint" />
        <p className="mt-3 text-sm text-ink">No package attempts match this view.</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">
          A submitted package will appear here with its runtime chronology and local receipt. Indexed event data will replace this source when a chain adapter is connected.
        </p>
        <Link
          href="/trade/BTC-YC-24DEC26"
          className="focus-ring mt-4 inline-flex h-9 items-center rounded-md border border-line px-3 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
        >
          Open package market
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[910px] border-collapse text-left">
        <thead className="border-b border-line text-xs text-faint">
          <tr>
            <th className="px-3 py-2 font-medium">Attempt</th>
            <th className="px-3 py-2 font-medium">Outcome</th>
            <th className="px-3 py-2 text-right font-medium">Size</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 font-medium">Route</th>
            <th className="px-3 py-2 font-medium">Evidence</th>
            <th className="px-3 py-2 text-right font-medium">Recorded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {attempts.map((attempt) => {
            const market = findMarket(attempt.marketId);
            const selected = selectedId === attempt.id;
            return (
              <tr key={attempt.id} className={selected ? "bg-raised" : "hover:bg-raised/70"}>
                <td colSpan={7} className="p-0">
                  <button
                    type="button"
                    onClick={() => onSelect(attempt.id)}
                    className="focus-ring grid w-full grid-cols-[minmax(170px,1.2fr)_130px_90px_110px_minmax(180px,1.15fr)_minmax(150px,1fr)_120px] items-center text-left transition-colors"
                  >
                    <span className="min-w-0 px-3 py-2.5">
                      <span className="block truncate text-sm text-ink">{`${attempt.packageCode} · ${attempt.packageSide === "SHORT" ? "Short" : "Long"}`}</span>
                      <HashValue value={attempt.orderHash} title="Order hash" />
                    </span>
                    <span className="px-3 py-2.5"><ResultState result={attempt.result} /></span>
                    <span className="px-3 py-2.5 text-right font-mono text-xs text-ink">{`${formatLots(attempt.lots)} ${attempt.packageSide === "SHORT" ? "Short" : "Long"}`}</span>
                    <span className="px-3 py-2.5 text-right font-mono text-xs text-dim">
                      {market ? `${formatNumber(attempt.price, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}` : formatNumber(attempt.price, 2)}
                    </span>
                    <span className="min-w-0 px-3 py-2.5">
                      <span className="block truncate text-xs text-dim">{attempt.routeLabel}</span>
                      <span className="block truncate text-xs text-faint">{attempt.guarantee}</span>
                    </span>
                    <span className="min-w-0 px-3 py-2.5">
                      <span className="block truncate text-xs text-dim">{attempt.source.toLowerCase()} / {attempt.evidence.toLowerCase()}</span>
                      <span className="block truncate text-xs text-faint">{attempt.freshness.label}</span>
                    </span>
                    <span className="px-3 py-2.5 text-right font-mono text-xs text-dim">{timestamp(attempt.createdAt)}</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[minmax(105px,0.7fr)_minmax(0,1.3fr)] gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
      <span className="text-xs text-faint">{label}</span>
      <span className="min-w-0 text-right text-xs text-ink" title={hint}>{value}</span>
    </div>
  );
}

function AttemptDetail({ attempt }: { attempt: ActivityAttemptView | null }) {
  if (!attempt) {
    return (
      <Surface label="Attempt detail">
        <div className="flex min-h-[230px] items-center px-4 text-sm text-faint">Select an attempt to inspect its execution record.</div>
      </Surface>
    );
  }

  const market = findMarket(attempt.marketId);
  const referenceLabel = attempt.result === "SIMULATED" ? "Runtime reference" : "Transaction reference";
  const outcomeLabel = attempt.outcome === "CLOSED" ? "Closed" : attempt.outcome === "REDUCED" ? "Reduced" : "Opened";
  const sideLabel = attempt.packageSide === "SHORT" ? "Short" : "Long";

  return (
    <Surface
      label="Attempt detail"
      action={<ResultState result={attempt.result} />}
    >
      <div className="border-b border-line px-3 py-3">
        <p className="truncate text-sm text-ink">{attempt.packageCode}</p>
        <p className="mt-1 text-xs text-faint">{attempt.environment} / {attempt.source.toLowerCase()} source</p>
      </div>

      <DetailRow label="Outcome" value={`${outcomeLabel} ${sideLabel}`} />
      <DetailRow label="Package side" value={attempt.packageSide} />
      <DetailRow label="Order hash" value={<HashValue value={attempt.orderHash} title="Order hash" />} hint={attempt.orderHash} />
      <DetailRow label="Route" value={attempt.routeLabel} />
      <DetailRow label="Fill" value={`${formatLots(attempt.lots)} lots ${sideLabel.toLowerCase()} at ${market ? `${formatNumber(attempt.price, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}` : formatNumber(attempt.price, 2)}`} />
      <DetailRow label="Fees" value={formatUsd(attempt.feeAmount, 2)} />
      <DetailRow label="Guarantee" value={attempt.guarantee} />
      <DetailRow label="Evidence" value={`${attempt.evidence.toLowerCase()} / ${attempt.freshness.label}`} hint={attempt.freshness.detail} />

      {attempt.receipt ? (
        <div className="border-t border-line p-3">
          <p className="text-xs text-faint">{referenceLabel}</p>
          <HashValue value={attempt.receipt.transactionReference} title={referenceLabel} />
          <p className="mt-2 text-xs leading-relaxed text-faint">
            {attempt.result === "SIMULATED"
              ? "This identifier belongs to the local demo runtime. It has not been broadcast to Arbitrum and cannot be opened in an explorer."
              : "This reference will be linked to a chain receipt after indexed event reconciliation is available."}
          </p>
          <Link
            href={attempt.receipt.href}
            className="focus-ring mt-3 flex h-9 items-center justify-center rounded-md border border-line text-xs text-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            Open execution receipt
          </Link>
        </div>
      ) : null}
    </Surface>
  );
}

function Chronology({ attempt }: { attempt: ActivityAttemptView | null }) {
  if (!attempt) {
    return (
      <Surface label="Execution chronology">
        <div className="px-3 py-4 text-xs text-faint">No attempt selected.</div>
      </Surface>
    );
  }

  return (
    <Surface
      label="Execution chronology"
      action={<span className="text-xs text-faint">{attempt.steps.length} recorded steps</span>}
    >
      <ol className="divide-y divide-line">
        {attempt.steps.map((step, index) => (
          <li key={`${attempt.id}-${step.id}`} className="grid grid-cols-[24px_minmax(0,1fr)_auto] gap-2 px-3 py-2.5">
            <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border ${attempt.result === "FAILED" ? "border-down text-down" : "border-line-strong text-up"}`}>
              {attempt.result === "FAILED" && index === attempt.steps.length - 1 ? <CircleAlert size={10} aria-hidden="true" /> : <CheckCircle2 size={10} aria-hidden="true" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-ink">{step.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-faint">{step.detail}</span>
              {step.transactionReference ? <HashValue value={step.transactionReference} title="Runtime reference" /> : null}
            </span>
            <span className="whitespace-nowrap font-mono text-xs text-faint">{index === attempt.steps.length - 1 ? timestamp(step.occurredAt) : "Sequence"}</span>
          </li>
        ))}
      </ol>
    </Surface>
  );
}

function matchesFilter(attempt: ActivityAttemptView, filter: ActivityFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "SIMULATED") return attempt.result === "SIMULATED";
  if (filter === "UNKNOWN") return attempt.result === "UNKNOWN";
  return attempt.result === "COMPLETE" || attempt.result === "SIMULATED" || attempt.result === "FAILED";
}

function toCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.includes("\"") || text.includes(",") || text.includes("\n") || text.includes("\r")) {
    return "\"" + text.replaceAll("\"", "\"\"") + "\"";
  }
  return text;
}

export function ActivityWorkspace() {
  const snapshot = useGatewaySnapshot();
  const attempts = useMemo(() => activityAttemptsFromGateway(snapshot), [snapshot]);
  const [filter, setFilter] = useState<ActivityFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const localReceipts = snapshot.receipts;
  const exportDisabled = localReceipts.length === 0;

  function handleExportLocalCsv() {
    if (localReceipts.length === 0) return;
    const header = ["receipt_id", "created_at", "market", "package", "package_side", "route", "lots", "price", "fees", "realized_pnl_usd", "collateral_released_usd", "guarantee", "evidence", "order_hash", "fill_id", "transaction_reference"];
    const lines = [header.join(",")];
    for (const receipt of localReceipts) {
      lines.push(
        [
          receipt.id,
          receipt.createdAt,
          receipt.marketId,
          receipt.packageCode,
          receipt.packageSide,
          receipt.routeLabel,
          receipt.lots,
          receipt.price,
          receipt.fees,
          receipt.realizedPnlUsd,
          receipt.collateralReleasedUsd,
          receipt.guarantee,
          receipt.evidence,
          receipt.orderHash,
          receipt.fillId,
          receipt.transactionHash,
        ]
          .map(toCsvCell)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "setryn-local-receipts.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const visibleAttempts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return attempts.filter((attempt) => {
      if (!matchesFilter(attempt, filter)) return false;
      if (!normalized) return true;
      return [attempt.packageCode, attempt.marketId, attempt.routeLabel, attempt.orderHash, attempt.id]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [attempts, filter, query]);

  const selected = visibleAttempts.find((attempt) => attempt.id === selectedId) ?? visibleAttempts[0] ?? null;

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-3 sm:p-5 lg:p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2">
              <FileSearch size={17} aria-hidden="true" className="text-dim" />
              <SectionLabel>Activity explorer</SectionLabel>
            </div>
            <h1 className="mt-2 text-xl font-medium text-ink">Package execution ledger</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-dim">
              Review every package attempt, its result state, recorded runtime steps, and receipt evidence without mistaking local simulation for onchain settlement.
            </p>
          </div>
          <div className="flex items-center gap-2 border border-line bg-panel px-3 py-2">
            <StatusDot ok />
            <div>
              <p className="text-xs text-ink">{snapshot.environment.label}</p>
              <p className="text-xs text-faint">{snapshot.environment.evidence.toLowerCase()} evidence</p>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <SummaryStrip attempts={attempts} />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <Surface
              label="Attempt ledger"
              action={
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs text-faint md:block">Local browser demo export, not Arbitrum accounting</span>
                  <button
                    type="button"
                    onClick={handleExportLocalCsv}
                    disabled={exportDisabled}
                    title="Local browser demo export, not Arbitrum accounting"
                    className="focus-ring inline-flex h-7 items-center rounded-md border border-line px-2 text-xs text-dim transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Export local CSV
                  </button>
                  <span className="text-xs text-faint">Newest first</span>
                </div>
              }
            >
              <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="no-scrollbar -mx-1 flex min-w-0 overflow-x-auto px-1" role="tablist" aria-label="Activity result filter">
                  {FILTERS.map((item) => {
                    const active = filter === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setFilter(item.id)}
                        className={`focus-ring relative h-8 shrink-0 px-2.5 text-xs transition-colors ${active ? "text-ink" : "text-faint hover:text-dim"}`}
                      >
                        {item.label}
                        <span className={`absolute inset-x-2 bottom-0 h-px ${active ? "bg-brand" : "bg-transparent"}`} />
                      </button>
                    );
                  })}
                </div>
                <label className="flex h-8 w-full items-center gap-2 border border-line bg-inset px-2 sm:w-56">
                  <Search size={13} aria-hidden="true" className="shrink-0 text-faint" />
                  <span className="sr-only">Search attempts</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Package, route, hash"
                    className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-off"
                  />
                </label>
              </div>
              <Ledger attempts={visibleAttempts} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
            </Surface>

            <Chronology attempt={selected} />
          </div>

          <aside className="min-w-0 space-y-4">
            <AttemptDetail attempt={selected} />
            <Surface label="Data boundary" action={<ShieldCheck size={14} aria-hidden="true" className="text-faint" />}>
              <div className="px-3 py-3 text-xs leading-relaxed text-faint">
                Attempts currently come from the first-party browser runtime. An indexed contract projection can supply the same typed ledger rows later, with source, evidence, freshness, and result state preserved.
              </div>
            </Surface>
            <Surface label="Result handling" action={<Filter size={14} aria-hidden="true" className="text-faint" />}>
              <div className="divide-y divide-line">
                <div className="px-3 py-2.5 text-xs text-faint"><span className="text-ink">Complete</span> has terminal evidence.</div>
                <div className="px-3 py-2.5 text-xs text-faint"><span className="text-brand">Simulated</span> stays local and is never an explorer claim.</div>
                <div className="px-3 py-2.5 text-xs text-faint"><span className="text-dim">Unknown</span> remains visible until a reconciler resolves it.</div>
              </div>
            </Surface>
          </aside>
        </div>
      </div>
    </main>
  );
}
