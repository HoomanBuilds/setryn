// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IBatchCapacityManager} from "../interfaces/IBatchCapacityManager.sol";
import {IBatchClearingEngine} from "../interfaces/IBatchClearingEngine.sol";
import {ISealedAuctionHouse} from "../interfaces/ISealedAuctionHouse.sol";
import {BatchClearingLib} from "../libraries/BatchClearingLib.sol";
import {PackageDefinitionLib} from "../libraries/PackageDefinitionLib.sol";
import {
    AuctionClearingResult,
    AuctionDefinition,
    AuctionKind,
    AuctionPriceRule,
    AuctionTargetKind,
    AuctionVersion,
    BidRecord,
    BidStatus
} from "../types/AuctionTypes.sol";
import {BatchAllocation, BatchExecutionHeader, BatchExecutionId} from "../types/BatchTypes.sol";
import {
    BilateralMatch,
    ClearingChannelKind,
    PackageClearingRequest,
    SeriesClearingRequest
} from "../types/ClearingTypes.sol";
import {FeeScheduleId, FillId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

contract BatchClearingEngine is IBatchClearingEngine, ReentrancyGuard {
    IAtomicClearingEngine private immutable _atomicClearingEngine;
    ISealedAuctionHouse private immutable _auctionHouse;
    IBatchCapacityManager private immutable _capacityManager;

    mapping(BatchExecutionId batchExecutionId => bool value) private _executed;
    mapping(bytes32 allocationId => FillId fillId) private _allocationFills;
    mapping(FillId fillId => bool assigned) private _assignedFills;

    constructor(
        IAtomicClearingEngine atomicClearingEngine_,
        ISealedAuctionHouse auctionHouse_,
        IBatchCapacityManager capacityManager_
    ) {
        _requireDependency(address(atomicClearingEngine_));
        _requireDependency(address(auctionHouse_));
        _requireDependency(address(capacityManager_));
        _atomicClearingEngine = atomicClearingEngine_;
        _auctionHouse = auctionHouse_;
        _capacityManager = capacityManager_;
    }

    function executeSeriesBatch(
        BatchExecutionHeader calldata header,
        BatchAllocation[] calldata allocations,
        SeriesClearingRequest[] calldata requests
    ) external nonReentrant returns (BatchExecutionId batchExecutionId, FillId[] memory fillIds) {
        PackageLeg[] memory noLegs = new PackageLeg[](0);
        BatchClearingLib.validateHeader(header, noLegs);
        if (header.targetKind != OrderTargetKind.Series || requests.length != allocations.length) {
            revert BatchSourceMismatch();
        }
        batchExecutionId = _prepareBatch(header, allocations);
        fillIds = new FillId[](allocations.length);
        bytes32 fillsHash;
        for (uint256 i; i < allocations.length; ++i) {
            _validateSeriesRequest(i, allocations[i], requests[i]);
            (FillId fillId, bytes32 allocationId) = _consumeSeries(batchExecutionId, allocations[i], requests[i]);
            fillIds[i] = fillId;
            fillsHash = keccak256(abi.encode(fillsHash, allocationId, FillId.unwrap(fillId)));
        }
        _completeBatch(header, batchExecutionId, fillsHash);
    }

    function executePackageBatch(
        BatchExecutionHeader calldata header,
        PackageLeg[] calldata packageLegs,
        BatchAllocation[] calldata allocations,
        PackageClearingRequest[] calldata requests
    ) external nonReentrant returns (BatchExecutionId batchExecutionId, FillId[] memory fillIds) {
        BatchClearingLib.validateHeader(header, packageLegs);
        if (header.targetKind != OrderTargetKind.Package || requests.length != allocations.length) {
            revert BatchSourceMismatch();
        }
        batchExecutionId = _prepareBatch(header, allocations);
        fillIds = new FillId[](allocations.length);
        bytes32 fillsHash;
        for (uint256 i; i < allocations.length; ++i) {
            _validatePackageRequest(i, header.packageWitnessHash, allocations[i], requests[i]);
            (FillId fillId, bytes32 allocationId) = _consumePackage(batchExecutionId, allocations[i], requests[i]);
            fillIds[i] = fillId;
            fillsHash = keccak256(abi.encode(fillsHash, allocationId, FillId.unwrap(fillId)));
        }
        _completeBatch(header, batchExecutionId, fillsHash);
    }

    function atomicClearingEngine() external view returns (IAtomicClearingEngine) {
        return _atomicClearingEngine;
    }

    function auctionHouse() external view returns (ISealedAuctionHouse) {
        return _auctionHouse;
    }

    function capacityManager() external view returns (IBatchCapacityManager) {
        return _capacityManager;
    }

    function executed(BatchExecutionId batchExecutionId) external view returns (bool) {
        return _executed[batchExecutionId];
    }

    function allocationFill(bytes32 allocationId) external view returns (FillId) {
        return _allocationFills[allocationId];
    }

    function _prepareBatch(BatchExecutionHeader calldata header, BatchAllocation[] calldata allocations)
        private
        returns (BatchExecutionId batchExecutionId)
    {
        BatchClearingLib.validateAllocations(header, allocations);
        batchExecutionId = BatchClearingLib.executionId(header, block.chainid, address(this));
        if (_executed[batchExecutionId]) revert BatchAlreadyExecuted(batchExecutionId);
        _validateAuctionSource(header, allocations);
        _auctionHouse.consumeClearingHandoff(
            header.auctionId, header.auctionVersion, BatchExecutionId.unwrap(batchExecutionId)
        );
        _executed[batchExecutionId] = true;
    }

    function _validateAuctionSource(BatchExecutionHeader calldata header, BatchAllocation[] calldata allocations)
        private
        view
    {
        AuctionVersion memory auction = _auctionHouse.getAuction(header.auctionId, header.auctionVersion);
        AuctionDefinition memory definition = auction.definition;
        AuctionClearingResult memory result = _auctionHouse.getClearingResult(header.auctionId, header.auctionVersion);
        bool packageTarget = header.targetKind == OrderTargetKind.Package;
        if (
            definition.kind != AuctionKind.BatchOrder
                || !_auctionHouse.verifyClearingResult(header.auctionId, header.auctionVersion)
                || result.resultHash != header.auctionResultHash || result.allocationsHash != header.allocationsHash
                || result.winnerCount != header.winnerCount
                || Lots.unwrap(result.totalAllocatedLots) != Lots.unwrap(header.totalAllocatedLots)
                || definition.priceRule != header.priceRule || definition.targetVersion != header.targetVersion
                || definition.feeScheduleId != header.feeScheduleId
                || definition.feeScheduleVersion != header.feeScheduleVersion
                || definition.riskDomainId != header.riskDomainId
                || definition.riskDomainVersion != header.riskDomainVersion
                || definition.settlementDeadline != header.settlementDeadline
                || definition.targetKind != (packageTarget ? AuctionTargetKind.Package : AuctionTargetKind.Series)
                || definition.seriesId != header.seriesId || definition.packageId != header.packageId
                || definition.packageLegsHash != header.packageWitnessHash
                || BatchClearingLib.hashAuctionAllocations(allocations) != header.allocationsHash
        ) revert BatchSourceMismatch();
        for (uint256 i; i < allocations.length; ++i) {
            BatchAllocation calldata allocation = allocations[i];
            BidRecord memory bid = _auctionHouse.getBid(allocation.bidId);
            if (
                bid.status != BidStatus.Winner || bid.bid.auctionId != header.auctionId
                    || bid.bid.auctionVersion != header.auctionVersion
                    || bid.bid.bidderOrderHash != allocation.makerOrderHash
                    || definition.initiatorOrderHash != allocation.takerOrderHash
                    || Lots.unwrap(bid.allocatedLots) != Lots.unwrap(allocation.allocatedLots)
                    || PriceTicks.unwrap(bid.allocationPriceTicks) != PriceTicks.unwrap(allocation.executionPriceTicks)
                    || bid.bid.capacityEvidenceHash != allocation.capacity.capacityEvidenceHash
                    || definition.capacityPolicyHash != allocation.capacity.capacityPolicyHash
                    || (header.priceRule == AuctionPriceRule.UniformPrice
                        && PriceTicks.unwrap(allocation.executionPriceTicks)
                            != PriceTicks.unwrap(result.uniformPriceTicks))
                    || (header.priceRule == AuctionPriceRule.PayAsBid
                        && PriceTicks.unwrap(allocation.executionPriceTicks) != PriceTicks.unwrap(bid.bid.priceTicks))
            ) revert AllocationMismatch(i);
        }
    }

    function _validateSeriesRequest(
        uint256 index,
        BatchAllocation calldata allocation,
        SeriesClearingRequest calldata request
    ) private pure {
        if (request.channelKind != ClearingChannelKind.Direct) {
            revert AllocationMismatch(index);
        }
        _validateMatch(
            index,
            allocation,
            request.matchData.takerOrderHash,
            request.matchData.makerOrderHash,
            request.matchData.fillLots,
            request.matchData.executionPriceTicks,
            _fundingHash(request.matchData)
        );
    }

    function _validatePackageRequest(
        uint256 index,
        bytes32 packageWitnessHash,
        BatchAllocation calldata allocation,
        PackageClearingRequest calldata request
    ) private pure {
        if (
            request.channelKind != ClearingChannelKind.Direct
                || PackageDefinitionLib.hashLegs(request.legs) != packageWitnessHash
        ) revert AllocationMismatch(index);
        _validateMatch(
            index,
            allocation,
            request.matchData.takerOrderHash,
            request.matchData.makerOrderHash,
            request.matchData.fillLots,
            request.matchData.executionPriceTicks,
            _fundingHash(request.matchData)
        );
    }

    function _validateMatch(
        uint256 index,
        BatchAllocation calldata allocation,
        bytes32 takerOrderHash,
        bytes32 makerOrderHash,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        bytes32 fundingHash
    ) private pure {
        if (
            takerOrderHash != allocation.takerOrderHash || makerOrderHash != allocation.makerOrderHash
                || Lots.unwrap(fillLots) != Lots.unwrap(allocation.allocatedLots)
                || PriceTicks.unwrap(executionPriceTicks) != PriceTicks.unwrap(allocation.executionPriceTicks)
        ) revert AllocationMismatch(index);
        if (fundingHash != allocation.fundingHash) revert FundingHashMismatch(allocation.fundingHash, fundingHash);
    }

    function _consumeSeries(
        BatchExecutionId batchExecutionId,
        BatchAllocation calldata allocation,
        SeriesClearingRequest calldata request
    ) private returns (FillId fillId, bytes32 allocationId) {
        allocationId = BatchClearingLib.allocationId(batchExecutionId, allocation);
        bytes32 consumptionHash = _capacityManager.consumeBatchCapacity(
            batchExecutionId,
            allocationId,
            allocation.bidId,
            allocation.allocatedLots,
            allocation.fundingHash,
            allocation.capacity
        );
        fillId = _atomicClearingEngine.clearSeries(request);
        _recordFill(batchExecutionId, allocationId, allocation, fillId, consumptionHash);
    }

    function _consumePackage(
        BatchExecutionId batchExecutionId,
        BatchAllocation calldata allocation,
        PackageClearingRequest calldata request
    ) private returns (FillId fillId, bytes32 allocationId) {
        allocationId = BatchClearingLib.allocationId(batchExecutionId, allocation);
        bytes32 consumptionHash = _capacityManager.consumeBatchCapacity(
            batchExecutionId,
            allocationId,
            allocation.bidId,
            allocation.allocatedLots,
            allocation.fundingHash,
            allocation.capacity
        );
        fillId = _atomicClearingEngine.clearPackage(request);
        _recordFill(batchExecutionId, allocationId, allocation, fillId, consumptionHash);
    }

    function _recordFill(
        BatchExecutionId batchExecutionId,
        bytes32 allocationId,
        BatchAllocation calldata allocation,
        FillId fillId,
        bytes32 consumptionHash
    ) private {
        if (_assignedFills[fillId]) revert FillAlreadyAssigned(fillId);
        _assignedFills[fillId] = true;
        _allocationFills[allocationId] = fillId;
        _capacityManager.finalizeBatchCapacity(batchExecutionId, allocationId, fillId, consumptionHash);
        emit BatchAllocationCleared(batchExecutionId, allocationId, fillId, allocation.capacity.reservationId);
    }

    function _completeBatch(BatchExecutionHeader calldata header, BatchExecutionId batchExecutionId, bytes32 fillsHash)
        private
    {
        bytes32 settlementReference = keccak256(abi.encode(BatchExecutionId.unwrap(batchExecutionId), fillsHash));
        _auctionHouse.settleAuction(header.auctionId, header.auctionVersion, settlementReference);
        emit BatchExecuted(batchExecutionId, header.auctionResultHash, fillsHash, header.winnerCount);
    }

    function _fundingHash(BilateralMatch calldata matchData) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                matchData.takerFunding,
                matchData.makerFunding,
                matchData.takerFeeFunding,
                matchData.makerFeeFunding,
                matchData.longAdmissionId,
                matchData.longAdmissionResultHash,
                matchData.shortAdmissionId,
                matchData.shortAdmissionResultHash
            )
        );
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }
}
