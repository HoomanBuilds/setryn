// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IBatchCapacityManager} from "../../src/interfaces/IBatchCapacityManager.sol";
import {IStreamCapacityManager} from "../../src/interfaces/IStreamCapacityManager.sol";
import {BidCommitmentId} from "../../src/types/AuctionTypes.sol";
import {BatchCapacityDisposition, BatchExecutionId} from "../../src/types/BatchTypes.sol";
import {
    CapacityConsumptionRecord,
    ManagedCapacity,
    ManagedCapacityStatus,
    StreamCapacityState
} from "../../src/types/CapacityManagerTypes.sol";
import {PackageClearingRequest, SeriesClearingRequest} from "../../src/types/ClearingTypes.sol";
import {CollateralLockId, FillId} from "../../src/types/Identifiers.sol";
import {Side} from "../../src/types/Enums.sol";
import {StreamCapacityConsumption, StreamId, StreamPolicy} from "../../src/types/StreamTypes.sol";
import {Lots} from "../../src/types/Units.sol";

contract BatchCapacityManagerMock is IBatchCapacityManager {
    mapping(bytes32 allocationId => bool consumed) public consumed;
    mapping(bytes32 allocationId => FillId fillId) public finalizedFill;

    function consumeBatchCapacity(
        BatchExecutionId batchExecutionId,
        bytes32 allocationId,
        BidCommitmentId bidId,
        Lots allocatedLots,
        bytes32 fundingHash,
        BatchCapacityDisposition calldata disposition
    ) external returns (bytes32 consumptionHash) {
        require(!consumed[allocationId]);
        consumed[allocationId] = true;
        return keccak256(abi.encode(batchExecutionId, allocationId, bidId, allocatedLots, fundingHash, disposition));
    }

    function finalizeBatchCapacity(BatchExecutionId, bytes32 allocationId, FillId fillId, bytes32 consumptionHash)
        external
    {
        require(consumed[allocationId] && consumptionHash != bytes32(0));
        finalizedFill[allocationId] = fillId;
    }

    function expireBatchCapacity(bytes32) external {}

    function getBatchCapacity(bytes32) external pure returns (ManagedCapacity memory capacity) {
        capacity.status = ManagedCapacityStatus.Active;
    }

    function getBatchConsumption(bytes32) external pure returns (CapacityConsumptionRecord memory record) {
        return record;
    }
}

contract StreamCapacityManagerMock is IStreamCapacityManager {
    int128 public inventory;
    uint128 public liabilityPerFill = 1;
    mapping(StreamId streamId => uint64 sequence) public consumedSequence;
    mapping(StreamId streamId => bytes32 fillId) public finalizedFill;

    function setInventory(int128 inventory_) external {
        inventory = inventory_;
    }

    function reserveStreamCapacity(StreamId, StreamPolicy calldata policy)
        external
        pure
        returns (CollateralLockId lockId)
    {
        require(policy.capacityReservationId != bytes32(0));
        return CollateralLockId.wrap(keccak256(abi.encode(policy.capacityReservationId)));
    }

    function consumeStreamCapacity(StreamId streamId, uint64 sequence, Side makerSide, Lots fillLots)
        external
        returns (StreamCapacityConsumption memory consumption)
    {
        require(sequence == consumedSequence[streamId] + 1);
        int128 beforeLots = inventory;
        int128 delta = int128(Lots.unwrap(fillLots));
        inventory = makerSide == Side.Buy ? beforeLots + delta : beforeLots - delta;
        consumedSequence[streamId] = sequence;
        consumption = StreamCapacityConsumption({
            inventoryBeforeLots: beforeLots,
            inventoryAfterLots: inventory,
            liabilityConsumed: liabilityPerFill,
            consumptionHash: keccak256(abi.encode(streamId, sequence, beforeLots, inventory))
        });
    }

    function finalizeStreamCapacity(StreamId streamId, uint64 sequence, bytes32 fillId, bytes32 consumptionHash)
        external
    {
        require(sequence == consumedSequence[streamId] && consumptionHash != bytes32(0));
        finalizedFill[streamId] = fillId;
    }

    function releaseStreamCapacity(StreamId) external {}

    function expireStreamCapacity(StreamId) external {}

    function getStreamCapacity(StreamId streamId) external view returns (StreamCapacityState memory state) {
        state.streamId = streamId;
        state.capacity.status = ManagedCapacityStatus.Active;
        state.capacity.lockId = CollateralLockId.wrap(keccak256(abi.encode(streamId)));
        state.capacity.remainingLiability = type(uint128).max;
        state.inventoryLots = inventory;
    }

    function getStreamConsumption(StreamId, uint64) external pure returns (CapacityConsumptionRecord memory record) {
        return record;
    }
}

contract AtomicClearingStreamMock {
    uint256 public fillCount;
    bool public failClearing;

    function setFailClearing(bool failClearing_) external {
        failClearing = failClearing_;
    }

    function clearSeries(SeriesClearingRequest calldata) external returns (FillId fillId) {
        require(!failClearing);
        fillCount += 1;
        return FillId.wrap(bytes32(fillCount));
    }

    function clearPackage(PackageClearingRequest calldata) external returns (FillId fillId) {
        require(!failClearing);
        fillCount += 1;
        return FillId.wrap(bytes32(fillCount));
    }
}
