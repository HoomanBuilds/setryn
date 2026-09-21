// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {DecimalScaleLib, DecimalsOutOfRange, RescaleOverflow} from "../../src/libraries/DecimalScaleLib.sol";
import {MAX_DECIMALS} from "../../src/types/Units.sol";
import {NumericsHarness} from "./harness/NumericsHarness.sol";

contract DecimalScaleLibTest is Test {
    /// @dev One and a half units at six decimals, the same amount at eighteen decimals, and that
    /// amount plus the one minor unit that makes every rounding direction observable.
    uint256 internal constant SIX_DP = 1_500_000;
    uint256 internal constant EIGHTEEN_DP = 1_500_000_000_000_000_000;
    uint256 internal constant EIGHTEEN_DP_INEXACT = 1_500_000_000_000_000_001;

    NumericsHarness internal harness;

    function setUp() public {
        harness = new NumericsHarness();
    }

    function test_WideningIsExactAndEqualDecimalsAreIdentity() public pure {
        assertEq(DecimalScaleLib.rescaleDown(SIX_DP, 6, 18), EIGHTEEN_DP);
        assertEq(DecimalScaleLib.rescaleUp(SIX_DP, 6, 18), EIGHTEEN_DP);
        assertEq(DecimalScaleLib.rescaleSignedFloor(-int256(SIX_DP), 6, 18), -int256(EIGHTEEN_DP));
        assertEq(DecimalScaleLib.rescaleDown(12_345, 18, 18), 12_345);
        assertEq(DecimalScaleLib.rescaleSignedCeil(-12_345, 18, 18), -12_345);
    }

    function test_NarrowingBracketsTheQuotient() public pure {
        assertEq(DecimalScaleLib.rescaleDown(EIGHTEEN_DP_INEXACT, 18, 6), SIX_DP);
        assertEq(DecimalScaleLib.rescaleUp(EIGHTEEN_DP_INEXACT, 18, 6), SIX_DP + 1);
        assertEq(DecimalScaleLib.rescaleDown(EIGHTEEN_DP, 18, 6), SIX_DP);
        assertEq(DecimalScaleLib.rescaleUp(EIGHTEEN_DP, 18, 6), SIX_DP);
    }

    /// @dev Floor and ceil are directions on the number line, not on the magnitude, so a negative
    /// amount floors away from zero.
    function test_SignedNarrowingRoundsOnTheNumberLine() public pure {
        int256 negative = -int256(EIGHTEEN_DP_INEXACT);

        assertEq(DecimalScaleLib.rescaleSignedFloor(negative, 18, 6), -int256(SIX_DP + 1));
        assertEq(DecimalScaleLib.rescaleSignedCeil(negative, 18, 6), -int256(SIX_DP));
        assertEq(DecimalScaleLib.rescaleSignedFloor(int256(EIGHTEEN_DP_INEXACT), 18, 6), int256(SIX_DP));
        assertEq(DecimalScaleLib.rescaleSignedCeil(int256(EIGHTEEN_DP_INEXACT), 18, 6), int256(SIX_DP + 1));
    }

    function test_DecimalLimitsAndOverflowUseNamedErrors() public {
        assertEq(DecimalScaleLib.rescaleDown(10 ** 36, MAX_DECIMALS, 0), 1);
        assertEq(DecimalScaleLib.rescaleDown(1, 0, MAX_DECIMALS), 10 ** 36);

        vm.expectRevert(abi.encodeWithSelector(DecimalsOutOfRange.selector, MAX_DECIMALS + 1));
        harness.rescaleDown(1, MAX_DECIMALS + 1, 18);

        vm.expectRevert(abi.encodeWithSelector(DecimalsOutOfRange.selector, MAX_DECIMALS + 1));
        harness.rescaleDown(1, 18, MAX_DECIMALS + 1);

        vm.expectRevert(abi.encodeWithSelector(RescaleOverflow.selector, type(uint256).max, uint8(0), uint8(1)));
        harness.rescaleUp(type(uint256).max, 0, 1);

        // Widening that still fits uint256 but no longer fits the signed result type.
        vm.expectRevert(abi.encodeWithSelector(RescaleOverflow.selector, uint256(1e76), uint8(0), uint8(1)));
        harness.rescaleSignedFloor(int256(1e76), 0, 1);
    }
}
