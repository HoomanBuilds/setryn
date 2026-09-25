// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import {IExecutionPolicyRegistry} from "../interfaces/IExecutionPolicyRegistry.sol";
import {OrderActionId} from "../types/OrderTypes.sol";

contract ExecutionPolicyRegistry is IExecutionPolicyRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("SETRYN_EXECUTION_POLICY_ADMIN_ROLE");

    mapping(bytes32 setHash => mapping(bytes32 modeId => bool allowed)) private _executionModes;
    mapping(OrderActionId actionId => bool allowed) private _orderActions;
    mapping(bytes32 kind => mapping(bytes32 tag => bool allowed)) private _policyTags;

    error ZeroInitialAdmin();
    error InvalidPolicyKey();

    event ExecutionModePermissionChanged(bytes32 indexed setHash, bytes32 indexed modeId, bool allowed);
    event OrderActionPermissionChanged(OrderActionId indexed actionId, bool allowed);
    event PolicyTagPermissionChanged(bytes32 indexed kind, bytes32 indexed tag, bool allowed);

    constructor(uint48 defaultAdminDelay, address initialAdmin)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {
        _grantRole(POLICY_ADMIN_ROLE, initialAdmin);
    }

    function setExecutionMode(bytes32 setHash, bytes32 modeId, bool allowed) external onlyRole(POLICY_ADMIN_ROLE) {
        if (setHash == bytes32(0) || modeId == bytes32(0)) revert InvalidPolicyKey();
        _executionModes[setHash][modeId] = allowed;
        emit ExecutionModePermissionChanged(setHash, modeId, allowed);
    }

    function setOrderAction(OrderActionId actionId, bool allowed) external onlyRole(POLICY_ADMIN_ROLE) {
        if (OrderActionId.unwrap(actionId) == bytes32(0)) revert InvalidPolicyKey();
        _orderActions[actionId] = allowed;
        emit OrderActionPermissionChanged(actionId, allowed);
    }

    function setPolicyTag(bytes32 kind, bytes32 tag, bool allowed) external onlyRole(POLICY_ADMIN_ROLE) {
        if (kind == bytes32(0) || tag == bytes32(0)) revert InvalidPolicyKey();
        _policyTags[kind][tag] = allowed;
        emit PolicyTagPermissionChanged(kind, tag, allowed);
    }

    function executionModeAllowed(bytes32 setHash, bytes32 modeId) external view returns (bool) {
        return _executionModes[setHash][modeId];
    }

    function orderActionAllowed(OrderActionId actionId) external view returns (bool) {
        return _orderActions[actionId];
    }

    function policyTagAllowed(bytes32 kind, bytes32 tag) external view returns (bool) {
        return _policyTags[kind][tag];
    }

    function eligible(bytes32 eligibilitySetHash, address participant, bytes32[] calldata proof)
        external
        pure
        returns (bool)
    {
        if (eligibilitySetHash == bytes32(0) || participant == address(0)) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(participant))));
        return MerkleProof.verifyCalldata(proof, eligibilitySetHash, leaf);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
