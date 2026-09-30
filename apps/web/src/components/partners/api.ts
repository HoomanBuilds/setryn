"use client";

/** Client shapes and fetch helpers for the partner console. Mirrors the `/api/v1/partners` and `/api/v1/webhooks` routes. */
export const WEBHOOK_EVENT_TYPES = [
  "order.registered",
  "order.filled",
  "order.cancelled",
  "position.opened",
  "position.closed",
  "settlement.finalized",
  "receipt.ready",
  "market.status",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WIDGET_KINDS = ["ticker", "market", "trade"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export interface PartnerDeployment {
  code: string;
  name: string;
  status: "active" | "paused";
  allowedOrigins: string[];
  widgets: WidgetKind[];
  deepLinkEnabled: boolean;
  webhookEventTypes: WebhookEventType[];
  revShareBps: number;
  quotas: { monthlyImpressions: number; webhookSubscriptions: number; apiRequestsPerMinute: number };
  attributedAccounts: string[];
  createdAt: string;
  updatedAt: string;
}

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

export interface Subscription {
  id: string;
  url: string;
  description: string;
  eventTypes: WebhookEventType[];
  partnerCode: string | null;
  active: boolean;
  secretHint: string;
  rotationGraceUntil: string | null;
  startBlock: string;
  chainId: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  attempt: number;
  at: string;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}

export interface Delivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  eventType: WebhookEventType;
  status: "pending" | "retrying" | "succeeded" | "failed";
  attempts: DeliveryAttempt[];
  maxAttempts: number;
  nextAttemptAt: string | null;
  createdAt: string;
  test: boolean;
  blockNumber: string | null;
}

export interface Cursor {
  chainId: number;
  nextBlock: string;
  updatedAt: string;
}

export interface RevenueRow {
  partner: string;
  name: string;
  revShareBps: number;
  fills: number;
  lots: number;
  feesMinor: string;
  modeledShareMinor: string;
  status: "UNSETTLED_MODELED";
}

export interface AttributedFill {
  fillId: string;
  partner: string;
  transactionHash: string;
  blockNumber: string;
  clearedAt: string;
  lots: number;
  priceTicks: string;
  role: "taker" | "maker" | "both";
  accountId: string;
  feeMinor: string;
  modeledShareMinor: string;
}

export interface RevenueReport {
  available: boolean;
  reason: string | null;
  scannedToBlock: string | null;
  totalFills: number;
  rows: RevenueRow[];
  fills: AttributedFill[];
}

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } } | null;
  if (!response.ok || !payload || payload.data === undefined) {
    throw new ApiError(payload?.error?.code ?? `HTTP_${response.status}`, payload?.error?.message ?? `Request failed (${response.status}).`);
  }
  return payload.data;
}

/** USDC minor units (6 dp) to a display string. */
export function formatMinorUsdc(minor: string): string {
  const value = Number(minor) / 1_000_000;
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

export function shortHash(value: string, lead = 6, tail = 4): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(5, 10)} ${date.toISOString().slice(11, 19)} UTC`;
}
