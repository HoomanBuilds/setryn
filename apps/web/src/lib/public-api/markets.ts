import { MARKETS } from "@/lib/terminal/markets";
import { seedPreviewTrades } from "@/lib/terminal/preview-trades";
import type { PackageMarket } from "@/lib/terminal/types";
import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import { considerationPerPriceUnit, runtimeMarketByKey } from "@/lib/internal-gateway/runtime-markets";
import { deriveBookId } from "./chain";

/**
 * Market catalog projection. The catalog is the platform's own market list. Every catalog market the deployment's
 * runtime lists in `markets` executes onchain on its own series, tick grid, payoff bounds and collateral; any other
 * catalog market publishes the catalog's preview snapshot, labelled as such, and cannot be traded through the API.
 * Preview figures are the catalog's base snapshot (the same values the platform's preview feed starts from), never a
 * second independent feed.
 */

export type ExecutionVenue = "ONCHAIN" | "PREVIEW_ONLY";

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
    maxOrderLots: number;
    maxLongDebitMinorPerLot: number;
    maxShortDebitMinorPerLot: number;
    makerFeeRatePpm: number;
    takerFeeRatePpm: number;
  } | null;
  quote: {
    source: "PREVIEW_SNAPSHOT";
    netPrice: number;
    priorNetPrice: number;
    bestBid: number;
    bestAsk: number;
  };
  legs: { id: string; side: "BUY" | "SELL"; ratio: number }[];
}

/** Largest order the platform accepts on an onchain market, before the market's own cap. */
export const PLATFORM_MAX_ORDER_LOTS = 10;

export function projectMarket(market: PackageMarket, setryn: SetrynRuntime | null): ApiMarket {
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
    execution: onchain ? "ONCHAIN" : "PREVIEW_ONLY",
    onchain:
      onchain && setryn
        ? {
            chainId: setryn.chainId,
            seriesId: onchain.seriesId,
            marketId: onchain.marketId,
            bookId: deriveBookId(setryn, onchain),
            orderState: setryn.orderState,
            publicOrderBook: setryn.publicOrderBook,
            privateRfqBook: setryn.privateRfqBook,
            tickSizeMinor: onchain.tickSizeMinor,
            priceScale: onchain.priceScale,
            maxOrderLots: onchain.maxOrderLots,
            maxLongDebitMinorPerLot: onchain.maxLongDebitMinorPerLot,
            maxShortDebitMinorPerLot: onchain.maxShortDebitMinorPerLot,
            makerFeeRatePpm: setryn.makerFeeRatePpm,
            takerFeeRatePpm: setryn.takerFeeRatePpm,
          }
        : null,
    quote: {
      source: "PREVIEW_SNAPSHOT",
      netPrice: market.netPrice,
      priorNetPrice: market.priorNetPrice,
      bestBid: market.bestBid,
      bestAsk: market.bestAsk,
    },
    legs: market.legs.map((leg) => ({ id: leg.id, side: leg.side, ratio: leg.ratio })),
  };
}

export function catalog(): readonly PackageMarket[] {
  return MARKETS;
}

/** Case-insensitive, like the platform's market routes; an unknown id is a 404, never a fallback. */
export function findCatalogMarket(id: string): PackageMarket | null {
  const needle = id.trim().toLowerCase();
  return MARKETS.find((market) => market.id.toLowerCase() === needle) ?? null;
}

export function previewDepth(market: PackageMarket) {
  const rows = market.book.map((row) => ({
    side: row.side,
    source: row.source,
    price: row.price,
    lots: row.lots,
    firmness: row.firmness,
    executable: false as const,
  }));
  return {
    bids: rows.filter((row) => row.side === "BID").sort((left, right) => right.price - left.price),
    asks: rows.filter((row) => row.side === "ASK").sort((left, right) => left.price - right.price),
  };
}

export function previewTape(market: PackageMarket, chainTimeSeconds: number) {
  return seedPreviewTrades(market, chainTimeSeconds).map((trade) => ({
    tradeId: trade.id,
    marketId: market.id,
    price: trade.price,
    lots: trade.lots,
    aggressorSide: trade.side,
    time: new Date(trade.time * 1000).toISOString(),
  }));
}
