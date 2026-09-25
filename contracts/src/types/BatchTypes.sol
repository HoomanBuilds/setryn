// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AuctionId, AuctionPriceRule, BidCommitmentId} from "./AuctionTypes.sol";
import {FeeScheduleId, FillId, PackageId, RiskDomainId, SeriesId} from "./Identifiers.sol";
import {OrderTargetKind} from "./OrderTypes.sol";
import {Lots, PriceTicks} from "./Units.sol";

type BatchExecutionId is bytes32;

enum BatchRemainderDisposition {
    Unspecified,
    KeepReserved,
    ReleaseAfterFill,
    ReleaseAtExpiry
}

struct BatchExecutionHeader {
    AuctionId auctionId;
    uint32 auctionVersion;
    bytes32 auctionResultHash;
    OrderTargetKind targetKind;
    SeriesId seriesId;
    PackageId packageId;
    uint32 targetVersion;
    bytes32 packageWitnessHash;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    AuctionPriceRule priceRule;
    Lots totalAllocatedLots;
    uint16 winnerCount;
    bytes32 allocationsHash;
    uint64 settlementDeadline;
}

struct BatchCapacityDisposition {
    bytes32 reservationId;
    bytes32 capacityPolicyHash;
    bytes32 capacityEvidenceHash;
    uint128 reservedLiability;
    uint128 consumedLiability;
    uint128 expectedRemainingLiability;
    BatchRemainderDisposition remainderDisposition;
}

struct BatchAllocation {
    BidCommitmentId bidId;
    bytes32 takerOrderHash;
    bytes32 makerOrderHash;
    Lots allocatedLots;
    PriceTicks executionPriceTicks;
    bytes32 fundingHash;
    BatchCapacityDisposition capacity;
}

struct BatchAllocationReceipt {
    BatchExecutionId batchExecutionId;
    bytes32 allocationId;
    FillId fillId;
    BidCommitmentId bidId;
    Lots allocatedLots;
    PriceTicks executionPriceTicks;
}
