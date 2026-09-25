// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {LiquidationBidId} from "../../src/types/DefaultTypes.sol";
import {DefaultProcessHarness} from "../unit/harness/DefaultProcessHarness.sol";

contract DefaultProcessLibFuzzTest is Test {
    DefaultProcessHarness internal harness = new DefaultProcessHarness();

    function testFuzz_HigherContributionAlwaysWins(
        uint128 incumbentContribution,
        uint128 increment,
        uint128 candidateDiscount,
        uint128 incumbentDiscount
    ) public view {
        if (incumbentContribution == type(uint128).max) return;
        increment = uint128(bound(increment, 1, type(uint128).max - incumbentContribution));
        uint128 candidateContribution = incumbentContribution + increment;
        assertTrue(
            harness.isBetterBid(
                candidateContribution,
                candidateDiscount,
                LiquidationBidId.wrap(bytes32(uint256(2))),
                incumbentContribution,
                incumbentDiscount,
                LiquidationBidId.wrap(bytes32(uint256(1)))
            )
        );
    }

    function testFuzz_CommitmentIdBreaksExactTie(bytes32 firstRaw, bytes32 secondRaw) public view {
        vm.assume(firstRaw != secondRaw);
        LiquidationBidId first = LiquidationBidId.wrap(firstRaw);
        LiquidationBidId second = LiquidationBidId.wrap(secondRaw);
        bool firstWins = uint256(firstRaw) < uint256(secondRaw);
        assertEq(harness.isBetterBid(10, 1, first, 10, 1, second), firstWins);
    }
}
