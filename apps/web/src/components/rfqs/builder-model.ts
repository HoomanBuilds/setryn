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

/** The most lots one order may carry: the onchain market's limit, else the listing's. Null when neither is known. */
export function maxLotsFor(market: PackageMarket, snapshot: GatewaySnapshot): number | null {
  return snapshot.onchainMarkets[market.id]?.maxOrderLots ?? market.maxOrderLots ?? null;
}

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
  /** The price the request is anchored to: the book touch for the action, else the live mark; NaN without either. */
  expectedPrice: number;
  expectedSource: "BOOK" | "MARK" | "NONE";
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
  /* A private RFQ has no price until makers quote, so the request anchors on the book touch, else the live mark. */
  const quoted = route ? routePrice(route, action) : Number.NaN;
  const touch = bestReferencePrice(market, action);
  const expectedSource: DerivedOrder["expectedSource"] =
    Number.isFinite(quoted) || Number.isFinite(touch) ? "BOOK" : Number.isFinite(market.netPrice) ? "MARK" : "NONE";
  const expectedPrice = Number.isFinite(quoted) ? quoted : Number.isFinite(touch) ? touch : market.netPrice;
  const tracked = Number.isFinite(expectedPrice) ? protectedPrice(expectedPrice, action, draft.slippageBps, market) : Number.NaN;
  const fixed = Number.parseFloat(draft.fixedLimit);
  const limit = draft.limitMode === "TRACK" ? (Number.isFinite(tracked) ? tracked : 0) : Number.isFinite(fixed) ? fixed : 0;
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
  return { market, route, action, packageSide, closePosition, tif, ticket, preview, limit, expectedPrice, expectedSource };
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
        ? { id: "wallet", label: "Wrong network", state: "block", detail: "Switch the wallet to the Setryn network.", fix: { kind: "CONNECT" } }
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
          label: "Reference market",
          state: "block",
          detail: onchainMarket
            ? `${market.code} is listed but not open onchain in this deployment. ${onchainMarket.code} accepts requests.`
            : `${market.code} is listed but not open onchain in this deployment.`,
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
          label: "Private RFQ route open",
          state: "pass",
          detail: `Qualified makers answer with firm, reserved capacity. ${route.etaLabel}.`,
        }
      : {
          id: "route",
          label: "No solver route",
          state: "block",
          detail: "This market has no solver firm liquidity, so a private RFQ has no one to route to.",
        },
  );

  const maxLots = maxLotsFor(market, snapshot);
  const wholeLots = Number.isInteger(draft.lots) && draft.lots >= 1;
  if (!wholeLots) {
    checks.push({ id: "size", label: "Size", state: "block", detail: "Enter a whole number of lots." });
  } else if (maxLots !== null && draft.lots > maxLots) {
    checks.push({
      id: "size",
      label: "Size above the market limit",
      state: "block",
      detail: `This market authorizes 1 to ${maxLots} whole lots per order.`,
      fix: { kind: "LOTS", lots: maxLots, label: `Set ${maxLots} lots` },
    });
  } else {
    checks.push({
      id: "size",
      label: "Size within limits",
      state: "pass",
      detail: Number.isFinite(preview.notional)
        ? `${draft.lots} lots, ${Math.round(preview.notional).toLocaleString("en-US")} USDC consideration.`
        : `${draft.lots} lots.`,
    });
  }

  if (preview.blockers.length > 0) {
    checks.push({ id: "order", label: "Order terms", state: "block", detail: preview.blockers.join(" ") });
  } else if (order.expectedSource === "NONE") {
    checks.push({
      id: "order",
      label: "No live price to anchor on",
      state: "warn",
      detail: "The book is empty and the market has no mark yet. Makers quote against your limit alone.",
    });
  } else if (order.action === "BUY" ? order.limit < order.expectedPrice : order.limit > order.expectedPrice) {
    checks.push({
      id: "order",
      label: "Limit inside the live price",
      state: "warn",
      detail: `Your limit is better than the ${order.expectedSource === "BOOK" ? "book touch" : "live mark"}. Makers may decline to quote inside it.`,
    });
  } else {
    checks.push({
      id: "order",
      label: "Limit crosses the live price",
      state: "pass",
      detail: `The limit leaves room around the ${order.expectedSource === "BOOK" ? "book touch" : "live mark"}, so firm quotes can fill.`,
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
    const fees = Number.isFinite(preview.totalFees) ? preview.totalFees : 0;
    const required = (draft.intent === "EXIT" ? 0 : preview.totalCollateral) + fees;
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
          detail: "The request commits the deployment's eligible maker set. Only qualified makers can answer.",
        }
      : {
          id: "invitation",
          label: "Directed set not registered",
          state: "block",
          detail:
            "A chosen maker set needs its own eligible-maker commitment, and this deployment registers only the qualified set. Sending it would reach every qualified maker, not just your choice.",
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
          detail: "The deployment registers only the blind qualified disclosure policy, so a named request cannot be committed.",
          fix: { kind: "DISCLOSURE" },
        },
  );

  return checks;
}

export function blockingChecks(checks: PreflightCheck[]): PreflightCheck[] {
  return checks.filter((check) => check.state === "block");
}
