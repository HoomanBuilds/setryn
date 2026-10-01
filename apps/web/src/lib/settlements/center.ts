import type { GatewaySnapshot, OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import type { LiveMarketData, MarketDataSnapshot } from "@/lib/market-data/types";
import { MARK_SOURCE_LABEL, finite, forwardPnl, liveIndex, markOf, markProvenance, rangeTerms } from "@/lib/portfolio/forward";
import { positionHref, trackedDossiers, type PositionDossier } from "@/lib/positions/dossier";
import { tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import {
  SCHEDULE_SOURCE_LABEL,
  formatCountdownMs,
  formatUtcSession,
  seriesSchedule,
  type SeriesSchedule,
} from "./calendar";
import type {
  CalendarFamily,
  ExceptionSeverity,
  FixingRecordState,
  HeldExposure,
  InputObservation,
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

function lifecycleFor(snapshot: GatewaySnapshot, positionId: string): OnchainPositionLifecycle | null {
  return snapshot.lifecycles[positionId.toLowerCase()] ?? null;
}

/** A held series' onchain lifecycle, read from the first open position in it. */
function marketLifecycle(
  snapshot: GatewaySnapshot,
  dossiers: readonly PositionDossier[],
  marketId: string,
): OnchainPositionLifecycle | null {
  for (const dossier of dossiers) {
    if (dossier.marketId !== marketId) continue;
    const lifecycle = lifecycleFor(snapshot, dossier.id);
    if (lifecycle) return lifecycle;
  }
  return null;
}

/**
 * Where an open position sits on the dated settlement state machine. The position's onchain lifecycle decides once it
 * is read; before that the series schedule does, on the platform clock.
 */
export function settlementStage(
  market: PackageMarket,
  nowMs: number,
  lifecycle: OnchainPositionLifecycle | null = null,
): SettlementStage {
  const schedule = seriesSchedule(market, lifecycle?.schedule);
  if (lifecycle) {
    if (lifecycle.phase === "SETTLED" || lifecycle.phase === "LAPSED") return "RECONCILED";
    if (lifecycle.phase === "CLAIM_AVAILABLE") return "INCLUDED";
    if (lifecycle.phase === "EXERCISED") return "PAYOUT_COMPUTED";
    if (lifecycle.fixing.status === "DISPUTED") return "CHALLENGE_OR_FALLBACK";
    if (lifecycle.phase === "FIXED_AWAITING_ELECTION" || lifecycle.fixing.status === "FINALIZED") return "FIXING_OBSERVED";
    if (lifecycle.fixing.status === "PROPOSED") return "FIXING_OBSERVED";
  }
  if (nowMs < schedule.windowOpensMs) return "LIVE";
  if (nowMs < schedule.evidenceDeadlineMs) return "FIXING_WINDOW";
  /* The evidence deadline passed without a committed record; the series fallback applies. */
  return "FIXING_UNAVAILABLE";
}

function families(markets: readonly PackageMarket[]): CalendarFamily[] {
  const seen = new Map<string, CalendarFamily>();
  for (const market of markets) {
    const id = familyId(market);
    if (!seen.has(id)) seen.set(id, { id, label: market.name, underlying: market.underlying });
  }
  return [...seen.values()];
}

function familyId(market: PackageMarket): string {
  return `${market.underlying}:${market.strategyKind}`;
}

function scheduleProvenance(schedule: SeriesSchedule) {
  return schedule.source === "EXPIRY_RULE" ? ("MODELED" as const) : ("OBSERVED" as const);
}

function boundaryState(atMs: number, untilMs: number, nowMs: number): ScheduleBoundary["state"] {
  return nowMs >= untilMs ? "PASSED" : nowMs >= atMs ? "WINDOW_OPEN" : "UPCOMING";
}

function boundaries(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  dossiers: readonly PositionDossier[],
  nowMs: number,
): ScheduleBoundary[] {
  const rows: ScheduleBoundary[] = [];
  for (const market of markets) {
    const held = dossiers.filter((dossier) => dossier.marketId === market.id && dossier.lots > 0).map(heldFor);
    const schedule = seriesSchedule(market, marketLifecycle(snapshot, dossiers, market.id)?.schedule);
    const provenance = scheduleProvenance(schedule);
    const source = SCHEDULE_SOURCE_LABEL[schedule.source];
    rows.push({
      id: `fixing-${market.id}`,
      kind: "FIXING",
      market,
      family: familyId(market),
      label: "Cash settlement fixing",
      atMs: schedule.fixingMs,
      timingLabel: formatUtcSession(schedule.fixingMs),
      windowOpensMs: schedule.windowOpensMs,
      state: boundaryState(schedule.windowOpensMs, schedule.fixingMs, nowMs),
      held,
      provenance,
      source: `${market.fixingSource}, ${source.toLowerCase()}`,
    });
    if (held.length === 0) continue;
    rows.push({
      id: `last-trade-${market.id}`,
      kind: "LAST_TRADE",
      market,
      family: familyId(market),
      label: "Last trade",
      atMs: schedule.lastTradingMs,
      timingLabel: formatUtcSession(schedule.lastTradingMs),
      windowOpensMs: null,
      state: boundaryState(schedule.lastTradingMs, schedule.lastTradingMs, nowMs),
      held,
      provenance,
      source,
    });
    rows.push({
      id: `election-${market.id}`,
      kind: "ELECTION",
      market,
      family: familyId(market),
      label: "Holder election",
      atMs: schedule.electionOpensMs,
      timingLabel: formatUtcSession(schedule.electionOpensMs),
      windowOpensMs: schedule.electionOpensMs,
      state: boundaryState(schedule.electionOpensMs, schedule.electionClosesMs, nowMs),
      held,
      provenance,
      source,
    });
  }
  const order = (row: ScheduleBoundary) => (row.state === "WINDOW_OPEN" ? -Infinity : (row.atMs ?? Infinity));
  return rows.sort((left, right) => order(left) - order(right));
}

function fixingState(lifecycle: OnchainPositionLifecycle | null, schedule: SeriesSchedule, nowMs: number): FixingRecordState {
  const status = lifecycle?.fixing.status;
  if (status === "FINALIZED" || status === "PROPOSED" || status === "DISPUTED") return status;
  if (nowMs >= schedule.fixingMs) return "AWAITING_RECORD";
  if (nowMs >= schedule.windowOpensMs) return "WINDOW_OPEN";
  return "PENDING";
}

function inputs(market: PackageMarket, live: LiveMarketData | null, feed: MarketDataSnapshot | null, nowMs: number): InputObservation[] {
  const unit = "USD";
  const decimals = market.priceDecimals;
  const nowSeconds = Math.floor(nowMs / 1000);
  const snapshotAge = feed ? Math.max(0, nowSeconds - feed.asOf) : null;
  const reference = feed?.references[market.underlying] ?? null;
  const last = live?.trades[0] ?? null;
  const rows: InputObservation[] = [
    {
      id: `${market.id}-reference`,
      label: `${market.underlying} reference`,
      role: "Underlying spot",
      value: reference && finite(reference.price) ? reference.price : null,
      unit,
      decimals,
      ageSeconds: reference ? Math.max(0, nowSeconds - reference.updatedAt) : null,
      provenance: "OBSERVED",
      source: reference ? `Chainlink aggregator, chain ${reference.chainId}` : "Chainlink reference not read",
    },
    {
      id: `${market.id}-bid`,
      label: "Best bid",
      role: "Book touch",
      value: live && finite(live.bestBid) ? live.bestBid : null,
      unit,
      decimals,
      ageSeconds: live && finite(live.bestBid) ? snapshotAge : null,
      provenance: "EXECUTABLE",
      source: "Onchain public book",
    },
    {
      id: `${market.id}-ask`,
      label: "Best ask",
      role: "Book touch",
      value: live && finite(live.bestAsk) ? live.bestAsk : null,
      unit,
      decimals,
      ageSeconds: live && finite(live.bestAsk) ? snapshotAge : null,
      provenance: "EXECUTABLE",
      source: "Onchain public book",
    },
    {
      id: `${market.id}-last`,
      label: "Last fill",
      role: last ? `${last.lots} lots, ${last.side === "BUY" ? "buyer" : "seller"} aggressor` : "No fill yet",
      value: last ? last.price : null,
      unit,
      decimals,
      ageSeconds: last ? Math.max(0, nowSeconds - last.time) : null,
      provenance: "OBSERVED",
      source: "Clearing engine fills",
    },
  ];
  return rows;
}

function observationGroups(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  dossiers: readonly PositionDossier[],
  feed: MarketDataSnapshot | null,
  nowMs: number,
): ObservationGroup[] {
  const live = liveIndex(feed);
  return markets
    .map((market) => {
      const lifecycle = marketLifecycle(snapshot, dossiers, market.id);
      const schedule = seriesSchedule(market, lifecycle?.schedule);
      const marketLive = live.get(market.id) ?? null;
      const mark = markOf(marketLive);
      return {
        market,
        held: dossiers.filter((dossier) => dossier.marketId === market.id && dossier.lots > 0).map(heldFor),
        fixingMs: schedule.fixingMs,
        windowOpensMs: schedule.windowOpensMs,
        fixingState: fixingState(lifecycle, schedule, nowMs),
        fixingValue: lifecycle && lifecycle.fixing.status !== "PENDING" ? lifecycle.fixing.value : null,
        packageMark: mark.price,
        markSource: mark.source,
        markAgeSeconds: feed ? Math.max(0, Math.floor(nowMs / 1000) - feed.asOf) : null,
        inputs: inputs(market, marketLive, feed, nowMs),
      };
    })
    .sort((left, right) => left.fixingMs - right.fixingMs);
}

function payouts(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  dossiers: readonly PositionDossier[],
  feed: MarketDataSnapshot | null,
  nowMs: number,
): PayoutRow[] {
  const live = liveIndex(feed);
  const projected: PayoutRow[] = dossiers
    .filter((dossier) => dossier.lots > 0)
    .map((dossier) => {
      const market = markets.find((candidate) => candidate.id === dossier.marketId);
      if (!market) return null;
      const lifecycle = lifecycleFor(snapshot, dossier.id);
      const terms = rangeTerms(market);
      const perPoint = dossier.lots * terms.lotSize;
      const schedule = seriesSchedule(market, lifecycle?.schedule);
      const fixed = lifecycle?.fixing.status === "FINALIZED" && lifecycle.fixing.value !== null ? lifecycle.fixing.value : null;
      const mark = markOf(live.get(market.id));
      const level = fixed ?? mark.price;
      const amount =
        lifecycle?.projectedPnlUsd ?? (level === null ? 0 : forwardPnl(dossier.side, dossier.lots, dossier.entryPrice, level, terms));
      return {
        id: `projected-${dossier.id}`,
        positionId: dossier.id,
        origin: dossier.origin,
        label: dossier.label,
        market,
        side: dossier.side,
        lots: dossier.lots,
        entryPrice: dossier.entryPrice,
        referencePrice: level,
        referenceLabel: fixed !== null ? "Final fixing" : mark.price !== null ? MARK_SOURCE_LABEL[mark.source] : "No mark",
        amount: round2(amount),
        perPoint,
        collateral: dossier.collateral,
        fees: dossier.fees,
        kind: "PROJECTED" as const,
        stage: settlementStage(market, nowMs, lifecycle),
        fixingMs: schedule.fixingMs,
        provenance: fixed !== null || lifecycle?.projectedPnlUsd != null ? ("OBSERVED" as const) : level === null ? ("MODELED" as const) : markProvenance(mark.source),
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
              perPoint: lots * rangeTerms(market).lotSize,
              collateral: receipt.collateralReleasedUsd ?? 0,
              fees: receipt.fees,
              kind: "REALIZED" as const,
              stage: null,
              fixingMs: seriesSchedule(market).fixingMs,
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

  for (const dossier of dossiers) {
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
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  dossiers: readonly PositionDossier[],
  recon: readonly ReconciliationRow[],
  feed: MarketDataSnapshot | null,
  nowMs: number,
): SettlementException[] {
  const rows: SettlementException[] = [];
  const live = liveIndex(feed);

  for (const market of markets) {
    const status = live.get(market.id)?.seriesStatus;
    if (!status || status === "ACTIVE" || status === "UNKNOWN") continue;
    const held = dossiers.filter((dossier) => dossier.marketId === market.id && dossier.lots > 0);
    rows.push({
      id: `series-${market.id}`,
      severity: status === "PAUSED" ? (held.length > 0 ? "ACTION" : "NOTICE") : held.length > 0 ? "ACTION" : "NOTICE",
      kind: "SERIES_STATUS",
      title: `${market.code} is ${status.toLowerCase()} onchain`,
      detail:
        status === "PAUSED"
          ? "The series accepts no new fills while paused. Held positions keep their permissionless path to terminal settlement."
          : status === "EXPIRED"
            ? "The series has expired; held positions settle against the fixing."
            : "The series is deprecated; its book takes no new risk.",
      nextAction: held.length > 0 ? "Hold to settlement or close once the series resumes." : "No position is held in this series.",
      market,
      positionId: held[0]?.id ?? null,
      origin: held[0]?.origin ?? null,
      provenance: "OBSERVED",
      source: "Series registry, onchain",
      href: held[0] ? positionHref(held[0].id) : tradeHref(market),
      hrefLabel: held[0] ? "Open position" : "Open market",
      atMs: null,
    });
  }

  for (const dossier of dossiers.filter((candidate) => candidate.lots > 0)) {
    const market = markets.find((candidate) => candidate.id === dossier.marketId);
    if (!market) continue;
    const lifecycle = lifecycleFor(snapshot, dossier.id);
    const schedule = seriesSchedule(market, lifecycle?.schedule);
    const source = SCHEDULE_SOURCE_LABEL[schedule.source];
    const provenance = scheduleProvenance(schedule);
    if (lifecycle?.phase === "FIXED_AWAITING_ELECTION" && lifecycle.holdsElection) {
      rows.push({
        id: `election-${dossier.id}`,
        severity: "ACTION",
        kind: "ELECTION",
        title: `Elect on ${dossier.label} before ${formatUtcSession(schedule.electionClosesMs)}`,
        detail: `The final fixing is on the position. ${lifecycle.remainingLots} lots await the holder's election.`,
        nextAction: "Open the position and exercise, or let the series' exercise policy apply at the cutoff.",
        market,
        positionId: dossier.id,
        origin: dossier.origin,
        provenance: "OBSERVED",
        source: "Position engine, onchain",
        href: `${positionHref(dossier.id)}?action=settle`,
        hrefLabel: "Open election",
        atMs: schedule.electionClosesMs,
      });
      continue;
    }
    if (lifecycle?.phase === "CLAIM_AVAILABLE") {
      rows.push({
        id: `claim-${dossier.id}`,
        severity: "ACTION",
        kind: "CLAIM",
        title: `A settlement claim is open on ${dossier.label}`,
        detail: lifecycle.settlement?.claim
          ? `${round2(lifecycle.settlement.claim.amountUsd).toLocaleString("en-US")} USDC is claimable.`
          : "The settlement opened a claim for this account.",
        nextAction: "Open the position and take the claim; anyone can complete it.",
        market,
        positionId: dossier.id,
        origin: dossier.origin,
        provenance: "OBSERVED",
        source: "Settlement coordinator, onchain",
        href: `${positionHref(dossier.id)}?action=settle`,
        hrefLabel: "Open claim",
        atMs: null,
      });
      continue;
    }
    const finalized = lifecycle?.fixing.status === "FINALIZED";
    const toLastTrade = schedule.lastTradingMs - nowMs;
    if (!finalized && nowMs >= schedule.evidenceDeadlineMs) {
      rows.push({
        id: `missing-${dossier.id}`,
        severity: "CRITICAL",
        kind: "FIXING_MISSING",
        title: `No fixing record for ${market.code}`,
        detail: `The evidence deadline at ${formatUtcSession(schedule.evidenceDeadlineMs)} has passed and no committed fixing record is on the position.`,
        nextAction: "Terminal settlement completes permissionlessly once the fixing is committed, or through the series fallback.",
        market,
        positionId: dossier.id,
        origin: dossier.origin,
        provenance: lifecycle ? "OBSERVED" : provenance,
        source: market.fixingSource,
        href: positionHref(dossier.id),
        hrefLabel: "Open position",
        atMs: schedule.evidenceDeadlineMs,
      });
    } else if (toLastTrade > 0 && toLastTrade <= 7 * DAY_MS) {
      rows.push({
        id: `proximity-${dossier.id}`,
        severity: "ACTION",
        kind: "FIXING_PROXIMITY",
        title: `${dossier.label} stops trading in ${formatCountdownMs(toLastTrade)}`,
        detail: `${dossier.lots} lots ${dossier.side.toLowerCase()} settle in cash at ${market.fixingSource}. The ${schedule.windowMinutes}-minute fixing window opens ${formatUtcSession(schedule.windowOpensMs)}.`,
        nextAction: "Roll to the next maturity or close before the last trade, or hold to cash settlement.",
        market,
        positionId: dossier.id,
        origin: dossier.origin,
        provenance,
        source,
        href: `${positionHref(dossier.id)}?action=roll`,
        hrefLabel: "Review roll",
        atMs: schedule.lastTradingMs,
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
  feed,
  nowMs,
}: {
  snapshot: GatewaySnapshot;
  markets: readonly PackageMarket[];
  /** One market-data snapshot, so marks, books and references agree. */
  feed: MarketDataSnapshot | null;
  nowMs: number;
}): SettlementCenter {
  const dossiers = trackedDossiers(snapshot, markets);
  const boundaryRows = boundaries(snapshot, markets, dossiers, nowMs);
  const payoutRows = payouts(snapshot, markets, dossiers, feed, nowMs);
  const reconRows = reconciliation(snapshot, dossiers);
  const exceptionRows = exceptions(snapshot, markets, dossiers, reconRows, feed, nowMs);

  const stages = Object.fromEntries(SETTLEMENT_STAGES.map((stage) => [stage, 0])) as Record<SettlementStage, number>;
  for (const row of payoutRows) if (row.kind === "PROJECTED" && row.stage) stages[row.stage] += 1;

  const upcomingFixings = boundaryRows.filter((row) => row.kind === "FIXING" && row.state !== "PASSED");
  const heldFixings = upcomingFixings.filter((row) => row.held.length > 0);
  const projectedAccount = payoutRows.filter((row) => row.kind === "PROJECTED");
  const realizedRows = payoutRows.filter((row) => row.kind === "REALIZED");
  const exceptionCounts: Record<ExceptionSeverity, number> = { CRITICAL: 0, ACTION: 0, NOTICE: 0 };
  for (const row of exceptionRows) exceptionCounts[row.severity] += 1;
  const accountConnected = snapshot.wallet.status === "CONNECTED";

  return {
    nowMs,
    accountConnected,
    accountPositions: dossiers.length,
    families: families(markets),
    boundaries: boundaryRows,
    observations: observationGroups(snapshot, markets, dossiers, feed, nowMs),
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
      realized: accountConnected ? round2(realizedRows.reduce((total, row) => total + row.amount, 0)) : null,
      realizedCount: realizedRows.length,
      reconMatched: reconRows.filter((row) => row.status === "MATCHED").length,
      reconTotal: reconRows.length,
      reconMismatch: reconRows.filter((row) => row.status === "MISMATCH").length,
      exceptionCounts,
    },
  };
}
