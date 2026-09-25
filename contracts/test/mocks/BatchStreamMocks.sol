// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IBatchCapacityManager} from "../../src/interfaces/IBatchCapacityManager.sol";
import {IStreamCapacityManager} from "../../src/interfaces/IStreamCapacityManager.sol";
import {BidCommitmentId} from "../../src/types/AuctionTypes.sol";
import {BatchCapacityDisposition, BatchExecutionId} from "../../src/types/BatchTypes.sol";
import {PackageClearingRequest, SeriesClearingRequest} from "../../src/types/ClearingTypes.sol";
import {FillId} from "../../src/types/Identifiers.sol";
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
}

contract StreamCapacityManagerMock is IStreamCapacityManager {
    int128 public inventory;
    uint128 public liabilityPerFill = 1;
    mapping(StreamId streamId => uint64 sequence) public consumedSequence;
    mapping(StreamId streamId => bytes32 fillId) public finalizedFill;

    function setInventory(int128 inventory_) external {
        inventory = inventory_;
    }

    function validateStreamCapacity(StreamId, StreamPolicy calldata policy) external pure {
        require(policy.capacityReservationId != bytes32(0));
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
