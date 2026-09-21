// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {DecimalScaleLib} from "../../src/libraries/DecimalScaleLib.sol";
import {MAX_DECIMALS} from "../../src/types/Units.sol";

contract DecimalScaleLibFuzzTest is Test {
    /// @dev Widening never loses information, so narrowing straight back must return the original
    /// amount in either rounding direction. A 128-bit amount widened by at most 10 ** 36 stays
    /// inside uint256, so the round trip is exercised across the whole legal decimal range.
    function testFuzz_WidenThenNarrowRoundTrips(uint128 amount, uint8 rawFrom, uint8 rawTo) public pure {
        uint8 fromDecimals = rawFrom % (MAX_DECIMALS + 1);
        uint8 toDecimals = fromDecimals + (rawTo % (MAX_DECIMALS + 1 - fromDecimals));

        uint256 widened = DecimalScaleLib.rescaleUp(amount, fromDecimals, toDecimals);

        assertEq(DecimalScaleLib.rescaleDown(widened, toDecimals, fromDecimals), amount);
        assertEq(DecimalScaleLib.rescaleUp(widened, toDecimals, fromDecimals), amount);
    }

    function testFuzz_NarrowingRoundingIsOrdered(uint128 amount, uint8 rawFrom, uint8 rawTo) public pure {
        uint8 fromDecimals = rawFrom % (MAX_DECIMALS + 1);
        uint8 toDecimals = rawTo % (fromDecimals + 1);

        uint256 down = DecimalScaleLib.rescaleDown(amount, fromDecimals, toDecimals);
        uint256 up = DecimalScaleLib.rescaleUp(amount, fromDecimals, toDecimals);
        int256 floorValue = DecimalScaleLib.rescaleSignedFloor(-int256(uint256(amount)), fromDecimals, toDecimals);

        assertLe(down, up);
        assertLe(up - down, 1);
        assertEq(floorValue, -int256(up), "flooring a negative amount matches rounding its magnitude up");
    }
}
