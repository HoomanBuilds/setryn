"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, FileCheck2 } from "lucide-react";
import type { ActivityAttemptView } from "@/lib/activity/types";
import type { GatewaySnapshot, RestingPackageOrder } from "@/lib/internal-gateway/types";
import { formatLots, formatUsd } from "@/lib/terminal/format";
import {
  Chip,
  formatUtcClockTime,
  formatUtcFull,
  middleTruncate,
  motion,
  useChangeCount,
  utcDay,
} from "./ledger-ui";
import {
  ORDER_STATE_LABEL,
  ORDER_STATE_TONE,
  RESULT_LABEL,
  RESULT_TONE,
  groupByDay,
  marketPrice,
  orderRouteLabel,
  outcomeLabel,
  receiptsForOrder,
  sideLabel,
} from "./activity-view";

/* ------------------------------------------------------------------ */
/* Shared blotter scaffolding                                          */
/* ------------------------------------------------------------------ */

function HeaderRow({ grid, cells }: { grid: string; cells: Array<{ label: string; right?: boolean; className?: string }> }) {
  return (
    <div role="row" className={`${grid} h-8 border-b border-line bg-panel text-[11px] text-faint`}>
      {cells.map((cell) => (
        <span
          key={cell.label}
          role="columnheader"
          className={`truncate px-3 ${cell.right ? "text-right" : ""} ${cell.className ?? ""}`}
        >
          {cell.label}
        </span>
      ))}
    </div>
  );
}

function DayHeader({ label, meta }: { label: string; meta: ReactNode }) {
  return (
    <div
      role="row"
      className="sticky top-8 z-[5] flex h-7 items-center justify-between gap-3 border-b border-line bg-inset/95 px-3 text-[11px] backdrop-blur-sm"
    >
      <span role="rowheader" className="font-medium tracking-[0.04em] text-dim uppercase">
        {label}
      </span>
      <span className="tnum font-mono text-faint">{meta}</span>
    </div>
  );
}

function Flash({ value }: { value: string }) {
  const changes = useChangeCount(value);
  return changes > 0 ? (
    <span key={changes} aria-hidden="true" className={`pointer-events-none absolute inset-0 ${motion.flash}`} />
  ) : null;
}

function rowClass(selected: boolean): string {
  return `${motion.row} relative cursor-pointer border-b border-line-soft ${
    selected ? `bg-raised ${motion.rowSelected}` : "hover:bg-raised/60"
  }`;
}

/* ------------------------------------------------------------------ */
/* Fills                                                               */
/* ------------------------------------------------------------------ */

const FILL_GRID =
  "grid grid-cols-[80px_minmax(170px,1.3fr)_104px_112px_100px_96px_minmax(150px,1fr)_36px] 2xl:grid-cols-[80px_minmax(170px,1.3fr)_104px_112px_100px_96px_minmax(150px,1fr)_minmax(150px,0.9fr)_36px] items-center";

const FILL_HEAD = [
  { label: "Time" },
  { label: "Package" },
  { label: "Result" },
  { label: "Filled", right: true },
  { label: "Price", right: true },
  { label: "Fee", right: true },
  { label: "Route" },
  { label: "Evidence", className: "hidden 2xl:block" },
  { label: "" },
];

function sizeText(attempt: ActivityAttemptView): string {
  return attempt.cancelledLots > 1e-9
    ? `${formatLots(attempt.filledLots)} / ${formatLots(attempt.requestedLots)}`
    : formatLots(attempt.filledLots);
}

function FillRow({
  attempt,
  index,
  selected,
  onSelect,
}: {
  attempt: ActivityAttemptView;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const side = sideLabel(attempt.packageSide);
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={() => onSelect(attempt.id)}
      style={{ ["--i" as string]: Math.min(index, 14) }}
      className={`${FILL_GRID} ${rowClass(selected)} ${motion.stagger} min-h-11`}
    >
      <Flash value={attempt.result} />
      <span role="cell" title={formatUtcFull(attempt.createdAt)} className="tnum relative px-3 font-mono text-xs text-faint">
        {formatUtcClockTime(attempt.createdAt)}
      </span>
      <span role="cell" className="relative min-w-0 px-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(attempt.id);
          }}
          className="focus-ring flex max-w-full items-baseline gap-1.5 rounded-sm text-left"
        >
          <span className="truncate text-[13px] text-ink">{attempt.packageCode}</span>
          <span className={`shrink-0 text-xs ${attempt.packageSide === "SHORT" ? "text-down" : "text-up"}`}>
            {`${outcomeLabel(attempt.outcome)} ${side}`}
          </span>
        </button>
        <span title={`Order hash: ${attempt.orderHash}`} className="tnum block truncate font-mono text-[11px] text-faint">
          {middleTruncate(attempt.orderHash, 10, 6)}
        </span>
      </span>
      <span role="cell" className="relative px-3">
        <Chip tone={RESULT_TONE[attempt.result]} dot>
          {RESULT_LABEL[attempt.result]}
        </Chip>
      </span>
      <span role="cell" className="tnum relative px-3 text-right font-mono text-xs text-ink">
        {sizeText(attempt)}
        {attempt.cancelledLots > 1e-9 ? (
          <span className="block text-[11px] text-faint">{`${formatLots(attempt.cancelledLots)} cxl`}</span>
        ) : null}
      </span>
      <span role="cell" className="tnum relative px-3 text-right font-mono text-xs text-ink">
        {marketPrice(attempt.marketId, attempt.price)}
      </span>
      <span role="cell" className="tnum relative px-3 text-right font-mono text-xs text-dim">
        {formatUsd(attempt.feeAmount, 2).replace(" USDC", "")}
        <span className="block text-[11px] text-off">USDC</span>
      </span>
      <span role="cell" className="relative min-w-0 px-3">
        <span className="block truncate text-xs text-dim">{attempt.routeLabel}</span>
        <span className="block truncate text-[11px] text-faint">{attempt.guarantee}</span>
      </span>
      <span role="cell" className="relative hidden min-w-0 px-3 2xl:block">
        <span className="block truncate text-xs text-dim">{`${attempt.source.toLowerCase()} / ${attempt.evidence.toLowerCase()}`}</span>
        <span className="block truncate text-[11px] text-faint">{attempt.freshness.label}</span>
      </span>
      <span role="cell" className="relative flex justify-center">
        {attempt.receipt ? (
          <Link
            href={attempt.receipt.href}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Open execution receipt ${attempt.receipt.id}`}
            title="Open execution receipt"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-sm text-faint transition-colors hover:bg-panel hover:text-ink"
          >
            <FileCheck2 size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </span>
    </div>
  );
}

function FillCompactRow({
  attempt,
  index,
  selected,
  onSelect,
}: {
  attempt: ActivityAttemptView;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li className="relative border-b border-line-soft">
      <Flash value={attempt.result} />
      <button
        type="button"
        onClick={() => onSelect(attempt.id)}
        aria-current={selected || undefined}
        style={{ ["--i" as string]: Math.min(index, 14) }}
        className={`focus-ring relative flex w-full items-center gap-3 px-3 py-2.5 text-left ${motion.row} ${motion.stagger} ${
          selected ? `bg-raised ${motion.rowSelected}` : "active:bg-raised"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] text-ink">{attempt.packageCode}</span>
            <span className={`shrink-0 text-xs ${attempt.packageSide === "SHORT" ? "text-down" : "text-up"}`}>
              {`${outcomeLabel(attempt.outcome)} ${sideLabel(attempt.packageSide)}`}
            </span>
          </span>
          <span className="mt-1 flex items-center gap-2 text-[11px] text-faint">
            <span className="tnum font-mono">{formatUtcClockTime(attempt.createdAt)}</span>
            <span className="text-off">/</span>
            <span className="truncate">{attempt.routeLabel}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="tnum font-mono text-xs text-ink">{`${sizeText(attempt)} @ ${marketPrice(attempt.marketId, attempt.price, false)}`}</span>
          <Chip tone={RESULT_TONE[attempt.result]} dot>
            {RESULT_LABEL[attempt.result]}
          </Chip>
        </span>
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-off" />
      </button>
    </li>
  );
}

export function FillsBlotter({
  attempts,
  now,
  selectedId,
  onSelect,
  empty,
}: {
  attempts: ActivityAttemptView[];
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: ReactNode;
}) {
  const groups = groupByDay(attempts, (attempt) => attempt.createdAt, (iso) => utcDay(iso, now));
  const order = new Map(attempts.map((attempt, position) => [attempt.id, position]));
  return (
    <>
      <div className="scroll-thin hidden min-h-0 flex-1 overflow-auto md:block">
        <div role="table" aria-label="Package fills" className="min-w-[860px]">
          <div role="rowgroup" className="sticky top-0 z-10">
            <HeaderRow grid={FILL_GRID} cells={FILL_HEAD} />
          </div>
          {attempts.length === 0
            ? empty
            : groups.map((group) => {
                const lots = group.rows.reduce((sum, row) => sum + row.filledLots, 0);
                const fees = group.rows.reduce((sum, row) => sum + row.feeAmount, 0);
                return (
                  <div role="rowgroup" key={group.key}>
                    <DayHeader
                      label={group.label}
                      meta={`${group.rows.length} fill${group.rows.length === 1 ? "" : "s"} · ${formatLots(lots)} lots · ${formatUsd(fees, 2)} fees`}
                    />
                    {group.rows.map((attempt) => (
                      <FillRow
                        key={attempt.id}
                        attempt={attempt}
                        index={order.get(attempt.id) ?? 0}
                        selected={attempt.id === selectedId}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                );
              })}
        </div>
      </div>
      <div className="md:hidden">
        {attempts.length === 0
          ? empty
          : groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <div className="sticky top-0 z-[5] flex h-7 items-center border-b border-line bg-inset px-3 text-[11px] font-medium tracking-[0.04em] text-dim uppercase">
                  {group.label}
                </div>
                <ul>
                  {group.rows.map((attempt, rowIndex) => (
                    <FillCompactRow
                      key={attempt.id}
                      attempt={attempt}
                      index={rowIndex}
                      selected={attempt.id === selectedId}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </section>
            ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

const ORDER_GRID =
  "grid grid-cols-[80px_minmax(170px,1.2fr)_96px_80px_minmax(140px,1fr)_100px_minmax(140px,1fr)_104px_36px] items-center";

const ORDER_HEAD = [
  { label: "Time" },
  { label: "Order" },
  { label: "Side" },
  { label: "TIF" },
  { label: "Filled" },
  { label: "Limit", right: true },
  { label: "Route" },
  { label: "State" },
  { label: "" },
];

function FillMeter({ order }: { order: RestingPackageOrder }) {
  const share = order.lots > 0 ? Math.min(1, order.filledLots / order.lots) : 0;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="relative h-[3px] min-w-10 flex-1 overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${share >= 1 ? "bg-up" : share > 0 ? "bg-brand" : "bg-off"}`}
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </span>
      <span className="tnum shrink-0 font-mono text-xs text-ink">
        {`${formatLots(order.filledLots)}/${formatLots(order.lots)}`}
      </span>
    </span>
  );
}

function OrderRow({
  order,
  snapshot,
  index,
  selected,
  onSelect,
}: {
  order: RestingPackageOrder;
  snapshot: GatewaySnapshot;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const receipts = receiptsForOrder(order, snapshot);
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={() => onSelect(order.id)}
      style={{ ["--i" as string]: Math.min(index, 14) }}
      className={`${ORDER_GRID} ${rowClass(selected)} ${motion.stagger} min-h-11`}
    >
      <Flash value={`${order.state}:${order.filledLots}`} />
      <span role="cell" title={formatUtcFull(order.createdAt)} className="tnum relative px-3 font-mono text-xs text-faint">
        {formatUtcClockTime(order.createdAt)}
      </span>
      <span role="cell" className="relative min-w-0 px-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(order.id);
          }}
          className="focus-ring block max-w-full truncate rounded-sm text-left text-[13px] text-ink"
        >
          {order.packageCode}
        </button>
        <span title={`Order hash: ${order.orderHash}`} className="tnum block truncate font-mono text-[11px] text-faint">
          {middleTruncate(order.orderHash, 10, 6)}
        </span>
      </span>
      <span role="cell" className={`relative px-3 text-xs ${order.packageSide === "SHORT" ? "text-down" : "text-up"}`}>
        {`${order.side === "EXIT" ? "Exit" : "Enter"} ${sideLabel(order.packageSide)}`}
      </span>
      <span role="cell" className="tnum relative px-3 font-mono text-xs text-dim">
        {order.timeInForce}
      </span>
      <span role="cell" className="relative min-w-0 px-3">
        <FillMeter order={order} />
      </span>
      <span role="cell" className="tnum relative px-3 text-right font-mono text-xs text-ink">
        {marketPrice(order.marketId, order.limitPrice)}
      </span>
      <span role="cell" className="relative min-w-0 truncate px-3 text-xs text-dim">
        {orderRouteLabel(order, snapshot)}
      </span>
      <span role="cell" className="relative px-3">
        <Chip tone={ORDER_STATE_TONE[order.state]} dot live={order.state === "WORKING" || order.state === "PARTIALLY_FILLED"}>
          {ORDER_STATE_LABEL[order.state]}
        </Chip>
      </span>
      <span role="cell" className="relative flex justify-center">
        {receipts[0] ? (
          <Link
            href={`/activity/receipts/${receipts[0]}`}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Open execution receipt ${receipts[0]}`}
            title="Open execution receipt"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-sm text-faint transition-colors hover:bg-panel hover:text-ink"
          >
            <FileCheck2 size={14} aria-hidden="true" />
          </Link>
        ) : null}
      </span>
    </div>
  );
}

function OrderCompactRow({
  order,
  snapshot,
  selected,
  onSelect,
}: {
  order: RestingPackageOrder;
  snapshot: GatewaySnapshot;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li className="border-b border-line-soft">
      <button
        type="button"
        onClick={() => onSelect(order.id)}
        aria-current={selected || undefined}
        className={`focus-ring flex w-full items-center gap-3 px-3 py-2.5 text-left ${motion.row} ${
          selected ? `bg-raised ${motion.rowSelected}` : "active:bg-raised"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] text-ink">{order.packageCode}</span>
            <span className={`shrink-0 text-xs ${order.packageSide === "SHORT" ? "text-down" : "text-up"}`}>
              {`${order.side === "EXIT" ? "Exit" : "Enter"} ${sideLabel(order.packageSide)}`}
            </span>
          </span>
          <span className="mt-1 flex items-center gap-2 text-[11px] text-faint">
            <span className="tnum font-mono">{formatUtcClockTime(order.createdAt)}</span>
            <span className="text-off">/</span>
            <span className="tnum font-mono">{order.timeInForce}</span>
            <span className="text-off">/</span>
            <span className="truncate">{orderRouteLabel(order, snapshot)}</span>
          </span>
        </span>
        <span className="flex w-[118px] shrink-0 flex-col items-end gap-1">
          <FillMeter order={order} />
          <Chip tone={ORDER_STATE_TONE[order.state]} dot>
            {ORDER_STATE_LABEL[order.state]}
          </Chip>
        </span>
        <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-off" />
      </button>
    </li>
  );
}

export function OrdersBlotter({
  orders,
  snapshot,
  now,
  selectedId,
  onSelect,
  empty,
}: {
  orders: RestingPackageOrder[];
  snapshot: GatewaySnapshot;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: ReactNode;
}) {
  const groups = groupByDay(orders, (order) => order.createdAt, (iso) => utcDay(iso, now));
  const position = new Map(orders.map((order, place) => [order.id, place]));
  return (
    <>
      <div className="scroll-thin hidden min-h-0 flex-1 overflow-auto md:block">
        <div role="table" aria-label="Package orders" className="min-w-[900px]">
          <div role="rowgroup" className="sticky top-0 z-10">
            <HeaderRow grid={ORDER_GRID} cells={ORDER_HEAD} />
          </div>
          {orders.length === 0
            ? empty
            : groups.map((group) => {
                const filled = group.rows.filter((row) => row.state === "FILLED").length;
                return (
                  <div role="rowgroup" key={group.key}>
                    <DayHeader
                      label={group.label}
                      meta={`${group.rows.length} order${group.rows.length === 1 ? "" : "s"} · ${filled} filled`}
                    />
                    {group.rows.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        snapshot={snapshot}
                        index={position.get(order.id) ?? 0}
                        selected={order.id === selectedId}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                );
              })}
        </div>
      </div>
      <div className="md:hidden">
        {orders.length === 0
          ? empty
          : groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <div className="sticky top-0 z-[5] flex h-7 items-center border-b border-line bg-inset px-3 text-[11px] font-medium tracking-[0.04em] text-dim uppercase">
                  {group.label}
                </div>
                <ul>
                  {group.rows.map((order) => (
                    <OrderCompactRow
                      key={order.id}
                      order={order}
                      snapshot={snapshot}
                      selected={order.id === selectedId}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </section>
            ))}
      </div>
    </>
  );
}
