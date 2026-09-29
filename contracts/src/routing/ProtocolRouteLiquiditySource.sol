// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICapacityReservationRegistry} from "../interfaces/ICapacityReservationRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPrivateRfqBook} from "../interfaces/IPrivateRfqBook.sol";
import {IPublicOrderBook} from "../interfaces/IPublicOrderBook.sol";
import {IRouteLiquiditySource} from "../interfaces/IRouteLiquiditySource.sol";
import {ISealedAuctionHouse} from "../interfaces/ISealedAuctionHouse.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {IStreamingQuoteEngine} from "../interfaces/IStreamingQuoteEngine.sol";
import {RouteLib} from "../libraries/RouteLib.sol";
import {CollateralLockId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    CoincidencePlan,
    ExecutableRoute,
    RouteComponent,
    RouteId,
    RouteSourceKind,
    SourceRouteReservation
} from "../types/RoutingTypes.sol";

import {RouteSourceValidationLib} from "./RouteSourceValidationLib.sol";
import {RouteSourceReservationLib} from "./RouteSourceReservationLib.sol";
import {RouteLiquidityDependencies} from "./RouteLiquidityTypes.sol";

contract ProtocolRouteLiquiditySource is IRouteLiquiditySource, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant ROUTE_ENGINE_ROLE = keccak256("SETRYN_ROUTE_ENGINE_ROLE");

    IPublicOrderBook public immutable publicOrderBook;
    IPackageRegistry public immutable packageRegistry;
    IPrivateRfqBook public immutable privateRfqBook;
    IStreamingQuoteEngine public immutable streamingQuoteEngine;
    ISealedAuctionHouse public immutable sealedAuctionHouse;
    ICollateralVault public immutable collateralVault;
    ISessionRegistry public immutable sessionRegistry;
    ICapacityReservationRegistry public immutable reservationRegistry;

    mapping(RouteId routeId => bytes32 reservationHash) private _reservations;
    mapping(RouteId routeId => bool closed) private _closed;
    mapping(CollateralLockId lockId => RouteId routeId) private _lockRoutes;
    mapping(RouteId routeId => bytes32[] reservationKeys) private _reservationKeys;
    mapping(RouteId routeId => CollateralLockId[] lockIds) private _reservationLocks;
    mapping(RouteId routeId => RouteSourceKind[] sourceKinds) private _sourceKinds;
    mapping(RouteId routeId => bytes32[] sourceIds) private _sourceIds;
    mapping(RouteId routeId => bytes32[] reservationKeys) private _sourceReservationKeys;

    error ZeroInitialAdmin();
    error ZeroDependency(address dependency);
    error InvalidRouteSource(uint256 index);
    error RouteAlreadyReserved(RouteId routeId);
    error RouteReservationMismatch(RouteId routeId);
    error CapacityLockAlreadyReserved(CollateralLockId lockId, RouteId routeId);

    event RouteSourcesReserved(RouteId indexed routeId, bytes32 indexed reservationHash, uint16 lockCount);
    event RouteSourcesClosed(RouteId indexed routeId, bytes32 indexed reservationHash, bytes32 indexed closeReference);

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IPublicOrderBook publicOrderBook_,
        IPackageRegistry packageRegistry_,
        IPrivateRfqBook privateRfqBook_,
        IStreamingQuoteEngine streamingQuoteEngine_,
        ISealedAuctionHouse sealedAuctionHouse_,
        ICollateralVault collateralVault_,
        ISessionRegistry sessionRegistry_,
        ICapacityReservationRegistry reservationRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(publicOrderBook_));
        _requireDependency(address(packageRegistry_));
        _requireDependency(address(privateRfqBook_));
        _requireDependency(address(streamingQuoteEngine_));
        _requireDependency(address(sealedAuctionHouse_));
        _requireDependency(address(collateralVault_));
        _requireDependency(address(sessionRegistry_));
        _requireDependency(address(reservationRegistry_));
        publicOrderBook = publicOrderBook_;
        packageRegistry = packageRegistry_;
        privateRfqBook = privateRfqBook_;
        streamingQuoteEngine = streamingQuoteEngine_;
        sealedAuctionHouse = sealedAuctionHouse_;
        collateralVault = collateralVault_;
        sessionRegistry = sessionRegistry_;
        reservationRegistry = reservationRegistry_;
        _grantRole(ROUTE_ENGINE_ROLE, initialAdmin);
    }

    function validateComponents(
        RouteId routeId,
        ExecutableRoute calldata route,
        PackageLeg[] calldata packageLegs,
        RouteComponent[] calldata components
    ) external view returns (bytes32 currentSnapshotHash) {
        RouteSourceValidationLib.validatePackage(_dependencies(), route, packageLegs);
        for (uint256 i; i < components.length; ++i) {
            bytes32 snapshot = RouteSourceValidationLib.validateComponent(
                _dependencies(), _reservations, routeId, route, components[i], i
            );
            if (snapshot != components[i].sourceSnapshotHash) revert InvalidRouteSource(i);
        }
        return RouteLib.sourceSnapshotHash(components);
    }

    function reserveComponents(
        RouteId routeId,
        ExecutableRoute calldata route,
        PackageLeg[] calldata packageLegs,
        RouteComponent[] calldata components
    ) external onlyRole(ROUTE_ENGINE_ROLE) nonReentrant returns (bytes32 reservationHash) {
        return RouteSourceReservationLib.reserveComponents(
            _dependencies(),
            _reservations,
            _lockRoutes,
            _reservationKeys,
            _reservationLocks,
            _sourceKinds,
            _sourceIds,
            _sourceReservationKeys,
            routeId,
            route,
            packageLegs,
            components
        );
    }

    function componentsRemainExecutable(
        RouteId routeId,
        bytes32 reservationHash,
        ExecutableRoute calldata route,
        PackageLeg[] calldata packageLegs,
        RouteComponent[] calldata components
    ) external view returns (bool) {
        if (_closed[routeId] || _reservations[routeId] != reservationHash) {
            return false;
        }
        try this.validateComponents(routeId, route, packageLegs, components) returns (bytes32) {
            return true;
        } catch {
            return false;
        }
    }

    function settleComponents(RouteId routeId, bytes32 reservationHash, bytes32 settlementReference)
        external
        onlyRole(ROUTE_ENGINE_ROLE)
        nonReentrant
    {
        RouteSourceReservationLib.close(
            _dependencies(),
            _reservations,
            _closed,
            _lockRoutes,
            _reservationKeys,
            _reservationLocks,
            _sourceKinds,
            _sourceIds,
            _sourceReservationKeys,
            routeId,
            reservationHash,
            settlementReference,
            true
        );
    }

    function releaseComponents(RouteId routeId, bytes32 reservationHash, bytes32 releaseReference)
        external
        onlyRole(ROUTE_ENGINE_ROLE)
        nonReentrant
    {
        RouteSourceReservationLib.close(
            _dependencies(),
            _reservations,
            _closed,
            _lockRoutes,
            _reservationKeys,
            _reservationLocks,
            _sourceKinds,
            _sourceIds,
            _sourceReservationKeys,
            routeId,
            reservationHash,
            releaseReference,
            false
        );
    }

    function reserveCoincidence(RouteId routeId, CoincidencePlan calldata plan)
        external
        onlyRole(ROUTE_ENGINE_ROLE)
        nonReentrant
        returns (bytes32 reservationHash)
    {
        return RouteSourceReservationLib.reserveCoincidence(
            _dependencies(), _reservations, _sourceKinds, _sourceIds, _sourceReservationKeys, routeId, plan
        );
    }

    function _sourceReservation(RouteSourceKind kind, bytes32 reservationKey)
        private
        view
        returns (SourceRouteReservation memory)
    {
        if (kind == RouteSourceKind.DirectPackageOrder || kind == RouteSourceKind.SeriesBookHead) {
            return publicOrderBook.getRouteReservation(reservationKey);
        }
        if (kind == RouteSourceKind.RfqQuote) return privateRfqBook.getRouteReservation(reservationKey);
        if (kind == RouteSourceKind.StreamQuote) return streamingQuoteEngine.getRouteReservation(reservationKey);
        if (kind == RouteSourceKind.SolverRoute) return sealedAuctionHouse.getRouteReservation(reservationKey);
        revert InvalidRouteSource(type(uint256).max);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (RouteLiquidityDependencies memory) {
        return RouteLiquidityDependencies({
            publicOrderBook: publicOrderBook,
            packageRegistry: packageRegistry,
            privateRfqBook: privateRfqBook,
            streamingQuoteEngine: streamingQuoteEngine,
            sealedAuctionHouse: sealedAuctionHouse,
            collateralVault: collateralVault,
            sessionRegistry: sessionRegistry,
            reservationRegistry: reservationRegistry
        });
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
