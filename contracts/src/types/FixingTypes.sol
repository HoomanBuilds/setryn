// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AdapterId, BenchmarkId, EvidenceOriginId, SeriesId} from "./Identifiers.sol";
import {FixingSelectionRuleId} from "./SeriesQualification.sol";

enum FixingStatus {
    Unspecified,
    Proposed,
    Disputed,
    Finalized
}

enum FixingResolutionKind {
    Unspecified,
    PrimaryFinal,
    FallbackFinal,
    TerminalDisruption
}

struct SequencerEvidence {
    bool sequencerUp;
    bool inRecoveryGrace;
    uint64 recoveryGraceEndsAt;
    bytes32 proofHash;
}

struct HistoricalObservation {
    int256 value;
    uint128 weight;
    uint64 observedAt;
    uint64 publishedAt;
    uint64 providerSequence;
    uint16 confidenceBps;
    uint8 decimals;
    bytes32 finalityReference;
    bytes32 itemEvidenceHash;
    SequencerEvidence sequencer;
}

struct FixingEvidenceSubmission {
    uint8 slot;
    uint8 candidateIndex;
    HistoricalObservation[] observations;
    bytes adapterEvidence;
}

struct ObservationValidationContext {
    uint256 chainId;
    address fixingEngine;
    SeriesId seriesId;
    uint32 seriesVersion;
    uint8 slot;
    uint8 candidateIndex;
    BenchmarkId benchmarkId;
    uint32 benchmarkVersion;
    bytes32 benchmarkVersionHash;
    bytes32 feedKey;
    bytes32 requiredCapabilityHash;
    FixingSelectionRuleId selectionRuleId;
    bytes32 selectionParametersHash;
    bytes32 observationsHash;
    uint64 candidateDeadline;
}

struct ObservationBatchValidation {
    bytes32 observationsHash;
    EvidenceOriginId evidenceOriginId;
    bytes32 feedKey;
    bytes32 capabilityHash;
    bytes32 completenessHash;
    bytes32 evidenceHash;
    uint64 batchSequence;
    bool complete;
    bool outageIndependent;
}

struct FixingProposal {
    bytes32 proposalHash;
    bytes32 observationsHash;
    bytes32 evidenceHash;
    bytes32 completenessHash;
    EvidenceOriginId evidenceOriginId;
    AdapterId adapterId;
    uint32 adapterVersion;
    uint64 batchSequence;
    uint64 candidateDeadline;
    uint64 firstObservedAt;
    uint64 lastObservedAt;
    uint64 latestPublishedAt;
    uint16 observationCount;
    uint8 candidateIndex;
    uint8 decimals;
    int256 value;
}

struct FixingResult {
    bytes32 resultHash;
    bytes32 proposalHash;
    FixingResolutionKind resolutionKind;
    uint64 effectiveAt;
    uint64 finalizedAt;
    uint64 finalizedBlock;
    uint8 candidateIndex;
    uint8 decimals;
    int256 value;
    int256 terminalDisruptionTransferMinorPerLot;
}
