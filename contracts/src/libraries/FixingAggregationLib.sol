// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SeriesDefinitionLib} from "./SeriesDefinitionLib.sol";
import {HistoricalObservation} from "../types/FixingTypes.sol";
import {FixingCandidate, FixingSelectionRuleId} from "../types/SeriesQualification.sol";

error UnsupportedFixingAggregation(FixingSelectionRuleId selectionRuleId);
error InvalidSingleObservationRule(uint256 count);
error ObservationAfterTarget(uint64 observedAt, uint64 targetAt);
error ObservationBeforeTarget(uint64 observedAt, uint64 targetAt);
error TimeWeightedMeanMustStartAtWindow(uint64 observedAt, uint64 windowStartsAt);
error NonIncreasingObservationTime(uint256 index, uint64 previous, uint64 current);
error ZeroObservationWeight(uint256 index);
error ObservationWeightOverflow();

library FixingAggregationLib {
    function aggregate(FixingCandidate memory candidate, HistoricalObservation[] calldata observations)
        internal
        pure
        returns (int256)
    {
        bytes32 rule = FixingSelectionRuleId.unwrap(candidate.selectionRuleId);
        if (rule == FixingSelectionRuleId.unwrap(SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL)) {
            _requireSingle(observations);
            return observations[0].value;
        }
        if (rule == FixingSelectionRuleId.unwrap(SeriesDefinitionLib.FIXING_SELECTION_LAST_AT_OR_BEFORE)) {
            _requireSingle(observations);
            if (observations[0].observedAt > candidate.targetAt) {
                revert ObservationAfterTarget(observations[0].observedAt, candidate.targetAt);
            }
            return observations[0].value;
        }
        if (rule == FixingSelectionRuleId.unwrap(SeriesDefinitionLib.FIXING_SELECTION_FIRST_AT_OR_AFTER)) {
            _requireSingle(observations);
            if (observations[0].observedAt < candidate.targetAt) {
                revert ObservationBeforeTarget(observations[0].observedAt, candidate.targetAt);
            }
            return observations[0].value;
        }
        if (rule == FixingSelectionRuleId.unwrap(SeriesDefinitionLib.FIXING_SELECTION_ARITHMETIC_MEAN)) {
            return _arithmeticMean(observations);
        }
        if (rule == FixingSelectionRuleId.unwrap(SeriesDefinitionLib.FIXING_SELECTION_TIME_WEIGHTED_MEAN)) {
            return _timeWeightedMean(candidate, observations);
        }
        if (rule == FixingSelectionRuleId.unwrap(SeriesDefinitionLib.FIXING_SELECTION_VOLUME_WEIGHTED_MEAN)) {
            return _volumeWeightedMean(observations);
        }
        if (rule == FixingSelectionRuleId.unwrap(SeriesDefinitionLib.FIXING_SELECTION_MEDIAN)) {
            return _median(observations);
        }
        revert UnsupportedFixingAggregation(candidate.selectionRuleId);
    }

    function _requireSingle(HistoricalObservation[] calldata observations) private pure {
        if (observations.length != 1) revert InvalidSingleObservationRule(observations.length);
    }

    function _arithmeticMean(HistoricalObservation[] calldata observations) private pure returns (int256) {
        int256 sum;
        for (uint256 i; i < observations.length; ++i) {
            sum += observations[i].value;
        }
        return sum / int256(observations.length);
    }

    function _timeWeightedMean(FixingCandidate memory candidate, HistoricalObservation[] calldata observations)
        private
        pure
        returns (int256)
    {
        if (observations[0].observedAt != candidate.windowStartsAt) {
            revert TimeWeightedMeanMustStartAtWindow(observations[0].observedAt, candidate.windowStartsAt);
        }
        int256 weighted;
        for (uint256 i; i < observations.length; ++i) {
            uint64 intervalEnd = i + 1 == observations.length ? candidate.windowEndsAt : observations[i + 1].observedAt;
            if (intervalEnd <= observations[i].observedAt) {
                revert NonIncreasingObservationTime(i, observations[i].observedAt, intervalEnd);
            }
            weighted += observations[i].value * int256(uint256(intervalEnd - observations[i].observedAt));
        }
        return weighted / int256(uint256(candidate.windowEndsAt - candidate.windowStartsAt));
    }

    function _volumeWeightedMean(HistoricalObservation[] calldata observations) private pure returns (int256) {
        int256 weighted;
        uint256 totalWeight;
        for (uint256 i; i < observations.length; ++i) {
            uint128 weight = observations[i].weight;
            if (weight == 0) revert ZeroObservationWeight(i);
            weighted += observations[i].value * int256(uint256(weight));
            uint256 nextWeight = totalWeight + uint256(weight);
            if (nextWeight < totalWeight) revert ObservationWeightOverflow();
            totalWeight = nextWeight;
        }
        return weighted / int256(totalWeight);
    }

    function _median(HistoricalObservation[] calldata observations) private pure returns (int256) {
        int256[] memory values = new int256[](observations.length);
        for (uint256 i; i < observations.length; ++i) {
            int256 value = observations[i].value;
            uint256 j = i;
            while (j != 0 && values[j - 1] > value) {
                values[j] = values[j - 1];
                --j;
            }
            values[j] = value;
        }
        uint256 middle = values.length / 2;
        if (values.length % 2 == 1) return values[middle];
        int256 left = values[middle - 1];
        int256 right = values[middle];
        return left / 2 + right / 2 + (left % 2 + right % 2) / 2;
    }
}
