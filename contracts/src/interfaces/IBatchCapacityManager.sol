// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {BidCommitmentId} from "../types/AuctionTypes.sol";
import {BatchCapacityDisposition, BatchExecutionId} from "../types/BatchTypes.sol";
import {FillId} from "../types/Identifiers.sol";
import {Lots} from "../types/Units.sol";
import {CapacityConsumptionRecord, ManagedCapacity} from "../types/CapacityManagerTypes.sol";

interface IBatchCapacityManager {
    function consumeBatchCapacity(
        BatchExecutionId batchExecutionId,
        bytes32 allocationId,
        BidCommitmentId bidId,
        Lots allocatedLots,
        bytes32 fundingHash,
        BatchCapacityDisposition calldata disposition
    ) external returns (bytes32 consumptionHash);

    function finalizeBatchCapacity(
        BatchExecutionId batchExecutionId,
        bytes32 allocationId,
        FillId fillId,
        bytes32 consumptionHash
    ) external;

    function expireBatchCapacity(bytes32 allocationId) external;
    function getBatchCapacity(bytes32 allocationId) external view returns (ManagedCapacity memory capacity);
    function getBatchConsumption(bytes32 allocationId) external view returns (CapacityConsumptionRecord memory record);
}
