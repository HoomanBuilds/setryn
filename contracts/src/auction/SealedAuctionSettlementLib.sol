// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {ISealedAuctionHouse} from "../interfaces/ISealedAuctionHouse.sol";
import {AuctionHashLib} from "../libraries/AuctionHashLib.sol";
import {PackageDefinitionLib} from "../libraries/PackageDefinitionLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    CapacityDispositionKind,
    CapacityReservationDisposition,
    ClearingHandoffClaim,
    ClearingHandoffKind,
    UnusedCapacityPolicy,
    VerifiedClearingHandoff
} from "../types/ClearingHandoffTypes.sol";
import {LockStatus, Side} from "../types/Enums.sol";
import {AccountId, CollateralLockId, FeeScheduleId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";
import {
    AuctionClearingHandoff,
    AuctionClearingResult,
    AuctionDefinition,
    AuctionId,
    AuctionKind,
    AuctionStatus,
    AuctionTargetKind,
    AuctionVersion,
    BidCommitmentId,
    BidRecord,
    BidStatus,
    BondOutcome,
    SolverRoute,
    SolverRouteId,
    SolverRouteRecord
} from "../types/AuctionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {RouteId, SourceReservationStatus, SourceRouteReservation} from "../types/RoutingTypes.sol";
import {RiskAdmissionId} from "../types/RiskTypes.sol";

import {SealedAuctionDependencies} from "./SealedAuctionTypes.sol";
import {SealedAuctionBidLib} from "./SealedAuctionBidLib.sol";
import {SealedAuctionClearingLib} from "./SealedAuctionClearingLib.sol";

/// Linked logic for the sealed auction house: route reservations, clearing handoffs, and settlement.
/// Runs through DELEGATECALL in the auction house's context against its storage.
library SealedAuctionSettlementLib {
    function reserveForRoute(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionClearingResult result)) storage $results,
        mapping(AuctionId auctionId => mapping(uint32 version => bool consumed)) storage $handoffConsumed,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(SolverRouteId solverRouteId => bytes32 reservationKey) storage $solverRouteReservationKeys,
        RouteId routeId,
        SolverRouteId solverRouteId,
        Lots quantity,
        uint64 expiry,
        bytes32 reservationKey,
        address clearingConsumer
    ) external {
        uint128 requested = Lots.unwrap(quantity);
        if (
            RouteId.unwrap(routeId) == bytes32(0) || reservationKey == bytes32(0)
                || clearingConsumer != deps.clearingEngine || requested == 0 || expiry <= block.timestamp
                || $routeReservations[reservationKey].status != SourceReservationStatus.Unspecified
                || $solverRouteReservationKeys[solverRouteId] != bytes32(0)
        ) revert ISealedAuctionHouse.InvalidRouteReservation();
        SolverRouteRecord storage routeRecord = $routes[solverRouteId];
        if (!routeRecord.revealed) revert ISealedAuctionHouse.InvalidRouteReservation();
        SolverRoute storage route = routeRecord.route;
        AuctionVersion storage auction = _requireAuction($auctions, route.auctionId, route.auctionVersion);
        AuctionClearingResult storage result = $results[route.auctionId][route.auctionVersion];
        BidRecord storage winner = _requireBid($bids, result.winningRouteBidId);
        if (
            auction.status != AuctionStatus.Cleared || winner.status != BidStatus.Winner
                || SolverRouteId.unwrap(winner.routeId) != SolverRouteId.unwrap(solverRouteId)
                || requested != Lots.unwrap(winner.allocatedLots) || expiry > auction.definition.settlementDeadline
                || expiry > route.expiry || $handoffConsumed[route.auctionId][route.auctionVersion]
        ) revert ISealedAuctionHouse.InvalidRouteReservation();
        SealedAuctionBidLib.requireCapacityLock(deps, route, auction.definition);
        $solverRouteReservationKeys[solverRouteId] = reservationKey;
        $routeReservations[reservationKey] = SourceRouteReservation({
            routeId: routeId,
            sourceId: SolverRouteId.unwrap(solverRouteId),
            reservationKey: reservationKey,
            clearingConsumer: clearingConsumer,
            quantity: quantity,
            expiry: expiry,
            status: SourceReservationStatus.Active
        });
        emit ISealedAuctionHouse.AuctionRouteReserved(
            solverRouteId, routeId, reservationKey, quantity, expiry, clearingConsumer
        );
    }

    function consumeTypedHandoff(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionClearingResult result)) storage $results,
        mapping(AuctionId auctionId => mapping(uint32 version => bool consumed)) storage $handoffConsumed,
        mapping(bytes32 executionReference => bool used) storage $executionReferences,
        mapping(bytes32 executionReference => AuctionId auctionId) storage $handoffAuctions,
        mapping(bytes32 executionReference => uint32 version) storage $handoffVersions,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(SolverRouteId solverRouteId => bytes32 reservationKey) storage $solverRouteReservationKeys,
        ClearingHandoffClaim calldata claim
    ) external returns (VerifiedClearingHandoff memory handoff) {
        if (claim.kind != ClearingHandoffKind.SealedAuction) {
            revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        }
        AuctionId auctionId = AuctionId.wrap(claim.sourceId);
        AuctionVersion storage auction = _requireAuction($auctions, auctionId, claim.sourceVersion);
        AuctionClearingResult storage result = $results[auctionId][claim.sourceVersion];
        if (auction.definition.kind != AuctionKind.SolverRoute || result.winnerCount != 1) {
            revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        }
        BidRecord storage winner = _requireBid($bids, result.winningRouteBidId);
        SolverRouteRecord storage routeRecord = $routes[winner.routeId];
        SolverRoute storage route = routeRecord.route;
        bytes32 expectedCommitment = keccak256(
            abi.encode(
                auction.versionHash,
                result.resultHash,
                BidCommitmentId.unwrap(result.winningRouteBidId),
                routeRecord.routeHash,
                AuctionHashLib.hashBid(winner.bid)
            )
        );
        Side expectedTakerSide = winner.bid.side == Side.Buy ? Side.Sell : Side.Buy;
        bool packageTarget = auction.definition.targetKind == AuctionTargetKind.Package;
        if (
            claim.sourceCommitment != expectedCommitment
                || claim.selectedQuoteOrRouteId != SolverRouteId.unwrap(winner.routeId)
                || RiskAdmissionId.unwrap(claim.longAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(claim.shortAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(claim.longAdmissionId) == RiskAdmissionId.unwrap(claim.shortAdmissionId)
                || claim.longAdmissionResultHash == bytes32(0) || claim.shortAdmissionResultHash == bytes32(0)
                || claim.takerOrderHash != auction.definition.initiatorOrderHash
                || claim.makerOrderHash != winner.bid.bidderOrderHash
                || AccountId.unwrap(claim.takerAccountId) != AccountId.unwrap(auction.definition.initiatorAccountId)
                || AccountId.unwrap(claim.makerAccountId) != AccountId.unwrap(winner.bid.bidderAccountId)
                || claim.takerSide != expectedTakerSide || claim.targetVersion != auction.definition.targetVersion
                || Lots.unwrap(claim.fillLots) != Lots.unwrap(winner.allocatedLots)
                || PriceTicks.unwrap(claim.executionPriceTicks) != PriceTicks.unwrap(winner.allocationPriceTicks)
                || FeeScheduleId.unwrap(claim.feeScheduleId) != FeeScheduleId.unwrap(auction.definition.feeScheduleId)
                || claim.feeScheduleVersion != auction.definition.feeScheduleVersion
                || claim.takerMaximumFeeMinor != auction.definition.initiatorMaximumFeeMinor
                || claim.makerMaximumFeeMinor != winner.bid.maximumFeeMinor
                || RiskDomainId.unwrap(claim.riskDomainId) != RiskDomainId.unwrap(auction.definition.riskDomainId)
                || claim.riskDomainVersion != auction.definition.riskDomainVersion
                || claim.executionModeId != auction.definition.executionModeId
                || claim.deadline != auction.definition.settlementDeadline
        ) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        if (packageTarget) {
            if (
                claim.targetKind != OrderTargetKind.Package
                    || PackageId.unwrap(claim.packageId) != PackageId.unwrap(auction.definition.packageId)
                    || claim.packageWitnessHash != auction.definition.packageLegsHash
                    || PackageDefinitionLib.hashLegs(claim.packageLegs) != auction.definition.packageLegsHash
            ) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        } else if (
            claim.targetKind != OrderTargetKind.Series
                || SeriesId.unwrap(claim.seriesId) != SeriesId.unwrap(auction.definition.seriesId)
                || claim.packageLegs.length != 0 || claim.packageWitnessHash != bytes32(0)
        ) {
            revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        }

        uint128 expectedRemaining = route.capacityAmount;
        uint256 reserved;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition calldata disposition = claim.capacityDispositions[i];
            if (
                disposition.capacityDisposition != CapacityDispositionKind.ConvertedToTerminalLiability
                    || CollateralLockId.unwrap(disposition.funding.lockId)
                        != CollateralLockId.unwrap(route.capacityLockId)
                    || AccountId.unwrap(disposition.accountId) != AccountId.unwrap(route.solverAccountId)
                    || disposition.funding.expectedRemainingAmount != expectedRemaining
                    || disposition.funding.expectedExpiry != route.expiry
                    || disposition.unusedCapacityPolicy != UnusedCapacityPolicy.ReleaseOnTerminalFill
                    || disposition.reservationAmount > expectedRemaining
            ) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
            reserved += disposition.reservationAmount;
            if (reserved > route.capacityAmount) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
            expectedRemaining -= disposition.reservationAmount;
        }
        if (reserved == 0) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        _consumeClearingHandoff(
            deps,
            $auctions,
            $bids,
            $routes,
            $results,
            $handoffConsumed,
            $executionReferences,
            $routeReservations,
            $solverRouteReservationKeys,
            auctionId,
            claim.sourceVersion,
            claim.consumptionId
        );
        $handoffAuctions[claim.consumptionId] = auctionId;
        $handoffVersions[claim.consumptionId] = claim.sourceVersion;
        handoff = VerifiedClearingHandoff({
            claim: claim,
            provenanceHash: keccak256(abi.encode(block.chainid, address(this), expectedCommitment, claim.consumptionId))
        });
    }

    function _consumeClearingHandoff(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionClearingResult result)) storage $results,
        mapping(AuctionId auctionId => mapping(uint32 version => bool consumed)) storage $handoffConsumed,
        mapping(bytes32 executionReference => bool used) storage $executionReferences,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(SolverRouteId solverRouteId => bytes32 reservationKey) storage $solverRouteReservationKeys,
        AuctionId auctionId,
        uint32 version,
        bytes32 executionReference
    ) public returns (AuctionClearingHandoff memory handoff) {
        if (executionReference == bytes32(0)) revert ISealedAuctionHouse.ZeroReference();
        if ($executionReferences[executionReference]) {
            revert ISealedAuctionHouse.ExecutionReferenceUsed(executionReference);
        }
        if ($handoffConsumed[auctionId][version]) {
            revert ISealedAuctionHouse.ClearingHandoffAlreadyConsumed(auctionId, version);
        }
        AuctionVersion storage auction = _requireAuction($auctions, auctionId, version);
        if (auction.status != AuctionStatus.Cleared) {
            revert ISealedAuctionHouse.InvalidAuctionState(auctionId, version, auction.status);
        }
        if (block.timestamp > auction.definition.settlementDeadline) {
            revert ISealedAuctionHouse.SettlementDeadlinePassed(auction.definition.settlementDeadline, block.timestamp);
        }
        AuctionClearingResult storage result = $results[auctionId][version];
        if (result.resultHash == bytes32(0)) revert ISealedAuctionHouse.NoClearingResult();
        CollateralLockId capacityLockId;
        uint128 capacityAmount;
        if (auction.definition.kind == AuctionKind.SolverRoute) {
            BidRecord storage winner = $bids[result.winningRouteBidId];
            SolverRoute storage route = $routes[winner.routeId].route;
            SealedAuctionBidLib.requireCapacityLock(deps, route, auction.definition);
            bytes32 reservationKey = $solverRouteReservationKeys[winner.routeId];
            if (reservationKey != bytes32(0)) {
                SourceRouteReservation storage routeReservation = $routeReservations[reservationKey];
                if (
                    routeReservation.status != SourceReservationStatus.Active
                        || routeReservation.clearingConsumer != msg.sender || block.timestamp > routeReservation.expiry
                        || Lots.unwrap(routeReservation.quantity) != Lots.unwrap(winner.allocatedLots)
                ) revert ISealedAuctionHouse.InvalidRouteReservation();
                closeRouteReservation(
                    $routeReservations,
                    $solverRouteReservationKeys,
                    reservationKey,
                    SourceReservationStatus.Consumed,
                    keccak256(abi.encode("AUCTION_ROUTE_CONSUMED", executionReference))
                );
            }
            capacityLockId = route.capacityLockId;
            capacityAmount = route.capacityAmount;
        }
        $handoffConsumed[auctionId][version] = true;
        $executionReferences[executionReference] = true;
        handoff = AuctionClearingHandoff({
            auctionId: auctionId,
            auctionVersion: version,
            clearingResultHash: result.resultHash,
            winningRouteBidId: result.winningRouteBidId,
            capacityLockId: capacityLockId,
            capacityAmount: capacityAmount,
            maximumKeeperRewardMinor: auction.definition.maximumKeeperRewardMinor,
            executionReference: executionReference
        });
        emit ISealedAuctionHouse.ClearingHandoffConsumed(
            auctionId, version, executionReference, result.resultHash, CollateralLockId.unwrap(capacityLockId)
        );
    }

    function failExpiredSettlement(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionClearingResult result)) storage $results,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(SolverRouteId solverRouteId => bytes32 reservationKey) storage $solverRouteReservationKeys,
        AuctionId auctionId,
        uint32 version
    ) external {
        AuctionVersion storage auction = _requireAuction($auctions, auctionId, version);
        if (auction.status != AuctionStatus.Cleared) {
            revert ISealedAuctionHouse.InvalidAuctionState(auctionId, version, auction.status);
        }
        if (block.timestamp <= auction.definition.settlementDeadline) {
            revert ISealedAuctionHouse.SettlementDeadlineNotReached(
                auction.definition.settlementDeadline, block.timestamp
            );
        }
        AuctionClearingResult storage result = $results[auctionId][version];
        if (BidCommitmentId.unwrap(result.winningRouteBidId) != bytes32(0)) {
            bytes32 reservationKey = $solverRouteReservationKeys[$bids[result.winningRouteBidId].routeId];
            if (reservationKey != bytes32(0)) {
                closeRouteReservation(
                    $routeReservations,
                    $solverRouteReservationKeys,
                    reservationKey,
                    SourceReservationStatus.Expired,
                    keccak256(abi.encode("AUCTION_SETTLEMENT_EXPIRED", AuctionId.unwrap(auctionId), version))
                );
            }
        }
        _resolveWinningBonds(
            deps,
            $auctionBidIds,
            $bids,
            auctionId,
            version,
            auction.definition.settlementFailureBondOutcome,
            auction.definition
        );
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Failed);
    }

    function _settleAuction(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionClearingResult result)) storage $results,
        mapping(AuctionId auctionId => mapping(uint32 version => bool consumed)) storage $handoffConsumed,
        AuctionId auctionId,
        uint32 version,
        bytes32 settlementReference
    ) external {
        if (settlementReference == bytes32(0)) revert ISealedAuctionHouse.ZeroReference();
        AuctionVersion storage auction = _requireAuction($auctions, auctionId, version);
        if (auction.status != AuctionStatus.Cleared || !$handoffConsumed[auctionId][version]) {
            revert ISealedAuctionHouse.InvalidAuctionState(auctionId, version, auction.status);
        }
        if (block.timestamp > auction.definition.settlementDeadline) {
            revert ISealedAuctionHouse.SettlementDeadlinePassed(auction.definition.settlementDeadline, block.timestamp);
        }
        _resolveWinningBonds(deps, $auctionBidIds, $bids, auctionId, version, BondOutcome.Release, auction.definition);
        if (auction.definition.kind == AuctionKind.SolverRoute) {
            BidRecord storage winner = $bids[$results[auctionId][version].winningRouteBidId];
            CollateralLockId capacityLockId = $routes[winner.routeId].route.capacityLockId;
            CollateralLock memory capacityLock = deps.auctionVault.getLock(capacityLockId);
            if (capacityLock.status == LockStatus.Active) {
                IAtomicClearingEngine(deps.clearingEngine).positionEngine().releasePositionFundingLock(capacityLockId);
            }
        }
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Settled);
        emit ISealedAuctionHouse.AuctionSettled(auctionId, version, settlementReference);
    }

    function _resolveWinningBonds(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        AuctionId auctionId,
        uint32 version,
        BondOutcome outcome,
        AuctionDefinition storage definition
    ) internal {
        BidCommitmentId[] storage bidIds = $auctionBidIds[auctionId][version];
        for (uint256 i; i < bidIds.length; ++i) {
            BidRecord storage bid = $bids[bidIds[i]];
            if (bid.status == BidStatus.Winner) {
                SealedAuctionClearingLib.applyBondOutcome(deps, bidIds[i], bid, outcome, definition);
            }
        }
    }

    function closeRouteReservation(
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(SolverRouteId solverRouteId => bytes32 reservationKey) storage $solverRouteReservationKeys,
        bytes32 reservationKey,
        SourceReservationStatus status,
        bytes32 closeReference
    ) public {
        SourceRouteReservation storage reservation = $routeReservations[reservationKey];
        if (reservation.status != SourceReservationStatus.Active || closeReference == bytes32(0)) {
            revert ISealedAuctionHouse.InvalidRouteReservation();
        }
        SolverRouteId solverRouteId = SolverRouteId.wrap(reservation.sourceId);
        $solverRouteReservationKeys[solverRouteId] = bytes32(0);
        reservation.status = status;
        emit ISealedAuctionHouse.AuctionRouteReservationClosed(
            solverRouteId, reservation.routeId, reservationKey, uint8(status), closeReference
        );
    }

    function _requireAuction(
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        AuctionId auctionId,
        uint32 version
    ) internal view returns (AuctionVersion storage auction) {
        auction = $auctions[auctionId][version];
        if (auction.status == AuctionStatus.Unspecified) revert ISealedAuctionHouse.UnknownAuction(auctionId, version);
    }

    function _requireBid(mapping(BidCommitmentId bidId => BidRecord record) storage $bids, BidCommitmentId bidId)
        internal
        view
        returns (BidRecord storage bid)
    {
        bid = $bids[bidId];
        if (bid.status == BidStatus.Unspecified) revert ISealedAuctionHouse.UnknownBid(bidId);
    }

    function _setAuctionStatus(
        AuctionId auctionId,
        uint32 version,
        AuctionVersion storage auction,
        AuctionStatus newStatus
    ) internal {
        AuctionStatus previousStatus = auction.status;
        auction.status = newStatus;
        emit ISealedAuctionHouse.AuctionStatusChanged(auctionId, version, previousStatus, newStatus, msg.sender);
    }
}
