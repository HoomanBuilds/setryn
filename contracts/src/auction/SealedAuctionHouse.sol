// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAuctionValidationGate} from "../interfaces/IAuctionValidationGate.sol";
import {IAuctionVault} from "../interfaces/IAuctionVault.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {ISealedAuctionHouse} from "../interfaces/ISealedAuctionHouse.sol";
import {ClearingHandoffClaim, VerifiedClearingHandoff} from "../types/ClearingHandoffTypes.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    AuctionClearingHandoff,
    AuctionClearingResult,
    AuctionDefinition,
    AuctionId,
    AuctionStatus,
    AuctionVersion,
    BidCommitAuthorization,
    BidCommitmentId,
    BidRecord,
    BidStatus,
    SealedBid,
    SolverAction,
    SolverRoute,
    SolverRouteId,
    SolverRouteRecord
} from "../types/AuctionTypes.sol";
import {Lots} from "../types/Units.sol";
import {RouteId, SourceReservationStatus, SourceRouteReservation} from "../types/RoutingTypes.sol";

import {SealedAuctionBidLib} from "./SealedAuctionBidLib.sol";
import {SealedAuctionClearingLib} from "./SealedAuctionClearingLib.sol";
import {SealedAuctionSettlementLib} from "./SealedAuctionSettlementLib.sol";
import {SealedAuctionDependencies} from "./SealedAuctionTypes.sol";

import {ISealedAuctionHouseLinkedErrors} from "./ISealedAuctionHouseLinkedErrors.sol";

contract SealedAuctionHouse is
    ISealedAuctionHouseLinkedErrors,
    ISealedAuctionHouse,
    IClearingChannelHandoffAdapter,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    bytes32 public constant AUCTION_SCHEDULER_ROLE = keccak256("SETRYN_AUCTION_SCHEDULER_ROLE");
    bytes32 public constant AUCTION_GUARDIAN_ROLE = keccak256("SETRYN_AUCTION_GUARDIAN_ROLE");
    bytes32 public constant CLEARING_ENGINE_ROLE = keccak256("SETRYN_AUCTION_CLEARING_ENGINE_ROLE");
    bytes32 public constant ROUTE_RESERVER_ROLE = keccak256("SETRYN_AUCTION_ROUTE_RESERVER_ROLE");
    bytes32 private constant BOND_LOCK_REFERENCE_TYPEHASH =
        keccak256("SetrynAuctionBondLockV1(bytes32 bidCommitmentId)");
    bytes32 private constant CAPACITY_LOCK_REFERENCE_TYPEHASH =
        keccak256("SetrynAuctionCapacityLockV1(bytes32 routeId)");
    bytes32 private constant ALLOCATION_TYPEHASH =
        keccak256("SetrynAuctionAllocationV1(bytes32 bidId,uint128 allocatedLots,int128 allocationPriceTicks)");

    IAuctionVault private immutable _auctionVault;
    IAuctionValidationGate private immutable _validationGate;
    address private immutable _clearingEngine;

    mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) private _auctions;
    mapping(AuctionId auctionId => uint32 latestVersion) private _latestVersions;
    mapping(AuctionId auctionId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersions;
    mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) private _auctionBidIds;
    mapping(BidCommitmentId bidId => BidRecord record) private _bids;
    mapping(SolverRouteId routeId => SolverRouteRecord record) private _routes;
    mapping(bytes32 capacityLockId => SolverRouteId routeId) private _capacityLockClaims;
    mapping(AuctionId auctionId => mapping(uint32 version => AuctionClearingResult result)) private _results;
    mapping(AuctionId auctionId => mapping(uint32 version => bool consumed)) private _handoffConsumed;
    mapping(bytes32 executionReference => bool used) private _executionReferences;
    mapping(bytes32 executionReference => AuctionId auctionId) private _handoffAuctions;
    mapping(bytes32 executionReference => uint32 version) private _handoffVersions;
    mapping(bytes32 reservationKey => SourceRouteReservation reservation) private _routeReservations;
    mapping(SolverRouteId solverRouteId => bytes32 reservationKey) private _solverRouteReservationKeys;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IAuctionVault auctionVault_,
        IAuctionValidationGate validationGate_,
        address clearingEngine_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(auctionVault_));
        _requireDependency(address(validationGate_));
        if (clearingEngine_ == address(0)) revert ZeroClearingEngine();
        _auctionVault = auctionVault_;
        _validationGate = validationGate_;
        _clearingEngine = clearingEngine_;
        _grantRole(AUCTION_SCHEDULER_ROLE, initialAdmin);
        _grantRole(AUCTION_GUARDIAN_ROLE, initialAdmin);
        _grantRole(CLEARING_ENGINE_ROLE, clearingEngine_);
        _grantRole(ROUTE_RESERVER_ROLE, initialAdmin);
    }

    function auctionVault() external view returns (IAuctionVault) {
        return _auctionVault;
    }

    function validationGate() external view returns (IAuctionValidationGate) {
        return _validationGate;
    }

    function clearingEngine() external view returns (address) {
        return _clearingEngine;
    }

    function scheduleAuction(AuctionDefinition calldata definition, PackageLeg[] calldata packageLegs)
        external
        onlyRole(AUCTION_SCHEDULER_ROLE)
        nonReentrant
        returns (AuctionId auctionId, uint32 version)
    {
        return SealedAuctionClearingLib.scheduleAuction(
            _dependencies(), _auctions, _latestVersions, _definitionVersions, definition, packageLegs
        );
    }

    function advanceAuction(AuctionId auctionId, uint32 version) external nonReentrant {
        SealedAuctionClearingLib.advanceAuction(_dependencies(), _auctions, _auctionBidIds, _bids, auctionId, version);
    }

    function cancelAuction(AuctionId auctionId, uint32 version) external onlyRole(AUCTION_GUARDIAN_ROLE) nonReentrant {
        AuctionVersion storage auction = _requireAuction(auctionId, version);
        if (
            auction.status != AuctionStatus.Scheduled
                && !(auction.status == AuctionStatus.CommitOpen && auction.commitmentCount == 0)
        ) revert UnauthorizedCancellation();
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Cancelled);
    }

    function commitBid(
        BidCommitAuthorization calldata authorization,
        bytes32[] calldata eligibilityProof,
        bytes calldata signature
    ) external nonReentrant returns (BidCommitmentId bidId) {
        return SealedAuctionBidLib.commitBid(
            _dependencies(), _auctions, _auctionBidIds, _bids, authorization, eligibilityProof, signature
        );
    }

    function revealBid(BidCommitmentId bidId, SealedBid calldata bid) external nonReentrant {
        SealedAuctionBidLib.revealBid(_dependencies(), _auctions, _bids, bidId, bid);
    }

    function revealSolverBid(
        BidCommitmentId bidId,
        SealedBid calldata bid,
        SolverRoute calldata route,
        PackageLeg[] calldata routeLegs,
        SolverAction[] calldata actions
    ) external nonReentrant {
        SealedAuctionBidLib.revealSolverBid(
            _dependencies(), _auctions, _bids, _routes, _capacityLockClaims, bidId, bid, route, routeLegs, actions
        );
    }

    function clearAuction(AuctionId auctionId, uint32 version) external nonReentrant returns (bytes32 resultHash) {
        return SealedAuctionClearingLib.clearAuction(
            _dependencies(),
            _auctions,
            _auctionBidIds,
            _bids,
            _routes,
            _capacityLockClaims,
            _results,
            auctionId,
            version
        );
    }

    function verifyClearingResult(AuctionId auctionId, uint32 version) external view returns (bool) {
        return
            SealedAuctionClearingLib.verifyClearingResult(_auctions, _auctionBidIds, _bids, _routes, auctionId, version);
    }

    function reserveForRoute(
        RouteId routeId,
        SolverRouteId solverRouteId,
        Lots quantity,
        uint64 expiry,
        bytes32 reservationKey,
        address clearingConsumer
    ) external onlyRole(ROUTE_RESERVER_ROLE) nonReentrant {
        SealedAuctionSettlementLib.reserveForRoute(
            _dependencies(),
            _auctions,
            _bids,
            _routes,
            _results,
            _handoffConsumed,
            _routeReservations,
            _solverRouteReservationKeys,
            routeId,
            solverRouteId,
            quantity,
            expiry,
            reservationKey,
            clearingConsumer
        );
    }

    function releaseRouteReservation(bytes32 reservationKey, bytes32 releaseReference)
        external
        onlyRole(ROUTE_RESERVER_ROLE)
        nonReentrant
    {
        if (releaseReference == bytes32(0)) revert InvalidRouteReservation();
        SealedAuctionSettlementLib.closeRouteReservation(
            _routeReservations,
            _solverRouteReservationKeys,
            reservationKey,
            SourceReservationStatus.Released,
            releaseReference
        );
    }

    function expireRouteReservation(bytes32 reservationKey) external nonReentrant {
        SourceRouteReservation storage reservation = _routeReservations[reservationKey];
        if (reservation.status != SourceReservationStatus.Active || block.timestamp <= reservation.expiry) {
            revert InvalidRouteReservation();
        }
        SealedAuctionSettlementLib.closeRouteReservation(
            _routeReservations,
            _solverRouteReservationKeys,
            reservationKey,
            SourceReservationStatus.Expired,
            keccak256(abi.encode("AUCTION_ROUTE_EXPIRED", reservationKey))
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

    function consumeClearingHandoff(AuctionId auctionId, uint32 version, bytes32 executionReference)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
        returns (AuctionClearingHandoff memory handoff)
    {
        return SealedAuctionSettlementLib._consumeClearingHandoff(
            _dependencies(),
            _auctions,
            _bids,
            _routes,
            _results,
            _handoffConsumed,
            _executionReferences,
            _routeReservations,
            _solverRouteReservationKeys,
            auctionId,
            version,
            executionReference
        );
    }

    function consumeTypedHandoff(ClearingHandoffClaim calldata claim)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
        returns (VerifiedClearingHandoff memory handoff)
    {
        return SealedAuctionSettlementLib.consumeTypedHandoff(
            _dependencies(),
            _auctions,
            _bids,
            _routes,
            _results,
            _handoffConsumed,
            _executionReferences,
            _handoffAuctions,
            _handoffVersions,
            _routeReservations,
            _solverRouteReservationKeys,
            claim
        );
    }

    function finalizeTypedHandoff(bytes32 consumptionId, bytes32 fillId, bytes32 positionsHash)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
    {
        if (!_executionReferences[consumptionId] || fillId == bytes32(0) || positionsHash == bytes32(0)) {
            revert HandoffClaimMismatch();
        }
        SealedAuctionSettlementLib._settleAuction(
            _dependencies(),
            _auctions,
            _auctionBidIds,
            _bids,
            _routes,
            _results,
            _handoffConsumed,
            _handoffAuctions[consumptionId],
            _handoffVersions[consumptionId],
            fillId
        );
    }

    function source() external view returns (address) {
        return address(this);
    }

    function handoffConsumed(bytes32 consumptionId) external view returns (bool) {
        return _executionReferences[consumptionId];
    }

    function settleAuction(AuctionId auctionId, uint32 version, bytes32 settlementReference)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
    {
        SealedAuctionSettlementLib._settleAuction(
            _dependencies(),
            _auctions,
            _auctionBidIds,
            _bids,
            _routes,
            _results,
            _handoffConsumed,
            auctionId,
            version,
            settlementReference
        );
    }

    function failExpiredSettlement(AuctionId auctionId, uint32 version) external nonReentrant {
        SealedAuctionSettlementLib.failExpiredSettlement(
            _dependencies(),
            _auctions,
            _auctionBidIds,
            _bids,
            _results,
            _routeReservations,
            _solverRouteReservationKeys,
            auctionId,
            version
        );
    }

    function releaseExpiredBond(BidCommitmentId bidId) external nonReentrant {
        BidRecord storage bid = _requireBid(bidId);
        AuctionDefinition storage definition =
        _auctions[bid.authorization.auctionId][bid.authorization.auctionVersion].definition;
        if (block.timestamp < definition.bondExpiry) {
            revert AuctionPhaseNotReached(definition.bondExpiry, block.timestamp);
        }
        if (bid.status != BidStatus.Unrevealed && bid.status != BidStatus.Loser) {
            revert InvalidBidState(bidId, bid.status);
        }
        _auctionVault.releaseExpiredLock(bid.bondLockId);
        _setBidStatus(bidId, bid, BidStatus.BondReleased);
    }

    function getAuction(AuctionId auctionId, uint32 version) external view returns (AuctionVersion memory) {
        return _requireAuction(auctionId, version);
    }

    function getBid(BidCommitmentId bidId) external view returns (BidRecord memory) {
        return _requireBid(bidId);
    }

    function getRoute(SolverRouteId routeId) external view returns (SolverRouteRecord memory) {
        SolverRouteRecord storage route = _routes[routeId];
        if (!route.revealed) revert RouteMismatch();
        return route;
    }

    function capacityLockClaim(bytes32 capacityLockId) external view returns (SolverRouteId routeId) {
        return _capacityLockClaims[capacityLockId];
    }

    function getClearingResult(AuctionId auctionId, uint32 version)
        external
        view
        returns (AuctionClearingResult memory)
    {
        AuctionClearingResult storage result = _results[auctionId][version];
        if (result.resultHash == bytes32(0)) revert NoClearingResult();
        return result;
    }

    function _requireAuction(AuctionId auctionId, uint32 version)
        private
        view
        returns (AuctionVersion storage auction)
    {
        auction = _auctions[auctionId][version];
        if (auction.status == AuctionStatus.Unspecified) revert UnknownAuction(auctionId, version);
    }

    function _requireBid(BidCommitmentId bidId) private view returns (BidRecord storage bid) {
        bid = _bids[bidId];
        if (bid.status == BidStatus.Unspecified) revert UnknownBid(bidId);
    }

    function _setAuctionStatus(
        AuctionId auctionId,
        uint32 version,
        AuctionVersion storage auction,
        AuctionStatus newStatus
    ) private {
        AuctionStatus previousStatus = auction.status;
        auction.status = newStatus;
        emit AuctionStatusChanged(auctionId, version, previousStatus, newStatus, msg.sender);
    }

    function _setBidStatus(BidCommitmentId bidId, BidRecord storage bid, BidStatus newStatus) private {
        BidStatus previousStatus = bid.status;
        bid.status = newStatus;
        emit BidStatusChanged(bidId, previousStatus, newStatus);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency();
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (SealedAuctionDependencies memory) {
        return SealedAuctionDependencies({
            auctionVault: _auctionVault, validationGate: _validationGate, clearingEngine: _clearingEngine
        });
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
