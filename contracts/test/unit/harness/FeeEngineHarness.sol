// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {FeeEngineLib} from "../../../src/libraries/FeeEngineLib.sol";
import {FeeComputation, FeeRecipientSet, FeeRule} from "../../../src/types/FeeEngineTypes.sol";
import {FeeScheduleDefinition} from "../../../src/types/FeeScheduleDefinition.sol";

contract FeeEngineHarness {
    function validate(
        FeeScheduleDefinition calldata definition,
        FeeRule[] calldata rules,
        FeeRecipientSet calldata recipients
    ) external pure {
        FeeEngineLib.validateRules(definition, rules);
        FeeEngineLib.validateRecipients(recipients);
    }

    function hashRules(FeeRule[] calldata rules) external pure returns (bytes32) {
        return FeeEngineLib.hashRules(rules);
    }

    function hashRecipients(FeeRecipientSet calldata recipients) external pure returns (bytes32) {
        return FeeEngineLib.hashRecipients(recipients);
    }

    function compute(
        FeeScheduleDefinition calldata definition,
        FeeRule calldata rule,
        uint128 notionalMinor,
        uint128 volumeMinor
    ) external pure returns (FeeComputation memory) {
        return FeeEngineLib.compute(definition, rule, notionalMinor, volumeMinor);
    }

    function splitCharge(uint128 chargeMinor, FeeRecipientSet calldata recipients)
        external
        pure
        returns (uint128[] memory)
    {
        return FeeEngineLib.splitCharge(chargeMinor, recipients);
    }
}
