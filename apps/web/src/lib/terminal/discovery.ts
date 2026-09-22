import { daysToExpiry, formatExpiry, priceUnitSuffix } from "./format";
import type {
  LiquiditySource,
  PackageMarket,
  PriceUnit,
  SettlementClass,
  StrategyKind,
} from "./types";

/**
 * Title-cases a schema enum. Every discovery label is derived this way, so a new
 * strategy kind, qualification, or source class reaches the directory without a
 * label table to update.
 */
export function enumLabel(value: string): string {
  const spaced = value.toLowerCase().replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const SETTLEMENT_SHORT: Partial<Record<SettlementClass, string>> = {
  CASH_USDC: "Cash USDC",
  CASH_USDC_NDF: "NDF USDC",
};

/** Dense column form. The market header carries the long sentence form. */
export function settlementShort(settlement: SettlementClass): string {
  return SETTLEMENT_SHORT[settlement] ?? enumLabel(settlement);
}

export const SOURCE_ORDER: LiquiditySource[] = ["DIRECT", "IMPLIED", "SOLVER_FIRM"];

/** Executable rows only, so an indicative quote never advertises a capability. */
export function sourceClasses(market: PackageMarket): LiquiditySource[] {
  const present = new Set(market.book.filter((row) => row.executable).map((row) => row.source));
  return SOURCE_ORDER.filter((source) => present.has(source));
}

export function spreadOf(market: PackageMarket): number {
  return market.bestAsk - market.bestBid;
}

export interface ExpiryBucket {
  id: string;
  label: string;
  holds: (days: number) => boolean;
}

export const EXPIRY_BUCKETS: ExpiryBucket[] = [
  { id: "within-30d", label: "Within 30d", holds: (days) => days <= 30 },
  { id: "30d-90d", label: "30d to 90d", holds: (days) => days > 30 && days <= 90 },
  { id: "90d-1y", label: "90d to 1y", holds: (days) => days > 90 && days <= 365 },
  { id: "beyond-1y", label: "Beyond 1y", holds: (days) => days > 365 },
];

export function expiryBucketOf(market: PackageMarket): ExpiryBucket {
  const days = daysToExpiry(market.expiryIso);
  return EXPIRY_BUCKETS.find((bucket) => bucket.holds(days)) ?? EXPIRY_BUCKETS[0];
}

/** Every field the global search accepts, flattened once per market. */
function searchText(market: PackageMarket): string {
  return [
    market.name,
    market.code,
    market.id,
    market.underlying,
    market.strategyLabel,
    enumLabel(market.strategyKind),
    market.tenorLabel,
    formatExpiry(market.expiryIso),
    settlementShort(market.settlementClass),
    market.settlementAsset,
    market.fixingSource,
    enumLabel(market.qualification),
    priceUnitSuffix(market.priceUnit),
    sourceClasses(market).map(enumLabel).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

export const ANY = "ANY";

export interface DirectoryFilters {
  query: string;
  underlying: string;
  strategy: string;
  expiry: string;
  qualification: string;
  source: string;
}

export const EMPTY_FILTERS: DirectoryFilters = {
  query: "",
  underlying: ANY,
  strategy: ANY,
  expiry: ANY,
  qualification: ANY,
  source: ANY,
};

export function filtersActive(filters: DirectoryFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.underlying !== ANY ||
    filters.strategy !== ANY ||
    filters.expiry !== ANY ||
    filters.qualification !== ANY ||
    filters.source !== ANY
  );
}

/** Tokens combine, so "btc dec 26" narrows instead of widening. */
export function applyFilters(markets: PackageMarket[], filters: DirectoryFilters): PackageMarket[] {
  const tokens = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return markets.filter((market) => {
    if (filters.underlying !== ANY && market.underlying !== filters.underlying) return false;
    if (filters.strategy !== ANY && market.strategyKind !== filters.strategy) return false;
    if (filters.expiry !== ANY && expiryBucketOf(market).id !== filters.expiry) return false;
    if (filters.qualification !== ANY && market.qualification !== filters.qualification) {
      return false;
    }
    if (
      filters.source !== ANY &&
      !sourceClasses(market).includes(filters.source as LiquiditySource)
    ) {
      return false;
    }
    if (tokens.length === 0) return true;
    const haystack = searchText(market);
    return tokens.every((token) => haystack.includes(token));
  });
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

function tally(
  markets: PackageMarket[],
  pick: (market: PackageMarket) => { value: string; label: string }[],
): Map<string, FilterOption> {
  const options = new Map<string, FilterOption>();
  markets.forEach((market) => {
    pick(market).forEach(({ value, label }) => {
      const found = options.get(value);
      if (found) found.count += 1;
      else options.set(value, { value, label, count: 1 });
    });
  });
  return options;
}

function alphabetical(options: Map<string, FilterOption>): FilterOption[] {
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function underlyingOptions(markets: PackageMarket[]): FilterOption[] {
  return alphabetical(
    tally(markets, (market) => [{ value: market.underlying, label: market.underlying }]),
  );
}

export function strategyOptions(markets: PackageMarket[]): FilterOption[] {
  return alphabetical(
    tally(markets, (market) => [
      { value: market.strategyKind, label: enumLabel(market.strategyKind) },
    ]),
  );
}

export function qualificationOptions(markets: PackageMarket[]): FilterOption[] {
  return alphabetical(
    tally(markets, (market) => [
      { value: market.qualification, label: enumLabel(market.qualification) },
    ]),
  );
}

/** Kept in maturity order rather than alphabetical order, and empty buckets drop out. */
export function expiryOptions(markets: PackageMarket[]): FilterOption[] {
  const counted = tally(markets, (market) => {
    const bucket = expiryBucketOf(market);
    return [{ value: bucket.id, label: bucket.label }];
  });
  return EXPIRY_BUCKETS.map((bucket) => counted.get(bucket.id)).filter(
    (option): option is FilterOption => option !== undefined,
  );
}

export function sourceOptions(markets: PackageMarket[]): FilterOption[] {
  const counted = tally(markets, (market) =>
    sourceClasses(market).map((source) => ({ value: source, label: enumLabel(source) })),
  );
  return SOURCE_ORDER.map((source) => counted.get(source)).filter(
    (option): option is FilterOption => option !== undefined,
  );
}

export interface UnderlyingGroup {
  underlying: string;
  markets: PackageMarket[];
}

/** Ladder order: underlying, then maturity, so the grouping reads as a term ladder. */
export function groupByUnderlying(markets: PackageMarket[]): UnderlyingGroup[] {
  const groups = new Map<string, PackageMarket[]>();
  markets.forEach((market) => {
    const bucket = groups.get(market.underlying);
    if (bucket) bucket.push(market);
    else groups.set(market.underlying, [market]);
  });
  return [...groups.entries()]
    .map(([underlying, members]) => ({
      underlying,
      markets: [...members].sort((a, b) => daysToExpiry(a.expiryIso) - daysToExpiry(b.expiryIso)),
    }))
    .sort((a, b) => a.underlying.localeCompare(b.underlying));
}

export interface CurveFamily {
  key: string;
  /** Product name, which is the family read back: every member shares it. */
  label: string;
  underlying: string;
  strategyKind: StrategyKind;
  priceUnit: PriceUnit;
  settlementClass: SettlementClass;
  markets: PackageMarket[];
}

/**
 * Sharing a quote unit does not make a term structure. A curve may only join
 * maturities of one underlying, one strategy kind, one price unit, and one
 * settlement class, so a line is never drawn across unrelated risk.
 */
export function curveFamilyKey(market: PackageMarket): string {
  return [market.underlying, market.strategyKind, market.priceUnit, market.settlementClass].join(
    "|",
  );
}

/** One group per family, each sorted by maturity, so a panel plots a real curve. */
export function groupByCurveFamily(markets: PackageMarket[]): CurveFamily[] {
  const groups = new Map<string, PackageMarket[]>();
  markets.forEach((market) => {
    const key = curveFamilyKey(market);
    const bucket = groups.get(key);
    if (bucket) bucket.push(market);
    else groups.set(key, [market]);
  });

  return [...groups.entries()]
    .map(([key, members]) => {
      const ordered = [...members].sort(
        (a, b) => daysToExpiry(a.expiryIso) - daysToExpiry(b.expiryIso),
      );
      const head = ordered[0];
      return {
        key,
        label: head.name,
        underlying: head.underlying,
        strategyKind: head.strategyKind,
        priceUnit: head.priceUnit,
        settlementClass: head.settlementClass,
        markets: ordered,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function observationRange(markets: PackageMarket[]): { min: number; max: number } {
  const ages = markets.map((market) => market.snapshotAgeSeconds);
  return { min: Math.min(...ages), max: Math.max(...ages) };
}

export interface DirectorySummary {
  firmDepthLots: number;
  openInterestLots: number;
  qualification: FilterOption[];
  sources: LiquiditySource[];
}

/** Aggregate of whatever survived the filters, for the directory footer. */
export function summarize(markets: PackageMarket[]): DirectorySummary {
  const sources = new Set<LiquiditySource>();
  markets.forEach((market) => sourceClasses(market).forEach((source) => sources.add(source)));
  return {
    firmDepthLots: markets.reduce((sum, market) => sum + market.firmDepthLots, 0),
    openInterestLots: markets.reduce((sum, market) => sum + market.openInterestLots, 0),
    qualification: qualificationOptions(markets),
    sources: SOURCE_ORDER.filter((source) => sources.has(source)),
  };
}
