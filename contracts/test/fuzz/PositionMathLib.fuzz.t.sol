// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PositionMathHarness} from "../unit/harness/PositionMathHarness.sol";
import {Lots} from "../../src/types/Units.sol";

contract PositionMathLibFuzzTest is Test {
    PositionMathHarness internal harness = new PositionMathHarness();

    function testFuzz_CheckedAmountIsExactWithinUint128(uint128 perLot, uint128 rawLots) public view {
        uint256 maximumLots = perLot == 0 ? type(uint128).max : type(uint128).max / uint256(perLot);
        uint128 lots = uint128(bound(rawLots, 0, maximumLots));
        uint128 total = harness.checkedAmount(perLot, Lots.wrap(lots));
        assertEq(uint256(total), uint256(perLot) * uint256(lots));
    }

    function testFuzz_SignedTransferPreservesSignAndMagnitude(uint128 rawPerLot, uint128 rawLots, bool negative)
        public
        view
    {
        uint128 perLot = uint128(bound(rawPerLot, 0, type(uint128).max));
        uint256 maximumLots = perLot == 0 ? type(uint128).max : type(uint128).max / uint256(perLot);
        uint128 lots = uint128(bound(rawLots, 0, maximumLots));
        int256 signedPerLot = negative ? -int256(uint256(perLot)) : int256(uint256(perLot));
        int256 total = harness.scaleTransfer(signedPerLot, Lots.wrap(lots));
        int256 expected = signedPerLot * int256(uint256(lots));
        assertEq(total, expected);
    }

    function testFuzz_CheckedAmountRejectsUint128Overflow(uint128 perLot, uint128 rawLots) public {
        perLot = uint128(bound(perLot, 2, type(uint128).max));
        uint256 firstOverflowingLots = type(uint128).max / uint256(perLot) + 1;
        if (firstOverflowingLots > type(uint128).max) return;
        uint128 lots = uint128(bound(rawLots, firstOverflowingLots, type(uint128).max));
        vm.expectRevert();
        harness.checkedAmount(perLot, Lots.wrap(lots));
    }
}
