"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Lock, Search, ShieldCheck, X } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { Tabs } from "@/components/terminal/primitives";
import { DEFAULT_TRADE_HREF } from "@/lib/terminal/markets";
import {
  BUTTON_INK,
  BUTTON_QUIET,
  Chip,
  EnvironmentChip,
  Kpi,
  KpiStrip,
  PageHeader,
  Panel,
  motion,
  useNow,
  useWalletPrompt,
} from "@/components/activity/ledger-ui";
import { RfqBlotter } from "./RfqBlotter";
import { RfqDetail } from "./RfqDetail";
import { rfqView, type RfqView } from "./rfq-view";

type BlotterTab = "LIVE" | "HISTORY" | "ALL";

function BlotterEmpty({ tab }: { tab: BlotterTab }) {
  const wallet = useWalletPrompt();
  if (!wallet.connected) {
    return (
      <div className={`flex flex-col items-center px-6 py-14 text-center ${motion.fade}`}>
        <Lock size={18} aria-hidden="true" className="text-faint" />
        <p className="mt-3 text-sm text-ink">Connect a wallet to load your private RFQs.</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">
          Requests are read from the local production-parity chain for the connected taker only.
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={wallet.connect} disabled={wallet.connecting} className={BUTTON_INK}>
            {wallet.connecting ? "Connecting..." : "Connect wallet"}
          </button>
          <Link href={DEFAULT_TRADE_HREF} className={BUTTON_QUIET}>
            Open package market
          </Link>
        </div>
        {wallet.error ? <p className="mt-2 text-xs text-down">{wallet.error}</p> : null}
      </div>
    );
  }
  if (tab === "HISTORY") {
    return (
      <div className={`flex flex-col items-center px-6 py-14 text-center ${motion.fade}`}>
        <p className="text-sm text-ink">No executed or cancelled requests yet.</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">
          Executed requests keep their receipt link here. Cancelled requests remain visible without one.
        </p>
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center px-6 py-14 text-center ${motion.fade}`}>
      <p className="text-sm text-ink">No active private RFQ requests.</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">
        A private solver request created in a market terminal appears here until it is selected, executed, or
        cancelled.
      </p>
      <Link href={DEFAULT_TRADE_HREF} className={`${BUTTON_QUIET} mt-4`}>
        Open package market
        <ArrowUpRight size={12} aria-hidden="true" />
      </Link>
    </div>
  );
}

const FLOW = [
  {
    title: "Request in the terminal",
    detail: "Tick Private RFQ to solvers in a package ticket. The signed order and request are committed privately.",
  },
  {
    title: "Makers compete",
    detail: "Invited makers answer with firm, capacity-backed quotes. The best price for your side is highlighted.",
  },
  {
    title: "Select and settle",
    detail: "Choose a quote before it expires. Execution is atomic and the receipt links back here.",
  },
];

function DetailPlaceholder() {
  return (
    <div className={`flex min-h-0 flex-1 flex-col px-4 py-4 ${motion.fade}`}>
      <p className="text-xs text-faint">Select a request to inspect its quote competition.</p>
      <ol className="mt-4 space-y-0">
        {FLOW.map((step, index) => (
          <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
            {index < FLOW.length - 1 ? (
              <span aria-hidden="true" className="absolute top-6 bottom-0 left-[11px] w-px bg-line-strong" />
            ) : null}
            <span className="tnum relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised font-mono text-[11px] text-dim">
              {index + 1}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block text-xs text-ink">{step.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-faint">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-auto flex items-start gap-2 rounded-md border border-line bg-inset px-3 py-2.5 text-[11px] leading-relaxed text-faint">
        <ShieldCheck size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-dim" />
        Requests and selected quotes are committed to the local production-parity chain. Nothing on this page submits
        to Arbitrum Sepolia or mainnet.
      </div>
    </div>
  );
}

function matches(view: RfqView, query: string): boolean {
  if (!query) return true;
  const intent = view.request.authorization.intent;
  return [intent.packageCode, intent.marketId, intent.routeLabel, view.request.id, ...view.quotes.map((q) => q.quote.solverLabel)]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export function RfqWorkspace() {
  const snapshot = useGatewaySnapshot();
  const now = useNow();
  const [tab, setTab] = useState<BlotterTab>("LIVE");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const requests = useMemo(
    () => [...snapshot.rfqRequests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [snapshot.rfqRequests],
  );
  const views = requests.map((request) => rfqView(request, now));
  const live = views.filter((view) => view.active);
  const history = views.filter((view) => !view.active);
  const normalized = query.trim().toLowerCase();
  const visible = (tab === "LIVE" ? live : tab === "HISTORY" ? history : views).filter((view) =>
    matches(view, normalized),
  );
  const selected =
    views.find((view) => view.request.id === selectedId) ?? visible[0] ?? null;

  const liveQuotes = live.reduce((sum, view) => sum + view.quotes.length, 0);
  const makers = new Set(requests.flatMap((request) => request.quotes.map((quote) => quote.solverLabel))).size;
  const executed = requests.filter((request) => request.state === "EXECUTED").length;
  const lapsed = views.filter((view) => view.status === "EXPIRED" || view.status === "CANCELLED").length;
  const closedCount = executed + lapsed;

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const select = (id: string) => {
    setSelectedId(id);
    setSheetOpen(true);
  };

  const tabs = [
    { id: "LIVE", label: "Live", badge: live.length },
    { id: "HISTORY", label: "History", badge: history.length },
    { id: "ALL", label: "All", badge: views.length },
  ];

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1 lg:flex lg:flex-col lg:overflow-hidden">
      <div className="flex min-h-full flex-col gap-1 lg:min-h-0 lg:flex-1">
        <PageHeader
          eyebrow={
            <>
              <Lock size={11} aria-hidden="true" />
              Private RFQ ledger
            </>
          }
          title="Private RFQs"
          description="Private solver requests with firm, capacity-backed quote comparisons. Active requests resume in their market terminal. Receipts exist only for executed requests."
          right={
            <>
              <Chip
                tone="muted"
                title="Requests and selected quotes are committed to the local production-parity chain. Nothing on this page submits to Arbitrum Sepolia or mainnet."
              >
                Local chain only
              </Chip>
              <EnvironmentChip />
              <Link href={DEFAULT_TRADE_HREF} className={BUTTON_QUIET}>
                New request
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            </>
          }
        >
          <KpiStrip>
            <Kpi label="Live requests" value={live.length} tone={live.length > 0 ? "text-brand" : "text-ink"} sub="collecting or selected" />
            <Kpi label="Firm quotes on live" value={liveQuotes} sub="capacity-backed" />
            <Kpi label="Responding makers" value={makers} sub="across all requests" />
            <Kpi label="Executed" value={executed} sub="with receipts" tone={executed > 0 ? "text-up" : "text-ink"} />
            <Kpi
              label="Hit rate"
              value={closedCount > 0 ? `${Math.round((executed / closedCount) * 100)}%` : "—"}
              sub={`${lapsed} expired or cancelled`}
            />
          </KpiStrip>
        </PageHeader>

        <div className="grid min-h-0 flex-1 gap-1 lg:grid-cols-[minmax(0,1fr)_400px]">
          <Panel className={`flex min-h-[420px] flex-col lg:min-h-0 ${motion.mount}`} label="Request blotter">
            <div className="flex shrink-0 flex-col border-b border-line sm:flex-row sm:items-center sm:justify-between sm:pr-3">
              <Tabs
                items={tabs}
                value={tab}
                onChange={(id) => setTab(id as BlotterTab)}
                idBase="rfq"
                className="no-scrollbar min-w-0 overflow-x-auto"
              />
              <label className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-md border border-line bg-inset px-2 transition-colors focus-within:border-line-strong sm:mx-0 sm:mb-0 sm:w-60">
                <Search size={13} aria-hidden="true" className="shrink-0 text-faint" />
                <span className="sr-only">Search requests</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Package, request ID, maker"
                  className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-off"
                />
              </label>
            </div>
            <div
              id={`rfq-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`rfq-tab-${tab}`}
              key={tab}
              className={`flex min-h-0 flex-1 flex-col ${motion.tabPanel}`}
            >
              <RfqBlotter
                views={visible}
                now={now}
                selectedId={selected?.request.id ?? null}
                onSelect={select}
                empty={
                  normalized && (tab === "LIVE" ? live : tab === "HISTORY" ? history : views).length > 0 ? (
                    <p className="px-6 py-14 text-center text-xs text-faint">No requests match this search.</p>
                  ) : (
                    <BlotterEmpty tab={tab} />
                  )
                }
              />
            </div>
            <div className="mt-auto flex h-8 shrink-0 items-center justify-between gap-3 border-t border-line px-3 text-[11px] text-faint">
              <span className="truncate">Newest first · times in UTC</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-[3px] rounded-[1px] bg-brand" />
                  Best quote
                </span>
                <span className="hidden items-center gap-1.5 sm:flex">
                  <span aria-hidden="true" className="h-2 w-[3px] rounded-[1px] bg-dim" />
                  Competing
                </span>
              </span>
            </div>
          </Panel>

          <Panel as="aside" label="Request detail" className={`hidden min-h-0 flex-col lg:flex ${motion.mount}`}>
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
              <span className="text-sm font-medium text-ink">Request detail</span>
              {selected ? (
                <span className="tnum font-mono text-[11px] text-faint">{selected.request.authorization.intent.marketId}</span>
              ) : null}
            </div>
            {selected ? <RfqDetail view={selected} now={now} /> : <DetailPlaceholder />}
          </Panel>
        </div>
      </div>

      {sheetOpen && selected ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true" aria-label="Request detail">
          <button
            type="button"
            aria-label="Close request detail"
            onClick={() => setSheetOpen(false)}
            className={`absolute inset-0 bg-app/70 backdrop-blur-[2px] ${motion.scrim}`}
          />
          <div className={`relative flex max-h-[88dvh] flex-col overflow-hidden rounded-t-xl border-t border-line-strong bg-panel ${motion.sheet}`}>
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
              <span className="text-sm font-medium text-ink">Request detail</span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close request detail"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-md text-faint hover:text-ink"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <RfqDetail view={selected} now={now} />
          </div>
        </div>
      ) : null}
    </main>
  );
}
