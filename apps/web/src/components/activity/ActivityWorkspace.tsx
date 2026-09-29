"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Download, FileSearch, Search, Wallet, X } from "lucide-react";
import { useGatewaySnapshot } from "@/components/gateway/InternalGatewayProvider";
import { Tabs } from "@/components/terminal/primitives";
import { activityAttemptsFromGateway } from "@/lib/activity/types";
import { formatCompactUsd, formatLots } from "@/lib/terminal/format";
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
} from "./ledger-ui";
import {
  ATTEMPT_FILTERS,
  ORDER_FILTERS,
  matchesAttemptFilter,
  matchesOrderFilter,
  orderRouteLabel,
  toCsvCell,
  type AttemptFilter,
  type OrderFilter,
} from "./activity-view";
import { FillsBlotter, OrdersBlotter } from "./ActivityBlotters";
import { AttemptDetail, DataNotes, EmptyDetail, OrderDetail } from "./ActivityDetail";

type ActivityTab = "FILLS" | "ORDERS";

function FilterPills<T extends string>({
  items,
  value,
  counts,
  onChange,
  label,
}: {
  items: Array<{ id: T; label: string }>;
  value: T;
  counts: Record<T, number>;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(item.id)}
            className={`focus-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors duration-150 ${
              active
                ? "border-line-strong bg-raised text-ink"
                : "border-transparent text-faint hover:bg-raised/60 hover:text-dim"
            }`}
          >
            {item.label}
            <span className={`tnum font-mono text-[11px] ${active ? "text-dim" : "text-off"}`}>{counts[item.id]}</span>
          </button>
        );
      })}
    </div>
  );
}

function BlotterEmpty({ kind, filtered }: { kind: ActivityTab; filtered: boolean }) {
  const wallet = useWalletPrompt();
  if (!wallet.connected && !filtered) {
    return (
      <div className={`flex flex-col items-center px-6 py-14 text-center ${motion.fade}`}>
        <Wallet size={18} aria-hidden="true" className="text-faint" />
        <p className="mt-3 text-sm text-ink">Connect a wallet to load package activity.</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">
          Fills, orders, and receipts are reconstructed from the connected development chain for your account.
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
  return (
    <div className={`flex flex-col items-center px-6 py-14 text-center ${motion.fade}`}>
      <FileSearch size={18} aria-hidden="true" className="text-faint" />
      <p className="mt-3 text-sm text-ink">
        {kind === "FILLS" ? "No package attempts match this view." : "No package orders match this view."}
      </p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-faint">
        {kind === "FILLS"
          ? "A submitted package will appear here with its runtime chronology and local receipt. Indexed event data will replace this source when a chain adapter is connected."
          : "Every signed package order registered by your account appears here with its fill progress and final state."}
      </p>
      {!filtered ? (
        <Link href={DEFAULT_TRADE_HREF} className={`${BUTTON_QUIET} mt-4`}>
          Open package market
          <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

export function ActivityWorkspace() {
  const snapshot = useGatewaySnapshot();
  const now = useNow(15_000);
  const attempts = useMemo(() => activityAttemptsFromGateway(snapshot), [snapshot]);
  const orders = useMemo(
    () => [...snapshot.restingOrders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [snapshot.restingOrders],
  );
  const [tab, setTab] = useState<ActivityTab>("FILLS");
  const [filter, setFilter] = useState<AttemptFilter>("ALL");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const localReceipts = snapshot.receipts;
  const exportDisabled = localReceipts.length === 0;

  function handleExportLocalCsv() {
    if (localReceipts.length === 0) return;
    const header = ["receipt_id", "created_at", "market", "package", "package_side", "route", "lots", "requested_lots", "filled_lots", "cancelled_lots", "price", "fees", "realized_pnl_usd", "collateral_released_usd", "guarantee", "evidence", "order_hash", "fill_id", "transaction_reference"];
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
          receipt.requestedLots ?? receipt.lots,
          receipt.filledLots ?? receipt.lots,
          receipt.cancelledLots ?? 0,
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

  const normalized = query.trim().toLowerCase();
  const searchedAttempts = useMemo(
    () =>
      attempts.filter((attempt) =>
        !normalized
          ? true
          : [attempt.packageCode, attempt.marketId, attempt.routeLabel, attempt.orderHash, attempt.id]
              .join(" ")
              .toLowerCase()
              .includes(normalized),
      ),
    [attempts, normalized],
  );
  const visibleAttempts = searchedAttempts.filter((attempt) => matchesAttemptFilter(attempt, filter));
  const attemptCounts = Object.fromEntries(
    ATTEMPT_FILTERS.map((item) => [item.id, searchedAttempts.filter((attempt) => matchesAttemptFilter(attempt, item.id)).length]),
  ) as Record<AttemptFilter, number>;

  const searchedOrders = orders.filter((order) =>
    !normalized
      ? true
      : [order.packageCode, order.marketId, orderRouteLabel(order, snapshot), order.orderHash, order.id]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
  );
  const visibleOrders = searchedOrders.filter((order) => matchesOrderFilter(order, orderFilter));
  const orderCounts = Object.fromEntries(
    ORDER_FILTERS.map((item) => [item.id, searchedOrders.filter((order) => matchesOrderFilter(order, item.id)).length]),
  ) as Record<OrderFilter, number>;

  const selected = visibleAttempts.find((attempt) => attempt.id === selectedId) ?? visibleAttempts[0] ?? null;
  const selectedOrder = visibleOrders.find((order) => order.id === selectedOrderId) ?? visibleOrders[0] ?? null;

  const terminal = attempts.filter((attempt) => attempt.result === "COMPLETE" || attempt.result === "SIMULATED").length;
  const unknown = attempts.filter((attempt) => attempt.result === "UNKNOWN").length;
  const receipts = attempts.filter((attempt) => attempt.receipt).length;
  const filledLots = attempts.reduce((sum, attempt) => sum + attempt.filledLots, 0);
  const fees = attempts.reduce((sum, attempt) => sum + attempt.feeAmount, 0);
  const working = orders.filter((order) => order.state === "WORKING" || order.state === "PARTIALLY_FILLED").length;

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const selectAttempt = (id: string) => {
    setSelectedId(id);
    setSheetOpen(true);
  };
  const selectOrder = (id: string) => {
    setSelectedOrderId(id);
    setSheetOpen(true);
  };

  const detail =
    tab === "FILLS" ? (
      selected ? (
        <AttemptDetail attempt={selected} />
      ) : (
        <>
          <EmptyDetail>Select an attempt to inspect its execution record.</EmptyDetail>
          <DataNotes />
        </>
      )
    ) : selectedOrder ? (
      <OrderDetail order={selectedOrder} snapshot={snapshot} now={now} />
    ) : (
      <>
        <EmptyDetail>Select an order to inspect its fill progress and receipts.</EmptyDetail>
        <DataNotes />
      </>
    );

  return (
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-app p-1 lg:flex lg:flex-col lg:overflow-hidden">
      <div className="flex min-h-full flex-col gap-1 lg:min-h-0 lg:flex-1">
        <PageHeader
          eyebrow={
            <>
              <FileSearch size={11} aria-hidden="true" />
              Activity explorer
            </>
          }
          title="Package execution ledger"
          description="Review every package attempt, its result state, recorded runtime steps, and receipt evidence without mistaking local simulation for onchain settlement."
          right={
            <>
              <Chip tone="muted" title="Attempts come from the first-party browser runtime and connected development chain.">
                Runtime evidence only
              </Chip>
              <EnvironmentChip />
            </>
          }
        >
          <KpiStrip>
            <Kpi label="Recorded attempts" value={attempts.length} sub={`${terminal} terminal outcome${terminal === 1 ? "" : "s"}`} />
            <Kpi label="Filled lots" value={formatLots(filledLots)} sub="across all attempts" />
            <Kpi label="Fees paid" value={formatCompactUsd(fees)} sub="bounded by fee caps" />
            <Kpi label="Receipt records" value={receipts} sub="Runtime evidence only" />
            <Kpi label="Working orders" value={working} sub={`${orders.length} registered`} tone={working > 0 ? "text-brand" : "text-ink"} />
            <Kpi
              label="Unresolved state"
              value={unknown}
              tone={unknown > 0 ? "text-down" : "text-ink"}
              sub="Unknown results require reconciliation"
            />
          </KpiStrip>
        </PageHeader>

        <div className="grid min-h-0 flex-1 gap-1 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
          <Panel className={`flex min-h-[440px] flex-col lg:min-h-0 ${motion.mount}`} label="Activity blotter">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line pr-3">
              <Tabs
                items={[
                  { id: "FILLS", label: "Fills", badge: attempts.length },
                  { id: "ORDERS", label: "Orders", badge: orders.length },
                ]}
                value={tab}
                onChange={(id) => setTab(id as ActivityTab)}
                idBase="activity"
                className="no-scrollbar min-w-0 overflow-x-auto"
              />
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-[11px] text-faint xl:block">Local devnet export, not Arbitrum accounting</span>
                <button
                  type="button"
                  onClick={handleExportLocalCsv}
                  disabled={exportDisabled}
                  title="Local devnet export, not Arbitrum accounting"
                  className={`${BUTTON_QUIET} h-7 px-2.5`}
                >
                  <Download size={12} aria-hidden="true" />
                  <span className="hidden sm:inline">Export local CSV</span>
                  <span className="sm:hidden">CSV</span>
                </button>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              {tab === "FILLS" ? (
                <FilterPills items={ATTEMPT_FILTERS} value={filter} counts={attemptCounts} onChange={setFilter} label="Activity result filter" />
              ) : (
                <FilterPills items={ORDER_FILTERS} value={orderFilter} counts={orderCounts} onChange={setOrderFilter} label="Order state filter" />
              )}
              <label className="flex h-7 w-full items-center gap-2 rounded-md border border-line bg-inset px-2 transition-colors focus-within:border-line-strong sm:w-60">
                <Search size={13} aria-hidden="true" className="shrink-0 text-faint" />
                <span className="sr-only">Search activity</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Package, route, hash"
                  className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-off"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="focus-ring flex h-5 w-5 items-center justify-center rounded-sm text-faint hover:text-ink"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </label>
            </div>

            <div
              id={`activity-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`activity-tab-${tab}`}
              key={tab}
              className={`flex min-h-0 flex-1 flex-col ${motion.tabPanel}`}
            >
              {tab === "FILLS" ? (
                <FillsBlotter
                  attempts={visibleAttempts}
                  now={now}
                  selectedId={selected?.id ?? null}
                  onSelect={selectAttempt}
                  empty={<BlotterEmpty kind="FILLS" filtered={attempts.length > 0} />}
                />
              ) : (
                <OrdersBlotter
                  orders={visibleOrders}
                  snapshot={snapshot}
                  now={now}
                  selectedId={selectedOrder?.id ?? null}
                  onSelect={selectOrder}
                  empty={<BlotterEmpty kind="ORDERS" filtered={orders.length > 0} />}
                />
              )}
            </div>
            <div className="mt-auto flex h-8 shrink-0 items-center justify-between gap-3 border-t border-line px-3 text-[11px] text-faint">
              <span className="truncate">Newest first · grouped by UTC day</span>
              <span className="tnum hidden font-mono sm:block">
                {tab === "FILLS"
                  ? `${visibleAttempts.length} of ${attempts.length} attempts`
                  : `${visibleOrders.length} of ${orders.length} orders`}
              </span>
            </div>
          </Panel>

          <Panel as="aside" label="Activity detail" className={`hidden min-h-0 flex-col lg:flex ${motion.mount}`}>
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
              <span className="text-sm font-medium text-ink">{tab === "FILLS" ? "Attempt detail" : "Order detail"}</span>
            </div>
            {detail}
          </Panel>
        </div>
      </div>

      {sheetOpen && (tab === "FILLS" ? selected : selectedOrder) ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true" aria-label="Activity detail">
          <button
            type="button"
            aria-label="Close detail"
            onClick={() => setSheetOpen(false)}
            className={`absolute inset-0 bg-app/70 backdrop-blur-[2px] ${motion.scrim}`}
          />
          <div className={`relative flex max-h-[88dvh] flex-col overflow-hidden rounded-t-xl border-t border-line-strong bg-panel ${motion.sheet}`}>
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
              <span className="text-sm font-medium text-ink">{tab === "FILLS" ? "Attempt detail" : "Order detail"}</span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close detail"
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-md text-faint hover:text-ink"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {detail}
          </div>
        </div>
      ) : null}
    </main>
  );
}
