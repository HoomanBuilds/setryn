import type { AlertSeverity, AlertState } from "@/lib/operations/types";

/**
 * Alert vocabulary shared by the inbox, the home summary, and the global notification bell. Severity and status reuse
 * the operator runtime enums so operator and viewer rule alerts sort and read the same way.
 */
export type { AlertSeverity };
export type AlertStatus = AlertState;

export type AlertCategory = "MARKET" | "RISK" | "FIXING" | "SETTLEMENT" | "SYSTEM";

/** The spec's data trust classes plus recorded operator evidence, which is neither live nor modeled. */
export type AlertProvenance = "OBSERVED" | "EXECUTABLE" | "ESTIMATED" | "MODELED" | "RECORDED_FIXTURE";

export const ALERT_CATEGORIES: readonly AlertCategory[] = ["MARKET", "RISK", "FIXING", "SETTLEMENT", "SYSTEM"];
export const ALERT_SEVERITIES: readonly AlertSeverity[] = ["CRITICAL", "WARNING", "NOTICE"];

export interface Alert {
  /** Stable across renders and reloads: rule alerts are `rule:<ruleId>:<subject>`, derived ones name their subject. */
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  detail: string;
  source: string;
  provenance: AlertProvenance;
  /** Wall-clock milliseconds the alert was raised. */
  raisedAtMs: number;
  /** Short time label as the source recorded it, e.g. "07:39:54 UTC". */
  timeLabel: string;
  /** The observed value that raised it, already formatted (a price, a health multiple, hours to fixing). */
  value: string | null;
  href: string | null;
  actionLabel: string | null;
  ruleId: string | null;
  /** Market id, RFQ id, position id, or "account". */
  subject: string;
  /** True while the raising condition still holds. Latched rule alerts stay listed after it clears. */
  active: boolean;
}

interface RuleBase {
  id: string;
  enabled: boolean;
  severity: AlertSeverity;
  /** ISO timestamp the viewer created the rule. */
  createdAt: string;
}

export interface PriceCrossRule extends RuleBase {
  kind: "PRICE_CROSS";
  marketId: string;
  direction: "ABOVE" | "BELOW";
  /** Package price in the market's own unit. */
  level: number;
}

export interface HealthBelowRule extends RuleBase {
  kind: "HEALTH_BELOW";
  /** Collateral cover multiple: marked collateral equity over the collateral positions and orders lock. */
  threshold: number;
}

export interface FixingWithinRule extends RuleBase {
  kind: "FIXING_WITHIN";
  hours: number;
  /** HELD watches markets the connected account holds; LISTED watches every listed market. */
  scope: "HELD" | "LISTED";
}

export interface RfqQuoteRule extends RuleBase {
  kind: "RFQ_QUOTE";
}

export type AlertRule = PriceCrossRule | HealthBelowRule | FixingWithinRule | RfqQuoteRule;
export type AlertRuleKind = AlertRule["kind"];

/** Per-viewer acknowledgement, resolution, and latch record for one alert id. */
export interface AlertLedgerEntry {
  /** Wall-clock ms a rule condition first held. Latched alerts persist until resolved. */
  firedAt?: number;
  /** Formatted value observed at the latch. */
  value?: string;
  acknowledgedAt?: number;
  resolvedAt?: number;
}

export type AlertLedger = Readonly<Record<string, AlertLedgerEntry>>;

/** A rule condition that holds now and has no latch yet; the caller records it with `latchAlerts`. */
export interface AlertLatch {
  id: string;
  value: string | null;
}

export interface AlertInbox {
  /** Open first, then acknowledged, then resolved; severity then recency inside each. */
  alerts: Alert[];
  /** Open alerts: raised and neither acknowledged nor resolved. This is the bell count. */
  count: number;
  /** Open critical alerts. */
  critical: number;
  byCategory: Record<AlertCategory, number>;
  latches: AlertLatch[];
}
