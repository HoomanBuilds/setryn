// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AuctionHashLib} from "../libraries/AuctionHashLib.sol";
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
import {
    AccountId,
    BookId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId
} from "../types/Identifiers.sol";
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
import {
    ExecutableRoute,
    LiquidityFirmness,
    RouteComponent,
    RouteId,
    RouteSourceKind,
    SourceReservationStatus,
    SourceRouteReservation
} from "../types/RoutingTypes.sol";
import {StreamId, StreamPolicy} from "../types/StreamTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {RouteLiquidityDependencies} from "./RouteLiquidityTypes.sol";
import "./ProtocolRouteLiquiditySource.sol";

/// Linked logic for the protocol route liquidity source: package and component source validation.
/// Runs through DELEGATECALL in the liquidity source's context against its storage.
library RouteSourceValidationLib {
    function validatePackage(
        RouteLiquidityDependencies memory deps,
        ExecutableRoute calldata route,
        PackageLeg[] calldata packageLegs
    ) external view {
        PackageVersion memory package = deps.packageRegistry.getPackage(route.packageId, route.packageVersion);
        if (
            package.definition.legsHash != route.packageWitnessHash
                || deps.packageRegistry.hashLegs(packageLegs) != route.packageWitnessHash
                || deps.packageRegistry.activeVersion(route.packageId) != route.packageVersion
                || !deps.packageRegistry
                    .isOpenForNewRisk(
                        route.packageId, route.packageVersion, packageLegs, uint32(block.timestamp / 1 days)
                    )
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(type(uint256).max);
    }

    function validateComponent(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        RouteId routeId,
        ExecutableRoute calldata route,
        RouteComponent calldata component,
        uint256 index
    ) external view returns (bytes32 snapshot) {
        if (
            component.firmness != LiquidityFirmness.Firm || component.intendedClearingConsumer == address(0)
                || component.sourceBlock == 0 || component.sourceBlock > block.number
                || component.expiry < block.timestamp
                || !deps.sessionRegistry
                    .isOpenForNewRisk(component.sessionId, component.sessionVersion, uint32(block.timestamp / 1 days))
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        if (component.sourceKind == RouteSourceKind.DirectPackageOrder) {
            return _validateBook(deps, $reservations, routeId, route, component, true, index);
        }
        if (component.sourceKind == RouteSourceKind.SeriesBookHead) {
            return _validateBook(deps, $reservations, routeId, route, component, false, index);
        }
        if (component.sourceKind == RouteSourceKind.RfqQuote) {
            return _validateRfq(deps, $reservations, routeId, route, component, index);
        }
        if (component.sourceKind == RouteSourceKind.StreamQuote) {
            return _validateStream(deps, $reservations, routeId, component, index);
        }
        if (component.sourceKind == RouteSourceKind.SolverRoute) {
            return _validateSolver(deps, $reservations, routeId, route, component, index);
        }
        revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
    }

    function _validateBook(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        RouteId routeId,
        ExecutableRoute calldata route,
        RouteComponent calldata component,
        bool packageTarget,
        uint256 index
    ) internal view returns (bytes32 snapshot) {
        BookId bookId = BookId.wrap(component.sourceId);
        BookIdentity memory book = deps.publicOrderBook.getBook(bookId);
        BookOrder memory order = deps.publicOrderBook.getBookOrder(component.orderHash);
        Side makerSide = component.side == Side.Buy ? Side.Sell : Side.Buy;
        bytes32 bestLevelId = deps.publicOrderBook.bestLevel(bookId, makerSide);
        PriceLevel memory level = deps.publicOrderBook.getPriceLevel(bestLevelId);
        OrderRecord memory authorization = deps.publicOrderBook.orderState().getOrder(component.orderHash);
        uint128 authorizedLots = Lots.unwrap(authorization.order.lots);
        uint128 filledLots = Lots.unwrap(authorization.filledLots);
        uint128 available = Lots.unwrap(deps.publicOrderBook.availableLots(component.orderHash));
        SourceRouteReservation memory sourceReservation;
        try deps.publicOrderBook.getRouteReservation(component.reservationKey) returns (
            SourceRouteReservation memory value
        ) {
            sourceReservation = value;
        } catch {}
        bool reservedForRoute = _reservationMatches(sourceReservation, routeId, component.orderHash, component);
        bool targetMatches = packageTarget
            ? book.targetKind == OrderTargetKind.Package && book.targetId == PackageId.unwrap(route.packageId)
                && book.targetVersion == route.packageVersion && book.packageLegsHash == route.packageWitnessHash
            : book.targetKind == OrderTargetKind.Series && book.targetId == SeriesId.unwrap(component.seriesId)
                && book.targetVersion == component.seriesVersion;
        if (
            !targetMatches || book.liquidityKind != BookLiquidityKind.Direct
                || BookId.unwrap(order.bookId) != BookId.unwrap(bookId) || order.status != BookOrderStatus.Resting
                || ($reservations[routeId] != bytes32(0) && !reservedForRoute)
                || (!reservedForRoute && available < Lots.unwrap(component.componentLots))
                || PriceTicks.unwrap(order.priceTicks) != PriceTicks.unwrap(component.priceTicks)
                || order.side != makerSide || level.headOrderHash != component.orderHash
                || authorization.order.targetKind != book.targetKind
                || authorization.order.targetVersion != book.targetVersion || authorization.order.side != makerSide
                || filledLots > authorizedLots
                || (authorization.status != OrderStatus.Open && authorization.status != OrderStatus.PartiallyFilled)
                || authorizedLots - filledLots < Lots.unwrap(component.componentLots)
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        if (
            (packageTarget && PackageId.unwrap(authorization.order.packageId) != PackageId.unwrap(route.packageId))
                || (!packageTarget
                    && SeriesId.unwrap(authorization.order.seriesId) != SeriesId.unwrap(component.seriesId))
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        _requireFundingLock(
            deps,
            component.fundingLockId,
            component.fundingLockReference,
            authorization.order.accountId,
            component.expiry,
            index
        );
        snapshot = keccak256(
            abi.encode(
                book,
                order,
                level.levelId,
                level.headOrderHash,
                level.priceTicks,
                authorization.status,
                authorization.filledLots
            )
        );
    }

    function _validateRfq(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        RouteId routeId,
        ExecutableRoute calldata route,
        RouteComponent calldata component,
        uint256 index
    ) internal view returns (bytes32 snapshot) {
        MakerQuoteId quoteId = MakerQuoteId.wrap(component.sourceId);
        MakerQuoteRecord memory quote = deps.privateRfqBook.getQuote(quoteId);
        FirmCapacityRecord memory capacity = deps.privateRfqBook.getCapacity(quoteId);
        PriceTicks expectedPrice = component.side == Side.Buy ? quote.quote.askPriceTicks : quote.quote.bidPriceTicks;
        if (
            (quote.status != MakerQuoteStatus.Reserved && quote.status != MakerQuoteStatus.Selected)
                || quote.quote.targetKind != RfqTargetKind.Package
                || PackageId.unwrap(quote.quote.packageId) != PackageId.unwrap(route.packageId)
                || quote.quote.targetVersion != route.packageVersion
                || quote.quote.packageLegsHash != route.packageWitnessHash
                || quote.quote.makerOrderHash != component.orderHash
                || Lots.unwrap(quote.quote.lots) < Lots.unwrap(component.componentLots)
                || PriceTicks.unwrap(expectedPrice) != PriceTicks.unwrap(component.priceTicks)
                || FeeScheduleId.unwrap(quote.quote.feeScheduleId) != FeeScheduleId.unwrap(route.feeScheduleId)
                || quote.quote.feeScheduleVersion != route.feeScheduleVersion
                || RiskDomainId.unwrap(quote.quote.riskDomainId) != RiskDomainId.unwrap(route.riskDomainId)
                || quote.quote.riskDomainVersion != route.riskDomainVersion || quote.quote.deadline < block.timestamp
                || quote.quote.capacityExpiry < route.expiry || capacity.status != FirmCapacityStatus.Active
                || CollateralLockId.unwrap(capacity.lockId) != CollateralLockId.unwrap(component.capacityLockId)
                || capacity.remainingLiability == 0
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        bytes32 expectedReference =
            keccak256(abi.encode(keccak256("SetrynFirmCapacityLockV1(bytes32 quoteId)"), MakerQuoteId.unwrap(quoteId)));
        if (component.capacityLockReference != expectedReference) {
            revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        }
        _requireCapacityLock(
            deps,
            component.capacityLockId,
            component.capacityLockReference,
            quote.quote.makerAccountId,
            route.expiry,
            index
        );
        _requireActiveSourceReservation(deps, $reservations, routeId, MakerQuoteId.unwrap(quoteId), component, index);
        snapshot = keccak256(abi.encode(quote, capacity));
    }

    function _validateStream(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        RouteId routeId,
        RouteComponent calldata component,
        uint256 index
    ) internal view returns (bytes32 snapshot) {
        StreamId streamId = StreamId.wrap(component.sourceId);
        StreamPolicy memory policy = deps.streamingQuoteEngine.getPolicy(streamId);
        (PriceTicks price,, CollateralLockId lockId, uint128 remaining, bytes32 currentSnapshot) =
            deps.streamingQuoteEngine.previewFirmQuote(streamId, component.componentLots);
        if (
            !deps.streamingQuoteEngine.streamExecutable(streamId) || policy.makerOrderHash != component.orderHash
                || !_oppositeSides(policy.makerSide, component.side)
                || PriceTicks.unwrap(price) != PriceTicks.unwrap(component.priceTicks)
                || CollateralLockId.unwrap(lockId) != CollateralLockId.unwrap(component.capacityLockId)
                || remaining == 0 || policy.capacityExpiry < component.expiry
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        if (
            deps.streamingQuoteEngine.capacityManager().getStreamCapacity(streamId).capacity.lockReference
                != component.capacityLockReference
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        _requireCapacityLock(
            deps, lockId, component.capacityLockReference, policy.makerAccountId, component.expiry, index
        );
        _requireActiveSourceReservation(deps, $reservations, routeId, StreamId.unwrap(streamId), component, index);
        snapshot = currentSnapshot;
    }

    function _validateSolver(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        RouteId routeId,
        ExecutableRoute calldata route,
        RouteComponent calldata component,
        uint256 index
    ) internal view returns (bytes32 snapshot) {
        SolverRouteId solverRouteId = SolverRouteId.wrap(component.sourceId);
        SolverRouteRecord memory solver = deps.sealedAuctionHouse.getRoute(solverRouteId);
        AuctionVersion memory auction =
            deps.sealedAuctionHouse.getAuction(solver.route.auctionId, solver.route.auctionVersion);
        AuctionClearingResult memory result =
            deps.sealedAuctionHouse.getClearingResult(solver.route.auctionId, solver.route.auctionVersion);
        BidRecord memory bid = deps.sealedAuctionHouse.getBid(result.winningRouteBidId);
        if (
            !solver.revealed || bid.status != BidStatus.Winner
                || SolverRouteId.unwrap(bid.routeId) != SolverRouteId.unwrap(solverRouteId)
                || bid.bid.bidderOrderHash != component.orderHash
                || solver.route.packageLegsHash != route.packageWitnessHash
                || auction.definition.targetKind != AuctionTargetKind.Package
                || PackageId.unwrap(auction.definition.packageId) != PackageId.unwrap(route.packageId)
                || auction.definition.targetVersion != route.packageVersion
                || auction.definition.packageLegsHash != route.packageWitnessHash
                || FeeScheduleId.unwrap(auction.definition.feeScheduleId) != FeeScheduleId.unwrap(route.feeScheduleId)
                || auction.definition.feeScheduleVersion != route.feeScheduleVersion
                || RiskDomainId.unwrap(auction.definition.riskDomainId) != RiskDomainId.unwrap(route.riskDomainId)
                || auction.definition.riskDomainVersion != route.riskDomainVersion
                || PriceTicks.unwrap(solver.route.packageOutcomeTicks) != PriceTicks.unwrap(component.priceTicks)
                || solver.route.expiry < route.expiry || solver.route.guaranteeClassId != route.guaranteeClassId
                || CollateralLockId.unwrap(solver.route.capacityLockId)
                    != CollateralLockId.unwrap(component.capacityLockId) || solver.route.capacityAmount == 0
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        bytes32 expectedReference = AuctionHashLib.capacityLockReference(solver.route);
        if (component.capacityLockReference != expectedReference) {
            revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        }
        _requireCapacityLock(
            deps,
            component.capacityLockId,
            component.capacityLockReference,
            solver.route.solverAccountId,
            route.expiry,
            index
        );
        _requireActiveSourceReservation(
            deps, $reservations, routeId, SolverRouteId.unwrap(solverRouteId), component, index
        );
        snapshot = keccak256(abi.encode(result, bid, solver));
    }

    function _requireActiveSourceReservation(
        RouteLiquidityDependencies memory deps,
        mapping(RouteId routeId => bytes32 reservationHash) storage $reservations,
        RouteId routeId,
        bytes32 sourceId,
        RouteComponent calldata component,
        uint256 index
    ) internal view {
        if ($reservations[routeId] == bytes32(0)) return;
        SourceRouteReservation memory reservation =
            _sourceReservation(deps, component.sourceKind, component.reservationKey);
        if (!_reservationMatches(reservation, routeId, sourceId, component)) {
            revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        }
    }

    function _reservationMatches(
        SourceRouteReservation memory reservation,
        RouteId routeId,
        bytes32 sourceId,
        RouteComponent calldata component
    ) internal pure returns (bool) {
        return reservation.status == SourceReservationStatus.Active
            && RouteId.unwrap(reservation.routeId) == RouteId.unwrap(routeId) && reservation.sourceId == sourceId
            && reservation.reservationKey == component.reservationKey
            && Lots.unwrap(reservation.quantity) == Lots.unwrap(component.componentLots)
            && reservation.expiry == component.expiry
            && reservation.clearingConsumer == component.intendedClearingConsumer;
    }

    function _requireFundingLock(
        RouteLiquidityDependencies memory deps,
        CollateralLockId lockId,
        bytes32 lockReference,
        AccountId accountId,
        uint64 expiry,
        uint256 index
    ) internal view {
        _requireLock(deps, lockId, lockReference, accountId, expiry, index);
    }

    function _requireCapacityLock(
        RouteLiquidityDependencies memory deps,
        CollateralLockId lockId,
        bytes32 lockReference,
        AccountId accountId,
        uint64 expiry,
        uint256 index
    ) internal view {
        _requireLock(deps, lockId, lockReference, accountId, expiry, index);
    }

    function _requireLock(
        RouteLiquidityDependencies memory deps,
        CollateralLockId lockId,
        bytes32 lockReference,
        AccountId accountId,
        uint64 expiry,
        uint256 index
    ) internal view {
        if (CollateralLockId.unwrap(lockId) == bytes32(0) || lockReference == bytes32(0)) {
            revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
        }
        CollateralLock memory lock = deps.collateralVault.getLock(lockId);
        if (
            lock.status != LockStatus.Active || lock.lockReference != lockReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(accountId) || lock.remainingAmount == 0
                || lock.expiry < expiry || lock.expiry <= block.timestamp
        ) revert ProtocolRouteLiquiditySource.InvalidRouteSource(index);
    }

    function _oppositeSides(Side left, Side right) internal pure returns (bool) {
        return (left == Side.Buy && right == Side.Sell) || (left == Side.Sell && right == Side.Buy);
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
