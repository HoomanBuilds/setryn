// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {NumericsHarness} from "../unit/harness/NumericsHarness.sol";

/// @dev Inputs are narrowed to 64 bits so every product stays far inside the signed result range.
/// Additivity only holds in that domain, and the unit vectors cover the boundary where it stops.
contract NotionalLibFuzzTest is Test {
    NumericsHarness internal harness;

    function setUp() public {
        harness = new NumericsHarness();
    }

    function testFuzz_NotionalIsAdditiveInLots(uint64 lotsA, uint64 lotsB, int64 price, uint64 rawTick) public view {
        uint128 tickSize = uint128(rawTick) + 1;

        int256 combined = harness.fillNotional(uint128(lotsA) + uint128(lotsB), price, tickSize);

        assertEq(combined, harness.fillNotional(lotsA, price, tickSize) + harness.fillNotional(lotsB, price, tickSize));
    }

    function testFuzz_GrossNotionalIsTheMagnitudeAndSignFollowsPrice(uint64 lots, int64 price, uint64 rawTick)
        public
        view
    {
        uint128 tickSize = uint128(rawTick) + 1;

        int256 signed = harness.fillNotional(lots, price, tickSize);
        uint256 gross = harness.grossNotional(lots, price, tickSize);

        assertEq(gross, signed < 0 ? uint256(-signed) : uint256(signed));
        assertTrue(signed <= 0 || price > 0, "a positive notional requires a positive price");
        assertTrue(signed >= 0 || price < 0, "a negative notional requires a negative price");
    }
}
