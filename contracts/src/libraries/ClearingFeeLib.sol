// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingFeeFunding} from "../types/ClearingTypes.sol";
import {FeeActionRequest, FeeActionResult} from "../types/FeeEngineTypes.sol";
import {AccountId, FeeActionId, FeeScheduleId} from "../types/Identifiers.sol";

error ClearingFeeResultMismatch();

library ClearingFeeLib {
    function buildRequest(
        bytes32 parentActionId,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        FeeActionId actionId,
        AccountId payerAccountId,
        uint128 notionalMinor,
        uint128 signedMaximum,
        ClearingFeeFunding calldata funding,
        uint32 ordinal
    ) internal pure returns (FeeActionRequest memory request) {
        request = FeeActionRequest({
            parentActionId: parentActionId,
            consumptionId: funding.consumptionId,
            feeScheduleId: feeScheduleId,
            feeScheduleVersion: feeScheduleVersion,
            actionId: actionId,
            chargePayerAccountId: payerAccountId,
            rebateRecipientAccountId: payerAccountId,
            notionalMinor: notionalMinor,
            qualifyingVolumeMinor: 0,
            maxFeeMinor: signedMaximum,
            chargeLockId: funding.chargeLockId,
            budgetLockId: funding.budgetLockId,
            actionOrdinal: ordinal
        });
    }

    function validateResult(
        FeeActionResult memory result,
        ClearingFeeFunding calldata funding,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        uint128 signedMaximum
    ) internal pure {
        if (
            result.consumptionId != funding.consumptionId
                || FeeScheduleId.unwrap(result.feeScheduleId) != FeeScheduleId.unwrap(feeScheduleId)
                || result.feeScheduleVersion != feeScheduleVersion || result.chargeMinor > signedMaximum
                || result.resultHash == bytes32(0)
        ) revert ClearingFeeResultMismatch();
    }
}
