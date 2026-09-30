import type { Guarantee, PackageMarket, RouteQuote } from "./types";

export type Intent = "ENTER" | "EXIT";
export type PackageSide = "LONG" | "SHORT";
export type ExecutableAction = "BUY" | "SELL";
export type OrderType = "MARKETABLE_LIMIT" | "LIMIT";
export type TimeInForce = "GTC" | "GTD" | "IOC" | "FOK";

export const GTD_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export interface TicketState {
  intent: Intent;
  side: PackageSide;
  orderType: OrderType;
  lotsInput: string;
  limitInput: string;
  tif: TimeInForce;
  expiresAt: string | null;
  privateRfq: boolean;
  routeId: string | null;
  closePositionId: string | null;
}

export interface ClosePositionRef {
  lots: number;
  side: PackageSide;
}

export function isPackageSide(value: unknown): value is PackageSide {
  return value === "LONG" || value === "SHORT";
}

export function isRestingTimeInForce(tif: TimeInForce): boolean {
  return tif === "GTC" || tif === "GTD";
}

export function defaultGtdExpiry(fromMs = Date.now()): string {
  return new Date(fromMs + 60 * 60 * 1000).toISOString();
}

/** UI blocker for a GTD expiry. Null when the expiry is a finite future time within 30 days. */
export function gtdExpiryBlocker(expiresAt: string | null, nowMs = Date.now()): string | null {
  if (typeof expiresAt !== "string" || expiresAt.length === 0) {
    return "Select a GTD expiry in the future within 30 days.";
  }
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) {
    return "Select a GTD expiry in the future within 30 days.";
  }
  if (parsed <= nowMs) {
    return "GTD expiry must be in the future.";
  }
  if (parsed - nowMs > GTD_MAX_MS) {
    return "GTD expiry cannot exceed 30 days.";
  }
  return null;
}

export function executableAction(intent: Intent, side: PackageSide): ExecutableAction {
  if (intent === "ENTER") return side === "LONG" ? "BUY" : "SELL";
  return side === "LONG" ? "SELL" : "BUY";
}

export interface EconomicsPreview {
  requestedLots: number;
  fillLots: number;
  cancelledLots: number;
  limitPrice: number;
  notional: number;
  routePrice: number;
  effectivePrice: number;
  action: ExecutableAction;
  packageSide: PackageSide;
  totalCollateral: number;
  protocolFee: number;
  counterpartyFee: number;
  counterpartyFeeLabel: string;
  totalFees: number;
  maxIntermediateExposure: number;
  terminalResidual: number;
  settlementGuarantee: string;
  guaranteeDetail: string;
  freshnessLabel: string;
  freshnessSeconds: number;
  marketable: boolean;
  rests: boolean;
  /** Route choice is explicit, so its absence is an instruction and never an error. */
  routeMissing: boolean;
  blockers: string[];
}

export const GUARANTEE_COPY: Record<Guarantee, { label: string; detail: string }> = {
  PACKAGE_ATOMIC: {
    label: "Package atomic",
    detail: "Every leg prints in one match or none of them do. No partial package can exist.",
  },
  LEG_SEQUENCED: {
    label: "Leg sequenced",
    detail: "Legs print in order. The package is unhedged between the first and last confirmation.",
  },
  SOLVER_BONDED: {
    label: "Solver bonded",
    detail: "The solver posts bonded capacity for the accepted quote and absorbs the sequencing risk.",
  },
};

export function availableRoutes(market: PackageMarket, privateRfq: boolean): RouteQuote[] {
  return market.routes.filter((route) => !route.requiresPrivate || privateRfq);
}

export function routePrice(route: RouteQuote, action: ExecutableAction): number {
  return action === "BUY" ? route.enterPrice : route.exitPrice;
}

export function bestReferencePrice(market: PackageMarket, action: ExecutableAction): number {
  return action === "BUY" ? market.bestAsk : market.bestBid;
}

export const SLIPPAGE_PRESETS_BPS = [10, 50, 100, 200] as const;
export const DEFAULT_SLIPPAGE_BPS = 50;

/**
 * Worst accepted price for a market order: the executable reference moved against the trader by the slippage
 * tolerance, at least one tick, and rounded outward onto the tick grid. It follows the live route, so a market
 * order never carries a protection price that the feed has already moved through.
 */
export function protectedPrice(
  reference: number,
  action: ExecutableAction,
  toleranceBps: number,
  market: Pick<PackageMarket, "tickSize" | "priceDecimals">,
): number {
  const band = Math.max(market.tickSize, (Math.abs(reference) * toleranceBps) / 10_000);
  const raw = action === "BUY" ? reference + band : reference - band;
  const ticks = action === "BUY" ? Math.ceil(raw / market.tickSize - 1e-9) : Math.floor(raw / market.tickSize + 1e-9);
  return Number((ticks * market.tickSize).toFixed(market.priceDecimals));
}

/**
 * A buyer improves by bidding at or above the route offer; a seller improves by
 * offering at or below the route bid. Both collapse to the same crossing test.
 */
export function limitCrosses(limitPrice: number, price: number, action: ExecutableAction): boolean {
  return action === "BUY" ? limitPrice >= price : limitPrice <= price;
}

export function buildPreview(
  market: PackageMarket,
  state: TicketState,
  route: RouteQuote | null,
  closePosition?: ClosePositionRef | null,
): EconomicsPreview {
  const requestedLots = Math.max(0, Number.parseFloat(state.lotsInput) || 0);
  const limitPrice = Number.parseFloat(state.limitInput) || 0;

  const isExit = state.intent === "EXIT";
  const packageSide: PackageSide =
    isExit && closePosition ? closePosition.side : state.side;
  const action = executableAction(state.intent, packageSide);
  const price = route ? routePrice(route, action) : bestReferencePrice(market, action);
  const marketable = limitCrosses(limitPrice, price, action);
  const rests = state.orderType === "LIMIT" && !marketable && isRestingTimeInForce(state.tif);
  const effectivePrice = state.orderType === "LIMIT" && !marketable ? limitPrice : price;

  const iocPartial = state.tif === "IOC" && marketable && route != null;
  const fillLots = iocPartial
    ? Math.min(requestedLots, route.availableLots)
    : requestedLots;
  const cancelledLots = Math.max(0, requestedLots - fillLots);
  const notional = market.feeOnConsideration
    ? fillLots * Math.abs(effectivePrice) * market.contractMultiplier
    : fillLots * market.notionalPerLot;

  const protocolFeeBps = route?.protocolFeeBps ?? 2.5;
  const counterpartyFeeBps = route?.counterpartyFeeBps ?? 0;
  const collateralMultiple = route?.collateralMultiple ?? 1;
  const exposureRate = route?.intermediateExposureRate ?? 0;

  const protocolFee = (notional * protocolFeeBps) / 10_000;
  const counterpartyFee = (notional * counterpartyFeeBps) / 10_000;

  const guarantee = route ? GUARANTEE_COPY[route.guarantee] : null;

  const blockers: string[] = [];
  if (requestedLots <= 0) blockers.push("Enter a package quantity above zero.");
  if (market.maxOrderLots != null && requestedLots > market.maxOrderLots) {
    blockers.push(`This market accepts at most ${market.maxOrderLots} lots per order.`);
  }
  if (limitPrice === 0) blockers.push("Enter a package-price limit.");
  if (isExit) {
    if (!closePosition || !(closePosition.lots > 0)) {
      blockers.push("Exit requires exactly one active runtime package. Select a package to close.");
    } else {
      if (requestedLots > closePosition.lots) {
        blockers.push(
          `Quantity exceeds the selected package lots (${closePosition.lots} lots). Reduce quantity to close within the active package.`,
        );
      }
      if (requestedLots !== closePosition.lots) {
        blockers.push("Devnet lifecycle exit currently requires the complete position quantity.");
      }
      if (state.tif !== "FOK") {
        blockers.push("A lifecycle exit uses FOK so a partial close cannot leave an unmatched hedge.");
      }
      if (state.side !== closePosition.side) {
        blockers.push("Ticket side does not match the selected position side. Reselect the position.");
      }
    }
  }
  if (route && requestedLots > route.availableLots && !(state.tif === "IOC" && marketable && fillLots > 0)) {
    if (state.tif === "FOK") {
      blockers.push("Fill or kill cannot clear more than the reserved route capacity.");
    } else {
      blockers.push(
        `Route capacity is ${route.availableLots} lots. Reduce quantity or pick another route.`,
      );
    }
  }
  if (state.orderType === "MARKETABLE_LIMIT" && route && !marketable) {
    blockers.push(
      action === "BUY"
        ? "A marketable limit must be at or above the route offer."
        : "A marketable limit must be at or below the route bid.",
    );
  }
  if (state.orderType === "LIMIT" && !marketable && (state.tif === "IOC" || state.tif === "FOK")) {
    blockers.push(
      "A non-marketable limit with IOC or FOK cannot rest. Use GTC to rest the order or adjust the limit to cross.",
    );
  }
  if (state.tif === "GTD") {
    if (state.orderType !== "LIMIT") {
      blockers.push("GTD requires a limit order. Use limit to rest with expiry.");
    } else {
      const expiryBlocker = gtdExpiryBlocker(state.expiresAt);
      if (expiryBlocker) blockers.push(expiryBlocker);
    }
  } else if (state.expiresAt !== null) {
    blockers.push("Expiry applies only to GTD.");
  }
  if (market.qualification === "SUSPENDED") {
    blockers.push("Market qualification is suspended. Entry is closed until the benchmark requalifies.");
  }

  return {
    requestedLots,
    fillLots,
    cancelledLots,
    limitPrice,
    notional,
    routePrice: price,
    effectivePrice,
    action,
    packageSide,
    totalCollateral: isExit ? 0 : fillLots * market.collateralPerLot * collateralMultiple,
    protocolFee,
    counterpartyFee,
    counterpartyFeeLabel: route?.counterpartyFeeLabel ?? "Counterparty fee",
    totalFees: protocolFee + counterpartyFee,
    maxIntermediateExposure: notional * exposureRate,
    terminalResidual:
      fillLots * market.residualPerLot * (packageSide === "LONG" ? 1 : -1) * (isExit ? -1 : 1),
    settlementGuarantee: guarantee?.label ?? "Not selected",
    guaranteeDetail:
      guarantee?.detail ?? "Pick a route to see which settlement guarantee applies to this package.",
    freshnessLabel: route
      ? `${route.label}, preview snapshot`
      : "Package mark, preview snapshot",
    freshnessSeconds: market.snapshotAgeSeconds,
    marketable,
    rests,
    routeMissing: !route,
    blockers,
  };
}

export type StageState =
  | { kind: "IDLE" }
  | { kind: "COMPILED"; reference: string }
  | { kind: "EXECUTING"; reference: string }
  | { kind: "RESTING"; reference: string; orderId: string }
  | { kind: "RFQ"; reference: string; requestId: string }
  | { kind: "RFQ_SELECTED"; reference: string; requestId: string; quoteId: string }
  | { kind: "COMPLETED"; reference: string; receiptId: string }
  | { kind: "FAILED"; reference: string; message: string };

/** Deterministic local reference so a preview record is traceable without a chain write. */
export function previewReference(marketId: string, lots: number, price: number): string {
  const digest = `${marketId}:${lots}:${price}`
    .split("")
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);
  return `PRV-${digest.toString(16).toUpperCase().padStart(8, "0").slice(0, 8)}`;
}

export interface RecoveryProfile {
  reconcileWindow: string;
  unknownPath: string;
  fallback: string;
}

/** Recovery boundary implied by the settlement guarantee of the selected route. */
export const RECOVERY_COPY: Record<Guarantee, RecoveryProfile> = {
  PACKAGE_ATOMIC: {
    reconcileWindow: "12 blocks, about 24s",
    unknownPath:
      "If inclusion is not observed inside the window the order moves to submission unknown and the authoritative protocol state is re-read before any resubmission.",
    fallback:
      "A package that never matched leaves no leg behind, so recovery is a cancel and re-quote at the prevailing package price.",
  },
  LEG_SEQUENCED: {
    reconcileWindow: "24 blocks, about 48s",
    unknownPath:
      "Each leg is reconciled separately. A confirmed leg is never assumed from a broadcast, only from observed inclusion.",
    fallback:
      "A partially printed package is unwound leg by leg at the prevailing component price, so recovery can realise the intermediate exposure shown above.",
  },
  SOLVER_BONDED: {
    reconcileWindow: "12 blocks, about 24s",
    unknownPath:
      "The accepted quote stays reserved for the reconcile window. An unobserved submission releases the reservation instead of resubmitting.",
    fallback:
      "The solver bond covers a failed sequencing attempt, so recovery claims against the bond rather than against your collateral.",
  },
};
