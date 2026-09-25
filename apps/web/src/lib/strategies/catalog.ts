import { findMarket, MARKETS } from "@/lib/terminal/markets";
import type { PackageLeg, PackageMarket, Qualification } from "@/lib/terminal/types";
import type {
  CompiledDraftLeg,
  CompiledPackageDraft,
  DraftLeg,
  InstrumentOption,
  PackageDraft,
} from "./types";

const FAMILY_ORDER: Record<PackageLeg["family"], number> = {
  FORWARD: 0,
  BASIS: 1,
  FUNDING: 2,
  FINANCING: 3,
  SPOT_REF: 4,
};

function inferredAsset(instrument: string, market: PackageMarket): string {
  return instrument.split(" ")[0] || market.underlying;
}

/** The graph catalog is derived from the same listed fixture that powers trade. */
export function instrumentCatalog(markets: PackageMarket[] = MARKETS): InstrumentOption[] {
  const options = new Map<string, InstrumentOption>();

  for (const market of markets) {
    for (const leg of market.legs) {
      const id = `${market.id}:${leg.id}`;
      options.set(id, {
        id,
        instrument: leg.instrument,
        asset: inferredAsset(leg.instrument, market),
        family: leg.family,
        venueClass: leg.venueClass,
        mark: leg.mark,
        markUnit: leg.markUnit,
        deltaPerLot: leg.deltaPerLot,
        qualification: leg.qualification,
        settlementClass: market.settlementClass,
        sourceMarketId: market.id,
      });
    }
  }

  return [...options.values()].sort((a, b) =>
    `${a.settlementClass}:${a.asset}:${a.family}:${a.instrument}`.localeCompare(
      `${b.settlementClass}:${b.asset}:${b.family}:${b.instrument}`,
    ),
  );
}

export function draftFromMarket(market: PackageMarket): DraftLeg[] {
  return market.legs.map((leg, index) => ({
    id: `${market.id}-${leg.id}-${index}`,
    instrumentId: `${market.id}:${leg.id}`,
    side: leg.side,
    ratio: leg.ratio,
  }));
}

function qualificationFor(legs: CompiledDraftLeg[]): Qualification {
  if (legs.some((leg) => leg.instrument.qualification === "SUSPENDED")) return "SUSPENDED";
  if (legs.some((leg) => leg.instrument.qualification === "CONDITIONAL")) return "CONDITIONAL";
  return "QUALIFIED";
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function canonicalLegs(draft: PackageDraft, options: Map<string, InstrumentOption>): CompiledDraftLeg[] {
  return draft.legs
    .map((leg) => ({ ...leg, instrument: options.get(leg.instrumentId) }))
    .filter(
      (leg): leg is DraftLeg & { instrument: InstrumentOption } =>
        leg.instrument !== undefined && Number.isFinite(leg.ratio) && leg.ratio > 0,
    )
    .sort((a, b) => {
      const family = FAMILY_ORDER[a.instrument.family] - FAMILY_ORDER[b.instrument.family];
      if (family !== 0) return family;
      const instrument = a.instrument.instrument.localeCompare(b.instrument.instrument);
      if (instrument !== 0) return instrument;
      return a.side.localeCompare(b.side);
    })
    .map((leg, canonicalIndex) => ({ ...leg, canonicalIndex }));
}

function marketMatch(legs: CompiledDraftLeg[], markets: PackageMarket[]): PackageMarket | null {
  return (
    markets.find((market) => {
      if (market.legs.length !== legs.length) return false;
      const expected = [...market.legs]
        .map((leg) => `${leg.instrument}|${leg.side}|${leg.ratio.toFixed(4)}`)
        .sort()
        .join(";");
      const actual = legs
        .map((leg) => `${leg.instrument.instrument}|${leg.side}|${leg.ratio.toFixed(4)}`)
        .sort()
        .join(";");
      return expected === actual;
    }) ?? null
  );
}

function graphScale(legs: CompiledDraftLeg[], market: PackageMarket): number {
  const baseline = market.legs.reduce((total, leg) => total + leg.ratio, 0);
  const actual = legs.reduce((total, leg) => total + leg.ratio, 0);
  return baseline > 0 ? Math.max(0.25, actual / baseline) : 1;
}

function guaranteeFor(match: PackageMarket | null, qualification: Qualification) {
  if (!match || qualification === "SUSPENDED") return "SOLVER_BONDED" as const;
  return match.routes.some((route) => route.guarantee === "PACKAGE_ATOMIC")
    ? ("PACKAGE_ATOMIC" as const)
    : ("SOLVER_BONDED" as const);
}

export function compilePackageDraft(
  draft: PackageDraft,
  markets: PackageMarket[] = MARKETS,
): CompiledPackageDraft {
  const market = findMarket(draft.marketId);
  const catalog = instrumentCatalog(markets);
  const options = new Map(catalog.map((instrument) => [instrument.id, instrument]));
  const legs = canonicalLegs(draft, options);
  const settlementClass = market.settlementClass;
  const validation: string[] = [];
  const qualification = qualificationFor(legs);
  const nonPricingLegs = legs.filter(
    (leg) => leg.instrument.family !== "FINANCING" && leg.instrument.family !== "SPOT_REF",
  );
  const duplicateInstruments = new Set<string>();
  const hasDuplicate = legs.some((leg) => {
    const key = `${leg.instrumentId}:${leg.side}`;
    if (duplicateInstruments.has(key)) return true;
    duplicateInstruments.add(key);
    return false;
  });

  if (legs.length < 2) validation.push("Add at least two typed legs to construct a package.");
  if (legs.length > 6) validation.push("A package is capped at six legs in this preview environment.");
  if (nonPricingLegs.length === 0) validation.push("Add a forward, basis, or funding leg to define price risk.");
  if (hasDuplicate) validation.push("Each instrument and side may appear once in a canonical package.");
  if (legs.some((leg) => leg.instrument.settlementClass !== settlementClass)) {
    validation.push("All legs must share the selected market's settlement class.");
  }
  if (qualification === "SUSPENDED") {
    validation.push("A suspended component cannot be compiled into an execution request.");
  }

  const match = validation.length === 0 ? marketMatch(legs, markets) : null;
  const scale = graphScale(legs, market);
  const netDelta = legs.reduce(
    (total, leg) =>
      total +
      (leg.side === "BUY" ? 1 : -1) *
        leg.ratio *
        leg.instrument.deltaPerLot *
        (draft.direction === "LONG" ? 1 : -1),
    0,
  );
  const priceMarket = match ?? market;
  const allInPrice =
    draft.direction === "LONG" ? priceMarket.bestAsk * scale : priceMarket.bestBid * scale;
  const executable = match !== null && qualification !== "SUSPENDED" && validation.length === 0;
  const canonicalPayload = legs
    .map(
      (leg) =>
        [
          leg.instrument.settlementClass,
          leg.instrument.family,
          leg.instrument.instrument,
          leg.side,
          leg.ratio.toFixed(4),
        ].join(":"),
    )
    .join("|");

  return {
    canonicalPayload,
    canonicalId: `DRAFT-${stableHash(`${draft.direction}:${draft.lots}:${canonicalPayload}`)}`,
    legs,
    market,
    qualification,
    settlementClass,
    guarantee: guaranteeFor(match, qualification),
    executable,
    executableMarketId: match?.id ?? null,
    graphScale: scale,
    netDelta,
    collateral: Math.round(priceMarket.collateralPerLot * draft.lots * scale),
    maxResidual: Math.round(priceMarket.residualPerLot * draft.lots * scale * 100) / 100,
    allInPrice,
    allInPriceLabel: executable ? "EXECUTABLE" : "MODELED",
    firmDepthLots: executable ? Math.floor(priceMarket.firmDepthLots / scale) : 0,
    validation,
  };
}

export function qualificationTone(qualification: Qualification): "up" | "brand" | "down" {
  if (qualification === "QUALIFIED") return "up";
  if (qualification === "CONDITIONAL") return "brand";
  return "down";
}

export function marketTemplates(markets: PackageMarket[] = MARKETS): PackageMarket[] {
  return [...markets].sort((left, right) => {
    const qualification: Record<Qualification, number> = {
      QUALIFIED: 0,
      CONDITIONAL: 1,
      SUSPENDED: 2,
    };
    return qualification[left.qualification] - qualification[right.qualification] || left.id.localeCompare(right.id);
  });
}
