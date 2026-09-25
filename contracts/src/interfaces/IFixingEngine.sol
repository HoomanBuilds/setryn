// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IBenchmarkRegistry} from "./IBenchmarkRegistry.sol";
import {ISeriesRegistry} from "./ISeriesRegistry.sol";
import {BenchmarkId, EvidenceOriginId, SeriesId} from "../types/Identifiers.sol";
import {
    FixingProposal,
    FixingEvidenceSubmission,
    FixingResolutionKind,
    FixingResult,
    FixingStatus,
    HistoricalObservation
} from "../types/FixingTypes.sol";
import {FixingSlot} from "../types/SeriesQualification.sol";

interface IFixingEngine {
    event FixingEvidenceProposed(
        bytes32 indexed fixingKey,
        SeriesId indexed seriesId,
        uint32 indexed seriesVersion,
        uint8 slot,
        uint8 candidateIndex,
        BenchmarkId benchmarkId,
        uint32 benchmarkVersion,
        EvidenceOriginId evidenceOriginId,
        uint64 batchSequence,
        bytes32 observationsHash,
        bytes32 evidenceHash,
        bytes32 completenessHash,
        bytes32 proposalHash,
        int256 value,
        uint8 decimals,
        address submitter
    );

    event FixingFinalized(
        bytes32 indexed fixingKey,
        SeriesId indexed seriesId,
        uint32 indexed seriesVersion,
        uint8 slot,
        FixingResolutionKind resolutionKind,
        bytes32 proposalHash,
        bytes32 resultHash,
        int256 value,
        uint8 decimals,
        int256 terminalDisruptionTransferMinorPerLot,
        uint64 effectiveAt,
        address finalizer
    );

    event FixingDisputed(
        bytes32 indexed fixingKey,
        SeriesId indexed seriesId,
        uint32 indexed seriesVersion,
        uint8 slot,
        bytes32 incumbentProposalHash,
        bytes32 conflictingProposalHash,
        uint64 batchSequence,
        address submitter
    );

    error ZeroSeriesRegistry();
    error SeriesRegistryHasNoCode(address dependency);
    error ZeroBenchmarkRegistry();
    error BenchmarkRegistryHasNoCode(address dependency);
    error UnknownSeriesVersion(SeriesId seriesId, uint32 version);
    error SeriesRecordMismatch(SeriesId seriesId, uint32 version);
    error FixingSlotsCommitmentMismatch(bytes32 expected, bytes32 actual);
    error UnknownFixingSlot(uint8 slot);
    error UnknownFixingCandidate(uint8 slot, uint8 candidateIndex);
    error UnknownBenchmarkVersion(BenchmarkId benchmarkId, uint32 version);
    error BenchmarkRecordMismatch(BenchmarkId benchmarkId, uint32 version);
    error UnknownAdapterVersion();
    error AdapterRecordMismatch();
    error UnsupportedAdapterInterface(bytes32 requiredInterfaceHash);
    error AdapterRuntimeMismatch();
    error EvidenceTooLarge(uint256 actual, uint256 maximum);
    error EmptyObservationBatch();
    error ObservationCountOutsideCandidate(uint256 actual, uint16 minimum, uint16 maximum);
    error CandidateObservationLimitUnsupported(uint16 requested, uint16 maximum);
    error ObservationOutsideWindow(uint256 index, uint64 observedAt, uint64 startsAt, uint64 endsAt);
    error ObservationPublishedBeforeObserved(uint256 index, uint64 observedAt, uint64 publishedAt);
    error FutureObservationPublication(uint256 index, uint64 publishedAt, uint256 currentTimestamp);
    error PublicationLagExceeded(uint256 index, uint64 lag, uint32 maximum);
    error ObservationDecimalsMismatch(uint256 index, uint8 expected, uint8 actual);
    error ObservationConfidenceExceeded(uint256 index, uint16 actual, uint16 maximum);
    error InvalidObservationEvidence(uint256 index);
    error ReplayedProviderSequence(uint256 index, uint64 previous, uint64 current);
    error ObservationTimesNotIncreasing(uint256 index, uint64 previous, uint64 current);
    error UnsupportedEvidenceOrigin(EvidenceOriginId originId);
    error InvalidL2StateDuringSequencerOutage(uint256 index);
    error EvidenceNotOutageIndependent();
    error SequencerRecoveryGraceActive(uint256 index, uint64 graceEndsAt, uint256 currentTimestamp);
    error CandidateNotYetAvailable(uint8 candidateIndex, uint64 availableAt, uint256 currentTimestamp);
    error CandidateSubmissionClosed(uint64 deadline, uint256 currentTimestamp);
    error FinalResolutionReached(uint64 finalResolutionAt, uint256 currentTimestamp);
    error FixingAlreadyFinalized(bytes32 fixingKey);
    error CandidateCannotReplaceProposal(uint8 currentCandidate, uint8 suppliedCandidate);
    error FixingDisputedState(bytes32 fixingKey);
    error CorrectionWindowClosed(uint64 correctionCutoffAt, uint256 currentTimestamp);
    error BatchSequenceNotNewer(uint64 previous, uint64 supplied);
    error AdapterCallFailed(bytes4 selector);
    error InvalidAdapterReturn(bytes4 selector, uint256 length);
    error AdapterObservationHashMismatch(bytes32 expected, bytes32 actual);
    error AdapterFeedKeyMismatch(bytes32 expected, bytes32 actual);
    error AdapterCapabilityMismatch(bytes32 expected, bytes32 actual);
    error IncompleteObservationSelection();
    error ZeroAdapterEvidenceCommitment();
    error FixingNotProposed(bytes32 fixingKey);
    error NormalFinalizationNotOpen(uint64 opensAt, uint64 closesAt, uint256 currentTimestamp);
    error TerminalFallbackNotOpen(uint64 finalResolutionAt, uint256 currentTimestamp);
    error IncompleteFixingVector(uint256 expected, uint256 actual);

    function seriesRegistry() external view returns (ISeriesRegistry);
    function benchmarkRegistry() external view returns (IBenchmarkRegistry);
    function submitEvidence(
        SeriesId seriesId,
        uint32 seriesVersion,
        FixingSlot[] calldata fixingSlots,
        uint8 slot,
        uint8 candidateIndex,
        HistoricalObservation[] calldata observations,
        bytes calldata adapterEvidence
    ) external returns (bytes32 fixingKey, bytes32 proposalHash);
    function submitEvidenceVector(
        SeriesId seriesId,
        uint32 seriesVersion,
        FixingSlot[] calldata fixingSlots,
        FixingEvidenceSubmission[] calldata submissions
    ) external returns (bytes32 vectorHash);
    function finalizeFixingVector(SeriesId seriesId, uint32 seriesVersion, FixingSlot[] calldata fixingSlots)
        external
        returns (bytes32 vectorResultHash);
    function applyTerminalFallbackVector(SeriesId seriesId, uint32 seriesVersion, FixingSlot[] calldata fixingSlots)
        external
        returns (bytes32 vectorResultHash);
    function finalizeFixing(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        external
        returns (FixingResult memory result);
    function applyTerminalFallback(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        external
        returns (FixingResult memory result);
    function fixingStatus(SeriesId seriesId, uint32 seriesVersion, uint8 slot) external view returns (FixingStatus);
    function getProposal(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        external
        view
        returns (FixingProposal memory proposal);
    function getFinalizedFixing(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        external
        view
        returns (FixingResult memory result);
    function deriveFixingKey(SeriesId seriesId, uint32 seriesVersion, uint8 slot) external view returns (bytes32);
}
