// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    LifecycleAction,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";

interface ILifecyclePolicyValidator {
    function validateLifecycleAction(
        LifecycleAction calldata action,
        LifecyclePositionSnapshot[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements,
        LifecycleConsent[] calldata consents
    ) external view;
    function derivePolicyContext(
        LifecycleAction calldata action,
        LifecyclePositionSnapshot[] calldata inputs,
        LifecycleSuccessor[] calldata successors
    ) external view returns (bytes32 policyContextHash, bytes32 packageBreakPermissionHash);
}
