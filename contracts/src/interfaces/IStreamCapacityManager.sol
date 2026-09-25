// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "../types/Enums.sol";
import {StreamCapacityConsumption, StreamId, StreamPolicy} from "../types/StreamTypes.sol";
import {Lots} from "../types/Units.sol";

interface IStreamCapacityManager {
    function validateStreamCapacity(StreamId streamId, StreamPolicy calldata policy) external view;

    function consumeStreamCapacity(StreamId streamId, uint64 sequence, Side makerSide, Lots fillLots)
        external
        returns (StreamCapacityConsumption memory consumption);

    function finalizeStreamCapacity(StreamId streamId, uint64 sequence, bytes32 fillId, bytes32 consumptionHash)
        external;
}
