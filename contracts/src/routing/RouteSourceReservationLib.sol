// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RouteLib} from "../libraries/RouteLib.sol";
import {SolverRouteId} from "../types/AuctionTypes.sol";
import {CollateralLockId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {MakerQuoteId} from "../types/RfqTypes.sol";
import {
    CoincidencePlan,
    ExecutableRoute,
    RouteComponent,
    RouteId,
    RouteSourceKind,
    SourceReservationStatus,
    SourceRouteReservation
} from "../types/RoutingTypes.sol";
import {StreamId} from "../types/StreamTypes.sol";
import {RouteLiquidityDependencies} from "./RouteLiquidityTypes.sol";
import {RouteSourceValidationLib} from "./RouteSourceValidationLib.sol";
import "./ProtocolRouteLiquiditySource.sol";

/// Linked logic for the protocol route liquidity source: component and coincidence reservations, and closure.
/// Runs through DELEGATECALL in the liquidity source's context against its storage.
library RouteSourceReservationLib {
    function reserveComponents(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        mapping(CollateralLockId lockId => RouteId routeId) storage $lockRoutes,
        mapping(RouteId routeId => bytes32[] reservationKeys) storage $reservationKeys,
        mapping(RouteId routeId => CollateralLockId[] lockIds) storage $reservationLocks,
        mapping(RouteId routeId => RouteSourceKind[] sourceKinds) storage $sourceKinds,
        mapping(RouteId routeId => bytes32[] sourceIds) storage $sourceIds,
        mapping(RouteId routeId => bytes32[] reservationKeys) storage $sourceReservationKeys,
        RouteId routeId,
        ExecutableRoute calldata route,
        PackageLeg[] calldata packageLegs,
        RouteComponent[] calldata components
    ) external returns (bytes32 reservationHash) {
        if ($reservations[routeId] != bytes32(0)) {
            revert ProtocolRouteLiquiditySource.RouteAlreadyReserved(routeId);
        }
        RouteSourceValidationLib.validatePackage(deps, route, packageLegs);
        bytes32 snapshots;
        for (uint256 i; i < components.length; ++i) {
            bytes32 snapshot =
                RouteSourceValidationLib.validateComponent(deps, $reservations, routeId, route, components[i], i);
            if (snapshot != components[i].sourceSnapshotHash) {
                revert ProtocolRouteLiquiditySource.InvalidRouteSource(i);
            }
            snapshots = keccak256(abi.encode(snapshots, snapshot));
            _reserveSource(deps, $sourceKinds, $sourceIds, $sourceReservationKeys, routeId, components[i]);
            _reserveComponentLocks(deps, $lockRoutes, $reservationKeys, $reservationLocks, routeId, components[i]);
        }
        reservationHash = keccak256(
            abi.encode(block.chainid, address(this), RouteId.unwrap(routeId), RouteLib.hashRoute(route), snapshots)
        );
        $reservations[routeId] = reservationHash;
        emit ProtocolRouteLiquiditySource.RouteSourcesReserved(
            routeId, reservationHash, uint16($reservationLocks[routeId].length)
        );
    }

    function reserveCoincidence(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        mapping(RouteId routeId => RouteSourceKind[] sourceKinds) storage $sourceKinds,
        mapping(RouteId routeId => bytes32[] sourceIds) storage $sourceIds,
        mapping(RouteId routeId => bytes32[] reservationKeys) storage $sourceReservationKeys,
        RouteId routeId,
        CoincidencePlan calldata plan
    ) external returns (bytes32 reservationHash) {
        if (
            $reservations[routeId] != bytes32(0) || plan.leftReservationKey == bytes32(0)
                || plan.rightReservationKey == bytes32(0) || plan.leftReservationKey == plan.rightReservationKey
                || plan.intendedClearingConsumer == address(0) || plan.reservationExpiry <= block.timestamp
        ) revert ProtocolRouteLiquiditySource.RouteAlreadyReserved(routeId);
        deps.publicOrderBook
            .reserveForRoute(
                routeId,
                plan.leftOrderHash,
                plan.matchedLots,
                plan.reservationExpiry,
                plan.leftReservationKey,
                plan.intendedClearingConsumer
            );
        deps.publicOrderBook
            .reserveForRoute(
                routeId,
                plan.rightOrderHash,
                plan.matchedLots,
                plan.reservationExpiry,
                plan.rightReservationKey,
                plan.intendedClearingConsumer
            );
        $sourceKinds[routeId].push(RouteSourceKind.DirectPackageOrder);
        $sourceIds[routeId].push(plan.leftOrderHash);
        $sourceReservationKeys[routeId].push(plan.leftReservationKey);
        $sourceKinds[routeId].push(RouteSourceKind.DirectPackageOrder);
        $sourceIds[routeId].push(plan.rightOrderHash);
        $sourceReservationKeys[routeId].push(plan.rightReservationKey);
        reservationHash = keccak256(abi.encode(block.chainid, address(this), plan));
        $reservations[routeId] = reservationHash;
        emit ProtocolRouteLiquiditySource.RouteSourcesReserved(routeId, reservationHash, 0);
    }

    function _reserveComponentLocks(
        RouteLiquidityDependencies memory deps,
        mapping(CollateralLockId lockId => RouteId routeId) storage $lockRoutes,
        mapping(
            RouteId routeId => bytes32[] reservationKeys
        ) storage $reservationKeys,
        mapping(RouteId routeId => CollateralLockId[] lockIds) storage $reservationLocks,
        RouteId routeId,
        RouteComponent calldata component
    ) internal {
        bool hasLock;
        if (CollateralLockId.unwrap(component.capacityLockId) != bytes32(0)) {
            _reserveLock(
                deps,
                $lockRoutes,
                $reservationKeys,
                $reservationLocks,
                routeId,
                component.capacityLockId,
                keccak256(abi.encode(component.reservationKey, "CAPACITY"))
            );
            hasLock = true;
        }
        if (CollateralLockId.unwrap(component.fundingLockId) != bytes32(0)) {
            _reserveLock(
                deps,
                $lockRoutes,
                $reservationKeys,
                $reservationLocks,
                routeId,
                component.fundingLockId,
                keccak256(abi.encode(component.reservationKey, "FUNDING"))
            );
            hasLock = true;
        }
        if (!hasLock) revert ProtocolRouteLiquiditySource.InvalidRouteSource(type(uint256).max);
    }

    function _reserveSource(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => RouteSourceKind[] sourceKinds) storage $sourceKinds,
        mapping(RouteId routeId => bytes32[] sourceIds) storage $sourceIds,
        mapping(RouteId routeId => bytes32[] reservationKeys) storage $sourceReservationKeys,
        RouteId routeId,
        RouteComponent calldata component
    ) internal {
        if (
            component.sourceKind == RouteSourceKind.DirectPackageOrder
                || component.sourceKind == RouteSourceKind.SeriesBookHead
        ) {
            deps.publicOrderBook
                .reserveForRoute(
                    routeId,
                    component.orderHash,
                    component.componentLots,
                    component.expiry,
                    component.reservationKey,
                    component.intendedClearingConsumer
                );
        } else if (component.sourceKind == RouteSourceKind.RfqQuote) {
            deps.privateRfqBook
                .reserveForRoute(
                    routeId,
                    MakerQuoteId.wrap(component.sourceId),
                    component.componentLots,
                    component.expiry,
                    component.reservationKey,
                    component.intendedClearingConsumer
                );
        } else if (component.sourceKind == RouteSourceKind.StreamQuote) {
            deps.streamingQuoteEngine
                .reserveForRoute(
                    routeId,
                    StreamId.wrap(component.sourceId),
                    component.componentLots,
                    component.expiry,
                    component.reservationKey,
                    component.intendedClearingConsumer
                );
        } else if (component.sourceKind == RouteSourceKind.SolverRoute) {
            deps.sealedAuctionHouse
                .reserveForRoute(
                    routeId,
                    SolverRouteId.wrap(component.sourceId),
                    component.componentLots,
                    component.expiry,
                    component.reservationKey,
                    component.intendedClearingConsumer
                );
        } else {
            revert ProtocolRouteLiquiditySource.InvalidRouteSource(type(uint256).max);
        }
        $sourceKinds[routeId].push(component.sourceKind);
        $sourceIds[routeId].push(
            component.sourceKind == RouteSourceKind.DirectPackageOrder
                || component.sourceKind == RouteSourceKind.SeriesBookHead
                ? component.orderHash
                : component.sourceId
        );
        $sourceReservationKeys[routeId].push(component.reservationKey);
    }

    function _reserveLock(
        RouteLiquidityDependencies memory deps,
        mapping(CollateralLockId lockId => RouteId routeId) storage $lockRoutes,
        mapping(
            RouteId routeId => bytes32[] reservationKeys
        ) storage $reservationKeys,
        mapping(RouteId routeId => CollateralLockId[] lockIds) storage $reservationLocks,
        RouteId routeId,
        CollateralLockId lockId,
        bytes32 reservationKey
    ) internal {
        RouteId existing = $lockRoutes[lockId];
        if (RouteId.unwrap(existing) != bytes32(0)) {
            revert ProtocolRouteLiquiditySource.CapacityLockAlreadyReserved(lockId, existing);
        }
        $lockRoutes[lockId] = routeId;
        $reservationLocks[routeId].push(lockId);
        $reservationKeys[routeId].push(reservationKey);
        deps.reservationRegistry.claimCapacityReference(reservationKey, RouteId.unwrap(routeId), lockId);
    }

    function close(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        mapping(RouteId routeId => bool closed) storage $closed,
        mapping(CollateralLockId lockId => RouteId routeId) storage $lockRoutes,
        mapping(RouteId routeId => bytes32[] reservationKeys) storage $reservationKeys,
        mapping(RouteId routeId => CollateralLockId[] lockIds) storage $reservationLocks,
        mapping(RouteId routeId => RouteSourceKind[] sourceKinds) storage $sourceKinds,
        mapping(RouteId routeId => bytes32[] sourceIds) storage $sourceIds,
        mapping(RouteId routeId => bytes32[] reservationKeys) storage $sourceReservationKeys,
        RouteId routeId,
        bytes32 reservationHash,
        bytes32 closeReference,
        bool settled
    ) external {
        if (
            reservationHash == bytes32(0) || closeReference == bytes32(0) || $closed[routeId]
                || $reservations[routeId] != reservationHash
        ) revert ProtocolRouteLiquiditySource.RouteReservationMismatch(routeId);
        RouteSourceKind[] storage kinds = $sourceKinds[routeId];
        bytes32[] storage sourceIds = $sourceIds[routeId];
        bytes32[] storage sourceKeys = $sourceReservationKeys[routeId];
        for (uint256 i; i < kinds.length; ++i) {
            SourceRouteReservation memory sourceReservation = _sourceReservation(deps, kinds[i], sourceKeys[i]);
            if (
                RouteId.unwrap(sourceReservation.routeId) != RouteId.unwrap(routeId)
                    || sourceReservation.sourceId != sourceIds[i]
            ) {
                revert ProtocolRouteLiquiditySource.RouteReservationMismatch(routeId);
            }
            if (settled) {
                if (sourceReservation.status != SourceReservationStatus.Consumed) {
                    revert ProtocolRouteLiquiditySource.RouteReservationMismatch(routeId);
                }
            } else if (sourceReservation.status == SourceReservationStatus.Active) {
                _releaseSource(deps, kinds[i], sourceKeys[i], closeReference);
            } else if (
                sourceReservation.status != SourceReservationStatus.Released
                    && sourceReservation.status != SourceReservationStatus.Expired
            ) {
                revert ProtocolRouteLiquiditySource.RouteReservationMismatch(routeId);
            }
        }
        $closed[routeId] = true;
        bytes32[] storage keys = $reservationKeys[routeId];
        CollateralLockId[] storage locks = $reservationLocks[routeId];
        for (uint256 i; i < keys.length; ++i) {
            deps.reservationRegistry.closeCapacityReference(keys[i], closeReference);
            $lockRoutes[locks[i]] = RouteId.wrap(bytes32(0));
        }
        emit ProtocolRouteLiquiditySource.RouteSourcesClosed(routeId, reservationHash, closeReference);
    }

    function _releaseSource(
        RouteLiquidityDependencies memory deps,
        RouteSourceKind kind,
        bytes32 reservationKey,
        bytes32 releaseReference
    ) internal {
        if (kind == RouteSourceKind.DirectPackageOrder || kind == RouteSourceKind.SeriesBookHead) {
            deps.publicOrderBook.releaseRouteReservation(reservationKey, releaseReference);
        } else if (kind == RouteSourceKind.RfqQuote) {
            deps.privateRfqBook.releaseRouteReservation(reservationKey, releaseReference);
        } else if (kind == RouteSourceKind.StreamQuote) {
            deps.streamingQuoteEngine.releaseRouteReservation(reservationKey, releaseReference);
        } else if (kind == RouteSourceKind.SolverRoute) {
            deps.sealedAuctionHouse.releaseRouteReservation(reservationKey, releaseReference);
        } else {
            revert ProtocolRouteLiquiditySource.InvalidRouteSource(type(uint256).max);
        }
    }

    function _sourceReservation(RouteLiquidityDependencies memory deps, RouteSourceKind kind, bytes32 reservationKey)
        internal
        view
        returns (SourceRouteReservation memory)
    {
        if (kind == RouteSourceKind.DirectPackageOrder || kind == RouteSourceKind.SeriesBookHead) {
            return deps.publicOrderBook.getRouteReservation(reservationKey);
        }
        if (kind == RouteSourceKind.RfqQuote) return deps.privateRfqBook.getRouteReservation(reservationKey);
        if (kind == RouteSourceKind.StreamQuote) return deps.streamingQuoteEngine.getRouteReservation(reservationKey);
        if (kind == RouteSourceKind.SolverRoute) return deps.sealedAuctionHouse.getRouteReservation(reservationKey);
        revert ProtocolRouteLiquiditySource.InvalidRouteSource(type(uint256).max);
    }
}
