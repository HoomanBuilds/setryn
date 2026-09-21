// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {
    BPS_DENOMINATOR,
    InexactBpsConversion,
    Lots,
    LotsLib,
    LotsOverflow,
    MAX_DECIMALS,
    PriceTicks,
    PriceTicksLib,
    PriceTicksOverflow,
    Rate,
    RateAboveOne,
    RateLib,
    RateOverflow,
    TickSizeMinor,
    TickSizeMinorLib,
    WAD,
    WAD_PER_BPS,
    ZeroTickSize
} from "../../src/types/Units.sol";
import {NumericsHarness} from "./harness/NumericsHarness.sol";

contract UnitsTest is Test {
    NumericsHarness internal harness;

    function setUp() public {
        harness = new NumericsHarness();
    }

    function test_ScaleConstantsAreCanonical() public pure {
        assertEq(WAD, 1e18);
        assertEq(BPS_DENOMINATOR, 1e4);
        assertEq(WAD_PER_BPS, 1e14);
        assertEq(WAD / BPS_DENOMINATOR, WAD_PER_BPS, "basis points must divide WAD exactly");
        assertEq(MAX_DECIMALS, 36);
    }

    function test_LotsConversionRespectsBoundary() public {
        Lots atMax = LotsLib.fromUint256(type(uint128).max);

        assertEq(LotsLib.unwrap(atMax), type(uint128).max);
        assertTrue(LotsLib.isZero(Lots.wrap(0)));
        assertFalse(LotsLib.isZero(atMax));

        uint256 aboveMax = uint256(type(uint128).max) + 1;
        vm.expectRevert(abi.encodeWithSelector(LotsOverflow.selector, aboveMax));
        harness.lotsFromUint256(aboveMax);
    }

    function test_PriceTicksClassifiesSign() public pure {
        assertTrue(PriceTicksLib.isPositive(PriceTicks.wrap(25)));
        assertTrue(PriceTicksLib.isNegative(PriceTicks.wrap(-25)));
        assertTrue(PriceTicksLib.isZero(PriceTicks.wrap(0)));
        assertFalse(PriceTicksLib.isNegative(PriceTicks.wrap(0)));
        assertFalse(PriceTicksLib.isPositive(PriceTicks.wrap(0)));
    }

    function test_PriceTicksMagnitudeCoversMinimum() public {
        assertEq(PriceTicksLib.abs(PriceTicks.wrap(type(int128).min)), 2 ** 127);
        assertEq(PriceTicksLib.abs(PriceTicks.wrap(type(int128).max)), 2 ** 127 - 1);
        assertEq(PriceTicksLib.abs(PriceTicks.wrap(-25)), 25);

        int256 belowMin = int256(type(int128).min) - 1;
        vm.expectRevert(abi.encodeWithSelector(PriceTicksOverflow.selector, belowMin));
        harness.priceTicksFromInt256(belowMin);
    }

    function test_RateBpsRoundTripIsExact() public pure {
        Rate quarterPercent = RateLib.fromBps(25);

        assertEq(RateLib.unwrap(quarterPercent), 25 * WAD_PER_BPS);
        assertEq(RateLib.toBps(quarterPercent), 25);
        assertEq(RateLib.unwrap(RateLib.fromBps(BPS_DENOMINATOR)), WAD);
        assertEq(RateLib.toBps(RateLib.fromBps(0)), 0);
    }

    function test_RateToBpsRejectsInexactValue() public {
        uint64 offGrid = uint64(WAD_PER_BPS) + 1;

        vm.expectRevert(abi.encodeWithSelector(InexactBpsConversion.selector, offGrid));
        harness.rateToBps(offGrid);
    }

    function test_RateRejectsValuesBeyondItsWidth() public {
        uint256 maxBps = uint256(type(uint64).max) / WAD_PER_BPS;

        assertEq(RateLib.unwrap(RateLib.fromBps(maxBps)), maxBps * WAD_PER_BPS);

        vm.expectRevert(abi.encodeWithSelector(RateOverflow.selector, maxBps + 1));
        harness.rateFromBps(maxBps + 1);

        uint256 aboveWidth = uint256(type(uint64).max) + 1;
        vm.expectRevert(abi.encodeWithSelector(RateOverflow.selector, aboveWidth));
        harness.rateFromWad(aboveWidth);
    }

    function test_RateIsNotGloballyCappedAtOne() public {
        Rate leverage = RateLib.fromWad(2 * WAD);

        assertEq(RateLib.unwrap(leverage), 2 * WAD);
        assertFalse(RateLib.isAtMostOne(leverage));
        assertTrue(RateLib.isAtMostOne(RateLib.fromWad(WAD)));
        assertEq(RateLib.requireAtMostOne(RateLib.fromWad(WAD)), WAD);

        uint64 aboveOne = uint64(WAD) + 1;
        vm.expectRevert(abi.encodeWithSelector(RateAboveOne.selector, aboveOne));
        harness.rateRequireAtMostOne(aboveOne);
    }

    function test_TickSizeMustBePositive() public {
        assertEq(TickSizeMinorLib.requirePositive(TickSizeMinor.wrap(1_000_000)), 1_000_000);
        assertTrue(TickSizeMinorLib.isZero(TickSizeMinor.wrap(0)));

        vm.expectRevert(ZeroTickSize.selector);
        harness.tickSizeRequirePositive(0);
    }
}
