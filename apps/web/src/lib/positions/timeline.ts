import type { OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import { formatUtcSession, SCHEDULE_SOURCE_LABEL } from "@/lib/settlements/calendar";
import type { PackageMarket, Provenance } from "@/lib/terminal/types";
import type { PositionDossier } from "./dossier";
import type { PositionMetrics } from "./economics";

export type StepStatus = "DONE" | "CURRENT" | "UPCOMING" | "SKIPPED";

export type StepKind =
  | "OPEN"
  | "EXIT"
  | "WORKING"
  | "BOUNDARY"
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

function timeStatus(atMs: number, nowMs: number, untilMs = atMs): StepStatus {
  if (nowMs >= untilMs) return "DONE";
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
 * exits, then the series schedule and its terminal stages. Past entries are
 * evidence; future entries are schedule and say so. Once the position's
 * onchain lifecycle is read, its fixing, election and settlement records
 * replace the schedule's expectations.
 */
export function positionTimeline(
  dossier: PositionDossier,
  market: PackageMarket,
  metrics: PositionMetrics,
  nowMs: number,
  lifecycle: OnchainPositionLifecycle | null = null,
): LifecycleStep[] {
  const steps: LifecycleStep[] = [];
  const unit = market.priceUnit === "BP" ? "bp" : market.priceUnit === "PTS" ? "pts" : "USD";
  const schedule = metrics.schedule;
  const scheduled: Provenance = schedule.source === "POSITION" ? "OBSERVED" : "MODELED";

  /* Opening. */
  const opening = dossier.fills.find((fill) => fill.kind === "OPEN") ?? null;
  if (opening) {
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

  /* Series schedule. */
  const source = SCHEDULE_SOURCE_LABEL[schedule.source];
  steps.push({
    id: "last-trade",
    kind: "BOUNDARY",
    label: "Last trade",
    detail: `The ${market.code} book stops clearing. Close or roll before this, or hold to cash settlement. ${source}.`,
    atMs: schedule.lastTradingMs,
    atLabel: formatUtcSession(schedule.lastTradingMs),
    status: timeStatus(schedule.lastTradingMs, nowMs),
    provenance: scheduled,
    attention: nowMs < schedule.lastTradingMs && schedule.lastTradingMs - nowMs < 86_400_000,
  });
  steps.push({
    id: "window",
    kind: "WINDOW",
    label: "Fixing window",
    detail: `${schedule.windowMinutes}-minute observation window for the ${market.fixingSource} fixing.`,
    atMs: schedule.windowOpensMs,
    atLabel: formatUtcSession(schedule.windowOpensMs),
    status: timeStatus(schedule.windowOpensMs, nowMs, schedule.fixingMs),
    provenance: scheduled,
  });

  const fixing = lifecycle?.fixing ?? null;
  const finalized = fixing?.status === "FINALIZED" && fixing.value !== null;
  const fixingPassed = nowMs >= schedule.fixingMs;
  steps.push({
    id: "fixing",
    kind: "FIXING",
    label: finalized ? "Final fixing accepted" : "Fixing observation",
    detail: finalized
      ? `${market.fixingSource} fixed at ${priceText(fixing.value as number, market)} ${unit}${fixing.resolution === "FALLBACK_FINAL" ? " through the fallback path" : ""}.`
      : fixing && fixing.status !== "PENDING"
        ? `Fixing ${fixing.status.toLowerCase()}${fixing.value !== null ? ` at ${priceText(fixing.value, market)} ${unit}` : ""}; evidence closes ${formatUtcSession(schedule.evidenceDeadlineMs)}.`
        : fixingPassed
          ? `Awaiting the committed ${market.fixingSource} record. No fixing value is shown until it is observed.`
          : `${market.fixingSource}. No value is observed before the window closes.`,
    atMs: schedule.fixingMs,
    atLabel: formatUtcSession(schedule.fixingMs),
    status: finalized ? "DONE" : fixingPassed ? "CURRENT" : "UPCOMING",
    provenance: finalized || (fixing && fixing.status !== "PENDING") ? "OBSERVED" : scheduled,
  });

  const elected = lifecycle?.phase === "EXERCISED" || lifecycle?.phase === "SETTLED" || lifecycle?.phase === "LAPSED" || lifecycle?.phase === "CLAIM_AVAILABLE";
  const electionStatus: StepStatus = elected
    ? "DONE"
    : lifecycle?.phase === "FIXED_AWAITING_ELECTION"
      ? "CURRENT"
      : timeStatus(schedule.electionOpensMs, nowMs, schedule.electionClosesMs);
  steps.push({
    id: "election",
    kind: "EXPIRY",
    label: "Holder election",
    detail:
      lifecycle?.holdsElection === false
        ? "The long side elects between the window's open and close; this account's side follows its outcome."
        : `Exercise the open lots before ${formatUtcSession(schedule.electionClosesMs)}, or the series' exercise policy applies.`,
    atMs: schedule.electionOpensMs,
    atLabel: formatUtcSession(schedule.electionOpensMs),
    status: electionStatus,
    provenance: elected ? "OBSERVED" : scheduled,
    attention: lifecycle?.phase === "FIXED_AWAITING_ELECTION" && lifecycle.holdsElection,
  });

  const projected = lifecycle?.projectedPnlUsd ?? null;
  steps.push({
    id: "payout",
    kind: "PAYOUT",
    label: "Payout computed",
    detail:
      projected !== null
        ? `The payoff module projects ${usd(projected)} for the open lots at the accepted fixing.`
        : metrics.mark !== null
          ? `Lots x lot size x (fixing - entry), clamped to the range. At the current mark this is ${usd(metrics.pricePnl)}; the fixing sets the actual amount.`
          : "Lots x lot size x (fixing - entry), clamped to the range. The fixing sets the amount.",
    atMs: schedule.finalResolutionMs,
    atLabel: formatUtcSession(schedule.finalResolutionMs),
    status: projected !== null ? "DONE" : timeStatus(schedule.finalResolutionMs, nowMs),
    provenance: projected !== null ? "OBSERVED" : metrics.mark !== null ? metrics.markProvenance : "MODELED",
  });

  const settlement = lifecycle?.settlement ?? null;
  steps.push({
    id: "settlement",
    kind: "SETTLEMENT",
    label: "Settlement recorded",
    detail: settlement
      ? `${settlement.mode === "LAPSED" ? "Lapsed" : "Settled"} with a ${usd(settlement.transferUsd, 2)} transfer and ${usd(settlement.releasedUsd, 2)} collateral released.`
      : `Terminal settlement follows the accepted fixing and has a permissionless completion path, due by ${formatUtcSession(schedule.settlementDeadlineMs)}.`,
    atMs: settlement ? isoMs(settlement.finalizedAt) : schedule.settlementDeadlineMs,
    atLabel: settlement ? formatUtcSession(isoMs(settlement.finalizedAt) ?? schedule.settlementDeadlineMs) : formatUtcSession(schedule.settlementDeadlineMs),
    status: settlement ? "DONE" : nowMs >= schedule.finalResolutionMs ? "CURRENT" : "UPCOMING",
    provenance: settlement ? "OBSERVED" : scheduled,
    transactionHash: settlement?.transactionHash ?? undefined,
  });
  steps.push({
    id: "receipt",
    kind: "RECEIPT",
    label: "Settlement claim",
    detail: settlement?.claim
      ? `${settlement.claim.status === "FULFILLED" ? "Claim paid" : "Claim open"}: ${usd(settlement.claim.amountUsd, 2)}${settlement.claim.receivable ? " to this account" : ""}.`
      : "Any claim the settlement opens for this account is listed here once recorded.",
    atMs: null,
    atLabel: settlement?.claim ? "recorded" : "after settlement",
    status: settlement?.claim ? (settlement.claim.status === "FULFILLED" ? "DONE" : "CURRENT") : "UPCOMING",
    provenance: settlement?.claim ? "OBSERVED" : "MODELED",
    transactionHash: settlement?.claim?.transactionHash ?? undefined,
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
