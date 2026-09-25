// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AuctionPriceRule, BidCommitmentId} from "../types/AuctionTypes.sol";
import {
    BatchAllocation,
    BatchCapacityDisposition,
    BatchExecutionHeader,
    BatchExecutionId,
    BatchRemainderDisposition
} from "../types/BatchTypes.sol";
import {PackageDefinitionLib} from "./PackageDefinitionLib.sol";
import {
    AccountId,
    AssetId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId
} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

library BatchClearingLib {
    uint16 internal constant MAXIMUM_WINNERS = 16;
    bytes32 internal constant ALLOCATION_TYPEHASH =
        keccak256("SetrynAuctionAllocationV1(bytes32 bidId,uint128 allocatedLots,int128 priceTicks)");
    bytes32 internal constant EXECUTION_TYPEHASH = keccak256(
        "SetrynBatchExecutionV1(bytes32 auctionId,uint32 auctionVersion,bytes32 auctionResultHash,uint8 targetKind,bytes32 seriesId,bytes32 packageId,uint32 targetVersion,bytes32 packageWitnessHash,bytes32 feeScheduleId,uint32 feeScheduleVersion,bytes32 riskDomainId,uint32 riskDomainVersion,uint8 priceRule,uint128 totalAllocatedLots,uint16 winnerCount,bytes32 allocationsHash,uint64 settlementDeadline)"
    );

    error InvalidWinnerCount(uint256 winnerCount);
    error InvalidBatchTarget();
    error InvalidBatchVersion();
    error InvalidBatchPolicy();
    error InvalidBatchDeadline(uint64 deadline, uint256 currentTimestamp);
    error InvalidPackageWitness();
    error InvalidCapacityDisposition();
    error DuplicateBid(bytes32 bidId);
    error AllocationTotalMismatch(uint256 expected, uint256 actual);

    function hashHeader(BatchExecutionHeader memory header) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EXECUTION_TYPEHASH,
                header.auctionId,
                header.auctionVersion,
                header.auctionResultHash,
                header.targetKind,
                header.seriesId,
                header.packageId,
                header.targetVersion,
                header.packageWitnessHash,
                header.feeScheduleId,
                header.feeScheduleVersion,
                header.riskDomainId,
                header.riskDomainVersion,
                header.priceRule,
                header.totalAllocatedLots,
                header.winnerCount,
                header.allocationsHash,
                header.settlementDeadline
            )
        );
    }

    function executionId(BatchExecutionHeader memory header, uint256 chainId, address engine)
        internal
        pure
        returns (BatchExecutionId)
    {
        return BatchExecutionId.wrap(keccak256(abi.encode(chainId, engine, hashHeader(header))));
    }

    function hashAuctionAllocations(BatchAllocation[] calldata allocations) internal pure returns (bytes32 hash) {
        for (uint256 i; i < allocations.length; ++i) {
            hash = keccak256(
                abi.encode(
                    hash,
                    ALLOCATION_TYPEHASH,
                    BidCommitmentId.unwrap(allocations[i].bidId),
                    Lots.unwrap(allocations[i].allocatedLots),
                    PriceTicks.unwrap(allocations[i].executionPriceTicks)
                )
            );
        }
    }

    function validateHeader(BatchExecutionHeader memory header, PackageLeg[] memory packageLegs) internal view {
        if (header.winnerCount == 0 || header.winnerCount > MAXIMUM_WINNERS) {
            revert InvalidWinnerCount(header.winnerCount);
        }
        if (header.auctionVersion == 0 || header.targetVersion == 0 || header.feeScheduleVersion == 0) {
            revert InvalidBatchVersion();
        }
        if (
            header.riskDomainVersion == 0 || header.auctionResultHash == bytes32(0)
                || FeeScheduleId.unwrap(header.feeScheduleId) == bytes32(0)
                || RiskDomainId.unwrap(header.riskDomainId) == bytes32(0) || Lots.unwrap(header.totalAllocatedLots) == 0
                || header.allocationsHash == bytes32(0)
        ) revert InvalidBatchVersion();
        if (header.priceRule != AuctionPriceRule.UniformPrice && header.priceRule != AuctionPriceRule.PayAsBid) {
            revert InvalidBatchPolicy();
        }
        if (header.settlementDeadline < block.timestamp) {
            revert InvalidBatchDeadline(header.settlementDeadline, block.timestamp);
        }
        bool seriesTarget = header.targetKind == OrderTargetKind.Series;
        bool packageTarget = header.targetKind == OrderTargetKind.Package;
        if (seriesTarget) {
            if (
                SeriesId.unwrap(header.seriesId) == bytes32(0) || PackageId.unwrap(header.packageId) != bytes32(0)
                    || header.packageWitnessHash != bytes32(0) || packageLegs.length != 0
            ) revert InvalidBatchTarget();
        } else if (packageTarget) {
            if (
                PackageId.unwrap(header.packageId) == bytes32(0) || SeriesId.unwrap(header.seriesId) != bytes32(0)
                    || header.packageWitnessHash == bytes32(0)
            ) revert InvalidBatchTarget();
            if (PackageDefinitionLib.hashLegs(packageLegs) != header.packageWitnessHash) {
                revert InvalidPackageWitness();
            }
        } else {
            revert InvalidBatchTarget();
        }
    }

    function validateAllocations(BatchExecutionHeader calldata header, BatchAllocation[] calldata allocations)
        internal
        pure
    {
        if (allocations.length != header.winnerCount) revert InvalidWinnerCount(allocations.length);
        uint256 total;
        for (uint256 i; i < allocations.length; ++i) {
            BatchAllocation calldata allocation = allocations[i];
            bytes32 bidId = BidCommitmentId.unwrap(allocation.bidId);
            if (bidId == bytes32(0)) revert DuplicateBid(bidId);
            for (uint256 j; j < i; ++j) {
                if (BidCommitmentId.unwrap(allocation.bidId) == BidCommitmentId.unwrap(allocations[j].bidId)) {
                    revert DuplicateBid(bidId);
                }
            }
            uint128 lots = Lots.unwrap(allocation.allocatedLots);
            if (lots == 0 || allocation.fundingHash == bytes32(0)) revert InvalidBatchPolicy();
            _validateCapacity(allocation.capacity);
            total += lots;
        }
        if (total != Lots.unwrap(header.totalAllocatedLots)) {
            revert AllocationTotalMismatch(Lots.unwrap(header.totalAllocatedLots), total);
        }
    }

    function allocationId(BatchExecutionId batchExecutionId, BatchAllocation calldata allocation)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                BatchExecutionId.unwrap(batchExecutionId),
                BidCommitmentId.unwrap(allocation.bidId),
                allocation.takerOrderHash,
                allocation.makerOrderHash,
                allocation.allocatedLots,
                allocation.executionPriceTicks,
                allocation.fundingHash,
                allocation.capacity
            )
        );
    }

    function _validateCapacity(BatchCapacityDisposition calldata disposition) private pure {
        if (
            disposition.reservationId == bytes32(0) || disposition.capacityPolicyHash == bytes32(0)
                || disposition.capacityEvidenceHash == bytes32(0) || disposition.reservedLiability == 0
                || AccountId.unwrap(disposition.accountId) == bytes32(0)
                || AssetId.unwrap(disposition.collateralAssetId) == bytes32(0)
                || disposition.collateralBindingVersion == 0
                || RiskDomainId.unwrap(disposition.riskDomainId) == bytes32(0) || disposition.riskDomainVersion == 0
                || CollateralLockId.unwrap(disposition.lockId) == bytes32(0) || disposition.lockReference == bytes32(0)
                || disposition.expiry == 0 || disposition.consumedLiability == 0
                || disposition.consumedLiability > disposition.reservedLiability
                || disposition.expectedRemainingLiability
                    != disposition.reservedLiability - disposition.consumedLiability
                || disposition.remainderDisposition == BatchRemainderDisposition.Unspecified
        ) revert InvalidCapacityDisposition();
    }
}
