import { formatHours, hoursToFixing, type AlertProvenance } from "@/lib/alerts";
import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import { ORGANIZATION_CONTROL_FIXTURE } from "@/lib/settings/organization";
import { formatDuration, formatExpiry, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";

export type PendingGroup = "SIGN" | "ORDERS" | "RFQS" | "FIXINGS";

export interface PendingItem {
  id: string;
  group: PendingGroup;
  title: string;
  detail: string;
  meta: string;
  urgent: boolean;
  href: string;
  action: string;
  provenance: AlertProvenance;
  /** Overrides the provenance chip's default explanation for this row. */
  provenanceNote?: string;
}

export const GROUP_LABEL: Record<PendingGroup, string> = {
  SIGN: "Signatures",
  ORDERS: "Working orders",
  RFQS: "Open RFQs",
  FIXINGS: "Fixings and expiries",
};

function price(market: PackageMarket | undefined, value: number): string {
  if (!market) return formatNumber(value, 2);
  return `${formatNumber(value, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`;
}

/**
 * Everything waiting on the viewer, from the gateway snapshot and the live board: quotes selected but not signed,
 * working orders, RFQs collecting or awaiting selection, and the next fixings on held packages. With no held
 * package, the nearest listed fixings stand in and say so.
 */
export function pendingActions(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  previewEpochSeconds: number,
  nowMs: number,
): { items: PendingItem[]; listedFixings: boolean } {
  const items: PendingItem[] = [];
  const find = (id: string) => markets.find((market) => market.id === id);

  for (const request of snapshot.rfqRequests) {
    const intent = request.authorization.intent;
    const market = find(intent.marketId);
    const left = Math.max(0, Math.floor((Date.parse(request.expiresAt) - nowMs) / 1000));
    if (left <= 0) continue;
    const href = market ? `${tradeHref(market)}?rfq=${encodeURIComponent(request.id)}` : "/rfqs";
    if (request.state === "SELECTED") {
      const quote = request.quotes.find((candidate) => candidate.id === request.selectedQuoteId);
      items.push({
        id: `sign-${request.id}`,
        group: "SIGN",
        title: `Sign the selected quote on ${intent.marketId}`,
        detail: quote ? `${quote.solverLabel} at ${price(market, quote.packagePrice)} for ${formatNumber(intent.lots, 0)} lots` : `${formatNumber(intent.lots, 0)} lots`,
        meta: `${formatDuration(left)} left`,
        urgent: left < 60,
        href,
        action: "Sign",
        provenance: "EXECUTABLE",
      });
    } else if (request.state === "OPEN") {
      const live = request.quotes.filter((quote) => Date.parse(quote.expiresAt) > nowMs);
      items.push({
        id: `rfq-${request.id}`,
        group: "RFQS",
        title: live.length > 0 ? `Select from ${live.length} firm ${live.length === 1 ? "quote" : "quotes"} on ${intent.marketId}` : `Collecting quotes on ${intent.marketId}`,
        detail: `${intent.side === "ENTER" ? "Enter" : "Exit"} ${intent.packageSide.toLowerCase()} ${formatNumber(intent.lots, 0)} lots, limit ${price(market, intent.limitPrice)}`,
        meta: `${formatDuration(left)} left`,
        urgent: live.length > 0,
        href,
        action: live.length > 0 ? "Select" : "View",
        provenance: live.length > 0 ? "EXECUTABLE" : "OBSERVED",
      });
    }
  }

  const organization = ORGANIZATION_CONTROL_FIXTURE.organizations[0];
  for (const proposal of ORGANIZATION_CONTROL_FIXTURE.proposals) {
    if (proposal.status !== "pending") continue;
    const approvals = proposal.decisions.filter((decision) => decision.choice === "approve").length;
    items.push({
      id: `approval-${proposal.id}`,
      group: "SIGN",
      title: `Approval: ${proposal.actionKind.replace(/-/g, " ")} ${formatNumber(Number(proposal.notional.amount), 0)} ${proposal.notional.currency}`,
      detail: `${organization?.name ?? "Organization"} / ${approvals} of ${proposal.requiredApprovers} ${proposal.approverRole} approvals`,
      meta: `policy v${proposal.policyVersion}`,
      urgent: false,
      href: "/settings#approvals",
      action: "Review",
      provenance: "RECORDED_FIXTURE",
    });
  }

  for (const order of snapshot.restingOrders) {
    if (order.state !== "WORKING" && order.state !== "PARTIALLY_FILLED") continue;
    const market = find(order.marketId);
    items.push({
      id: `order-${order.id}`,
      group: "ORDERS",
      title: `${order.side === "ENTER" ? "Enter" : "Exit"} ${order.packageSide.toLowerCase()} ${order.marketId}`,
      detail: `${formatNumber(order.filledLots, 0)} of ${formatNumber(order.lots, 0)} lots filled at limit ${price(market, order.limitPrice)} / ${order.timeInForce}`,
      meta: order.state === "PARTIALLY_FILLED" ? "Partial" : "Working",
      urgent: false,
      href: market ? tradeHref(market) : "/activity",
      action: "Manage",
      provenance: "EXECUTABLE",
    });
  }

  const held = new Map<string, number>();
  for (const position of snapshot.positions) held.set(position.marketId, (held.get(position.marketId) ?? 0) + position.lots);
  const fixingMarkets = (held.size > 0 ? markets.filter((market) => held.has(market.id)) : [...markets])
    .map((market) => ({ market, hours: hoursToFixing(market, previewEpochSeconds) }))
    .filter((entry) => entry.hours > -24)
    .sort((a, b) => a.hours - b.hours)
    .slice(0, held.size > 0 ? 6 : 3);
  for (const { market, hours } of fixingMarkets) {
    const lots = held.get(market.id);
    items.push({
      id: `fixing-${market.id}`,
      group: "FIXINGS",
      title: `${packageLabel(market)} ${hours > 0 ? "fixes" : "fixing window open"}`,
      detail: `${formatExpiry(market.expiryIso)} 16:00 UTC / ${market.fixingSource}${lots ? ` / ${formatNumber(lots, 0)} lots held` : " / listed market"}`,
      meta: hours > 0 ? formatHours(hours) : "Now",
      urgent: hours <= 72,
      href: lots ? "/lifecycle" : tradeHref(market),
      action: lots ? "Lifecycle" : "Trade",
      // The fixing time comes from the listed expiry schedule and counts down on the market clock; no fixing has
      // been observed yet.
      provenance: "MODELED",
      provenanceNote: "Scheduled from the listed expiry. Time to fixing runs on the market clock.",
    });
  }

  return { items, listedFixings: held.size === 0 };
}
