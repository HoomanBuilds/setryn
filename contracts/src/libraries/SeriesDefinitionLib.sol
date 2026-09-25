// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IdLib} from "./IdLib.sol";
import {SessionDefinitionLib} from "./SessionDefinitionLib.sol";
import {
    BenchmarkId,
    DisruptionOutcomeId,
    ExercisePolicyId,
    InstrumentId,
    MarketId,
    SeriesId,
    WindowKindId
} from "../types/Identifiers.sol";
import {InstrumentDefinition} from "../types/InstrumentDefinition.sol";
import {SeriesDefinition} from "../types/SeriesDefinition.sol";
import {
    CalendarDayProof,
    DateAdjustmentConventionId,
    FixingCandidate,
    FixingSelectionRuleId,
    FixingSlot,
    SeriesDateKind,
    SeriesDateProof,
    SeriesQualificationData
} from "../types/SeriesQualification.sol";

error ZeroSeriesNamespaceId();
error ZeroSeriesKey();
error ZeroSeriesDependency();
error InvalidSeriesTradingWindow(uint64 tradingStartsAt, uint64 lastTradingAt);
error InvalidSeriesFixingTimeline();
error UnsupportedExercisePolicy(ExercisePolicyId exercisePolicyId);
error InvalidAutomaticExerciseWindow(uint64 exerciseOpensAt, uint64 exerciseCutoffAt);
error InvalidElectionExerciseWindow(uint64 expiryAt, uint64 exerciseOpensAt, uint64 exerciseCutoffAt);
error UnsupportedDisruptionOutcome(DisruptionOutcomeId disruptionOutcomeId);
error InvalidFlatDisruptionTransfer(int256 terminalDisruptionTransferMinorPerLot);
error ZeroSeriesCommitment();
error ZeroSeriesDebitBounds();
error TerminalDisruptionTransferOutsideBounds(
    int256 terminalDisruptionTransferMinorPerLot, uint128 maxLongDebitMinorPerLot, uint128 maxShortDebitMinorPerLot
);
error EmptyPayoffTerms();
error PayoffTermsTooLarge(uint256 length, uint256 maximum);
error PayoffTermsHashMismatch(bytes32 expected, bytes32 actual);
error InvalidFixingSlotCount(uint256 count, uint256 maximum);
error InvalidFixingSlotIndex(uint256 index, uint8 actual);
error InvalidFixingCandidateCount(uint8 slot, uint256 count, uint256 maximum);
error InvalidFixingCandidate(uint8 slot, uint256 candidate);
error DuplicateFixingCandidate(uint8 slot, uint256 first, uint256 second);
error UnsupportedFixingWindowKind(uint8 slot, uint256 candidate);
error UnsupportedFixingSelectionRule(uint8 slot, uint256 candidate, FixingSelectionRuleId selectionRuleId);
error FixingSlotsHashMismatch(bytes32 expected, bytes32 actual);
error InvalidDateProofCount(uint256 count);
error InvalidDateProofKind(uint256 index, SeriesDateKind expected, SeriesDateKind actual);
error UnsupportedDateAdjustmentConvention(DateAdjustmentConventionId conventionId);
error InvalidDateAdjustmentDays(uint256 index);
error MerkleProofTooLong(uint256 dateIndex, uint256 dayIndex, uint256 length);
error DateAdjustmentEvidenceHashMismatch(bytes32 expected, bytes32 actual);

library SeriesDefinitionLib {
    uint256 internal constant MAX_CANDIDATES_PER_SLOT = 4;
    uint256 internal constant MAX_DATE_PROOFS = 11;
    uint256 internal constant MAX_DATE_SHIFT_DAYS = 14;
    uint256 internal constant MAX_MERKLE_PROOF_LENGTH = 64;
    uint16 internal constant MAX_OBSERVATIONS_PER_CANDIDATE = 4_096;

    ExercisePolicyId internal constant EXERCISE_POLICY_AUTOMATIC =
        ExercisePolicyId.wrap(keccak256("SetrynExercisePolicyV1:Automatic"));
    ExercisePolicyId internal constant EXERCISE_POLICY_HOLDER_ELECTION =
        ExercisePolicyId.wrap(keccak256("SetrynExercisePolicyV1:HolderElection"));
    ExercisePolicyId internal constant EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED =
        ExercisePolicyId.wrap(keccak256("SetrynExercisePolicyV1:AutomaticUnlessAbandoned"));

    DisruptionOutcomeId internal constant DISRUPTION_OUTCOME_FLAT =
        DisruptionOutcomeId.wrap(keccak256("SetrynDisruptionOutcomeV1:Flat"));
    DisruptionOutcomeId internal constant DISRUPTION_OUTCOME_PRECOMMITTED_VALUE =
        DisruptionOutcomeId.wrap(keccak256("SetrynDisruptionOutcomeV1:PrecommittedValue"));

    FixingSelectionRuleId internal constant FIXING_SELECTION_OFFICIAL =
        FixingSelectionRuleId.wrap(keccak256("SetrynFixingSelectionRuleV1:Official"));
    FixingSelectionRuleId internal constant FIXING_SELECTION_LAST_AT_OR_BEFORE =
        FixingSelectionRuleId.wrap(keccak256("SetrynFixingSelectionRuleV1:LastAtOrBefore"));
    FixingSelectionRuleId internal constant FIXING_SELECTION_FIRST_AT_OR_AFTER =
        FixingSelectionRuleId.wrap(keccak256("SetrynFixingSelectionRuleV1:FirstAtOrAfter"));
    FixingSelectionRuleId internal constant FIXING_SELECTION_ARITHMETIC_MEAN =
        FixingSelectionRuleId.wrap(keccak256("SetrynFixingSelectionRuleV1:ArithmeticMean"));
    FixingSelectionRuleId internal constant FIXING_SELECTION_TIME_WEIGHTED_MEAN =
        FixingSelectionRuleId.wrap(keccak256("SetrynFixingSelectionRuleV1:TimeWeightedMean"));

    DateAdjustmentConventionId internal constant DATE_ADJUSTMENT_UNADJUSTED =
        DateAdjustmentConventionId.wrap(keccak256("SetrynDateAdjustmentV1:Unadjusted"));
    DateAdjustmentConventionId internal constant DATE_ADJUSTMENT_FOLLOWING =
        DateAdjustmentConventionId.wrap(keccak256("SetrynDateAdjustmentV1:Following"));
    DateAdjustmentConventionId internal constant DATE_ADJUSTMENT_PRECEDING =
        DateAdjustmentConventionId.wrap(keccak256("SetrynDateAdjustmentV1:Preceding"));

    bytes32 internal constant PAYOFF_TERMS_TYPEHASH =
        keccak256("SetrynPayoffTermsV1(bytes32 termsSchemaHash,bytes32 termsDataHash)");
    bytes32 internal constant FIXING_CANDIDATE_TYPEHASH = keccak256(
        "SetrynFixingCandidateV1(bytes32 benchmarkId,uint32 benchmarkVersion,bytes32 requiredWindowKindId,bytes32 selectionRuleId,uint64 targetAt,uint64 windowStartsAt,uint64 windowEndsAt,uint64 unavailableAfter,uint32 maxPublicationLagSeconds,uint16 minimumObservations,uint16 maximumObservations,bytes32 selectionParametersHash)"
    );
    bytes32 internal constant FIXING_SLOT_TYPEHASH = keccak256("SetrynFixingSlotV1(uint8 slot,bytes32 candidatesHash)");
    bytes32 internal constant FIXING_SLOTS_TYPEHASH = keccak256("SetrynFixingSlotsV1(bytes32 slotsHash)");
    bytes32 internal constant CALENDAR_DAY_PROOF_TYPEHASH = keccak256(
        "SetrynCalendarDayProofV1(uint32 day,bool isBusinessDay,bytes32 evidenceHash,bytes32 merkleProofHash)"
    );
    bytes32 internal constant SERIES_DATE_PROOF_TYPEHASH = keccak256(
        "SetrynSeriesDateProofV1(uint8 kind,bytes32 conventionId,uint32 scheduledDay,bytes32 calendarDaysHash)"
    );
    bytes32 internal constant DATE_ADJUSTMENT_EVIDENCE_TYPEHASH =
        keccak256("SetrynDateAdjustmentEvidenceV1(bytes32 dateProofsHash)");

    string internal constant SERIES_KEY_TYPESTRING =
        "SetrynSeriesKeyV1(bytes32 namespaceId,bytes32 seriesKey,bytes32 marketId,bytes32 instrumentId)";
    bytes32 internal constant SERIES_KEY_TYPEHASH =
        keccak256("SetrynSeriesKeyV1(bytes32 namespaceId,bytes32 seriesKey,bytes32 marketId,bytes32 instrumentId)");

    string internal constant SERIES_DEFINITION_TYPESTRING =
        "SetrynSeriesDefinitionV1(bytes32 namespaceId,bytes32 seriesKey,bytes32 marketId,uint32 marketVersion,bytes32 instrumentId,uint32 instrumentVersion,uint64 tradingStartsAt,uint64 lastTradingAt,uint64 expiryAt,uint64 exerciseOpensAt,uint64 exerciseCutoffAt,uint64 fixingWindowOpen,uint64 fixingWindowClose,uint64 primaryEvidenceDeadline,uint64 correctionCutoffAt,uint64 finalResolutionAt,uint64 settlementDeadline,bytes32 exercisePolicyId,bytes32 disruptionOutcomeId,int256 terminalDisruptionTransferMinorPerLot,bytes32 payoffTermsHash,bytes32 fixingSlotsHash,bytes32 dateAdjustmentEvidenceHash,uint128 maxLongDebitMinorPerLot,uint128 maxShortDebitMinorPerLot,bytes32 qualificationEvidenceHash,uint256 chainId)";
    bytes32 internal constant SERIES_DEFINITION_TYPEHASH = keccak256(
        "SetrynSeriesDefinitionV1(bytes32 namespaceId,bytes32 seriesKey,bytes32 marketId,uint32 marketVersion,bytes32 instrumentId,uint32 instrumentVersion,uint64 tradingStartsAt,uint64 lastTradingAt,uint64 expiryAt,uint64 exerciseOpensAt,uint64 exerciseCutoffAt,uint64 fixingWindowOpen,uint64 fixingWindowClose,uint64 primaryEvidenceDeadline,uint64 correctionCutoffAt,uint64 finalResolutionAt,uint64 settlementDeadline,bytes32 exercisePolicyId,bytes32 disruptionOutcomeId,int256 terminalDisruptionTransferMinorPerLot,bytes32 payoffTermsHash,bytes32 fixingSlotsHash,bytes32 dateAdjustmentEvidenceHash,uint128 maxLongDebitMinorPerLot,uint128 maxShortDebitMinorPerLot,bytes32 qualificationEvidenceHash,uint256 chainId)"
    );

    string internal constant SERIES_VERSION_TYPESTRING =
        "SetrynSeriesVersionV1(bytes32 seriesId,uint32 version,bytes32 definitionHash,uint256 chainId)";
    bytes32 internal constant SERIES_VERSION_TYPEHASH =
        keccak256("SetrynSeriesVersionV1(bytes32 seriesId,uint32 version,bytes32 definitionHash,uint256 chainId)");

    function validate(SeriesDefinition memory definition) internal pure {
        if (definition.namespaceId == bytes32(0)) revert ZeroSeriesNamespaceId();
        if (definition.seriesKey == bytes32(0)) revert ZeroSeriesKey();
        if (
            MarketId.unwrap(definition.marketId) == bytes32(0) || definition.marketVersion == 0
                || InstrumentId.unwrap(definition.instrumentId) == bytes32(0) || definition.instrumentVersion == 0
        ) revert ZeroSeriesDependency();

        _validateTimeline(definition);
        _validateExercise(definition);
        _validateDisruption(definition);

        if (
            definition.payoffTermsHash == bytes32(0) || definition.fixingSlotsHash == bytes32(0)
                || definition.dateAdjustmentEvidenceHash == bytes32(0)
                || definition.qualificationEvidenceHash == bytes32(0)
        ) revert ZeroSeriesCommitment();
        if (definition.maxLongDebitMinorPerLot == 0 && definition.maxShortDebitMinorPerLot == 0) {
            revert ZeroSeriesDebitBounds();
        }

        int256 minimumTransfer = -int256(uint256(definition.maxLongDebitMinorPerLot));
        int256 maximumTransfer = int256(uint256(definition.maxShortDebitMinorPerLot));
        if (
            definition.terminalDisruptionTransferMinorPerLot < minimumTransfer
                || definition.terminalDisruptionTransferMinorPerLot > maximumTransfer
        ) {
            revert TerminalDisruptionTransferOutsideBounds(
                definition.terminalDisruptionTransferMinorPerLot,
                definition.maxLongDebitMinorPerLot,
                definition.maxShortDebitMinorPerLot
            );
        }
    }

    function validateQualificationData(
        SeriesDefinition memory definition,
        InstrumentDefinition memory instrument,
        SeriesQualificationData calldata qualification
    ) internal pure {
        uint256 termsLength = qualification.payoffTerms.length;
        if (termsLength == 0) revert EmptyPayoffTerms();
        if (termsLength > instrument.maxTermsBytes) {
            revert PayoffTermsTooLarge(termsLength, instrument.maxTermsBytes);
        }

        bytes32 payoffTermsHash = hashPayoffTerms(instrument.termsSchemaHash, qualification.payoffTerms);
        if (payoffTermsHash != definition.payoffTermsHash) {
            revert PayoffTermsHashMismatch(definition.payoffTermsHash, payoffTermsHash);
        }

        bytes32 fixingSlotsHash = hashFixingSlots(definition, qualification.fixingSlots, instrument.maxFixingSlots);
        if (fixingSlotsHash != definition.fixingSlotsHash) {
            revert FixingSlotsHashMismatch(definition.fixingSlotsHash, fixingSlotsHash);
        }

        bytes32 dateEvidenceHash = hashDateProofs(definition, qualification.dateProofs);
        if (dateEvidenceHash != definition.dateAdjustmentEvidenceHash) {
            revert DateAdjustmentEvidenceHashMismatch(definition.dateAdjustmentEvidenceHash, dateEvidenceHash);
        }
    }

    function hashPayoffTerms(bytes32 termsSchemaHash, bytes calldata terms) internal pure returns (bytes32) {
        return keccak256(abi.encode(PAYOFF_TERMS_TYPEHASH, termsSchemaHash, keccak256(terms)));
    }

    function hashFixingSlots(SeriesDefinition memory definition, FixingSlot[] calldata slots, uint16 maximumSlots)
        internal
        pure
        returns (bytes32)
    {
        uint256 slotCount = slots.length;
        if (slotCount == 0 || slotCount > maximumSlots) {
            revert InvalidFixingSlotCount(slotCount, maximumSlots);
        }

        bytes32[] memory slotHashes = new bytes32[](slotCount);
        for (uint256 i; i < slotCount; ++i) {
            FixingSlot calldata slot = slots[i];
            if (slot.slot != i) revert InvalidFixingSlotIndex(i, slot.slot);
            uint256 candidateCount = slot.candidates.length;
            if (candidateCount == 0 || candidateCount > MAX_CANDIDATES_PER_SLOT) {
                revert InvalidFixingCandidateCount(slot.slot, candidateCount, MAX_CANDIDATES_PER_SLOT);
            }

            bytes32[] memory candidateHashes = new bytes32[](candidateCount);
            uint64 previousUnavailableAfter;
            for (uint256 j; j < candidateCount; ++j) {
                FixingCandidate calldata candidate = slot.candidates[j];
                _validateCandidate(definition, slot.slot, j, candidate, previousUnavailableAfter);
                _requireUniqueCandidate(slot, j);
                candidateHashes[j] = _hashCandidate(candidate);
                previousUnavailableAfter = candidate.unavailableAfter;
            }
            slotHashes[i] =
                keccak256(abi.encode(FIXING_SLOT_TYPEHASH, slot.slot, keccak256(abi.encodePacked(candidateHashes))));
        }
        return keccak256(abi.encode(FIXING_SLOTS_TYPEHASH, keccak256(abi.encodePacked(slotHashes))));
    }

    function hashDateProofs(SeriesDefinition memory definition, SeriesDateProof[] calldata dateProofs)
        internal
        pure
        returns (bytes32)
    {
        if (dateProofs.length == 0 || dateProofs.length > MAX_DATE_PROOFS) {
            revert InvalidDateProofCount(dateProofs.length);
        }

        bytes32[] memory dateProofHashes = new bytes32[](dateProofs.length);
        uint256 proofIndex;
        for (
            uint8 rawKind = uint8(SeriesDateKind.TradingStarts);
            rawKind <= uint8(SeriesDateKind.SettlementDeadline);
            ++rawKind
        ) {
            SeriesDateKind kind = SeriesDateKind(rawKind);
            uint64 timestamp = timestampForKind(definition, kind);
            if (timestamp == 0) continue;
            if (proofIndex >= dateProofs.length || dateProofs[proofIndex].kind != kind) {
                SeriesDateKind actual =
                    proofIndex < dateProofs.length ? dateProofs[proofIndex].kind : SeriesDateKind.Unspecified;
                revert InvalidDateProofKind(proofIndex, kind, actual);
            }
            dateProofHashes[proofIndex] = _hashAndValidateDateProof(proofIndex, timestamp, dateProofs[proofIndex]);
            ++proofIndex;
        }
        if (proofIndex != dateProofs.length) revert InvalidDateProofCount(dateProofs.length);

        return keccak256(abi.encode(DATE_ADJUSTMENT_EVIDENCE_TYPEHASH, keccak256(abi.encodePacked(dateProofHashes))));
    }

    function timestampForKind(SeriesDefinition memory definition, SeriesDateKind kind) internal pure returns (uint64) {
        if (kind == SeriesDateKind.TradingStarts) return definition.tradingStartsAt;
        if (kind == SeriesDateKind.LastTrading) return definition.lastTradingAt;
        if (kind == SeriesDateKind.Expiry) return definition.expiryAt;
        if (kind == SeriesDateKind.ExerciseOpens) return definition.exerciseOpensAt;
        if (kind == SeriesDateKind.ExerciseCutoff) return definition.exerciseCutoffAt;
        if (kind == SeriesDateKind.FixingWindowOpen) return definition.fixingWindowOpen;
        if (kind == SeriesDateKind.FixingWindowClose) return definition.fixingWindowClose;
        if (kind == SeriesDateKind.PrimaryEvidenceDeadline) return definition.primaryEvidenceDeadline;
        if (kind == SeriesDateKind.CorrectionCutoff) return definition.correctionCutoffAt;
        if (kind == SeriesDateKind.FinalResolution) return definition.finalResolutionAt;
        if (kind == SeriesDateKind.SettlementDeadline) return definition.settlementDeadline;
        return 0;
    }

    function effectiveDay(SeriesDateProof calldata dateProof) internal pure returns (uint32) {
        return dateProof.calendarDays[dateProof.calendarDays.length - 1].calendarDay.day;
    }

    function hashKey(SeriesDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SERIES_KEY_TYPEHASH,
                definition.namespaceId,
                definition.seriesKey,
                MarketId.unwrap(definition.marketId),
                InstrumentId.unwrap(definition.instrumentId)
            )
        );
    }

    function hashDefinition(SeriesDefinition memory definition, uint256 chainId) internal pure returns (bytes32) {
        bytes memory identity = abi.encode(
            SERIES_DEFINITION_TYPEHASH,
            definition.namespaceId,
            definition.seriesKey,
            MarketId.unwrap(definition.marketId),
            definition.marketVersion,
            InstrumentId.unwrap(definition.instrumentId),
            definition.instrumentVersion
        );
        bytes memory schedule = abi.encode(
            definition.tradingStartsAt,
            definition.lastTradingAt,
            definition.expiryAt,
            definition.exerciseOpensAt,
            definition.exerciseCutoffAt,
            definition.fixingWindowOpen,
            definition.fixingWindowClose,
            definition.primaryEvidenceDeadline,
            definition.correctionCutoffAt,
            definition.finalResolutionAt,
            definition.settlementDeadline
        );
        bytes memory economics = abi.encode(
            ExercisePolicyId.unwrap(definition.exercisePolicyId),
            DisruptionOutcomeId.unwrap(definition.disruptionOutcomeId),
            definition.terminalDisruptionTransferMinorPerLot,
            definition.payoffTermsHash,
            definition.fixingSlotsHash,
            definition.dateAdjustmentEvidenceHash,
            definition.maxLongDebitMinorPerLot,
            definition.maxShortDebitMinorPerLot,
            definition.qualificationEvidenceHash,
            chainId
        );
        return keccak256(bytes.concat(identity, schedule, economics));
    }

    function hashVersion(SeriesId seriesId, uint32 version, bytes32 definitionHash, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(abi.encode(SERIES_VERSION_TYPEHASH, SeriesId.unwrap(seriesId), version, definitionHash, chainId));
    }

    function deriveSeriesId(SeriesDefinition memory definition) internal pure returns (SeriesId) {
        return IdLib.deriveSeriesId(hashKey(definition));
    }

    function _validateTimeline(SeriesDefinition memory definition) private pure {
        if (definition.tradingStartsAt > definition.lastTradingAt) {
            revert InvalidSeriesTradingWindow(definition.tradingStartsAt, definition.lastTradingAt);
        }
        if (
            definition.lastTradingAt >= definition.fixingWindowOpen
                || definition.fixingWindowOpen >= definition.fixingWindowClose
                || definition.fixingWindowClose > definition.primaryEvidenceDeadline
                || definition.primaryEvidenceDeadline > definition.correctionCutoffAt
                || definition.correctionCutoffAt >= definition.finalResolutionAt
                || definition.fixingWindowClose > definition.expiryAt
                || definition.expiryAt > definition.primaryEvidenceDeadline
                || definition.finalResolutionAt > definition.settlementDeadline
        ) revert InvalidSeriesFixingTimeline();
    }

    function _validateExercise(SeriesDefinition memory definition) private pure {
        if (ExercisePolicyId.unwrap(definition.exercisePolicyId) == ExercisePolicyId.unwrap(EXERCISE_POLICY_AUTOMATIC))
        {
            if (definition.exerciseOpensAt != 0 || definition.exerciseCutoffAt != 0) {
                revert InvalidAutomaticExerciseWindow(definition.exerciseOpensAt, definition.exerciseCutoffAt);
            }
            return;
        }
        if (
            ExercisePolicyId.unwrap(definition.exercisePolicyId)
                    != ExercisePolicyId.unwrap(EXERCISE_POLICY_HOLDER_ELECTION)
                && ExercisePolicyId.unwrap(definition.exercisePolicyId)
                    != ExercisePolicyId.unwrap(EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
        ) revert UnsupportedExercisePolicy(definition.exercisePolicyId);
        if (
            definition.expiryAt > definition.exerciseOpensAt || definition.exerciseOpensAt > definition.exerciseCutoffAt
                || definition.exerciseCutoffAt >= definition.finalResolutionAt
        ) {
            revert InvalidElectionExerciseWindow(
                definition.expiryAt, definition.exerciseOpensAt, definition.exerciseCutoffAt
            );
        }
    }

    function _validateDisruption(SeriesDefinition memory definition) private pure {
        if (
            DisruptionOutcomeId.unwrap(definition.disruptionOutcomeId)
                == DisruptionOutcomeId.unwrap(DISRUPTION_OUTCOME_FLAT)
        ) {
            if (definition.terminalDisruptionTransferMinorPerLot != 0) {
                revert InvalidFlatDisruptionTransfer(definition.terminalDisruptionTransferMinorPerLot);
            }
            return;
        }
        if (
            DisruptionOutcomeId.unwrap(definition.disruptionOutcomeId)
                != DisruptionOutcomeId.unwrap(DISRUPTION_OUTCOME_PRECOMMITTED_VALUE)
        ) revert UnsupportedDisruptionOutcome(definition.disruptionOutcomeId);
    }

    function _validateCandidate(
        SeriesDefinition memory definition,
        uint8 slot,
        uint256 candidateIndex,
        FixingCandidate calldata candidate,
        uint64 previousUnavailableAfter
    ) private pure {
        if (
            BenchmarkId.unwrap(candidate.benchmarkId) == bytes32(0) || candidate.benchmarkVersion == 0
                || candidate.windowStartsAt < definition.fixingWindowOpen
                || candidate.windowStartsAt >= candidate.windowEndsAt
                || candidate.windowEndsAt > definition.fixingWindowClose
                || candidate.targetAt < candidate.windowStartsAt || candidate.targetAt >= candidate.windowEndsAt
                || candidate.unavailableAfter <= candidate.windowEndsAt
                || candidate.unavailableAfter > definition.finalResolutionAt
                || (candidateIndex != 0 && candidate.unavailableAfter <= previousUnavailableAfter)
                || candidate.maxPublicationLagSeconds == 0 || candidate.minimumObservations == 0
                || candidate.minimumObservations > candidate.maximumObservations
                || candidate.maximumObservations > MAX_OBSERVATIONS_PER_CANDIDATE
                || candidate.selectionParametersHash == bytes32(0)
        ) revert InvalidFixingCandidate(slot, candidateIndex);

        if (
            WindowKindId.unwrap(candidate.requiredWindowKindId)
                    != WindowKindId.unwrap(SessionDefinitionLib.WINDOW_KIND_FIXING)
                && WindowKindId.unwrap(candidate.requiredWindowKindId)
                    != WindowKindId.unwrap(SessionDefinitionLib.WINDOW_KIND_OBSERVATION)
        ) revert UnsupportedFixingWindowKind(slot, candidateIndex);

        bool requiresOneObservation = FixingSelectionRuleId.unwrap(candidate.selectionRuleId)
                == FixingSelectionRuleId.unwrap(FIXING_SELECTION_OFFICIAL)
            || FixingSelectionRuleId.unwrap(candidate.selectionRuleId)
                == FixingSelectionRuleId.unwrap(FIXING_SELECTION_LAST_AT_OR_BEFORE)
            || FixingSelectionRuleId.unwrap(candidate.selectionRuleId)
                == FixingSelectionRuleId.unwrap(FIXING_SELECTION_FIRST_AT_OR_AFTER);
        bool isMean = FixingSelectionRuleId.unwrap(candidate.selectionRuleId)
                == FixingSelectionRuleId.unwrap(FIXING_SELECTION_ARITHMETIC_MEAN)
            || FixingSelectionRuleId.unwrap(candidate.selectionRuleId)
                == FixingSelectionRuleId.unwrap(FIXING_SELECTION_TIME_WEIGHTED_MEAN);
        if (!requiresOneObservation && !isMean) {
            revert UnsupportedFixingSelectionRule(slot, candidateIndex, candidate.selectionRuleId);
        }
        if (requiresOneObservation && (candidate.minimumObservations != 1 || candidate.maximumObservations != 1)) {
            revert InvalidFixingCandidate(slot, candidateIndex);
        }
    }

    function _requireUniqueCandidate(FixingSlot calldata slot, uint256 candidateIndex) private pure {
        FixingCandidate calldata candidate = slot.candidates[candidateIndex];
        for (uint256 previous; previous < candidateIndex; ++previous) {
            FixingCandidate calldata other = slot.candidates[previous];
            if (
                BenchmarkId.unwrap(candidate.benchmarkId) == BenchmarkId.unwrap(other.benchmarkId)
                    && candidate.benchmarkVersion == other.benchmarkVersion
                    && WindowKindId.unwrap(candidate.requiredWindowKindId)
                        == WindowKindId.unwrap(other.requiredWindowKindId)
            ) revert DuplicateFixingCandidate(slot.slot, previous, candidateIndex);
        }
    }

    function _hashCandidate(FixingCandidate calldata candidate) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FIXING_CANDIDATE_TYPEHASH,
                BenchmarkId.unwrap(candidate.benchmarkId),
                candidate.benchmarkVersion,
                WindowKindId.unwrap(candidate.requiredWindowKindId),
                FixingSelectionRuleId.unwrap(candidate.selectionRuleId),
                candidate.targetAt,
                candidate.windowStartsAt,
                candidate.windowEndsAt,
                candidate.unavailableAfter,
                candidate.maxPublicationLagSeconds,
                candidate.minimumObservations,
                candidate.maximumObservations,
                candidate.selectionParametersHash
            )
        );
    }

    function _hashAndValidateDateProof(uint256 dateIndex, uint64 timestamp, SeriesDateProof calldata dateProof)
        private
        pure
        returns (bytes32)
    {
        uint32 effective = uint32(timestamp / 1 days);
        uint256 dayCount = dateProof.calendarDays.length;
        if (dayCount == 0 || dayCount > MAX_DATE_SHIFT_DAYS + 1) revert InvalidDateAdjustmentDays(dateIndex);

        bytes32 convention = DateAdjustmentConventionId.unwrap(dateProof.conventionId);
        bytes32 unadjusted = DateAdjustmentConventionId.unwrap(DATE_ADJUSTMENT_UNADJUSTED);
        bytes32 following = DateAdjustmentConventionId.unwrap(DATE_ADJUSTMENT_FOLLOWING);
        bytes32 preceding = DateAdjustmentConventionId.unwrap(DATE_ADJUSTMENT_PRECEDING);
        if (convention != unadjusted && convention != following && convention != preceding) {
            revert UnsupportedDateAdjustmentConvention(dateProof.conventionId);
        }

        uint256 distance = dateProof.scheduledDay > effective
            ? uint256(dateProof.scheduledDay - effective)
            : uint256(effective - dateProof.scheduledDay);
        if (distance > MAX_DATE_SHIFT_DAYS || dayCount != distance + 1) revert InvalidDateAdjustmentDays(dateIndex);
        if (convention == unadjusted && dateProof.scheduledDay != effective) {
            revert InvalidDateAdjustmentDays(dateIndex);
        }
        if (convention == following && dateProof.scheduledDay >= effective) {
            revert InvalidDateAdjustmentDays(dateIndex);
        }
        if (convention == preceding && dateProof.scheduledDay <= effective) {
            revert InvalidDateAdjustmentDays(dateIndex);
        }

        bytes32[] memory calendarDayHashes = new bytes32[](dayCount);
        for (uint256 i; i < dayCount; ++i) {
            CalendarDayProof calldata dayProof = dateProof.calendarDays[i];
            uint32 expectedDay =
                convention == preceding ? dateProof.scheduledDay - uint32(i) : dateProof.scheduledDay + uint32(i);
            bool expectedBusinessDay = i + 1 == dayCount;
            if (
                dayProof.calendarDay.day != expectedDay || dayProof.calendarDay.isBusinessDay != expectedBusinessDay
                    || dayProof.calendarDay.evidenceHash == bytes32(0)
            ) revert InvalidDateAdjustmentDays(dateIndex);
            if (dayProof.merkleProof.length > MAX_MERKLE_PROOF_LENGTH) {
                revert MerkleProofTooLong(dateIndex, i, dayProof.merkleProof.length);
            }
            calendarDayHashes[i] = keccak256(
                abi.encode(
                    CALENDAR_DAY_PROOF_TYPEHASH,
                    dayProof.calendarDay.day,
                    dayProof.calendarDay.isBusinessDay,
                    dayProof.calendarDay.evidenceHash,
                    keccak256(abi.encodePacked(dayProof.merkleProof))
                )
            );
        }
        if (dateProof.calendarDays[dayCount - 1].calendarDay.day != effective) {
            revert InvalidDateAdjustmentDays(dateIndex);
        }
        return keccak256(
            abi.encode(
                SERIES_DATE_PROOF_TYPEHASH,
                uint8(dateProof.kind),
                DateAdjustmentConventionId.unwrap(dateProof.conventionId),
                dateProof.scheduledDay,
                keccak256(abi.encodePacked(calendarDayHashes))
            )
        );
    }
}
