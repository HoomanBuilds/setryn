import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import { OPERATIONS_FIXTURE } from "@/lib/operations/fixture";
import type { HealthState } from "@/lib/operations/types";

export type SignalTone = "up" | "down" | "warn" | "info";

export interface PendingAction {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone: SignalTone;
}

export interface Notice {
  id: string;
  /** ISO time the underlying record was created. */
  time: string;
  source: "Fill" | "RFQ" | "Order" | "System";
  title: string;
  detail: string;
  href: string;
  tone: SignalTone;
  /** How the value is known: read from the connected chain, or from the recorded operations fixture. */
  provenance: "Onchain" | "Recorded";
}

/** Work that is waiting on the user, derived only from the connected account's gateway snapshot. */
export function pendingActions(snapshot: GatewaySnapshot): PendingAction[] {
  const actions: PendingAction[] = [];
  if (snapshot.wallet.status !== "CONNECTED") {
    actions.push({
      id: "connect",
      label: "Connect a wallet",
      detail: "Balances, orders, and positions load from the connected account.",
      href: "/app",
      tone: "info",
    });
    return actions;
  }
  if (snapshot.account.posted <= 0) {
    actions.push({
      id: "fund",
      label: "Post collateral",
      detail: `Deposit ${snapshot.account.collateralAsset} before opening a package.`,
      href: "/portfolio/collateral",
      tone: "warn",
    });
  }
  for (const request of snapshot.rfqRequests) {
    if (request.state === "OPEN" && request.quotes.length > 0) {
      actions.push({
        id: `rfq-${request.id}`,
        label: `Choose a quote for ${request.authorization.intent.marketId}`,
        detail: `${request.quotes.length} firm ${request.quotes.length === 1 ? "quote" : "quotes"} waiting before the request expires.`,
        href: `/rfqs/${request.id}`,
        tone: "warn",
      });
    } else if (request.state === "SELECTED") {
      actions.push({
        id: `rfq-${request.id}`,
        label: `Execute the selected quote for ${request.authorization.intent.marketId}`,
        detail: "A quote is selected and ready to settle atomically.",
        href: `/rfqs/${request.id}`,
        tone: "warn",
      });
    }
  }
  for (const order of snapshot.restingOrders) {
    if (order.state !== "WORKING" && order.state !== "PARTIALLY_FILLED") continue;
    actions.push({
      id: `order-${order.id}`,
      label: `Working ${order.packageSide === "LONG" ? "long" : "short"} ${order.marketId}`,
      detail: `${order.remainingLots} of ${order.lots} lots rest at ${order.limitPrice}.`,
      href: `/trade/${order.marketId}`,
      tone: "info",
    });
  }
  return actions;
}

/** The recorded fixture stores clock times ("07:39:54 UTC") on its capture date; expand them to ISO timestamps. */
function recordedTime(value: string): string {
  if (Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  const clock = /^(\d{2}):(\d{2}):(\d{2})/.exec(value);
  const day = OPERATIONS_FIXTURE.capturedAt.slice(0, 10);
  return clock ? `${day}T${clock[1]}:${clock[2]}:${clock[3]}.000Z` : OPERATIONS_FIXTURE.capturedAt;
}

/** Recent account events plus recorded system alerts, newest first. */
export function notices(snapshot: GatewaySnapshot, limit = 30): Notice[] {
  const items: Notice[] = [];
  for (const receipt of snapshot.receipts) {
    items.push({
      id: `fill-${receipt.id}`,
      time: receipt.createdAt,
      source: "Fill",
      title: `Filled ${receipt.filledLots} ${receipt.filledLots === 1 ? "lot" : "lots"} ${receipt.marketId}`,
      detail: `${receipt.packageSide === "LONG" ? "Long" : "Short"} at ${receipt.price} via ${receipt.routeLabel}.`,
      href: `/activity/receipts/${receipt.id}`,
      tone: receipt.packageSide === "LONG" ? "up" : "down",
      provenance: "Onchain",
    });
  }
  for (const request of snapshot.rfqRequests) {
    if (request.quotes.length === 0) continue;
    items.push({
      id: `rfq-${request.id}`,
      time: request.createdAt,
      source: "RFQ",
      title: `${request.quotes.length} firm ${request.quotes.length === 1 ? "quote" : "quotes"} on ${request.authorization.intent.marketId}`,
      detail: request.state === "EXECUTED" ? "Executed with a receipt." : `Request is ${request.state.toLowerCase()}.`,
      href: `/rfqs/${request.id}`,
      tone: request.state === "EXECUTED" ? "up" : "info",
      provenance: "Onchain",
    });
  }
  for (const order of snapshot.restingOrders) {
    if (order.state === "WORKING") continue;
    items.push({
      id: `order-${order.id}`,
      time: order.filledAt ?? order.cancelledAt ?? order.expiredAt ?? order.replacedAt ?? order.createdAt,
      source: "Order",
      title: `Order ${order.state.toLowerCase().replace("_", " ")} on ${order.marketId}`,
      detail: `${order.filledLots} of ${order.lots} lots filled at limit ${order.limitPrice}.`,
      href: "/activity",
      tone: order.state === "FILLED" ? "up" : "info",
      provenance: "Onchain",
    });
  }
  for (const alert of OPERATIONS_FIXTURE.alerts) {
    if (alert.state === "RESOLVED") continue;
    items.push({
      id: `system-${alert.id}`,
      time: recordedTime(alert.openedAt),
      source: "System",
      title: alert.title,
      detail: alert.detail,
      href: "/operations",
      tone: alert.severity === "CRITICAL" ? "down" : "warn",
      provenance: "Recorded",
    });
  }
  return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, limit);
}

export interface ServiceHealth {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
}

/** Oracle and sequencer health come from the recorded operations snapshot until the release candidate publishes live checks. */
export function serviceHealth(): ServiceHealth[] {
  const find = (pattern: RegExp) => OPERATIONS_FIXTURE.dependencies.find((dependency) => pattern.test(dependency.label));
  const oracle = find(/pyth|oracle/i);
  const sequencer = find(/sequencer|chain reader/i);
  const services: ServiceHealth[] = [];
  if (oracle) services.push({ id: "oracle", label: "Oracle", state: oracle.state, detail: `${oracle.label}: ${oracle.detail}` });
  if (sequencer) {
    services.push({ id: "sequencer", label: "Sequencer", state: sequencer.state, detail: `${sequencer.label}: ${sequencer.detail}` });
  }
  return services;
}
