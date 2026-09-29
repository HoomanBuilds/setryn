// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {DisruptionOutcomeId, ExercisePolicyId} from "../types/Identifiers.sol";

/// Errors raised by internal library code that now executes inside linked libraries. Declaring them here keeps
/// them in SeriesRegistry's ABI exactly as before the modular split, so clients decode every revert unchanged.
interface ISeriesRegistryLinkedErrors {
    error DateAdjustmentEvidenceHashMismatch(bytes32 expected, bytes32 actual);
    error EmptyPayoffTerms();
    error FixingSlotsHashMismatch(bytes32 expected, bytes32 actual);
    error InvalidAutomaticExerciseThreshold(uint128 thresholdMinor);
    error InvalidAutomaticExerciseWindow(uint64 exerciseOpensAt, uint64 exerciseCutoffAt);
    error InvalidElectionExerciseWindow(uint64 expiryAt, uint64 exerciseOpensAt, uint64 exerciseCutoffAt);
    error InvalidFlatDisruptionTransfer(int256 terminalDisruptionTransferMinorPerLot);
    error InvalidSeriesFixingTimeline();
    error InvalidSeriesTradingWindow(uint64 tradingStartsAt, uint64 lastTradingAt);
    error PayoffTermsHashMismatch(bytes32 expected, bytes32 actual);
    error PayoffTermsTooLarge(uint256 length, uint256 maximum);
    error TerminalDisruptionTransferOutsideBounds(
        int256 terminalDisruptionTransferMinorPerLot, uint128 maxLongDebitMinorPerLot, uint128 maxShortDebitMinorPerLot
    );
    error UnsupportedDisruptionOutcome(DisruptionOutcomeId disruptionOutcomeId);
    error UnsupportedExercisePolicy(ExercisePolicyId exercisePolicyId);
    error ZeroSeriesCommitment();
    error ZeroSeriesDebitBounds();
    error ZeroSeriesDependency();
    error ZeroSeriesKey();
    error ZeroSeriesNamespaceId();
}
