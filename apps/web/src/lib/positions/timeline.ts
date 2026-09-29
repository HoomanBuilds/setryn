import type { PackageMarket, Provenance } from "@/lib/terminal/types";
import {
  FIXING_WINDOW_MINUTES,
  fixingSchedule,
  formatUtcDate,
  formatUtcSession,
  parseBoundaryTiming,
} from "@/lib/settlements/calendar";
import type { PositionDossier } from "./dossier";
import type { PositionMetrics } from "./economics";

export type StepStatus = "DONE" | "CURRENT" | "UPCOMING" | "SKIPPED";

export type StepKind =
  | "OPEN"
  | "EXIT"
  | "WORKING"
  | "BOUNDARY"
  | "ADJUSTMENT"
  | "WINDOW"
  | "FIXING"
  | "EXPIRY"
  | "PAYOUT"
  | "SETTLEMENT"
  | "RECEIPT"
  | "CLOSED";

export interface LifecycleStep {
  id: string;
  kind: StepKind;
  label: string;
  detail: string;
  atMs: number | null;
  atLabel: string;
  status: StepStatus;
  provenance: Provenance;
  /** Needs the holder's attention before the boundary passes. */
  attention?: boolean;
  receiptId?: string;
  transactionHash?: string;
}

function timeStatus(atMs: number, nowMs: number, windowMs = 0): StepStatus {
  if (nowMs >= atMs + windowMs) return "DONE";
  if (nowMs >= atMs) return "CURRENT";
  return "UPCOMING";
}

function isoMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function priceText(value: number, market: PackageMarket): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: market.priceDecimals,
    maximumFractionDigits: market.priceDecimals,
  });
}

function usd(value: number, decimals = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} USDC`;
}

/**
 * The position's life as one ordered record: observed fills first, working
 * exits, scheduled boundaries from the series terms, then the dated settlement
 * stages. Past entries are evidence; future entries are schedule and say so.
 */
export function positionTimeline(
  dossier: PositionDossier,
  market: PackageMarket,
  metrics: PositionMetrics,
  nowMs: number,
): LifecycleStep[] {
  const steps: LifecycleStep[] = [];
  const unit = market.priceUnit === "BP" ? "bp" : market.priceUnit === "PTS" ? "pts" : "USD";
  const schedule = fixingSchedule(market);

  /* Opening. */
  const opening = dossier.fills.find((fill) => fill.kind === "OPEN") ?? null;
  if (dossier.origin === "REFERENCE") {
    steps.push({
      id: "open",
      kind: "OPEN",
      label: "Position opened",
      detail: `${dossier.openedLots} lots ${dossier.side.toLowerCase()} at ${priceText(dossier.entryPrice, market)} ${unit}. Reference record from the lifecycle preview; no fill evidence exists.`,
      atMs: null,
      atLabel: "Not recorded",
      status: "DONE",
      provenance: "MODELED",
    });
  } else if (opening) {
    const at = isoMs(opening.receipt.createdAt);
    steps.push({
      id: `open-${opening.id}`,
      kind: "OPEN",
      label: "Position opened",
      detail: `${opening.receipt.filledLots ?? opening.receipt.lots} lots ${opening.receipt.packageSide.toLowerCase()} at ${priceText(opening.receipt.price, market)} ${unit} via ${opening.receipt.routeLabel}.${opening.matchedBy === "TERMS" ? " Linked by market, size and price." : ""}`,
      atMs: at,
      atLabel: at ? formatUtcSession(at) : "Not recorded",
      status: "DONE",
      provenance: "OBSERVED",
      receiptId: opening.receipt.id,
      transactionHash: opening.receipt.transactionHash,
    });
  } else {
    const at = isoMs(dossier.openedAt);
    steps.push({
      id: "open",
      kind: "OPEN",
      label: "Position recorded",
      detail: `${dossier.openedLots} lots ${dossier.side.toLowerCase()} at ${priceText(dossier.entryPrice, market)} ${unit}. The opening fill is not linked in this account snapshot.`,
      atMs: at,
      atLabel: at ? formatUtcSession(at) : "Not recorded",
      status: "DONE",
      provenance: "OBSERVED",
    });
  }

  /* Exits already cleared. */
  for (const fill of dossier.fills.filter((candidate) => candidate.kind !== "OPEN")) {
    const at = isoMs(fill.receipt.createdAt);
    steps.push({
      id: `exit-${fill.id}`,
      kind: "EXIT",
      label: fill.kind === "CLOSE" ? "Position closed" : "Position reduced",
      detail: `${fill.receipt.filledLots ?? fill.receipt.lots} lots at ${priceText(fill.receipt.price, market)} ${unit}${
        fill.receipt.realizedPnlUsd !== undefined ? `, realized ${usd(fill.receipt.realizedPnlUsd, 2)}` : ""
      }.`,
      atMs: at,
      atLabel: at ? formatUtcSession(at) : "Not recorded",
      status: "DONE",
      provenance: "OBSERVED",
      receiptId: fill.receipt.id,
      transactionHash: fill.receipt.transactionHash,
    });
  }

  if (dossier.phase === "CLOSED") {
    const at = isoMs(dossier.closedAt);
    steps.push({
      id: "closed",
      kind: "CLOSED",
      label: "Terminal lifecycle state",
      detail:
        "The position reached a terminal state before its fixing. No dated settlement, payout or settlement receipt applies to it.",
      atMs: at,
      atLabel: at ? formatUtcSession(at) : "Observed onchain",
      status: "DONE",
      provenance: "OBSERVED",
    });
    return steps;
  }

  /* Exits still working. */
  for (const order of dossier.orders.filter((candidate) => candidate.state === "WORKING" || candidate.state === "PARTIALLY_FILLED")) {
    const at = isoMs(order.createdAt);
    steps.push({
      id: `order-${order.id}`,
      kind: "WORKING",
      label: order.state === "PARTIALLY_FILLED" ? "Close order partially filled" : "Close order working",
      detail: `${order.remainingLots} of ${order.lots} lots resting at ${priceText(order.limitPrice, market)} ${unit} on ${order.routeLabel}.`,
      atMs: at,
      atLabel: at ? formatUtcSession(at) : "Not recorded",
      status: "CURRENT",
      provenance: "EXECUTABLE",
    });
  }
  for (const request of dossier.rfqs.filter((candidate) => candidate.state === "OPEN" || candidate.state === "SELECTED")) {
    const at = isoMs(request.createdAt);
    steps.push({
      id: `rfq-${request.id}`,
      kind: "WORKING",
      label: request.state === "SELECTED" ? "Close quote selected" : "Close RFQ collecting quotes",
      detail: `${request.quotes.length} firm quote${request.quotes.length === 1 ? "" : "s"} for ${request.authorization.intent.lots} lots. Execution completes in the terminal.`,
      atMs: at,
      atLabel: at ? formatUtcSession(at) : "Not recorded",
      status: "CURRENT",
      provenance: "EXECUTABLE",
    });
  }

  /* Lifecycle boundaries a reference record schedules ahead of its fixing. */
  for (const boundary of dossier.reference?.boundaries ?? []) {
    if (boundary.kind === "FIXING" || boundary.kind === "EXPIRY") continue;
    const at = parseBoundaryTiming(boundary.timing, nowMs);
    steps.push({
      id: `boundary-${boundary.id}`,
      kind: "BOUNDARY",
      label: boundary.label,
      detail: `${boundary.source}. ${boundary.state === "WINDOW_OPEN" ? `Window open, ${boundary.dueLabel}.` : `Due ${boundary.dueLabel}.`}`,
      atMs: at,
      atLabel: boundary.timing,
      status: boundary.state === "WINDOW_OPEN" ? "CURRENT" : at !== null ? timeStatus(at, nowMs) : "UPCOMING",
      provenance: "MODELED",
      attention: boundary.state === "WINDOW_OPEN",
    });
  }

  /* Business-day adjustment ahead of the session. */
  if (schedule.adjustment) {
    steps.push({
      id: "adjustment",
      kind: "ADJUSTMENT",
      label: "Fixing date falls on a closed session",
      detail: `${formatUtcDate(schedule.adjustment.scheduled)}: ${schedule.adjustment.reason}. ${schedule.adjustment.rule} would move the session to ${formatUtcDate(schedule.adjustment.adjusted)}. Series terms decide; the scheduled date is shown until they do.`,
      atMs: schedule.fixingMs,
      atLabel: formatUtcDate(schedule.adjustment.scheduled),
      status: "UPCOMING",
      provenance: "MODELED",
      attention: true,
    });
  }

  /* Dated settlement. */
  const windowStatus = timeStatus(schedule.windowOpensMs, nowMs, FIXING_WINDOW_MINUTES * 60_000);
  steps.push({
    id: "window",
    kind: "WINDOW",
    label: "Fixing observation window",
    detail: `${FIXING_WINDOW_MINUTES}-minute observation window ahead of the ${market.fixingSource} print.`,
    atMs: schedule.windowOpensMs,
    atLabel: formatUtcSession(schedule.windowOpensMs),
    status: windowStatus,
    provenance: "MODELED",
  });
  const fixingPassed = nowMs >= schedule.fixingMs;
  steps.push({
    id: "fixing",
    kind: "FIXING",
    label: "Fixing observation",
    detail: fixingPassed
      ? `Awaiting the committed ${market.fixingSource} record. No fixing value is shown until it is observed.`
      : `${market.fixingSource}. No value is observed before the print.`,
    atMs: schedule.fixingMs,
    atLabel: formatUtcSession(schedule.fixingMs),
    status: fixingPassed ? "CURRENT" : "UPCOMING",
    provenance: "MODELED",
  });
  steps.push({
    id: "expiry",
    kind: "EXPIRY",
    label: "Series expiry",
    detail: `${market.code} expires after the final fixing. Positions still open settle in ${market.settlementAsset}.`,
    atMs: schedule.fixingMs,
    atLabel: `after ${formatUtcDate(market.expiryIso)} fixing`,
    status: "UPCOMING",
    provenance: "MODELED",
  });
  steps.push({
    id: "payout",
    kind: "PAYOUT",
    label: "Payout computed",
    detail: `Lots x multiplier x (fixing - entry). At the current mark this is ${usd(metrics.pricePnl)}; the fixing sets the actual amount.`,
    atMs: null,
    atLabel: "after fixing",
    status: "UPCOMING",
    provenance: metrics.derivedProvenance,
  });
  steps.push({
    id: "settlement",
    kind: "SETTLEMENT",
    label: "Settlement included and reconciled",
    detail:
      "Terminal settlement follows the committed fixing and has a permissionless completion path, so it never waits on the holder.",
    atMs: null,
    atLabel: "after payout",
    status: "UPCOMING",
    provenance: "MODELED",
  });
  steps.push({
    id: "receipt",
    kind: "RECEIPT",
    label: "Settlement receipt",
    detail: "Fixing record, payout record and transaction reference are linked here once reconciled.",
    atMs: null,
    atLabel: "after reconciliation",
    status: "UPCOMING",
    provenance: "MODELED",
  });
  return steps;
}

export interface LifeProgress {
  startMs: number | null;
  endMs: number;
  nowMs: number;
  /** Share of the path from opening to fixing, clamped to [0, 1]. Null without an opening time. */
  share: number | null;
}

export function lifeProgress(dossier: PositionDossier, metrics: PositionMetrics, nowMs: number): LifeProgress {
  const startMs = isoMs(dossier.openedAt);
  const endMs = metrics.fixingMs;
  if (startMs === null || endMs <= startMs) return { startMs, endMs, nowMs, share: null };
  return { startMs, endMs, nowMs, share: Math.max(0, Math.min(1, (nowMs - startMs) / (endMs - startMs))) };
}
