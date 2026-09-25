// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {ICompressionAuthority} from "../interfaces/ICompressionAuthority.sol";
import {ILifecycleAccountAuthority} from "../interfaces/ILifecycleAccountAuthority.sol";
import {AccountId} from "../types/Identifiers.sol";

contract AccountPolicyAuthority is ILifecycleAccountAuthority, ICompressionAuthority {
    struct Delegation {
        bytes32 policyHash;
        uint64 operatorEpoch;
        uint64 validUntil;
        bool revoked;
    }

    ICollateralVault public immutable collateralVault;

    mapping(AccountId accountId => mapping(address signer => Delegation delegation)) private _delegations;
    mapping(address consumer => mapping(AccountId accountId => mapping(uint256 nonce => bool used))) private
        _compressionPolicyNonces;

    event AccountPolicyDelegated(
        AccountId indexed accountId,
        address indexed signer,
        bytes32 indexed policyHash,
        uint64 operatorEpoch,
        uint64 validUntil
    );
    event AccountPolicyRevoked(AccountId indexed accountId, address indexed signer, uint64 operatorEpoch);
    event CompressionPolicyNonceConsumed(
        address indexed consumer,
        AccountId indexed accountId,
        address indexed signer,
        bytes32 qualificationHash,
        uint256 policyNonce
    );

    error ZeroDependency();
    error DependencyHasNoCode();
    error UnauthorizedAccountController(address expected, address actual);
    error InvalidDelegation();

    constructor(ICollateralVault collateralVault_) {
        if (address(collateralVault_) == address(0)) revert ZeroDependency();
        if (address(collateralVault_).code.length == 0) revert DependencyHasNoCode();
        collateralVault = collateralVault_;
    }

    function delegatePolicy(AccountId accountId, address signer, bytes32 policyHash, uint64 validUntil) external {
        (address controller,) = collateralVault.getAccount(accountId);
        if (msg.sender != controller) revert UnauthorizedAccountController(controller, msg.sender);
        if (
            signer == address(0) || signer == controller || policyHash == bytes32(0) || validUntil <= block.timestamp
                || !collateralVault.isLockOperator(accountId, signer)
        ) revert InvalidDelegation();
        uint64 operatorEpoch = collateralVault.lockOperatorEpoch(accountId);
        _delegations[accountId][signer] =
            Delegation({policyHash: policyHash, operatorEpoch: operatorEpoch, validUntil: validUntil, revoked: false});
        emit AccountPolicyDelegated(accountId, signer, policyHash, operatorEpoch, validUntil);
    }

    function revokePolicy(AccountId accountId, address signer) external {
        (address controller,) = collateralVault.getAccount(accountId);
        if (msg.sender != controller) revert UnauthorizedAccountController(controller, msg.sender);
        Delegation storage delegation = _delegations[accountId][signer];
        delegation.revoked = true;
        emit AccountPolicyRevoked(accountId, signer, collateralVault.lockOperatorEpoch(accountId));
    }

    function isAuthorizedSigner(AccountId accountId, address signer) external view returns (bool) {
        (address controller,) = collateralVault.getAccount(accountId);
        return signer != address(0) && signer == controller;
    }

    function isAuthorizedSignerForPolicy(AccountId accountId, address signer, bytes32 policyContextHash)
        public
        view
        returns (bool)
    {
        (address controller,) = collateralVault.getAccount(accountId);
        if (signer != address(0) && signer == controller) return true;
        Delegation memory delegation = _delegations[accountId][signer];
        return policyContextHash != bytes32(0) && delegation.policyHash == policyContextHash && !delegation.revoked
            && delegation.validUntil >= block.timestamp
            && delegation.operatorEpoch == collateralVault.lockOperatorEpoch(accountId)
            && collateralVault.isLockOperator(accountId, signer);
    }

    function consumeAuthorizedSigner(
        AccountId accountId,
        address signer,
        bytes32 qualificationHash,
        uint256 policyNonce
    ) external returns (bool) {
        if (_compressionPolicyNonces[msg.sender][accountId][policyNonce]) return false;
        if (!isAuthorizedSignerForPolicy(accountId, signer, qualificationHash)) return false;
        _compressionPolicyNonces[msg.sender][accountId][policyNonce] = true;
        emit CompressionPolicyNonceConsumed(msg.sender, accountId, signer, qualificationHash, policyNonce);
        return true;
    }

    function delegationOf(AccountId accountId, address signer) external view returns (Delegation memory) {
        return _delegations[accountId][signer];
    }

    function compressionPolicyNonceUsed(address consumer, AccountId accountId, uint256 nonce)
        external
        view
        returns (bool)
    {
        return _compressionPolicyNonces[consumer][accountId][nonce];
    }
}
