import { readJson, setrynDataDirectory, updateJson } from "./json-store";
import { WebhookApiError } from "./service";
import { isWebhookEventType, type WebhookEventType } from "./types";

/**
 * Partner deployments and widget usage, stored under `.setryn/partners/`. A deployment is a partner code with the
 * permissions its embeds and webhooks run under; usage is aggregated per UTC day, partner, widget and market.
 */
export const WIDGET_KINDS = ["ticker", "market", "trade"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export interface PartnerQuotas {
  /** Widget loads per UTC month; loads beyond it are refused and counted as blocked. */
  monthlyImpressions: number;
  webhookSubscriptions: number;
  apiRequestsPerMinute: number;
}

export interface PartnerDeployment {
  code: string;
  name: string;
  status: "active" | "paused";
  /** Origins allowed to embed. Empty means any origin. */
  allowedOrigins: string[];
  widgets: WidgetKind[];
  deepLinkEnabled: boolean;
  webhookEventTypes: WebhookEventType[];
  /** Fee share in basis points of attributed protocol fees. Used only for the MODELED reconciliation. */
  revShareBps: number;
  quotas: PartnerQuotas;
  /** Trading accounts (bytes32 account ids) attributed to the partner. */
  attributedAccounts: string[];
  createdAt: string;
  updatedAt: string;
}

export type UsageKind = "impression" | "click" | "blocked";

export interface UsageRow {
  day: string;
  partner: string;
  widget: WidgetKind;
  marketId: string;
  impressions: number;
  clicks: number;
  blocked: number;
  lastOrigin: string | null;
}

interface PartnerFile { version: number; partners: PartnerDeployment[] }
interface UsageFile { version: number; rows: UsageRow[] }

const FILES = { partners: "partners.json", usage: "usage.json" };
const MAX_USAGE_ROWS = 20_000;
const SETRYN_ORIGINS = new Set(["http://localhost:3100", "http://127.0.0.1:3100"]);

function dir(): string {
  return setrynDataDirectory("partners");
}

export const PARTNER_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

/** Codes that collide with static routes under /api/v1/partners. */
const RESERVED_CODES = new Set(["usage", "revenue", "events", "setryn"]);

export function isPartnerCode(value: unknown): value is string {
  return typeof value === "string" && PARTNER_CODE_PATTERN.test(value) && !RESERVED_CODES.has(value);
}

export async function listPartners(): Promise<PartnerDeployment[]> {
  return (await readJson<PartnerFile>(dir(), FILES.partners, { version: 1, partners: [] })).partners.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export async function getPartner(code: string): Promise<PartnerDeployment | null> {
  return (await listPartners()).find((partner) => partner.code === code) ?? null;
}

function origins(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw new WebhookApiError(400, "INVALID_ORIGINS", "allowedOrigins must be an array of at most 20 origins.");
  return raw.map((item) => {
    if (typeof item !== "string") throw new WebhookApiError(400, "INVALID_ORIGINS", "Each origin must be a string.");
    try {
      const parsed = new URL(item);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("scheme");
      return parsed.origin;
    } catch {
      throw new WebhookApiError(400, "INVALID_ORIGINS", `${item} is not an http(s) origin.`);
    }
  });
}

function widgets(raw: unknown): WidgetKind[] {
  if (raw === undefined) return [...WIDGET_KINDS];
  if (!Array.isArray(raw) || raw.some((item) => !(WIDGET_KINDS as readonly string[]).includes(item as string))) {
    throw new WebhookApiError(400, "INVALID_WIDGETS", `widgets must be a subset of: ${WIDGET_KINDS.join(", ")}.`);
  }
  return [...new Set(raw as WidgetKind[])];
}

function eventTypes(raw: unknown): WebhookEventType[] {
  if (raw === undefined) return ["order.filled", "position.opened", "position.closed", "receipt.ready", "market.status"];
  if (!Array.isArray(raw) || raw.some((item) => !isWebhookEventType(item))) {
    throw new WebhookApiError(400, "INVALID_EVENT_TYPES", "webhookEventTypes must be known webhook event types.");
  }
  return [...new Set(raw as WebhookEventType[])];
}

function integer(raw: unknown, label: string, min: number, max: number, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new WebhookApiError(400, "INVALID_FIELD", `${label} must be an integer between ${min} and ${max}.`);
  }
  return raw;
}

function accounts(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 100 || raw.some((item) => typeof item !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item))) {
    throw new WebhookApiError(400, "INVALID_ACCOUNTS", "attributedAccounts must be bytes32 account ids.");
  }
  return [...new Set((raw as string[]).map((item) => item.toLowerCase()))];
}

function quotas(raw: unknown, current?: PartnerQuotas): PartnerQuotas {
  const base = current ?? { monthlyImpressions: 100_000, webhookSubscriptions: 5, apiRequestsPerMinute: 120 };
  if (raw === undefined) return base;
  if (!raw || typeof raw !== "object") throw new WebhookApiError(400, "INVALID_QUOTAS", "quotas must be an object.");
  const value = raw as Record<string, unknown>;
  return {
    monthlyImpressions: integer(value.monthlyImpressions, "quotas.monthlyImpressions", 0, 100_000_000, base.monthlyImpressions),
    webhookSubscriptions: integer(value.webhookSubscriptions, "quotas.webhookSubscriptions", 0, 100, base.webhookSubscriptions),
    apiRequestsPerMinute: integer(value.apiRequestsPerMinute, "quotas.apiRequestsPerMinute", 0, 100_000, base.apiRequestsPerMinute),
  };
}

export async function createPartner(input: Record<string, unknown>): Promise<PartnerDeployment> {
  if (!isPartnerCode(input.code)) throw new WebhookApiError(400, "INVALID_PARTNER_CODE", "code must be 3-32 lowercase letters, digits or hyphens.");
  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 80) {
    throw new WebhookApiError(400, "INVALID_FIELD", "name must be 1-80 characters.");
  }
  const now = new Date().toISOString();
  const partner: PartnerDeployment = {
    code: input.code,
    name: input.name.trim(),
    status: "active",
    allowedOrigins: origins(input.allowedOrigins),
    widgets: widgets(input.widgets),
    deepLinkEnabled: input.deepLinkEnabled === undefined ? true : Boolean(input.deepLinkEnabled),
    webhookEventTypes: eventTypes(input.webhookEventTypes),
    revShareBps: integer(input.revShareBps, "revShareBps", 0, 5_000, 2_000),
    quotas: quotas(input.quotas),
    attributedAccounts: accounts(input.attributedAccounts),
    createdAt: now,
    updatedAt: now,
  };
  const code = input.code;
  await updateJson(dir(), FILES.partners, { version: 1, partners: [] } as PartnerFile, (file) => {
    if (file.partners.some((item) => item.code === code)) throw new WebhookApiError(409, "PARTNER_EXISTS", `Partner ${code} already exists.`);
    return { next: { version: 1, partners: [...file.partners, partner] }, result: undefined };
  });
  return partner;
}

export async function updatePartner(code: string, input: Record<string, unknown>): Promise<PartnerDeployment> {
  if (input.status !== undefined && input.status !== "active" && input.status !== "paused") {
    throw new WebhookApiError(400, "INVALID_FIELD", "status must be active or paused.");
  }
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > 80)) {
    throw new WebhookApiError(400, "INVALID_FIELD", "name must be 1-80 characters.");
  }
  return updateJson(dir(), FILES.partners, { version: 1, partners: [] } as PartnerFile, (file) => {
    const current = file.partners.find((item) => item.code === code);
    if (!current) throw new WebhookApiError(404, "PARTNER_NOT_FOUND", `No partner ${code}.`);
    const next: PartnerDeployment = {
      ...current,
      name: typeof input.name === "string" ? input.name.trim() : current.name,
      status: (input.status as PartnerDeployment["status"] | undefined) ?? current.status,
      allowedOrigins: input.allowedOrigins === undefined ? current.allowedOrigins : origins(input.allowedOrigins),
      widgets: input.widgets === undefined ? current.widgets : widgets(input.widgets),
      deepLinkEnabled: input.deepLinkEnabled === undefined ? current.deepLinkEnabled : Boolean(input.deepLinkEnabled),
      webhookEventTypes: input.webhookEventTypes === undefined ? current.webhookEventTypes : eventTypes(input.webhookEventTypes),
      revShareBps: integer(input.revShareBps, "revShareBps", 0, 5_000, current.revShareBps),
      quotas: quotas(input.quotas, current.quotas),
      attributedAccounts: input.attributedAccounts === undefined ? current.attributedAccounts : accounts(input.attributedAccounts),
      updatedAt: new Date().toISOString(),
    };
    return { next: { version: 1, partners: file.partners.map((item) => (item.code === code ? next : item)) }, result: next };
  });
}

export async function deletePartner(code: string): Promise<void> {
  await updateJson(dir(), FILES.partners, { version: 1, partners: [] } as PartnerFile, (file) => {
    const remaining = file.partners.filter((item) => item.code !== code);
    if (remaining.length === file.partners.length) throw new WebhookApiError(404, "PARTNER_NOT_FOUND", `No partner ${code}.`);
    return { next: { version: 1, partners: remaining }, result: undefined };
  });
}

export async function listUsage(days = 30): Promise<UsageRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return (await readJson<UsageFile>(dir(), FILES.usage, { version: 1, rows: [] })).rows.filter((row) => row.day >= since);
}

function monthImpressions(rows: readonly UsageRow[], partner: string, now: Date): number {
  const month = now.toISOString().slice(0, 7);
  return rows
    .filter((row) => row.partner === partner && row.day.startsWith(month))
    .reduce((sum, row) => sum + row.impressions, 0);
}

export interface UsageDecision {
  allowed: boolean;
  reason: "OK" | "UNREGISTERED" | "PAUSED" | "WIDGET_NOT_PERMITTED" | "ORIGIN_NOT_ALLOWED" | "QUOTA_EXCEEDED" | "DEEP_LINK_DISABLED";
  registered: boolean;
}

/**
 * Checks a widget load or click against the partner's permissions and quota, and records it. Setryn's own origin
 * (the console preview) is always allowed. Unregistered codes render (market data is public) but are flagged.
 */
export async function recordUsage(input: {
  partner: string;
  widget: WidgetKind;
  marketId: string;
  kind: "impression" | "click";
  origin: string | null;
}): Promise<UsageDecision> {
  const partner = await getPartner(input.partner);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const origin = input.origin && /^https?:\/\/[^/]+$/.test(input.origin) ? input.origin : null;
  return updateJson(dir(), FILES.usage, { version: 1, rows: [] } as UsageFile, (file) => {
    let decision: UsageDecision = { allowed: true, reason: partner ? "OK" : "UNREGISTERED", registered: partner !== null };
    if (partner) {
      const own = origin !== null && SETRYN_ORIGINS.has(origin);
      if (partner.status === "paused") decision = { allowed: false, reason: "PAUSED", registered: true };
      else if (!partner.widgets.includes(input.widget)) decision = { allowed: false, reason: "WIDGET_NOT_PERMITTED", registered: true };
      // Origins gate widget loads; a click comes from inside an already-admitted widget, whose embedder is not visible here.
      else if (input.kind === "impression" && !own && partner.allowedOrigins.length > 0 && (origin === null || !partner.allowedOrigins.includes(origin))) {
        decision = { allowed: false, reason: "ORIGIN_NOT_ALLOWED", registered: true };
      } else if (input.kind === "click" && !partner.deepLinkEnabled) {
        decision = { allowed: false, reason: "DEEP_LINK_DISABLED", registered: true };
      } else if (input.kind === "impression" && monthImpressions(file.rows, partner.code, now) >= partner.quotas.monthlyImpressions) {
        decision = { allowed: false, reason: "QUOTA_EXCEEDED", registered: true };
      }
    }
    const rows = [...file.rows];
    let row = rows.find(
      (item) => item.day === day && item.partner === input.partner && item.widget === input.widget && item.marketId === input.marketId,
    );
    if (!row) {
      row = { day, partner: input.partner, widget: input.widget, marketId: input.marketId, impressions: 0, clicks: 0, blocked: 0, lastOrigin: null };
      rows.push(row);
    }
    if (!decision.allowed) row.blocked += 1;
    else if (input.kind === "impression") row.impressions += 1;
    else row.clicks += 1;
    row.lastOrigin = origin ?? row.lastOrigin;
    return { next: { version: 1, rows: rows.slice(-MAX_USAGE_ROWS) }, result: decision };
  });
}

/** A partner-scoped subscription must stay within the partner's event permissions and subscription quota. */
export async function assertPartnerSubscriptionAllowed(
  code: string,
  requested: readonly WebhookEventType[] | undefined,
  existingForPartner: number,
): Promise<void> {
  const partner = await getPartner(code);
  if (!partner) throw new WebhookApiError(404, "PARTNER_NOT_FOUND", `No partner ${code}.`);
  if (partner.status !== "active") throw new WebhookApiError(403, "PARTNER_PAUSED", `Partner ${code} is paused.`);
  const types = requested ?? partner.webhookEventTypes;
  const denied = types.filter((type) => !partner.webhookEventTypes.includes(type));
  if (denied.length > 0) {
    throw new WebhookApiError(403, "EVENT_TYPE_NOT_PERMITTED", `Partner ${code} is not permitted: ${denied.join(", ")}.`);
  }
  if (existingForPartner >= partner.quotas.webhookSubscriptions) {
    throw new WebhookApiError(429, "QUOTA_EXCEEDED", `Partner ${code} is at its quota of ${partner.quotas.webhookSubscriptions} subscriptions.`);
  }
}
