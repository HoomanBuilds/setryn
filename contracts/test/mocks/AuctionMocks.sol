// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAuctionValidationGate} from "../../src/interfaces/IAuctionValidationGate.sol";
import {IAuctionVault} from "../../src/interfaces/IAuctionVault.sol";
import {CollateralLock} from "../../src/types/CollateralTypes.sol";
import {LockStatus} from "../../src/types/Enums.sol";
import {AccountId, AdapterId, AssetId, CollateralId, CollateralLockId} from "../../src/types/Identifiers.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {
    AuctionDefinition,
    BidCommitAuthorization,
    SealedBid,
    SolverAction,
    SolverRoute
} from "../../src/types/AuctionTypes.sol";

contract AuctionVaultMock is IAuctionVault {
    mapping(CollateralLockId lockId => CollateralLock lock) private _locks;

    function createLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address settlementOperator
    ) external returns (CollateralLockId lockId) {
        lockId = deriveLockId(msg.sender, lockReference);
        _locks[lockId] = CollateralLock({
            accountId: accountId,
            collateralId: deriveCollateralId(assetId, bindingVersion),
            assetId: assetId,
            lockReference: lockReference,
            operator: msg.sender,
            bindingVersion: bindingVersion,
            expiry: expiry,
            settlementOperator: settlementOperator,
            status: LockStatus.Active,
            initialAmount: amount,
            remainingAmount: amount
        });
    }

    function releaseLock(CollateralLockId lockId) external {
        CollateralLock storage lock = _locks[lockId];
        require(msg.sender == lock.operator);
        require(block.timestamp < lock.expiry);
        lock.remainingAmount = 0;
        lock.status = LockStatus.Released;
    }

    function releaseExpiredLock(CollateralLockId lockId) external {
        CollateralLock storage lock = _locks[lockId];
        require(block.timestamp >= lock.expiry);
        lock.remainingAmount = 0;
        lock.status = LockStatus.Expired;
    }

    function consumeLock(CollateralLockId lockId, AccountId, uint128 amount) external {
        CollateralLock storage lock = _locks[lockId];
        require(msg.sender == lock.settlementOperator);
        require(block.timestamp < lock.expiry);
        require(amount <= lock.remainingAmount);
        lock.remainingAmount -= amount;
        if (lock.remainingAmount == 0) lock.status = LockStatus.Consumed;
    }

    function deriveLockId(address operator, bytes32 lockReference) public view returns (CollateralLockId) {
        return CollateralLockId.wrap(keccak256(abi.encode(block.chainid, address(this), operator, lockReference)));
    }

    function deriveCollateralId(AssetId assetId, uint32 bindingVersion) public view returns (CollateralId) {
        return CollateralId.wrap(keccak256(abi.encode(block.chainid, address(this), assetId, bindingVersion)));
    }

    function getLock(CollateralLockId lockId) external view returns (CollateralLock memory lock) {
        return _locks[lockId];
    }
}

contract AuctionValidationGateMock is IAuctionValidationGate {
    error UnsupportedGuarantee(bytes32 guaranteeClassId);
    error UnsupportedCapacityPolicy(bytes32 capacityPolicyHash);
    error IneligibleBidder(address bidder);
    error UnsupportedAdapter(AdapterId adapterId, bytes32 capabilityHash);

    mapping(bytes32 guaranteeClassId => bool supported) public guarantees;
    mapping(bytes32 capacityPolicyHash => bool supported) public capacityPolicies;
    mapping(AdapterId adapterId => mapping(bytes32 capabilityHash => bool supported)) public adapters;

    function setGuarantee(bytes32 guaranteeClassId, bool supported) external {
        guarantees[guaranteeClassId] = supported;
    }

    function setCapacityPolicy(bytes32 capacityPolicyHash, bool supported) external {
        capacityPolicies[capacityPolicyHash] = supported;
    }

    function setAdapter(AdapterId adapterId, bytes32 capabilityHash, bool supported) external {
        adapters[adapterId][capabilityHash] = supported;
    }

    function validateDefinition(AuctionDefinition calldata definition, PackageLeg[] calldata) external view {
        if (!guarantees[definition.guaranteeClassId]) revert UnsupportedGuarantee(definition.guaranteeClassId);
        if (!capacityPolicies[definition.capacityPolicyHash]) {
            revert UnsupportedCapacityPolicy(definition.capacityPolicyHash);
        }
    }

    function validateCommit(
        AuctionDefinition calldata,
        BidCommitAuthorization calldata authorization,
        bytes32[] calldata eligibilityProof
    ) external pure {
        if (eligibilityProof.length != 1 || eligibilityProof[0] != keccak256(abi.encode(authorization.bidder))) {
            revert IneligibleBidder(authorization.bidder);
        }
    }

    function validateBid(AuctionDefinition calldata, SealedBid calldata) external pure {}

    function validateRoute(
        AuctionDefinition calldata,
        SolverRoute calldata,
        PackageLeg[] calldata,
        SolverAction[] calldata actions
    ) external view {
        for (uint256 i; i < actions.length; ++i) {
            if (!adapters[actions[i].adapterId][actions[i].adapterCapabilityHash]) {
                revert UnsupportedAdapter(actions[i].adapterId, actions[i].adapterCapabilityHash);
            }
        }
    }
}
