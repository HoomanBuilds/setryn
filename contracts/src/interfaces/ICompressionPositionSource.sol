// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PositionId} from "../types/Identifiers.sol";
import {CompressionPosition} from "../types/CompressionTypes.sol";

interface ICompressionPositionSource {
    function getCompressionPosition(PositionId positionId) external view returns (CompressionPosition memory position);
    function isCompressionEligible(PositionId positionId) external view returns (bool);
}
