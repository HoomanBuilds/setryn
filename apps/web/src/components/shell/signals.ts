import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import type { HealthState, OperationalAlert } from "@/lib/operations/types";

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
  provenance: "Onchain" | "Observed";
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
function alertTime(value: string): string {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
}

/** Recent account events plus the live operational alerts (from the operations snapshot), newest first. */
export function notices(snapshot: GatewaySnapshot, limit = 30, systemAlerts: readonly OperationalAlert[] = []): Notice[] {
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
  for (const alert of systemAlerts) {
    if (alert.state === "RESOLVED") continue;
    items.push({
      id: `system-${alert.id}`,
      time: alertTime(alert.openedAt),
      source: "System",
      title: alert.title,
      detail: alert.detail,
      href: "/operations",
      tone: alert.severity === "CRITICAL" ? "down" : "warn",
      provenance: "Observed",
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

/** What service health is derived from: the market-data feed's last snapshot. */
export interface FeedHealthInput {
  status: "LOADING" | "LIVE" | "STALE" | "ERROR";
  chainStatus: "LIVE" | "UNAVAILABLE" | null;
  chainReason?: string;
  blockNumber: number;
  /** Underlyings with a Chainlink reading in the snapshot, and how many the catalog lists. */
  referenceCount: number;
  referenceExpected: number;
}

/** Chain and oracle health as the market-data feed observed them on its last read; nothing recorded or assumed. */
export function serviceHealth(feed: FeedHealthInput): ServiceHealth[] {
  const chain: ServiceHealth =
    feed.status === "LOADING"
      ? { id: "sequencer", label: "Chain", state: "DEGRADED", detail: "Waiting for the first chain read." }
      : feed.chainStatus === "LIVE" && feed.status === "LIVE"
        ? { id: "sequencer", label: "Chain", state: "HEALTHY", detail: `Read at block ${feed.blockNumber.toLocaleString("en-US")}.` }
        : feed.chainStatus === "LIVE"
          ? { id: "sequencer", label: "Chain", state: "DEGRADED", detail: "The last chain read is stale." }
          : {
              id: "sequencer",
              label: "Chain",
              state: "UNAVAILABLE",
              detail: `The chain did not answer${feed.chainReason ? ` (${feed.chainReason})` : ""}.`,
            };
  const oracle: ServiceHealth =
    feed.status === "LOADING"
      ? { id: "oracle", label: "Oracle", state: "DEGRADED", detail: "Waiting for the first Chainlink read." }
      : feed.referenceCount >= feed.referenceExpected && feed.referenceExpected > 0
        ? { id: "oracle", label: "Oracle", state: "HEALTHY", detail: `Chainlink references read for ${feed.referenceCount} underlyings.` }
        : feed.referenceCount > 0
          ? {
              id: "oracle",
              label: "Oracle",
              state: "DEGRADED",
              detail: `Chainlink references read for ${feed.referenceCount} of ${feed.referenceExpected} underlyings.`,
            }
          : { id: "oracle", label: "Oracle", state: "UNAVAILABLE", detail: "No Chainlink reference could be read." };
  return [oracle, chain];
}
