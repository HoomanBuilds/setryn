import {
  buildPreview,
  executableAction,
  protectedPrice,
  routePrice,
  DEFAULT_SLIPPAGE_BPS,
  type EconomicsPreview,
  type TicketState,
} from "@/lib/terminal/economics";
import { MARKETS, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket, Provenance, RouteQuote } from "@/lib/terminal/types";
import { fixingSchedule } from "@/lib/settlements/calendar";
import type { PositionDossier } from "./dossier";

/** Maintenance floor as a share of posted collateral, the portfolio runtime's rule. */
export const MAINTENANCE_SHARE = 0.75;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface PositionMetrics {
  direction: 1 | -1;
  /** Package mark from the shared preview board. */
  mark: number;
  /** Executable price that closes the position now: bid for a long, ask for a short. */
  closeTouch: number;
  /** USDC per 1.00 of package price across the open lots. */
  perPoint: number;
  notional: number;
  pricePnl: number;
  totalPnl: number;
  touchPnl: number;
  equity: number;
  maintenance: number;
  buffer: number;
  bufferShare: number;
  liquidationPrice: number | null;
  /** Provenance of the position record the figures are derived from. */
  recordProvenance: Provenance;
  /** Derived figures inherit the weakest input: a modeled record makes them modeled. */
  derivedProvenance: Provenance;
  fixingMs: number;
  windowOpensMs: number;
  msToFixing: number;
}

export function positionMetrics(dossier: PositionDossier, market: PackageMarket, nowMs: number): PositionMetrics {
  const direction = dossier.side === "LONG" ? 1 : -1;
  const lots = dossier.lots;
  const perPoint = lots * market.contractMultiplier;
  const mark = market.netPrice;
  const closeTouch = dossier.side === "LONG" ? market.bestBid : market.bestAsk;
  const pricePnl = round2((mark - dossier.entryPrice) * perPoint * direction);
  const totalPnl = round2(pricePnl - dossier.fees);
  const touchPnl = round2((closeTouch - dossier.entryPrice) * perPoint * direction - dossier.fees);
  const equity = round2(dossier.collateral + totalPnl);
  const reference = dossier.reference;
  /* A reference record carries its own liquidation distance, which the lifecycle console shows,
     so the buffer is read from it rather than re-derived and contradicted. */
  const bufferShare =
    reference !== null
      ? reference.liquidationDistance / 100
      : equity === 0
        ? 0
        : (equity - dossier.collateral * MAINTENANCE_SHARE) / equity;
  const buffer = round2(equity * bufferShare);
  const maintenance = round2(equity - buffer);
  const bufferPoints = perPoint === 0 ? 0 : buffer / perPoint;
  const liquidation = round2(mark - direction * bufferPoints);
  const schedule = fixingSchedule(market);
  const recordProvenance: Provenance = dossier.origin === "ACCOUNT" ? "OBSERVED" : "MODELED";
  return {
    direction,
    mark,
    closeTouch,
    perPoint,
    notional: lots * market.notionalPerLot,
    pricePnl,
    totalPnl,
    touchPnl,
    equity,
    maintenance,
    buffer,
    bufferShare,
    liquidationPrice: dossier.lots > 0 && liquidation > 0 ? liquidation : null,
    recordProvenance,
    derivedProvenance: dossier.origin === "ACCOUNT" ? "ESTIMATED" : "MODELED",
    fixingMs: schedule.fixingMs,
    windowOpensMs: schedule.windowOpensMs,
    msToFixing: schedule.fixingMs - nowMs,
  };
}

/* ------------------------------------------------------------------ */
/* Terminal preflight                                                  */
/* ------------------------------------------------------------------ */

/**
 * The best route the terminal would offer for this action, skipping private
 * routes (they need an RFQ) and routes without the capacity.
 */
export function indicativeRoute(market: PackageMarket, action: "BUY" | "SELL", lots: number): RouteQuote | null {
  const candidates = market.routes.filter((route) => !route.requiresPrivate);
  const sized = candidates.filter((route) => route.availableLots >= lots);
  const pool = sized.length > 0 ? sized : candidates;
  if (pool.length === 0) return null;
  return [...pool].sort((left, right) =>
    action === "BUY" ? routePrice(left, action) - routePrice(right, action) : routePrice(right, action) - routePrice(left, action),
  )[0];
}

function ticket(
  market: PackageMarket,
  intent: TicketState["intent"],
  side: TicketState["side"],
  lots: number,
  route: RouteQuote | null,
  closePositionId: string | null,
): TicketState {
  const action = executableAction(intent, side);
  const reference = route ? routePrice(route, action) : action === "BUY" ? market.bestAsk : market.bestBid;
  return {
    intent,
    side,
    orderType: "MARKETABLE_LIMIT",
    lotsInput: String(lots),
    limitInput: protectedPrice(reference, action, DEFAULT_SLIPPAGE_BPS, market).toFixed(market.priceDecimals),
    /* A lifecycle exit runs fill-or-kill so a partial close cannot strand a hedge leg. */
    tif: intent === "EXIT" ? "FOK" : "GTC",
    expiresAt: null,
    privateRfq: false,
    routeId: route?.id ?? null,
    closePositionId,
  };
}

export interface ClosePreview {
  lots: number;
  remainingLots: number;
  route: RouteQuote | null;
  preview: EconomicsPreview;
  /** Executable route price for the close. */
  price: number;
  fees: number;
  realizedPnl: number;
  collateralRelease: number;
  /** Terminal preflight conditions, verbatim from the ticket economics. */
  blockers: string[];
  /** Conditions this page knows the terminal will add, stated before the handoff. */
  notices: string[];
}

export function closePreview(dossier: PositionDossier, market: PackageMarket, lots: number): ClosePreview {
  const size = Math.max(0, Math.min(lots, dossier.lots));
  const action = executableAction("EXIT", dossier.side);
  const route = indicativeRoute(market, action, size);
  const preview = buildPreview(market, ticket(market, "EXIT", dossier.side, size, route, dossier.id), route, {
    lots: dossier.lots,
    side: dossier.side,
  });
  const direction = dossier.side === "LONG" ? 1 : -1;
  const realizedGross = (preview.routePrice - dossier.entryPrice) * size * market.contractMultiplier * direction;
  const notices: string[] = [];
  if (dossier.origin === "REFERENCE") {
    notices.push(
      "Reference record, not held by the connected account. The terminal opens with this request and blocks authorization until an account position is selected.",
    );
  }
  return {
    lots: size,
    remainingLots: dossier.lots - size,
    route,
    preview,
    price: preview.routePrice,
    fees: round2(preview.totalFees),
    realizedPnl: round2(realizedGross - preview.totalFees),
    collateralRelease: dossier.lots === 0 ? 0 : round2((dossier.collateral * size) / dossier.lots),
    blockers: preview.blockers,
    notices,
  };
}

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

/** Later maturities of the same package family, nearest first. */
export function rollTargets(market: PackageMarket, markets: readonly PackageMarket[]): PackageMarket[] {
  return markets
    .filter(
      (candidate) =>
        candidate.name === market.name &&
        candidate.strategyKind === market.strategyKind &&
        candidate.expiryIso > market.expiryIso,
    )
    .sort((left, right) => left.expiryIso.localeCompare(right.expiryIso));
}

export interface RollPreview {
  target: PackageMarket;
  lots: number;
  close: ClosePreview;
  openRoute: RouteQuote | null;
  openPreview: EconomicsPreview;
  openPrice: number;
  /** Target entry less current exit, in package price units. */
  rollSpread: number;
  /** USDC paid crossing from each mark to its executable touch, both tickets together. */
  crossingCost: number;
  fees: number;
  collateralRelease: number;
  collateralRequired: number;
  netCollateral: number;
  extensionDays: number;
  openBlockers: string[];
}

export function rollPreview(
  dossier: PositionDossier,
  current: PackageMarket,
  target: PackageMarket,
  lots: number,
): RollPreview {
  const close = closePreview(dossier, current, lots);
  const openAction = executableAction("ENTER", dossier.side);
  const openRoute = indicativeRoute(target, openAction, close.lots);
  const openPreview = buildPreview(target, ticket(target, "ENTER", dossier.side, close.lots, openRoute, null), openRoute);
  const direction = dossier.side === "LONG" ? 1 : -1;
  const rollSpread = openPreview.routePrice - close.price;
  const closeCross = (current.netPrice - close.price) * direction * close.lots * current.contractMultiplier;
  const openCross = (openPreview.routePrice - target.netPrice) * direction * close.lots * target.contractMultiplier;
  const crossingCost = round2(closeCross + openCross);
  /* The open ticket is margined exactly as the terminal will margin it, whatever basis the source record used. */
  const collateralRequired = round2(openPreview.totalCollateral);
  const extensionDays = Math.round(
    (Date.parse(`${target.expiryIso}T16:00:00Z`) - Date.parse(`${current.expiryIso}T16:00:00Z`)) / 86_400_000,
  );
  return {
    target,
    lots: close.lots,
    close,
    openRoute,
    openPreview,
    openPrice: openPreview.routePrice,
    rollSpread,
    crossingCost,
    fees: round2(close.fees + openPreview.totalFees),
    collateralRelease: close.collateralRelease,
    collateralRequired,
    netCollateral: round2(collateralRequired - close.collateralRelease),
    extensionDays,
    openBlockers: openPreview.blockers,
  };
}

/* ------------------------------------------------------------------ */
/* Terminal handoffs                                                   */
/* ------------------------------------------------------------------ */

const SOURCE = { source: "positions", sourceLabel: "Position" } as const;

/** Close or reduce through the package terminal. The terminal re-quotes and owns authorization. */
export function closeHandoffHref(dossier: PositionDossier, market: PackageMarket, lots: number, maxCloseCost?: number): string {
  const params = new URLSearchParams({
    ...SOURCE,
    lifecycle: dossier.id,
    intent: lots < dossier.lots ? "derisk" : "exit",
    direction: dossier.side.toLowerCase(),
    lots: String(lots),
    guarantee: dossier.guarantee.toLowerCase(),
  });
  if (maxCloseCost !== undefined && maxCloseCost > 0) params.set("maxCloseCost", maxCloseCost.toFixed(2));
  return `${tradeHref(market)}?${params.toString()}`;
}

/** Opening ticket for the roll target, carrying the source position for traceability. */
export function rollOpenHandoffHref(dossier: PositionDossier, target: PackageMarket, lots: number): string {
  const params = new URLSearchParams({
    ...SOURCE,
    lifecycle: dossier.id,
    intent: "roll",
    direction: dossier.side.toLowerCase(),
    lots: String(lots),
  });
  return `${tradeHref(target)}?${params.toString()}`;
}

export function marketFor(marketId: string, markets: readonly PackageMarket[]): PackageMarket | null {
  return markets.find((market) => market.id === marketId) ?? MARKETS.find((market) => market.id === marketId) ?? null;
}
