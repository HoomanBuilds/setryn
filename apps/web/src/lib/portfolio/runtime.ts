import type { ExecutionPosition, GatewaySnapshot, OnchainPositionLifecycle } from "@/lib/internal-gateway/types";
import type { MarketDataSnapshot } from "@/lib/market-data/types";
import { daysToExpiryAt, formatUtcSession, seriesSchedule } from "@/lib/settlements/calendar";
import { platformNow } from "@/lib/terminal/clock";
import { packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket, PositionState, StrategyRecord } from "@/lib/terminal/types";
import { deltaUnits, direction, forwardPnl, liveIndex, markOf, rangeTerms } from "./forward";
import {
  domainOf,
  expiryLadder,
  exposureByDomain,
  exposureByUnderlying,
  groupPositions,
  scenarioResults,
} from "./model";
import type {
  AccountSummary,
  CollateralLine,
  ExposureGroup,
  GroupBy,
  LadderRung,
  PnlBreakdown,
  Position,
  PositionGroup,
  ScenarioResult,
} from "./types";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: number[]): number {
  return round(values.reduce((total, value) => total + value, 0));
}

function emptyPnl(): PnlBreakdown {
  return { price: 0, carry: 0, funding: 0, fees: 0, residual: 0, total: 0 };
}

function resolveRuntimeMarket(markets: readonly PackageMarket[], marketId: string): PackageMarket {
  const market = markets.find((candidate) => candidate.id === marketId);
  if (!market) {
    throw new Error(`Unknown runtime market: ${marketId}`);
  }
  return market;
}

function runtimeExitHref(baseHref: string, positionId: string, lots: number): string {
  const separator = baseHref.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    source: "portfolio",
    sourceLabel: "Portfolio",
    lifecycle: positionId,
    intent: "exit",
    lots: String(lots),
  });
  return `${baseHref}${separator}${params.toString()}`;
}

/** The next dated event of a held position, from its onchain lifecycle when read, else its series schedule. */
function nextEvent(market: PackageMarket, lifecycle: OnchainPositionLifecycle | null, nowMs: number): string {
  const schedule = seriesSchedule(market, lifecycle?.schedule);
  if (lifecycle) {
    if (lifecycle.phase === "FIXED_AWAITING_ELECTION") return `Fixing accepted. Election closes ${formatUtcSession(schedule.electionClosesMs)}.`;
    if (lifecycle.phase === "CLAIM_AVAILABLE") return "A settlement claim is open for this account.";
    if (lifecycle.phase === "EXERCISED") return `Exercised. Settlement due by ${formatUtcSession(schedule.settlementDeadlineMs)}.`;
    if (lifecycle.phase === "AWAITING_FIXING") return `Awaiting the final fixing. Evidence due ${formatUtcSession(schedule.evidenceDeadlineMs)}.`;
    if (lifecycle.phase === "SETTLED" || lifecycle.phase === "LAPSED") return "Terminal settlement recorded onchain.";
  }
  if (nowMs < schedule.lastTradingMs) return `Last trade ${formatUtcSession(schedule.lastTradingMs)}; fixing window opens ${formatUtcSession(schedule.windowOpensMs)}.`;
  if (nowMs < schedule.windowOpensMs) return `Trading closed. Fixing window opens ${formatUtcSession(schedule.windowOpensMs)}.`;
  if (nowMs < schedule.fixingMs) return `Fixing window open until ${formatUtcSession(schedule.fixingMs)}.`;
  return `Fixing printed ${formatUtcSession(schedule.fixingMs)}; settlement due by ${formatUtcSession(schedule.settlementDeadlineMs)}.`;
}

function positionState(market: PackageMarket, lifecycle: OnchainPositionLifecycle | null, nowMs: number): PositionState {
  if (lifecycle && lifecycle.phase !== "LIVE") return "FIXING_WINDOW";
  return nowMs >= seriesSchedule(market, lifecycle?.schedule).windowOpensMs ? "FIXING_WINDOW" : "ACTIVE";
}

function runtimeRecord(position: ExecutionPosition, fees: number, state: PositionState, event: string): StrategyRecord {
  return {
    id: position.id,
    marketId: position.marketId,
    side: position.side,
    lots: position.lots,
    entryPrice: position.entryPrice,
    initialMargin: position.collateral,
    maintenanceMargin: position.collateral,
    attribution: { carry: 0, funding: 0, fees: -fees, residual: 0 },
    nextEvent: event,
    state,
  };
}

function runtimePosition(
  execution: ExecutionPosition,
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  live: ReturnType<typeof liveIndex>,
  nowMs: number,
): Position {
  const market = resolveRuntimeMarket(markets, execution.marketId);
  const openingReceipt = snapshot.executions.find(
    (candidate) => candidate.result.outcome === "OPENED" && candidate.result.position?.id === execution.id,
  )?.result.receipt;
  const receipt =
    openingReceipt ??
    snapshot.executions.find((candidate) => candidate.result.position?.id === execution.id)?.result.receipt ??
    snapshot.receipts.find(
      (candidate) =>
        candidate.marketId === execution.marketId &&
        candidate.lots === execution.lots &&
        candidate.price === execution.entryPrice,
    );
  const fee = receipt?.fees ?? 0;
  const terms = rangeTerms(market);
  const mark = markOf(live.get(market.id));
  const sign = direction(execution.side);
  const price = mark.price === null ? 0 : round(forwardPnl(execution.side, execution.lots, execution.entryPrice, mark.price, terms));
  const pnl: PnlBreakdown = { ...emptyPnl(), price, fees: -fee, total: round(price - fee) };
  const level = mark.price ?? execution.entryPrice;
  const units = deltaUnits(execution.side, execution.lots, terms, mark.price);
  const gross = round(execution.lots * terms.lotSize * Math.abs(level));
  const equity = round(execution.collateral + price);
  const lifecycle = snapshot.lifecycles[execution.id.toLowerCase()] ?? null;
  const state = positionState(market, lifecycle, nowMs);
  const event = nextEvent(market, lifecycle, nowMs);
  const href = tradeHref(market);

  return {
    id: execution.id,
    record: runtimeRecord(execution, fee, state, event),
    market,
    label: packageLabel(market),
    side: execution.side,
    state,
    lots: execution.lots,
    signedLots: execution.lots * sign,
    signedUnits: units,
    entryPrice: execution.entryPrice,
    markPrice: mark.price,
    markSource: mark.source,
    signedNotional: round(gross * sign),
    grossNotional: gross,
    collateral: execution.collateral,
    initialMargin: execution.collateral,
    maintenanceMargin: execution.collateral,
    pnl,
    equity,
    atRisk: Math.max(0, equity),
    boundLevel: execution.side === "LONG" ? terms.floor : terms.cap,
    domain: domainOf(market),
    daysToExpiry: daysToExpiryAt(market, nowMs),
    nextEvent: event,
    href,
    exitHref: runtimeExitHref(href, execution.id, execution.lots),
    source: "ONCHAIN_RUNTIME",
    provenance: `${snapshot.environment.label} account state`,
    receiptId: receipt?.id,
  };
}

function runtimePnl(positions: Position[]): PnlBreakdown {
  return {
    price: sum(positions.map((position) => position.pnl.price)),
    carry: sum(positions.map((position) => position.pnl.carry)),
    funding: sum(positions.map((position) => position.pnl.funding)),
    fees: sum(positions.map((position) => position.pnl.fees)),
    residual: sum(positions.map((position) => position.pnl.residual)),
    total: sum(positions.map((position) => position.pnl.total)),
  };
}

export interface RuntimePortfolio {
  account: AccountSummary;
  accountLabel: string;
  runtimePositions: Position[];
  positions: Position[];
  runtimePnl: PnlBreakdown;
  collateralLines: CollateralLine[];
  runtimeGross: number;
  runtimeNet: number;
  /** Positions whose market has no live mark yet; their price PnL reads zero until one arrives. */
  unmarked: number;
  risk: {
    exposuresByDomain: ExposureGroup[];
    exposuresByUnderlying: ExposureGroup[];
    expiryLadder: LadderRung[];
    scenarios: ScenarioResult[];
    binding: ScenarioResult;
  };
}

export interface PortfolioRuntimeOptions {
  /** One market-data snapshot, so every position is marked at the same block. */
  live?: MarketDataSnapshot | null;
  /** Platform clock in milliseconds; defaults to `platformNow()`. */
  nowMs?: number;
}

export function portfolioRuntime(
  snapshot: GatewaySnapshot,
  markets: readonly PackageMarket[],
  options: PortfolioRuntimeOptions = {},
): RuntimePortfolio {
  const nowMs = options.nowMs ?? platformNow();
  const live = liveIndex(options.live);
  const runtimePositions = snapshot.positions
    .map((position) => runtimePosition(position, snapshot, markets, live, nowMs))
    .sort((a, b) => b.grossNotional - a.grossNotional);
  const positions = runtimePositions;
  /* Fully collateralized: what the positions and resting orders lock is the whole bounded liability. */
  const locked = snapshot.account.reserved;
  const pnl = runtimePnl(runtimePositions);
  const baseAccount: AccountSummary = {
    equity: snapshot.account.equity,
    postedValue: snapshot.account.posted,
    eligible: snapshot.account.eligible,
    reserved: snapshot.account.reserved,
    available: snapshot.account.available,
    initialMargin: locked,
    maintenanceMargin: locked,
    healthFactor: locked === 0 ? 0 : (snapshot.account.equity + pnl.price) / locked,
    marginUsage: snapshot.account.eligible === 0 ? 0 : snapshot.account.reserved / snapshot.account.eligible,
    stressHeadroom: 0,
    stressHealthFactor: 0,
    bindingLabel: "No scenario",
  };
  const scenarios = scenarioResults(runtimePositions, baseAccount, pnl.price);
  const binding = scenarios.find((result) => result.binding) ?? scenarios[0];
  const account: AccountSummary = {
    ...baseAccount,
    stressHeadroom: binding.headroom,
    stressHealthFactor: binding.healthFactor,
    bindingLabel: binding.scenario.label,
  };
  const collateralLines: CollateralLine[] = [
    {
      asset: {
        id: "gateway-usdc",
        asset: snapshot.account.collateralAsset,
        value: snapshot.account.posted,
        haircut: 0,
        reserved: snapshot.account.reserved,
        withdrawal: "IMMEDIATE",
        withdrawalNote: "Available collateral withdraws from the onchain vault after wallet confirmation.",
        source: `${snapshot.environment.label} account ${snapshot.account.id}`,
      },
      eligible: snapshot.account.eligible,
      available: snapshot.account.available,
      share: 1,
    },
  ];

  return {
    account,
    accountLabel: `${snapshot.account.label} / ${snapshot.account.riskDomain}`,
    runtimePositions,
    positions,
    runtimePnl: pnl,
    collateralLines,
    runtimeGross: sum(runtimePositions.map((position) => position.grossNotional)),
    runtimeNet: sum(runtimePositions.map((position) => position.signedNotional)),
    unmarked: runtimePositions.filter((position) => position.markPrice === null).length,
    risk: {
      exposuresByDomain: exposureByDomain(runtimePositions),
      exposuresByUnderlying: exposureByUnderlying(runtimePositions),
      expiryLadder: expiryLadder(runtimePositions, snapshot.account.available),
      scenarios,
      binding,
    },
  };
}

export function positionOrigin(position: Position): string {
  return position.source === "ONCHAIN_RUNTIME" ? "Onchain account" : "Account";
}

export function runtimeObservationLabel(snapshot: GatewaySnapshot): string {
  return `${snapshot.environment.label} / onchain account state`;
}

export function groupPortfolioPositions(positions: Position[], by: GroupBy): PositionGroup[] {
  return groupPositions(positions, by);
}
