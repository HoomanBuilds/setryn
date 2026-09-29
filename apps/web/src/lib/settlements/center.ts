import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import type { LifecycleStrategy } from "@/lib/lifecycle/types";
import { positionHref, trackedDossiers, type PositionDossier } from "@/lib/positions/dossier";
import { tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import {
  FIXING_WINDOW_MINUTES,
  LONDON_HOLIDAYS,
  fixingSchedule,
  formatCountdownMs,
  formatUtcDate,
  formatUtcSession,
  parseBoundaryTiming,
} from "./calendar";
import type {
  CalendarFamily,
  ExceptionSeverity,
  HeldExposure,
  ObservationGroup,
  PayoutRow,
  ReconciliationRow,
  ScheduleBoundary,
  SettlementCenter,
  SettlementException,
  SettlementStage,
} from "./types";

export const SETTLEMENT_STAGES: readonly SettlementStage[] = [
  "LIVE",
  "FIXING_WINDOW",
  "FIXING_OBSERVED",
  "FIXING_UNAVAILABLE",
  "PAYOUT_COMPUTED",
  "CHALLENGE_OR_FALLBACK",
  "SETTLING",
  "INCLUDED",
  "SUBMISSION_UNKNOWN",
  "RECONCILING",
  "RECONCILED",
  "MANUAL_INTERVENTION",
];

const DAY_MS = 86_400_000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function heldFor(dossier: PositionDossier): HeldExposure {
  return {
    positionId: dossier.id,
    origin: dossier.origin,
    side: dossier.side,
    lots: dossier.lots,
    label: dossier.label,
  };
}

/** Where an open position sits on the dated settlement state machine at the feed clock. */
export function settlementStage(market: PackageMarket, nowMs: number): SettlementStage {
  const schedule = fixingSchedule(market);
  if (nowMs < schedule.windowOpensMs) return "LIVE";
  if (nowMs < schedule.fixingMs) return "FIXING_WINDOW";
  /* No fixing record source is connected, so a passed print is unavailable to this interface. */
  return "FIXING_UNAVAILABLE";
}

function families(markets: readonly PackageMarket[]): CalendarFamily[] {
  const seen = new Map<string, CalendarFamily>();
  for (const market of markets) {
    const id = `${market.name}:${market.strategyKind}`;
    if (!seen.has(id)) seen.set(id, { id, label: market.name, underlying: market.underlying });
  }
  return [...seen.values()];
}

function familyId(market: PackageMarket): string {
  return `${market.name}:${market.strategyKind}`;
}

function boundaries(
  markets: readonly PackageMarket[],
  dossiers: readonly PositionDossier[],
  nowMs: number,
): ScheduleBoundary[] {
  const rows: ScheduleBoundary[] = markets.map((market) => {
    const schedule = fixingSchedule(market);
    const held = dossiers.filter((dossier) => dossier.marketId === market.id && dossier.lots > 0).map(heldFor);
    const state: ScheduleBoundary["state"] =
      nowMs >= schedule.fixingMs ? "PASSED" : nowMs >= schedule.windowOpensMs ? "WINDOW_OPEN" : "UPCOMING";
    return {
      id: `fixing-${market.id}`,
      kind: "FIXING",
      market,
      family: familyId(market),
      label: "Cash settlement fixing",
      atMs: schedule.fixingMs,
      timingLabel: formatUtcSession(schedule.fixingMs),
      windowOpensMs: schedule.windowOpensMs,
      state,
      held,
      adjustment: schedule.adjustment,
      provenance: "MODELED",
      source: `${market.fixingSource}, scheduled from series terms`,
    };
  });

  for (const dossier of dossiers) {
    const reference = dossier.reference;
    if (!reference) continue;
    const market = markets.find((candidate) => candidate.id === dossier.marketId) ?? reference.market;
    for (const boundary of reference.boundaries) {
      if (boundary.kind !== "FUNDING" && boundary.kind !== "REBALANCE") continue;
      const atMs = parseBoundaryTiming(boundary.timing, nowMs);
      rows.push({
        id: `${dossier.id}-${boundary.id}`,
        kind: boundary.kind,
        market,
        family: familyId(market),
        label: boundary.label,
        atMs,
        timingLabel: boundary.timing,
        windowOpensMs: null,
        state: boundary.state === "WINDOW_OPEN" ? "WINDOW_OPEN" : atMs !== null && atMs <= nowMs ? "PASSED" : "UPCOMING",
        held: [heldFor(dossier)],
        adjustment: null,
        provenance: "MODELED",
        source: boundary.source,
      });
    }
  }

  const order = (row: ScheduleBoundary) => (row.state === "WINDOW_OPEN" ? -Infinity : (row.atMs ?? Infinity));
  return rows.sort((left, right) => order(left) - order(right));
}

function observationGroups(
  markets: readonly PackageMarket[],
  dossiers: readonly PositionDossier[],
  nowMs: number,
): ObservationGroup[] {
  return markets
    .map((market) => {
      const schedule = fixingSchedule(market);
      const fixingState: ObservationGroup["fixingState"] =
        nowMs >= schedule.fixingMs ? "AWAITING_RECORD" : nowMs >= schedule.windowOpensMs ? "WINDOW_OPEN" : "PENDING";
      return {
        market,
        held: dossiers.filter((dossier) => dossier.marketId === market.id && dossier.lots > 0).map(heldFor),
        fixingMs: schedule.fixingMs,
        windowOpensMs: schedule.windowOpensMs,
        fixingState,
        packageMark: market.netPrice,
        legs: market.legs.map((leg) => ({
          id: `${market.id}-${leg.id}`,
          instrument: leg.instrument,
          family: leg.family,
          side: leg.side,
          ratio: leg.ratio,
          value: leg.mark,
          unit: leg.markUnit,
          ageSeconds: market.snapshotAgeSeconds,
          provenance: leg.venueClass === "NATIVE_BOOK" ? ("EXECUTABLE" as const) : ("OBSERVED" as const),
          source: leg.venueClass === "NATIVE_BOOK" ? "Setryn package book" : "Qualified component observation",
          qualification: leg.qualification,
        })),
      };
    })
    .sort((left, right) => left.fixingMs - right.fixingMs);
}

function payouts(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  dossiers: readonly PositionDossier[],
  nowMs: number,
): PayoutRow[] {
  const projected: PayoutRow[] = dossiers
    .filter((dossier) => dossier.lots > 0)
    .map((dossier) => {
      const market = markets.find((candidate) => candidate.id === dossier.marketId) ?? dossier.reference?.market;
      if (!market) return null;
      const direction = dossier.side === "LONG" ? 1 : -1;
      const perPoint = dossier.lots * market.contractMultiplier;
      const schedule = fixingSchedule(market);
      return {
        id: `projected-${dossier.id}`,
        positionId: dossier.id,
        origin: dossier.origin,
        label: dossier.label,
        market,
        side: dossier.side,
        lots: dossier.lots,
        entryPrice: dossier.entryPrice,
        referencePrice: market.netPrice,
        referenceLabel: "Mark",
        amount: round2((market.netPrice - dossier.entryPrice) * perPoint * direction),
        perPoint,
        collateral: dossier.collateral,
        fees: dossier.fees,
        kind: "PROJECTED" as const,
        stage: settlementStage(market, nowMs),
        fixingMs: schedule.fixingMs,
        provenance: dossier.origin === "ACCOUNT" ? ("ESTIMATED" as const) : ("MODELED" as const),
        atMs: schedule.fixingMs,
        receiptId: null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => left.fixingMs - right.fixingMs);

  const realized: PayoutRow[] =
    snapshot.wallet.status === "CONNECTED"
      ? snapshot.executions
          .filter((execution) => execution.result.receipt.realizedPnlUsd !== undefined)
          .map((execution) => {
            const receipt = execution.result.receipt;
            const market = markets.find((candidate) => candidate.id === receipt.marketId);
            if (!market) return null;
            const lots = receipt.filledLots ?? receipt.lots;
            return {
              id: `realized-${receipt.id}`,
              positionId: execution.result.closedPositionId ?? receipt.id,
              origin: "ACCOUNT" as const,
              label: `${market.name} ${market.tenorLabel}`,
              market,
              side: receipt.packageSide,
              lots,
              entryPrice: receipt.price,
              referencePrice: receipt.price,
              referenceLabel: "Close fill",
              amount: round2(receipt.realizedPnlUsd ?? 0),
              perPoint: lots * market.contractMultiplier,
              collateral: receipt.collateralReleasedUsd ?? 0,
              fees: receipt.fees,
              kind: "REALIZED" as const,
              stage: null,
              fixingMs: fixingSchedule(market).fixingMs,
              provenance: "OBSERVED" as const,
              atMs: isoMs(receipt.createdAt),
              receiptId: receipt.id,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null)
          .sort((left, right) => (right.atMs ?? 0) - (left.atMs ?? 0))
      : [];

  return [...projected, ...realized];
}

function reconciliation(snapshot: GatewaySnapshot, dossiers: readonly PositionDossier[]): ReconciliationRow[] {
  if (snapshot.wallet.status !== "CONNECTED") return [];
  const receiptIds = new Set(snapshot.receipts.map((receipt) => receipt.id.toLowerCase()));
  const rows: ReconciliationRow[] = [];

  for (const dossier of dossiers.filter((candidate) => candidate.origin === "ACCOUNT")) {
    const opening = dossier.fills.find((fill) => fill.kind === "OPEN") ?? null;
    const checks = [
      { label: "Opening fill linked", ok: opening !== null },
      { label: "Linked by execution record", ok: opening?.matchedBy === "EXECUTION" },
      { label: "Receipt carries transaction reference", ok: Boolean(opening?.receipt.transactionHash) },
      { label: "Entry equals fill price", ok: opening !== null && opening.receipt.price === dossier.entryPrice },
    ];
    const failed = checks.filter((check) => !check.ok).length;
    rows.push({
      id: `position-${dossier.id}`,
      subjectKind: "POSITION",
      subject: dossier.id,
      marketId: dossier.marketId,
      description: `${dossier.label}, ${dossier.lots} lots ${dossier.side.toLowerCase()}`,
      status: failed === 0 ? "MATCHED" : opening === null ? "MISMATCH" : "PENDING",
      checks,
      atMs: isoMs(dossier.openedAt),
      receiptId: opening?.receipt.id ?? null,
      transactionHash: opening?.receipt.transactionHash ?? null,
      positionId: dossier.id,
    });
  }

  for (const execution of snapshot.executions) {
    const receipt = execution.result.receipt;
    const filled = receipt.filledLots ?? receipt.lots;
    const requested = receipt.requestedLots ?? receipt.lots;
    const checks = [
      { label: "Receipt ready step recorded", ok: execution.updates.some((update) => update.step === "RECEIPT_READY") },
      { label: "Transaction reference present", ok: Boolean(receipt.transactionHash) },
      { label: "Fill within signed request", ok: filled <= requested + 1e-9 },
      {
        label: "Position link recorded",
        ok: Boolean(execution.result.position?.id ?? execution.result.closedPositionId),
      },
    ];
    rows.push({
      id: `fill-${execution.id}`,
      subjectKind: "FILL",
      subject: receipt.fillId,
      marketId: receipt.marketId,
      description: `${execution.result.outcome.toLowerCase()} ${filled} lots ${receipt.packageSide.toLowerCase()} via ${receipt.routeLabel}`,
      status: checks.every((check) => check.ok) ? "MATCHED" : "MISMATCH",
      checks,
      atMs: isoMs(receipt.createdAt),
      receiptId: receipt.id,
      transactionHash: receipt.transactionHash,
      positionId: execution.result.position?.id ?? execution.result.closedPositionId ?? null,
    });
  }

  for (const order of snapshot.restingOrders) {
    const working = order.state === "WORKING" || order.state === "PARTIALLY_FILLED";
    const receiptsPresent = order.receiptIds.every((id) => receiptIds.has(id.toLowerCase()));
    const checks = working
      ? [
          { label: "Reservation held for remaining lots", ok: order.remainingCollateralReservation >= 0 },
          { label: "Fill receipts present", ok: receiptsPresent },
        ]
      : [
          { label: "Terminal order state recorded", ok: true },
          { label: "Fill receipts present", ok: receiptsPresent },
        ];
    rows.push({
      id: `order-${order.id}`,
      subjectKind: "ORDER",
      subject: order.orderHash,
      marketId: order.marketId,
      description: `${order.side === "EXIT" ? "Close" : "Open"} ${order.lots} lots, ${order.state.replaceAll("_", " ").toLowerCase()}`,
      status: !receiptsPresent ? "MISMATCH" : working ? "OPEN" : "MATCHED",
      checks,
      atMs: isoMs(order.createdAt),
      receiptId: order.receiptIds[order.receiptIds.length - 1] ?? null,
      transactionHash: null,
      positionId: order.closePositionId,
    });
  }

  for (const request of snapshot.rfqRequests) {
    const executed = request.state === "EXECUTED";
    const receiptLinked = request.receiptId !== null && receiptIds.has(request.receiptId.toLowerCase());
    const checks = [
      { label: "Quote selection recorded", ok: request.state === "OPEN" || request.selectedQuoteId !== null || request.state === "CANCELLED" },
      { label: "Execution receipt linked", ok: executed ? receiptLinked : true },
    ];
    rows.push({
      id: `rfq-${request.id}`,
      subjectKind: "RFQ",
      subject: request.id,
      marketId: request.authorization.intent.marketId,
      description: `Private RFQ, ${request.authorization.intent.lots} lots, ${request.state.toLowerCase()}`,
      status: executed ? (receiptLinked ? "MATCHED" : "MISMATCH") : request.state === "CANCELLED" ? "MATCHED" : "OPEN",
      checks,
      atMs: isoMs(request.createdAt),
      receiptId: request.receiptId,
      transactionHash: null,
      positionId: request.authorization.intent.closePositionId,
    });
  }

  const rank = { MISMATCH: 0, PENDING: 1, OPEN: 2, MATCHED: 3 } as const;
  return rows.sort((left, right) => rank[left.status] - rank[right.status] || (right.atMs ?? 0) - (left.atMs ?? 0));
}

function exceptions(
  boundaryRows: readonly ScheduleBoundary[],
  markets: readonly PackageMarket[],
  dossiers: readonly PositionDossier[],
  recon: readonly ReconciliationRow[],
  nowMs: number,
): SettlementException[] {
  const rows: SettlementException[] = [];

  for (const boundary of boundaryRows) {
    if (boundary.kind !== "FIXING" || !boundary.adjustment || boundary.state === "PASSED") continue;
    const held = boundary.held.length > 0;
    rows.push({
      id: `calendar-${boundary.market.id}`,
      severity: held ? "ACTION" : "NOTICE",
      kind: "CALENDAR",
      title: `${boundary.market.code} fixes on a closed London session`,
      detail: `${formatUtcDate(boundary.adjustment.scheduled)} is ${boundary.adjustment.reason}. ${boundary.adjustment.rule} would move the print to ${formatUtcDate(boundary.adjustment.adjusted)}. The scheduled date stands until the series terms publish an adjustment.`,
      nextAction: held
        ? `Plan any roll or close to finish before ${formatUtcDate(boundary.adjustment.adjusted)}, 15:30 UTC, in case the session moves earlier.`
        : "No position is held. Check the series terms before trading this maturity into its fixing.",
      market: boundary.market,
      positionId: held ? boundary.held[0].positionId : null,
      origin: held ? boundary.held[0].origin : null,
      provenance: "MODELED",
      source: "LDN business calendar v1 (modeled)",
      href: held ? positionHref(boundary.held[0].positionId) : tradeHref(boundary.market),
      hrefLabel: held ? "Open position" : "Open market",
      atMs: boundary.atMs,
    });
  }

  for (const market of markets) {
    if (market.qualification === "QUALIFIED") continue;
    const held = dossiers.filter((dossier) => dossier.marketId === market.id && dossier.lots > 0);
    rows.push({
      id: `qualification-${market.id}`,
      severity: market.qualification === "SUSPENDED" ? "CRITICAL" : held.length > 0 ? "ACTION" : "NOTICE",
      kind: "QUALIFICATION",
      title: `${market.code} is ${market.qualification.toLowerCase()}`,
      detail: market.qualificationNote,
      nextAction:
        market.qualification === "SUSPENDED"
          ? "Entry is closed. Existing positions keep a permissionless path to terminal settlement."
          : held.length > 0
            ? "Position size is capped at this tenor. Confirm the benchmark attestation before adding risk or rolling into it."
            : "Entry is allowed with a size cap. Confirm the benchmark attestation before rolling into this tenor.",
      market,
      positionId: held[0]?.id ?? null,
      origin: held[0]?.origin ?? null,
      provenance: "OBSERVED",
      source: "Series qualification in the preview market feed",
      href: tradeHref(market),
      hrefLabel: "Open market",
      atMs: fixingSchedule(market).fixingMs,
    });
  }

  for (const dossier of dossiers.filter((candidate) => candidate.lots > 0)) {
    const market = markets.find((candidate) => candidate.id === dossier.marketId);
    if (!market) continue;
    const schedule = fixingSchedule(market);
    const toWindow = schedule.windowOpensMs - nowMs;
    if (nowMs >= schedule.fixingMs) {
      rows.push({
        id: `missing-${dossier.id}`,
        severity: "CRITICAL",
        kind: "FIXING_MISSING",
        title: `No fixing record for ${market.code}`,
        detail: `The scheduled print at ${formatUtcSession(schedule.fixingMs)} has passed and no committed fixing record is available to this interface.`,
        nextAction: "Terminal settlement completes permissionlessly once the fixing is committed. Inspect the series oracle state from operations.",
        market,
        positionId: dossier.id,
        origin: dossier.origin,
        provenance: "OBSERVED",
        source: market.fixingSource,
        href: positionHref(dossier.id),
        hrefLabel: "Open position",
        atMs: schedule.fixingMs,
      });
    } else if (toWindow <= 7 * DAY_MS) {
      rows.push({
        id: `proximity-${dossier.id}`,
        severity: "ACTION",
        kind: "FIXING_PROXIMITY",
        title: `${dossier.label} enters its fixing window in ${formatCountdownMs(toWindow)}`,
        detail: `${dossier.lots} lots ${dossier.side.toLowerCase()} settle in cash at ${market.fixingSource}. The ${FIXING_WINDOW_MINUTES}-minute observation window opens ${formatUtcSession(schedule.windowOpensMs)}.`,
        nextAction: "Roll to the next maturity or close before the window opens, or hold to cash settlement.",
        market,
        positionId: dossier.id,
        origin: dossier.origin,
        provenance: "MODELED",
        source: "Series terms schedule",
        href: `${positionHref(dossier.id)}?action=roll`,
        hrefLabel: "Review roll",
        atMs: schedule.windowOpensMs,
      });
    }
    for (const boundary of dossier.reference?.boundaries ?? []) {
      if (boundary.state !== "WINDOW_OPEN") continue;
      rows.push({
        id: `window-${dossier.id}-${boundary.id}`,
        severity: "ACTION",
        kind: "WINDOW",
        title: `${boundary.label} open on ${dossier.label}`,
        detail: `${boundary.source}. Window ${boundary.dueLabel}, ${boundary.timing}.`,
        nextAction: dossier.reference?.healthDetail ?? "Review the position before the window closes.",
        market,
        positionId: dossier.id,
        origin: dossier.origin,
        provenance: "MODELED",
        source: boundary.source,
        href: positionHref(dossier.id),
        hrefLabel: "Open position",
        atMs: parseBoundaryTiming(boundary.timing, nowMs),
      });
    }
  }

  for (const row of recon) {
    if (row.status !== "MISMATCH") continue;
    const failed = row.checks.filter((check) => !check.ok).map((check) => check.label.toLowerCase());
    rows.push({
      id: `recon-${row.id}`,
      severity: "CRITICAL",
      kind: "RECONCILIATION",
      title: `${row.subjectKind.toLowerCase()} record does not reconcile`,
      detail: `${row.description}. Failed: ${failed.join(", ")}.`,
      nextAction: row.receiptId
        ? "Inspect the receipt evidence and refresh account state from the chain."
        : "Refresh account state from the chain; open activity to inspect the attempt.",
      market: markets.find((candidate) => candidate.id === row.marketId) ?? null,
      positionId: row.positionId,
      origin: "ACCOUNT",
      provenance: "OBSERVED",
      source: "Account state cross-check",
      href: row.receiptId ? `/receipts/${encodeURIComponent(row.receiptId)}` : "/activity",
      hrefLabel: row.receiptId ? "Inspect receipt" : "Open activity",
      atMs: row.atMs,
    });
  }

  const rank: Record<ExceptionSeverity, number> = { CRITICAL: 0, ACTION: 1, NOTICE: 2 };
  return rows.sort(
    (left, right) => rank[left.severity] - rank[right.severity] || (left.atMs ?? Infinity) - (right.atMs ?? Infinity),
  );
}

export function settlementCenter({
  snapshot,
  markets,
  references,
  nowMs,
}: {
  snapshot: GatewaySnapshot;
  markets: readonly PackageMarket[];
  references: readonly LifecycleStrategy[];
  nowMs: number;
}): SettlementCenter {
  const dossiers = trackedDossiers(snapshot, markets, references);
  const boundaryRows = boundaries(markets, dossiers, nowMs);
  const payoutRows = payouts(snapshot, markets, dossiers, nowMs);
  const reconRows = reconciliation(snapshot, dossiers);
  const exceptionRows = exceptions(boundaryRows, markets, dossiers, reconRows, nowMs);

  const stages = Object.fromEntries(SETTLEMENT_STAGES.map((stage) => [stage, 0])) as Record<SettlementStage, number>;
  for (const row of payoutRows) if (row.kind === "PROJECTED" && row.stage) stages[row.stage] += 1;

  const upcomingFixings = boundaryRows.filter((row) => row.kind === "FIXING" && row.state !== "PASSED");
  const heldFixings = upcomingFixings.filter((row) => row.held.length > 0);
  const projectedAccount = payoutRows.filter((row) => row.kind === "PROJECTED" && row.origin === "ACCOUNT");
  const realizedRows = payoutRows.filter((row) => row.kind === "REALIZED");
  const exceptionCounts: Record<ExceptionSeverity, number> = { CRITICAL: 0, ACTION: 0, NOTICE: 0 };
  for (const row of exceptionRows) exceptionCounts[row.severity] += 1;
  const accountConnected = snapshot.wallet.status === "CONNECTED";

  return {
    nowMs,
    accountConnected,
    accountPositions: dossiers.filter((dossier) => dossier.origin === "ACCOUNT").length,
    referencePositions: dossiers.filter((dossier) => dossier.origin === "REFERENCE").length,
    families: families(markets),
    holidays: LONDON_HOLIDAYS,
    boundaries: boundaryRows,
    observations: observationGroups(markets, dossiers, nowMs),
    payouts: payoutRows,
    reconciliation: reconRows,
    exceptions: exceptionRows,
    stages,
    kpis: {
      nextFixing: upcomingFixings[0] ?? null,
      nextHeldFixing: heldFixings[0] ?? null,
      heldSeries: heldFixings.length,
      heldWithin30d: heldFixings.filter((row) => (row.atMs ?? Infinity) - nowMs <= 30 * DAY_MS).length,
      projectedAccount: accountConnected ? round2(projectedAccount.reduce((total, row) => total + row.amount, 0)) : null,
      projectedReference: round2(
        payoutRows
          .filter((row) => row.kind === "PROJECTED" && row.origin === "REFERENCE")
          .reduce((total, row) => total + row.amount, 0),
      ),
      realized: accountConnected ? round2(realizedRows.reduce((total, row) => total + row.amount, 0)) : null,
      realizedCount: realizedRows.length,
      reconMatched: reconRows.filter((row) => row.status === "MATCHED").length,
      reconTotal: reconRows.length,
      reconMismatch: reconRows.filter((row) => row.status === "MISMATCH").length,
      exceptionCounts,
    },
  };
}
