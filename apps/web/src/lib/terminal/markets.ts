import type {
  BookRow,
  LiquiditySource,
  PackageLeg,
  PackageMarket,
  PayoffPoint,
  PriceUnit,
  Qualification,
  RouteQuote,
  SettlementClass,
  StrategyKind,
} from "./types";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

interface PayoffSpec {
  base: number;
  slope: number;
  floor: number;
  ceil: number;
  moveUnit: string;
  moveRange: number;
}

interface MarketSpec {
  id: string;
  name: string;
  code: string;
  underlying: string;
  strategyKind: StrategyKind;
  strategyLabel: string;
  priceUnit: PriceUnit;
  priceDecimals: number;
  tickSize: number;
  mid: number;
  priorNetPrice: number;
  spreadTicks: number;
  expiryIso: string;
  tenorLabel: string;
  settlementClass: SettlementClass;
  fixingSource: string;
  qualification: Qualification;
  qualificationNote: string;
  snapshotAgeSeconds: number;
  notionalPerLot: number;
  contractMultiplier: number;
  collateralPerLot: number;
  residualPerLot: number;
  openInterestLots: number;
  drift: number;
  noise: number;
  seed: number;
  legs: PackageLeg[];
  payoff: PayoffSpec;
  impliedOrigin: string;
  solverOrigin: string;
}

interface LevelSpec {
  offsetTicks: number;
  source: LiquiditySource;
  lots: number;
  executable: boolean;
  indicative?: boolean;
}

const ASK_LADDER: LevelSpec[] = [
  { offsetTicks: -1, source: "SOLVER_FIRM", lots: 40, executable: true },
  { offsetTicks: 0, source: "DIRECT", lots: 18, executable: true },
  { offsetTicks: 1, source: "IMPLIED", lots: 26, executable: true },
  { offsetTicks: 2, source: "DIRECT", lots: 31, executable: true },
  { offsetTicks: 4, source: "IMPLIED", lots: 44, executable: true },
  { offsetTicks: 7, source: "IMPLIED", lots: 60, executable: false, indicative: true },
];

const BID_LADDER: LevelSpec[] = [
  { offsetTicks: -1, source: "SOLVER_FIRM", lots: 35, executable: true },
  { offsetTicks: 0, source: "DIRECT", lots: 22, executable: true },
  { offsetTicks: 1, source: "IMPLIED", lots: 19, executable: true },
  { offsetTicks: 2, source: "DIRECT", lots: 37, executable: true },
  { offsetTicks: 4, source: "IMPLIED", lots: 41, executable: true },
  { offsetTicks: 7, source: "IMPLIED", lots: 55, executable: false, indicative: true },
];

function buildBook(spec: MarketSpec): BookRow[] {
  const rand = seeded(spec.seed);
  const half = (spec.spreadTicks / 2) * spec.tickSize;
  const rows: BookRow[] = [];

  const push = (side: "BID" | "ASK", ladder: LevelSpec[]) => {
    ladder.forEach((level, index) => {
      const direction = side === "ASK" ? 1 : -1;
      const price = round(
        spec.mid + direction * (half + level.offsetTicks * spec.tickSize),
        spec.priceDecimals,
      );
      const lots = Math.max(2, Math.round(level.lots * (0.72 + rand() * 0.56)));
      rows.push({
        id: `${spec.id}-${side}-${index}`,
        side,
        source: level.source,
        price,
        lots,
        firmness: level.indicative
          ? "INDICATIVE"
          : level.source === "IMPLIED"
            ? "CAPACITY_BACKED"
            : "FIRM",
        executable: level.executable,
        ttlSeconds: level.source === "SOLVER_FIRM" ? 45 : undefined,
        origin:
          level.source === "IMPLIED"
            ? spec.impliedOrigin
            : level.source === "SOLVER_FIRM"
              ? spec.solverOrigin
              : undefined,
      });
    });
  };

  push("ASK", ASK_LADDER);
  push("BID", BID_LADDER);
  return rows;
}

function buildRoutes(spec: MarketSpec, book: BookRow[]): RouteQuote[] {
  const executable = book.filter((row) => row.executable);
  const lotsFor = (source: LiquiditySource) =>
    executable.filter((row) => row.source === source).reduce((sum, row) => sum + row.lots, 0);
  const best = (source: LiquiditySource, side: "BID" | "ASK") => {
    const candidates = executable.filter((row) => row.source === source && row.side === side);
    if (candidates.length === 0) return spec.mid;
    return side === "ASK"
      ? Math.min(...candidates.map((row) => row.price))
      : Math.max(...candidates.map((row) => row.price));
  };

  return [
    {
      id: "DIRECT_BOOK",
      label: "Direct package book",
      source: "DIRECT",
      enterPrice: best("DIRECT", "ASK"),
      exitPrice: best("DIRECT", "BID"),
      protocolFeeBps: 2.5,
      counterpartyFeeBps: 1.5,
      counterpartyFeeLabel: "Maker fee",
      guarantee: "PACKAGE_ATOMIC",
      etaLabel: "2 blocks, about 4s",
      availableLots: lotsFor("DIRECT"),
      requiresPrivate: false,
      intermediateExposureRate: 0,
      collateralMultiple: 1,
      note: "Resting package liquidity. All legs print in one match, so no leg can fill alone.",
    },
    {
      id: "IMPLIED_LEGS",
      label: "Implied from component legs",
      source: "IMPLIED",
      enterPrice: round(best("IMPLIED", "ASK") - spec.tickSize * 1.5, spec.priceDecimals),
      exitPrice: round(best("IMPLIED", "BID") + spec.tickSize * 1.5, spec.priceDecimals),
      protocolFeeBps: 2.5,
      counterpartyFeeBps: 2.2,
      counterpartyFeeLabel: "Component maker fees",
      guarantee: "LEG_SEQUENCED",
      etaLabel: "5 blocks, about 10s",
      availableLots: lotsFor("IMPLIED"),
      requiresPrivate: false,
      intermediateExposureRate: 0.34,
      collateralMultiple: 1.18,
      note: "Headline price improves, but legs print in sequence and the package is exposed until the last leg confirms.",
    },
    {
      id: "SOLVER_RFQ",
      label: "Solver firm quote, private RFQ",
      source: "SOLVER_FIRM",
      enterPrice: best("SOLVER_FIRM", "ASK"),
      exitPrice: best("SOLVER_FIRM", "BID"),
      protocolFeeBps: 2.5,
      counterpartyFeeBps: 0.9,
      counterpartyFeeLabel: "Solver fee",
      guarantee: "SOLVER_BONDED",
      etaLabel: "1 block after accept, about 2s, quote valid 45s",
      availableLots: lotsFor("SOLVER_FIRM"),
      requiresPrivate: true,
      intermediateExposureRate: 0,
      collateralMultiple: 0.94,
      note: "Signed, capacity-backed commitment. Requires the private RFQ toggle because the request is disclosed only to invited solvers.",
    },
  ];
}

/**
 * A free walk has to be snapped onto the net package price at the last sample,
 * which prints a cliff. The walk is pinned as a bridge instead: its deviation is
 * faded out in proportion to elapsed time, so the series reaches the net price
 * from its own trajectory and the close stays exact.
 */
function buildPriceHistory(spec: MarketSpec): number[] {
  const rand = seeded(spec.seed + 977);
  const points = 96;
  const deviations: number[] = [];
  let walk = 0;
  for (let i = 0; i < points; i += 1) {
    const wave = Math.sin(i / 7.5) * spec.noise * 0.066;
    /* The closing samples move less, so the last print settles onto the net
       price instead of arriving there in one outsized step. */
    const settle = Math.min(1, (points - i) / 10);
    walk += ((rand() - 0.5) * spec.noise + wave) * settle + spec.drift;
    deviations.push(walk);
  }

  const terminal = deviations[points - 1];
  const history = deviations.map((deviation, i) => {
    const elapsed = (i + 1) / points;
    const trend = spec.priorNetPrice + (spec.mid - spec.priorNetPrice) * elapsed;
    return round(trend + deviation - terminal * elapsed, spec.priceDecimals);
  });
  history[points - 1] = spec.mid;
  return history;
}

function buildPayoff(spec: MarketSpec): { points: PayoffPoint[]; breakEven: number } {
  const { base, slope, floor, ceil, moveRange } = spec.payoff;
  const points: PayoffPoint[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i += 1) {
    const move = -moveRange + (2 * moveRange * i) / steps;
    const raw = base + slope * move;
    points.push({ move: round(move, 3), value: round(Math.min(ceil, Math.max(floor, raw)), 2) });
  }
  const breakEven = slope === 0 ? 0 : round(-base / slope, 3);
  return { points, breakEven };
}

function buildMarket(spec: MarketSpec): PackageMarket {
  const book = buildBook(spec);
  const routes = buildRoutes(spec, book);
  const executable = book.filter((row) => row.executable);
  const { points, breakEven } = buildPayoff(spec);

  return {
    id: spec.id,
    name: spec.name,
    code: spec.code,
    underlying: spec.underlying,
    strategyKind: spec.strategyKind,
    strategyLabel: spec.strategyLabel,
    priceUnit: spec.priceUnit,
    priceDecimals: spec.priceDecimals,
    tickSize: spec.tickSize,
    netPrice: spec.mid,
    priorNetPrice: spec.priorNetPrice,
    bestBid: Math.max(...executable.filter((r) => r.side === "BID").map((r) => r.price)),
    bestAsk: Math.min(...executable.filter((r) => r.side === "ASK").map((r) => r.price)),
    expiryIso: spec.expiryIso,
    tenorLabel: spec.tenorLabel,
    settlementClass: spec.settlementClass,
    settlementAsset: "USDC",
    fixingSource: spec.fixingSource,
    qualification: spec.qualification,
    qualificationNote: spec.qualificationNote,
    snapshotAgeSeconds: spec.snapshotAgeSeconds,
    notionalPerLot: spec.notionalPerLot,
    contractMultiplier: spec.contractMultiplier,
    collateralPerLot: spec.collateralPerLot,
    residualPerLot: spec.residualPerLot,
    openInterestLots: spec.openInterestLots,
    firmDepthLots: executable.reduce((sum, row) => sum + row.lots, 0),
    legs: spec.legs,
    book,
    routes,
    priceHistory: buildPriceHistory(spec),
    payoffMoveUnit: spec.payoff.moveUnit,
    payoff: points,
    breakEvenMove: breakEven,
  };
}

interface MaturityVariant {
  /** Replaces the anchor's maturity token in the id, the code, and every leg. */
  token: string;
  tenorLabel: string;
  expiryIso: string;
  mid: number;
  priorNetPrice: number;
  spreadTicks: number;
  collateralPerLot: number;
  residualPerLot: number;
  openInterestLots: number;
  snapshotAgeSeconds: number;
  seed: number;
  qualification: Qualification;
  qualificationNote: string;
  /** Marks that move with the maturity, by leg id. A spot leg keeps its anchor mark. */
  legMarks?: Record<string, number>;
}

const MATURITY_TOKEN = /\d{2}[A-Z]{3}\d{2}/g;

/**
 * A maturity variant is its anchor re-dated: identity, quote, size, dispersion,
 * and every leg maturity move together. A new tenor is one row of data and a new
 * family is one more anchor, so neither has to reach a component.
 */
function maturity(anchor: MarketSpec, variant: MaturityVariant): MarketSpec {
  const redate = (text: string) => text.replace(MATURITY_TOKEN, variant.token);
  /* Dispersion and accrued carry are both quoted against the level, so both follow it. */
  const scale = variant.mid / anchor.mid;

  return {
    ...anchor,
    id: redate(anchor.id),
    code: redate(anchor.code),
    mid: variant.mid,
    priorNetPrice: variant.priorNetPrice,
    spreadTicks: variant.spreadTicks,
    expiryIso: variant.expiryIso,
    tenorLabel: variant.tenorLabel,
    qualification: variant.qualification,
    qualificationNote: variant.qualificationNote,
    snapshotAgeSeconds: variant.snapshotAgeSeconds,
    collateralPerLot: variant.collateralPerLot,
    residualPerLot: variant.residualPerLot,
    openInterestLots: variant.openInterestLots,
    drift: round(anchor.drift * scale, 5),
    noise: round(anchor.noise * scale, 3),
    seed: variant.seed,
    impliedOrigin: redate(anchor.impliedOrigin),
    legs: anchor.legs.map((leg) => ({
      ...leg,
      instrument: redate(leg.instrument),
      mark: variant.legMarks?.[leg.id] ?? leg.mark,
      /* The dated leg is what qualifies or not, so it carries the package state. */
      qualification: leg.family === "FORWARD" ? variant.qualification : leg.qualification,
    })),
    payoff: { ...anchor.payoff, base: round(anchor.payoff.base * scale, 1) },
  };
}

/** One family, anchor included, in maturity order. */
function ladder(anchor: MarketSpec, variants: MaturityVariant[]): MarketSpec[] {
  return [anchor, ...variants.map((variant) => maturity(anchor, variant))].sort((a, b) =>
    a.expiryIso.localeCompare(b.expiryIso),
  );
}

const ANCHORS: MarketSpec[] = [
  {
    id: "BTC-YC-24DEC26",
    name: "BTC Yield Carry",
    code: "BTC-YC-24DEC26",
    underlying: "BTC",
    strategyKind: "DATED_YIELD_CARRY",
    strategyLabel: "Dated yield carry, 3 legs",
    priceUnit: "BP",
    priceDecimals: 1,
    tickSize: 0.5,
    mid: 612.4,
    priorNetPrice: 596.8,
    spreadTicks: 6,
    expiryIso: "2026-12-24",
    tenorLabel: "DEC 26",
    settlementClass: "CASH_USDC",
    fixingSource: "Qualified benchmark set BTC-USD-1600LDN",
    qualification: "QUALIFIED",
    qualificationNote: "Benchmark, oracle, and settlement asset all qualified for this tenor.",
    snapshotAgeSeconds: 3,
    notionalPerLot: 25_000,
    contractMultiplier: 2.5,
    collateralPerLot: 1_950,
    residualPerLot: 38.25,
    openInterestLots: 4_180,
    drift: 0.004,
    noise: 2.6,
    seed: 10_007,
    impliedOrigin: "BTC 24DEC26 forward book plus USDC term book",
    solverOrigin: "Solver SLV-07, bonded capacity",
    legs: [
      {
        id: "btc-fwd",
        side: "BUY",
        ratio: 1,
        instrument: "BTC 24DEC26 dated forward",
        family: "FORWARD",
        venueClass: "NATIVE_BOOK",
        mark: 118_420,
        markUnit: "USD",
        qualification: "QUALIFIED",
        deltaPerLot: 1,
      },
      {
        id: "btc-spot",
        side: "SELL",
        ratio: 1,
        instrument: "BTC spot reference leg",
        family: "SPOT_REF",
        venueClass: "IMPLIED_COMPONENT",
        mark: 112_180,
        markUnit: "USD",
        qualification: "QUALIFIED",
        deltaPerLot: -1,
      },
      {
        id: "usdc-term",
        side: "BUY",
        ratio: 1,
        instrument: "USDC term financing 24DEC26",
        family: "FINANCING",
        venueClass: "NATIVE_BOOK",
        mark: 486,
        markUnit: "BP",
        qualification: "QUALIFIED",
        deltaPerLot: 0,
      },
    ],
    payoff: {
      base: 152.6,
      slope: 18.4,
      floor: -430,
      ceil: 620,
      moveUnit: "BTC spot move, percent",
      moveRange: 40,
    },
  },
  {
    id: "ETH-FC-25SEP26",
    name: "ETH Funding Carry",
    code: "ETH-FC-25SEP26",
    underlying: "ETH",
    strategyKind: "FUNDING_CARRY",
    strategyLabel: "Funding carry, 3 legs",
    priceUnit: "BP",
    priceDecimals: 1,
    tickSize: 0.5,
    mid: 438.6,
    priorNetPrice: 451.2,
    spreadTicks: 6,
    expiryIso: "2026-09-25",
    tenorLabel: "SEP 26",
    settlementClass: "CASH_USDC",
    fixingSource: "Qualified benchmark set ETH-USD-1600LDN",
    qualification: "QUALIFIED",
    qualificationNote:
      "Qualified for this tenor. The fixing window opens in under 72 hours, so new entries are near-dated.",
    snapshotAgeSeconds: 5,
    notionalPerLot: 20_000,
    contractMultiplier: 2,
    collateralPerLot: 1_420,
    residualPerLot: 21.4,
    openInterestLots: 2_940,
    drift: -0.0055,
    noise: 2.1,
    seed: 20_011,
    impliedOrigin: "ETH 25SEP26 forward book plus funding index book",
    solverOrigin: "Solver SLV-03, bonded capacity",
    legs: [
      {
        id: "eth-fwd",
        side: "BUY",
        ratio: 1,
        instrument: "ETH 25SEP26 dated forward",
        family: "FORWARD",
        venueClass: "NATIVE_BOOK",
        mark: 4_128.5,
        markUnit: "USD",
        qualification: "QUALIFIED",
        deltaPerLot: 1,
      },
      {
        id: "eth-funding",
        side: "SELL",
        ratio: 1,
        instrument: "ETH perpetual funding strip 25SEP26",
        family: "FUNDING",
        venueClass: "NATIVE_BOOK",
        mark: 312.8,
        markUnit: "BP",
        qualification: "QUALIFIED",
        deltaPerLot: -0.86,
      },
      {
        id: "eth-fin",
        side: "BUY",
        ratio: 0.5,
        instrument: "USDC term financing 24DEC26",
        family: "FINANCING",
        venueClass: "IMPLIED_COMPONENT",
        mark: 486,
        markUnit: "BP",
        qualification: "QUALIFIED",
        deltaPerLot: 0,
      },
    ],
    payoff: {
      base: 96.4,
      slope: 11.2,
      floor: -250,
      ceil: 380,
      moveUnit: "ETH spot move, percent",
      moveRange: 40,
    },
  },
  {
    id: "ARB-BS-26MAR27",
    name: "ARB Basis",
    code: "ARB-BS-26MAR27",
    underlying: "ARB",
    strategyKind: "DATED_BASIS",
    strategyLabel: "Dated basis, 2 legs",
    priceUnit: "BP",
    priceDecimals: 1,
    tickSize: 1,
    mid: 289.2,
    priorNetPrice: 262.5,
    spreadTicks: 6,
    expiryIso: "2027-03-26",
    tenorLabel: "MAR 27",
    settlementClass: "CASH_USDC",
    fixingSource: "Qualified benchmark set ARB-USD-1600LDN",
    qualification: "CONDITIONAL",
    qualificationNote:
      "Benchmark window is thinner than the qualification floor for this tenor. Entry is allowed, position size is capped.",
    snapshotAgeSeconds: 11,
    notionalPerLot: 10_000,
    contractMultiplier: 1,
    collateralPerLot: 940,
    residualPerLot: 12.8,
    openInterestLots: 1_260,
    drift: 0.012,
    noise: 3.4,
    seed: 30_013,
    impliedOrigin: "ARB 26MAR27 forward book plus ARB spot book",
    solverOrigin: "Solver SLV-11, bonded capacity",
    legs: [
      {
        id: "arb-fwd",
        side: "BUY",
        ratio: 1,
        instrument: "ARB 26MAR27 dated forward",
        family: "FORWARD",
        venueClass: "NATIVE_BOOK",
        mark: 0.9124,
        markUnit: "USD",
        qualification: "CONDITIONAL",
        deltaPerLot: 1,
      },
      {
        id: "arb-spot",
        side: "SELL",
        ratio: 1,
        instrument: "ARB spot reference leg",
        family: "BASIS",
        venueClass: "IMPLIED_COMPONENT",
        mark: 0.8996,
        markUnit: "USD",
        qualification: "QUALIFIED",
        deltaPerLot: -1,
      },
    ],
    payoff: {
      base: 72.1,
      slope: 7.8,
      floor: -200,
      ceil: 300,
      moveUnit: "ARB spot move, percent",
      moveRange: 45,
    },
  },
  {
    id: "EURUSD-FW-30DEC26",
    name: "EUR/USD Forward",
    code: "EURUSD-FW-30DEC26",
    underlying: "EUR/USD",
    strategyKind: "DELIVERABLE_FORWARD",
    strategyLabel: "Non-deliverable forward, 2 legs",
    priceUnit: "PTS",
    priceDecimals: 1,
    tickSize: 0.1,
    mid: 142.5,
    priorNetPrice: 138.2,
    spreadTicks: 6,
    expiryIso: "2026-12-30",
    tenorLabel: "DEC 26",
    settlementClass: "CASH_USDC_NDF",
    fixingSource: "Qualified benchmark set EURUSD-WMR-1600LDN",
    qualification: "QUALIFIED",
    qualificationNote:
      "Benchmark, session calendar, and settlement asset all qualified for this tenor.",
    snapshotAgeSeconds: 2,
    notionalPerLot: 100_000,
    contractMultiplier: 10,
    collateralPerLot: 2_600,
    residualPerLot: 84.5,
    openInterestLots: 6_420,
    drift: 0.0016,
    noise: 0.62,
    seed: 40_009,
    impliedOrigin: "EURUSD 30DEC26 outright book plus EUR term deposit book",
    solverOrigin: "Solver SLV-02, bonded capacity",
    legs: [
      {
        id: "eur-fwd",
        side: "BUY",
        ratio: 1,
        instrument: "EUR/USD 30DEC26 outright forward",
        family: "FORWARD",
        venueClass: "NATIVE_BOOK",
        mark: 1.09425,
        markUnit: "USD",
        qualification: "QUALIFIED",
        deltaPerLot: 1,
      },
      {
        id: "eur-spot",
        side: "SELL",
        ratio: 1,
        instrument: "EUR/USD spot reference leg",
        family: "SPOT_REF",
        venueClass: "IMPLIED_COMPONENT",
        mark: 1.093,
        markUnit: "USD",
        qualification: "QUALIFIED",
        deltaPerLot: -1,
      },
    ],
    payoff: {
      base: 118,
      slope: 96,
      floor: -760,
      ceil: 980,
      moveUnit: "EUR/USD spot move, percent",
      moveRange: 14,
    },
  },
  {
    id: "XAUUSD-FW-29JUN27",
    name: "XAU/USD Forward",
    code: "XAUUSD-FW-29JUN27",
    underlying: "XAU/USD",
    strategyKind: "DELIVERABLE_FORWARD",
    strategyLabel: "Cash-settled forward, 2 legs",
    priceUnit: "USD",
    priceDecimals: 2,
    tickSize: 0.05,
    mid: 41.8,
    priorNetPrice: 44.35,
    spreadTicks: 6,
    expiryIso: "2027-06-29",
    tenorLabel: "JUN 27",
    settlementClass: "CASH_USDC",
    fixingSource: "Qualified benchmark set XAU-USD-LBMA-PM",
    qualification: "CONDITIONAL",
    qualificationNote:
      "Fixing session falls on a scheduled market holiday. The calendar registry applies the next good business day.",
    snapshotAgeSeconds: 8,
    notionalPerLot: 50_000,
    contractMultiplier: 14.5,
    collateralPerLot: 3_150,
    residualPerLot: 46.9,
    openInterestLots: 2_105,
    drift: -0.0009,
    noise: 0.34,
    seed: 50_021,
    impliedOrigin: "XAU 29JUN27 forward book plus USD term book",
    solverOrigin: "Solver SLV-05, bonded capacity",
    legs: [
      {
        id: "xau-fwd",
        side: "BUY",
        ratio: 1,
        instrument: "XAU/USD 29JUN27 forward",
        family: "FORWARD",
        venueClass: "NATIVE_BOOK",
        mark: 3_412.4,
        markUnit: "USD",
        qualification: "CONDITIONAL",
        deltaPerLot: 1,
      },
      {
        id: "xau-fin",
        side: "SELL",
        ratio: 1,
        instrument: "USD term financing 29JUN27",
        family: "FINANCING",
        venueClass: "NATIVE_BOOK",
        mark: 502,
        markUnit: "BP",
        qualification: "QUALIFIED",
        deltaPerLot: 0,
      },
    ],
    payoff: {
      base: 64.2,
      slope: 52,
      floor: -560,
      ceil: 760,
      moveUnit: "XAU/USD spot move, percent",
      moveRange: 20,
    },
  },
];

/**
 * Preview depth. Every entry is a real maturity of its anchor family, priced on
 * one term structure: the near tenors quote through to the far ones, and the
 * prior close moves as a shift of the same curve rather than per-row noise.
 */
const MATURITIES: Record<string, MaturityVariant[]> = {
  "BTC-YC-24DEC26": [
    {
      token: "26MAR27",
      tenorLabel: "MAR 27",
      expiryIso: "2027-03-26",
      mid: 648.5,
      priorNetPrice: 634.2,
      spreadTicks: 8,
      collateralPerLot: 2_480,
      residualPerLot: 61.4,
      openInterestLots: 2_640,
      snapshotAgeSeconds: 4,
      seed: 10_037,
      qualification: "QUALIFIED",
      qualificationNote: "Benchmark, oracle, and settlement asset all qualified for this tenor.",
      legMarks: { "btc-fwd": 124_590, "usdc-term": 508 },
    },
    {
      token: "25JUN27",
      tenorLabel: "JUN 27",
      expiryIso: "2027-06-25",
      mid: 671,
      priorNetPrice: 659.5,
      spreadTicks: 10,
      collateralPerLot: 2_880,
      residualPerLot: 78.6,
      openInterestLots: 1_180,
      snapshotAgeSeconds: 6,
      seed: 10_061,
      qualification: "CONDITIONAL",
      qualificationNote:
        "Benchmark attestation runs one tenor short of this maturity. Entry is allowed, position size is capped.",
      legMarks: { "btc-fwd": 130_700, "usdc-term": 524 },
    },
  ],
  "ETH-FC-25SEP26": [
    {
      token: "27NOV26",
      tenorLabel: "NOV 26",
      expiryIso: "2026-11-27",
      mid: 462.8,
      priorNetPrice: 471.6,
      spreadTicks: 6,
      collateralPerLot: 1_560,
      residualPerLot: 28.9,
      openInterestLots: 1_860,
      snapshotAgeSeconds: 4,
      seed: 20_029,
      qualification: "QUALIFIED",
      qualificationNote: "Benchmark, oracle, and settlement asset all qualified for this tenor.",
      legMarks: { "eth-fwd": 4_161.5, "eth-funding": 329.4, "eth-fin": 472 },
    },
    {
      token: "24DEC26",
      tenorLabel: "DEC 26",
      expiryIso: "2026-12-24",
      mid: 478.4,
      priorNetPrice: 484.9,
      spreadTicks: 8,
      collateralPerLot: 1_680,
      residualPerLot: 33.6,
      openInterestLots: 2_210,
      snapshotAgeSeconds: 6,
      seed: 20_047,
      qualification: "QUALIFIED",
      qualificationNote: "Benchmark, oracle, and settlement asset all qualified for this tenor.",
      legMarks: { "eth-fwd": 4_177.3, "eth-funding": 341, "eth-fin": 486 },
    },
    {
      token: "26MAR27",
      tenorLabel: "MAR 27",
      expiryIso: "2027-03-26",
      mid: 501.5,
      priorNetPrice: 505.8,
      spreadTicks: 10,
      collateralPerLot: 1_960,
      residualPerLot: 44.2,
      openInterestLots: 980,
      snapshotAgeSeconds: 9,
      seed: 20_063,
      qualification: "CONDITIONAL",
      qualificationNote:
        "Funding index history is shorter than the qualification floor at this tenor. Entry is allowed, position size is capped.",
      legMarks: { "eth-fwd": 4_231.9, "eth-funding": 358.2, "eth-fin": 508 },
    },
  ],
  "ARB-BS-26MAR27": [
    {
      token: "24DEC26",
      tenorLabel: "DEC 26",
      expiryIso: "2026-12-24",
      mid: 241.6,
      priorNetPrice: 218.6,
      spreadTicks: 4,
      collateralPerLot: 720,
      residualPerLot: 8.4,
      openInterestLots: 2_040,
      snapshotAgeSeconds: 8,
      seed: 30_029,
      qualification: "CONDITIONAL",
      qualificationNote:
        "Benchmark window is thinner than the qualification floor for this tenor. Entry is allowed, position size is capped.",
      legMarks: { "arb-fwd": 0.9051 },
    },
    {
      token: "25JUN27",
      tenorLabel: "JUN 27",
      expiryIso: "2027-06-25",
      mid: 322.4,
      priorNetPrice: 294.6,
      spreadTicks: 10,
      collateralPerLot: 1_180,
      residualPerLot: 17.9,
      openInterestLots: 640,
      snapshotAgeSeconds: 9,
      seed: 30_041,
      qualification: "CONDITIONAL",
      qualificationNote:
        "Benchmark window is thin and the forward book is one solver deep at this tenor. Entry is allowed, position size is capped.",
      legMarks: { "arb-fwd": 0.9215 },
    },
  ],
  "EURUSD-FW-30DEC26": [
    {
      token: "31MAR27",
      tenorLabel: "MAR 27",
      expiryIso: "2027-03-31",
      mid: 271.8,
      priorNetPrice: 264.5,
      spreadTicks: 8,
      collateralPerLot: 4_150,
      residualPerLot: 158.6,
      openInterestLots: 3_180,
      snapshotAgeSeconds: 3,
      seed: 40_031,
      qualification: "QUALIFIED",
      qualificationNote:
        "Benchmark, session calendar, and settlement asset all qualified for this tenor.",
      legMarks: { "eur-fwd": 1.09538 },
    },
    {
      token: "29SEP27",
      tenorLabel: "SEP 27",
      expiryIso: "2027-09-29",
      mid: 526.4,
      priorNetPrice: 514.9,
      spreadTicks: 12,
      collateralPerLot: 6_900,
      residualPerLot: 302.4,
      openInterestLots: 1_540,
      snapshotAgeSeconds: 5,
      seed: 40_053,
      qualification: "CONDITIONAL",
      qualificationNote:
        "The fixing calendar is published only to JUN 27, so the tail of this tenor is conditional. Entry is allowed, position size is capped.",
      legMarks: { "eur-fwd": 1.09762 },
    },
  ],
  "XAUUSD-FW-29JUN27": [
    {
      token: "30DEC26",
      tenorLabel: "DEC 26",
      expiryIso: "2026-12-30",
      mid: 14.8,
      priorNetPrice: 15.7,
      spreadTicks: 4,
      collateralPerLot: 1_240,
      residualPerLot: 17.2,
      openInterestLots: 3_460,
      snapshotAgeSeconds: 5,
      seed: 50_039,
      qualification: "QUALIFIED",
      qualificationNote: "Benchmark, calendar, and settlement asset all qualified for this tenor.",
      legMarks: { "xau-fwd": 3_385.4, "xau-fin": 468 },
    },
    {
      token: "30DEC27",
      tenorLabel: "DEC 27",
      expiryIso: "2027-12-30",
      mid: 69.25,
      priorNetPrice: 73.45,
      spreadTicks: 10,
      collateralPerLot: 5_020,
      residualPerLot: 76.4,
      openInterestLots: 860,
      snapshotAgeSeconds: 10,
      seed: 50_057,
      qualification: "CONDITIONAL",
      qualificationNote:
        "The fixing calendar is published only to JUN 27, so this tenor settles on a provisional session. Entry is allowed, position size is capped.",
      legMarks: { "xau-fwd": 3_439.85, "xau-fin": 526 },
    },
  ],
};

const SPECS: MarketSpec[] = ANCHORS.flatMap((anchor) =>
  ladder(anchor, MATURITIES[anchor.id] ?? []),
);

export const MARKETS: PackageMarket[] = SPECS.map(buildMarket);

export const DEFAULT_MARKET_ID = MARKETS[0].id;

export function findMarket(id: string): PackageMarket {
  return MARKETS.find((market) => market.id === id) ?? MARKETS[0];
}

/** Market ids are already uppercase and URL-safe, so the id is the route slug. */
export function marketSlug(market: PackageMarket): string {
  return market.id;
}

/** Product name plus tenor, which is how a desk names the package it holds. */
export function packageLabel(market: PackageMarket): string {
  return `${market.name} ${market.tenorLabel}`;
}

export function tradeHref(market: PackageMarket): string {
  return `/trade/${encodeURIComponent(marketSlug(market))}`;
}

export const DEFAULT_MARKET_SLUG = marketSlug(MARKETS[0]);

export const DEFAULT_TRADE_HREF = tradeHref(MARKETS[0]);

/**
 * Resolution is case-insensitive so a hand-typed URL still finds its market,
 * but only the canonical slug renders: the route redirects anything else.
 * A slug that matches nothing is a 404, never a fallback to another market.
 */
export function marketBySlug(slug: string): PackageMarket | null {
  const needle = slug.trim().toLowerCase();
  return MARKETS.find((market) => marketSlug(market).toLowerCase() === needle) ?? null;
}
