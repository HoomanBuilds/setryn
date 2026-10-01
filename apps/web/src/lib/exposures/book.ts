import { exposureToPackageDirection } from "@/lib/hedges/engine";
import type { HedgeDirection } from "@/lib/hedges/types";
import type { ExecutionPosition } from "@/lib/internal-gateway/types";
import type { ReferenceQuote } from "@/lib/market-data/types";
import { deltaUnits, finite, rangeTerms, referenceFor } from "@/lib/portfolio/forward";
import { daysToExpiryAt } from "@/lib/settlements/calendar";
import { platformNow } from "@/lib/terminal/clock";
import { packageLabel, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import type {
  AssetNetting,
  ExposureBook,
  ExposureCertainty,
  ExposureRecord,
  ExposureType,
  ExposureView,
  HedgeLink,
  ProtectionState,
} from "./types";

/** Opposite exposures in one asset offset each other when their dates fall within this many days. */
export const NETTING_WINDOW_DAYS = 31;

export const EXPOSURE_TYPES: { value: ExposureType; label: string; direction: HedgeDirection; hint: string }[] = [
  { value: "RECEIVABLE", label: "Receivable", direction: "RECEIVABLE", hint: "You will receive the asset" },
  { value: "PAYABLE", label: "Payable", direction: "PAYABLE", hint: "You must pay the asset" },
  { value: "INVENTORY", label: "Inventory", direction: "RECEIVABLE", hint: "You hold stock priced in the asset" },
  { value: "TREASURY", label: "Treasury", direction: "RECEIVABLE", hint: "Reserves held in the asset" },
  { value: "TOKEN_UNLOCK", label: "Token unlock", direction: "RECEIVABLE", hint: "Tokens vest to you on the date" },
  { value: "INVESTMENT", label: "Investment", direction: "RECEIVABLE", hint: "A position you intend to exit" },
  { value: "DEBT", label: "Debt", direction: "PAYABLE", hint: "You owe the asset on the date" },
];

export const TYPE_LABEL = Object.fromEntries(EXPOSURE_TYPES.map((item) => [item.value, item.label])) as Record<
  ExposureType,
  string
>;

export const CERTAINTY_LABEL: Record<ExposureCertainty, string> = {
  FORECAST: "Forecast",
  CONFIRMED: "Confirmed",
};

export const PROTECTION_LABEL: Record<ProtectionState, string> = {
  UNHEDGED: "Unhedged",
  PARTIAL: "Partial",
  PROTECTED: "Protected",
  NETTED: "Netted",
};

export function directionForType(type: ExposureType): HedgeDirection {
  return EXPOSURE_TYPES.find((item) => item.value === type)?.direction ?? "RECEIVABLE";
}

/** "EUR/USD" -> "EUR", "BTC" -> "BTC": the asset a package prices, which is what an exposure in it offsets. */
export function assetBase(underlying: string): string {
  return underlying.split("/")[0].trim().toUpperCase();
}

/** Whole days from now to an exposure date; null when the date is malformed. */
function horizonFrom(iso: string, nowMs: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round((ms - nowMs) / 86_400_000) : null;
}

/**
 * USD value a position offsets in its underlying: its delta (lots x lot size inside the payoff range, zero outside)
 * at the Chainlink reference, else at the live mark. Null while neither is known.
 */
export function protectiveNotional(
  position: Pick<ExecutionPosition, "side" | "lots">,
  market: PackageMarket,
  references?: Record<string, ReferenceQuote> | null,
): number | null {
  const reference = referenceFor(market, references);
  const level = reference?.price ?? (finite(market.netPrice) ? market.netPrice : null);
  if (level === null) return null;
  return Math.abs(deltaUnits(position.side, position.lots, rangeTerms(market), level)) * level;
}

function dayNumber(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stateFor(amount: number, netted: number, coverage: number): ProtectionState {
  if (amount <= 0) return "UNHEDGED";
  if (netted >= amount * 0.999) return "NETTED";
  if (coverage >= 0.98) return "PROTECTED";
  if (coverage > 0) return "PARTIAL";
  return "UNHEDGED";
}

interface Working {
  view: ExposureView;
  day: number;
  remaining: number;
}

interface ProtectiveLot {
  position: ExecutionPosition;
  market: PackageMarket;
  asset: string;
  sign: 1 | -1;
  notional: number;
}

export interface ExposureBookOptions {
  /** Chainlink references keyed by underlying, from `useReferencePrices()`; positions are valued at them. */
  references?: Record<string, ReferenceQuote> | null;
  /** Platform clock in milliseconds; defaults to `platformNow()`. */
  nowMs?: number;
}

/**
 * Nets same-asset exposures, then covers what is left with the connected account's positions. Netting pairs
 * opposite exposures in date order inside the window. Coverage allocates each protective position (a short forward
 * against a long exposure, a long one against a short) to the residual exposure closest to its expiry, at the USD
 * value of its delta: lots x lot size at the reference, inside the payoff range.
 */
export function buildExposureBook(
  records: readonly ExposureRecord[],
  positions: readonly ExecutionPosition[],
  markets: readonly PackageMarket[],
  options: ExposureBookOptions = {},
): ExposureBook {
  const nowMs = options.nowMs ?? platformNow();
  const working: Working[] = records.map((record) => {
    const sign: 1 | -1 = record.direction === "RECEIVABLE" ? 1 : -1;
    return {
      view: {
        record,
        sign,
        horizonDays: horizonFrom(record.exposureDateIso, nowMs),
        netted: 0,
        nettedWith: [],
        protectedAmount: 0,
        links: [],
        residual: record.amount,
        coverage: 0,
        state: "UNHEDGED",
      },
      day: dayNumber(record.exposureDateIso),
      remaining: Math.max(0, record.amount),
    };
  });

  const assets = [...new Set(records.map((record) => record.referenceAssetId))].sort();
  const byDate = (a: Working, b: Working) => a.day - b.day || a.view.record.id.localeCompare(b.view.record.id);

  for (const asset of assets) {
    const longs = working.filter((item) => item.view.record.referenceAssetId === asset && item.view.sign === 1).sort(byDate);
    const shorts = working.filter((item) => item.view.record.referenceAssetId === asset && item.view.sign === -1).sort(byDate);
    for (const long of longs) {
      for (const short of shorts) {
        if (long.remaining <= 0) break;
        if (short.remaining <= 0 || Math.abs(long.day - short.day) > NETTING_WINDOW_DAYS) continue;
        const matched = Math.min(long.remaining, short.remaining);
        long.remaining -= matched;
        short.remaining -= matched;
        long.view.netted += matched;
        short.view.netted += matched;
        long.view.nettedWith.push(short.view.record.id);
        short.view.nettedWith.push(long.view.record.id);
      }
    }
  }

  const protective: ProtectiveLot[] = [];
  for (const position of positions) {
    const market = markets.find((candidate) => candidate.id === position.marketId);
    if (!market) continue;
    const notional = protectiveNotional(position, market, options.references);
    if (notional === null) continue;
    protective.push({
      position,
      market,
      asset: assetBase(market.underlying),
      // A short forward protects a long exposure; a long forward protects a short one.
      sign: position.side === exposureToPackageDirection("RECEIVABLE") ? 1 : -1,
      notional,
    });
  }
  protective.sort((a, b) => a.market.expiryIso.localeCompare(b.market.expiryIso) || a.position.id.localeCompare(b.position.id));

  const allocatedByLot = new Map<string, number>();
  for (const lot of protective) {
    let left = lot.notional;
    const expiryDays = daysToExpiryAt(lot.market, nowMs);
    const candidates = working
      .filter((item) => item.view.record.referenceAssetId === lot.asset && item.view.sign === lot.sign && item.remaining > 0)
      .sort(
        (a, b) =>
          Math.abs((a.view.horizonDays ?? 0) - expiryDays) - Math.abs((b.view.horizonDays ?? 0) - expiryDays) || byDate(a, b),
      );
    for (const item of candidates) {
      if (left <= 0) break;
      const take = Math.min(left, item.remaining);
      left -= take;
      item.remaining -= take;
      item.view.protectedAmount += take;
      const link: HedgeLink = {
        positionId: lot.position.id,
        marketId: lot.market.id,
        label: packageLabel(lot.market),
        side: lot.position.side,
        allocated: round2(take),
        expiryIso: lot.market.expiryIso,
        tenorGapDays: Math.abs((item.view.horizonDays ?? 0) - expiryDays),
        href: tradeHref(lot.market),
      };
      item.view.links.push(link);
    }
    allocatedByLot.set(lot.position.id, lot.notional - left);
  }

  const views = working.map(({ view, remaining }) => {
    const amount = view.record.amount;
    const netted = round2(view.netted);
    const protectedAmount = round2(view.protectedAmount);
    const coverage = amount > 0 ? Math.min(1, (netted + protectedAmount) / amount) : 0;
    return {
      ...view,
      netted,
      protectedAmount,
      residual: round2(Math.max(0, remaining)),
      coverage,
      state: stateFor(amount, netted, coverage),
    };
  });

  const hedgeAssets = protective.map((lot) => lot.asset);
  const netting: AssetNetting[] = [...new Set([...assets, ...hedgeAssets])].sort().map((asset) => {
    const rows = views.filter((view) => view.record.referenceAssetId === asset);
    const long = rows.filter((view) => view.sign === 1).reduce((sum, view) => sum + view.record.amount, 0);
    const short = rows.filter((view) => view.sign === -1).reduce((sum, view) => sum + view.record.amount, 0);
    const lots = protective.filter((lot) => lot.asset === asset);
    const hedgeNotional = lots.reduce((sum, lot) => sum + lot.notional, 0);
    const hedgeAllocated = lots.reduce((sum, lot) => sum + (allocatedByLot.get(lot.position.id) ?? 0), 0);
    return {
      asset,
      count: rows.length,
      long: round2(long),
      short: round2(short),
      net: round2(long - short),
      matched: round2(rows.filter((view) => view.sign === 1).reduce((sum, view) => sum + view.netted, 0)),
      hedgeNotional: round2(hedgeNotional),
      hedgeAllocated: round2(hedgeAllocated),
      excessHedge: round2(Math.max(0, hedgeNotional - hedgeAllocated)),
      residual: round2(rows.reduce((sum, view) => sum + view.residual, 0)),
    };
  });

  const gross = views.reduce((sum, view) => sum + view.record.amount, 0);
  const netted = views.reduce((sum, view) => sum + view.netted, 0);
  const protectedAmount = views.reduce((sum, view) => sum + view.protectedAmount, 0);
  const residual = views.reduce((sum, view) => sum + view.residual, 0);
  const nextUnprotected =
    [...views]
      .filter((view) => view.residual > 0)
      .sort((a, b) => a.record.exposureDateIso.localeCompare(b.record.exposureDateIso))[0] ?? null;

  return {
    views,
    assets: netting,
    gross: round2(gross),
    netted: round2(netted),
    protectedAmount: round2(protectedAmount),
    residual: round2(residual),
    coverage: gross > 0 ? Math.min(1, (netted + protectedAmount) / gross) : 0,
    nextUnprotected,
  };
}
