// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "../types/Enums.sol";
import {AssetId, BookId, FeeScheduleId} from "../types/Identifiers.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";
import {PriceTicks} from "../types/Units.sol";

error InvalidBookSide(Side side);

library PublicBookLib {
    bytes32 internal constant BOOK_ID_TYPEHASH = keccak256(
        "SetrynDirectBookV1(uint256 chainId,address book,address orderState,uint8 targetKind,bytes32 targetId,uint32 targetVersion,bytes32 executionModeId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 packageLegsHash)"
    );
    bytes32 internal constant LEVEL_ID_TYPEHASH =
        keccak256("SetrynDirectPriceLevelV1(bytes32 bookId,uint8 side,int128 priceTicks)");

    function deriveBookId(
        uint256 chainId,
        address book,
        address orderState,
        OrderTargetKind targetKind,
        bytes32 targetId,
        uint32 targetVersion,
        bytes32 executionModeId,
        AssetId settlementAssetId,
        uint32 settlementAssetVersion,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        bytes32 packageLegsHash
    ) internal pure returns (BookId) {
        return BookId.wrap(
            keccak256(
                abi.encode(
                    BOOK_ID_TYPEHASH,
                    chainId,
                    book,
                    orderState,
                    uint8(targetKind),
                    targetId,
                    targetVersion,
                    executionModeId,
                    AssetId.unwrap(settlementAssetId),
                    settlementAssetVersion,
                    FeeScheduleId.unwrap(feeScheduleId),
                    feeScheduleVersion,
                    packageLegsHash
                )
            )
        );
    }

    function deriveLevelId(BookId bookId, Side side, PriceTicks priceTicks) internal pure returns (bytes32) {
        _requireSide(side);
        return
            keccak256(abi.encode(LEVEL_ID_TYPEHASH, BookId.unwrap(bookId), uint8(side), PriceTicks.unwrap(priceTicks)));
    }

    function isBefore(Side side, PriceTicks left, PriceTicks right) internal pure returns (bool) {
        _requireSide(side);
        int128 leftValue = PriceTicks.unwrap(left);
        int128 rightValue = PriceTicks.unwrap(right);
        return side == Side.Buy ? leftValue > rightValue : leftValue < rightValue;
    }

    function crosses(Side incomingSide, PriceTicks incomingPrice, PriceTicks oppositePrice)
        internal
        pure
        returns (bool)
    {
        _requireSide(incomingSide);
        int128 incoming = PriceTicks.unwrap(incomingPrice);
        int128 opposite = PriceTicks.unwrap(oppositePrice);
        return incomingSide == Side.Buy ? incoming >= opposite : incoming <= opposite;
    }

    function opposite(Side side) internal pure returns (Side) {
        _requireSide(side);
        return side == Side.Buy ? Side.Sell : Side.Buy;
    }

    function _requireSide(Side side) private pure {
        if (side != Side.Buy && side != Side.Sell) revert InvalidBookSide(side);
    }
}
