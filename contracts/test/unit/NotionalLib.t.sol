// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {NotionalOverflow} from "../../src/libraries/NotionalLib.sol";
import {ZeroTickSize} from "../../src/types/Units.sol";
import {NumericsHarness} from "./harness/NumericsHarness.sol";

contract NotionalLibTest is Test {
    uint128 internal constant TICK_SIZE = 1_000_000;

    NumericsHarness internal harness;

    function setUp() public {
        harness = new NumericsHarness();
    }

    /// @dev Three lots of a twenty five tick package at one USDC per tick, in six-decimal minor
    /// units. The sign of the notional is the sign of the price and nothing else.
    function test_NotionalFollowsPriceSignExactly() public view {
        assertEq(harness.fillNotional(3, 25, TICK_SIZE), 75_000_000);
        assertEq(harness.fillNotional(3, -25, TICK_SIZE), -75_000_000);
        assertEq(harness.grossNotional(3, 25, TICK_SIZE), 75_000_000);
        assertEq(harness.grossNotional(3, -25, TICK_SIZE), 75_000_000);
    }

    function test_ZeroLotsAndZeroPriceAreCostless() public view {
        assertEq(harness.fillNotional(0, 25, TICK_SIZE), 0);
        assertEq(harness.fillNotional(3, 0, TICK_SIZE), 0);
        assertEq(harness.grossNotional(0, -25, TICK_SIZE), 0);
    }

    function test_MinimumPriceTickIsRepresentable() public view {
        assertEq(harness.fillNotional(1, type(int128).min, 1), -(2 ** 127));
        assertEq(harness.grossNotional(1, type(int128).min, 1), 2 ** 127);
    }

    function test_ZeroTickSizeIsAMalformedMarket() public {
        vm.expectRevert(ZeroTickSize.selector);
        harness.fillNotional(3, 25, 0);
    }

    /// @dev Two distinct overflow boundaries must both be named rather than panic: the product
    /// leaving uint256, and a product that fits uint256 but not the signed result type.
    function test_OverflowUsesNamedError() public {
        uint128 maxLots = type(uint128).max;
        int128 maxPrice = type(int128).max;

        vm.expectRevert(
            abi.encodeWithSelector(NotionalOverflow.selector, uint256(maxLots), uint256(uint128(maxPrice)), maxLots)
        );
        harness.grossNotional(maxLots, maxPrice, maxLots);

        assertGt(harness.grossNotional(maxLots, maxPrice, 2), uint256(type(int256).max));
        vm.expectRevert(
            abi.encodeWithSelector(NotionalOverflow.selector, uint256(maxLots), uint256(uint128(maxPrice)), uint256(2))
        );
        harness.fillNotional(maxLots, maxPrice, 2);
    }
}
