// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IStreamCapacityManager} from "../interfaces/IStreamCapacityManager.sol";
import {IStreamingQuoteEngine} from "../interfaces/IStreamingQuoteEngine.sol";
import {PackageDefinitionLib} from "../libraries/PackageDefinitionLib.sol";
import {StreamHashLib} from "../libraries/StreamHashLib.sol";
import {StreamPricingLib} from "../libraries/StreamPricingLib.sol";
import {
    BilateralMatch,
    ClearingChannelKind,
    PackageClearingRequest,
    SeriesClearingRequest
} from "../types/ClearingTypes.sol";
import {FillId} from "../types/Identifiers.sol";
import {CollateralLockId} from "../types/Identifiers.sol";
import {StreamCapacityState} from "../types/CapacityManagerTypes.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    StreamCapacityConsumption,
    StreamFill,
    StreamId,
    StreamLadderLevel,
    StreamPolicy,
    StreamSizeBand
} from "../types/StreamTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {RouteId, SourceReservationStatus, SourceRouteReservation} from "../types/RoutingTypes.sol";

contract StreamingQuoteEngine is IStreamingQuoteEngine, AccessControl, ReentrancyGuard {
    bytes32 public constant ROUTE_RESERVER_ROLE = keccak256("SETRYN_STREAM_ROUTE_RESERVER_ROLE");

    struct StreamRecord {
        StreamPolicy policy;
        uint64 nextSequence;
        bool active;
    }

    IAtomicClearingEngine private immutable _atomicClearingEngine;
    IStreamCapacityManager private immutable _capacityManager;

    mapping(StreamId streamId => StreamRecord record) private _streams;
    mapping(StreamId streamId => StreamSizeBand[] bands) private _sizeBands;
    mapping(StreamId streamId => StreamLadderLevel[] levels) private _ladders;
    mapping(address maker => mapping(uint256 nonce => bool used)) private _usedNonces;
    mapping(bytes32 ephemeralQuoteHash => bool used) private _usedEphemeralQuotes;
    mapping(bytes32 reservationKey => SourceRouteReservation reservation) private _routeReservations;
    mapping(StreamId streamId => bytes32 reservationKey) private _streamReservationKeys;

    constructor(IAtomicClearingEngine atomicClearingEngine_, IStreamCapacityManager capacityManager_) {
        _requireDependency(address(atomicClearingEngine_));
        _requireDependency(address(capacityManager_));
        _atomicClearingEngine = atomicClearingEngine_;
        _capacityManager = capacityManager_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ROUTE_RESERVER_ROLE, msg.sender);
    }

    function registerStream(
        StreamPolicy calldata policy,
        StreamSizeBand[] calldata sizeBands,
        StreamLadderLevel[] calldata ladder,
        bytes calldata signature
    ) external nonReentrant returns (StreamId streamId) {
        StreamHashLib.validate(policy, sizeBands, ladder);
        if (policy.expiry <= block.timestamp) revert InvalidQuoteWindow();
        streamId = StreamHashLib.streamId(policy, block.chainid, address(this));
        if (_streams[streamId].policy.maker != address(0)) revert DuplicateStream(streamId);
        if (_usedNonces[policy.maker][policy.nonce]) revert NonceAlreadyUsed(policy.maker, policy.nonce);
        bytes32 digest = StreamId.unwrap(streamId);
        if (!SignatureChecker.isValidSignatureNowCalldata(policy.maker, digest, signature)) {
            revert InvalidSignature(policy.maker, digest);
        }
        _capacityManager.reserveStreamCapacity(streamId, policy);
        _usedNonces[policy.maker][policy.nonce] = true;
        _streams[streamId] = StreamRecord({policy: policy, nextSequence: 1, active: true});
        for (uint256 i; i < sizeBands.length; ++i) {
            _sizeBands[streamId].push(sizeBands[i]);
        }
        for (uint256 i; i < ladder.length; ++i) {
            _ladders[streamId].push(ladder[i]);
        }
        emit StreamRegistered(
            streamId, policy.maker, policy.makerOrderHash, StreamHashLib.hashPolicy(policy), policy.expiry
        );
    }

    function cancelStream(StreamId streamId) external nonReentrant {
        StreamRecord storage record = _requireStream(streamId);
        if (msg.sender != record.policy.maker) revert UnauthorizedExecutor(record.policy.maker, msg.sender);
        if (!record.active) revert StreamNotLive(streamId);
        bytes32 reservationKey = _streamReservationKeys[streamId];
        if (reservationKey != bytes32(0)) {
            _closeRouteReservation(
                reservationKey,
                SourceReservationStatus.Released,
                keccak256(abi.encode("STREAM_SIGNED_CANCEL", StreamId.unwrap(streamId)))
            );
        }
        record.active = false;
        _capacityManager.releaseStreamCapacity(streamId);
        emit StreamCancelled(streamId, msg.sender);
    }

    function expireStream(StreamId streamId) external nonReentrant {
        StreamRecord storage record = _requireStream(streamId);
        if (!record.active || block.timestamp <= record.policy.expiry) revert StreamNotLive(streamId);
        bytes32 reservationKey = _streamReservationKeys[streamId];
        if (reservationKey != bytes32(0)) {
            _closeRouteReservation(
                reservationKey,
                SourceReservationStatus.Expired,
                keccak256(abi.encode("STREAM_EXPIRED", StreamId.unwrap(streamId)))
            );
        }
        record.active = false;
        _capacityManager.expireStreamCapacity(streamId);
        emit StreamCancelled(streamId, msg.sender);
    }

    function streamExecutable(StreamId streamId) external view returns (bool) {
        StreamRecord storage record = _streams[streamId];
        return record.active && block.timestamp >= record.policy.validAfter && block.timestamp <= record.policy.expiry;
    }

    function previewFirmQuote(StreamId streamId, Lots fillLots)
        external
        view
        returns (
            PriceTicks priceTicks,
            uint64 sequence,
            CollateralLockId capacityLockId,
            uint128 remainingLiability,
            bytes32 snapshotHash
        )
    {
        StreamRecord storage record = _requireStream(streamId);
        if (!record.active || block.timestamp < record.policy.validAfter || block.timestamp > record.policy.expiry) {
            revert StreamNotLive(streamId);
        }
        StreamCapacityState memory capacity = _capacityManager.getStreamCapacity(streamId);
        priceTicks = StreamPricingLib.quote(
            record.policy, _sizeBands[streamId], _ladders[streamId], fillLots, capacity.inventoryLots
        );
        sequence = record.nextSequence;
        capacityLockId = capacity.capacity.lockId;
        remainingLiability = capacity.capacity.remainingLiability;
        snapshotHash = keccak256(
            abi.encode(
                StreamId.unwrap(streamId),
                StreamHashLib.hashPolicy(record.policy),
                sequence,
                fillLots,
                priceTicks,
                capacityLockId,
                remainingLiability,
                capacity.inventoryLots
            )
        );
    }

    function reserveForRoute(
        RouteId routeId,
        StreamId streamId,
        Lots quantity,
        uint64 expiry,
        bytes32 reservationKey,
        address clearingConsumer
    ) external onlyRole(ROUTE_RESERVER_ROLE) nonReentrant {
        uint128 requested = Lots.unwrap(quantity);
        StreamRecord storage record = _requireStream(streamId);
        if (
            RouteId.unwrap(routeId) == bytes32(0) || reservationKey == bytes32(0)
                || clearingConsumer != record.policy.permittedExecutor || requested == 0 || expiry <= block.timestamp
                || !record.active || expiry > record.policy.expiry
                || _routeReservations[reservationKey].status != SourceReservationStatus.Unspecified
                || _streamReservationKeys[streamId] != bytes32(0)
        ) revert InvalidRouteReservation();
        StreamCapacityState memory capacity = _capacityManager.getStreamCapacity(streamId);
        uint256 liability = uint256(requested) * record.policy.liabilityPerLot;
        if (liability == 0 || liability > capacity.capacity.remainingLiability) revert InvalidRouteReservation();
        StreamPricingLib.quote(
            record.policy, _sizeBands[streamId], _ladders[streamId], quantity, capacity.inventoryLots
        );
        _streamReservationKeys[streamId] = reservationKey;
        _routeReservations[reservationKey] = SourceRouteReservation({
            routeId: routeId,
            sourceId: StreamId.unwrap(streamId),
            reservationKey: reservationKey,
            clearingConsumer: clearingConsumer,
            quantity: quantity,
            expiry: expiry,
            status: SourceReservationStatus.Active
        });
        emit StreamRouteReserved(streamId, routeId, reservationKey, quantity, expiry, clearingConsumer);
    }

    function releaseRouteReservation(bytes32 reservationKey, bytes32 releaseReference)
        external
        onlyRole(ROUTE_RESERVER_ROLE)
        nonReentrant
    {
        if (releaseReference == bytes32(0)) revert InvalidRouteReservation();
        _closeRouteReservation(reservationKey, SourceReservationStatus.Released, releaseReference);
    }

    function expireRouteReservation(bytes32 reservationKey) external nonReentrant {
        SourceRouteReservation storage reservation = _routeReservations[reservationKey];
        if (reservation.status != SourceReservationStatus.Active || block.timestamp <= reservation.expiry) {
            revert InvalidRouteReservation();
        }
        _closeRouteReservation(
            reservationKey,
            SourceReservationStatus.Expired,
            keccak256(abi.encode("STREAM_ROUTE_EXPIRED", reservationKey))
        );
    }

    function getRouteReservation(bytes32 reservationKey)
        external
        view
        returns (SourceRouteReservation memory reservation)
    {
        reservation = _routeReservations[reservationKey];
        if (reservation.status == SourceReservationStatus.Unspecified) revert InvalidRouteReservation();
    }

    function fillSeries(StreamFill calldata fill, SeriesClearingRequest calldata request)
        external
        nonReentrant
        returns (FillId fillId)
    {
        StreamRecord storage record = _prepareFill(fill);
        if (record.policy.targetKind != OrderTargetKind.Series || request.channelKind != ClearingChannelKind.Direct) {
            revert ClearingRequestMismatch();
        }
        StreamCapacityConsumption memory consumption = _consumeCapacityAndValidatePrice(record, fill);
        _validateMatch(
            record.policy,
            fill,
            request.matchData.takerOrderHash,
            request.matchData.makerOrderHash,
            request.matchData.fillLots,
            request.matchData.executionPriceTicks,
            _fundingHash(request.matchData)
        );
        bytes32 quoteHash = _consumeEphemeralQuote(record.policy, fill, consumption);
        fillId = _atomicClearingEngine.clearSeries(request);
        _finalize(fill, fillId, quoteHash, consumption);
    }

    function fillPackage(
        StreamFill calldata fill,
        PackageLeg[] calldata packageLegs,
        PackageClearingRequest calldata request
    ) external nonReentrant returns (FillId fillId) {
        StreamRecord storage record = _prepareFill(fill);
        if (
            record.policy.targetKind != OrderTargetKind.Package || request.channelKind != ClearingChannelKind.Direct
                || PackageDefinitionLib.hashLegs(packageLegs) != record.policy.packageWitnessHash
                || PackageDefinitionLib.hashLegs(request.legs) != record.policy.packageWitnessHash
        ) revert ClearingRequestMismatch();
        StreamCapacityConsumption memory consumption = _consumeCapacityAndValidatePrice(record, fill);
        _validateMatch(
            record.policy,
            fill,
            request.matchData.takerOrderHash,
            request.matchData.makerOrderHash,
            request.matchData.fillLots,
            request.matchData.executionPriceTicks,
            _fundingHash(request.matchData)
        );
        bytes32 quoteHash = _consumeEphemeralQuote(record.policy, fill, consumption);
        fillId = _atomicClearingEngine.clearPackage(request);
        _finalize(fill, fillId, quoteHash, consumption);
    }

    function atomicClearingEngine() external view returns (IAtomicClearingEngine) {
        return _atomicClearingEngine;
    }

    function capacityManager() external view returns (IStreamCapacityManager) {
        return _capacityManager;
    }

    function nextSequence(StreamId streamId) external view returns (uint64) {
        return _streams[streamId].nextSequence;
    }

    function getPolicy(StreamId streamId) external view returns (StreamPolicy memory) {
        return _requireStream(streamId).policy;
    }

    function streamActive(StreamId streamId) external view returns (bool) {
        return _requireStream(streamId).active;
    }

    function _prepareFill(StreamFill calldata fill) private returns (StreamRecord storage record) {
        record = _requireStream(fill.streamId);
        StreamPolicy storage policy = record.policy;
        if (!record.active || block.timestamp < policy.validAfter || block.timestamp > policy.expiry) {
            revert StreamNotLive(fill.streamId);
        }
        if (msg.sender != policy.permittedExecutor) {
            revert UnauthorizedExecutor(policy.permittedExecutor, msg.sender);
        }
        bytes32 reservationKey = _streamReservationKeys[fill.streamId];
        if (reservationKey != bytes32(0)) {
            SourceRouteReservation storage reservation = _routeReservations[reservationKey];
            if (
                reservation.status != SourceReservationStatus.Active || reservation.clearingConsumer != msg.sender
                    || Lots.unwrap(reservation.quantity) != Lots.unwrap(fill.fillLots)
                    || block.timestamp > reservation.expiry
            ) revert InvalidRouteReservation();
            _closeRouteReservation(
                reservationKey,
                SourceReservationStatus.Consumed,
                keccak256(abi.encode("STREAM_ROUTE_CONSUMED", StreamId.unwrap(fill.streamId), fill.sequence))
            );
        }
        if (fill.sequence != record.nextSequence) revert InvalidSequence(record.nextSequence, fill.sequence);
        uint256 refreshEnds = uint256(fill.refreshedAt) + policy.refreshInterval;
        uint256 exactQuoteDeadline = uint256(fill.refreshedAt) + policy.quoteLifetime;
        if (exactQuoteDeadline > policy.expiry) exactQuoteDeadline = policy.expiry;
        if (
            fill.refreshedAt < policy.validAfter || fill.refreshedAt > block.timestamp || block.timestamp >= refreshEnds
                || fill.quoteDeadline != exactQuoteDeadline || block.timestamp > fill.quoteDeadline
                || fill.takerOrderHash == bytes32(0) || Lots.unwrap(fill.fillLots) == 0
        ) revert InvalidQuoteWindow();
        record.nextSequence += 1;
    }

    function _consumeCapacityAndValidatePrice(StreamRecord storage record, StreamFill calldata fill)
        private
        returns (StreamCapacityConsumption memory consumption)
    {
        consumption = _capacityManager.consumeStreamCapacity(
            fill.streamId, fill.sequence, record.policy.makerSide, fill.fillLots
        );
        if (
            consumption.consumptionHash == bytes32(0) || consumption.liabilityConsumed == 0
                || _absolute(consumption.inventoryAfterLots) > record.policy.maximumAbsoluteInventoryLots
        ) revert ClearingRequestMismatch();
        PriceTicks price = StreamPricingLib.quote(
            record.policy,
            _sizeBands[fill.streamId],
            _ladders[fill.streamId],
            fill.fillLots,
            consumption.inventoryBeforeLots
        );
        if (PriceTicks.unwrap(price) != PriceTicks.unwrap(fill.expectedPriceTicks)) {
            revert QuotePriceMismatch(PriceTicks.unwrap(price), PriceTicks.unwrap(fill.expectedPriceTicks));
        }
    }

    function _validateMatch(
        StreamPolicy storage policy,
        StreamFill calldata fill,
        bytes32 takerOrderHash,
        bytes32 makerOrderHash,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        bytes32 fundingHash
    ) private view {
        if (
            takerOrderHash != fill.takerOrderHash || makerOrderHash != policy.makerOrderHash
                || Lots.unwrap(fillLots) != Lots.unwrap(fill.fillLots)
                || PriceTicks.unwrap(executionPriceTicks) != PriceTicks.unwrap(fill.expectedPriceTicks)
        ) revert ClearingRequestMismatch();
        if (fundingHash != fill.fundingHash) revert FundingHashMismatch(fill.fundingHash, fundingHash);
    }

    function _consumeEphemeralQuote(
        StreamPolicy storage policy,
        StreamFill calldata fill,
        StreamCapacityConsumption memory consumption
    ) private returns (bytes32 quoteHash) {
        quoteHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                StreamId.unwrap(fill.streamId),
                fill.sequence,
                fill.refreshedAt,
                fill.quoteDeadline,
                fill.takerOrderHash,
                policy.makerOrderHash,
                fill.fillLots,
                fill.expectedPriceTicks,
                fill.fundingHash,
                consumption
            )
        );
        if (_usedEphemeralQuotes[quoteHash]) revert EphemeralQuoteAlreadyUsed(quoteHash);
        _usedEphemeralQuotes[quoteHash] = true;
    }

    function _finalize(
        StreamFill calldata fill,
        FillId fillId,
        bytes32 quoteHash,
        StreamCapacityConsumption memory consumption
    ) private {
        _capacityManager.finalizeStreamCapacity(
            fill.streamId, fill.sequence, FillId.unwrap(fillId), consumption.consumptionHash
        );
        emit StreamQuoteFilled(
            fill.streamId,
            fill.sequence,
            quoteHash,
            fillId,
            consumption.inventoryBeforeLots,
            consumption.inventoryAfterLots
        );
    }

    function _fundingHash(BilateralMatch calldata matchData) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                matchData.takerFunding,
                matchData.makerFunding,
                matchData.takerFeeFunding,
                matchData.makerFeeFunding,
                matchData.longAdmissionId,
                matchData.longAdmissionResultHash,
                matchData.shortAdmissionId,
                matchData.shortAdmissionResultHash
            )
        );
    }

    function _requireStream(StreamId streamId) private view returns (StreamRecord storage record) {
        record = _streams[streamId];
        if (record.policy.maker == address(0)) revert UnknownStream(streamId);
    }

    function _closeRouteReservation(bytes32 reservationKey, SourceReservationStatus status, bytes32 closeReference)
        private
    {
        SourceRouteReservation storage reservation = _routeReservations[reservationKey];
        if (reservation.status != SourceReservationStatus.Active || closeReference == bytes32(0)) {
            revert InvalidRouteReservation();
        }
        StreamId streamId = StreamId.wrap(reservation.sourceId);
        _streamReservationKeys[streamId] = bytes32(0);
        reservation.status = status;
        emit StreamRouteReservationClosed(streamId, reservation.routeId, reservationKey, uint8(status), closeReference);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }

    function _absolute(int128 value) private pure returns (uint128) {
        int256 widened = int256(value);
        return uint128(uint256(widened < 0 ? -widened : widened));
    }
}
