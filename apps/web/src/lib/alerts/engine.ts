import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import type { MarketDataSnapshot } from "@/lib/market-data/types";
import { MARK_SOURCE_LABEL, finite, liveIndex, markOf } from "@/lib/portfolio/forward";
import { portfolioRuntime } from "@/lib/portfolio/runtime";
import { formatUtcSession, seriesSchedule } from "@/lib/settlements/calendar";
import { formatMultiple, formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
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
  /** The live board from `useMarketBoard()`, so price alerts read the same marks as every chart and book. */
  markets: readonly PackageMarket[];
  /** The market-data snapshot behind the board; price rules read its marks. */
  live?: MarketDataSnapshot | null;
  /** Platform clock in unix seconds (`useChainNow()`). Fixing horizons are measured on it, like every countdown. */
  nowSeconds: number;
  /** Wall clock. RFQ and quote expiries are wall-clock timestamps written by the gateway. */
  nowMs: number;
  /** Viewer rules. Defaults to the house rules. */
  rules?: readonly AlertRule[];
  /** Viewer acknowledgements, resolutions, and latches. Defaults to empty. */
  ledger?: AlertLedger;
}

type Raised = Omit<Alert, "status"> & { baseStatus?: AlertStatus };

const STATUS_RANK: Record<AlertStatus, number> = { OPEN: 0, ACKNOWLEDGED: 1, RESOLVED: 2 };
const SEVERITY_RANK: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, NOTICE: 2 };

function utcTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** Hours from the platform clock to the market's fixing, at the close of its fixing window. */
export function hoursToFixing(market: PackageMarket, nowSeconds: number): number {
  return (seriesSchedule(market).fixingMs - nowSeconds * 1000) / 3_600_000;
}

/** A market's live mark: the feed snapshot's when given, else the board's overlay; null without a quote. */
export function liveMark(market: PackageMarket, live: MarketDataSnapshot | null | undefined): number | null {
  if (live) return markOf(liveIndex(live).get(market.id)).price;
  return finite(market.netPrice) ? market.netPrice : null;
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
  const mark = liveMark(market, context.input.live);
  const source = context.input.live ? markOf(liveIndex(context.input.live).get(market.id)).source : "NONE";
  const active = mark !== null && (rule.direction === "ABOVE" ? mark >= rule.level : mark <= rule.level);
  const current = mark === null ? null : priceText(market, mark);
  emitRule(context, rule, market.id, active, current, (value) => ({
    category: "MARKET",
    title: `${market.code} ${rule.direction === "ABOVE" ? "crossed above" : "crossed below"} ${priceText(market, rule.level)}`,
    detail: `${packageLabel(market)} marked ${value ?? current ?? "without a quote"} against a ${
      rule.direction === "ABOVE" ? "rising" : "falling"
    } trigger of ${priceText(market, rule.level)}. ${current === null ? "No mark now." : `Mark ${current} now.`}`,
    source: `${MARK_SOURCE_LABEL[source]}, market-data feed`,
    provenance: "MODELED",
    href: tradeHref(market),
    actionLabel: "Open terminal",
  }));
}

function healthRule(context: RuleContext, rule: HealthBelowRule): void {
  const { snapshot, markets } = context.input;
  if (snapshot.positions.length === 0) return;
  let health: number;
  try {
    const account = portfolioRuntime(snapshot, markets, { live: context.input.live, nowMs: context.input.nowSeconds * 1000 }).account;
    if (account.maintenanceMargin <= 0) return;
    health = account.healthFactor;
  } catch {
    return;
  }
  const active = health < rule.threshold;
  emitRule(context, rule, "account", active, formatMultiple(health), (value) => ({
    category: "RISK",
    title: `Collateral cover ${value ?? formatMultiple(health)} is below ${formatMultiple(rule.threshold)}`,
    detail: `Marked collateral equity over the collateral ${snapshot.account.label} locks, with open positions at live marks. Positions are fully collateralized, so this is free collateral running low, not liquidation risk. Deposit or close a position to restore headroom.`,
    source: `${snapshot.environment.label} account / live marks`,
    provenance: "ESTIMATED",
    href: "/portfolio/risk",
    actionLabel: "Review risk",
  }));
}

function fixingRule(context: RuleContext, rule: FixingWithinRule): void {
  const { markets, nowSeconds } = context.input;
  const watched =
    rule.scope === "HELD" ? markets.filter((market) => context.held.has(market.id)) : markets;
  for (const market of watched) {
    const hours = hoursToFixing(market, nowSeconds);
    const active = hours > 0 && hours <= rule.hours;
    const lots = context.held.get(market.id);
    emitRule(context, rule, market.id, active, formatHours(hours), () => ({
      category: "FIXING",
      title: hours > 0 ? `${packageLabel(market)} fixes in ${formatHours(hours)}` : `${packageLabel(market)} has reached its fixing`,
      detail: `Fixing ${formatUtcSession(seriesSchedule(market).fixingMs)} against ${market.fixingSource}. ${
        lots
          ? `The account holds ${formatNumber(lots, 0)} lots; roll or exit before the last trade at ${formatUtcSession(seriesSchedule(market).lastTradingMs)} if you do not want settlement.`
          : "Listed market; no position is held."
      }`,
      source: "Series schedule / chain clock",
      provenance: "OBSERVED",
      href: lots ? "/settlements" : tradeHref(market),
      actionLabel: lots ? "Open settlements" : "Open terminal",
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
  const { snapshot, markets, nowSeconds, nowMs } = input;
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
  for (const lifecycle of Object.values(snapshot.lifecycles)) {
    const market = markets.find((candidate) => candidate.id === lifecycle.marketId);
    if (!market) continue;
    const electing = lifecycle.phase === "FIXED_AWAITING_ELECTION" && lifecycle.holdsElection;
    const claim = lifecycle.phase === "CLAIM_AVAILABLE";
    if (!electing && !claim) continue;
    const cutoff = seriesSchedule(market, lifecycle.schedule).electionClosesMs;
    raised.push({
      id: `lifecycle:${lifecycle.positionId}:${electing ? "election" : "claim"}`,
      category: "SETTLEMENT",
      severity: electing ? "WARNING" : "NOTICE",
      title: electing ? `Election open on ${packageLabel(market)}` : `Settlement claim open on ${packageLabel(market)}`,
      detail: electing
        ? `The final fixing is on the position. Elect on ${formatNumber(lifecycle.remainingLots, 0)} lots before ${formatUtcSession(cutoff)}.`
        : "The settlement opened a claim for this account. Anyone can complete it; take it from the position page.",
      source: "Position engine, onchain",
      provenance: "OBSERVED",
      raisedAtMs: nowMs,
      timeLabel: utcTime(nowMs),
      value: null,
      href: `/positions/${encodeURIComponent(lifecycle.positionId)}?action=settle`,
      actionLabel: electing ? "Elect" : "Claim",
      ruleId: null,
      subject: lifecycle.positionId,
      active: true,
    });
  }
  for (const [marketId, lots] of held) {
    const market = markets.find((candidate) => candidate.id === marketId);
    if (!market) continue;
    const hours = hoursToFixing(market, nowSeconds);
    if (hours > 0) continue;
    const window = hours > -24;
    raised.push({
      id: `settlement:${marketId}:${window ? "window" : "matured"}`,
      category: "SETTLEMENT",
      severity: window ? "WARNING" : "NOTICE",
      title: window ? `Fixing window open on ${packageLabel(market)}` : `${packageLabel(market)} awaits its settlement record`,
      detail: `${formatNumber(lots, 0)} lots settle in ${market.settlementAsset} against ${market.fixingSource}. Settlement is shown only when the protocol records the payout, never at signature.`,
      source: "Series schedule / chain clock",
      provenance: "OBSERVED",
      raisedAtMs: nowMs,
      timeLabel: utcTime(nowMs),
      value: null,
      href: "/settlements",
      actionLabel: "Open settlements",
      ruleId: null,
      subject: marketId,
      active: true,
    });
  }
  return raised;
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
  const held = heldLots(input.snapshot);
  const context: RuleContext = { input, ledger, held, raised: [], latches: [] };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.kind === "PRICE_CROSS") priceRule(context, rule);
    else if (rule.kind === "HEALTH_BELOW") healthRule(context, rule);
    else if (rule.kind === "FIXING_WITHIN") fixingRule(context, rule);
    else rfqRule(context, rule);
  }

  const raised = [...context.raised, ...derivedAlerts(input, held)];

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
