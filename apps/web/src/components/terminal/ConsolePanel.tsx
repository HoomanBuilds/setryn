"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { EmptyState, SOURCE_LABEL, SourceMark, Tabs, tone } from "@/components/terminal/primitives";
import { CONSOLE_TABS } from "@/lib/terminal/console";
import {
  formatDuration,
  formatLotCount,
  formatLots,
  formatNumber,
  formatSigned,
  formatSignedUsd,
  formatUsd,
  priceUnitSuffix,
} from "@/lib/terminal/format";
import { packageLabel } from "@/lib/terminal/markets";
import { strategyPnl } from "@/lib/portfolio/model";
import type {
  ConsoleTabId,
  ConsoleData,
  FillRecord,
  LiquiditySource,
  PackageMarket,
  ReceiptRecord,
  StrategyRecord,
} from "@/lib/terminal/types";
import type {
  ExecutionPosition,
  ExecutionReceipt,
  GatewayExecution,
  RestingPackageOrder,
} from "@/lib/internal-gateway/types";
import { platformNow } from "@/lib/terminal/clock";

const ADVERSE = new Set(["REJECTED", "SUBMISSION_UNKNOWN", "RECONCILING", "EXPIRED", "CANCELLED"]);

function stateLabel(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function resolveRuntimeConsoleMarket(
  markets: readonly PackageMarket[],
  marketId: string,
): PackageMarket {
  const market = markets.find((candidate) => candidate.id === marketId);
  if (!market) {
    throw new Error(`Unknown runtime market: ${marketId}`);
  }
  return market;
}

function State({ value }: { value: string }) {
  return (
    <span className={ADVERSE.has(value) ? "text-down" : "text-dim"}>{stateLabel(value)}</span>
  );
}

const FILL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatFillAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = FILL_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

function sourceForRouteLabel(routeLabel: string): LiquiditySource {
  const normalized = routeLabel.toLowerCase();
  if (normalized.includes("implied")) return "IMPLIED";
  if (normalized.includes("solver")) return "SOLVER_FIRM";
  return "DIRECT";
}

function tifDisplay(order: RestingPackageOrder): { text: string; title?: string } {
  const base = baseTifDisplay(order);
  return order.postOnly ? { ...base, text: `${base.text} · Post` } : base;
}

function baseTifDisplay(order: RestingPackageOrder): { text: string; title?: string } {
  if (order.timeInForce !== "GTD") return { text: order.timeInForce };
  if (typeof order.expiresAt !== "string" || !Number.isFinite(Date.parse(order.expiresAt))) {
    return { text: "GTD" };
  }
  const remainingMs = Date.parse(order.expiresAt) - platformNow();
  const title = new Date(order.expiresAt).toLocaleString();
  if (remainingMs <= 0) return { text: "GTD · expired", title };
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  return { text: `GTD · ${formatDuration(remainingSeconds)} left`, title };
}

const TH = "h-8 px-3 py-2 text-left font-normal whitespace-nowrap";
const TD = "px-3 py-2.5 align-top";
const NUM = "tnum px-3 py-2.5 text-right align-top font-mono text-ink whitespace-nowrap";

function Table({
  minWidth,
  head,
  children,
  empty = null,
}: {
  minWidth: number;
  head: { label: string; numeric?: boolean }[];
  children: ReactNode;
  /** Shown under the column headers when the table has no rows, like an exchange blotter. */
  empty?: ReactNode;
}) {
  return (
    <div className="scroll-thin h-full min-w-0 overflow-auto">
      <table
        className="w-full border-collapse text-xs"
        style={{ minWidth: `${minWidth}px` }}
      >
        <thead className="sticky top-0 z-10 bg-panel text-faint">
          <tr className="border-b border-line">
            {head.map((cell) => (
              <th
                key={cell.label}
                scope="col"
                className={`${TH} ${cell.numeric ? "text-right" : ""}`}
              >
                {cell.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="p-0">
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

function Tr({ highlight, children }: { highlight: boolean; children: ReactNode }) {
  return <tr className={highlight ? "bg-raised/50" : undefined}>{children}</tr>;
}

export function ConsolePanel({
  market,
  markets,
  tab,
  onTab,
  scoped,
  onScopedChange,
  runtimePositions = [],
  runtimeReceipts = [],
  runtimeRestingOrders = [],
  runtimeExecutions = [],
  onCancelRestingOrder,
  onAmendRestingOrder,
}: {
  market: PackageMarket;
  markets: readonly PackageMarket[];
  tab: ConsoleTabId;
  onTab: (tab: ConsoleTabId) => void;
  scoped: boolean;
  onScopedChange: (scoped: boolean) => void;
  runtimePositions?: ExecutionPosition[];
  runtimeReceipts?: ExecutionReceipt[];
  runtimeRestingOrders?: RestingPackageOrder[];
  runtimeExecutions?: GatewayExecution[];
  onCancelRestingOrder?: (orderId: string) => void;
  onAmendRestingOrder?: (orderId: string) => void;
}) {
  const runtimeStrategies: StrategyRecord[] = runtimePositions.map((position) => ({
    id: position.id,
    marketId: position.marketId,
    side: position.side,
    lots: position.lots,
    entryPrice: position.entryPrice,
    initialMargin: position.collateral,
    maintenanceMargin: position.collateral * 0.75,
    attribution: { carry: 0, funding: 0, fees: 0, residual: 0 },
    nextEvent: "New package position. Lifecycle monitoring is active.",
    state: position.state,
  }));
  const runtimeReceiptRows: Array<ReceiptRecord & { href?: string }> = runtimeReceipts.map(
    (receipt) => ({
      id: receipt.id,
      marketId: receipt.marketId,
      package: `${receipt.packageCode} · ${receipt.packageSide === "SHORT" ? "Short" : "Long"}`,
      kind: "BEST_EXECUTION",
      commitment: `${receipt.orderHash.slice(0, 10)}...${receipt.orderHash.slice(-6)}`,
      state: "READY",
      detail: `${receipt.packageSide === "SHORT" ? "Short" : "Long"} · ${receipt.routeLabel}. ${receipt.guarantee}. ${receipt.evidence.toLowerCase()} evidence.`,
      href: `/activity/receipts/${receipt.id}`,
    }),
  );
  const runtimeFillRows: FillRecord[] = runtimeExecutions.map((execution) => {
    const receipt = execution.result.receipt;
    const rowMarket = markets.find((candidate) => candidate.id === receipt.marketId);
    const price = rowMarket
      ? `${formatNumber(receipt.price, rowMarket.priceDecimals)} ${priceUnitSuffix(rowMarket.priceUnit)}`
      : `${formatNumber(receipt.price, 2)}`;
    return {
      id: receipt.fillId,
      marketId: receipt.marketId,
      package: rowMarket ? packageLabel(rowMarket) : receipt.packageCode,
      side: execution.result.outcome === "OPENED" ? "ENTER" : "EXIT",
      lots: receipt.lots,
      price,
      source: sourceForRouteLabel(receipt.routeLabel),
      fee: formatUsd(receipt.fees, 2),
      at: formatFillAt(receipt.createdAt),
    };
  });
  const keep = <T extends { marketId: string }>(rows: T[]) =>
    scoped ? rows.filter((row) => row.marketId === market.id) : rows;

  const strategies = keep(runtimeStrategies);
  const runtimeRestingOrderRows = keep(runtimeRestingOrders);
  const rfqs = keep<ConsoleData["rfqs"][number]>([]);
  const fills = keep(runtimeFillRows);
  const recovery = keep<ConsoleData["recovery"][number]>([]);
  const receipts = keep(runtimeReceiptRows);

  const counts: Record<ConsoleTabId, number> = {
    strategies: strategies.length,
    orders: runtimeRestingOrderRows.length,
    rfqs: rfqs.length,
    fills: fills.length,
    recovery: recovery.length,
    receipts: receipts.length,
  };

  const empty = (
    <EmptyState>
      <span>
        {`No ${tab} for ${market.name} in the connected account. `}
        <button
          type="button"
          onClick={() => onScopedChange(false)}
          className="focus-ring rounded-sm text-ink underline underline-offset-2"
        >
          Show all markets
        </button>
      </span>
    </EmptyState>
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-line bg-panel lg:border-t-0">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line pr-3 lg:pr-4">
        <Tabs
          items={CONSOLE_TABS.map((item) => ({ ...item, badge: counts[item.id] }))}
          value={tab}
          onChange={(id) => onTab(id as ConsoleTabId)}
          idBase="console"
          className="no-scrollbar min-w-0 overflow-x-auto"
        />
        <button
          type="button"
          onClick={() => onScopedChange(!scoped)}
          aria-pressed={scoped}
          className="focus-ring hidden h-7 shrink-0 rounded-sm px-2 text-xs text-dim transition-colors hover:text-ink sm:block"
        >
          {scoped ? `Scoped to ${market.name}` : "All markets"}
        </button>
      </div>

      <div
        key={tab}
        id={`console-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`console-tab-${tab}`}
        className="panel-in min-h-0 min-w-0 flex-1"
      >
        {tab === "strategies" ? (
          (
            <Table
              empty={strategies.length === 0 ? empty : null}
              minWidth={900}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Lots", numeric: true },
                { label: "Entry", numeric: true },
                { label: "Mark", numeric: true },
                { label: "Total PnL", numeric: true },
                { label: "State" },
                { label: "Next lifecycle event" },
              ]}
            >
              {strategies.map((row) => {
                const rowMarket = resolveRuntimeConsoleMarket(markets, row.marketId);
                const unit = priceUnitSuffix(rowMarket.priceUnit);
                const pnl = strategyPnl(row);
                return (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{`${packageLabel(rowMarket)} · ${row.side === "SHORT" ? "Short" : "Long"}`}</td>
                  <td className={NUM}>{formatSigned(row.lots, 0)}</td>
                  <td className={NUM}>
                    {`${formatNumber(row.entryPrice, rowMarket.priceDecimals)} ${unit}`}
                  </td>
                  <td className={NUM}>
                    {`${formatNumber(rowMarket.netPrice, rowMarket.priceDecimals)} ${unit}`}
                  </td>
                  <td className={`${NUM} ${tone(pnl)}`}>
                    {formatSignedUsd(pnl, 2)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.nextEvent}</td>
                </Tr>
                );
              })}
            </Table>
          )
        ) : null}

        {tab === "orders" ? (
          (
            <Table
              empty={runtimeRestingOrderRows.length === 0 ? empty : null}
              minWidth={1000}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Side" },
                { label: "Filled", numeric: true },
                { label: "Limit", numeric: true },
                { label: "TIF" },
                { label: "Route" },
                { label: "State" },
                { label: "Detail" },
              ]}
            >
              {runtimeRestingOrderRows.map((order) => {
                const rowMarket = resolveRuntimeConsoleMarket(markets, order.marketId);
                const unit = priceUnitSuffix(rowMarket.priceUnit);
                const live = order.state === "WORKING" || order.state === "PARTIALLY_FILLED";
                const cancellable = live && onCancelRestingOrder;
                const amendable =
                  live && order.marketId === market.id && onAmendRestingOrder;
                const filledLots =
                  typeof order.filledLots === "number" && Number.isFinite(order.filledLots)
                    ? order.filledLots
                    : order.state === "FILLED"
                      ? order.lots
                      : 0;
                const remainingLots =
                  typeof order.remainingLots === "number" && Number.isFinite(order.remainingLots)
                    ? order.remainingLots
                    : Math.max(0, order.lots - filledLots);
                const tif = tifDisplay(order);
                const latestReceipt = order.receiptId ?? "unavailable";
                const detail =
                  order.state === "FILLED"
                    ? `Filled onchain. Receipt ${latestReceipt}.`
                    : order.state === "PARTIALLY_FILLED"
                      ? `${formatLotCount(remainingLots)} working. Latest receipt ${latestReceipt}.`
                      : order.state === "CANCELLED"
                        ? filledLots > 1e-9
                          ? `Cancelled onchain after ${formatLotCount(filledLots)} filled. Latest receipt ${latestReceipt}.`
                          : "Cancelled onchain without a fill."
                        : order.state === "EXPIRED"
                          ? filledLots > 1e-9
                            ? `Expired after ${formatLotCount(filledLots)} filled. Latest receipt ${latestReceipt}.`
                            : "Expired without a fill."
                          : order.state === "REPLACED"
                            ? `Replaced by ${order.replacedByOrderId ?? "unknown"}. New queue priority.`
                            : order.replacesOrderId
                              ? `Replaces ${order.replacesOrderId}. New queue priority.`
                              : `Resting onchain with ${formatLotCount(remainingLots)} available.`;
                return (
                  <Tr key={order.id} highlight={!scoped && order.marketId === market.id}>
                    <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{order.id}</td>
                    <td className={`${TD} whitespace-nowrap text-ink`}>{packageLabel(rowMarket)}</td>
                    <td className={`${TD} whitespace-nowrap text-dim`}>
                      {`${order.side === "ENTER" ? "Enter" : "Exit"} ${order.packageSide === "SHORT" ? "Short" : "Long"}`}
                    </td>
                    <td className={NUM}>
                      {`${formatLots(filledLots)} / ${formatLots(order.lots)}`}
                    </td>
                    <td className={NUM}>
                      {`${formatNumber(order.limitPrice, rowMarket.priceDecimals)} ${unit}`}
                    </td>
                    <td className={`${TD} tnum font-mono whitespace-nowrap text-dim`} title={tif.title}>
                      {tif.text}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-dim`}>{order.routeLabel}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <State value={order.state} />
                    </td>
                    <td className={`${TD} text-faint`}>
                      <span className="flex items-start justify-between gap-2">
                        <span>{detail}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {amendable ? (
                            <button
                              type="button"
                              aria-label={`Amend ${order.id}`}
                              onClick={() => onAmendRestingOrder?.(order.id)}
                              className="focus-ring shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-dim transition-colors hover:text-ink"
                            >
                              Amend
                            </button>
                          ) : null}
                          {cancellable ? (
                            <button
                              type="button"
                              aria-label={`Cancel ${order.id}`}
                              onClick={() => onCancelRestingOrder?.(order.id)}
                              className="focus-ring shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-dim transition-colors hover:text-ink"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </span>
                      </span>
                    </td>
                  </Tr>
                );
              })}
            </Table>
          )
        ) : null}

        {tab === "rfqs" ? (
          (
            <Table
              empty={rfqs.length === 0 ? empty : null}
              minWidth={980}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Lots", numeric: true },
                { label: "Responses", numeric: true },
                { label: "Best quote" },
                { label: "Closes in", numeric: true },
                { label: "State" },
                { label: "Disclosure" },
              ]}
            >
              {rfqs.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={NUM}>{formatLots(row.lots)}</td>
                  <td className={NUM}>{`${row.responded} / ${row.invited}`}</td>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-ink`}>{row.best}</td>
                  <td className={`${NUM} ${row.closesInSeconds > 0 ? "text-dim" : "text-off"}`}>
                    {row.closesInSeconds > 0 ? formatDuration(row.closesInSeconds) : "closed"}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.disclosure}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}

        {tab === "fills" ? (
          (
            <Table
              empty={fills.length === 0 ? empty : null}
              minWidth={900}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Side" },
                { label: "Lots", numeric: true },
                { label: "Price", numeric: true },
                { label: "Source" },
                { label: "Fee", numeric: true },
                { label: "Filled at" },
              ]}
            >
              {fills.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>
                    {row.side === "ENTER" ? "Enter" : "Exit"}
                  </td>
                  <td className={NUM}>{formatLots(row.lots)}</td>
                  <td className={NUM}>{row.price}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>
                    <span className="flex items-center gap-1.5">
                      <SourceMark source={row.source} />
                      {SOURCE_LABEL[row.source]}
                    </span>
                  </td>
                  <td className={NUM}>{row.fee}</td>
                  <td className={`${TD} whitespace-nowrap text-faint`}>{row.at}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}

        {tab === "recovery" ? (
          (
            <Table
              empty={recovery.length === 0 ? empty : null}
              minWidth={980}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Stage" },
                { label: "State" },
                { label: "What happened" },
                { label: "Next action" },
              ]}
            >
              {recovery.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>{row.id}</td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>{row.stage}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.detail}</td>
                  <td className={`${TD} text-dim`}>{row.nextAction}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}

        {tab === "receipts" ? (
          (
            <Table
              empty={receipts.length === 0 ? empty : null}
              minWidth={900}
              head={[
                { label: "ID" },
                { label: "Package" },
                { label: "Receipt kind" },
                { label: "Commitment" },
                { label: "State" },
                { label: "Detail" },
              ]}
            >
              {receipts.map((row) => (
                <Tr key={row.id} highlight={!scoped && row.marketId === market.id}>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-faint`}>
                    {"href" in row && row.href ? (
                      <Link href={row.href} className="focus-ring text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                        {row.id}
                      </Link>
                    ) : (
                      row.id
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-ink`}>{row.package}</td>
                  <td className={`${TD} whitespace-nowrap text-dim`}>{stateLabel(row.kind)}</td>
                  <td className={`${TD} tnum font-mono whitespace-nowrap text-ink`}>
                    {row.commitment}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <State value={row.state} />
                  </td>
                  <td className={`${TD} text-faint`}>{row.detail}</td>
                </Tr>
              ))}
            </Table>
          )
        ) : null}
      </div>
    </section>
  );
}
