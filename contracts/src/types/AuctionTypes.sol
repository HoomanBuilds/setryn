// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "./Enums.sol";
import {
    AccountId,
    AdapterId,
    AssetId,
    CollateralId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId
} from "./Identifiers.sol";
import {Lots, PriceTicks} from "./Units.sol";

type AuctionId is bytes32;
type BidCommitmentId is bytes32;
type SolverRouteId is bytes32;

enum AuctionKind {
    Unspecified,
    BatchOrder,
    SolverRoute
}

enum AuctionTargetKind {
    Unspecified,
    Series,
    Package
}

enum AuctionPriceRule {
    Unspecified,
    UniformPrice,
    PayAsBid,
    BestPackage
}

enum AuctionTieBreakRule {
    Unspecified,
    CommitmentHashAscending
}

enum NoBidTreatment {
    Unspecified,
    Cancel,
    Fail
}

enum BondOutcome {
    Unspecified,
    Release,
    Slash,
    Expire
}

enum AuctionStatus {
    Unspecified,
    Scheduled,
    CommitOpen,
    RevealOpen,
    ReadyToClear,
    Cleared,
    Settled,
    Cancelled,
    Failed
}

enum BidStatus {
    Unspecified,
    Committed,
    Revealed,
    Winner,
    Loser,
    Unrevealed,
    BondReleased,
    BondSlashed
}

struct AuctionDefinition {
    bytes32 namespaceId;
    bytes32 auctionKey;
    AuctionKind kind;
    AuctionTargetKind targetKind;
    SeriesId seriesId;
    PackageId packageId;
    uint32 targetVersion;
    bool hasPackageLegCommitment;
    bytes32 packageLegsHash;
    Side auctionSide;
    AssetId settlementAssetId;
    uint32 settlementAssetVersion;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    bytes32 eligibilityPolicyHash;
    bytes32 capacityPolicyHash;
    bytes32 bondPolicyHash;
    bytes32 allocationPolicyHash;
    bytes32 guaranteeClassId;
    AuctionPriceRule priceRule;
    AuctionTieBreakRule tieBreakRule;
    NoBidTreatment noBidTreatment;
    BondOutcome unrevealedBondOutcome;
    BondOutcome losingBondOutcome;
    BondOutcome settlementFailureBondOutcome;
    Lots totalLots;
    Lots lotStep;
    uint16 maximumBids;
    uint64 commitOpensAt;
    uint64 commitClosesAt;
    uint64 revealClosesAt;
    uint64 clearDeadline;
    uint64 settlementDeadline;
    uint64 bondExpiry;
    AssetId bondAssetId;
    uint32 bondBindingVersion;
    uint128 requiredBondAmount;
    AccountId slashRecipientAccountId;
    uint128 maximumKeeperRewardMinor;
    bytes32 qualificationEvidenceHash;
}

struct AuctionVersion {
    AuctionDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    AuctionStatus status;
    uint32 commitmentCount;
    uint32 revealCount;
    bytes32 clearingResultHash;
}

struct BidCommitAuthorization {
    AuctionId auctionId;
    uint32 auctionVersion;
    address bidder;
    AccountId bidderAccountId;
    uint256 nonce;
    bytes32 sealedBidHash;
    bytes32 eligibilityProofHash;
    uint64 deadline;
    bytes32 salt;
}

struct SealedBid {
    AuctionId auctionId;
    uint32 auctionVersion;
    address bidder;
    AccountId bidderAccountId;
    uint256 nonce;
    Side side;
    Lots lots;
    bool allowPartialAllocation;
    Lots minimumFillLots;
    PriceTicks priceTicks;
    uint128 maximumFeeMinor;
    SolverRouteId solverRouteId;
    bytes32 capacityEvidenceHash;
    bytes32 revealSalt;
}

struct SolverAction {
    bytes32 actionTypeId;
    AdapterId adapterId;
    uint32 adapterVersion;
    bytes32 adapterCapabilityHash;
    AssetId inputAssetId;
    AssetId outputAssetId;
    uint128 maximumInput;
    uint128 minimumOutput;
    uint32 dependencyMask;
}

struct SolverRoute {
    AuctionId auctionId;
    uint32 auctionVersion;
    address solver;
    AccountId solverAccountId;
    SolverRouteId routeId;
    bytes32 packageLegsHash;
    bytes32 actionGraphHash;
    uint16 legCount;
    uint16 actionCount;
    PriceTicks packageOutcomeTicks;
    uint128 maximumFeeMinor;
    CollateralLockId capacityLockId;
    CollateralId capacityCollateralId;
    uint128 capacityAmount;
    bytes32 capacityEvidenceHash;
    uint64 expiry;
    bytes32 guaranteeClassId;
    bytes32 salt;
}

struct BidRecord {
    BidCommitAuthorization authorization;
    SealedBid bid;
    SolverRouteId routeId;
    CollateralLockId bondLockId;
    BidStatus status;
    Lots allocatedLots;
    PriceTicks allocationPriceTicks;
}

struct SolverRouteRecord {
    SolverRoute route;
    bytes32 routeHash;
    bool revealed;
}

struct AuctionClearingResult {
    AuctionId auctionId;
    uint32 auctionVersion;
    BidCommitmentId winningRouteBidId;
    PriceTicks uniformPriceTicks;
    Lots totalAllocatedLots;
    uint16 winnerCount;
    bytes32 allocationsHash;
    bytes32 resultHash;
}

struct AuctionClearingHandoff {
    AuctionId auctionId;
    uint32 auctionVersion;
    bytes32 clearingResultHash;
    BidCommitmentId winningRouteBidId;
    CollateralLockId capacityLockId;
    uint128 capacityAmount;
    uint128 maximumKeeperRewardMinor;
    bytes32 executionReference;
}
