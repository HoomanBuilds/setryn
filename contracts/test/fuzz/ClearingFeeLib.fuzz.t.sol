// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ClearingFeeHarness} from "../unit/harness/ClearingFeeHarness.sol";
import {ClearingFeeFunding} from "../../src/types/ClearingTypes.sol";
import {FeeActionRequest} from "../../src/types/FeeEngineTypes.sol";
import {AccountId, CollateralLockId, FeeActionId, FeeScheduleId} from "../../src/types/Identifiers.sol";

contract ClearingFeeLibFuzzTest is Test {
    ClearingFeeHarness internal harness = new ClearingFeeHarness();

    function testFuzz_BuiltFeeRequestPreservesExactEconomics(uint128 notional, uint128 maximum, uint32 ordinal)
        public
        view
    {
        ClearingFeeFunding memory funding = ClearingFeeFunding({
            consumptionId: keccak256("consumption"),
            chargeLockId: CollateralLockId.wrap(keccak256("charge")),
            budgetLockId: CollateralLockId.wrap(keccak256("budget"))
        });
        FeeActionRequest memory request = harness.buildRequest(
            keccak256("fill"),
            FeeScheduleId.wrap(keccak256("schedule")),
            1,
            FeeActionId.wrap(keccak256("action")),
            AccountId.wrap(keccak256("payer")),
            notional,
            maximum,
            funding,
            ordinal
        );
        assertEq(request.notionalMinor, notional);
        assertEq(request.maxFeeMinor, maximum);
        assertEq(request.actionOrdinal, ordinal);
        assertEq(request.qualifyingVolumeMinor, 0);
    }
}
