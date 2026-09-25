import type { GatewaySnapshot, ExecutionPosition } from "@/lib/internal-gateway/types";
import { daysToExpiry, formatExpiry } from "@/lib/terminal/format";
import { findMarket, packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { StrategyRecord } from "@/lib/terminal/types";
import {
  ACCOUNT_SUMMARY,
  BINDING_SCENARIO,
  EXPIRY_LADDER,
  EXPOSURE_BY_DOMAIN,
  EXPOSURE_BY_UNDERLYING,
  GROSS_EXPOSURE,
  NET_EXPOSURE,
  PORTFOLIO_PNL,
  POSITIONS,
  SCENARIO_RESULTS,
  DOMAIN_LABEL,
} from "./model";
import type {
  AccountSummary,
  CollateralLine,
  GroupBy,
  PnlBreakdown,
  Position,
  PositionGroup,
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

function runtimeRecord(position: ExecutionPosition, fees: number): StrategyRecord {
  return {
    id: position.id,
    marketId: position.marketId,
    side: position.side,
    lots: position.lots,
    entryPrice: position.entryPrice,
    initialMargin: position.collateral,
    maintenanceMargin: round(position.collateral * 0.75),
    attribution: { carry: 0, funding: 0, fees: -fees, residual: 0 },
    nextEvent: "Lifecycle monitoring is configured in the package terminal.",
    state: position.state,
  };
}

function runtimePosition(
  execution: ExecutionPosition,
  snapshot: GatewaySnapshot,
): Position {
  const market = findMarket(execution.marketId);
  const receipt = snapshot.receipts.find(
    (candidate) =>
      candidate.marketId === execution.marketId &&
      candidate.lots === execution.lots &&
      candidate.price === execution.entryPrice,
  );
  const fee = receipt?.fees ?? 0;
  const direction = execution.side === "LONG" ? 1 : -1;
  const price = round(
    (market.netPrice - execution.entryPrice) * execution.lots * market.contractMultiplier * direction,
  );
  const pnl: PnlBreakdown = {
    ...emptyPnl(),
    price,
    fees: -fee,
    total: round(price - fee),
  };
  const equity = round(execution.collateral + pnl.total);
  const maintenanceMargin = round(execution.collateral * 0.75);
  const bufferUsdc = round(equity - maintenanceMargin);
  const bufferPoints = round(bufferUsdc / (execution.lots * market.contractMultiplier));
  const liquidationPrice = round(market.netPrice - direction * bufferPoints);

  return {
    id: execution.id,
    record: runtimeRecord(execution, fee),
    market,
    label: packageLabel(market),
    side: execution.side,
    state: execution.state,
    lots: execution.lots,
    signedLots: execution.lots * direction,
    entryPrice: execution.entryPrice,
    markPrice: market.netPrice,
    signedNotional: execution.lots * market.notionalPerLot * direction,
    grossNotional: execution.lots * market.notionalPerLot,
    collateral: execution.collateral,
    initialMargin: execution.collateral,
    maintenanceMargin,
    pnl,
    equity,
    bufferUsdc,
    bufferShare: equity === 0 ? 0 : bufferUsdc / equity,
    bufferPoints,
    liquidationPrice: liquidationPrice > 0 ? liquidationPrice : null,
    domain:
      market.strategyKind === "DATED_BASIS"
        ? "CRYPTO_BASIS"
        : market.strategyKind === "DELIVERABLE_FORWARD"
          ? "MACRO_FORWARD"
          : "CRYPTO_CARRY",
    daysToExpiry: daysToExpiry(market.expiryIso),
    nextEvent: "Lifecycle monitoring is configured in the package terminal.",
    href: tradeHref(market),
    source: "RUNTIME_SIMULATION",
    provenance: `${snapshot.environment.label} clearing simulation`,
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
  referencePositions: Position[];
  positions: Position[];
  runtimePnl: PnlBreakdown;
  referencePnl: PnlBreakdown;
  collateralLines: CollateralLine[];
  runtimeGross: number;
  runtimeNet: number;
  reference: {
    account: AccountSummary;
    gross: number;
    net: number;
    exposuresByDomain: typeof EXPOSURE_BY_DOMAIN;
    exposuresByUnderlying: typeof EXPOSURE_BY_UNDERLYING;
    expiryLadder: typeof EXPIRY_LADDER;
    scenarios: typeof SCENARIO_RESULTS;
    binding: typeof BINDING_SCENARIO;
  };
}

export function portfolioRuntime(snapshot: GatewaySnapshot): RuntimePortfolio {
  const runtimePositions = snapshot.positions.map((position) => runtimePosition(position, snapshot));
  const positions = [
    ...runtimePositions,
    ...POSITIONS.map((position) => ({
      ...position,
      source: "REFERENCE_OBSERVATION" as const,
      provenance: "Preview market observation",
    })),
  ];
  const maintenanceMargin = sum(runtimePositions.map((position) => position.maintenanceMargin));
  const initialMargin = sum(runtimePositions.map((position) => position.initialMargin));
  const account: AccountSummary = {
    equity: snapshot.account.equity,
    postedValue: snapshot.account.posted,
    eligible: snapshot.account.eligible,
    reserved: snapshot.account.reserved,
    available: snapshot.account.available,
    initialMargin,
    maintenanceMargin,
    healthFactor: maintenanceMargin === 0 ? 0 : snapshot.account.equity / maintenanceMargin,
    marginUsage: snapshot.account.eligible === 0 ? 0 : snapshot.account.reserved / snapshot.account.eligible,
    stressHeadroom: 0,
    stressHealthFactor: 0,
    bindingLabel: "Reference scenario only",
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
        withdrawalNote: "Local runtime intent. Wallet confirmation is simulated.",
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
    referencePositions: positions.filter((position) => position.source === "REFERENCE_OBSERVATION"),
    positions,
    runtimePnl: runtimePnl(runtimePositions),
    referencePnl: PORTFOLIO_PNL,
    collateralLines,
    runtimeGross: sum(runtimePositions.map((position) => position.grossNotional)),
    runtimeNet: sum(runtimePositions.map((position) => position.signedNotional)),
    reference: {
      account: ACCOUNT_SUMMARY,
      gross: GROSS_EXPOSURE,
      net: NET_EXPOSURE,
      exposuresByDomain: EXPOSURE_BY_DOMAIN,
      exposuresByUnderlying: EXPOSURE_BY_UNDERLYING,
      expiryLadder: EXPIRY_LADDER,
      scenarios: SCENARIO_RESULTS,
      binding: BINDING_SCENARIO,
    },
  };
}

export function positionOrigin(position: Position): string {
  return position.source === "RUNTIME_SIMULATION" ? "Runtime simulation" : "Reference observation";
}

export function runtimeObservationLabel(snapshot: GatewaySnapshot): string {
  return `${snapshot.environment.label} / ${snapshot.environment.evidence.toLowerCase()} evidence / current browser session`;
}

export function groupPortfolioPositions(positions: Position[], by: GroupBy): PositionGroup[] {
  const labels: Record<GroupBy, (position: Position) => { id: string; label: string; detail: string }> = {
    STRATEGY: (position) => ({
      id: position.market.strategyKind,
      label: position.market.strategyLabel,
      detail: position.source === "RUNTIME_SIMULATION" ? "runtime package" : "reference observation",
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
  const groups = new Map<string, PositionGroup>();
  positions.forEach((position) => {
    const { id, label, detail } = labels[by](position);
    const group = groups.get(id) ?? {
      id,
      label,
      detail,
      positions: [],
      gross: 0,
      net: 0,
      collateral: 0,
      pnl: 0,
    };
    group.positions.push(position);
    group.gross += position.grossNotional;
    group.net += position.signedNotional;
    group.collateral += position.collateral;
    group.pnl += position.pnl.total;
    groups.set(id, group);
  });
  return [...groups.values()].sort((first, second) =>
    by === "EXPIRY" ? first.id.localeCompare(second.id) : second.gross - first.gross,
  );
}
