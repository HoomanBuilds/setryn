// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {ISealedAuctionHouse} from "../interfaces/ISealedAuctionHouse.sol";
import {AuctionHashLib} from "../libraries/AuctionHashLib.sol";
import {AuctionRankingLib} from "../libraries/AuctionRankingLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {LockStatus, Side} from "../types/Enums.sol";
import {CollateralLockId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    AuctionClearingResult,
    AuctionDefinition,
    AuctionId,
    AuctionKind,
    AuctionPriceRule,
    AuctionStatus,
    AuctionVersion,
    BidCommitmentId,
    BidRecord,
    BidStatus,
    BondOutcome,
    NoBidTreatment,
    SealedBid,
    SolverRoute,
    SolverRouteId,
    SolverRouteRecord
} from "../types/AuctionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

import {SealedAuctionDependencies} from "./SealedAuctionTypes.sol";

/// Linked logic for the sealed auction house: scheduling, phase advancement, deterministic clearing, and bond
/// outcomes. Runs through DELEGATECALL in the auction house's context against its storage.
library SealedAuctionClearingLib {
    bytes32 internal constant ALLOCATION_TYPEHASH =
        keccak256("SetrynAuctionAllocationV1(bytes32 bidId,uint128 allocatedLots,int128 allocationPriceTicks)");

    function scheduleAuction(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(AuctionId auctionId => uint32 latestVersion) storage $latestVersions,
        mapping(AuctionId auctionId => mapping(bytes32 definitionHash => uint32 version)) storage $definitionVersions,
        AuctionDefinition calldata definition,
        PackageLeg[] calldata packageLegs
    ) external returns (AuctionId auctionId, uint32 version) {
        AuctionHashLib.validateDefinition(definition, packageLegs);
        deps.validationGate.validateDefinition(definition, packageLegs);
        auctionId = AuctionHashLib.deriveAuctionId(definition);
        bytes32 definitionHash = AuctionHashLib.hashDefinition(definition, block.chainid, address(this));
        if ($definitionVersions[auctionId][definitionHash] != 0) {
            revert ISealedAuctionHouse.DuplicateAuctionDefinition(auctionId, definitionHash);
        }
        version = $latestVersions[auctionId];
        if (version == type(uint32).max) revert ISealedAuctionHouse.AuctionVersionExhausted(auctionId);
        version += 1;
        bytes32 versionHash =
            AuctionHashLib.hashVersion(auctionId, version, definitionHash, block.chainid, address(this));
        $auctions[auctionId][version] = AuctionVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: versionHash,
            version: version,
            status: AuctionStatus.Scheduled,
            commitmentCount: 0,
            revealCount: 0,
            clearingResultHash: bytes32(0)
        });
        $latestVersions[auctionId] = version;
        $definitionVersions[auctionId][definitionHash] = version;
        emit ISealedAuctionHouse.AuctionScheduled(
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

    function advanceAuction(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        AuctionId auctionId,
        uint32 version
    ) external {
        AuctionVersion storage auction = _requireAuction($auctions, auctionId, version);
        if (auction.status == AuctionStatus.Scheduled) {
            if (block.timestamp < auction.definition.commitOpensAt) {
                revert ISealedAuctionHouse.AuctionPhaseNotReached(auction.definition.commitOpensAt, block.timestamp);
            }
            _setAuctionStatus(auctionId, version, auction, AuctionStatus.CommitOpen);
            return;
        }
        if (auction.status == AuctionStatus.CommitOpen) {
            if (block.timestamp < auction.definition.commitClosesAt) {
                revert ISealedAuctionHouse.AuctionPhaseNotReached(auction.definition.commitClosesAt, block.timestamp);
            }
            _setAuctionStatus(auctionId, version, auction, AuctionStatus.RevealOpen);
            return;
        }
        if (auction.status == AuctionStatus.RevealOpen) {
            if (block.timestamp < auction.definition.revealClosesAt) {
                revert ISealedAuctionHouse.AuctionPhaseNotReached(auction.definition.revealClosesAt, block.timestamp);
            }
            _resolveUnrevealed(deps, $auctionBidIds, $bids, auctionId, version, auction.definition);
            _setAuctionStatus(auctionId, version, auction, AuctionStatus.ReadyToClear);
            return;
        }
        revert ISealedAuctionHouse.InvalidAuctionState(auctionId, version, auction.status);
    }

    function clearAuction(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(bytes32 capacityLockId => SolverRouteId routeId) storage $capacityLockClaims,
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionClearingResult result)) storage $results,
        AuctionId auctionId,
        uint32 version
    ) external returns (bytes32 resultHash) {
        AuctionVersion storage auction = _requireAuction($auctions, auctionId, version);
        if (auction.status != AuctionStatus.ReadyToClear) {
            revert ISealedAuctionHouse.InvalidAuctionState(auctionId, version, auction.status);
        }
        if (block.timestamp > auction.definition.clearDeadline) {
            _failAuction(deps, $auctionBidIds, $bids, $routes, $capacityLockClaims, auctionId, version, auction);
            return bytes32(0);
        }
        (
            BidCommitmentId[] memory winners,
            Lots[] memory allocations,
            PriceTicks[] memory prices,
            AuctionClearingResult memory result
        ) = _computeResult($auctionBidIds, $bids, $routes, auctionId, version, auction.definition);
        if (result.winnerCount == 0) {
            _resolveNoBid(deps, $auctionBidIds, $bids, $routes, $capacityLockClaims, auctionId, version, auction);
            return bytes32(0);
        }
        for (uint256 i; i < winners.length; ++i) {
            if (BidCommitmentId.unwrap(winners[i]) == bytes32(0)) continue;
            BidRecord storage winner = $bids[winners[i]];
            winner.allocatedLots = allocations[i];
            winner.allocationPriceTicks = prices[i];
            _setBidStatus(winners[i], winner, BidStatus.Winner);
        }
        _resolveLosingBids(
            deps, $auctionBidIds, $bids, $routes, $capacityLockClaims, auctionId, version, auction.definition
        );
        $results[auctionId][version] = result;
        auction.clearingResultHash = result.resultHash;
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Cleared);
        emit ISealedAuctionHouse.AuctionCleared(
            auctionId, version, result.resultHash, result.allocationsHash, result.winnerCount
        );
        return result.resultHash;
    }

    function verifyClearingResult(
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        AuctionId auctionId,
        uint32 version
    ) external view returns (bool) {
        AuctionVersion storage auction = _requireAuction($auctions, auctionId, version);
        if (auction.clearingResultHash == bytes32(0)) return false;
        (,,, AuctionClearingResult memory expected) =
            _computeResult($auctionBidIds, $bids, $routes, auctionId, version, auction.definition);
        return expected.resultHash == auction.clearingResultHash;
    }

    function _computeResult(
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        AuctionId auctionId,
        uint32 version,
        AuctionDefinition storage definition
    )
        internal
        view
        returns (
            BidCommitmentId[] memory winners,
            Lots[] memory allocations,
            PriceTicks[] memory prices,
            AuctionClearingResult memory result
        )
    {
        BidCommitmentId[] storage bidIds = $auctionBidIds[auctionId][version];
        winners = new BidCommitmentId[](bidIds.length);
        allocations = new Lots[](bidIds.length);
        prices = new PriceTicks[](bidIds.length);
        if (definition.kind == AuctionKind.SolverRoute) {
            return
                _computeRouteResult(
                    $bids, $routes, auctionId, version, definition, bidIds, winners, allocations, prices
                );
        }
        bool[] memory selected = new bool[](bidIds.length);
        uint128 remaining = Lots.unwrap(definition.totalLots);
        uint16 winnerCount;
        PriceTicks uniformPrice;
        bytes32 allocationsHash;
        for (uint256 rank; rank < bidIds.length && remaining != 0; ++rank) {
            (bool found, uint256 bestIndex) = _findBestBid($bids, bidIds, selected, definition.auctionSide);
            if (!found) break;
            selected[bestIndex] = true;
            BidCommitmentId bidId = bidIds[bestIndex];
            SealedBid storage bid = $bids[bidId].bid;
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
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        AuctionId auctionId,
        uint32 version,
        AuctionDefinition storage definition,
        BidCommitmentId[] storage bidIds,
        BidCommitmentId[] memory winners,
        Lots[] memory allocations,
        PriceTicks[] memory prices
    )
        internal
        view
        returns (BidCommitmentId[] memory, Lots[] memory, PriceTicks[] memory, AuctionClearingResult memory result)
    {
        bool found;
        BidCommitmentId bestId;
        SolverRoute memory bestRoute;
        for (uint256 i; i < bidIds.length; ++i) {
            BidCommitmentId bidId = bidIds[i];
            BidRecord storage bid = $bids[bidId];
            if (bid.bid.bidder == address(0)) continue;
            SolverRoute memory route = $routes[bid.routeId].route;
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
            allocated = $bids[bestId].bid.lots;
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

    function _findBestBid(
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        BidCommitmentId[] storage bidIds,
        bool[] memory selected,
        Side auctionSide
    ) internal view returns (bool found, uint256 bestIndex) {
        BidCommitmentId bestId;
        SealedBid memory bestBid;
        for (uint256 i; i < bidIds.length; ++i) {
            if (selected[i]) continue;
            BidCommitmentId candidateId = bidIds[i];
            BidRecord storage candidate = $bids[candidateId];
            if (candidate.bid.bidder == address(0)) continue;
            if (!found || AuctionRankingLib.isBetterBid(candidate.bid, candidateId, bestBid, bestId, auctionSide)) {
                found = true;
                bestIndex = i;
                bestId = candidateId;
                bestBid = candidate.bid;
            }
        }
    }

    function _resolveUnrevealed(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        AuctionId auctionId,
        uint32 version,
        AuctionDefinition storage definition
    ) internal {
        BidCommitmentId[] storage bidIds = $auctionBidIds[auctionId][version];
        for (uint256 i; i < bidIds.length; ++i) {
            BidRecord storage bid = $bids[bidIds[i]];
            if (bid.status != BidStatus.Committed) continue;
            _setBidStatus(bidIds[i], bid, BidStatus.Unrevealed);
            applyBondOutcome(deps, bidIds[i], bid, definition.unrevealedBondOutcome, definition);
        }
    }

    function _resolveLosingBids(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(bytes32 capacityLockId => SolverRouteId routeId) storage $capacityLockClaims,
        AuctionId auctionId,
        uint32 version,
        AuctionDefinition storage definition
    ) internal {
        BidCommitmentId[] storage bidIds = $auctionBidIds[auctionId][version];
        for (uint256 i; i < bidIds.length; ++i) {
            BidRecord storage bid = $bids[bidIds[i]];
            if (bid.status != BidStatus.Revealed) continue;
            _setBidStatus(bidIds[i], bid, BidStatus.Loser);
            if (SolverRouteId.unwrap(bid.routeId) != bytes32(0)) {
                CollateralLockId capacityLockId = $routes[bid.routeId].route.capacityLockId;
                $capacityLockClaims[CollateralLockId.unwrap(capacityLockId)] = SolverRouteId.wrap(bytes32(0));
                CollateralLock memory capacityLock = deps.auctionVault.getLock(capacityLockId);
                if (capacityLock.status == LockStatus.Active) {
                    IAtomicClearingEngine(deps.clearingEngine).positionEngine()
                        .releasePositionFundingLock(capacityLockId);
                }
            }
            applyBondOutcome(deps, bidIds[i], bid, definition.losingBondOutcome, definition);
        }
    }

    function _resolveNoBid(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(bytes32 capacityLockId => SolverRouteId routeId) storage $capacityLockClaims,
        AuctionId auctionId,
        uint32 version,
        AuctionVersion storage auction
    ) internal {
        _resolveLosingBids(
            deps, $auctionBidIds, $bids, $routes, $capacityLockClaims, auctionId, version, auction.definition
        );
        AuctionStatus status =
            auction.definition.noBidTreatment == NoBidTreatment.Cancel ? AuctionStatus.Cancelled : AuctionStatus.Failed;
        _setAuctionStatus(auctionId, version, auction, status);
    }

    function _failAuction(
        SealedAuctionDependencies memory deps,
        mapping(AuctionId auctionId => mapping(uint32 version => BidCommitmentId[] bidIds)) storage $auctionBidIds,
        mapping(BidCommitmentId bidId => BidRecord record) storage $bids,
        mapping(SolverRouteId routeId => SolverRouteRecord record) storage $routes,
        mapping(bytes32 capacityLockId => SolverRouteId routeId) storage $capacityLockClaims,
        AuctionId auctionId,
        uint32 version,
        AuctionVersion storage auction
    ) internal {
        _resolveLosingBids(
            deps, $auctionBidIds, $bids, $routes, $capacityLockClaims, auctionId, version, auction.definition
        );
        _setAuctionStatus(auctionId, version, auction, AuctionStatus.Failed);
    }

    function applyBondOutcome(
        SealedAuctionDependencies memory deps,
        BidCommitmentId bidId,
        BidRecord storage bid,
        BondOutcome outcome,
        AuctionDefinition storage definition
    ) public {
        if (outcome == BondOutcome.Expire) return;
        if (outcome == BondOutcome.Release) {
            deps.auctionVault.releaseLock(bid.bondLockId);
            _setBidStatus(bidId, bid, BidStatus.BondReleased);
            return;
        }
        if (outcome == BondOutcome.Slash) {
            deps.auctionVault
                .consumeLock(bid.bondLockId, definition.slashRecipientAccountId, definition.requiredBondAmount);
            _setBidStatus(bidId, bid, BidStatus.BondSlashed);
            return;
        }
        revert ISealedAuctionHouse.InvalidBidState(bidId, bid.status);
    }

    function _requireAuction(
        mapping(AuctionId auctionId => mapping(uint32 version => AuctionVersion record)) storage $auctions,
        AuctionId auctionId,
        uint32 version
    ) internal view returns (AuctionVersion storage auction) {
        auction = $auctions[auctionId][version];
        if (auction.status == AuctionStatus.Unspecified) revert ISealedAuctionHouse.UnknownAuction(auctionId, version);
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

    function _setBidStatus(BidCommitmentId bidId, BidRecord storage bid, BidStatus newStatus) internal {
        BidStatus previousStatus = bid.status;
        bid.status = newStatus;
        emit ISealedAuctionHouse.BidStatusChanged(bidId, previousStatus, newStatus);
    }
}
