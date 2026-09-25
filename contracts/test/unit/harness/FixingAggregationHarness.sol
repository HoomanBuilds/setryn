// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {FixingAggregationLib} from "../../../src/libraries/FixingAggregationLib.sol";
import {HistoricalObservation} from "../../../src/types/FixingTypes.sol";
import {FixingCandidate} from "../../../src/types/SeriesQualification.sol";

contract FixingAggregationHarness {
    function aggregate(FixingCandidate calldata candidate, HistoricalObservation[] calldata observations)
        external
        pure
        returns (int256)
    {
        return FixingAggregationLib.aggregate(candidate, observations);
    }
}

