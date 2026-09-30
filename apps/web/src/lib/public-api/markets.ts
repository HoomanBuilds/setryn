import { MARKETS } from "@/lib/terminal/markets";
import { seedPreviewTrades } from "@/lib/terminal/preview-trades";
import type { PackageMarket } from "@/lib/terminal/types";
import type { SetrynRuntime } from "@/lib/internal-gateway/runtime";
import { ONCHAIN_MARKET_ID, CONTRACT_MULTIPLIER } from "./chain";

/**
 * Market catalog projection. The catalog is the platform's own market list. Exactly one market is enabled for onchain
 * execution on this deployment; every other market publishes the catalog's preview snapshot, labelled as such, and
 * cannot be traded through the API. Preview figures are the catalog's base snapshot (the same values the platform's
 * preview feed starts from), never a second independent feed.
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
  /** Present for the onchain market: the identifiers orders must carry. */
  onchain: {
    chainId: number;
    seriesId: string;
    marketId: string;
    orderState: string;
    publicOrderBook: string;
    tickSizeMinor: number;
    maxOrderLots: number;
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

/** Largest order the platform accepts on the onchain market, before the deployment's own cap. */
export const PLATFORM_MAX_ORDER_LOTS = 10;

export function projectMarket(market: PackageMarket, setryn: SetrynRuntime | null): ApiMarket {
  const onchain = market.id === ONCHAIN_MARKET_ID && setryn !== null;
  const maxLots = onchain ? Math.min(PLATFORM_MAX_ORDER_LOTS, setryn.maxOrderLots) : market.maxOrderLots ?? null;
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
    contractMultiplier: onchain ? CONTRACT_MULTIPLIER : market.contractMultiplier,
    collateralPerLot: market.collateralPerLot,
    maxOrderLots: maxLots,
    execution: onchain ? "ONCHAIN" : "PREVIEW_ONLY",
    onchain: onchain
      ? {
          chainId: setryn.chainId,
          seriesId: setryn.seriesId,
          marketId: setryn.marketId,
          orderState: setryn.orderState,
          publicOrderBook: setryn.publicOrderBook,
          tickSizeMinor: setryn.tickSizeMinor,
          maxOrderLots: setryn.maxOrderLots,
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
