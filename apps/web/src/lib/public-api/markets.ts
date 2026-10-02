import { overlaySnapshot } from "@/lib/market-data/overlay";
import { readMarketDataSnapshot } from "@/lib/market-data/server";
import { CATALOG_MARKETS, MARKETS } from "@/lib/terminal/markets";
import type { PackageMarket } from "@/lib/terminal/types";
import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import { marketTradingVersions, readActiveFeeSchedule, type ActiveFeeSchedule } from "@/lib/internal-gateway/fee-schedule";
import { considerationPerPriceUnit, runtimeMarketByKey, priceOffset } from "@/lib/internal-gateway/runtime-markets";
import { deriveBookId } from "./chain";

/**
 * Market catalog projection. The catalog is the deployment's listing (`catalog.generated.json`), and every listed
 * market executes onchain on its own series, tick grid, payoff bounds and collateral; `onchain` carries the identifiers
 * once the deployment's runtime is readable. Quotes come from the platform's one market-data feed (`liveCatalog`): the
 * modeled mark of each expiry (the versioned capped-forward model from the Chainlink spot, `quote.markSource` MODEL), with
 * the onchain book beside it. A missing bid or offer is null.
 */

export type ExecutionVenue = "ONCHAIN";

export interface ApiMarket {
  id: string;
  name: string;
  code: string;
  underlying: string;
  strategyKind: string;
  strategyLabel: string;
  priceUnit: string;
  priceDecimals: number;
  tickSize: number;
  tenorLabel: string;
  expiry: string;
  settlementClass: string;
  settlementAsset: string;
  fixingSource: string;
  qualification: string;
  qualificationNote: string;
  contractMultiplier: number;
  collateralPerLot: number;
  maxOrderLots: number | null;
  execution: ExecutionVenue;
  /** Present for onchain markets: the identifiers orders must carry and the grid prices are quoted on. */
  onchain: {
    chainId: number;
    seriesId: string;
    marketId: string;
    bookId: string;
    orderState: string;
    publicOrderBook: string;
    privateRfqBook: string;
    /** Settlement minor units per price tick per lot. */
    tickSizeMinor: number;
    /** Price ticks per unit of package price: priceTicks = price x priceScale. */
    priceScale: number;
    /** Price at zero ticks (the range forward floor): price = priceOffset + priceTicks / priceScale. */
    priceOffset: number;
    maxOrderLots: number;
    maxLongDebitMinorPerLot: number;
    maxShortDebitMinorPerLot: number;
    /** The series version orders sign as `targetVersion`: the series' active version. */
    seriesVersion: number;
    /** The fee schedule orders sign: its id and the version the market's active version names. */
    feeScheduleId: string;
    feeScheduleVersion: number;
    /** Active rates against 1,000,000 (100 ppm = 1 bp), read from chain; `feeSource` says RUNTIME if the chain was unreachable. */
    makerFeeRatePpm: number;
    takerFeeRatePpm: number;
    /** Flat charge per fill in settlement minor units, on top of the rate (zero under a pure rate schedule). */
    makerFlatFeeMinor: number;
    takerFlatFeeMinor: number;
    feeSource: "CHAIN" | "RUNTIME";
  } | null;
  quote: {
    /** MARKET_DATA once the feed has been read; LISTING_REFERENCE for the catalog alone. */
    source: "MARKET_DATA" | "LISTING_REFERENCE";
    /** The modeled mark of this expiry (see markSource and markModel). */
    netPrice: number | null;
    markSource: PackageMarket["markSource"];
    /** Methodology, version and parameter set of the mark; its inputs are MODELED, not observed market data. */
    markModel: { methodology: string; version: number; parameterSet: string; provenance: "MODELED" } | null;
    /** The same model 24 hours earlier, null while that spot is not known. */
    priorNetPrice: number | null;
    bestBid: number | null;
    bestAsk: number | null;
    referencePrice: number | null;
  };
  /** Range forward terms: payoff per lot is lotSize x clamp(fixing - floor, 0, cap - floor). */
  terms: { floor: number; cap: number; lotSize: number; expiryAt: string; lastTradingAt: string };
  legs: { id: string; side: "BUY" | "SELL"; ratio: number }[];
}

/** Largest order the platform accepts on an onchain market, before the market's own cap. */
export const PLATFORM_MAX_ORDER_LOTS = 10;

/** The runtime and its active fee schedule for market projections; null when no deployment is readable. */
export async function marketDeployment(setryn: SetrynRuntime | null): Promise<{ setryn: SetrynRuntime; fees: ActiveFeeSchedule } | null> {
  if (!setryn) return null;
  return { setryn, fees: await readActiveFeeSchedule(setryn) };
}

export function projectMarket(market: PackageMarket, deployment: { setryn: SetrynRuntime; fees: ActiveFeeSchedule } | null): ApiMarket {
  const setryn = deployment?.setryn ?? null;
  const fees = deployment?.fees ?? null;
  const onchain = setryn ? runtimeMarketByKey(setryn, market.id) : null;
  const maxLots = onchain ? Math.min(PLATFORM_MAX_ORDER_LOTS, onchain.maxOrderLots) : market.maxOrderLots ?? null;
  return {
    id: market.id,
    name: market.name,
    code: market.code,
    underlying: market.underlying,
    strategyKind: market.strategyKind,
    strategyLabel: market.strategyLabel,
    priceUnit: market.priceUnit,
    priceDecimals: market.priceDecimals,
    tickSize: market.tickSize,
    tenorLabel: market.tenorLabel,
    expiry: market.expiryIso,
    settlementClass: market.settlementClass,
    settlementAsset: market.settlementAsset,
    fixingSource: market.fixingSource,
    qualification: market.qualification,
    qualificationNote: market.qualificationNote,
    contractMultiplier: onchain ? considerationPerPriceUnit(onchain) : market.contractMultiplier,
    collateralPerLot: onchain
      ? Math.max(onchain.maxLongDebitMinorPerLot, onchain.maxShortDebitMinorPerLot) / 1_000_000
      : market.collateralPerLot,
    maxOrderLots: maxLots,
    execution: "ONCHAIN",
    onchain:
      onchain && setryn && fees
        ? {
            chainId: setryn.chainId,
            seriesId: onchain.seriesId,
            marketId: onchain.marketId,
            bookId: deriveBookId(setryn, onchain, marketTradingVersions(fees, onchain.seriesId)),
            orderState: setryn.orderState,
            publicOrderBook: setryn.publicOrderBook,
            privateRfqBook: setryn.privateRfqBook,
            tickSizeMinor: onchain.tickSizeMinor,
            priceScale: onchain.priceScale,
            priceOffset: priceOffset(onchain),
            maxOrderLots: onchain.maxOrderLots,
            maxLongDebitMinorPerLot: onchain.maxLongDebitMinorPerLot,
            maxShortDebitMinorPerLot: onchain.maxShortDebitMinorPerLot,
            seriesVersion: marketTradingVersions(fees, onchain.seriesId).seriesVersion,
            feeScheduleId: setryn.feeScheduleId,
            feeScheduleVersion: marketTradingVersions(fees, onchain.seriesId).feeScheduleVersion,
            makerFeeRatePpm: fees.makerFeeRatePpm,
            takerFeeRatePpm: fees.takerFeeRatePpm,
            makerFlatFeeMinor: fees.maker.flatChargeMinor,
            takerFlatFeeMinor: fees.taker.flatChargeMinor,
            feeSource: fees.source,
          }
        : null,
    quote: {
      // Live once the feed read the chain or a fresher reference than the one the market was listed against.
      source: market.listedOnchain || market.referenceAsOf !== (CATALOG_MARKETS.get(market.id)?.referenceAt ?? 0) ? "MARKET_DATA" : "LISTING_REFERENCE",
      netPrice: finiteOrNull(market.netPrice),
      markSource: market.markSource,
      markModel: market.markModel
        ? {
            methodology: market.markModel.methodology,
            version: market.markModel.version,
            parameterSet: market.markModel.parameterSet,
            provenance: market.markModel.provenance,
          }
        : null,
      priorNetPrice: finiteOrNull(market.priorNetPrice),
      bestBid: finiteOrNull(market.bestBid),
      bestAsk: finiteOrNull(market.bestAsk),
      referencePrice: finiteOrNull(market.referencePrice),
    },
    terms: {
      floor: market.floor,
      cap: market.cap,
      lotSize: market.lotSize,
      expiryAt: new Date(market.expiryAt * 1000).toISOString(),
      lastTradingAt: new Date(market.lastTradingAt * 1000).toISOString(),
    },
    legs: market.legs.map((leg) => ({ id: leg.id, side: leg.side, ratio: leg.ratio })),
  };
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** The catalog alone: identity and terms, quotes at the listing reference. Prefer `liveCatalog` for quotes. */
export function catalog(): readonly PackageMarket[] {
  return MARKETS;
}

/** The catalog overlaid with the current market-data snapshot, as every platform page reads it. */
export async function liveCatalog(): Promise<PackageMarket[]> {
  const snapshot = await readMarketDataSnapshot().catch(() => null);
  return snapshot ? overlaySnapshot(MARKETS, snapshot) : [...MARKETS];
}

/** Case-insensitive, like the platform's market routes; an unknown id is a 404, never a fallback. */
export function findCatalogMarket(id: string): PackageMarket | null {
  const needle = id.trim().toLowerCase();
  return MARKETS.find((market) => market.id.toLowerCase() === needle) ?? null;
}

/** `findCatalogMarket` with the live overlay. */
export async function findLiveCatalogMarket(id: string): Promise<PackageMarket | null> {
  const market = findCatalogMarket(id);
  if (!market) return null;
  return (await liveCatalog()).find((candidate) => candidate.id === market.id) ?? market;
}
