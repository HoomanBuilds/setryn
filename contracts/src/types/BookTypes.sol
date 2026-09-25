// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "./Enums.sol";
import {AssetId, BookId, FeeScheduleId} from "./Identifiers.sol";
import {OrderTargetKind} from "./OrderTypes.sol";
import {Lots, PriceTicks} from "./Units.sol";

enum BookLiquidityKind {
    Unspecified,
    Direct
}

enum BookOrderStatus {
    Unspecified,
    Resting,
    Removed
}

enum BookRemovalReason {
    Unspecified,
    Filled,
    Cancelled,
    Expired,
    Rejected,
    Ineligible
}

struct BookIdentity {
    BookId bookId;
    OrderTargetKind targetKind;
    bytes32 targetId;
    uint32 targetVersion;
    bytes32 executionModeId;
    AssetId settlementAssetId;
    uint32 settlementAssetVersion;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    bytes32 packageLegsHash;
    BookLiquidityKind liquidityKind;
}

struct BookOrder {
    BookId bookId;
    bytes32 orderHash;
    bytes32 levelId;
    bytes32 previousOrderHash;
    bytes32 nextOrderHash;
    uint64 sequence;
    Lots remainingLots;
    PriceTicks priceTicks;
    Side side;
    BookOrderStatus status;
}

struct PriceLevel {
    BookId bookId;
    bytes32 levelId;
    bytes32 previousLevelId;
    bytes32 nextLevelId;
    bytes32 headOrderHash;
    bytes32 tailOrderHash;
    PriceTicks priceTicks;
    uint256 totalLots;
    uint64 orderCount;
    Side side;
    bool active;
}

struct LevelHint {
    bytes32 previousLevelId;
    bytes32 nextLevelId;
}

struct BookEligibility {
    bool eligible;
    bytes32 reason;
}
