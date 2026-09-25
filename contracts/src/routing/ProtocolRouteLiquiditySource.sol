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
import {
    AuctionTargetKind,
    AuctionVersion,
    AuctionClearingResult,
    BidRecord,
    BidStatus,
    SolverRouteId,
    SolverRouteRecord
} from "../types/AuctionTypes.sol";
import {BookIdentity, BookLiquidityKind, BookOrder, BookOrderStatus, PriceLevel} from "../types/BookTypes.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {LockStatus, Side} from "../types/Enums.sol";
import {AccountId, BookId, CollateralLockId, PackageId, SeriesId} from "../types/Identifiers.sol";
import {OrderRecord, OrderStatus, OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";
import {
    FirmCapacityRecord,
    FirmCapacityStatus,
    MakerQuoteId,
    MakerQuoteRecord,
    MakerQuoteStatus,
    RfqTargetKind
} from "../types/RfqTypes.sol";
import {ExecutableRoute, RouteComponent, RouteId, RouteSourceKind} from "../types/RoutingTypes.sol";
import {StreamId, StreamPolicy} from "../types/StreamTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

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
        RouteId,
        ExecutableRoute calldata route,
        PackageLeg[] calldata packageLegs,
        RouteComponent[] calldata components
    ) external view returns (bytes32 currentSnapshotHash) {
        _validatePackage(route, packageLegs);
        for (uint256 i; i < components.length; ++i) {
            bytes32 snapshot = _validateComponent(route, components[i], i);
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
        if (_reservations[routeId] != bytes32(0)) revert RouteAlreadyReserved(routeId);
        _validatePackage(route, packageLegs);
        bytes32 snapshots;
        for (uint256 i; i < components.length; ++i) {
            bytes32 snapshot = _validateComponent(route, components[i], i);
            if (snapshot != components[i].sourceSnapshotHash) revert InvalidRouteSource(i);
            snapshots = keccak256(abi.encode(snapshots, snapshot));
            _reserveComponentLocks(routeId, components[i]);
        }
        reservationHash = keccak256(
            abi.encode(block.chainid, address(this), RouteId.unwrap(routeId), RouteLib.hashRoute(route), snapshots)
        );
        _reservations[routeId] = reservationHash;
        emit RouteSourcesReserved(routeId, reservationHash, uint16(_reservationLocks[routeId].length));
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
        _close(routeId, reservationHash, settlementReference);
    }

    function releaseComponents(RouteId routeId, bytes32 reservationHash, bytes32 releaseReference)
        external
        onlyRole(ROUTE_ENGINE_ROLE)
        nonReentrant
    {
        _close(routeId, reservationHash, releaseReference);
    }

    function _validatePackage(ExecutableRoute calldata route, PackageLeg[] calldata packageLegs) private view {
        PackageVersion memory package = packageRegistry.getPackage(route.packageId, route.packageVersion);
        if (
            package.definition.legsHash != route.packageWitnessHash
                || packageRegistry.hashLegs(packageLegs) != route.packageWitnessHash
                || packageRegistry.activeVersion(route.packageId) != route.packageVersion
                || !packageRegistry.isOpenForNewRisk(
                    route.packageId, route.packageVersion, packageLegs, uint32(block.timestamp / 1 days)
                )
        ) revert InvalidRouteSource(type(uint256).max);
    }

    function _validateComponent(ExecutableRoute calldata route, RouteComponent calldata component, uint256 index)
        private
        view
        returns (bytes32 snapshot)
    {
        if (
            component.sourceBlock == 0 || component.sourceBlock > block.number || component.expiry < block.timestamp
                || !sessionRegistry.isOpenForNewRisk(
                    component.sessionId, component.sessionVersion, uint32(block.timestamp / 1 days)
                )
        ) revert InvalidRouteSource(index);
        if (component.sourceKind == RouteSourceKind.DirectPackageOrder) {
            return _validateBook(route, component, true, index);
        }
        if (component.sourceKind == RouteSourceKind.SeriesBookHead) {
            return _validateBook(route, component, false, index);
        }
        if (component.sourceKind == RouteSourceKind.RfqQuote) return _validateRfq(route, component, index);
        if (component.sourceKind == RouteSourceKind.StreamQuote) return _validateStream(component, index);
        if (component.sourceKind == RouteSourceKind.SolverRoute) return _validateSolver(route, component, index);
        revert InvalidRouteSource(index);
    }

    function _validateBook(
        ExecutableRoute calldata route,
        RouteComponent calldata component,
        bool packageTarget,
        uint256 index
    ) private view returns (bytes32 snapshot) {
        BookId bookId = BookId.wrap(component.sourceId);
        BookIdentity memory book = publicOrderBook.getBook(bookId);
        BookOrder memory order = publicOrderBook.getBookOrder(component.orderHash);
        Side makerSide = component.side == Side.Buy ? Side.Sell : Side.Buy;
        bytes32 bestLevelId = publicOrderBook.bestLevel(bookId, makerSide);
        PriceLevel memory level = publicOrderBook.getPriceLevel(bestLevelId);
        OrderRecord memory authorization = publicOrderBook.orderState().getOrder(component.orderHash);
        uint128 authorizedLots = Lots.unwrap(authorization.order.lots);
        uint128 filledLots = Lots.unwrap(authorization.filledLots);
        bool targetMatches = packageTarget
            ? book.targetKind == OrderTargetKind.Package && book.targetId == PackageId.unwrap(route.packageId)
                && book.targetVersion == route.packageVersion && book.packageLegsHash == route.packageWitnessHash
            : book.targetKind == OrderTargetKind.Series && book.targetId == SeriesId.unwrap(component.seriesId)
                && book.targetVersion == component.seriesVersion;
        if (
            !targetMatches || book.liquidityKind != BookLiquidityKind.Direct || order.bookId != bookId
                || order.status != BookOrderStatus.Resting
                || Lots.unwrap(order.remainingLots) < Lots.unwrap(component.componentLots)
                || PriceTicks.unwrap(order.priceTicks) != PriceTicks.unwrap(component.priceTicks)
                || order.side != makerSide || level.headOrderHash != component.orderHash
                || authorization.order.targetKind != book.targetKind
                || authorization.order.targetVersion != book.targetVersion || authorization.order.side != makerSide
                || filledLots > authorizedLots
                || (authorization.status != OrderStatus.Open && authorization.status != OrderStatus.PartiallyFilled)
                || authorizedLots - filledLots < Lots.unwrap(component.componentLots)
        ) revert InvalidRouteSource(index);
        if (
            (packageTarget && authorization.order.packageId != route.packageId)
                || (!packageTarget && authorization.order.seriesId != component.seriesId)
        ) revert InvalidRouteSource(index);
        _requireFundingLock(
            component.fundingLockId,
            component.fundingLockReference,
            authorization.order.accountId,
            component.expiry,
            index
        );
        snapshot = keccak256(abi.encode(book, order, level, authorization.status, authorization.filledLots));
    }

    function _validateRfq(ExecutableRoute calldata route, RouteComponent calldata component, uint256 index)
        private
        view
        returns (bytes32 snapshot)
    {
        MakerQuoteId quoteId = MakerQuoteId.wrap(component.sourceId);
        MakerQuoteRecord memory quote = privateRfqBook.getQuote(quoteId);
        FirmCapacityRecord memory capacity = privateRfqBook.getCapacity(quoteId);
        PriceTicks expectedPrice = component.side == Side.Buy ? quote.quote.askPriceTicks : quote.quote.bidPriceTicks;
        if (
            (quote.status != MakerQuoteStatus.Reserved && quote.status != MakerQuoteStatus.Selected)
                || quote.quote.targetKind != RfqTargetKind.Package || quote.quote.packageId != route.packageId
                || quote.quote.targetVersion != route.packageVersion
                || quote.quote.packageLegsHash != route.packageWitnessHash
                || quote.quote.makerOrderHash != component.orderHash
                || Lots.unwrap(quote.quote.lots) < Lots.unwrap(component.componentLots)
                || PriceTicks.unwrap(expectedPrice) != PriceTicks.unwrap(component.priceTicks)
                || quote.quote.feeScheduleId != route.feeScheduleId
                || quote.quote.feeScheduleVersion != route.feeScheduleVersion
                || quote.quote.riskDomainId != route.riskDomainId
                || quote.quote.riskDomainVersion != route.riskDomainVersion || quote.quote.deadline < block.timestamp
                || quote.quote.capacityExpiry < route.expiry || capacity.status != FirmCapacityStatus.Active
                || capacity.lockId != component.capacityLockId || capacity.remainingLiability == 0
        ) revert InvalidRouteSource(index);
        bytes32 expectedReference =
            keccak256(abi.encode(keccak256("SetrynFirmCapacityLockV1(bytes32 quoteId)"), MakerQuoteId.unwrap(quoteId)));
        if (component.capacityLockReference != expectedReference) revert InvalidRouteSource(index);
        _requireCapacityLock(
            component.capacityLockId, component.capacityLockReference, quote.quote.makerAccountId, route.expiry, index
        );
        snapshot = keccak256(abi.encode(quote, capacity));
    }

    function _validateStream(RouteComponent calldata component, uint256 index) private view returns (bytes32 snapshot) {
        StreamId streamId = StreamId.wrap(component.sourceId);
        StreamPolicy memory policy = streamingQuoteEngine.getPolicy(streamId);
        (PriceTicks price,, CollateralLockId lockId, uint128 remaining, bytes32 currentSnapshot) =
            streamingQuoteEngine.previewFirmQuote(streamId, component.componentLots);
        if (
            !streamingQuoteEngine.streamExecutable(streamId) || policy.makerOrderHash != component.orderHash
                || !_oppositeSides(policy.makerSide, component.side)
                || PriceTicks.unwrap(price) != PriceTicks.unwrap(component.priceTicks)
                || lockId != component.capacityLockId || remaining == 0 || policy.capacityExpiry < component.expiry
        ) revert InvalidRouteSource(index);
        if (
            streamingQuoteEngine.capacityManager().getStreamCapacity(streamId).capacity.lockReference
                != component.capacityLockReference
        ) revert InvalidRouteSource(index);
        _requireCapacityLock(lockId, component.capacityLockReference, policy.makerAccountId, component.expiry, index);
        snapshot = currentSnapshot;
    }

    function _validateSolver(ExecutableRoute calldata route, RouteComponent calldata component, uint256 index)
        private
        view
        returns (bytes32 snapshot)
    {
        SolverRouteId solverRouteId = SolverRouteId.wrap(component.sourceId);
        SolverRouteRecord memory solver = sealedAuctionHouse.getRoute(solverRouteId);
        AuctionVersion memory auction =
            sealedAuctionHouse.getAuction(solver.route.auctionId, solver.route.auctionVersion);
        AuctionClearingResult memory result =
            sealedAuctionHouse.getClearingResult(solver.route.auctionId, solver.route.auctionVersion);
        BidRecord memory bid = sealedAuctionHouse.getBid(result.winningRouteBidId);
        if (
            !solver.revealed || bid.status != BidStatus.Winner || bid.routeId != solverRouteId
                || bid.bid.bidderOrderHash != component.orderHash
                || solver.route.packageLegsHash != route.packageWitnessHash
                || auction.definition.targetKind != AuctionTargetKind.Package
                || auction.definition.packageId != route.packageId
                || auction.definition.targetVersion != route.packageVersion
                || auction.definition.packageLegsHash != route.packageWitnessHash
                || auction.definition.feeScheduleId != route.feeScheduleId
                || auction.definition.feeScheduleVersion != route.feeScheduleVersion
                || auction.definition.riskDomainId != route.riskDomainId
                || auction.definition.riskDomainVersion != route.riskDomainVersion
                || PriceTicks.unwrap(solver.route.packageOutcomeTicks) != PriceTicks.unwrap(component.priceTicks)
                || solver.route.expiry < route.expiry || solver.route.guaranteeClassId != route.guaranteeClassId
                || solver.route.capacityLockId != component.capacityLockId || solver.route.capacityAmount == 0
        ) revert InvalidRouteSource(index);
        bytes32 expectedReference = keccak256(
            abi.encode(keccak256("SetrynAuctionCapacityLockV1(bytes32 routeId)"), SolverRouteId.unwrap(solverRouteId))
        );
        if (component.capacityLockReference != expectedReference) revert InvalidRouteSource(index);
        _requireCapacityLock(
            component.capacityLockId, component.capacityLockReference, solver.route.solverAccountId, route.expiry, index
        );
        snapshot = keccak256(abi.encode(result, bid, solver));
    }

    function _requireFundingLock(
        CollateralLockId lockId,
        bytes32 lockReference,
        AccountId accountId,
        uint64 expiry,
        uint256 index
    ) private view {
        _requireLock(lockId, lockReference, accountId, expiry, index);
    }

    function _requireCapacityLock(
        CollateralLockId lockId,
        bytes32 lockReference,
        AccountId accountId,
        uint64 expiry,
        uint256 index
    ) private view {
        _requireLock(lockId, lockReference, accountId, expiry, index);
    }

    function _requireLock(
        CollateralLockId lockId,
        bytes32 lockReference,
        AccountId accountId,
        uint64 expiry,
        uint256 index
    ) private view {
        if (CollateralLockId.unwrap(lockId) == bytes32(0) || lockReference == bytes32(0)) {
            revert InvalidRouteSource(index);
        }
        CollateralLock memory lock = collateralVault.getLock(lockId);
        if (
            lock.status != LockStatus.Active || lock.lockReference != lockReference || lock.accountId != accountId
                || lock.remainingAmount == 0 || lock.expiry < expiry || lock.expiry <= block.timestamp
        ) revert InvalidRouteSource(index);
    }

    function _reserveComponentLocks(RouteId routeId, RouteComponent calldata component) private {
        bool hasLock;
        if (CollateralLockId.unwrap(component.capacityLockId) != bytes32(0)) {
            _reserveLock(routeId, component.capacityLockId, keccak256(abi.encode(component.reservationKey, "CAPACITY")));
            hasLock = true;
        }
        if (CollateralLockId.unwrap(component.fundingLockId) != bytes32(0)) {
            _reserveLock(routeId, component.fundingLockId, keccak256(abi.encode(component.reservationKey, "FUNDING")));
            hasLock = true;
        }
        if (!hasLock) revert InvalidRouteSource(type(uint256).max);
    }

    function _reserveLock(RouteId routeId, CollateralLockId lockId, bytes32 reservationKey) private {
        RouteId existing = _lockRoutes[lockId];
        if (RouteId.unwrap(existing) != bytes32(0)) revert CapacityLockAlreadyReserved(lockId, existing);
        _lockRoutes[lockId] = routeId;
        _reservationLocks[routeId].push(lockId);
        _reservationKeys[routeId].push(reservationKey);
        reservationRegistry.claimCapacityReference(reservationKey, RouteId.unwrap(routeId), lockId);
    }

    function _close(RouteId routeId, bytes32 reservationHash, bytes32 closeReference) private {
        if (
            reservationHash == bytes32(0) || closeReference == bytes32(0) || _closed[routeId]
                || _reservations[routeId] != reservationHash
        ) revert RouteReservationMismatch(routeId);
        _closed[routeId] = true;
        bytes32[] storage keys = _reservationKeys[routeId];
        CollateralLockId[] storage locks = _reservationLocks[routeId];
        for (uint256 i; i < keys.length; ++i) {
            reservationRegistry.closeCapacityReference(keys[i], closeReference);
            delete _lockRoutes[locks[i]];
        }
        emit RouteSourcesClosed(routeId, reservationHash, closeReference);
    }

    function _oppositeSides(Side left, Side right) private pure returns (bool) {
        return (left == Side.Buy && right == Side.Sell) || (left == Side.Sell && right == Side.Buy);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
