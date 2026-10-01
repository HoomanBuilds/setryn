import type { ActivityAttemptView, ActivityResultState } from "@/lib/activity/types";
import type { GatewaySnapshot, RestingOrderState, RestingPackageOrder } from "@/lib/internal-gateway/types";
import { formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { findMarket } from "@/lib/terminal/markets";
import type { ChipTone } from "./ledger-ui";

export type AttemptFilter = "ALL" | "TERMINAL" | "UNKNOWN";
export type OrderFilter = "ALL" | "OPEN" | "FILLED" | "CLOSED";

export const ATTEMPT_FILTERS: Array<{ id: AttemptFilter; label: string }> = [
  { id: "ALL", label: "All attempts" },
  { id: "TERMINAL", label: "Terminal" },
  { id: "UNKNOWN", label: "Unknown" },
];

export const ORDER_FILTERS: Array<{ id: OrderFilter; label: string }> = [
  { id: "ALL", label: "All orders" },
  { id: "OPEN", label: "Working" },
  { id: "FILLED", label: "Filled" },
  { id: "CLOSED", label: "Cancelled / expired" },
];

export function matchesAttemptFilter(attempt: ActivityAttemptView, filter: AttemptFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "UNKNOWN") return attempt.result === "UNKNOWN";
  return attempt.result === "COMPLETE" || attempt.result === "FAILED";
}

export function matchesOrderFilter(order: RestingPackageOrder, filter: OrderFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "OPEN") return order.state === "WORKING" || order.state === "PARTIALLY_FILLED";
  if (filter === "FILLED") return order.state === "FILLED";
  return order.state === "CANCELLED" || order.state === "EXPIRED" || order.state === "REPLACED";
}

export const RESULT_LABEL: Record<ActivityResultState, string> = {
  COMPLETE: "Complete",
  FAILED: "Failed",
  UNKNOWN: "Unknown",
};

export const RESULT_TONE: Record<ActivityResultState, ChipTone> = {
  COMPLETE: "up",
  FAILED: "down",
  UNKNOWN: "neutral",
};

export const ORDER_STATE_LABEL: Record<RestingOrderState, string> = {
  WORKING: "Working",
  PARTIALLY_FILLED: "Partial",
  FILLED: "Filled",
  CANCELLED: "Cancelled",
  REPLACED: "Replaced",
  EXPIRED: "Expired",
};

export const ORDER_STATE_TONE: Record<RestingOrderState, ChipTone> = {
  WORKING: "brand",
  PARTIALLY_FILLED: "brand",
  FILLED: "up",
  CANCELLED: "muted",
  REPLACED: "muted",
  EXPIRED: "muted",
};

export function sideLabel(side: "LONG" | "SHORT"): "Long" | "Short" {
  return side === "SHORT" ? "Short" : "Long";
}

export function outcomeLabel(outcome: ActivityAttemptView["outcome"]): string {
  if (outcome === "CLOSED") return "Closed";
  if (outcome === "REDUCED") return "Reduced";
  return "Opened";
}

/** Price with the market's precision and unit, or two decimals when the market is unknown. */
export function marketPrice(marketId: string, value: number, withUnit = true): string {
  const market = findMarket(marketId);
  if (!market || market.id !== marketId) return formatNumber(value, 2);
  const text = formatNumber(value, market.priceDecimals);
  return withUnit ? `${text} ${priceUnitSuffix(market.priceUnit)}` : text;
}

export function marketUnit(marketId: string): string {
  const market = findMarket(marketId);
  return market && market.id === marketId ? priceUnitSuffix(market.priceUnit) : "";
}

/**
 * The gateway reads every registered order back with the public-book route.
 * Cross-reference executions and private RFQs so each order row names the
 * route that actually carried it.
 */
export function orderRouteLabel(order: RestingPackageOrder, snapshot: GatewaySnapshot): string {
  const hash = order.orderHash.toLowerCase();
  const rfq = snapshot.rfqRequests.find((request) => request.authorization.orderHash.toLowerCase() === hash);
  if (rfq) return rfq.authorization.intent.routeLabel;
  const execution = snapshot.executions.find((entry) => entry.orderHash.toLowerCase() === hash);
  if (execution) return execution.result.receipt.routeLabel;
  return order.routeLabel;
}

export function receiptsForOrder(order: RestingPackageOrder, snapshot: GatewaySnapshot): string[] {
  const hash = order.orderHash.toLowerCase();
  const ids = new Set<string>(order.receiptIds);
  if (order.receiptId) ids.add(order.receiptId);
  for (const execution of snapshot.executions) {
    if (execution.orderHash.toLowerCase() === hash) ids.add(execution.result.receipt.id);
  }
  return [...ids];
}

export function toCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.includes("\"") || text.includes(",") || text.includes("\n") || text.includes("\r")) {
    return "\"" + text.replaceAll("\"", "\"\"") + "\"";
  }
  return text;
}

/** Groups rows by UTC day while keeping the incoming (newest first) order. */
export function groupByDay<T>(
  rows: T[],
  dateOf: (row: T) => string,
  dayOf: (iso: string) => { key: string; label: string },
): Array<{ key: string; label: string; rows: T[] }> {
  const groups = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const row of rows) {
    const day = dayOf(dateOf(row));
    const group = groups.get(day.key);
    if (group) group.rows.push(row);
    else groups.set(day.key, { key: day.key, label: day.label, rows: [row] });
  }
  return [...groups.values()];
}
