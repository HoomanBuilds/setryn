// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ClearingFeeHarness} from "./harness/ClearingFeeHarness.sol";
import {ClearingFeeFunding} from "../../src/types/ClearingTypes.sol";
import {FeeActionRequest, FeeActionResult, FeeComputation, FeeLedgerEntry} from "../../src/types/FeeEngineTypes.sol";
import {AccountId, CollateralLockId, FeeActionId, FeeScheduleId} from "../../src/types/Identifiers.sol";
import {FeeRatePpm} from "../../src/types/Units.sol";

contract ClearingFeeLibTest is Test {
    ClearingFeeHarness internal harness = new ClearingFeeHarness();

    function test_RequestPinsSignedCapAndDoesNotTrustCallerVolume() public view {
        AccountId payer = AccountId.wrap(keccak256("payer"));
        ClearingFeeFunding memory funding = ClearingFeeFunding({
            consumptionId: keccak256("consumption"),
            chargeLockId: CollateralLockId.wrap(keccak256("charge")),
            budgetLockId: CollateralLockId.wrap(keccak256("budget"))
        });
        FeeActionRequest memory request = harness.buildRequest(
            keccak256("fill"),
            FeeScheduleId.wrap(keccak256("schedule")),
            7,
            FeeActionId.wrap(keccak256("maker")),
            payer,
            1_000,
            25,
            funding,
            0
        );
        assertEq(request.maxFeeMinor, 25);
        assertEq(request.qualifyingVolumeMinor, 0);
        assertEq(AccountId.unwrap(request.chargePayerAccountId), AccountId.unwrap(payer));
        assertEq(AccountId.unwrap(request.rebateRecipientAccountId), AccountId.unwrap(payer));
        assertEq(request.consumptionId, funding.consumptionId);
    }

    function test_ResultMustMatchExactConsumptionAndSchedule() public view {
        ClearingFeeFunding memory funding = _funding();
        harness.validateResult(_result(funding.consumptionId, 10), funding, _scheduleId(), 7, 10);
    }

    function test_ResultAboveSignedOrderCapReverts() public {
        ClearingFeeFunding memory funding = _funding();
        vm.expectRevert();
        harness.validateResult(_result(funding.consumptionId, 11), funding, _scheduleId(), 7, 10);
    }

    function _funding() private pure returns (ClearingFeeFunding memory) {
        return ClearingFeeFunding({
            consumptionId: keccak256("consumption"),
            chargeLockId: CollateralLockId.wrap(keccak256("charge")),
            budgetLockId: CollateralLockId.wrap(keccak256("budget"))
        });
    }

    function _result(bytes32 consumptionId, uint128 chargeMinor) private pure returns (FeeActionResult memory) {
        FeeComputation memory computation = FeeComputation({
            chargeMinor: chargeMinor,
            rebateMinor: 0,
            chargeRatePpm: FeeRatePpm.wrap(0),
            rebateRatePpm: FeeRatePpm.wrap(0),
            flatChargeMinor: chargeMinor,
            flatRebateMinor: 0,
            tierIndex: 0
        });
        return FeeActionResult({
            consumptionId: consumptionId,
            resultHash: keccak256("result"),
            feeScheduleId: _scheduleId(),
            feeScheduleVersion: 7,
            chargeMinor: chargeMinor,
            rebateMinor: 0,
            computation: computation,
            entries: new FeeLedgerEntry[](0)
        });
    }

    function _scheduleId() private pure returns (FeeScheduleId) {
        return FeeScheduleId.wrap(keccak256("schedule"));
    }
}
