import { formatNumber, priceUnitSuffix } from "@/lib/terminal/format";
import type { PackageMarket } from "@/lib/terminal/types";
import {
  ALERT_SEVERITIES,
  type AlertCategory,
  type AlertLedger,
  type AlertLedgerEntry,
  type AlertRule,
  type AlertRuleKind,
  type AlertSeverity,
} from "./types";

/** Per-viewer browser storage keys. Rules and the ledger never leave this browser. */
export const ALERT_RULES_KEY = "setryn:alerts:rules";
export const ALERT_LEDGER_KEY = "setryn:alerts:ledger";

const DEFAULT_CREATED_AT = "2026-09-22T09:00:00.000Z";

/** House rules every viewer starts with. They are ordinary rules: editable, pausable, and removable. */
export const DEFAULT_ALERT_RULES: readonly AlertRule[] = [
  {
    id: "house-fixing-72h",
    kind: "FIXING_WITHIN",
    hours: 72,
    scope: "HELD",
    severity: "WARNING",
    enabled: true,
    createdAt: DEFAULT_CREATED_AT,
  },
  {
    id: "house-health-1-25",
    kind: "HEALTH_BELOW",
    threshold: 1.25,
    severity: "CRITICAL",
    enabled: true,
    createdAt: DEFAULT_CREATED_AT,
  },
  {
    id: "house-rfq-quote",
    kind: "RFQ_QUOTE",
    severity: "NOTICE",
    enabled: true,
    createdAt: DEFAULT_CREATED_AT,
  },
];

export const EMPTY_ALERT_LEDGER: AlertLedger = {};

export const RULE_KIND_LABEL: Record<AlertRuleKind, string> = {
  PRICE_CROSS: "Price crosses",
  HEALTH_BELOW: "Collateral cover below",
  FIXING_WITHIN: "Fixing within",
  RFQ_QUOTE: "RFQ quote received",
};

export const RULE_CATEGORY: Record<AlertRuleKind, AlertCategory> = {
  PRICE_CROSS: "MARKET",
  HEALTH_BELOW: "RISK",
  FIXING_WITHIN: "FIXING",
  RFQ_QUOTE: "MARKET",
};

export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  MARKET: "Market",
  RISK: "Risk",
  FIXING: "Fixing",
  SETTLEMENT: "Settlement",
  SYSTEM: "System",
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  CRITICAL: "Critical",
  WARNING: "Warning",
  NOTICE: "Notice",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is AlertSeverity {
  return typeof value === "string" && (ALERT_SEVERITIES as readonly string[]).includes(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRule(value: unknown): AlertRule | null {
  if (!isRecord(value)) return null;
  const { id, enabled, severity, createdAt, kind } = value;
  if (typeof id !== "string" || id.length === 0 || id.length > 96) return null;
  if (typeof enabled !== "boolean" || !isSeverity(severity) || typeof createdAt !== "string") return null;
  const base = { id, enabled, severity, createdAt };
  if (kind === "PRICE_CROSS") {
    const { marketId, direction, level } = value;
    if (typeof marketId !== "string" || (direction !== "ABOVE" && direction !== "BELOW") || !finite(level)) return null;
    return { ...base, kind, marketId, direction, level };
  }
  if (kind === "HEALTH_BELOW") {
    const { threshold } = value;
    if (!finite(threshold) || threshold <= 0 || threshold > 100) return null;
    return { ...base, kind, threshold };
  }
  if (kind === "FIXING_WITHIN") {
    const { hours, scope } = value;
    if (!finite(hours) || hours <= 0 || hours > 24 * 366) return null;
    if (scope !== "HELD" && scope !== "LISTED") return null;
    return { ...base, kind, hours, scope };
  }
  if (kind === "RFQ_QUOTE") return { ...base, kind };
  return null;
}

/** Storage parser for `usePersistentState`: drops malformed rules instead of failing the whole list. */
export function parseAlertRules(value: unknown): AlertRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(parseRule).filter((rule): rule is AlertRule => rule !== null).slice(0, 64);
}

function parseEntry(value: unknown): AlertLedgerEntry | null {
  if (!isRecord(value)) return null;
  const entry: AlertLedgerEntry = {};
  if (finite(value.firedAt)) entry.firedAt = value.firedAt;
  if (typeof value.value === "string") entry.value = value.value.slice(0, 64);
  if (finite(value.acknowledgedAt)) entry.acknowledgedAt = value.acknowledgedAt;
  if (finite(value.resolvedAt)) entry.resolvedAt = value.resolvedAt;
  return entry;
}

export function parseAlertLedger(value: unknown): AlertLedger | undefined {
  if (!isRecord(value)) return undefined;
  const ledger: Record<string, AlertLedgerEntry> = {};
  for (const [id, raw] of Object.entries(value).slice(0, 512)) {
    const entry = parseEntry(raw);
    if (entry) ledger[id] = entry;
  }
  return ledger;
}

function marketPrice(market: PackageMarket | undefined, level: number): string {
  if (!market) return formatNumber(level, 2);
  return `${formatNumber(level, market.priceDecimals)} ${priceUnitSuffix(market.priceUnit)}`;
}

/** One-line plain statement of what the rule watches. */
export function describeRule(rule: AlertRule, markets: readonly PackageMarket[]): string {
  if (rule.kind === "PRICE_CROSS") {
    const market = markets.find((candidate) => candidate.id === rule.marketId);
    return `${rule.marketId} ${rule.direction === "ABOVE" ? "at or above" : "at or below"} ${marketPrice(market, rule.level)}`;
  }
  if (rule.kind === "HEALTH_BELOW") return `Collateral cover below ${formatNumber(rule.threshold, 2)}x`;
  if (rule.kind === "FIXING_WITHIN") {
    return `${rule.scope === "HELD" ? "Held position" : "Any listed market"} fixes within ${formatNumber(rule.hours, 0)}h`;
  }
  return "A firm quote arrives on an open RFQ";
}

/** Rule alert ids begin with this prefix, so re-arming a rule clears exactly its own latches. */
export function ruleAlertPrefix(ruleId: string): string {
  return `rule:${ruleId}:`;
}

/** Records new latches without touching existing acknowledgement or resolution state. */
export function latchAlerts(
  ledger: AlertLedger,
  latches: readonly { id: string; value: string | null }[],
  atMs: number,
): AlertLedger {
  const next: Record<string, AlertLedgerEntry> = { ...ledger };
  for (const latch of latches) {
    if (next[latch.id]?.firedAt !== undefined) continue;
    next[latch.id] = { ...next[latch.id], firedAt: atMs, ...(latch.value ? { value: latch.value } : {}) };
  }
  return next;
}

export function acknowledgeAlert(ledger: AlertLedger, id: string, atMs: number): AlertLedger {
  const entry = ledger[id] ?? {};
  if (entry.acknowledgedAt !== undefined || entry.resolvedAt !== undefined) return ledger;
  return { ...ledger, [id]: { ...entry, acknowledgedAt: atMs } };
}

export function resolveAlert(ledger: AlertLedger, id: string, atMs: number): AlertLedger {
  const entry = ledger[id] ?? {};
  if (entry.resolvedAt !== undefined) return ledger;
  return { ...ledger, [id]: { ...entry, resolvedAt: atMs } };
}

/** Clears the viewer's acknowledgement and resolution; a latch stays so the alert keeps its raise time. */
export function reopenAlert(ledger: AlertLedger, id: string): AlertLedger {
  const entry = ledger[id];
  if (!entry) return ledger;
  const next: AlertLedgerEntry = { ...entry };
  delete next.acknowledgedAt;
  delete next.resolvedAt;
  return { ...ledger, [id]: next };
}

/** Drops every latch and decision for a rule, so it fires again on the next matching observation. */
export function rearmRule(ledger: AlertLedger, ruleId: string): AlertLedger {
  const prefix = ruleAlertPrefix(ruleId);
  const next: Record<string, AlertLedgerEntry> = {};
  for (const [id, entry] of Object.entries(ledger)) {
    if (!id.startsWith(prefix)) next[id] = entry;
  }
  return next;
}

export function newRuleId(kind: AlertRuleKind, atMs: number): string {
  return `${kind.toLowerCase().replace(/_/g, "-")}-${atMs.toString(36)}`;
}
