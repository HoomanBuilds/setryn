// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "../types/Enums.sol";
import {FeeScheduleId, FillId, PackageId, SeriesId} from "../types/Identifiers.sol";
import {OrderRecord, OrderTargetKind, PublicOrder} from "../types/OrderTypes.sol";
import {Lots, LotsLib, PriceTicks} from "../types/Units.sol";

error IdenticalOrderHashes();
error OrderTargetMismatch();
error OrderSideMismatch();
error ExecutionModeMismatch(bytes32 takerMode, bytes32 makerMode);
error FeeScheduleMismatch();
error PriceDoesNotCross(int128 buyerLimit, int128 sellerLimit, int128 executionPrice);
error ZeroFillLots();

library ClearingLib {
    bytes32 internal constant FILL_ID_TYPEHASH = keccak256(
        "SetrynFillIdV1(uint256 chainId,address clearingEngine,bytes32 takerOrderHash,bytes32 makerOrderHash,uint128 takerCumulativeLots,uint128 makerCumulativeLots,uint128 fillLots,int128 executionPriceTicks,bytes32 witnessHash)"
    );
    bytes32 internal constant FUNDING_REFERENCE_TYPEHASH =
        keccak256("SetrynFillFundingV1(bytes32 orderHash,uint128 cumulativeLots,bytes32 purpose)");

    function validateMatch(
        bytes32 takerOrderHash,
        OrderRecord memory taker,
        bytes32 makerOrderHash,
        OrderRecord memory maker,
        Lots fillLots,
        PriceTicks executionPriceTicks
    ) internal pure returns (bool takerIsBuyer) {
        if (takerOrderHash == makerOrderHash) revert IdenticalOrderHashes();
        if (LotsLib.isZero(fillLots)) revert ZeroFillLots();
        PublicOrder memory takerOrder = taker.order;
        PublicOrder memory makerOrder = maker.order;
        if (
            takerOrder.targetKind != makerOrder.targetKind || takerOrder.targetVersion != makerOrder.targetVersion
                || takerOrder.targetKind == OrderTargetKind.Unspecified
                || (takerOrder.targetKind == OrderTargetKind.Series
                    && SeriesId.unwrap(takerOrder.seriesId) != SeriesId.unwrap(makerOrder.seriesId))
                || (takerOrder.targetKind == OrderTargetKind.Package
                    && PackageId.unwrap(takerOrder.packageId) != PackageId.unwrap(makerOrder.packageId))
        ) revert OrderTargetMismatch();
        if (
            (takerOrder.side != Side.Buy && takerOrder.side != Side.Sell)
                || (makerOrder.side != Side.Buy && makerOrder.side != Side.Sell) || takerOrder.side == makerOrder.side
        ) revert OrderSideMismatch();
        if (takerOrder.executionModeId != makerOrder.executionModeId) {
            revert ExecutionModeMismatch(takerOrder.executionModeId, makerOrder.executionModeId);
        }
        if (
            FeeScheduleId.unwrap(takerOrder.feeScheduleId) != FeeScheduleId.unwrap(makerOrder.feeScheduleId)
                || takerOrder.feeScheduleVersion != makerOrder.feeScheduleVersion
        ) revert FeeScheduleMismatch();

        PublicOrder memory buyer = takerOrder.side == Side.Buy ? takerOrder : makerOrder;
        PublicOrder memory seller = takerOrder.side == Side.Sell ? takerOrder : makerOrder;
        int128 execution = PriceTicks.unwrap(executionPriceTicks);
        int128 buyerLimit = PriceTicks.unwrap(buyer.priceTicks);
        int128 sellerLimit = PriceTicks.unwrap(seller.priceTicks);
        if (execution > buyerLimit || execution < sellerLimit) {
            revert PriceDoesNotCross(buyerLimit, sellerLimit, execution);
        }
        return takerOrder.side == Side.Buy;
    }

    function deriveFillId(
        uint256 chainId,
        address clearingEngine,
        bytes32 takerOrderHash,
        bytes32 makerOrderHash,
        Lots takerCumulativeLots,
        Lots makerCumulativeLots,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        bytes32 witnessHash
    ) internal pure returns (FillId) {
        return FillId.wrap(
            keccak256(
                abi.encode(
                    FILL_ID_TYPEHASH,
                    chainId,
                    clearingEngine,
                    takerOrderHash,
                    makerOrderHash,
                    Lots.unwrap(takerCumulativeLots),
                    Lots.unwrap(makerCumulativeLots),
                    Lots.unwrap(fillLots),
                    PriceTicks.unwrap(executionPriceTicks),
                    witnessHash
                )
            )
        );
    }

    function deriveFundingReference(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(FUNDING_REFERENCE_TYPEHASH, orderHash, cumulativeLots, purpose));
    }
}
