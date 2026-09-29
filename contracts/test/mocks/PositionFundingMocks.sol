// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, AssetId, CollateralLockId} from "../../src/types/Identifiers.sol";

interface IPositionFundingLockVault {
    function createLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address settlementOperator
    ) external returns (CollateralLockId lockId);
    function releaseLock(CollateralLockId lockId) external;
}

/// Models the position engine's pre-trade funding locks: the engine is both operator and settlement operator of
/// every lock it creates, and only the requester that created a lock may release it.
contract PositionFundingEngineMock {
    error UnauthorizedPositionFundingRequester(CollateralLockId lockId, address expected, address actual);

    IPositionFundingLockVault public immutable collateralVault;
    mapping(CollateralLockId lockId => address requester) public positionFundingRequester;

    constructor(IPositionFundingLockVault collateralVault_) {
        collateralVault = collateralVault_;
    }

    function createPositionFundingLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry
    ) external returns (CollateralLockId lockId) {
        lockId = collateralVault.createLock(
            lockReference, accountId, assetId, bindingVersion, amount, expiry, address(this)
        );
        positionFundingRequester[lockId] = msg.sender;
    }

    function releasePositionFundingLock(CollateralLockId lockId) external {
        address requester = positionFundingRequester[lockId];
        if (requester == address(0) || requester != msg.sender) {
            revert UnauthorizedPositionFundingRequester(lockId, requester, msg.sender);
        }
        delete positionFundingRequester[lockId];
        collateralVault.releaseLock(lockId);
    }
}

/// Exposes the clearing engine's position engine binding, which channels resolve to create and release funding locks.
contract PositionFundingClearingEngineMock {
    address public immutable positionEngine;

    constructor(address positionEngine_) {
        positionEngine = positionEngine_;
    }
}
