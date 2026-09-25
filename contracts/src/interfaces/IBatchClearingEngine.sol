// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "./IAtomicClearingEngine.sol";
import {IBatchCapacityManager} from "./IBatchCapacityManager.sol";
import {ISealedAuctionHouse} from "./ISealedAuctionHouse.sol";
import {BatchAllocation, BatchExecutionHeader, BatchExecutionId} from "../types/BatchTypes.sol";
import {PackageClearingRequest, SeriesClearingRequest} from "../types/ClearingTypes.sol";
import {FillId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";

interface IBatchClearingEngine {
    event BatchExecuted(
        BatchExecutionId indexed batchExecutionId,
        bytes32 indexed auctionResultHash,
        bytes32 indexed fillsHash,
        uint16 winnerCount
    );
    event BatchAllocationCleared(
        BatchExecutionId indexed batchExecutionId,
        bytes32 indexed allocationId,
        FillId indexed fillId,
        bytes32 reservationId
    );

    error ZeroDependency(address dependency);
    error BatchAlreadyExecuted(BatchExecutionId batchExecutionId);
    error BatchSourceMismatch();
    error AllocationMismatch(uint256 index);
    error FundingHashMismatch(bytes32 expected, bytes32 actual);
    error FillAlreadyAssigned(FillId fillId);

    function executeSeriesBatch(
        BatchExecutionHeader calldata header,
        BatchAllocation[] calldata allocations,
        SeriesClearingRequest[] calldata requests
    ) external returns (BatchExecutionId batchExecutionId, FillId[] memory fillIds);

    function executePackageBatch(
        BatchExecutionHeader calldata header,
        PackageLeg[] calldata packageLegs,
        BatchAllocation[] calldata allocations,
        PackageClearingRequest[] calldata requests
    ) external returns (BatchExecutionId batchExecutionId, FillId[] memory fillIds);

    function atomicClearingEngine() external view returns (IAtomicClearingEngine);
    function auctionHouse() external view returns (ISealedAuctionHouse);
    function capacityManager() external view returns (IBatchCapacityManager);
    function executed(BatchExecutionId batchExecutionId) external view returns (bool);
    function allocationFill(bytes32 allocationId) external view returns (FillId);
}
