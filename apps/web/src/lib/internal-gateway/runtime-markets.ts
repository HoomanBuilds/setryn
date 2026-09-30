import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
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

/** Package price to onchain price ticks on the market's own grid. */
export function priceToTicks(market: SetrynRuntimeMarket, price: number): bigint {
  if (!Number.isFinite(price)) throw new Error("INVALID_LIMIT_PRICE");
  return BigInt(Math.round(price * market.priceScale));
}

/** Onchain price ticks back to the package price the catalog quotes. */
export function ticksToPrice(market: SetrynRuntimeMarket, priceTicks: bigint): number {
  const decimals = Math.round(Math.log10(market.priceScale));
  return Number((Number(priceTicks) / market.priceScale).toFixed(decimals));
}

/** Settlement units of consideration per lot for one unit of package price: the market's contract multiplier. */
export function considerationPerPriceUnit(market: SetrynRuntimeMarket): number {
  return (market.tickSizeMinor * market.priceScale) / MINOR_PER_UNIT;
}

export function marketEconomics(setryn: SetrynRuntime, market: SetrynRuntimeMarket): OnchainMarketEconomics {
  return {
    considerationPerPriceUnit: considerationPerPriceUnit(market),
    longCollateralPerLot: market.maxLongDebitMinorPerLot / MINOR_PER_UNIT,
    shortCollateralPerLot: market.maxShortDebitMinorPerLot / MINOR_PER_UNIT,
    maxOrderLots: market.maxOrderLots,
    makerFeeBps: setryn.makerFeeRatePpm / 100,
    takerFeeBps: setryn.takerFeeRatePpm / 100,
  };
}

/** The direct public book of one series, as the public order book derives it. */
export function deriveSeriesBookId(setryn: SetrynRuntime, seriesId: Hex): Hex {
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
        1,
        setryn.executionModeId,
        setryn.settlementAssetId,
        1,
        setryn.feeScheduleId,
        1,
        EMPTY_ID,
      ],
    ),
  );
}
