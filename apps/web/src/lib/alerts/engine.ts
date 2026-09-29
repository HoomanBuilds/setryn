import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import { OPERATIONS_FIXTURE } from "@/lib/operations/fixture";
import type { OperationalAlert, OperationsSnapshot } from "@/lib/operations/types";
import { portfolioRuntime } from "@/lib/portfolio/runtime";
import { formatExpiry, formatMultiple, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import { packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import { DEFAULT_ALERT_RULES, EMPTY_ALERT_LEDGER, ruleAlertPrefix } from "./rules";
import {
  ALERT_CATEGORIES,
  type Alert,
  type AlertCategory,
  type AlertInbox,
  type AlertLatch,
  type AlertLedger,
  type AlertRule,
  type AlertSeverity,
  type AlertStatus,
  type FixingWithinRule,
  type HealthBelowRule,
  type PriceCrossRule,
  type RfqQuoteRule,
} from "./types";

export interface AlertInput {
  snapshot: GatewaySnapshot;
  /** The live board from `usePreviewBoard()`, so price alerts read the same marks as every chart and book. */
  markets: readonly PackageMarket[];
  /** Preview clock from `usePreviewBoard()`. Fixing horizons are measured on it, like every expiry countdown. */
  previewEpochSeconds: number;
  /** Wall clock. RFQ and quote expiries are wall-clock timestamps written by the gateway. */
  nowMs: number;
  /** Viewer rules. Defaults to the house rules. */
  rules?: readonly AlertRule[];
  /** Viewer acknowledgements, resolutions, and latches. Defaults to empty. */
  ledger?: AlertLedger;
  /** Operator runtime evidence shown under System. Defaults to the recorded fixture; pass null to leave it out. */
  operations?: OperationsSnapshot | null;
}

type Raised = Omit<Alert, "status"> & { baseStatus?: AlertStatus };

const STATUS_RANK: Record<AlertStatus, number> = { OPEN: 0, ACKNOWLEDGED: 1, RESOLVED: 2 };
const SEVERITY_RANK: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, NOTICE: 2 };

function utcTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** Hours from the preview clock to the market's 16:00 UTC fixing on its expiry date. */
export function hoursToFixing(market: PackageMarket, previewEpochSeconds: number): number {
  return (Date.parse(`${market.expiryIso}T16:00:00Z`) - previewEpochSeconds * 1000) / 3_600_000;
}

export function formatHours(hours: number): string {
  if (hours <= 0) return "now";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 72) return `${formatNumber(Math.floor(hours), 0)}h ${String(Math.floor((hours % 1) * 60)).padStart(2, "0")}m`;
  return `${formatNumber(Math.floor(hours / 24), 0)}d ${formatNumber(Math.floor(hours % 24), 0)}h`;
}

function heldLots(snapshot: GatewaySnapshot): Map<string, number> {
  const lots = new Map<string, number>();
  for (const position of snapshot.positions) {
    lots.set(position.marketId, (lots.get(position.marketId) ?? 0) + position.lots);
  }
  return lots;
}

function priceText(market: PackageMarket, value: number): string {
  return `${formatNumber(value, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`;
}

interface RuleContext {
  input: AlertInput;
  ledger: AlertLedger;
  held: Map<string, number>;
  raised: Raised[];
  latches: AlertLatch[];
}

/** A rule alert is listed while its condition holds, and after that for as long as the viewer's latch stands. */
function emitRule(
  context: RuleContext,
  rule: AlertRule,
  subject: string,
  active: boolean,
  currentValue: string | null,
  build: (value: string | null) => Omit<Raised, "id" | "raisedAtMs" | "timeLabel" | "value" | "ruleId" | "subject" | "active" | "severity">,
): void {
  const id = `${ruleAlertPrefix(rule.id)}${subject}`;
  const entry = context.ledger[id];
  if (!active && entry?.firedAt === undefined) return;
  if (active && entry?.firedAt === undefined) context.latches.push({ id, value: currentValue });
  const raisedAtMs = entry?.firedAt ?? context.input.nowMs;
  const value = active ? currentValue : (entry?.value ?? currentValue);
  context.raised.push({
    ...build(value),
    id,
    severity: rule.severity,
    raisedAtMs,
    timeLabel: utcTime(raisedAtMs),
    value,
    ruleId: rule.id,
    subject,
    active,
  });
}

function priceRule(context: RuleContext, rule: PriceCrossRule): void {
  const market = context.input.markets.find((candidate) => candidate.id === rule.marketId);
  if (!market) return;
  const active = rule.direction === "ABOVE" ? market.netPrice >= rule.level : market.netPrice <= rule.level;
  emitRule(context, rule, market.id, active, priceText(market, market.netPrice), (value) => ({
    category: "MARKET",
    title: `${market.code} ${rule.direction === "ABOVE" ? "crossed above" : "crossed below"} ${priceText(market, rule.level)}`,
    detail: `${packageLabel(market)} marked ${value ?? priceText(market, market.netPrice)} against a ${
      rule.direction === "ABOVE" ? "rising" : "falling"
    } trigger of ${priceText(market, rule.level)}. Mark ${priceText(market, market.netPrice)} now.`,
    source: "Preview feed package mark",
    provenance: "OBSERVED",
    href: tradeHref(market),
    actionLabel: "Open terminal",
  }));
}

function healthRule(context: RuleContext, rule: HealthBelowRule): void {
  const { snapshot, markets } = context.input;
  if (snapshot.positions.length === 0) return;
  let health: number;
  try {
    const account = portfolioRuntime(snapshot, markets).account;
    if (account.maintenanceMargin <= 0) return;
    health = account.healthFactor;
  } catch {
    return;
  }
  const active = health < rule.threshold;
  emitRule(context, rule, "account", active, formatMultiple(health), (value) => ({
    category: "RISK",
    title: `Maintenance health ${value ?? formatMultiple(health)} is below ${formatMultiple(rule.threshold)}`,
    detail: `Equity over maintenance margin for ${snapshot.account.label}, with open packages marked on the preview feed. Add collateral or reduce a package to restore headroom.`,
    source: `${snapshot.environment.label} account / preview marks`,
    provenance: "ESTIMATED",
    href: "/portfolio/risk",
    actionLabel: "Review risk",
  }));
}

function fixingRule(context: RuleContext, rule: FixingWithinRule): void {
  const { markets, previewEpochSeconds } = context.input;
  const watched =
    rule.scope === "HELD" ? markets.filter((market) => context.held.has(market.id)) : markets;
  for (const market of watched) {
    const hours = hoursToFixing(market, previewEpochSeconds);
    const active = hours > 0 && hours <= rule.hours;
    const lots = context.held.get(market.id);
    emitRule(context, rule, market.id, active, formatHours(hours), () => ({
      category: "FIXING",
      title: hours > 0 ? `${packageLabel(market)} fixes in ${formatHours(hours)}` : `${packageLabel(market)} has reached its fixing`,
      detail: `Fixing ${formatExpiry(market.expiryIso)} 16:00 UTC against ${market.fixingSource}. ${
        lots ? `The account holds ${formatNumber(lots, 0)} lots; roll or exit before the window opens if you do not want settlement.` : "Listed market; no position is held."
      }`,
      source: "Market schedule / preview clock",
      provenance: "OBSERVED",
      href: lots ? "/lifecycle" : tradeHref(market),
      actionLabel: lots ? "Open lifecycle" : "Open terminal",
    }));
  }
}

function rfqRule(context: RuleContext, rule: RfqQuoteRule): void {
  const { snapshot, nowMs, markets } = context.input;
  for (const request of snapshot.rfqRequests) {
    const intent = request.authorization.intent;
    const market = markets.find((candidate) => candidate.id === intent.marketId);
    const live = request.quotes.filter((quote) => Date.parse(quote.expiresAt) > nowMs);
    const active = request.state === "OPEN" && Date.parse(request.expiresAt) > nowMs && live.length > 0;
    const count = active ? live.length : request.quotes.length;
    const buying = (intent.side === "ENTER") === (intent.packageSide === "LONG");
    const best = [...live].sort((a, b) => (buying ? a.packagePrice - b.packagePrice : b.packagePrice - a.packagePrice))[0];
    emitRule(context, rule, request.id, active, `${count} quote${count === 1 ? "" : "s"}`, (value) => ({
      category: "MARKET",
      title: `${value ?? `${count} quotes`} on RFQ ${request.id.slice(-6).toUpperCase()} / ${intent.marketId}`,
      detail: active
        ? `Firm quotes for ${formatNumber(intent.lots, 0)} lots are collecting.${
            best && market ? ` Best ${priceText(market, best.packagePrice)} from ${best.solverLabel}.` : ""
          } Select one before the request expires.`
        : `Request is ${request.state === "OPEN" ? "past its expiry" : request.state.toLowerCase()}. No selection is pending.`,
      source: "Private RFQ runtime",
      provenance: "EXECUTABLE",
      href: market ? `${tradeHref(market)}?rfq=${encodeURIComponent(request.id)}` : "/rfqs",
      actionLabel: active ? "Select quote" : "Open RFQs",
    }));
  }
}

function derivedAlerts(input: AlertInput, held: Map<string, number>): Raised[] {
  const { snapshot, markets, previewEpochSeconds, nowMs } = input;
  const raised: Raised[] = [];
  if (snapshot.wallet.status === "WRONG_NETWORK") {
    raised.push({
      id: "wallet:wrong-network",
      category: "SYSTEM",
      severity: "CRITICAL",
      title: "Wallet is on the wrong network",
      detail: `Switch the wallet to ${snapshot.environment.label} (chain ${snapshot.environment.chainId}). Signing and collateral actions stay blocked until then.`,
      source: "Connected wallet",
      provenance: "OBSERVED",
      raisedAtMs: nowMs,
      timeLabel: utcTime(nowMs),
      value: null,
      href: null,
      actionLabel: null,
      ruleId: null,
      subject: "wallet",
      active: true,
    });
  }
  for (const [marketId, lots] of held) {
    const market = markets.find((candidate) => candidate.id === marketId);
    if (!market) continue;
    const hours = hoursToFixing(market, previewEpochSeconds);
    if (hours > 0) continue;
    const window = hours > -24;
    raised.push({
      id: `settlement:${marketId}:${window ? "window" : "matured"}`,
      category: "SETTLEMENT",
      severity: window ? "WARNING" : "NOTICE",
      title: window ? `Fixing window open on ${packageLabel(market)}` : `${packageLabel(market)} awaits its settlement record`,
      detail: `${formatNumber(lots, 0)} lots settle in ${market.settlementAsset} against ${market.fixingSource}. Settlement is shown only when the protocol records the payout, never at signature.`,
      source: "Market schedule / preview clock",
      provenance: "OBSERVED",
      raisedAtMs: nowMs,
      timeLabel: utcTime(nowMs),
      value: null,
      href: "/lifecycle",
      actionLabel: "Open lifecycle",
      ruleId: null,
      subject: marketId,
      active: true,
    });
  }
  return raised;
}

function capturedMs(operations: OperationsSnapshot, label: string): number {
  const match = /(\d{2}):(\d{2})(?::(\d{2}))?/.exec(label);
  const day = operations.capturedAt.slice(0, 10);
  if (!match) return Date.parse(operations.capturedAt);
  const parsed = Date.parse(`${day}T${match[1]}:${match[2]}:${match[3] ?? "00"}Z`);
  return Number.isFinite(parsed) ? parsed : Date.parse(operations.capturedAt);
}

function operationsAlert(operations: OperationsSnapshot, alert: OperationalAlert): Raised {
  const raisedAtMs = capturedMs(operations, alert.openedAt);
  return {
    id: `ops:${alert.id}`,
    category: "SYSTEM",
    severity: alert.severity,
    baseStatus: alert.state,
    title: alert.title,
    detail: `${alert.detail} Freshness ${alert.freshness.ageLabel} against a ${alert.freshness.thresholdLabel}.`,
    source: `${alert.source} / operator runtime`,
    provenance: "RECORDED_FIXTURE",
    raisedAtMs,
    timeLabel: `${formatExpiry(operations.capturedAt.slice(0, 10)).slice(0, 6)} ${alert.openedAt}`,
    value: alert.freshness.ageLabel,
    href: "/operations",
    actionLabel: "Open operations",
    ruleId: null,
    subject: alert.id,
    active: alert.state !== "RESOLVED",
  };
}

function statusFor(raised: Raised, ledger: AlertLedger): AlertStatus {
  const entry = ledger[raised.id];
  if (entry?.resolvedAt !== undefined) return "RESOLVED";
  if (entry?.acknowledgedAt !== undefined) {
    return raised.baseStatus === "RESOLVED" ? "RESOLVED" : "ACKNOWLEDGED";
  }
  return raised.baseStatus ?? "OPEN";
}

/**
 * The viewer's alert inbox for one gateway snapshot and live board. Pure: pass the same inputs, get the same inbox.
 * `count` is what a notification bell shows. `latches` lists rule conditions that hold now but are not yet recorded;
 * write them with `latchAlerts` so the alert survives the condition clearing.
 */
export function alertInbox(input: AlertInput): AlertInbox {
  const rules = input.rules ?? DEFAULT_ALERT_RULES;
  const ledger = input.ledger ?? EMPTY_ALERT_LEDGER;
  const operations = input.operations === undefined ? OPERATIONS_FIXTURE : input.operations;
  const held = heldLots(input.snapshot);
  const context: RuleContext = { input, ledger, held, raised: [], latches: [] };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.kind === "PRICE_CROSS") priceRule(context, rule);
    else if (rule.kind === "HEALTH_BELOW") healthRule(context, rule);
    else if (rule.kind === "FIXING_WITHIN") fixingRule(context, rule);
    else rfqRule(context, rule);
  }

  const raised = [
    ...context.raised,
    ...derivedAlerts(input, held),
    ...(operations ? operations.alerts.map((alert) => operationsAlert(operations, alert)) : []),
  ];

  const alerts: Alert[] = raised
    .map((item) => {
      const alert: Alert & { baseStatus?: AlertStatus } = { ...item, status: statusFor(item, ledger) };
      delete alert.baseStatus;
      return alert;
    })
    .sort(
      (left, right) =>
        STATUS_RANK[left.status] - STATUS_RANK[right.status] ||
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        right.raisedAtMs - left.raisedAtMs,
    );

  const open = alerts.filter((alert) => alert.status === "OPEN");
  const byCategory = Object.fromEntries(ALERT_CATEGORIES.map((category) => [category, 0])) as Record<AlertCategory, number>;
  for (const alert of open) byCategory[alert.category] += 1;

  return {
    alerts,
    count: open.length,
    critical: open.filter((alert) => alert.severity === "CRITICAL").length,
    byCategory,
    latches: context.latches,
  };
}
