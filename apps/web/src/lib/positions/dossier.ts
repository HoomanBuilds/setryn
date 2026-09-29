import type {
  ExecutionReceipt,
  GatewayExecution,
  GatewaySnapshot,
  RestingPackageOrder,
  RfqRequest,
} from "@/lib/internal-gateway/types";
import type { LifecycleStrategy } from "@/lib/lifecycle/types";
import type { Guarantee, PackageMarket, PositionSide } from "@/lib/terminal/types";

/**
 * One position as every lifecycle surface reads it. Account positions come
 * from the gateway snapshot (chain records). Reference positions are the
 * static lifecycle preview records, which keep their own origin so no page can
 * present them as account evidence.
 */

export type PositionOrigin = "ACCOUNT" | "REFERENCE";

export type PositionPhase = "ACTIVE" | "CLOSED";

export type LinkedFillKind = "OPEN" | "REDUCE" | "CLOSE";

export interface LinkedFill {
  id: string;
  kind: LinkedFillKind;
  receipt: ExecutionReceipt;
  execution: GatewayExecution | null;
  /** How the fill was tied to the position: by execution record, or by matching terms. */
  matchedBy: "EXECUTION" | "TERMS";
}

export interface PositionDossier {
  id: string;
  origin: PositionOrigin;
  phase: PositionPhase;
  marketId: string;
  label: string;
  side: PositionSide;
  /** Lots still open. Zero once the position is closed. */
  lots: number;
  /** Lots at opening, from the opening fill when one is linked. */
  openedLots: number;
  entryPrice: number;
  collateral: number;
  /** Fees on linked fills (account) or none for a reference record. */
  fees: number;
  openedAt: string | null;
  closedAt: string | null;
  guarantee: Guarantee;
  environmentLabel: string;
  evidenceLabel: string;
  sourceLabel: string;
  reference: LifecycleStrategy | null;
  fills: LinkedFill[];
  orders: RestingPackageOrder[];
  rfqs: RfqRequest[];
  realizedPnl: number | null;
  collateralReleased: number | null;
}

export type PositionResolution =
  | { status: "FOUND"; dossier: PositionDossier }
  | { status: "CONNECT" }
  | { status: "CONNECTING" }
  | { status: "NOT_FOUND" };

/** Canonical account position identifier on the Setryn chain runtime. */
export function isChainPositionId(id: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(id);
}

/** Route-safe identifier: the same character class the terminal handoff accepts. */
export function isRouteSafeId(id: string): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(id);
}

function sameId(left: string | null | undefined, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

/**
 * The opening fill of a position is the earliest linked execution that either
 * opened it, or that a chain reconstruction reports as the fill of a
 * since-closed position (outcome CLOSED with no exit economics attached).
 * Later fills are exits: a reduction or the close.
 */
function fillKind(execution: GatewayExecution, index: number): LinkedFillKind {
  const { outcome, receipt } = execution.result;
  if (outcome === "OPENED") return "OPEN";
  const exitEconomics = receipt.realizedPnlUsd !== undefined || receipt.collateralReleasedUsd !== undefined;
  if (index === 0 && outcome === "CLOSED" && !exitEconomics) return "OPEN";
  return outcome === "REDUCED" ? "REDUCE" : "CLOSE";
}

function linkedExecutions(snapshot: GatewaySnapshot, positionId: string): GatewayExecution[] {
  return snapshot.executions
    .filter(
      (execution) =>
        sameId(execution.result.position?.id, positionId) || sameId(execution.result.closedPositionId, positionId),
    )
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function accountFills(
  snapshot: GatewaySnapshot,
  positionId: string,
  terms: { marketId: string; lots: number; entryPrice: number } | null,
): LinkedFill[] {
  const executions = linkedExecutions(snapshot, positionId);
  const fills: LinkedFill[] = executions.map((execution, index) => ({
    id: execution.result.receipt.id,
    kind: fillKind(execution, index),
    receipt: execution.result.receipt,
    execution,
    matchedBy: "EXECUTION",
  }));
  if (fills.length > 0 || !terms) return fills;
  /* The portfolio reads the opening receipt by terms when no execution record links it, so this does too. */
  const byTerms = snapshot.receipts.find(
    (receipt) =>
      receipt.marketId === terms.marketId && receipt.lots === terms.lots && receipt.price === terms.entryPrice,
  );
  return byTerms ? [{ id: byTerms.id, kind: "OPEN", receipt: byTerms, execution: null, matchedBy: "TERMS" }] : [];
}

function sumDefined(values: Array<number | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) return null;
  return Math.round(present.reduce((total, value) => total + value, 0) * 100) / 100;
}

function linkedOrders(snapshot: GatewaySnapshot, positionId: string): RestingPackageOrder[] {
  return snapshot.restingOrders
    .filter((order) => sameId(order.closePositionId, positionId))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function linkedRfqs(snapshot: GatewaySnapshot, positionId: string): RfqRequest[] {
  return snapshot.rfqRequests
    .filter((request) => sameId(request.authorization.intent.closePositionId, positionId))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function guaranteeFor(market: PackageMarket | undefined): Guarantee {
  return market?.routes[0]?.guarantee ?? "PACKAGE_ATOMIC";
}

function accountSource(snapshot: GatewaySnapshot): string {
  return `${snapshot.environment.label} account state`;
}

function marketLabel(market: PackageMarket | undefined, fallback: string): string {
  return market ? `${market.name} ${market.tenorLabel}` : fallback;
}

/** Active account position from the snapshot. */
function activeDossier(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  positionId: string,
): PositionDossier | null {
  const position = snapshot.positions.find((candidate) => sameId(candidate.id, positionId));
  if (!position) return null;
  const market = markets.find((candidate) => candidate.id === position.marketId);
  const fills = accountFills(snapshot, position.id, {
    marketId: position.marketId,
    lots: position.lots,
    entryPrice: position.entryPrice,
  });
  const opening = fills.find((fill) => fill.kind === "OPEN") ?? fills[0] ?? null;
  const exits = fills.filter((fill) => fill.kind !== "OPEN");
  return {
    id: position.id,
    origin: "ACCOUNT",
    phase: "ACTIVE",
    marketId: position.marketId,
    label: marketLabel(market, position.marketId),
    side: position.side,
    lots: position.lots,
    openedLots: opening?.receipt.filledLots ?? opening?.receipt.lots ?? position.lots,
    entryPrice: position.entryPrice,
    collateral: position.collateral,
    fees: Math.round(fills.reduce((total, fill) => total + (fill.receipt.fees ?? 0), 0) * 100) / 100,
    openedAt: opening?.receipt.createdAt ?? position.createdAt,
    closedAt: null,
    guarantee: guaranteeFor(market),
    environmentLabel: snapshot.environment.label,
    evidenceLabel: snapshot.environment.evidence,
    sourceLabel: accountSource(snapshot),
    reference: null,
    fills,
    orders: linkedOrders(snapshot, position.id),
    rfqs: linkedRfqs(snapshot, position.id),
    realizedPnl: sumDefined(exits.map((fill) => fill.receipt.realizedPnlUsd)),
    collateralReleased: sumDefined(exits.map((fill) => fill.receipt.collateralReleasedUsd)),
  };
}

/** A position the account held and has since closed, reconstructed from its linked fills. */
function closedDossier(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  positionId: string,
): PositionDossier | null {
  const executions = linkedExecutions(snapshot, positionId);
  if (executions.length === 0) return null;
  const fills = accountFills(snapshot, positionId, null);
  const opening = fills.find((fill) => fill.kind === "OPEN") ?? null;
  const exits = fills.filter((fill) => fill.kind !== "OPEN");
  const lastExit = exits[exits.length - 1] ?? null;
  const reference = (opening ?? fills[0]).receipt;
  const market = markets.find((candidate) => candidate.id === reference.marketId);
  return {
    id: positionId,
    origin: "ACCOUNT",
    phase: "CLOSED",
    marketId: reference.marketId,
    label: marketLabel(market, reference.marketId),
    side: reference.packageSide,
    lots: 0,
    openedLots: reference.filledLots ?? reference.lots,
    entryPrice: reference.price,
    collateral: 0,
    fees: Math.round(fills.reduce((total, fill) => total + (fill.receipt.fees ?? 0), 0) * 100) / 100,
    openedAt: opening?.receipt.createdAt ?? null,
    closedAt: lastExit?.receipt.createdAt ?? null,
    guarantee: guaranteeFor(market),
    environmentLabel: snapshot.environment.label,
    evidenceLabel: snapshot.environment.evidence,
    sourceLabel: accountSource(snapshot),
    reference: null,
    fills,
    orders: linkedOrders(snapshot, positionId),
    rfqs: linkedRfqs(snapshot, positionId),
    realizedPnl: sumDefined(exits.map((fill) => fill.receipt.realizedPnlUsd)),
    collateralReleased: sumDefined(exits.map((fill) => fill.receipt.collateralReleasedUsd)),
  };
}

export function referenceDossier(strategy: LifecycleStrategy): PositionDossier {
  return {
    id: strategy.id,
    origin: "REFERENCE",
    phase: "ACTIVE",
    marketId: strategy.market.id,
    label: strategy.label,
    side: strategy.side,
    lots: strategy.lots,
    openedLots: strategy.lots,
    entryPrice: strategy.entryPrice,
    collateral: strategy.collateral,
    fees: 0,
    openedAt: strategy.createdAt,
    closedAt: null,
    guarantee: strategy.guarantee,
    environmentLabel: strategy.environmentLabel,
    evidenceLabel: strategy.evidenceLabel,
    sourceLabel: "Static lifecycle preview record",
    reference: strategy,
    fills: [],
    orders: [],
    rfqs: [],
    realizedPnl: null,
    collateralReleased: null,
  };
}

/**
 * Resolves a route id against the account first, then the static references.
 * A disconnected wallet cannot rule out an account position, so a
 * chain-shaped id asks for a connection instead of reporting not found.
 */
export function resolvePosition(
  id: string,
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  references: readonly LifecycleStrategy[],
): PositionResolution {
  const reference = references.find((strategy) => strategy.id === id);
  if (reference) return { status: "FOUND", dossier: referenceDossier(reference) };

  const status = snapshot.wallet.status;
  if (status === "CONNECTED") {
    const active = activeDossier(snapshot, markets, id);
    if (active) return { status: "FOUND", dossier: active };
    const closed = closedDossier(snapshot, markets, id);
    if (closed) return { status: "FOUND", dossier: closed };
    return { status: "NOT_FOUND" };
  }
  if (!isChainPositionId(id)) return { status: "NOT_FOUND" };
  if (status === "CONNECTING") return { status: "CONNECTING" };
  return { status: "CONNECT" };
}

/** Every position the settlement center tracks: account positions first, then references. */
export function trackedDossiers(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  references: readonly LifecycleStrategy[],
): PositionDossier[] {
  const account =
    snapshot.wallet.status === "CONNECTED"
      ? snapshot.positions
          .map((position) => activeDossier(snapshot, markets, position.id))
          .filter((dossier): dossier is PositionDossier => dossier !== null)
      : [];
  return [...account, ...references.map(referenceDossier)];
}

export function positionHref(id: string): string {
  return `/positions/${encodeURIComponent(id)}`;
}

export function receiptHref(id: string): string {
  return `/receipts/${encodeURIComponent(id)}`;
}
