// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PublicBookLib} from "../../../src/libraries/PublicBookLib.sol";
import {Side} from "../../../src/types/Enums.sol";
import {AssetId, BookId, FeeScheduleId} from "../../../src/types/Identifiers.sol";
import {OrderTargetKind} from "../../../src/types/OrderTypes.sol";
import {PriceTicks} from "../../../src/types/Units.sol";

contract PublicBookHarness {
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
    ) external pure returns (BookId) {
        return PublicBookLib.deriveBookId(
            chainId,
            book,
            orderState,
            targetKind,
            targetId,
            targetVersion,
            executionModeId,
            settlementAssetId,
            settlementAssetVersion,
            feeScheduleId,
            feeScheduleVersion,
            packageLegsHash
        );
    }

    function deriveLevelId(BookId bookId, Side side, PriceTicks priceTicks) external pure returns (bytes32) {
        return PublicBookLib.deriveLevelId(bookId, side, priceTicks);
    }

    function isBefore(Side side, PriceTicks left, PriceTicks right) external pure returns (bool) {
        return PublicBookLib.isBefore(side, left, right);
    }

    function crosses(Side side, PriceTicks incoming, PriceTicks opposite) external pure returns (bool) {
        return PublicBookLib.crosses(side, incoming, opposite);
    }
}
