// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBatchCapacityManager} from "../interfaces/IBatchCapacityManager.sol";
import {ICapacityReservationRegistry} from "../interfaces/ICapacityReservationRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {CapacityLockLib} from "../libraries/CapacityLockLib.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {AuctionId, BidCommitmentId} from "../types/AuctionTypes.sol";
import {BatchCapacityDisposition, BatchExecutionId, BatchRemainderDisposition} from "../types/BatchTypes.sol";
import {CapacityConsumptionRecord, ManagedCapacity, ManagedCapacityStatus} from "../types/CapacityManagerTypes.sol";
import {CollateralLockId, FillId} from "../types/Identifiers.sol";
import {Lots} from "../types/Units.sol";

contract VaultBackedBatchCapacityManager is IBatchCapacityManager, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant BATCH_ENGINE_ROLE = keccak256("SETRYN_BATCH_ENGINE_ROLE");

    IPositionEngine public immutable positionEngine;
    ICollateralVault public immutable collateralVault;
    ICapacityReservationRegistry public immutable reservationRegistry;

    mapping(bytes32 allocationId => ManagedCapacity capacity) private _capacities;
    mapping(bytes32 allocationId => CapacityConsumptionRecord record) private _consumptions;
    mapping(bytes32 allocationId => BatchRemainderDisposition disposition) private _remainderDispositions;
    mapping(bytes32 allocationId => bytes32 reservationId) private _reservationIds;

    error ZeroInitialAdmin();
    error ZeroDependency(address dependency);
    error InvalidBatchCapacity();
    error BatchCapacityAlreadyExists(bytes32 allocationId);
    error UnknownBatchCapacity(bytes32 allocationId);
    error InvalidBatchCapacityState(bytes32 allocationId, ManagedCapacityStatus status);

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IPositionEngine positionEngine_,
        ICapacityReservationRegistry reservationRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(positionEngine_));
        _requireDependency(address(reservationRegistry_));
        positionEngine = positionEngine_;
        collateralVault = positionEngine_.collateralVault();
        _requireDependency(address(collateralVault));
        reservationRegistry = reservationRegistry_;
        _grantRole(BATCH_ENGINE_ROLE, initialAdmin);
    }

    function consumeBatchCapacity(
        BatchExecutionId batchExecutionId,
        bytes32 allocationId,
        BidCommitmentId bidId,
        Lots allocatedLots,
        bytes32 fundingHash,
        BatchCapacityDisposition calldata disposition
    ) external onlyRole(BATCH_ENGINE_ROLE) nonReentrant returns (bytes32 consumptionHash) {
        if (_capacities[allocationId].status != ManagedCapacityStatus.Unspecified) {
            revert BatchCapacityAlreadyExists(allocationId);
        }
        _validateDisposition(allocationId, disposition);
        CollateralLockId lockId = positionEngine.createPositionFundingLock(
            disposition.lockReference,
            disposition.accountId,
            disposition.collateralAssetId,
            disposition.collateralBindingVersion,
            disposition.reservedLiability,
            disposition.expiry
        );
        if (lockId != disposition.lockId) revert InvalidBatchCapacity();
        CapacityLockLib.requireExact(
            positionEngine,
            collateralVault,
            lockId,
            disposition.lockReference,
            disposition.accountId,
            disposition.collateralAssetId,
            disposition.collateralBindingVersion,
            disposition.reservedLiability,
            disposition.expiry,
            address(this)
        );
        reservationRegistry.claimCapacityReference(disposition.reservationId, allocationId, lockId);
        consumptionHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                BatchExecutionId.unwrap(batchExecutionId),
                allocationId,
                BidCommitmentId.unwrap(bidId),
                Lots.unwrap(allocatedLots),
                fundingHash,
                disposition
            )
        );
        _capacities[allocationId] = ManagedCapacity({
            owner: address(0),
            accountId: disposition.accountId,
            collateralAssetId: disposition.collateralAssetId,
            collateralId: collateralVault.deriveCollateralId(
                disposition.collateralAssetId, disposition.collateralBindingVersion
            ),
            riskDomainId: disposition.riskDomainId,
            lockId: lockId,
            lockReference: disposition.lockReference,
            collateralBindingVersion: disposition.collateralBindingVersion,
            riskDomainVersion: disposition.riskDomainVersion,
            expiry: disposition.expiry,
            status: ManagedCapacityStatus.Active,
            initialLiability: disposition.reservedLiability,
            remainingLiability: disposition.expectedRemainingLiability
        });
        _consumptions[allocationId] = CapacityConsumptionRecord({
            capacityId: allocationId,
            consumptionHash: consumptionHash,
            fillId: FillId.wrap(bytes32(0)),
            sequence: 1,
            liabilityConsumed: disposition.consumedLiability,
            remainingLiability: disposition.expectedRemainingLiability,
            finalized: false
        });
        _remainderDispositions[allocationId] = disposition.remainderDisposition;
        _reservationIds[allocationId] = disposition.reservationId;
    }

    function finalizeBatchCapacity(BatchExecutionId, bytes32 allocationId, FillId fillId, bytes32 consumptionHash)
        external
        onlyRole(BATCH_ENGINE_ROLE)
        nonReentrant
    {
        ManagedCapacity storage capacity = _requireActive(allocationId);
        CapacityConsumptionRecord storage record = _consumptions[allocationId];
        if (record.finalized || record.consumptionHash != consumptionHash || FillId.unwrap(fillId) == bytes32(0)) {
            revert InvalidBatchCapacity();
        }
        CapacityLockLib.requireExact(
            positionEngine,
            collateralVault,
            capacity.lockId,
            capacity.lockReference,
            capacity.accountId,
            capacity.collateralAssetId,
            capacity.collateralBindingVersion,
            capacity.initialLiability,
            capacity.expiry,
            address(this)
        );
        record.finalized = true;
        record.fillId = fillId;
        if (
            _remainderDispositions[allocationId] == BatchRemainderDisposition.ReleaseAfterFill
                || capacity.remainingLiability == 0
        ) {
            positionEngine.releasePositionFundingLock(capacity.lockId);
            reservationRegistry.closeCapacityReference(
                _reservationIds[allocationId], keccak256(abi.encode(allocationId, FillId.unwrap(fillId)))
            );
            capacity.status =
                capacity.remainingLiability == 0 ? ManagedCapacityStatus.Exhausted : ManagedCapacityStatus.Released;
        }
    }

    function expireBatchCapacity(bytes32 allocationId) external nonReentrant {
        ManagedCapacity storage capacity = _capacities[allocationId];
        if (capacity.status != ManagedCapacityStatus.Active || block.timestamp <= capacity.expiry) {
            revert InvalidBatchCapacityState(allocationId, capacity.status);
        }
        collateralVault.releaseExpiredLock(capacity.lockId);
        reservationRegistry.closeCapacityReference(
            _reservationIds[allocationId], keccak256(abi.encode("BATCH_EXPIRE", allocationId))
        );
        capacity.status = ManagedCapacityStatus.Expired;
    }

    function getBatchCapacity(bytes32 allocationId) external view returns (ManagedCapacity memory capacity) {
        capacity = _capacities[allocationId];
        if (capacity.status == ManagedCapacityStatus.Unspecified) revert UnknownBatchCapacity(allocationId);
    }

    function getBatchConsumption(bytes32 allocationId) external view returns (CapacityConsumptionRecord memory record) {
        record = _consumptions[allocationId];
    }

    function _validateDisposition(bytes32 allocationId, BatchCapacityDisposition calldata disposition) private view {
        if (
            allocationId == bytes32(0) || disposition.reservationId == bytes32(0)
                || disposition.lockReference == bytes32(0) || CollateralLockId.unwrap(disposition.lockId) == bytes32(0)
                || disposition.expiry <= block.timestamp
                || disposition.remainderDisposition == BatchRemainderDisposition.KeepReserved
        ) revert InvalidBatchCapacity();
        if (!collateralVault.riskDomainRegistry()
                .isOpenForNewRisk(disposition.riskDomainId, disposition.riskDomainVersion)) revert InvalidBatchCapacity();
        RiskDomainVersion memory risk =
            collateralVault.riskDomainRegistry().getRiskDomain(disposition.riskDomainId, disposition.riskDomainVersion);
        if (
            risk.definition.collateralAssetId != disposition.collateralAssetId
                || risk.definition.collateralAssetVersion != disposition.collateralBindingVersion
                || risk.definition.maxAccountReservationBaseUnits < disposition.reservedLiability
        ) revert InvalidBatchCapacity();
    }

    function _requireActive(bytes32 allocationId) private view returns (ManagedCapacity storage capacity) {
        capacity = _capacities[allocationId];
        if (capacity.status == ManagedCapacityStatus.Unspecified) revert UnknownBatchCapacity(allocationId);
        if (capacity.status != ManagedCapacityStatus.Active || block.timestamp >= capacity.expiry) {
            revert InvalidBatchCapacityState(allocationId, capacity.status);
        }
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
