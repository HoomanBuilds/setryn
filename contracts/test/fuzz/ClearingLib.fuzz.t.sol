// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {FillId} from "../../src/types/Identifiers.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {ClearingHarness} from "../unit/harness/ClearingHarness.sol";

contract ClearingLibFuzzTest is Test {
    ClearingHarness internal harness = new ClearingHarness();

    function testFuzz_FillIdentityChangesWithCumulativeQuantity(
        bytes32 takerHash,
        bytes32 makerHash,
        uint128 cumulative,
        uint128 rawFill,
        int128 price,
        bytes32 witness
    ) public view {
        uint128 fillLots = uint128(bound(rawFill, 1, type(uint128).max));
        cumulative = uint128(bound(cumulative, 0, type(uint128).max - 1));
        uint128 secondCumulative = cumulative + 1;
        FillId first = harness.deriveFillId(
            42161,
            address(0x1234),
            takerHash,
            makerHash,
            Lots.wrap(cumulative),
            Lots.wrap(cumulative),
            Lots.wrap(fillLots),
            PriceTicks.wrap(price),
            witness
        );
        FillId second = harness.deriveFillId(
            42161,
            address(0x1234),
            takerHash,
            makerHash,
            Lots.wrap(secondCumulative),
            Lots.wrap(cumulative),
            Lots.wrap(fillLots),
            PriceTicks.wrap(price),
            witness
        );
        assertTrue(FillId.unwrap(first) != FillId.unwrap(second));
    }

    function testFuzz_FundingReferenceIsDeterministic(bytes32 orderHash, uint128 cumulative, bytes32 purpose)
        public
        view
    {
        bytes32 first = harness.deriveFundingReference(orderHash, cumulative, purpose);
        bytes32 second = harness.deriveFundingReference(orderHash, cumulative, purpose);
        assertEq(first, second);
    }
}
