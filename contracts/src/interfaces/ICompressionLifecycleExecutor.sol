// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    CompressionPlanId,
    CompressionPosition,
    CompressionSuccessor,
    ReplacementCollateral
} from "../types/CompressionTypes.sol";

interface ICompressionLifecycleExecutor {
    function executeCompression(
        CompressionPlanId planId,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral
    ) external returns (bytes32 outcomeHash);
}
