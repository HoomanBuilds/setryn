// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {DivisionByZero, FixedPointLib, MulDivOverflow, SignedCastOverflow} from "../../src/libraries/FixedPointLib.sol";
import {Rate, RateLib} from "../../src/types/Units.sol";
import {NumericsHarness} from "./harness/NumericsHarness.sol";

contract FixedPointLibTest is Test {
    NumericsHarness internal harness;

    function setUp() public {
        harness = new NumericsHarness();
    }

    function test_UnsignedRoundingBracketsTheQuotient() public pure {
        assertEq(FixedPointLib.mulDivDown(7, 3, 2), 10);
        assertEq(FixedPointLib.mulDivUp(7, 3, 2), 11);
        assertEq(FixedPointLib.mulDivDown(6, 4, 3), 8);
        assertEq(FixedPointLib.mulDivUp(6, 4, 3), 8);
    }

    function test_WadHelpersUseTheWadScale() public pure {
        assertEq(FixedPointLib.mulWadDown(3e18, 2e18), 6e18);
        assertEq(FixedPointLib.mulWadDown(3, 3), 0);
        assertEq(FixedPointLib.mulWadUp(3, 3), 1);
        assertEq(FixedPointLib.divWadDown(1, 3), 333333333333333333);
        assertEq(FixedPointLib.divWadUp(1, 3), 333333333333333334);

        assertEq(FixedPointLib.applyRateDown(1_000, RateLib.fromBps(250)), 25);
        assertEq(FixedPointLib.applyRateUp(1_000, RateLib.fromBps(250)), 25);
        assertEq(FixedPointLib.applyRateDown(3, Rate.wrap(1)), 0);
        assertEq(FixedPointLib.applyRateUp(3, Rate.wrap(1)), 1);
    }

    function test_ZeroNumeratorIsZeroInEveryDirection() public pure {
        assertEq(FixedPointLib.mulDivDown(0, 5, 3), 0);
        assertEq(FixedPointLib.mulDivUp(0, 5, 3), 0);
        assertEq(FixedPointLib.mulDivSignedFloor(0, -5, 3), 0);
        assertEq(FixedPointLib.mulDivSignedCeil(0, -5, 3), 0);
        assertEq(FixedPointLib.mulDivSignedTrunc(0, -5, 3), 0);
        assertEq(FixedPointLib.mulDivSignedExpand(0, -5, 3), 0);
    }

    function test_SignedFloorRoundsTowardNegativeInfinity() public pure {
        assertEq(FixedPointLib.mulDivSignedFloor(-7, 3, 2), -11);
        assertEq(FixedPointLib.mulDivSignedFloor(7, 3, 2), 10);
    }

    function test_SignedCeilRoundsTowardPositiveInfinity() public pure {
        assertEq(FixedPointLib.mulDivSignedCeil(-7, 3, 2), -10);
        assertEq(FixedPointLib.mulDivSignedCeil(7, 3, 2), 11);
    }

    function test_SignedTruncRoundsTowardZero() public pure {
        assertEq(FixedPointLib.mulDivSignedTrunc(-7, 3, 2), -10);
        assertEq(FixedPointLib.mulDivSignedTrunc(7, 3, 2), 10);
    }

    function test_SignedExpandRoundsAwayFromZero() public pure {
        assertEq(FixedPointLib.mulDivSignedExpand(-7, 3, 2), -11);
        assertEq(FixedPointLib.mulDivSignedExpand(7, 3, 2), 11);
    }

    function test_SignedProductOfTwoNegativesIsPositive() public pure {
        assertEq(FixedPointLib.mulDivSignedFloor(-7, -3, 2), 10);
        assertEq(FixedPointLib.mulDivSignedCeil(-7, -3, 2), 11);
    }

    /// @dev The most negative int256 has no positive counterpart, so it is the one value that a
    /// naive absolute-value-then-negate implementation silently corrupts.
    function test_SignedHandlesInt256Minimum() public pure {
        assertEq(FixedPointLib.mulDivSignedTrunc(type(int256).min, 1, 1), type(int256).min);
        assertEq(FixedPointLib.mulDivSignedFloor(type(int256).min, 1, 2), type(int256).min / 2);
    }

    function test_SignedOverflowUsesNamedError() public {
        uint256 magnitude = uint256(type(int256).max) + 1;

        vm.expectRevert(abi.encodeWithSelector(SignedCastOverflow.selector, magnitude, false));
        harness.mulDivSignedTrunc(type(int256).min, -1, 1);
    }

    function test_UnsignedOverflowUsesNamedError() public {
        vm.expectRevert(abi.encodeWithSelector(MulDivOverflow.selector, type(uint256).max, 2, 1));
        harness.mulDivDown(type(uint256).max, 2, 1);
    }

    function test_ZeroDenominatorUsesNamedError() public {
        vm.expectRevert(DivisionByZero.selector);
        harness.mulDivDown(1, 1, 0);

        vm.expectRevert(DivisionByZero.selector);
        harness.mulDivSignedFloor(-1, 1, 0);
    }
}
