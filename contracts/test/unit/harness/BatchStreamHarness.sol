// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {BatchClearingLib} from "../../../src/libraries/BatchClearingLib.sol";
import {StreamHashLib} from "../../../src/libraries/StreamHashLib.sol";
import {StreamPricingLib} from "../../../src/libraries/StreamPricingLib.sol";
import {BatchAllocation, BatchExecutionHeader} from "../../../src/types/BatchTypes.sol";
import {PackageLeg} from "../../../src/types/PackageDefinition.sol";
import {StreamLadderLevel, StreamPolicy, StreamSizeBand} from "../../../src/types/StreamTypes.sol";
import {Lots, PriceTicks} from "../../../src/types/Units.sol";

contract BatchStreamHarness {
    function validateBatch(
        BatchExecutionHeader calldata header,
        PackageLeg[] calldata legs,
        BatchAllocation[] calldata allocations
    ) external view {
        BatchClearingLib.validateHeader(header, legs);
        BatchClearingLib.validateAllocations(header, allocations);
    }

    function allocationHash(BatchAllocation[] calldata allocations) external pure returns (bytes32) {
        return BatchClearingLib.hashAuctionAllocations(allocations);
    }

    function hashSizeBands(StreamSizeBand[] calldata bands) external pure returns (bytes32) {
        return StreamHashLib.hashSizeBands(bands);
    }

    function hashLadder(StreamLadderLevel[] calldata levels) external pure returns (bytes32) {
        return StreamHashLib.hashLadder(levels);
    }

    function quote(
        StreamPolicy calldata policy,
        StreamSizeBand[] calldata bands,
        StreamLadderLevel[] calldata levels,
        Lots fillLots,
        int128 inventoryBeforeLots
    ) external pure returns (PriceTicks) {
        return StreamPricingLib.quote(policy, bands, levels, fillLots, inventoryBeforeLots);
    }
}
