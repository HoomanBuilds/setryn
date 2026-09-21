// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {FixedPointLib} from "../../src/libraries/FixedPointLib.sol";
import {Rate} from "../../src/types/Units.sol";

/// @dev Inputs are narrowed to 128 bits so every product stays inside the signed result range. The
/// properties under test are about rounding and sign, not about the overflow boundary, which the
/// unit vectors pin down exactly.
contract FixedPointLibFuzzTest is Test {
    function testFuzz_UnsignedRoundingIsOrdered(uint128 x, uint128 y, uint256 denominator, uint64 rawRate) public pure {
        vm.assume(denominator != 0);

        uint256 down = FixedPointLib.mulDivDown(x, y, denominator);
        uint256 up = FixedPointLib.mulDivUp(x, y, denominator);

        assertEq(up, mulmod(x, y, denominator) == 0 ? down : down + 1);

        assertEq(FixedPointLib.applyRateDown(x, Rate.wrap(rawRate)), FixedPointLib.mulWadDown(x, rawRate));
        assertEq(FixedPointLib.applyRateUp(x, Rate.wrap(rawRate)), FixedPointLib.mulWadUp(x, rawRate));
    }

    function testFuzz_SignedDirectionsBracketByAtMostOne(int128 x, int128 y, uint256 denominator) public pure {
        vm.assume(denominator != 0);

        int256 floorValue = FixedPointLib.mulDivSignedFloor(x, y, denominator);
        int256 ceilValue = FixedPointLib.mulDivSignedCeil(x, y, denominator);
        int256 truncValue = FixedPointLib.mulDivSignedTrunc(x, y, denominator);
        int256 expandValue = FixedPointLib.mulDivSignedExpand(x, y, denominator);

        assertLe(floorValue, ceilValue);
        assertLe(ceilValue - floorValue, 1);
        assertTrue(truncValue == floorValue || truncValue == ceilValue);
        assertTrue(expandValue == floorValue || expandValue == ceilValue);
    }

    function testFuzz_SignedTruncIsSignSymmetric(int128 x, int128 y, uint256 denominator) public pure {
        vm.assume(denominator != 0);

        int256 negated = FixedPointLib.mulDivSignedTrunc(-int256(x), y, denominator);

        assertEq(negated, -FixedPointLib.mulDivSignedTrunc(x, y, denominator));
    }

    function testFuzz_SignedFloorAndCeilAreNegationDuals(int128 x, int128 y, uint256 denominator) public pure {
        vm.assume(denominator != 0);

        assertEq(
            FixedPointLib.mulDivSignedFloor(-int256(x), y, denominator),
            -FixedPointLib.mulDivSignedCeil(x, y, denominator)
        );
    }
}
