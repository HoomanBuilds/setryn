import { COLLATERAL, COLLATERAL_TOTALS, eligibleValue } from "@/lib/terminal/account";
import { CONSOLE } from "@/lib/terminal/console";
import { enumLabel } from "@/lib/terminal/discovery";
import { daysToExpiry, formatExpiry } from "@/lib/terminal/format";
import { findMarket, packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket, StrategyKind, StrategyRecord } from "@/lib/terminal/types";
import { SCENARIOS } from "./scenarios";
import type {
  AccountSummary,
  CollateralLine,
  ExposureGroup,
  GroupBy,
  LadderRung,
  PnlBreakdown,
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

/** USDC moved by one point of package price at this size and direction. */
function pointValue(position: Pick<Position, "lots" | "market" | "side">): number {
  const direction = position.side === "LONG" ? 1 : -1;
  return position.lots * position.market.contractMultiplier * direction;
}

function breakdown(record: StrategyRecord, market: PackageMarket, side: 1 | -1): PnlBreakdown {
  const { carry, funding, fees, residual } = record.attribution;
  const price = round((market.netPrice - record.entryPrice) * record.lots * market.contractMultiplier * side);
  return { price, carry, funding, fees, residual, total: round(price + carry + funding + fees + residual) };
}

function buildPosition(record: StrategyRecord): Position {
  const market = findMarket(record.marketId);
  const direction = record.side === "LONG" ? 1 : -1;
  const pnl = breakdown(record, market, direction);
  const collateral = record.lots * market.collateralPerLot;
  const equity = round(collateral + pnl.total);
  const bufferUsdc = round(equity - record.maintenanceMargin);
  const perPoint = record.lots * market.contractMultiplier;
  const bufferPoints = round(bufferUsdc / perPoint, market.priceDecimals + 2);
  const liquidationPrice = round(market.netPrice - direction * bufferPoints, market.priceDecimals);

  return {
    id: record.id,
    record,
    market,
    label: packageLabel(market),
    side: record.side,
    state: record.state,
    lots: record.lots,
    signedLots: record.lots * direction,
    entryPrice: record.entryPrice,
    markPrice: market.netPrice,
    signedNotional: record.lots * market.notionalPerLot * direction,
    grossNotional: record.lots * market.notionalPerLot,
    collateral,
    initialMargin: record.initialMargin,
    maintenanceMargin: record.maintenanceMargin,
    pnl,
    equity,
    bufferUsdc,
    bufferShare: equity === 0 ? 0 : bufferUsdc / equity,
    bufferPoints,
    /* A level on the wrong side of zero is not a level: the package quote can
       never reach it, so the buffer is the only honest read of that position. */
    liquidationPrice: liquidationPrice > 0 ? liquidationPrice : null,
    domain: DOMAIN_BY_KIND[market.strategyKind],
    daysToExpiry: daysToExpiry(market.expiryIso),
    nextEvent: record.nextEvent,
    href: tradeHref(market),
  };
}

/** Total profit and loss of one record, for callers that hold no Position. */
export function strategyPnl(record: StrategyRecord): number {
  const market = findMarket(record.marketId);
  return breakdown(record, market, record.side === "LONG" ? 1 : -1).total;
}

export const POSITIONS: Position[] = CONSOLE.strategies
  .map(buildPosition)
  .sort((a, b) => b.grossNotional - a.grossNotional);

export function findPosition(id: string): Position {
  return POSITIONS.find((position) => position.id === id) ?? POSITIONS[0];
}

function sum(values: number[]): number {
  return round(values.reduce((total, value) => total + value, 0));
}

export const PORTFOLIO_PNL: PnlBreakdown = {
  price: sum(POSITIONS.map((p) => p.pnl.price)),
  carry: sum(POSITIONS.map((p) => p.pnl.carry)),
  funding: sum(POSITIONS.map((p) => p.pnl.funding)),
  fees: sum(POSITIONS.map((p) => p.pnl.fees)),
  residual: sum(POSITIONS.map((p) => p.pnl.residual)),
  total: sum(POSITIONS.map((p) => p.pnl.total)),
};

export const COLLATERAL_LINES: CollateralLine[] = COLLATERAL.map((asset) => {
  const eligible = eligibleValue(asset);
  return { asset, eligible, available: round(eligible - asset.reserved), share: 0 };
});

const { eligible: ELIGIBLE, reserved: RESERVED } = COLLATERAL_TOTALS;
COLLATERAL_LINES.forEach((line) => {
  line.share = ELIGIBLE === 0 ? 0 : line.eligible / ELIGIBLE;
});

const INITIAL_MARGIN = sum(POSITIONS.map((position) => position.initialMargin));
const MAINTENANCE_MARGIN = sum(POSITIONS.map((position) => position.maintenanceMargin));
const EQUITY = round(ELIGIBLE + PORTFOLIO_PNL.total);

export function positionScenarioImpact(position: Position, scenario: StressScenario): number {
  return round(position.markPrice * scenario.moves[position.domain] * pointValue(position));
}

function evaluate(scenario: StressScenario): Omit<ScenarioResult, "binding"> {
  const impacts = POSITIONS.map((position) => ({
    label: position.label,
    impact: positionScenarioImpact(position, scenario),
  }));
  const impact = sum(impacts.map((entry) => entry.impact));
  const equityAfter = round(EQUITY + impact);
  const worst = impacts.reduce((low, entry) => (entry.impact < low.impact ? entry : low));
  return {
    scenario,
    impact,
    equityAfter,
    headroom: round(equityAfter - MAINTENANCE_MARGIN),
    healthFactor: MAINTENANCE_MARGIN === 0 ? 0 : equityAfter / MAINTENANCE_MARGIN,
    worstLabel: worst.label,
    worstImpact: worst.impact,
  };
}

const EVALUATED = SCENARIOS.map(evaluate);
const BINDING_ID = EVALUATED.reduce((low, result) => (result.headroom < low.headroom ? result : low))
  .scenario.id;

export const SCENARIO_RESULTS: ScenarioResult[] = EVALUATED.map((result) => ({
  ...result,
  binding: result.scenario.id === BINDING_ID,
})).sort((a, b) => a.headroom - b.headroom);

export const BINDING_SCENARIO: ScenarioResult =
  SCENARIO_RESULTS.find((result) => result.binding) ?? SCENARIO_RESULTS[0];

export const ACCOUNT_SUMMARY: AccountSummary = {
  equity: EQUITY,
  postedValue: COLLATERAL_TOTALS.posted,
  eligible: ELIGIBLE,
  reserved: RESERVED,
  available: COLLATERAL_TOTALS.available,
  initialMargin: INITIAL_MARGIN,
  maintenanceMargin: MAINTENANCE_MARGIN,
  healthFactor: MAINTENANCE_MARGIN === 0 ? 0 : EQUITY / MAINTENANCE_MARGIN,
  marginUsage: ELIGIBLE === 0 ? 0 : INITIAL_MARGIN / ELIGIBLE,
  stressHeadroom: BINDING_SCENARIO.headroom,
  stressHealthFactor: BINDING_SCENARIO.healthFactor,
  bindingLabel: BINDING_SCENARIO.scenario.label,
};

function exposure(
  key: (position: Position) => { id: string; label: string },
  order?: string[],
): ExposureGroup[] {
  const groups = new Map<string, ExposureGroup>();
  POSITIONS.forEach((position) => {
    const { id, label } = key(position);
    const found = groups.get(id) ?? { id, label, count: 0, gross: 0, net: 0, collateral: 0, share: 0 };
    found.count += 1;
    found.gross += position.grossNotional;
    found.net += position.signedNotional;
    found.collateral += position.collateral;
    groups.set(id, found);
  });

  const total = [...groups.values()].reduce((acc, group) => acc + group.gross, 0);
  const list = [...groups.values()].map((group) => ({
    ...group,
    share: total === 0 ? 0 : group.gross / total,
  }));

  return order
    ? list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    : list.sort((a, b) => b.gross - a.gross);
}

export const EXPOSURE_BY_UNDERLYING = exposure((position) => ({
  id: position.market.underlying,
  label: position.market.underlying,
}));

export const EXPOSURE_BY_DOMAIN = exposure(
  (position) => ({ id: position.domain, label: DOMAIN_LABEL[position.domain] }),
  DOMAIN_ORDER,
);

export const GROSS_EXPOSURE = sum(POSITIONS.map((position) => position.grossNotional));
export const NET_EXPOSURE = sum(POSITIONS.map((position) => position.signedNotional));

/** Fixing beats closing beats active: a rung reports its most urgent member. */
const STATE_PRIORITY = { FIXING_WINDOW: 0, CLOSING: 1, ACTIVE: 2 } as const;

export const EXPIRY_LADDER: LadderRung[] = (() => {
  const rungs = new Map<string, Position[]>();
  POSITIONS.forEach((position) => {
    const iso = position.market.expiryIso;
    rungs.set(iso, [...(rungs.get(iso) ?? []), position]);
  });

  let running = ACCOUNT_SUMMARY.available;
  return [...rungs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([expiryIso, members]) => {
      const collateralRelease = sum(members.map((position) => position.collateral));
      const residualCash = sum(
        members.map(
          (position) =>
            position.lots *
            position.market.residualPerLot *
            (position.side === "LONG" ? 1 : -1),
        ),
      );
      const netCash = round(collateralRelease + residualCash);
      running = round(running + netCash);
      const state = [...members].sort(
        (a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state],
      )[0].state;

      return {
        expiryIso,
        days: daysToExpiry(expiryIso),
        positions: members,
        lots: sum(members.map((position) => position.lots)),
        collateralRelease,
        residualCash,
        netCash,
        availableAfter: running,
        state,
      };
    });
})();

/** The nearest rung: what the book funds or rolls before anything else. */
export const NEXT_EXPIRY: LadderRung = EXPIRY_LADDER[0];

const GROUP_KEY: Record<GroupBy, (position: Position) => { id: string; label: string; detail: string }> = {
  STRATEGY: (position) => ({
    id: position.market.strategyKind,
    label: enumLabel(position.market.strategyKind),
    detail: position.market.strategyLabel,
  }),
  UNDERLYING: (position) => ({
    id: position.market.underlying,
    label: position.market.underlying,
    detail: DOMAIN_LABEL[position.domain],
  }),
  EXPIRY: (position) => ({
    id: position.market.expiryIso,
    label: formatExpiry(position.market.expiryIso),
    detail: `${position.daysToExpiry}d to fixing`,
  }),
  DOMAIN: (position) => ({
    id: position.domain,
    label: DOMAIN_LABEL[position.domain],
    detail: position.market.settlementAsset,
  }),
};

/** Grouping only reorders: every position appears exactly once in every view. */
export function groupPositions(by: GroupBy): PositionGroup[] {
  const key = GROUP_KEY[by];
  const groups = new Map<string, PositionGroup>();

  POSITIONS.forEach((position) => {
    const { id, label, detail } = key(position);
    const found =
      groups.get(id) ??
      { id, label, detail, positions: [], gross: 0, net: 0, collateral: 0, pnl: 0 };
    found.positions.push(position);
    found.gross += position.grossNotional;
    found.net += position.signedNotional;
    found.collateral += position.collateral;
    found.pnl = round(found.pnl + position.pnl.total);
    groups.set(id, found);
  });

  const list = [...groups.values()];
  return by === "EXPIRY"
    ? list.sort((a, b) => a.id.localeCompare(b.id))
    : list.sort((a, b) => b.gross - a.gross);
}
