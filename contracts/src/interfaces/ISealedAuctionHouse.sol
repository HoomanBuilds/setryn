// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAuctionValidationGate} from "./IAuctionValidationGate.sol";
import {IAuctionVault} from "./IAuctionVault.sol";
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

interface ISealedAuctionHouse {
    event AuctionScheduled(
        AuctionId indexed auctionId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        bytes32 packageLegsHash,
        uint64 commitOpensAt,
        uint64 commitClosesAt,
        uint64 revealClosesAt
    );
    event AuctionStatusChanged(
        AuctionId indexed auctionId,
        uint32 indexed version,
        AuctionStatus previousStatus,
        AuctionStatus newStatus,
        address operator
    );
    event BidCommitted(
        AuctionId indexed auctionId,
        uint32 indexed version,
        BidCommitmentId indexed bidId,
        bytes32 sealedBidHash,
        bytes32 bondLockId
    );
    event BidRevealed(
        AuctionId indexed auctionId,
        uint32 indexed version,
        BidCommitmentId indexed bidId,
        bytes32 revealedBidHash,
        SolverRouteId routeId
    );
    event BidStatusChanged(BidCommitmentId indexed bidId, BidStatus previousStatus, BidStatus newStatus);
    event AuctionCleared(
        AuctionId indexed auctionId,
        uint32 indexed version,
        bytes32 indexed resultHash,
        bytes32 allocationsHash,
        uint16 winnerCount
    );
    event ClearingHandoffConsumed(
        AuctionId indexed auctionId,
        uint32 indexed version,
        bytes32 indexed executionReference,
        bytes32 clearingResultHash,
        bytes32 capacityLockId
    );
    event AuctionSettled(AuctionId indexed auctionId, uint32 indexed version, bytes32 indexed settlementReference);

    error ZeroInitialAdmin();
    error ZeroDependency();
    error DependencyHasNoCode(address dependency);
    error ZeroClearingEngine();
    error DuplicateAuctionDefinition(AuctionId auctionId, bytes32 definitionHash);
    error AuctionVersionExhausted(AuctionId auctionId);
    error UnknownAuction(AuctionId auctionId, uint32 version);
    error InvalidAuctionState(AuctionId auctionId, uint32 version, AuctionStatus status);
    error AuctionPhaseNotReached(uint64 requiredTimestamp, uint256 currentTimestamp);
    error AuctionPhaseClosed(uint64 closedAt, uint256 currentTimestamp);
    error AuctionCapacityReached(uint16 maximumBids);
    error DuplicateBid(BidCommitmentId bidId);
    error UnknownBid(BidCommitmentId bidId);
    error InvalidBidState(BidCommitmentId bidId, BidStatus status);
    error InvalidSignature(address signer, bytes32 digest);
    error BidCommitmentMismatch(bytes32 expected, bytes32 actual);
    error BidAuthorizationMismatch();
    error EligibilityProofMismatch();
    error BondLockMismatch(BidCommitmentId bidId);
    error RouteMismatch();
    error DuplicateRoute(SolverRouteId routeId);
    error CapacityLockAlreadyClaimed(bytes32 capacityLockId, SolverRouteId routeId);
    error CapacityLockMismatch(SolverRouteId routeId);
    error NoClearingResult();
    error ClearingResultMismatch(bytes32 expected, bytes32 actual);
    error ClearingHandoffAlreadyConsumed(AuctionId auctionId, uint32 version);
    error ExecutionReferenceUsed(bytes32 executionReference);
    error ZeroReference();
    error SettlementDeadlineNotReached(uint64 deadline, uint256 currentTimestamp);
    error SettlementDeadlinePassed(uint64 deadline, uint256 currentTimestamp);
    error UnauthorizedCancellation();

    function AUCTION_SCHEDULER_ROLE() external view returns (bytes32);
    function AUCTION_GUARDIAN_ROLE() external view returns (bytes32);
    function CLEARING_ENGINE_ROLE() external view returns (bytes32);
    function auctionVault() external view returns (IAuctionVault);
    function validationGate() external view returns (IAuctionValidationGate);
    function clearingEngine() external view returns (address);
    function scheduleAuction(AuctionDefinition calldata definition, PackageLeg[] calldata packageLegs)
        external
        returns (AuctionId auctionId, uint32 version);
    function advanceAuction(AuctionId auctionId, uint32 version) external;
    function cancelAuction(AuctionId auctionId, uint32 version) external;
    function commitBid(
        BidCommitAuthorization calldata authorization,
        bytes32[] calldata eligibilityProof,
        bytes calldata signature
    ) external returns (BidCommitmentId bidId);
    function revealBid(BidCommitmentId bidId, SealedBid calldata bid) external;
    function revealSolverBid(
        BidCommitmentId bidId,
        SealedBid calldata bid,
        SolverRoute calldata route,
        PackageLeg[] calldata routeLegs,
        SolverAction[] calldata actions
    ) external;
    function clearAuction(AuctionId auctionId, uint32 version) external returns (bytes32 resultHash);
    function verifyClearingResult(AuctionId auctionId, uint32 version) external view returns (bool);
    function consumeClearingHandoff(AuctionId auctionId, uint32 version, bytes32 executionReference)
        external
        returns (AuctionClearingHandoff memory handoff);
    function settleAuction(AuctionId auctionId, uint32 version, bytes32 settlementReference) external;
    function failExpiredSettlement(AuctionId auctionId, uint32 version) external;
    function releaseExpiredBond(BidCommitmentId bidId) external;
    function getAuction(AuctionId auctionId, uint32 version) external view returns (AuctionVersion memory);
    function getBid(BidCommitmentId bidId) external view returns (BidRecord memory);
    function getRoute(SolverRouteId routeId) external view returns (SolverRouteRecord memory);
    function capacityLockClaim(bytes32 capacityLockId) external view returns (SolverRouteId routeId);
    function getClearingResult(AuctionId auctionId, uint32 version) external view returns (AuctionClearingResult memory);
}
