// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICapacityReservationRegistry} from "../interfaces/ICapacityReservationRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IStreamCapacityManager} from "../interfaces/IStreamCapacityManager.sol";
import {CapacityLockLib} from "../libraries/CapacityLockLib.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {Side} from "../types/Enums.sol";
import {
    CapacityConsumptionRecord,
    ManagedCapacity,
    ManagedCapacityStatus,
    StreamCapacityState
} from "../types/CapacityManagerTypes.sol";
import {AssetId, CollateralLockId, FillId} from "../types/Identifiers.sol";
import {StreamCapacityConsumption, StreamId, StreamPolicy} from "../types/StreamTypes.sol";
import {Lots} from "../types/Units.sol";

contract VaultBackedStreamCapacityManager is IStreamCapacityManager, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant STREAM_ENGINE_ROLE = keccak256("SETRYN_STREAM_ENGINE_ROLE");

    IPositionEngine public immutable positionEngine;
    ICollateralVault public immutable collateralVault;
    ICapacityReservationRegistry public immutable reservationRegistry;

    mapping(StreamId streamId => StreamCapacityState state) private _states;
    mapping(StreamId streamId => mapping(uint64 sequence => CapacityConsumptionRecord record)) private _consumptions;
    mapping(StreamId streamId => bytes32 reservationKey) private _currentReservationKeys;
    mapping(StreamId streamId => uint128 liabilityPerLot) private _liabilityPerLot;
    mapping(StreamId streamId => uint128 maximumInventory) private _maximumInventory;

    error ZeroInitialAdmin();
    error ZeroDependency(address dependency);
    error InvalidCapacityPolicy();
    error CapacityAlreadyReserved(StreamId streamId);
    error UnknownCapacity(StreamId streamId);
    error InvalidCapacityState(StreamId streamId, ManagedCapacityStatus status);
    error InvalidCapacitySequence(uint64 expected, uint64 actual);
    error CapacityExceeded(uint128 remaining, uint128 requested);
    error InventoryExceeded(int128 inventory, uint128 maximum);
    error InvalidCapacityConsumption();

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
        _grantRole(STREAM_ENGINE_ROLE, initialAdmin);
    }

    function reserveStreamCapacity(StreamId streamId, StreamPolicy calldata policy)
        external
        onlyRole(STREAM_ENGINE_ROLE)
        nonReentrant
        returns (CollateralLockId lockId)
    {
        if (_states[streamId].capacity.status != ManagedCapacityStatus.Unspecified) {
            revert CapacityAlreadyReserved(streamId);
        }
        _validatePolicy(policy);
        bytes32 reservationKey = policy.capacityReservationId;
        bytes32 lockReference = _lockReference(streamId, reservationKey, 0);
        lockId = positionEngine.createPositionFundingLock(
            lockReference,
            policy.makerAccountId,
            policy.collateralAssetId,
            policy.collateralBindingVersion,
            policy.maximumLiability,
            policy.capacityExpiry
        );
        CapacityLockLib.requireExact(
            positionEngine,
            collateralVault,
            lockId,
            lockReference,
            policy.makerAccountId,
            policy.collateralAssetId,
            policy.collateralBindingVersion,
            policy.maximumLiability,
            policy.capacityExpiry,
            address(this)
        );
        reservationRegistry.claimCapacityReference(reservationKey, StreamId.unwrap(streamId), lockId);
        _currentReservationKeys[streamId] = reservationKey;
        _liabilityPerLot[streamId] = policy.liabilityPerLot;
        _maximumInventory[streamId] = policy.maximumAbsoluteInventoryLots;
        _states[streamId] = StreamCapacityState({
            capacity: ManagedCapacity({
                owner: policy.maker,
                accountId: policy.makerAccountId,
                collateralAssetId: policy.collateralAssetId,
                collateralId: collateralVault.deriveCollateralId(
                    policy.collateralAssetId, policy.collateralBindingVersion
                ),
                riskDomainId: policy.riskDomainId,
                lockId: lockId,
                lockReference: lockReference,
                collateralBindingVersion: policy.collateralBindingVersion,
                riskDomainVersion: policy.riskDomainVersion,
                expiry: policy.capacityExpiry,
                status: ManagedCapacityStatus.Active,
                initialLiability: policy.maximumLiability,
                remainingLiability: policy.maximumLiability
            }),
            streamId: streamId,
            consumedSequence: 0,
            inventoryLots: 0
        });
    }

    function consumeStreamCapacity(StreamId streamId, uint64 sequence, Side makerSide, Lots fillLots)
        external
        onlyRole(STREAM_ENGINE_ROLE)
        nonReentrant
        returns (StreamCapacityConsumption memory consumption)
    {
        StreamCapacityState storage state = _requireActive(streamId);
        if (sequence != state.consumedSequence + 1) {
            revert InvalidCapacitySequence(state.consumedSequence + 1, sequence);
        }
        uint256 liability = uint256(Lots.unwrap(fillLots)) * _liabilityPerLot[streamId];
        if (liability == 0 || liability > state.capacity.remainingLiability || liability > type(uint128).max) {
            revert CapacityExceeded(
                state.capacity.remainingLiability,
                uint128(liability > type(uint128).max ? type(uint128).max : liability)
            );
        }
        if (Lots.unwrap(fillLots) > uint128(type(int128).max)) revert InvalidCapacityConsumption();
        int256 delta = int256(uint256(Lots.unwrap(fillLots)));
        int256 widenedInventory = int256(state.inventoryLots);
        int256 computedInventory;
        if (makerSide == Side.Buy) computedInventory = widenedInventory + delta;
        else if (makerSide == Side.Sell) computedInventory = widenedInventory - delta;
        else revert InvalidCapacityConsumption();
        if (computedInventory < type(int128).min || computedInventory > type(int128).max) {
            revert InvalidCapacityConsumption();
        }
        int128 inventoryAfter = int128(computedInventory);
        if (_absolute(inventoryAfter) > _maximumInventory[streamId]) {
            revert InventoryExceeded(inventoryAfter, _maximumInventory[streamId]);
        }
        CapacityLockLib.requireExact(
            positionEngine,
            collateralVault,
            state.capacity.lockId,
            state.capacity.lockReference,
            state.capacity.accountId,
            state.capacity.collateralAssetId,
            state.capacity.collateralBindingVersion,
            state.capacity.remainingLiability,
            state.capacity.expiry,
            address(this)
        );
        uint128 consumed = uint128(liability);
        uint128 remaining = state.capacity.remainingLiability - consumed;
        bytes32 consumptionHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                StreamId.unwrap(streamId),
                sequence,
                state.capacity.lockId,
                state.capacity.remainingLiability,
                consumed,
                remaining,
                state.inventoryLots,
                inventoryAfter
            )
        );
        _consumptions[streamId][sequence] = CapacityConsumptionRecord({
            capacityId: StreamId.unwrap(streamId),
            consumptionHash: consumptionHash,
            fillId: FillId.wrap(bytes32(0)),
            sequence: sequence,
            liabilityConsumed: consumed,
            remainingLiability: remaining,
            finalized: false
        });
        consumption = StreamCapacityConsumption({
            inventoryBeforeLots: state.inventoryLots,
            inventoryAfterLots: inventoryAfter,
            liabilityConsumed: consumed,
            consumptionHash: consumptionHash
        });
        state.consumedSequence = sequence;
        state.inventoryLots = inventoryAfter;
        state.capacity.remainingLiability = remaining;
    }

    function finalizeStreamCapacity(StreamId streamId, uint64 sequence, bytes32 fillId, bytes32 consumptionHash)
        external
        onlyRole(STREAM_ENGINE_ROLE)
        nonReentrant
    {
        if (fillId == bytes32(0)) revert InvalidCapacityConsumption();
        StreamCapacityState storage state = _requireActive(streamId);
        CapacityConsumptionRecord storage record = _consumptions[streamId][sequence];
        if (record.finalized || record.consumptionHash != consumptionHash || state.consumedSequence != sequence) {
            revert InvalidCapacityConsumption();
        }
        uint128 lockedBefore = record.remainingLiability + record.liabilityConsumed;
        CapacityLockLib.requireExact(
            positionEngine,
            collateralVault,
            state.capacity.lockId,
            state.capacity.lockReference,
            state.capacity.accountId,
            state.capacity.collateralAssetId,
            state.capacity.collateralBindingVersion,
            lockedBefore,
            state.capacity.expiry,
            address(this)
        );
        record.finalized = true;
        record.fillId = FillId.wrap(fillId);
        _replaceLock(streamId, state, record.remainingLiability, consumptionHash);
    }

    function releaseStreamCapacity(StreamId streamId) external onlyRole(STREAM_ENGINE_ROLE) nonReentrant {
        StreamCapacityState storage state = _requireActive(streamId);
        _releaseLiveLock(streamId, state, keccak256(abi.encode("STREAM_CANCEL", StreamId.unwrap(streamId))));
        state.capacity.status = ManagedCapacityStatus.Released;
    }

    function expireStreamCapacity(StreamId streamId) external nonReentrant {
        StreamCapacityState storage state = _states[streamId];
        if (state.capacity.status != ManagedCapacityStatus.Active || block.timestamp <= state.capacity.expiry) {
            revert InvalidCapacityState(streamId, state.capacity.status);
        }
        collateralVault.releaseExpiredLock(state.capacity.lockId);
        reservationRegistry.closeCapacityReference(
            _currentReservationKeys[streamId], keccak256(abi.encode("STREAM_EXPIRE", StreamId.unwrap(streamId)))
        );
        state.capacity.status = ManagedCapacityStatus.Expired;
    }

    function getStreamCapacity(StreamId streamId) external view returns (StreamCapacityState memory state) {
        state = _states[streamId];
        if (state.capacity.status == ManagedCapacityStatus.Unspecified) revert UnknownCapacity(streamId);
    }

    function getStreamConsumption(StreamId streamId, uint64 sequence)
        external
        view
        returns (CapacityConsumptionRecord memory record)
    {
        record = _consumptions[streamId][sequence];
    }

    function _replaceLock(
        StreamId streamId,
        StreamCapacityState storage state,
        uint128 remaining,
        bytes32 closeReference
    ) private {
        _releaseLiveLock(streamId, state, closeReference);
        if (remaining == 0) {
            state.capacity.status = ManagedCapacityStatus.Exhausted;
            return;
        }
        bytes32 reservationKey = keccak256(
            abi.encode(state.capacity.lockReference, StreamId.unwrap(streamId), state.consumedSequence, remaining)
        );
        bytes32 lockReference = _lockReference(streamId, reservationKey, state.consumedSequence);
        CollateralLockId lockId = positionEngine.createPositionFundingLock(
            lockReference,
            state.capacity.accountId,
            state.capacity.collateralAssetId,
            state.capacity.collateralBindingVersion,
            remaining,
            state.capacity.expiry
        );
        reservationRegistry.claimCapacityReference(reservationKey, StreamId.unwrap(streamId), lockId);
        _currentReservationKeys[streamId] = reservationKey;
        state.capacity.lockId = lockId;
        state.capacity.lockReference = lockReference;
    }

    function _releaseLiveLock(StreamId streamId, StreamCapacityState storage state, bytes32 closeReference) private {
        positionEngine.releasePositionFundingLock(state.capacity.lockId);
        reservationRegistry.closeCapacityReference(_currentReservationKeys[streamId], closeReference);
    }

    function _validatePolicy(StreamPolicy calldata policy) private view {
        if (policy.capacityExpiry <= block.timestamp || policy.capacityExpiry < policy.expiry) {
            revert InvalidCapacityPolicy();
        }
        if (!collateralVault.riskDomainRegistry().isOpenForNewRisk(policy.riskDomainId, policy.riskDomainVersion)) {
            revert InvalidCapacityPolicy();
        }
        RiskDomainVersion memory risk =
            collateralVault.riskDomainRegistry().getRiskDomain(policy.riskDomainId, policy.riskDomainVersion);
        if (
            AssetId.unwrap(risk.definition.collateralAssetId) != AssetId.unwrap(policy.collateralAssetId)
                || risk.definition.collateralAssetVersion != policy.collateralBindingVersion
                || risk.definition.maxAccountReservationBaseUnits < policy.maximumLiability
        ) revert InvalidCapacityPolicy();
    }

    function _requireActive(StreamId streamId) private view returns (StreamCapacityState storage state) {
        state = _states[streamId];
        if (state.capacity.status == ManagedCapacityStatus.Unspecified) revert UnknownCapacity(streamId);
        if (state.capacity.status != ManagedCapacityStatus.Active || block.timestamp >= state.capacity.expiry) {
            revert InvalidCapacityState(streamId, state.capacity.status);
        }
    }

    function _lockReference(StreamId streamId, bytes32 reservationKey, uint64 sequence) private pure returns (bytes32) {
        return keccak256(abi.encode("SETRYN_STREAM_CAPACITY_V1", StreamId.unwrap(streamId), reservationKey, sequence));
    }

    function _absolute(int128 value) private pure returns (uint128) {
        int256 widened = int256(value);
        return uint128(uint256(widened < 0 ? -widened : widened));
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
