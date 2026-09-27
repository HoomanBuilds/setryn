import { daysToExpiry, SCENARIO_CLOCK_ISO } from "@/lib/terminal/format";
import { MARKETS, marketSlug, tradeHref } from "@/lib/terminal/markets";
import type { PackageMarket, Qualification } from "@/lib/terminal/types";
import type {
  ExposureInput,
  ExposureValidation,
  HandoffLinks,
  HedgeCandidate,
  HedgeDirection,
  PackageDirection,
  ReferenceAsset,
  RiskObjective,
  ScenarioRow,
  SettlementAsset,
} from "./types";

export const REFERENCE_ASSETS: ReferenceAsset[] = [
  { id: "BTC", label: "BTC", matchTokens: ["BTC"] },
  { id: "ETH", label: "ETH", matchTokens: ["ETH"] },
  { id: "ARB", label: "ARB", matchTokens: ["ARB"] },
  { id: "EUR", label: "EUR", matchTokens: ["EUR"] },
  { id: "XAU", label: "XAU / Gold", matchTokens: ["XAU"] },
  { id: "USD", label: "USD", matchTokens: ["USD"] },
];

export const SETTLEMENT_ASSETS: SettlementAsset[] = [{ id: "USDC", label: "USDC" }];

export const RISK_OBJECTIVES: { value: RiskObjective; label: string; hint: string }[] = [
  { value: "LOCK_RATE", label: "Lock rate", hint: "Prefer qualified, atomic completion" },
  { value: "BALANCED", label: "Balanced", hint: "Tenor fit first, then qualification" },
  { value: "LOW_COLLATERAL", label: "Low collateral", hint: "Prefer smallest collateral estimate" },
];

export const HEDGE_SOURCE_LABEL = "Arbitrum Sepolia preview fixture";
export const HEDGE_ENV_LABEL = "Local simulation — mainnet writes disabled";

const SCENARIO_CLOCK_MS = Date.parse(SCENARIO_CLOCK_ISO);
const MAX_EXPOSURE_ISO = "2028-12-31";
const MAX_AMOUNT = 100_000_000;

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

export function horizonDays(exposureDateIso: string): number | null {
  const ms = parseDateMs(exposureDateIso);
  if (ms === null) return null;
  return Math.round((ms - SCENARIO_CLOCK_MS) / 86_400_000);
}

export function validateExposure(input: ExposureInput): ExposureValidation {
  const reasons: string[] = [];

  if (!referenceAssetById(input.referenceAssetId)) {
    reasons.push("Select a reference asset.");
  }
  if (!SETTLEMENT_ASSETS.some((asset) => asset.id === input.settlementAssetId)) {
    reasons.push("Select a settlement asset.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    reasons.push("Enter an exposure amount above zero.");
  } else if (input.amount > MAX_AMOUNT) {
    reasons.push("Amount exceeds the 100M preview cap.");
  }

  const ms = parseDateMs(input.exposureDateIso);
  if (ms === null) {
    reasons.push("Enter a valid cash-flow date (YYYY-MM-DD).");
  } else {
    const horizon = Math.round((ms - SCENARIO_CLOCK_MS) / 86_400_000);
    if (horizon < 1) reasons.push("Cash-flow date must be after 22 Sep 2026.");
    if (input.exposureDateIso > MAX_EXPOSURE_ISO) reasons.push("Cash-flow date must be on or before 31 Dec 2028.");
  }

  return { valid: reasons.length === 0, reasons };
}

export function lotsFor(market: PackageMarket, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 1;
  return Math.min(10_000, Math.max(1, Math.ceil(amount / market.notionalPerLot)));
}

function qualificationRank(qualification: Qualification): number {
  if (qualification === "QUALIFIED") return 0;
  if (qualification === "CONDITIONAL") return 1;
  return 2;
}

function valueAtMove(market: PackageMarket, move: number): number {
  let closest = market.payoff[0];
  for (const point of market.payoff) {
    if (Math.abs(point.move - move) < Math.abs(closest.move - move)) closest = point;
  }
  return closest.value;
}

function scoreCandidate(
  market: PackageMarket,
  exposure: ExposureInput,
  horizon: number,
  assetMatch: boolean,
): number {
  const tenorGap = Math.abs(daysToExpiry(market.expiryIso) - horizon);
  let score = tenorGap;
  if (!assetMatch) score += 10_000;
  score += qualificationRank(market.qualification) * 30;
  if (exposure.riskObjective === "LOCK_RATE") {
    const atomic = market.routes.some((route) => route.guarantee === "PACKAGE_ATOMIC");
    score += atomic ? 0 : 25;
    score += market.residualPerLot * lotsFor(market, exposure.amount) * 0.002;
  } else if (exposure.riskObjective === "LOW_COLLATERAL") {
    score += market.collateralPerLot * lotsFor(market, exposure.amount) * 0.004;
  } else {
    score += market.collateralPerLot * lotsFor(market, exposure.amount) * 0.001;
  }
  return score;
}

export function rankCandidates(
  exposure: ExposureInput,
  markets: PackageMarket[] = MARKETS,
  limit = 3,
): HedgeCandidate[] {
  const validation = validateExposure(exposure);
  if (!validation.valid) return [];
  const horizon = horizonDays(exposure.exposureDateIso) ?? 0;
  const reference = referenceAssetById(exposure.referenceAssetId);
  const packageDirection = exposureToPackageDirection(exposure.direction);

  const scored = markets.map((market) => {
    const assetMatch =
      reference !== undefined &&
      reference.matchTokens.some((token) => market.underlying.includes(token));
    const lots = lotsFor(market, exposure.amount);
    const tenorGap = Math.abs(daysToExpiry(market.expiryIso) - horizon);
    const executablePrice =
      packageDirection === "LONG" ? market.bestAsk : market.bestBid;
    return {
      market,
      assetMatch,
      lots,
      tenorGap,
      executablePrice,
      score: scoreCandidate(market, exposure, horizon, assetMatch),
    };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((entry, index) => ({
    market: entry.market,
    rank: index + 1,
    assetMatch: entry.assetMatch,
    packageDirection,
    lots: entry.lots,
    notionalCovered: entry.lots * entry.market.notionalPerLot,
    coverageRatio:
      exposure.amount > 0 ? (entry.lots * entry.market.notionalPerLot) / exposure.amount : 0,
    tenorGapDays: entry.tenorGap,
    horizonDays: horizon,
    executablePrice: entry.executablePrice,
    executablePriceProvenance: "EXECUTABLE" as const,
    collateralEstimate: Math.round(entry.lots * entry.market.collateralPerLot),
    collateralProvenance: "MODELED" as const,
    residualEstimate:
      Math.round(entry.lots * entry.market.residualPerLot * 100) / 100,
    residualProvenance: "MODELED" as const,
    qualification: entry.market.qualification,
    settlementClass: entry.market.settlementClass,
    score: entry.score,
  }));
}

const SCENARIO_MOVES = [-20, -10, 0, 10, 20];

export function scenarioFor(candidate: HedgeCandidate, exposure: ExposureInput): ScenarioRow[] {
  const sign = candidate.packageDirection === "LONG" ? 1 : -1;
  return SCENARIO_MOVES.map((movePct) => {
    const moveFrac = movePct / 100;
    const unhedged =
      exposure.direction === "RECEIVABLE"
        ? exposure.amount * moveFrac
        : -exposure.amount * moveFrac;
    const packageModeled = valueAtMove(candidate.market, movePct) * candidate.lots * sign;
    return {
      movePct,
      unhedged: Math.round(unhedged * 100) / 100,
      packageModeled: Math.round(packageModeled * 100) / 100,
      netModeled: Math.round((unhedged + packageModeled) * 100) / 100,
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

export function tradeHrefFor(
  candidate: HedgeCandidate,
  exposure: ExposureInput,
): string {
  const params = new URLSearchParams({
    studio: "template",
    direction: candidate.packageDirection.toLowerCase(),
    lots: String(candidate.lots),
    source: "hedges",
    exposure: stableExposureId(exposure),
  });
  return `${tradeHref(candidate.market)}?${params.toString()}`;
}

export function handoffFor(
  candidate: HedgeCandidate | null,
  exposure: ExposureInput,
  validation: ExposureValidation,
): HandoffLinks | null {
  if (!candidate) return null;
  if (!validation.valid) {
    return {
      studioHref: studioHref(candidate, exposure),
      tradeHref: null,
      tradeBlockedReason: validation.reasons[0] ?? "Resolve exposure inputs.",
    };
  }
  if (!candidate.assetMatch) {
    return {
      studioHref: studioHref(candidate, exposure),
      tradeHref: null,
      tradeBlockedReason: "No listed market matches this reference asset.",
    };
  }
  if (candidate.market.qualification === "SUSPENDED") {
    return {
      studioHref: studioHref(candidate, exposure),
      tradeHref: null,
      tradeBlockedReason: "Market is suspended. Review only.",
    };
  }
  return {
    studioHref: studioHref(candidate, exposure),
    tradeHref: tradeHrefFor(candidate, exposure),
    tradeBlockedReason: null,
  };
}

export function marketSlugFor(market: PackageMarket): string {
  return marketSlug(market);
}
