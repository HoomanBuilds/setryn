// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleCollateralReplacement,
    LifecycleInput,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";

interface ILifecycleAtomicExecutor {
    function executeLifecycleAction(
        LifecycleActionId actionId,
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements
    ) external returns (bytes32 outcomeHash);
}
