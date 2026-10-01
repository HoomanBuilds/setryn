import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { marketTradingVersions, type ActiveFeeSchedule, type MarketTradingVersions } from "./fee-schedule";
import type { SetrynRuntime, SetrynRuntimeMarket } from "./runtime";
import type { OnchainMarketEconomics } from "./types";

const EMPTY_ID = `0x${"0".repeat(64)}` as Hex;
const MINOR_PER_UNIT = 1_000_000;
const BOOK_ID_TYPEHASH = keccak256(
  stringToHex(
    "SetrynDirectBookV1(uint256 chainId,address book,address orderState,uint8 targetKind,bytes32 targetId,uint32 targetVersion,bytes32 executionModeId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 packageLegsHash)",
  ),
);

/** The onchain market behind a catalog market id, or null when the catalog market is not registered onchain. */
export function runtimeMarketByKey(setryn: SetrynRuntime, marketKey: string): SetrynRuntimeMarket | null {
  return setryn.markets.find((market) => market.marketKey === marketKey) ?? null;
}

/** The catalog market a series trades as, or null for a series this runtime does not list. */
export function runtimeMarketBySeries(setryn: SetrynRuntime, seriesId: string): SetrynRuntimeMarket | null {
  const needle = seriesId.toLowerCase();
  return setryn.markets.find((market) => market.seriesId.toLowerCase() === needle) ?? null;
}

/** The price at zero ticks: the range forward's floor on a schema 11 market, zero on older runtimes. */
export function priceOffset(market: Pick<SetrynRuntimeMarket, "priceOffset">): number {
  const offset = market.priceOffset === undefined ? 0 : Number(market.priceOffset);
  if (!Number.isFinite(offset)) throw new Error("INVALID_PRICE_OFFSET");
  return offset;
}

/** Display decimals of a market's price: its own field on schema 11, else the price scale's power of ten. */
export function marketPriceDecimals(market: Pick<SetrynRuntimeMarket, "priceDecimals" | "priceScale">): number {
  return market.priceDecimals ?? Math.round(Math.log10(market.priceScale));
}

/** Package price to onchain price ticks on the market's own grid: ticks = (price - offset) x scale. */
export function priceToTicks(market: SetrynRuntimeMarket, price: number): bigint {
  if (!Number.isFinite(price)) throw new Error("INVALID_LIMIT_PRICE");
  // Rounded through the display decimals first so binary float noise in the offset subtraction cannot move a tick.
  const decimals = marketPriceDecimals(market);
  const delta = Number((price - priceOffset(market)).toFixed(decimals));
  return BigInt(Math.round(delta * market.priceScale));
}

/** Onchain price ticks back to the package price the catalog quotes: offset + ticks / scale. */
export function ticksToPrice(market: SetrynRuntimeMarket, priceTicks: bigint): number {
  const decimals = marketPriceDecimals(market);
  return Number((priceOffset(market) + Number(priceTicks) / market.priceScale).toFixed(decimals));
}

/** Settlement units of consideration per lot for one unit of package price: the market's contract multiplier. */
export function considerationPerPriceUnit(market: SetrynRuntimeMarket): number {
  return (market.tickSizeMinor * market.priceScale) / MINOR_PER_UNIT;
}

/** A market's order economics under the active fee schedule (see fee-schedule.ts). */
export function marketEconomics(
  market: SetrynRuntimeMarket,
  fees: Pick<ActiveFeeSchedule, "version" | "makerFeeBps" | "takerFeeBps" | "maker" | "taker" | "markets">,
): OnchainMarketEconomics {
  const versions = marketTradingVersions(fees, market.seriesId);
  return {
    considerationPerPriceUnit: considerationPerPriceUnit(market),
    longCollateralPerLot: market.maxLongDebitMinorPerLot / MINOR_PER_UNIT,
    shortCollateralPerLot: market.maxShortDebitMinorPerLot / MINOR_PER_UNIT,
    maxOrderLots: market.maxOrderLots,
    feeScheduleVersion: versions.feeScheduleVersion,
    seriesVersion: versions.seriesVersion,
    tradable: versions.tradable,
    makerFeeBps: fees.makerFeeBps,
    takerFeeBps: fees.takerFeeBps,
    makerFlatFeeUsd: fees.maker.flatChargeMinor / MINOR_PER_UNIT,
    takerFlatFeeUsd: fees.taker.flatChargeMinor / MINOR_PER_UNIT,
  };
}

/**
 * The direct public book of one series version, as the public order book derives it. The book is keyed by the series
 * version and the fee schedule version its orders sign, so a fee change (which re-versions every series onto a market
 * version naming the new fee schedule) opens a fresh book per market.
 */
export function deriveSeriesBookId(
  setryn: SetrynRuntime,
  seriesId: Hex,
  versions: Pick<MarketTradingVersions, "seriesVersion" | "feeScheduleVersion">,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "typeHash", type: "bytes32" },
        { name: "chainId", type: "uint256" },
        { name: "book", type: "address" },
        { name: "orderState", type: "address" },
        { name: "targetKind", type: "uint8" },
        { name: "targetId", type: "bytes32" },
        { name: "targetVersion", type: "uint32" },
        { name: "executionModeId", type: "bytes32" },
        { name: "settlementAssetId", type: "bytes32" },
        { name: "settlementAssetVersion", type: "uint32" },
        { name: "feeScheduleId", type: "bytes32" },
        { name: "feeScheduleVersion", type: "uint32" },
        { name: "packageLegsHash", type: "bytes32" },
      ],
      [
        BOOK_ID_TYPEHASH,
        BigInt(setryn.chainId),
        setryn.publicOrderBook,
        setryn.orderState,
        1,
        seriesId,
        versions.seriesVersion,
        setryn.executionModeId,
        setryn.settlementAssetId,
        1,
        setryn.feeScheduleId,
        versions.feeScheduleVersion,
        EMPTY_ID,
      ],
    ),
  );
}
