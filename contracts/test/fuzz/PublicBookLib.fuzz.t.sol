// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PublicBookHarness} from "../unit/harness/PublicBookHarness.sol";
import {Side} from "../../src/types/Enums.sol";
import {PriceTicks} from "../../src/types/Units.sol";

contract PublicBookLibFuzzTest is Test {
    PublicBookHarness internal harness = new PublicBookHarness();

    function testFuzz_PricePriorityIsAntisymmetricForDistinctPrices(int128 left, int128 right) public view {
        if (left == right) return;
        bool bidForward = harness.isBefore(Side.Buy, PriceTicks.wrap(left), PriceTicks.wrap(right));
        bool bidReverse = harness.isBefore(Side.Buy, PriceTicks.wrap(right), PriceTicks.wrap(left));
        bool askForward = harness.isBefore(Side.Sell, PriceTicks.wrap(left), PriceTicks.wrap(right));
        assertTrue(bidForward != bidReverse);
        assertEq(askForward, bidReverse);
    }

    function testFuzz_CrossingIsMonotonicForBids(int128 lower, int128 upper, int128 ask) public view {
        if (lower > upper) (lower, upper) = (upper, lower);
        bool lowerCrosses = harness.crosses(Side.Buy, PriceTicks.wrap(lower), PriceTicks.wrap(ask));
        bool upperCrosses = harness.crosses(Side.Buy, PriceTicks.wrap(upper), PriceTicks.wrap(ask));
        if (lowerCrosses) assertTrue(upperCrosses);
    }
}
