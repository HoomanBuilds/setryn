// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {CalendarDay} from "./CalendarDefinition.sol";
import {
    AssetId,
    BenchmarkId,
    DisruptionOutcomeId,
    InstrumentId,
    MarketId,
    PayoffFamilyId,
    WindowKindId
} from "./Identifiers.sol";

type FixingSelectionRuleId is bytes32;

type DateAdjustmentConventionId is bytes32;

enum SeriesDateKind {
    Unspecified,
    TradingStarts,
    LastTrading,
    Expiry,
    ExerciseOpens,
    ExerciseCutoff,
    FixingWindowOpen,
    FixingWindowClose,
    PrimaryEvidenceDeadline,
    CorrectionCutoff,
    FinalResolution,
    SettlementDeadline
}

struct FixingCandidate {
    BenchmarkId benchmarkId;
    uint32 benchmarkVersion;
    WindowKindId requiredWindowKindId;
    FixingSelectionRuleId selectionRuleId;
    uint64 targetAt;
    uint64 windowStartsAt;
    uint64 windowEndsAt;
    uint64 unavailableAfter;
    uint32 maxPublicationLagSeconds;
    uint16 minimumObservations;
    uint16 maximumObservations;
    bytes32 selectionParametersHash;
}

struct FixingSlot {
    uint8 slot;
    FixingCandidate[] candidates;
}

struct CalendarDayProof {
    CalendarDay calendarDay;
    bytes32[] merkleProof;
}

struct SeriesDateProof {
    SeriesDateKind kind;
    DateAdjustmentConventionId conventionId;
    uint32 scheduledDay;
    CalendarDayProof[] calendarDays;
}

struct SeriesQualificationData {
    bytes payoffTerms;
    FixingSlot[] fixingSlots;
    SeriesDateProof[] dateProofs;
}

struct SeriesValidationContext {
    uint256 chainId;
    MarketId marketId;
    uint32 marketVersion;
    InstrumentId instrumentId;
    uint32 instrumentVersion;
    PayoffFamilyId payoffFamilyId;
    AssetId settlementAssetId;
    uint32 settlementAssetVersion;
    bytes32 payoffTermsHash;
    bytes32 fixingSlotsHash;
    DisruptionOutcomeId disruptionOutcomeId;
    uint64 finalResolutionAt;
}

struct SeriesPayoffValidation {
    uint128 maxLongDebitMinorPerLot;
    uint128 maxShortDebitMinorPerLot;
    int256 terminalDisruptionTransferMinorPerLot;
}
