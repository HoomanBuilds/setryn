import { enumLabel } from "@/lib/terminal/discovery";
import { formatExpiry } from "@/lib/terminal/format";
import { findMarket } from "@/lib/terminal/markets";
import type { PackageMarket, PositionState, StrategyKind, StrategyRecord } from "@/lib/terminal/types";
import { clampToRange, finite, forwardPnl, rangeTerms } from "./forward";
import { SCENARIOS } from "./scenarios";
import type {
  AccountSummary,
  ExposureGroup,
  GroupBy,
  LadderRung,
  Position,
  PositionGroup,
  RiskDomainId,
  ScenarioResult,
  StressScenario,
} from "./types";

/** Exhaustive by strategy kind, so a new package family cannot land domainless. */
const DOMAIN_BY_KIND: Record<StrategyKind, RiskDomainId> = {
  DATED_YIELD_CARRY: "CRYPTO_CARRY",
  FUNDING_CARRY: "CRYPTO_CARRY",
  DATED_BASIS: "CRYPTO_BASIS",
  DELIVERABLE_FORWARD: "MACRO_FORWARD",
};

export function domainOf(market: Pick<PackageMarket, "strategyKind">): RiskDomainId {
  return DOMAIN_BY_KIND[market.strategyKind];
}

export const DOMAIN_LABEL: Record<RiskDomainId, string> = {
  CRYPTO_CARRY: "Crypto carry",
  CRYPTO_BASIS: "Crypto basis",
  MACRO_FORWARD: "Macro forward",
};

export const DOMAIN_ORDER: RiskDomainId[] = ["CRYPTO_CARRY", "CRYPTO_BASIS", "MACRO_FORWARD"];

export const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "STRATEGY", label: "Strategy" },
  { value: "UNDERLYING", label: "Underlying" },
  { value: "EXPIRY", label: "Expiry" },
  { value: "DOMAIN", label: "Risk domain" },
];

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sum(values: number[]): number {
  return round(values.reduce((total, value) => total + value, 0));
}

/**
 * Total profit and loss of one console record against a market's live mark: the price term plus its booked fee and
 * carry components. Without a live mark only the booked components count.
 */
export function strategyPnl(record: StrategyRecord, market: PackageMarket = findMarket(record.marketId)): number {
  const { carry, funding, fees, residual } = record.attribution;
  const booked = carry + funding + fees + residual;
  if (!finite(market.netPrice)) return round(booked);
  return round(forwardPnl(record.side, record.lots, record.entryPrice, market.netPrice, rangeTerms(market)) + booked);
}

/** Price PnL a scenario adds to one position: its forward level moved by the domain shock, clamped into range. */
export function positionScenarioImpact(position: Position, scenario: StressScenario): number {
  if (position.markPrice === null) return 0;
  const terms = rangeTerms(position.market);
  const shocked = clampToRange(position.markPrice * (1 + scenario.moves[position.domain]), terms);
  return round(forwardPnl(position.side, position.lots, position.markPrice, shocked, terms));
}

/** Every scenario against the book, the one leaving the least headroom marked binding. */
export function scenarioResults(positions: readonly Position[], account: Pick<AccountSummary, "equity" | "maintenanceMargin">, openPnl: number): ScenarioResult[] {
  const equity = round(account.equity + openPnl);
  const maintenance = account.maintenanceMargin;
  const evaluated = SCENARIOS.map((scenario) => {
    const impacts = positions.map((position) => ({ label: position.label, impact: positionScenarioImpact(position, scenario) }));
    const impact = sum(impacts.map((entry) => entry.impact));
    const equityAfter = round(equity + impact);
    const worst = impacts.reduce(
      (low, entry) => (entry.impact < low.impact ? entry : low),
      { label: "No position", impact: 0 },
    );
    return {
      scenario,
      impact,
      equityAfter,
      headroom: round(equityAfter - maintenance),
      healthFactor: maintenance === 0 ? 0 : equityAfter / maintenance,
      worstLabel: worst.label,
      worstImpact: worst.impact,
      binding: false,
    };
  });
  const binding = evaluated.reduce((low, result) => (result.headroom < low.headroom ? result : low), evaluated[0]);
  return evaluated
    .map((result) => ({ ...result, binding: result.scenario.id === binding.scenario.id }))
    .sort((a, b) => a.headroom - b.headroom);
}

export function exposureGroups(
  positions: readonly Position[],
  key: (position: Position) => { id: string; label: string },
  order?: string[],
): ExposureGroup[] {
  const groups = new Map<string, ExposureGroup>();
  positions.forEach((position) => {
    const { id, label } = key(position);
    const found = groups.get(id) ?? { id, label, count: 0, gross: 0, net: 0, collateral: 0, share: 0 };
    found.count += 1;
    found.gross += position.grossNotional;
    found.net += position.signedNotional;
    found.collateral += position.collateral;
    groups.set(id, found);
  });
  const total = [...groups.values()].reduce((acc, group) => acc + group.gross, 0);
  const list = [...groups.values()].map((group) => ({ ...group, share: total === 0 ? 0 : group.gross / total }));
  return order
    ? list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    : list.sort((a, b) => b.gross - a.gross);
}

export function exposureByUnderlying(positions: readonly Position[]): ExposureGroup[] {
  return exposureGroups(positions, (position) => ({ id: position.market.underlying, label: position.market.underlying }));
}

export function exposureByDomain(positions: readonly Position[]): ExposureGroup[] {
  return exposureGroups(positions, (position) => ({ id: position.domain, label: DOMAIN_LABEL[position.domain] }), DOMAIN_ORDER);
}

/** Fixing beats closing beats active: a rung reports its most urgent member. */
const STATE_PRIORITY: Record<PositionState, number> = { FIXING_WINDOW: 0, CLOSING: 1, ACTIVE: 2 };

/** Collateral released and price PnL settled at each expiry, if every fixing printed at today's marks. */
export function expiryLadder(positions: readonly Position[], available: number): LadderRung[] {
  const rungs = new Map<string, Position[]>();
  positions.forEach((position) => {
    const iso = position.market.expiryIso;
    rungs.set(iso, [...(rungs.get(iso) ?? []), position]);
  });
  let running = available;
  return [...rungs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([expiryIso, members]) => {
      const collateralRelease = sum(members.map((position) => position.collateral));
      const residualCash = sum(members.map((position) => position.pnl.price));
      const netCash = round(collateralRelease + residualCash);
      running = round(running + netCash);
      const state = [...members].sort((a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state])[0].state;
      return {
        expiryIso,
        days: members[0].daysToExpiry,
        positions: members,
        lots: sum(members.map((position) => position.lots)),
        collateralRelease,
        residualCash,
        netCash,
        availableAfter: running,
        state,
      };
    });
}

/** Grouping only reorders: every position appears exactly once in every view. */
export function groupPositions(positions: readonly Position[], by: GroupBy): PositionGroup[] {
  const key: Record<GroupBy, (position: Position) => { id: string; label: string; detail: string }> = {
    STRATEGY: (position) => ({
      id: position.market.strategyKind,
      label: position.market.strategyLabel || enumLabel(position.market.strategyKind),
      detail: "dated range forward",
    }),
    UNDERLYING: (position) => ({
      id: position.market.underlying,
      label: position.market.underlying,
      detail: DOMAIN_LABEL[position.domain],
    }),
    EXPIRY: (position) => ({
      id: position.market.expiryIso,
      label: formatExpiry(position.market.expiryIso.slice(0, 10)),
      detail: `${position.daysToExpiry}d to fixing`,
    }),
    DOMAIN: (position) => ({
      id: position.domain,
      label: DOMAIN_LABEL[position.domain],
      detail: position.market.settlementAsset,
    }),
  };
  const groups = new Map<string, PositionGroup>();
  positions.forEach((position) => {
    const { id, label, detail } = key[by](position);
    const group = groups.get(id) ?? { id, label, detail, positions: [], gross: 0, net: 0, collateral: 0, pnl: 0 };
    group.positions.push(position);
    group.gross += position.grossNotional;
    group.net += position.signedNotional;
    group.collateral += position.collateral;
    group.pnl = round(group.pnl + position.pnl.total);
    groups.set(id, group);
  });
  const list = [...groups.values()];
  return by === "EXPIRY" ? list.sort((a, b) => a.id.localeCompare(b.id)) : list.sort((a, b) => b.gross - a.gross);
}
