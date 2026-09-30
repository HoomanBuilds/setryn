import type { GatewaySnapshot } from "@/lib/internal-gateway/types";
import {
  bestReferencePrice,
  buildPreview,
  executableAction,
  protectedPrice,
  routePrice,
  type EconomicsPreview,
  type ExecutableAction,
  type Intent,
  type PackageSide,
  type TicketState,
  type TimeInForce,
} from "@/lib/terminal/economics";
import type { HandoffContext } from "@/lib/terminal/handoff";
import { DEFAULT_MARKET_ID, MARKETS } from "@/lib/terminal/markets";
import type { PackageMarket, RouteQuote } from "@/lib/terminal/types";
import type { ExecutionPosition } from "@/lib/internal-gateway/types";

/**
 * RFQ builder state and its derivation into the exact ticket the terminal signs.
 * The builder never invents order fields: it produces a TicketState and runs
 * the terminal's own `buildPreview`, so the authorization it requests is the
 * one the terminal's private RFQ path would request for the same inputs.
 */

export const SOLVER_ROUTE_ID = "SOLVER_RFQ";

/** The local runtime authorizes whole lots from one to ten per order. */
export const DEVNET_MAX_LOTS = 10;

/** The authorization deadline the gateway signs for GTC and FOK orders. */
export const AUTHORIZATION_LIFETIME_SECONDS = 240;

export type LimitMode = "TRACK" | "FIXED";
export type FillPolicy = "ALL_OR_NONE" | "PARTIAL";
export type Invitation = "QUALIFIED_SET" | "DIRECTED";
export type Disclosure = "ANONYMOUS" | "NAMED";

export const WINDOW_OPTIONS = [60, 120, 180, 240] as const;

export interface BuilderDraft {
  marketId: string;
  intent: Intent;
  side: PackageSide;
  lots: number;
  limitMode: LimitMode;
  slippageBps: number;
  fixedLimit: string;
  fillPolicy: FillPolicy;
  windowSeconds: number;
  invitation: Invitation;
  directed: string[];
  disclosure: Disclosure;
  closePositionId: string | null;
}

export function initialDraft(handoff: HandoffContext, marketParam: string | null, limitParam: string | null): BuilderDraft {
  const market = MARKETS.find((candidate) => candidate.id === marketParam) ?? MARKETS.find((candidate) => candidate.id === DEFAULT_MARKET_ID)!;
  const fixed = limitParam !== null && /^\d+(\.\d+)?$/.test(limitParam) ? limitParam : null;
  const exit = handoff.intent === "EXIT";
  return {
    marketId: market.id,
    intent: handoff.intent,
    side: handoff.direction ?? "LONG",
    lots: handoff.lots !== null ? Math.max(1, Math.round(handoff.lots)) : 5,
    limitMode: fixed ? "FIXED" : "TRACK",
    slippageBps: 50,
    fixedLimit: fixed ?? "",
    fillPolicy: exit ? "ALL_OR_NONE" : "PARTIAL",
    windowSeconds: AUTHORIZATION_LIFETIME_SECONDS,
    invitation: "QUALIFIED_SET",
    directed: [],
    disclosure: "ANONYMOUS",
    closePositionId: exit ? handoff.lifecycleId : null,
  };
}

export interface DerivedOrder {
  market: PackageMarket;
  route: RouteQuote | null;
  action: ExecutableAction;
  packageSide: PackageSide;
  closePosition: ExecutionPosition | null;
  tif: TimeInForce;
  ticket: TicketState;
  preview: EconomicsPreview;
  limit: number;
  expectedPrice: number;
}

export function timeInForce(draft: BuilderDraft): TimeInForce {
  if (draft.intent === "EXIT" || draft.fillPolicy === "ALL_OR_NONE") return "FOK";
  return draft.windowSeconds < AUTHORIZATION_LIFETIME_SECONDS ? "GTD" : "GTC";
}

export function deriveOrder(draft: BuilderDraft, market: PackageMarket, positions: ExecutionPosition[], nowMs: number): DerivedOrder {
  const route = market.routes.find((candidate) => candidate.id === SOLVER_ROUTE_ID) ?? null;
  const closePosition =
    draft.intent === "EXIT" ? (positions.find((position) => position.id === draft.closePositionId && position.marketId === market.id) ?? null) : null;
  const packageSide: PackageSide = closePosition ? closePosition.side : draft.side;
  const action = executableAction(draft.intent, packageSide);
  const expectedPrice = route ? routePrice(route, action) : bestReferencePrice(market, action);
  const tracked = protectedPrice(expectedPrice, action, draft.slippageBps, market);
  const fixed = Number.parseFloat(draft.fixedLimit);
  const limit = draft.limitMode === "TRACK" ? tracked : Number.isFinite(fixed) ? fixed : 0;
  const tif = timeInForce(draft);
  const ticket: TicketState = {
    intent: draft.intent,
    side: packageSide,
    orderType: tif === "GTD" || draft.limitMode === "FIXED" ? "LIMIT" : "MARKETABLE_LIMIT",
    lotsInput: String(draft.lots),
    limitInput: limit > 0 ? limit.toFixed(market.priceDecimals) : "",
    tif,
    expiresAt: tif === "GTD" ? new Date(nowMs + draft.windowSeconds * 1000).toISOString() : null,
    privateRfq: true,
    routeId: route?.id ?? null,
    closePositionId: draft.intent === "EXIT" ? draft.closePositionId : null,
  };
  const preview = buildPreview(market, ticket, route, closePosition);
  return { market, route, action, packageSide, closePosition, tif, ticket, preview, limit, expectedPrice };
}

/* ------------------------------------------------------------------ */
/* Pre-flight                                                          */
/* ------------------------------------------------------------------ */

export type CheckState = "pass" | "warn" | "block" | "pending";

export type CheckFix =
  | { kind: "CONNECT" }
  | { kind: "MARKET"; marketId: string; label: string }
  | { kind: "LOTS"; lots: number; label: string }
  | { kind: "INVITATION" }
  | { kind: "DISCLOSURE" }
  | { kind: "PARTIAL" }
  | { kind: "LINK"; href: string; label: string };

export interface PreflightCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  fix?: CheckFix;
}

export function preflight(
  draft: BuilderDraft,
  order: DerivedOrder,
  snapshot: GatewaySnapshot,
): PreflightCheck[] {
  const { market, route, preview } = order;
  const checks: PreflightCheck[] = [];
  const wallet = snapshot.wallet.status;
  const onchain = snapshot.onchainMarkets[market.id] !== undefined;
  // A market outside the runtime can switch to the primary onchain market, once the runtime lists it.
  const onchainMarket =
    MARKETS.find(
      (candidate) =>
        candidate.id === snapshot.publicBookMarketId && snapshot.onchainMarkets[candidate.id] !== undefined,
    ) ?? null;

  checks.push(
    wallet === "CONNECTED"
      ? { id: "wallet", label: "Wallet connected", state: "pass", detail: `Signing as the taker on ${snapshot.environment.label}.` }
      : wallet === "WRONG_NETWORK"
        ? { id: "wallet", label: "Wrong network", state: "block", detail: "Switch the wallet to the Setryn local devnet.", fix: { kind: "CONNECT" } }
        : {
            id: "wallet",
            label: "Wallet not connected",
            state: "block",
            detail: "The order authorization and the request are signed by the taker wallet.",
            fix: { kind: "CONNECT" },
          },
  );

  checks.push(
    onchain
      ? { id: "environment", label: "Market activated onchain", state: "pass", detail: `${market.code} settles on ${snapshot.environment.label}.` }
      : {
          id: "environment",
          label: "Preview market",
          state: "block",
          detail: onchainMarket
            ? `${market.code} is quoted from the preview feed but not activated in this environment. ${onchainMarket.code} accepts requests.`
            : `${market.code} is quoted from the preview feed but not activated in this environment.`,
          fix: onchainMarket ? { kind: "MARKET", marketId: onchainMarket.id, label: `Switch to ${onchainMarket.code}` } : undefined,
        },
  );

  checks.push(
    market.qualification === "QUALIFIED"
      ? { id: "qualification", label: "Market qualified", state: "pass", detail: market.qualificationNote }
      : market.qualification === "CONDITIONAL"
        ? { id: "qualification", label: "Conditional qualification", state: "warn", detail: market.qualificationNote }
        : { id: "qualification", label: "Qualification suspended", state: "block", detail: market.qualificationNote },
  );

  checks.push(
    route
      ? {
          id: "route",
          label: "Solver firm route available",
          state: "pass",
          detail: `${route.availableLots} lots of bonded solver capacity on screen. ${route.etaLabel}.`,
        }
      : {
          id: "route",
          label: "No solver route",
          state: "block",
          detail: "This market has no solver firm liquidity, so a private RFQ has no one to route to.",
        },
  );

  const maxLots = snapshot.onchainMarkets[market.id]?.maxOrderLots ?? DEVNET_MAX_LOTS;
  const wholeLots = Number.isInteger(draft.lots) && draft.lots >= 1;
  if (!wholeLots) {
    checks.push({ id: "size", label: "Size", state: "block", detail: "Enter a whole number of lots." });
  } else if (onchain && draft.lots > maxLots) {
    checks.push({
      id: "size",
      label: "Size above runtime limit",
      state: "block",
      detail: `The local runtime authorizes 1 to ${maxLots} whole lots per order.`,
      fix: { kind: "LOTS", lots: maxLots, label: `Set ${maxLots} lots` },
    });
  } else {
    checks.push({
      id: "size",
      label: "Size within limits",
      state: "pass",
      detail: `${draft.lots} lots, ${Math.round(preview.notional).toLocaleString("en-US")} USDC notional.`,
    });
  }

  if (preview.blockers.length > 0) {
    checks.push({ id: "order", label: "Order terms", state: "block", detail: preview.blockers.join(" ") });
  } else if (!preview.marketable) {
    checks.push({
      id: "order",
      label: "Limit inside the expected quote",
      state: "warn",
      detail: "Your limit is better than the solver price on screen. Makers may decline to quote inside it.",
    });
  } else {
    checks.push({
      id: "order",
      label: "Limit crosses the expected quote",
      state: "pass",
      detail: "The limit leaves room for the solver price on screen, so firm quotes can fill.",
    });
  }

  if (draft.intent === "EXIT" && !order.closePosition) {
    checks.push({
      id: "position",
      label: "No position selected",
      state: "block",
      detail: "An exit closes one active position in this market. Select it above.",
    });
  }

  if (wallet !== "CONNECTED") {
    checks.push({ id: "collateral", label: "Collateral", state: "pending", detail: "Checked against your account once the wallet connects." });
  } else {
    const required = (draft.intent === "EXIT" ? 0 : preview.totalCollateral) + preview.totalFees;
    const available = snapshot.account.available;
    checks.push(
      available >= required
        ? {
            id: "collateral",
            label: "Collateral covers the request",
            state: "pass",
            detail: `${Math.round(required).toLocaleString("en-US")} USDC bound of ${Math.round(available).toLocaleString("en-US")} available.`,
          }
        : {
            id: "collateral",
            label: "Insufficient collateral",
            state: "block",
            detail: `${Math.round(required).toLocaleString("en-US")} USDC needed, ${Math.round(available).toLocaleString("en-US")} available.`,
            fix: { kind: "LINK", href: "/portfolio/collateral", label: "Deposit collateral" },
          },
    );
  }

  checks.push(
    draft.invitation === "QUALIFIED_SET"
      ? {
          id: "invitation",
          label: "Qualified maker set",
          state: "pass",
          detail: "The request commits the runtime's eligible maker set. Only qualified makers can answer.",
        }
      : {
          id: "invitation",
          label: "Directed set not registered",
          state: "block",
          detail:
            "A chosen maker set needs its own eligible-maker commitment, and this runtime registers only the qualified set. Sending it would reach every qualified maker, not just your choice.",
          fix: { kind: "INVITATION" },
        },
  );

  checks.push(
    draft.disclosure === "ANONYMOUS"
      ? { id: "disclosure", label: "Anonymous to makers", state: "pass", detail: "Blind qualified policy: makers quote without your identity." }
      : {
          id: "disclosure",
          label: "Named disclosure not registered",
          state: "block",
          detail: "The runtime registers only the blind qualified disclosure policy, so a named request cannot be committed.",
          fix: { kind: "DISCLOSURE" },
        },
  );

  return checks;
}

export function blockingChecks(checks: PreflightCheck[]): PreflightCheck[] {
  return checks.filter((check) => check.state === "block");
}
