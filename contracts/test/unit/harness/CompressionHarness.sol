// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CompressionLib} from "../../../src/libraries/CompressionLib.sol";
import {
    CompressionConsent,
    CompressionPlanDefinition,
    CompressionPosition,
    CompressionSuccessor,
    ReplacementCollateral
} from "../../../src/types/CompressionTypes.sol";

contract CompressionHarness {
    function validateConservation(
        CompressionPlanDefinition calldata definition,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacement,
        CompressionConsent[] calldata consents
    ) external pure {
        CompressionLib.validateConservation(definition, inputs, successors, replacement, consents);
    }

    function hashInputs(CompressionPosition[] calldata inputs) external pure returns (bytes32) {
        return CompressionLib.hashInputs(inputs);
    }

    function hashSuccessors(CompressionSuccessor[] calldata successors) external pure returns (bytes32) {
        return CompressionLib.hashSuccessors(successors);
    }
}
