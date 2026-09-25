// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "../types/Enums.sol";
import {StreamCapacityState, CapacityConsumptionRecord} from "../types/CapacityManagerTypes.sol";
import {CollateralLockId} from "../types/Identifiers.sol";
import {StreamCapacityConsumption, StreamId, StreamPolicy} from "../types/StreamTypes.sol";
import {Lots} from "../types/Units.sol";

interface IStreamCapacityManager {
    function reserveStreamCapacity(StreamId streamId, StreamPolicy calldata policy)
        external
        returns (CollateralLockId lockId);

    function consumeStreamCapacity(StreamId streamId, uint64 sequence, Side makerSide, Lots fillLots)
        external
        returns (StreamCapacityConsumption memory consumption);

    function finalizeStreamCapacity(StreamId streamId, uint64 sequence, bytes32 fillId, bytes32 consumptionHash)
        external;

    function releaseStreamCapacity(StreamId streamId) external;
    function expireStreamCapacity(StreamId streamId) external;
    function getStreamCapacity(StreamId streamId) external view returns (StreamCapacityState memory state);
    function getStreamConsumption(StreamId streamId, uint64 sequence)
        external
        view
        returns (CapacityConsumptionRecord memory record);
}
