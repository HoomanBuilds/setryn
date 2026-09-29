// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {ISealedAuctionHouse} from "../interfaces/ISealedAuctionHouse.sol";
import {AuctionHashLib} from "../libraries/AuctionHashLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    AuctionDefinition,
    AuctionId,
    AuctionKind,
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
import {PriceTicks} from "../types/Units.sol";

import {SealedAuctionDependencies} from "./SealedAuctionTypes.sol";

/// Linked logic for the sealed auction house: bid commitment and reveal.
/// Runs through DELEGATECALL in the auction house's context against its storage.
library SealedAuctionBidLib {
    bytes32 internal constant BOND_LOCK_REFERENCE_TYPEHASH =
        keccak256("SetrynAuctionBondLockV1(bytes32 bidCommitmentId)");

    function commitBid(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        BidCommitAuthorization calldata authorization,
        bytes32[] calldata eligibilityProof,
        bytes calldata signature
    ) external returns (BidCommitmentId bidId) {
        AuctionVersion storage auction =
            _requireAuction($auctions, authorization.auctionId, authorization.auctionVersion);
        if (auction.status != AuctionStatus.CommitOpen) {
            revert ISealedAuctionHouse.InvalidAuctionState(
                authorization.auctionId, authorization.auctionVersion, auction.status
            );
        }
        if (block.timestamp >= auction.definition.commitClosesAt) {
            revert ISealedAuctionHouse.AuctionPhaseClosed(auction.definition.commitClosesAt, block.timestamp);
        }
        if (authorization.deadline < block.timestamp || authorization.deadline > auction.definition.commitClosesAt) {
            revert ISealedAuctionHouse.AuctionPhaseClosed(authorization.deadline, block.timestamp);
        }
        if (
            authorization.bidder == address(0) || AccountId.unwrap(authorization.bidderAccountId) == bytes32(0)
                || authorization.sealedBidHash == bytes32(0) || authorization.eligibilityProofHash == bytes32(0)
                || authorization.salt == bytes32(0)
        ) revert ISealedAuctionHouse.BidAuthorizationMismatch();
        if (keccak256(abi.encodePacked(eligibilityProof)) != authorization.eligibilityProofHash) {
            revert ISealedAuctionHouse.EligibilityProofMismatch();
        }
        if (auction.commitmentCount >= auction.definition.maximumBids) {
            revert ISealedAuctionHouse.AuctionCapacityReached(auction.definition.maximumBids);
        }
        bidId = AuctionHashLib.deriveBidCommitmentId(authorization);
        if ($bids[bidId].status != BidStatus.Unspecified) revert ISealedAuctionHouse.DuplicateBid(bidId);
        bytes32 digest = AuctionHashLib.bidCommitDigest(authorization, block.chainid, address(this));
        _requireSignature(authorization.bidder, digest, signature);
        deps.validationGate.validateCommit(auction.definition, authorization, eligibilityProof);

        bytes32 lockReference = keccak256(abi.encode(BOND_LOCK_REFERENCE_TYPEHASH, BidCommitmentId.unwrap(bidId)));
        CollateralLockId bondLockId = deps.auctionVault
            .createLock(
                lockReference,
                authorization.bidderAccountId,
                auction.definition.bondAssetId,
                auction.definition.bondBindingVersion,
                auction.definition.requiredBondAmount,
                auction.definition.bondExpiry,
                address(this)
            );
        _requireBondLock(deps, auction.definition, authorization, bidId, bondLockId, lockReference);
        $bids[bidId].authorization = authorization;
        $bids[bidId].bondLockId = bondLockId;
        $bids[bidId].status = BidStatus.Committed;
        $auctionBidIds[authorization.auctionId][authorization.auctionVersion].push(bidId);
        auction.commitmentCount += 1;
        emit ISealedAuctionHouse.BidCommitted(
            authorization.auctionId,
            authorization.auctionVersion,
            bidId,
            authorization.sealedBidHash,
            CollateralLockId.unwrap(bondLockId)
        );
    }

    function revealBid(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        BidCommitmentId bidId,
        SealedBid calldata bid
    ) external {
        BidRecord storage record = _prepareReveal($auctions, $bids, bidId, bid);
        AuctionVersion storage auction = $auctions[bid.auctionId][bid.auctionVersion];
        if (auction.definition.kind != AuctionKind.BatchOrder) revert ISealedAuctionHouse.RouteMismatch();
        deps.validationGate.validateBid(auction.definition, bid);
        _finishReveal(bidId, record, auction, bid, SolverRouteId.wrap(bytes32(0)));
    }

    function revealSolverBid(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(bytes32 capacityLockId => SolverRouteId routeId) storage $capacityLockClaims,
        BidCommitmentId bidId,
        SealedBid calldata bid,
        SolverRoute calldata route,
        PackageLeg[] calldata routeLegs,
        SolverAction[] calldata actions
    ) external {
        BidRecord storage record = _prepareReveal($auctions, $bids, bidId, bid);
        AuctionVersion storage auction = $auctions[bid.auctionId][bid.auctionVersion];
        if (auction.definition.kind != AuctionKind.SolverRoute) revert ISealedAuctionHouse.RouteMismatch();
        deps.validationGate.validateBid(auction.definition, bid);
        AuctionHashLib.validateRoute(route, auction.definition, routeLegs, actions);
        deps.validationGate.validateRoute(auction.definition, route, routeLegs, actions);
        if (
            AuctionId.unwrap(route.auctionId) != AuctionId.unwrap(bid.auctionId)
                || route.auctionVersion != bid.auctionVersion || route.solver != bid.bidder
                || AccountId.unwrap(route.solverAccountId) != AccountId.unwrap(bid.bidderAccountId)
                || SolverRouteId.unwrap(route.routeId) != SolverRouteId.unwrap(bid.solverRouteId)
                || PriceTicks.unwrap(route.packageOutcomeTicks) != PriceTicks.unwrap(bid.priceTicks)
                || route.maximumFeeMinor != bid.maximumFeeMinor
                || route.capacityEvidenceHash != bid.capacityEvidenceHash
        ) revert ISealedAuctionHouse.RouteMismatch();
        if ($routes[route.routeId].revealed) revert ISealedAuctionHouse.DuplicateRoute(route.routeId);
        bytes32 capacityLockKey = CollateralLockId.unwrap(route.capacityLockId);
        SolverRouteId claimedRouteId = $capacityLockClaims[capacityLockKey];
        if (SolverRouteId.unwrap(claimedRouteId) != bytes32(0)) {
            revert ISealedAuctionHouse.CapacityLockAlreadyClaimed(capacityLockKey, claimedRouteId);
        }
        bytes32 capacityLockReference = AuctionHashLib.capacityLockReference(route);
        CollateralLockId capacityLockId = IAtomicClearingEngine(deps.clearingEngine).positionEngine()
            .createPositionFundingLock(
                capacityLockReference,
                route.solverAccountId,
                auction.definition.settlementAssetId,
                auction.definition.settlementAssetVersion,
                route.capacityAmount,
                route.expiry
            );
        if (CollateralLockId.unwrap(capacityLockId) != CollateralLockId.unwrap(route.capacityLockId)) {
            revert ISealedAuctionHouse.CapacityLockMismatch(route.routeId);
        }
        requireCapacityLock(deps, route, auction.definition);
        bytes32 routeHash = AuctionHashLib.hashRoute(route);
        $routes[route.routeId] = SolverRouteRecord({route: route, routeHash: routeHash, revealed: true});
        $capacityLockClaims[capacityLockKey] = route.routeId;
        _finishReveal(bidId, record, auction, bid, route.routeId);
    }

    function _prepareReveal(
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        BidCommitmentId bidId,
        SealedBid calldata bid
    ) internal view returns (BidRecord storage record) {
        record = _requireBid($bids, bidId);
        if (record.status != BidStatus.Committed) revert ISealedAuctionHouse.InvalidBidState(bidId, record.status);
        AuctionVersion storage auction = _requireAuction($auctions, bid.auctionId, bid.auctionVersion);
        if (auction.status != AuctionStatus.RevealOpen) {
            revert ISealedAuctionHouse.InvalidAuctionState(bid.auctionId, bid.auctionVersion, auction.status);
        }
        if (block.timestamp >= auction.definition.revealClosesAt) {
            revert ISealedAuctionHouse.AuctionPhaseClosed(auction.definition.revealClosesAt, block.timestamp);
        }
        BidCommitAuthorization storage authorization = record.authorization;
        if (
            AuctionId.unwrap(bid.auctionId) != AuctionId.unwrap(authorization.auctionId)
                || bid.auctionVersion != authorization.auctionVersion || bid.bidder != authorization.bidder
                || AccountId.unwrap(bid.bidderAccountId) != AccountId.unwrap(authorization.bidderAccountId)
                || bid.nonce != authorization.nonce
        ) revert ISealedAuctionHouse.BidAuthorizationMismatch();
        bytes32 actualHash = AuctionHashLib.hashBid(bid);
        if (actualHash != authorization.sealedBidHash) {
            revert ISealedAuctionHouse.BidCommitmentMismatch(authorization.sealedBidHash, actualHash);
        }
    }

    function _finishReveal(
        BidCommitmentId bidId,
        BidRecord storage record,
        AuctionVersion storage auction,
        SealedBid calldata bid,
        SolverRouteId routeId
    ) internal {
        AuctionHashLib.validateBid(bid, auction.definition);
        record.bid = bid;
        record.routeId = routeId;
        _setBidStatus(bidId, record, BidStatus.Revealed);
        auction.revealCount += 1;
        emit ISealedAuctionHouse.BidRevealed(
            bid.auctionId, bid.auctionVersion, bidId, record.authorization.sealedBidHash, routeId
        );
    }

    function _requireBondLock(
        SealedAuctionDependencies memory deps,
        AuctionDefinition storage definition,
        BidCommitAuthorization calldata authorization,
        BidCommitmentId bidId,
        CollateralLockId lockId,
        bytes32 lockReference
    ) internal view {
        CollateralLock memory lock = deps.auctionVault.getLock(lockId);
        CollateralId expectedCollateral =
            deps.auctionVault.deriveCollateralId(definition.bondAssetId, definition.bondBindingVersion);
        if (
            lock.status != LockStatus.Active || lock.lockReference != lockReference || lock.operator != address(this)
                || lock.settlementOperator != address(this)
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(authorization.bidderAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || lock.initialAmount != definition.requiredBondAmount
                || lock.remainingAmount != definition.requiredBondAmount || lock.expiry != definition.bondExpiry
        ) revert ISealedAuctionHouse.BondLockMismatch(bidId);
    }

    function _requireSignature(address signer, bytes32 digest, bytes calldata signature) internal view {
        if (!SignatureChecker.isValidSignatureNowCalldata(signer, digest, signature)) {
            revert ISealedAuctionHouse.InvalidSignature(signer, digest);
        }
    }

    function requireCapacityLock(
        SealedAuctionDependencies memory deps,
        SolverRoute memory route,
        AuctionDefinition storage definition
    ) public view {
        CollateralLock memory lock = deps.auctionVault.getLock(route.capacityLockId);
        bytes32 expectedReference = AuctionHashLib.capacityLockReference(route);
        CollateralId expectedCollateral =
            deps.auctionVault.deriveCollateralId(definition.settlementAssetId, definition.settlementAssetVersion);
        if (
            lock.status != LockStatus.Active
                || lock.operator != address(IAtomicClearingEngine(deps.clearingEngine).positionEngine())
                || lock.settlementOperator != address(IAtomicClearingEngine(deps.clearingEngine).positionEngine())
                || lock.lockReference != expectedReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(route.solverAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || CollateralId.unwrap(route.capacityCollateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(definition.settlementAssetId)
                || lock.bindingVersion != definition.settlementAssetVersion || lock.expiry != route.expiry
                || lock.initialAmount != route.capacityAmount || lock.remainingAmount != route.capacityAmount
        ) revert ISealedAuctionHouse.CapacityLockMismatch(route.routeId);
    }

    function _requireProposedCapacityLock(
        SealedAuctionDependencies memory deps,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        SolverRoute calldata route,
        AuctionDefinition storage definition
    ) internal view {
        SolverRoute storage storedRoute = $routes[route.routeId].route;
        if ($routes[route.routeId].revealed) {
            requireCapacityLock(deps, storedRoute, definition);
            return;
        }
        CollateralLock memory lock = deps.auctionVault.getLock(route.capacityLockId);
        bytes32 expectedReference = AuctionHashLib.capacityLockReference(route);
        CollateralId expectedCollateral =
            deps.auctionVault.deriveCollateralId(definition.settlementAssetId, definition.settlementAssetVersion);
        if (
            lock.status != LockStatus.Active
                || lock.operator != address(IAtomicClearingEngine(deps.clearingEngine).positionEngine())
                || lock.settlementOperator != address(IAtomicClearingEngine(deps.clearingEngine).positionEngine())
                || lock.lockReference != expectedReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(route.solverAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || CollateralId.unwrap(route.capacityCollateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(definition.settlementAssetId)
                || lock.bindingVersion != definition.settlementAssetVersion || lock.expiry != route.expiry
                || lock.initialAmount != route.capacityAmount || lock.remainingAmount != route.capacityAmount
        ) revert ISealedAuctionHouse.CapacityLockMismatch(route.routeId);
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

    function _setBidStatus(BidCommitmentId bidId, BidRecord storage bid, BidStatus newStatus) internal {
        BidStatus previousStatus = bid.status;
        bid.status = newStatus;
        emit ISealedAuctionHouse.BidStatusChanged(bidId, previousStatus, newStatus);
    }
}
