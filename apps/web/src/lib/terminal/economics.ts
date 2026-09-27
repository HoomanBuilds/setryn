import type { Guarantee, PackageMarket, RouteQuote } from "./types";

export type Intent = "ENTER" | "EXIT";
export type OrderType = "MARKETABLE_LIMIT" | "LIMIT";
export type TimeInForce = "GTC" | "IOC" | "FOK";

export interface TicketState {
  intent: Intent;
  orderType: OrderType;
  lotsInput: string;
  limitInput: string;
  tif: TimeInForce;
  privateRfq: boolean;
  routeId: string | null;
  closePositionId: string | null;
}

export interface ClosePositionRef {
  lots: number;
}

export interface EconomicsPreview {
  lots: number;
  limitPrice: number;
  notional: number;
  routePrice: number;
  effectivePrice: number;
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

export function routePrice(route: RouteQuote, intent: Intent): number {
  return intent === "ENTER" ? route.enterPrice : route.exitPrice;
}

export function bestReferencePrice(market: PackageMarket, intent: Intent): number {
  return intent === "ENTER" ? market.bestAsk : market.bestBid;
}

/**
 * A buyer improves by bidding at or above the route offer; a seller improves by
 * offering at or below the route bid. Both collapse to the same crossing test.
 */
export function limitCrosses(limitPrice: number, price: number, intent: Intent): boolean {
  return intent === "ENTER" ? limitPrice >= price : limitPrice <= price;
}

export function buildPreview(
  market: PackageMarket,
  state: TicketState,
  route: RouteQuote | null,
  closePosition?: ClosePositionRef | null,
): EconomicsPreview {
  const lots = Math.max(0, Number.parseFloat(state.lotsInput) || 0);
  const limitPrice = Number.parseFloat(state.limitInput) || 0;
  const notional = lots * market.notionalPerLot;

  const price = route ? routePrice(route, state.intent) : bestReferencePrice(market, state.intent);
  const marketable = limitCrosses(limitPrice, price, state.intent);
  const rests = state.orderType === "LIMIT" && !marketable && state.tif === "GTC";
  const effectivePrice = state.orderType === "LIMIT" && !marketable ? limitPrice : price;

  const protocolFeeBps = route?.protocolFeeBps ?? 2.5;
  const counterpartyFeeBps = route?.counterpartyFeeBps ?? 0;
  const collateralMultiple = route?.collateralMultiple ?? 1;
  const exposureRate = route?.intermediateExposureRate ?? 0;

  const protocolFee = (notional * protocolFeeBps) / 10_000;
  const counterpartyFee = (notional * counterpartyFeeBps) / 10_000;

  const guarantee = route ? GUARANTEE_COPY[route.guarantee] : null;
  const isExit = state.intent === "EXIT";

  const blockers: string[] = [];
  if (lots <= 0) blockers.push("Enter a package quantity above zero.");
  if (limitPrice === 0) blockers.push("Enter a package-price limit.");
  if (isExit) {
    if (!closePosition || !(closePosition.lots > 0)) {
      blockers.push("Exit requires exactly one active runtime package. Select a package to close.");
    } else if (lots > closePosition.lots) {
      blockers.push(
        `Quantity exceeds the selected package lots (${closePosition.lots} lots). Reduce quantity to close within the active package.`,
      );
    }
  }
  if (route && lots > route.availableLots) {
    blockers.push(
      `Route capacity is ${route.availableLots} lots. Reduce quantity or pick another route.`,
    );
  }
  if (state.orderType === "MARKETABLE_LIMIT" && route && !marketable) {
    blockers.push(
      state.intent === "ENTER"
        ? "A marketable limit must be at or above the route offer."
        : "A marketable limit must be at or below the route bid.",
    );
  }
  if (state.orderType === "LIMIT" && !marketable && (state.tif === "IOC" || state.tif === "FOK")) {
    blockers.push(
      "A non-marketable limit with IOC or FOK cannot rest. Use GTC to rest the order or adjust the limit to cross.",
    );
  }
  if (state.tif === "FOK" && route && lots > route.availableLots) {
    blockers.push("Fill or kill cannot clear more than the reserved route capacity.");
  }
  if (market.qualification === "SUSPENDED") {
    blockers.push("Market qualification is suspended. Entry is closed until the benchmark requalifies.");
  }

  return {
    lots,
    limitPrice,
    notional,
    routePrice: price,
    effectivePrice,
    totalCollateral: isExit ? 0 : lots * market.collateralPerLot * collateralMultiple,
    protocolFee,
    counterpartyFee,
    counterpartyFeeLabel: route?.counterpartyFeeLabel ?? "Counterparty fee",
    totalFees: protocolFee + counterpartyFee,
    maxIntermediateExposure: notional * exposureRate,
    terminalResidual:
      lots * market.residualPerLot * (state.intent === "ENTER" ? 1 : -1),
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
