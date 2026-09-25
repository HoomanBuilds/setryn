// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingFeeLib} from "../../../src/libraries/ClearingFeeLib.sol";
import {ClearingFeeFunding} from "../../../src/types/ClearingTypes.sol";
import {FeeActionRequest, FeeActionResult} from "../../../src/types/FeeEngineTypes.sol";
import {AccountId, FeeActionId, FeeScheduleId} from "../../../src/types/Identifiers.sol";

contract ClearingFeeHarness {
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
    ) external pure returns (FeeActionRequest memory) {
        return ClearingFeeLib.buildRequest(
            parentActionId,
            feeScheduleId,
            feeScheduleVersion,
            actionId,
            payerAccountId,
            notionalMinor,
            signedMaximum,
            funding,
            ordinal
        );
    }

    function validateResult(
        FeeActionResult calldata result,
        ClearingFeeFunding calldata funding,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        uint128 signedMaximum
    ) external pure {
        ClearingFeeLib.validateResult(result, funding, feeScheduleId, feeScheduleVersion, signedMaximum);
    }
}
