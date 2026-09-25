// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAuctionValidationGate} from "../interfaces/IAuctionValidationGate.sol";
import {IAuctionVault} from "../interfaces/IAuctionVault.sol";
import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {ISealedAuctionHouse} from "../interfaces/ISealedAuctionHouse.sol";
import {AuctionHashLib} from "../libraries/AuctionHashLib.sol";
import {AuctionRankingLib} from "../libraries/AuctionRankingLib.sol";
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
import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    SeriesId
} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";
import {
    AuctionClearingHandoff,
    AuctionClearingResult,
    AuctionDefinition,
    AuctionId,
    AuctionKind,
    AuctionPriceRule,
    AuctionStatus,
    AuctionVersion,
    BidCommitAuthorization,
    BidCommitmentId,
    BidRecord,
    BidStatus,
    BondOutcome,
    NoBidTreatment,
    SealedBid,
    SolverAction,
    SolverRoute,
    SolverRouteId,
    SolverRouteRecord
} from "../types/AuctionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

contract SealedAuctionHouse is
    ISealedAuctionHouse,
    IClearingChannelHandoffAdapter,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    bytes32 public constant AUCTION_SCHEDULER_ROLE = keccak256("SETRYN_AUCTION_SCHEDULER_ROLE");
    bytes32 public constant AUCTION_GUARDIAN_ROLE = keccak256("SETRYN_AUCTION_GUARDIAN_ROLE");
    bytes32 public constant CLEARING_ENGINE_ROLE = keccak256("SETRYN_AUCTION_CLEARING_ENGINE_ROLE");
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
        AuctionHashLib.validateDefinition(definition, packageLegs);
        _validationGate.validateDefinition(definition, packageLegs);
        auctionId = AuctionHashLib.deriveAuctionId(definition);
        bytes32 definitionHash = AuctionHashLib.hashDefinition(definition, block.chainid, address(this));
        if (_definitionVersions[auctionId][definitionHash] != 0) {
            revert DuplicateAuctionDefinition(auctionId, definitionHash);
        }
        version = _latestVersions[auctionId];
        if (version == type(uint32).max) revert AuctionVersionExhausted(auctionId);
        version += 1;
        bytes32 versionHash =
            AuctionHashLib.hashVersion(auctionId, version, definitionHash, block.chainid, address(this));
        _auctions[auctionId][version] = AuctionVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: versionHash,
            version: version,
            status: AuctionStatus.Scheduled,
            commitmentCount: 0,
            revealCount: 0,
            clearingResultHash: bytes32(0)
        });
        _latestVersions[auctionId] = version;
        _definitionVersions[auctionId][definitionHash] = version;
        emit AuctionScheduled(
            auctionId,
            version,
            versionHash,
            definitionHash,
            definition.packageLegsHash,
            definition.commitOpensAt,
            definition.commitClosesAt,
            definition.revealClosesAt
        );
    }

    function advanceAuction(AuctionId auctionId, uint32 version) external nonReentrant {
        AuctionVersion storage auction = _requireAuction(auctionId, version);
        if (auction.status == AuctionStatus.Scheduled) {
            if (block.timestamp < auction.definition.commitOpensAt) {
                revert AuctionPhaseNotReached(auction.definition.commitOpensAt, block.timestamp);
            }
            _setAuctionStatus(auctionId, version, auction, AuctionStatus.CommitOpen);
            return;
        }
        if (auction.status == AuctionStatus.CommitOpen) {
            if (block.timestamp < auction.definition.commitClosesAt) {
                revert AuctionPhaseNotReached(auction.definition.commitClosesAt, block.timestamp);
            }
            _setAuctionStatus(auctionId, version, auction, AuctionStatus.RevealOpen);
            return;
        }
        if (auction.status == AuctionStatus.RevealOpen) {
            if (block.timestamp < auction.definition.revealClosesAt) {
                revert AuctionPhaseNotReached(auction.definition.revealClosesAt, block.timestamp);
            }
            _resolveUnrevealed(auctionId, version, auction.definition);
            _setAuctionStatus(auctionId, version, auction, AuctionStatus.ReadyToClear);
            return;
        }
        revert InvalidAuctionState(auctionId, version, auction.status);
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
        AuctionVersion storage auction = _requireAuction(authorization.auctionId, authorization.auctionVersion);
        if (auction.status != AuctionStatus.CommitOpen) {
            revert InvalidAuctionState(authorization.auctionId, authorization.auctionVersion, auction.status);
        }
        if (block.timestamp >= auction.definition.commitClosesAt) {
            revert AuctionPhaseClosed(auction.definition.commitClosesAt, block.timestamp);
        }
        if (authorization.deadline < block.timestamp || authorization.deadline > auction.definition.commitClosesAt) {
            revert AuctionPhaseClosed(authorization.deadline, block.timestamp);
        }
        if (
            authorization.bidder == address(0) || AccountId.unwrap(authorization.bidderAccountId) == bytes32(0)
                || authorization.sealedBidHash == bytes32(0) || authorization.eligibilityProofHash == bytes32(0)
                || authorization.salt == bytes32(0)
        ) revert BidAuthorizationMismatch();
        if (keccak256(abi.encodePacked(eligibilityProof)) != authorization.eligibilityProofHash) {
            revert EligibilityProofMismatch();
        }
        if (auction.commitmentCount >= auction.definition.maximumBids) {
            revert AuctionCapacityReached(auction.definition.maximumBids);
        }
        bidId = AuctionHashLib.deriveBidCommitmentId(authorization);
        if (_bids[bidId].status != BidStatus.Unspecified) revert DuplicateBid(bidId);
        bytes32 digest = AuctionHashLib.bidCommitDigest(authorization, block.chainid, address(this));
        _requireSignature(authorization.bidder, digest, signature);
        _validationGate.validateCommit(auction.definition, authorization, eligibilityProof);

        bytes32 lockReference = keccak256(abi.encode(BOND_LOCK_REFERENCE_TYPEHASH, BidCommitmentId.unwrap(bidId)));
        CollateralLockId bondLockId = _auctionVault.createLock(
            lockReference,
            authorization.bidderAccountId,
            auction.definition.bondAssetId,
            auction.definition.bondBindingVersion,
            auction.definition.requiredBondAmount,
            auction.definition.bondExpiry,
            address(this)
        );
        _requireBondLock(auction.definition, authorization, bidId, bondLockId, lockReference);
        _bids[bidId].authorization = authorization;
        _bids[bidId].bondLockId = bondLockId;
        _bids[bidId].status = BidStatus.Committed;
        _auctionBidIds[authorization.auctionId][authorization.auctionVersion].push(bidId);
        auction.commitmentCount += 1;
        emit BidCommitted(
            authorization.auctionId,
            authorization.auctionVersion,
            bidId,
            authorization.sealedBidHash,
            CollateralLockId.unwrap(bondLockId)
        );
    }

    function revealBid(BidCommitmentId bidId, SealedBid calldata bid) external nonReentrant {
        BidRecord storage record = _prepareReveal(bidId, bid);
        AuctionVersion storage auction = _auctions[bid.auctionId][bid.auctionVersion];
        if (auction.definition.kind != AuctionKind.BatchOrder) revert RouteMismatch();
        _validationGate.validateBid(auction.definition, bid);
        _finishReveal(bidId, record, auction, bid, SolverRouteId.wrap(bytes32(0)));
    }

    function revealSolverBid(
        BidCommitmentId bidId,
        SealedBid calldata bid,
        SolverRoute calldata route,
        PackageLeg[] calldata routeLegs,
        SolverAction[] calldata actions
    ) external nonReentrant {
        BidRecord storage record = _prepareReveal(bidId, bid);
        AuctionVersion storage auction = _auctions[bid.auctionId][bid.auctionVersion];
        if (auction.definition.kind != AuctionKind.SolverRoute) revert RouteMismatch();
        _validationGate.validateBid(auction.definition, bid);
        AuctionHashLib.validateRoute(route, auction.definition, routeLegs, actions);
        _validationGate.validateRoute(auction.definition, route, routeLegs, actions);
        if (
            AuctionId.unwrap(route.auctionId) != AuctionId.unwrap(bid.auctionId)
                || route.auctionVersion != bid.auctionVersion || route.solver != bid.bidder
                || AccountId.unwrap(route.solverAccountId) != AccountId.unwrap(bid.bidderAccountId)
                || SolverRouteId.unwrap(route.routeId) != SolverRouteId.unwrap(bid.solverRouteId)
                || PriceTicks.unwrap(route.packageOutcomeTicks) != PriceTicks.unwrap(bid.priceTicks)
                || route.maximumFeeMinor != bid.maximumFeeMinor
                || route.capacityEvidenceHash != bid.capacityEvidenceHash
        ) revert RouteMismatch();
        if (_routes[route.routeId].revealed) revert DuplicateRoute(route.routeId);
        bytes32 capacityLockKey = CollateralLockId.unwrap(route.capacityLockId);
        SolverRouteId claimedRouteId = _capacityLockClaims[capacityLockKey];
        if (SolverRouteId.unwrap(claimedRouteId) != bytes32(0)) {
            revert CapacityLockAlreadyClaimed(capacityLockKey, claimedRouteId);
        }
        bytes32 capacityLockReference =
            keccak256(abi.encode(CAPACITY_LOCK_REFERENCE_TYPEHASH, SolverRouteId.unwrap(route.routeId)));
        CollateralLockId capacityLockId = IAtomicClearingEngine(_clearingEngine).positionEngine()
            .createPositionFundingLock(
                capacityLockReference,
                route.solverAccountId,
                auction.definition.settlementAssetId,
                auction.definition.settlementAssetVersion,
                route.capacityAmount,
                route.expiry
            );
        if (CollateralLockId.unwrap(capacityLockId) != CollateralLockId.unwrap(route.capacityLockId)) {
            revert CapacityLockMismatch(route.routeId);
        }
        _requireCapacityLock(route, auction.definition);
        bytes32 routeHash = AuctionHashLib.hashRoute(route);
        _routes[route.routeId] = SolverRouteRecord({route: route, routeHash: routeHash, revealed: true});
        _capacityLockClaims[capacityLockKey] = route.routeId;
        _finishReveal(bidId, record, auction, bid, route.routeId);
    }

    function clearAuction(AuctionId auctionId, uint32 version) external nonReentrant returns (bytes32 resultHash) {
        AuctionVersion storage auction = _requireAuction(auctionId, version);
        if (auction.status != AuctionStatus.ReadyToClear) {
            revert InvalidAuctionState(auctionId, version, auction.status);
        }
        if (block.timestamp > auction.definition.clearDeadline) {
            _failAuction(auctionId, version, auction);
            return bytes32(0);
        }
        (
            BidCommitmentId[] memory winners,
            Lots[] memory allocations,
            PriceTicks[] memory prices,
            AuctionClearingResult memory result
        ) = _computeResult(auctionId, version, auction.definition);
        if (result.winnerCount == 0) {
            _resolveNoBid(auctionId, version, auction);
            return bytes32(0);
        }
        for (uint256 i; i < winners.length; ++i) {
            if (BidCommitmentId.unwrap(winners[i]) == bytes32(0)) continue;
            BidRecord storage winner = _bids[winners[i]];
            winner.allocatedLots = allocations[i];
            winner.allocationPriceTicks = prices[i];
            _setBidStatus(winners[i], winner, BidStatus.Winner);
        }
        _resolveLosingBids(auctionId, version, auction.definition);
        _results[auctionId][version] = result;
        auction.clearingResultHash = result.resultHash;
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Cleared);
        emit AuctionCleared(auctionId, version, result.resultHash, result.allocationsHash, result.winnerCount);
        return result.resultHash;
    }

    function verifyClearingResult(AuctionId auctionId, uint32 version) external view returns (bool) {
        AuctionVersion storage auction = _requireAuction(auctionId, version);
        if (auction.clearingResultHash == bytes32(0)) return false;
        (,,, AuctionClearingResult memory expected) = _computeResult(auctionId, version, auction.definition);
        return expected.resultHash == auction.clearingResultHash;
    }

    function consumeClearingHandoff(AuctionId auctionId, uint32 version, bytes32 executionReference)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
        returns (AuctionClearingHandoff memory handoff)
    {
        return _consumeClearingHandoff(auctionId, version, executionReference);
    }

    function _consumeClearingHandoff(AuctionId auctionId, uint32 version, bytes32 executionReference)
        private
        returns (AuctionClearingHandoff memory handoff)
    {
        if (executionReference == bytes32(0)) revert ZeroReference();
        if (_executionReferences[executionReference]) revert ExecutionReferenceUsed(executionReference);
        if (_handoffConsumed[auctionId][version]) revert ClearingHandoffAlreadyConsumed(auctionId, version);
        AuctionVersion storage auction = _requireAuction(auctionId, version);
        if (auction.status != AuctionStatus.Cleared) revert InvalidAuctionState(auctionId, version, auction.status);
        if (block.timestamp > auction.definition.settlementDeadline) {
            revert SettlementDeadlinePassed(auction.definition.settlementDeadline, block.timestamp);
        }
        AuctionClearingResult storage result = _results[auctionId][version];
        if (result.resultHash == bytes32(0)) revert NoClearingResult();
        CollateralLockId capacityLockId;
        uint128 capacityAmount;
        if (auction.definition.kind == AuctionKind.SolverRoute) {
            BidRecord storage winner = _bids[result.winningRouteBidId];
            SolverRoute storage route = _routes[winner.routeId].route;
            _requireCapacityLock(route, auction.definition);
            capacityLockId = route.capacityLockId;
            capacityAmount = route.capacityAmount;
        }
        _handoffConsumed[auctionId][version] = true;
        _executionReferences[executionReference] = true;
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
        emit ClearingHandoffConsumed(
            auctionId, version, executionReference, result.resultHash, CollateralLockId.unwrap(capacityLockId)
        );
    }

    function consumeTypedHandoff(ClearingHandoffClaim calldata claim)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
        returns (VerifiedClearingHandoff memory handoff)
    {
        if (claim.kind != ClearingHandoffKind.SealedAuction) {
            revert HandoffClaimMismatch();
        }
        AuctionId auctionId = AuctionId.wrap(claim.sourceId);
        AuctionVersion storage auction = _requireAuction(auctionId, claim.sourceVersion);
        AuctionClearingResult storage result = _results[auctionId][claim.sourceVersion];
        if (auction.definition.kind != AuctionKind.SolverRoute || result.winnerCount != 1) {
            revert HandoffClaimMismatch();
        }
        BidRecord storage winner = _requireBid(result.winningRouteBidId);
        SolverRouteRecord storage routeRecord = _routes[winner.routeId];
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
                || claim.riskDomainId != auction.definition.riskDomainId
                || claim.riskDomainVersion != auction.definition.riskDomainVersion
                || claim.executionModeId != auction.definition.executionModeId
                || claim.deadline != auction.definition.settlementDeadline
        ) revert HandoffClaimMismatch();
        if (packageTarget) {
            if (
                claim.targetKind != OrderTargetKind.Package
                    || PackageId.unwrap(claim.packageId) != PackageId.unwrap(auction.definition.packageId)
                    || claim.packageWitnessHash != auction.definition.packageLegsHash
                    || PackageDefinitionLib.hashLegs(claim.packageLegs) != auction.definition.packageLegsHash
            ) revert HandoffClaimMismatch();
        } else if (
            claim.targetKind != OrderTargetKind.Series
                || SeriesId.unwrap(claim.seriesId) != SeriesId.unwrap(auction.definition.seriesId)
                || claim.packageLegs.length != 0 || claim.packageWitnessHash != bytes32(0)
        ) {
            revert HandoffClaimMismatch();
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
            ) revert HandoffClaimMismatch();
            reserved += disposition.reservationAmount;
            if (reserved > route.capacityAmount) revert HandoffClaimMismatch();
            expectedRemaining -= disposition.reservationAmount;
        }
        if (reserved == 0) revert HandoffClaimMismatch();
        _consumeClearingHandoff(auctionId, claim.sourceVersion, claim.consumptionId);
        _handoffAuctions[claim.consumptionId] = auctionId;
        _handoffVersions[claim.consumptionId] = claim.sourceVersion;
        handoff = VerifiedClearingHandoff({
            claim: claim,
            provenanceHash: keccak256(abi.encode(block.chainid, address(this), expectedCommitment, claim.consumptionId))
        });
    }

    function finalizeTypedHandoff(bytes32 consumptionId, bytes32 fillId, bytes32 positionsHash)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
    {
        if (!_executionReferences[consumptionId] || fillId == bytes32(0) || positionsHash == bytes32(0)) {
            revert HandoffClaimMismatch();
        }
        _settleAuction(_handoffAuctions[consumptionId], _handoffVersions[consumptionId], fillId);
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
        _settleAuction(auctionId, version, settlementReference);
    }

    function _settleAuction(AuctionId auctionId, uint32 version, bytes32 settlementReference) private {
        if (settlementReference == bytes32(0)) revert ZeroReference();
        AuctionVersion storage auction = _requireAuction(auctionId, version);
        if (auction.status != AuctionStatus.Cleared || !_handoffConsumed[auctionId][version]) {
            revert InvalidAuctionState(auctionId, version, auction.status);
        }
        if (block.timestamp > auction.definition.settlementDeadline) {
            revert SettlementDeadlinePassed(auction.definition.settlementDeadline, block.timestamp);
        }
        _resolveWinningBonds(auctionId, version, BondOutcome.Release, auction.definition);
        if (auction.definition.kind == AuctionKind.SolverRoute) {
            BidRecord storage winner = _bids[_results[auctionId][version].winningRouteBidId];
            CollateralLockId capacityLockId = _routes[winner.routeId].route.capacityLockId;
            CollateralLock memory capacityLock = _auctionVault.getLock(capacityLockId);
            if (capacityLock.status == LockStatus.Active) {
                IAtomicClearingEngine(_clearingEngine).positionEngine().releasePositionFundingLock(capacityLockId);
            }
        }
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Settled);
        emit AuctionSettled(auctionId, version, settlementReference);
    }

    function failExpiredSettlement(AuctionId auctionId, uint32 version) external nonReentrant {
        AuctionVersion storage auction = _requireAuction(auctionId, version);
        if (auction.status != AuctionStatus.Cleared) revert InvalidAuctionState(auctionId, version, auction.status);
        if (block.timestamp <= auction.definition.settlementDeadline) {
            revert SettlementDeadlineNotReached(auction.definition.settlementDeadline, block.timestamp);
        }
        _resolveWinningBonds(auctionId, version, auction.definition.settlementFailureBondOutcome, auction.definition);
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Failed);
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

    function _prepareReveal(BidCommitmentId bidId, SealedBid calldata bid)
        private
        view
        returns (BidRecord storage record)
    {
        record = _requireBid(bidId);
        if (record.status != BidStatus.Committed) revert InvalidBidState(bidId, record.status);
        AuctionVersion storage auction = _requireAuction(bid.auctionId, bid.auctionVersion);
        if (auction.status != AuctionStatus.RevealOpen) {
            revert InvalidAuctionState(bid.auctionId, bid.auctionVersion, auction.status);
        }
        if (block.timestamp >= auction.definition.revealClosesAt) {
            revert AuctionPhaseClosed(auction.definition.revealClosesAt, block.timestamp);
        }
        BidCommitAuthorization storage authorization = record.authorization;
        if (
            bid.auctionId != authorization.auctionId || bid.auctionVersion != authorization.auctionVersion
                || bid.bidder != authorization.bidder
                || AccountId.unwrap(bid.bidderAccountId) != AccountId.unwrap(authorization.bidderAccountId)
                || bid.nonce != authorization.nonce
        ) revert BidAuthorizationMismatch();
        bytes32 actualHash = AuctionHashLib.hashBid(bid);
        if (actualHash != authorization.sealedBidHash) {
            revert BidCommitmentMismatch(authorization.sealedBidHash, actualHash);
        }
    }

    function _finishReveal(
        BidCommitmentId bidId,
        BidRecord storage record,
        AuctionVersion storage auction,
        SealedBid calldata bid,
        SolverRouteId routeId
    ) private {
        AuctionHashLib.validateBid(bid, auction.definition);
        record.bid = bid;
        record.routeId = routeId;
        _setBidStatus(bidId, record, BidStatus.Revealed);
        auction.revealCount += 1;
        emit BidRevealed(bid.auctionId, bid.auctionVersion, bidId, record.authorization.sealedBidHash, routeId);
    }

    function _computeResult(AuctionId auctionId, uint32 version, AuctionDefinition storage definition)
        private
        view
        returns (
            BidCommitmentId[] memory winners,
            Lots[] memory allocations,
            PriceTicks[] memory prices,
            AuctionClearingResult memory result
        )
    {
        BidCommitmentId[] storage bidIds = _auctionBidIds[auctionId][version];
        winners = new BidCommitmentId[](bidIds.length);
        allocations = new Lots[](bidIds.length);
        prices = new PriceTicks[](bidIds.length);
        if (definition.kind == AuctionKind.SolverRoute) {
            return _computeRouteResult(auctionId, version, definition, bidIds, winners, allocations, prices);
        }
        bool[] memory selected = new bool[](bidIds.length);
        uint128 remaining = Lots.unwrap(definition.totalLots);
        uint16 winnerCount;
        PriceTicks uniformPrice;
        bytes32 allocationsHash;
        for (uint256 rank; rank < bidIds.length && remaining != 0; ++rank) {
            (bool found, uint256 bestIndex) = _findBestBid(bidIds, selected, definition.auctionSide);
            if (!found) break;
            selected[bestIndex] = true;
            BidCommitmentId bidId = bidIds[bestIndex];
            SealedBid storage bid = _bids[bidId].bid;
            uint128 requested = Lots.unwrap(bid.lots);
            uint128 allocated;
            if (requested <= remaining) {
                allocated = requested;
            } else if (bid.allowPartialAllocation && remaining >= Lots.unwrap(bid.minimumFillLots)) {
                allocated = remaining;
            } else {
                continue;
            }
            remaining -= allocated;
            winners[winnerCount] = bidId;
            allocations[winnerCount] = Lots.wrap(allocated);
            prices[winnerCount] = bid.priceTicks;
            uniformPrice = bid.priceTicks;
            allocationsHash = keccak256(
                abi.encode(
                    allocationsHash,
                    ALLOCATION_TYPEHASH,
                    BidCommitmentId.unwrap(bidId),
                    allocated,
                    PriceTicks.unwrap(bid.priceTicks)
                )
            );
            winnerCount += 1;
        }
        if (definition.priceRule == AuctionPriceRule.UniformPrice) {
            allocationsHash = bytes32(0);
            for (uint256 i; i < winnerCount; ++i) {
                prices[i] = uniformPrice;
                allocationsHash = keccak256(
                    abi.encode(
                        allocationsHash,
                        ALLOCATION_TYPEHASH,
                        BidCommitmentId.unwrap(winners[i]),
                        Lots.unwrap(allocations[i]),
                        PriceTicks.unwrap(uniformPrice)
                    )
                );
            }
        }
        uint128 allocatedTotal = Lots.unwrap(definition.totalLots) - remaining;
        bytes32 resultHash = AuctionHashLib.hashResult(
            auctionId,
            version,
            BidCommitmentId.wrap(bytes32(0)),
            uniformPrice,
            Lots.wrap(allocatedTotal),
            winnerCount,
            allocationsHash
        );
        result = AuctionClearingResult({
            auctionId: auctionId,
            auctionVersion: version,
            winningRouteBidId: BidCommitmentId.wrap(bytes32(0)),
            uniformPriceTicks: uniformPrice,
            totalAllocatedLots: Lots.wrap(allocatedTotal),
            winnerCount: winnerCount,
            allocationsHash: allocationsHash,
            resultHash: resultHash
        });
    }

    function _computeRouteResult(
        AuctionId auctionId,
        uint32 version,
        AuctionDefinition storage definition,
        BidCommitmentId[] storage bidIds,
        BidCommitmentId[] memory winners,
        Lots[] memory allocations,
        PriceTicks[] memory prices
    )
        private
        view
        returns (BidCommitmentId[] memory, Lots[] memory, PriceTicks[] memory, AuctionClearingResult memory result)
    {
        bool found;
        BidCommitmentId bestId;
        SolverRoute memory bestRoute;
        for (uint256 i; i < bidIds.length; ++i) {
            BidCommitmentId bidId = bidIds[i];
            BidRecord storage bid = _bids[bidId];
            if (bid.bid.bidder == address(0)) continue;
            SolverRoute memory route = _routes[bid.routeId].route;
            if (!found || AuctionRankingLib.isBetterRoute(route, bidId, bestRoute, bestId, definition.auctionSide)) {
                found = true;
                bestId = bidId;
                bestRoute = route;
            }
        }
        uint16 winnerCount;
        Lots allocated;
        bytes32 allocationsHash;
        if (found) {
            winnerCount = 1;
            allocated = _bids[bestId].bid.lots;
            winners[0] = bestId;
            allocations[0] = allocated;
            prices[0] = bestRoute.packageOutcomeTicks;
            allocationsHash = keccak256(
                abi.encode(
                    bytes32(0),
                    ALLOCATION_TYPEHASH,
                    BidCommitmentId.unwrap(bestId),
                    Lots.unwrap(allocated),
                    PriceTicks.unwrap(bestRoute.packageOutcomeTicks)
                )
            );
        }
        bytes32 resultHash = AuctionHashLib.hashResult(
            auctionId, version, bestId, bestRoute.packageOutcomeTicks, allocated, winnerCount, allocationsHash
        );
        result = AuctionClearingResult({
            auctionId: auctionId,
            auctionVersion: version,
            winningRouteBidId: bestId,
            uniformPriceTicks: bestRoute.packageOutcomeTicks,
            totalAllocatedLots: allocated,
            winnerCount: winnerCount,
            allocationsHash: allocationsHash,
            resultHash: resultHash
        });
        return (winners, allocations, prices, result);
    }

    function _findBestBid(BidCommitmentId[] storage bidIds, bool[] memory selected, Side auctionSide)
        private
        view
        returns (bool found, uint256 bestIndex)
    {
        BidCommitmentId bestId;
        SealedBid memory bestBid;
        for (uint256 i; i < bidIds.length; ++i) {
            if (selected[i]) continue;
            BidCommitmentId candidateId = bidIds[i];
            BidRecord storage candidate = _bids[candidateId];
            if (candidate.bid.bidder == address(0)) continue;
            if (!found || AuctionRankingLib.isBetterBid(candidate.bid, candidateId, bestBid, bestId, auctionSide)) {
                found = true;
                bestIndex = i;
                bestId = candidateId;
                bestBid = candidate.bid;
            }
        }
    }

    function _resolveUnrevealed(AuctionId auctionId, uint32 version, AuctionDefinition storage definition) private {
        BidCommitmentId[] storage bidIds = _auctionBidIds[auctionId][version];
        for (uint256 i; i < bidIds.length; ++i) {
            BidRecord storage bid = _bids[bidIds[i]];
            if (bid.status != BidStatus.Committed) continue;
            _setBidStatus(bidIds[i], bid, BidStatus.Unrevealed);
            _applyBondOutcome(bidIds[i], bid, definition.unrevealedBondOutcome, definition);
        }
    }

    function _resolveLosingBids(AuctionId auctionId, uint32 version, AuctionDefinition storage definition) private {
        BidCommitmentId[] storage bidIds = _auctionBidIds[auctionId][version];
        for (uint256 i; i < bidIds.length; ++i) {
            BidRecord storage bid = _bids[bidIds[i]];
            if (bid.status != BidStatus.Revealed) continue;
            _setBidStatus(bidIds[i], bid, BidStatus.Loser);
            if (SolverRouteId.unwrap(bid.routeId) != bytes32(0)) {
                CollateralLockId capacityLockId = _routes[bid.routeId].route.capacityLockId;
                delete _capacityLockClaims[CollateralLockId.unwrap(capacityLockId)];
                CollateralLock memory capacityLock = _auctionVault.getLock(capacityLockId);
                if (capacityLock.status == LockStatus.Active) {
                    IAtomicClearingEngine(_clearingEngine).positionEngine().releasePositionFundingLock(capacityLockId);
                }
            }
            _applyBondOutcome(bidIds[i], bid, definition.losingBondOutcome, definition);
        }
    }

    function _resolveWinningBonds(
        AuctionId auctionId,
        uint32 version,
        BondOutcome outcome,
        AuctionDefinition storage definition
    ) private {
        BidCommitmentId[] storage bidIds = _auctionBidIds[auctionId][version];
        for (uint256 i; i < bidIds.length; ++i) {
            BidRecord storage bid = _bids[bidIds[i]];
            if (bid.status == BidStatus.Winner) _applyBondOutcome(bidIds[i], bid, outcome, definition);
        }
    }

    function _applyBondOutcome(
        BidCommitmentId bidId,
        BidRecord storage bid,
        BondOutcome outcome,
        AuctionDefinition storage definition
    ) private {
        if (outcome == BondOutcome.Expire) return;
        if (outcome == BondOutcome.Release) {
            _auctionVault.releaseLock(bid.bondLockId);
            _setBidStatus(bidId, bid, BidStatus.BondReleased);
            return;
        }
        if (outcome == BondOutcome.Slash) {
            _auctionVault.consumeLock(bid.bondLockId, definition.slashRecipientAccountId, definition.requiredBondAmount);
            _setBidStatus(bidId, bid, BidStatus.BondSlashed);
            return;
        }
        revert InvalidBidState(bidId, bid.status);
    }

    function _resolveNoBid(AuctionId auctionId, uint32 version, AuctionVersion storage auction) private {
        _resolveLosingBids(auctionId, version, auction.definition);
        AuctionStatus status =
            auction.definition.noBidTreatment == NoBidTreatment.Cancel ? AuctionStatus.Cancelled : AuctionStatus.Failed;
        _setAuctionStatus(auctionId, version, auction, status);
    }

    function _failAuction(AuctionId auctionId, uint32 version, AuctionVersion storage auction) private {
        _resolveLosingBids(auctionId, version, auction.definition);
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Failed);
    }

    function _requireBondLock(
        AuctionDefinition storage definition,
        BidCommitAuthorization calldata authorization,
        BidCommitmentId bidId,
        CollateralLockId lockId,
        bytes32 lockReference
    ) private view {
        CollateralLock memory lock = _auctionVault.getLock(lockId);
        CollateralId expectedCollateral =
            _auctionVault.deriveCollateralId(definition.bondAssetId, definition.bondBindingVersion);
        if (
            lock.status != LockStatus.Active || lock.lockReference != lockReference || lock.operator != address(this)
                || lock.settlementOperator != address(this)
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(authorization.bidderAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || lock.initialAmount != definition.requiredBondAmount
                || lock.remainingAmount != definition.requiredBondAmount || lock.expiry != definition.bondExpiry
        ) revert BondLockMismatch(bidId);
    }

    function _requireCapacityLock(SolverRoute storage route, AuctionDefinition storage definition) private view {
        CollateralLock memory lock = _auctionVault.getLock(route.capacityLockId);
        bytes32 expectedReference =
            keccak256(abi.encode(CAPACITY_LOCK_REFERENCE_TYPEHASH, SolverRouteId.unwrap(route.routeId)));
        CollateralId expectedCollateral =
            _auctionVault.deriveCollateralId(definition.settlementAssetId, definition.settlementAssetVersion);
        if (
            lock.status != LockStatus.Active
                || lock.operator != address(IAtomicClearingEngine(_clearingEngine).positionEngine())
                || lock.settlementOperator != address(IAtomicClearingEngine(_clearingEngine).positionEngine())
                || lock.lockReference != expectedReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(route.solverAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || CollateralId.unwrap(route.capacityCollateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(definition.settlementAssetId)
                || lock.bindingVersion != definition.settlementAssetVersion || lock.expiry != route.expiry
                || lock.initialAmount != route.capacityAmount || lock.remainingAmount != route.capacityAmount
        ) revert CapacityLockMismatch(route.routeId);
    }

    function _requireProposedCapacityLock(SolverRoute calldata route, AuctionDefinition storage definition)
        private
        view
    {
        SolverRoute storage storedRoute = _routes[route.routeId].route;
        if (_routes[route.routeId].revealed) {
            _requireCapacityLock(storedRoute, definition);
            return;
        }
        CollateralLock memory lock = _auctionVault.getLock(route.capacityLockId);
        bytes32 expectedReference =
            keccak256(abi.encode(CAPACITY_LOCK_REFERENCE_TYPEHASH, SolverRouteId.unwrap(route.routeId)));
        CollateralId expectedCollateral =
            _auctionVault.deriveCollateralId(definition.settlementAssetId, definition.settlementAssetVersion);
        if (
            lock.status != LockStatus.Active
                || lock.operator != address(IAtomicClearingEngine(_clearingEngine).positionEngine())
                || lock.settlementOperator != address(IAtomicClearingEngine(_clearingEngine).positionEngine())
                || lock.lockReference != expectedReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(route.solverAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || CollateralId.unwrap(route.capacityCollateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(definition.settlementAssetId)
                || lock.bindingVersion != definition.settlementAssetVersion || lock.expiry != route.expiry
                || lock.initialAmount != route.capacityAmount || lock.remainingAmount != route.capacityAmount
        ) revert CapacityLockMismatch(route.routeId);
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

    function _requireSignature(address signer, bytes32 digest, bytes calldata signature) private view {
        if (!SignatureChecker.isValidSignatureNowCalldata(signer, digest, signature)) {
            revert InvalidSignature(signer, digest);
        }
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency();
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
