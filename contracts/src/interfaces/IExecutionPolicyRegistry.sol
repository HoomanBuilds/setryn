// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {OrderActionId} from "../types/OrderTypes.sol";

interface IExecutionPolicyRegistry {
    function executionModeAllowed(bytes32 executionModeSetHash, bytes32 executionModeId) external view returns (bool);
    function orderActionAllowed(OrderActionId actionId) external view returns (bool);
    function policyTagAllowed(bytes32 policyKind, bytes32 policyTag) external view returns (bool);
    function eligible(bytes32 eligibilitySetHash, address participant, bytes32[] calldata proof)
        external
        view
        returns (bool);
}
