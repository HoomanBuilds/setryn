// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PublicBookHarness} from "./harness/PublicBookHarness.sol";
import {Side} from "../../src/types/Enums.sol";
import {AssetId, BookId, FeeScheduleId} from "../../src/types/Identifiers.sol";
import {OrderTargetKind} from "../../src/types/OrderTypes.sol";
import {PriceTicks} from "../../src/types/Units.sol";

contract PublicBookLibTest is Test {
    PublicBookHarness internal harness = new PublicBookHarness();

    function test_SignedPricesSortBidsDescendingAndAsksAscending() public view {
        assertTrue(harness.isBefore(Side.Buy, PriceTicks.wrap(10), PriceTicks.wrap(-10)));
        assertFalse(harness.isBefore(Side.Buy, PriceTicks.wrap(-10), PriceTicks.wrap(10)));
        assertTrue(harness.isBefore(Side.Sell, PriceTicks.wrap(-10), PriceTicks.wrap(10)));
        assertFalse(harness.isBefore(Side.Sell, PriceTicks.wrap(10), PriceTicks.wrap(-10)));
    }

    function test_CrossingIncludesEqualAndNegativePrices() public view {
        assertTrue(harness.crosses(Side.Buy, PriceTicks.wrap(-5), PriceTicks.wrap(-5)));
        assertTrue(harness.crosses(Side.Buy, PriceTicks.wrap(-4), PriceTicks.wrap(-5)));
        assertTrue(harness.crosses(Side.Sell, PriceTicks.wrap(-6), PriceTicks.wrap(-5)));
        assertFalse(harness.crosses(Side.Sell, PriceTicks.wrap(-4), PriceTicks.wrap(-5)));
    }

    function test_BookIdentityPinsExecutionAndSettlementVersions() public view {
        BookId first = _bookId(keccak256("mode"), 1, 1);
        BookId differentMode = _bookId(keccak256("other-mode"), 1, 1);
        BookId differentSettlement = _bookId(keccak256("mode"), 2, 1);
        BookId differentFee = _bookId(keccak256("mode"), 1, 2);
        assertTrue(BookId.unwrap(first) != BookId.unwrap(differentMode));
        assertTrue(BookId.unwrap(first) != BookId.unwrap(differentSettlement));
        assertTrue(BookId.unwrap(first) != BookId.unwrap(differentFee));
    }

    function test_LevelIdentityPinsSideAndSignedPrice() public view {
        BookId bookId = _bookId(keccak256("mode"), 1, 1);
        bytes32 bid = harness.deriveLevelId(bookId, Side.Buy, PriceTicks.wrap(-1));
        bytes32 ask = harness.deriveLevelId(bookId, Side.Sell, PriceTicks.wrap(-1));
        bytes32 otherPrice = harness.deriveLevelId(bookId, Side.Buy, PriceTicks.wrap(1));
        assertTrue(bid != ask);
        assertTrue(bid != otherPrice);
    }

    function _bookId(bytes32 mode, uint32 settlementVersion, uint32 feeVersion) private view returns (BookId) {
        return harness.deriveBookId(
            42161,
            address(0xB00C),
            address(0x0D3E),
            OrderTargetKind.Series,
            keccak256("series"),
            3,
            mode,
            AssetId.wrap(keccak256("USDC")),
            settlementVersion,
            FeeScheduleId.wrap(keccak256("fees")),
            feeVersion,
            bytes32(0)
        );
    }
}
