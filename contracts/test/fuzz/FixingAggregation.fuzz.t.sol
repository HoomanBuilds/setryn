// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {HistoricalObservation, SequencerEvidence} from "../../src/types/FixingTypes.sol";
import {BenchmarkId, WindowKindId} from "../../src/types/Identifiers.sol";
import {FixingCandidate, FixingSelectionRuleId} from "../../src/types/SeriesQualification.sol";
import {FixingAggregationHarness} from "../unit/harness/FixingAggregationHarness.sol";

contract FixingAggregationFuzzTest is Test {
    FixingAggregationHarness internal harness;

    function setUp() public {
        harness = new FixingAggregationHarness();
    }

    function testFuzz_ArithmeticMeanRoundsTowardZero(int64 first, int64 second) public view {
        HistoricalObservation[] memory observations = _twoObservations(first, second, 1, 1);
        int256 result =
            harness.aggregate(_candidate(SeriesDefinitionLib.FIXING_SELECTION_ARITHMETIC_MEAN), observations);
        assertEq(result, (int256(first) + int256(second)) / 2);
    }

    function testFuzz_VolumeWeightedMeanUsesExplicitWeights(
        int32 first,
        int32 second,
        uint32 firstWeight,
        uint32 secondWeight
    ) public view {
        firstWeight = uint32(bound(firstWeight, 1, type(uint16).max));
        secondWeight = uint32(bound(secondWeight, 1, type(uint16).max));
        HistoricalObservation[] memory observations = _twoObservations(first, second, firstWeight, secondWeight);
        int256 result =
            harness.aggregate(_candidate(SeriesDefinitionLib.FIXING_SELECTION_VOLUME_WEIGHTED_MEAN), observations);
        int256 expected = (int256(first)
                * int256(uint256(firstWeight))
                + int256(second)
                * int256(uint256(secondWeight))) / int256(uint256(firstWeight) + uint256(secondWeight));
        assertEq(result, expected);
    }

    function testFuzz_EvenMedianAveragesWithoutOverflow(int128 first, int128 second) public view {
        HistoricalObservation[] memory observations = _twoObservations(first, second, 1, 1);
        int256 result = harness.aggregate(_candidate(SeriesDefinitionLib.FIXING_SELECTION_MEDIAN), observations);
        int256 left = first < second ? int256(first) : int256(second);
        int256 right = first < second ? int256(second) : int256(first);
        assertEq(result, left / 2 + right / 2 + (left % 2 + right % 2) / 2);
    }

    function testFuzz_TwapUsesHalfOpenIntervals(int32 first, int32 second, uint16 splitSeed) public view {
        uint64 split = uint64(bound(splitSeed, 1, 999));
        HistoricalObservation[] memory observations = _twoObservations(first, second, 1, 1);
        observations[0].observedAt = 1_000;
        observations[1].observedAt = 1_000 + split;
        int256 result =
            harness.aggregate(_candidate(SeriesDefinitionLib.FIXING_SELECTION_TIME_WEIGHTED_MEAN), observations);
        int256 expected =
            (int256(first) * int256(uint256(split)) + int256(second) * int256(uint256(1_000 - split))) / 1_000;
        assertEq(result, expected);
    }

    function _twoObservations(int256 first, int256 second, uint128 firstWeight, uint128 secondWeight)
        private
        pure
        returns (HistoricalObservation[] memory observations)
    {
        observations = new HistoricalObservation[](2);
        observations[0] = _observation(first, firstWeight, 1_000, 1);
        observations[1] = _observation(second, secondWeight, 1_500, 2);
    }

    function _observation(int256 value, uint128 weight, uint64 observedAt, uint64 sequence)
        private
        pure
        returns (HistoricalObservation memory)
    {
        return HistoricalObservation({
            value: value,
            weight: weight,
            observedAt: observedAt,
            publishedAt: observedAt,
            providerSequence: sequence,
            confidenceBps: 0,
            decimals: 8,
            finalityReference: bytes32(uint256(sequence)),
            itemEvidenceHash: keccak256(abi.encode(sequence)),
            sequencer: SequencerEvidence({
                sequencerUp: true, inRecoveryGrace: false, recoveryGraceEndsAt: 0, proofHash: keccak256("sequencer")
            })
        });
    }

    function _candidate(FixingSelectionRuleId rule) private pure returns (FixingCandidate memory) {
        return FixingCandidate({
            benchmarkId: BenchmarkId.wrap(keccak256("benchmark")),
            benchmarkVersion: 1,
            requiredWindowKindId: WindowKindId.wrap(keccak256("window")),
            selectionRuleId: rule,
            targetAt: 1_500,
            windowStartsAt: 1_000,
            windowEndsAt: 2_000,
            unavailableAfter: 2_500,
            maxPublicationLagSeconds: 100,
            minimumObservations: 2,
            maximumObservations: 2,
            selectionParametersHash: keccak256("selection")
        });
    }
}

