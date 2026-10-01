import type { ExecutionPosition } from "@/lib/internal-gateway/types";
import { clampToRange, deltaPerLot, collateralPerLot, rangeTerms } from "@/lib/strategies/range";
import { platformNow } from "@/lib/terminal/clock";
import { MARKETS, marketSlug, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket, Qualification } from "@/lib/terminal/types";
import type {
  ExposureInput,
  ExposureValidation,
  HandoffLinks,
  HedgeCandidate,
  HedgeDirection,
  PackageDirection,
  PortfolioExposure,
  ReferenceAsset,
  RiskObjective,
  ScenarioRow,
  SettlementAsset,
} from "./types";

/*
 * Hedge sizing against the listed range forwards. An exposure in USDC converts to underlying units at the live Chainlink
 * reference; one long lot is `lotSize` units of the underlying between the market's floor and cap, so the hedge is
 * `units / lotSize` lots on the opposite side. Prices are the market's resting touch (else its mark, labelled), and every
 * outcome is the contract's own payoff at a fixing. Nothing here is a stand-in number.
 */

/** Reference assets: one per listed underlying, from the deployment's catalog. */
export const REFERENCE_ASSETS: ReferenceAsset[] = [...new Set(MARKETS.map((market) => market.underlying))].map((underlying) => {
  const base = underlying.split("/")[0];
  return { id: base, label: base === "XAU" ? "XAU / Gold" : base, matchTokens: [base] };
});

export const SETTLEMENT_ASSETS: SettlementAsset[] = [{ id: "USDC", label: "USDC" }];

export const RISK_OBJECTIVES: { value: RiskObjective; label: string; hint: string }[] = [
  { value: "LOCK_RATE", label: "Lock rate", hint: "Prefer resting liquidity and the closest expiry" },
  { value: "BALANCED", label: "Balanced", hint: "Tenor fit first, then liquidity" },
  { value: "LOW_COLLATERAL", label: "Low collateral", hint: "Prefer the smallest collateral at entry" },
];

const MAX_EXPOSURE_ISO = "2028-12-31";
const MAX_AMOUNT = 100_000_000;
const DAY_MS = 86_400_000;

export function referenceAssetById(id: string): ReferenceAsset | undefined {
  return REFERENCE_ASSETS.find((asset) => asset.id === id);
}

export function exposureToPackageDirection(direction: HedgeDirection): PackageDirection {
  // Receivable: will receive foreign value, fears a fall -> sell forward -> SHORT package.
  // Payable: must pay foreign value, fears a rise -> buy forward -> LONG package.
  return direction === "RECEIVABLE" ? "SHORT" : "LONG";
}

function parseDateMs(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days from the platform clock to the cash-flow date. */
export function horizonDays(exposureDateIso: string, nowMs = platformNow()): number | null {
  const ms = parseDateMs(exposureDateIso);
  if (ms === null) return null;
  return Math.round((ms - nowMs) / DAY_MS);
}

export function validateExposure(input: ExposureInput, nowMs = platformNow()): ExposureValidation {
  const reasons: string[] = [];
  if (!referenceAssetById(input.referenceAssetId)) reasons.push("Select a reference asset.");
  if (!SETTLEMENT_ASSETS.some((asset) => asset.id === input.settlementAssetId)) reasons.push("Select a settlement asset.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    reasons.push("Enter an exposure amount above zero.");
  } else if (input.amount > MAX_AMOUNT) {
    reasons.push("Amount exceeds the 100M sizing limit.");
  }
  const ms = parseDateMs(input.exposureDateIso);
  if (ms === null) {
    reasons.push("Enter a valid cash-flow date (YYYY-MM-DD).");
  } else {
    if (Math.round((ms - nowMs) / DAY_MS) < 1) reasons.push(`Cash-flow date must be after ${new Date(nowMs).toISOString().slice(0, 10)}.`);
    if (input.exposureDateIso > MAX_EXPOSURE_ISO) reasons.push("Cash-flow date must be on or before 31 Dec 2028.");
  }
  return { valid: reasons.length === 0, reasons };
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Lots that carry `units` of the underlying: at least one, rounded to the nearest lot. */
export function lotsForUnits(market: PackageMarket, units: number): number {
  const lotSize = Number.isFinite(market.lotSize) && market.lotSize > 0 ? market.lotSize : market.contractMultiplier;
  if (!Number.isFinite(units) || units <= 0 || !(lotSize > 0)) return 1;
  return Math.min(1_000_000, Math.max(1, Math.round(units / lotSize)));
}

/** Lots for a USDC exposure at the live reference; null without a reference. */
export function lotsFor(market: PackageMarket, amount: number): number | null {
  const reference = finite(market.referencePrice);
  if (reference === null || reference <= 0) return null;
  return lotsForUnits(market, amount / reference);
}

function expiryDays(market: PackageMarket, nowMs: number): number {
  return Number.isFinite(market.expiryAt) ? Math.max(0, Math.round((market.expiryAt * 1000 - nowMs) / DAY_MS)) : 0;
}

function qualificationRank(qualification: Qualification): number {
  if (qualification === "QUALIFIED") return 0;
  if (qualification === "CONDITIONAL") return 1;
  return 2;
}

/** The package's result in USDC at a reference move of `movePct`, for the candidate's side and size. */
export function packageValueAt(candidate: HedgeCandidate, movePct: number): number {
  if (!candidate.terms || candidate.reference === null || !Number.isFinite(candidate.forwardLevel)) return 0;
  const fixing = candidate.reference * (1 + movePct / 100);
  const sign = candidate.packageDirection === "LONG" ? 1 : -1;
  return sign * candidate.lots * candidate.terms.lotSize * (clampToRange(candidate.terms, fixing) - candidate.forwardLevel);
}

/** The bare cash flow's change in USDC at a reference move of `movePct`. */
export function unhedgedValueAt(exposure: ExposureInput, movePct: number): number {
  const move = movePct / 100;
  return exposure.direction === "RECEIVABLE" ? exposure.amount * move : -exposure.amount * move;
}

export function rankCandidates(exposure: ExposureInput, markets: readonly PackageMarket[] = MARKETS, limit = 3, nowMs = platformNow()): HedgeCandidate[] {
  const validation = validateExposure(exposure, nowMs);
  if (!validation.valid) return [];
  const horizon = horizonDays(exposure.exposureDateIso, nowMs) ?? 0;
  const asset = referenceAssetById(exposure.referenceAssetId);
  const packageDirection = exposureToPackageDirection(exposure.direction);

  const scored = markets
    .filter((market) => market.seriesStatus !== "EXPIRED" && (!Number.isFinite(market.lastTradingAt) || market.lastTradingAt * 1000 > nowMs))
    .map((market) => {
      const assetMatch = asset !== undefined && asset.matchTokens.some((token) => market.underlying.includes(token));
      const terms = rangeTerms(market);
      const reference = finite(market.referencePrice);
      const units = reference !== null && reference > 0 ? exposure.amount / reference : null;
      const lots = units !== null ? lotsForUnits(market, units) : 1;
      const touch = packageDirection === "LONG" ? market.bestAsk : market.bestBid;
      const forwardSource: HedgeCandidate["forwardSource"] = Number.isFinite(touch) ? "TOUCH" : Number.isFinite(market.netPrice) ? "MARK" : "NONE";
      const forwardLevel = forwardSource === "TOUCH" ? touch : forwardSource === "MARK" ? market.netPrice : Number.NaN;
      const collateral = terms && Number.isFinite(forwardLevel) ? lots * collateralPerLot(terms, forwardLevel, packageDirection) : lots * market.collateralPerLot;
      const lotSize = terms?.lotSize ?? market.contractMultiplier;
      const covered = reference !== null ? lots * lotSize * reference : Number.NaN;
      const tenorGap = Math.abs(expiryDays(market, nowMs) - horizon);
      let score = tenorGap + (assetMatch ? 0 : 10_000) + qualificationRank(market.qualification) * 30;
      if (exposure.riskObjective === "LOCK_RATE") score += forwardSource === "TOUCH" ? 0 : 40;
      else if (exposure.riskObjective === "LOW_COLLATERAL") score += (collateral / Math.max(1, exposure.amount)) * 100;
      else score += forwardSource === "TOUCH" ? 0 : 10;
      const maxOrderLots = market.maxOrderLots ?? lots;
      return {
        market,
        terms,
        assetMatch,
        packageDirection,
        lots,
        exposureUnits: units,
        reference,
        notionalCovered: covered,
        coverageRatio: Number.isFinite(covered) && exposure.amount > 0 ? covered / exposure.amount : 0,
        tenorGapDays: tenorGap,
        horizonDays: horizon,
        executablePrice: touch,
        executablePriceProvenance: Number.isFinite(touch) ? ("EXECUTABLE" as const) : ("UNAVAILABLE" as const),
        forwardLevel,
        forwardSource,
        collateralEstimate: Math.round(collateral * 100) / 100,
        collateralProvenance: "COMPUTED" as const,
        ordersNeeded: maxOrderLots > 0 ? Math.ceil(lots / maxOrderLots) : 1,
        qualification: market.qualification,
        settlementClass: market.settlementClass,
        score,
      };
    });

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

const SCENARIO_MOVES = [-20, -10, 0, 10, 20];

export function scenarioFor(candidate: HedgeCandidate, exposure: ExposureInput): ScenarioRow[] {
  return SCENARIO_MOVES.map((movePct) => {
    const unhedged = unhedgedValueAt(exposure, movePct);
    const pkg = packageValueAt(candidate, movePct);
    return {
      movePct,
      unhedged: Math.round(unhedged * 100) / 100,
      packageModeled: Math.round(pkg * 100) / 100,
      netModeled: Math.round((unhedged + pkg) * 100) / 100,
    };
  });
}

export function stableExposureId(exposure: ExposureInput): string {
  const raw = `${exposure.direction}:${exposure.referenceAssetId}:${exposure.settlementAssetId}:${exposure.amount}:${exposure.exposureDateIso}:${exposure.riskObjective}`;
  let hash = 2_166_136_261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return `EXP-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

export function studioHref(candidate: HedgeCandidate, exposure: ExposureInput): string {
  const params = new URLSearchParams({
    market: candidate.market.id,
    direction: candidate.packageDirection.toLowerCase(),
    lots: String(candidate.lots),
    source: "hedges",
    exposure: stableExposureId(exposure),
  });
  return `/strategies?${params.toString()}`;
}

export function tradeHrefFor(candidate: HedgeCandidate, exposure: ExposureInput): string {
  const params = new URLSearchParams({
    direction: candidate.packageDirection.toLowerCase(),
    lots: String(candidate.lots),
    source: "hedges",
    exposure: stableExposureId(exposure),
  });
  return `${tradeHref(candidate.market)}?${params.toString()}`;
}

export function handoffFor(candidate: HedgeCandidate | null, exposure: ExposureInput, validation: ExposureValidation): HandoffLinks | null {
  if (!candidate) return null;
  const studio = studioHref(candidate, exposure);
  if (!validation.valid) return { studioHref: studio, tradeHref: null, tradeBlockedReason: validation.reasons[0] ?? "Resolve exposure inputs." };
  if (!candidate.assetMatch) return { studioHref: studio, tradeHref: null, tradeBlockedReason: "No listed market matches this reference asset." };
  if (candidate.qualification === "SUSPENDED") return { studioHref: studio, tradeHref: null, tradeBlockedReason: "The series is not taking orders. Review only." };
  if (candidate.reference === null) return { studioHref: studio, tradeHref: null, tradeBlockedReason: "No reference price yet, so the hedge cannot be sized." };
  return { studioHref: studio, tradeHref: tradeHrefFor(candidate, exposure), tradeBlockedReason: null };
}

export function marketSlugFor(market: PackageMarket): string {
  return marketSlug(market);
}

/* ------------------------------------------------------------------ */
/* Portfolio exposure                                                  */
/* ------------------------------------------------------------------ */

/**
 * The account's net delta per underlying from its positions: each long lot is +lotSize units while the reference sits
 * inside its range, each short lot the negative; outside the range a position carries no delta. The offset is the
 * nearest-expiry listed market still trading, on the opposite side, sized to the nearest lot.
 */
export function portfolioExposures(positions: readonly ExecutionPosition[], markets: readonly PackageMarket[], nowMs = platformNow()): PortfolioExposure[] {
  const byId = new Map(markets.map((market) => [market.id, market]));
  const groups = new Map<string, PortfolioExposure>();
  for (const position of positions) {
    const market = byId.get(position.marketId);
    if (!market) continue;
    const terms = rangeTerms(market);
    const reference = finite(market.referencePrice);
    const entry =
      groups.get(market.underlying) ??
      {
        underlying: market.underlying,
        referenceAssetId: referenceAssetById(market.underlying.split("/")[0])?.id ?? null,
        reference,
        delta: 0,
        deltaUsd: null,
        positions: 0,
        outsideRange: 0,
        nearestExpiryAt: null,
        offset: null,
      };
    entry.positions += 1;
    if (Number.isFinite(market.expiryAt)) entry.nearestExpiryAt = entry.nearestExpiryAt === null ? market.expiryAt : Math.min(entry.nearestExpiryAt, market.expiryAt);
    if (terms && reference !== null) {
      const perLot = deltaPerLot(terms, reference);
      if (perLot === 0) entry.outsideRange += 1;
      entry.delta += (position.side === "LONG" ? 1 : -1) * position.lots * perLot;
    }
    groups.set(market.underlying, entry);
  }
  for (const entry of groups.values()) {
    entry.deltaUsd = entry.reference !== null ? entry.delta * entry.reference : null;
    if (entry.delta === 0) continue;
    const target = markets
      .filter(
        (market) =>
          market.underlying === entry.underlying &&
          market.seriesStatus !== "EXPIRED" &&
          (!Number.isFinite(market.lastTradingAt) || market.lastTradingAt * 1000 > nowMs),
      )
      .sort((left, right) => left.expiryAt - right.expiryAt)[0];
    if (target) {
      entry.offset = {
        market: target,
        direction: entry.delta > 0 ? "SHORT" : "LONG",
        lots: lotsForUnits(target, Math.abs(entry.delta)),
      };
    }
  }
  return [...groups.values()].sort((left, right) => Math.abs(right.deltaUsd ?? 0) - Math.abs(left.deltaUsd ?? 0));
}
