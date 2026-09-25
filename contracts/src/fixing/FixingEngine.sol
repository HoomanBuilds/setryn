// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IBenchmarkRegistry} from "../interfaces/IBenchmarkRegistry.sol";
import {IFixingEngine} from "../interfaces/IFixingEngine.sol";
import {IFixingObservationAdapterV1} from "../interfaces/IFixingObservationAdapterV1.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {AdapterDefinitionLib} from "../libraries/AdapterDefinitionLib.sol";
import {BenchmarkDefinitionLib} from "../libraries/BenchmarkDefinitionLib.sol";
import {FixingAggregationLib} from "../libraries/FixingAggregationLib.sol";
import {FixingEvidenceLib} from "../libraries/FixingEvidenceLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {BenchmarkVersion} from "../types/BenchmarkDefinition.sol";
import {
    FixingProposal,
    FixingEvidenceSubmission,
    FixingResolutionKind,
    FixingResult,
    FixingStatus,
    HistoricalObservation,
    ObservationBatchValidation,
    ObservationValidationContext
} from "../types/FixingTypes.sol";
import {AdapterId, AdapterKindId, BenchmarkId, EvidenceOriginId, SeriesId} from "../types/Identifiers.sol";
import {SeriesDefinition, SeriesVersion} from "../types/SeriesDefinition.sol";
import {FixingCandidate, FixingSelectionRuleId, FixingSlot} from "../types/SeriesQualification.sol";

struct FixingDependencies {
    SeriesDefinition series;
    FixingCandidate candidate;
    BenchmarkVersion benchmark;
    AdapterVersion adapter;
    uint64 candidateDeadline;
}

contract FixingEngine is IFixingEngine {
    uint16 internal constant MAX_FIXING_SLOTS = 16;
    uint16 internal constant MAX_ENGINE_OBSERVATIONS = 256;
    uint16 internal constant MAX_MEDIAN_OBSERVATIONS = 64;
    uint256 internal constant MAX_EVIDENCE_BYTES = 16_384;
    uint256 internal constant ADAPTER_RETURN_BYTES = 9 * 32;
    uint256 internal constant MAX_ADAPTER_VALIDATION_GAS = 500_000;

    bytes32 public constant FIXING_ADAPTER_INTERFACE_HASH =
        keccak256("SetrynFixingObservationAdapterV1.validateObservationBatch");

    EvidenceOriginId public constant EVIDENCE_ORIGIN_L2_STATE =
        EvidenceOriginId.wrap(keccak256("SetrynEvidenceOriginV1:L2_STATE"));
    EvidenceOriginId public constant EVIDENCE_ORIGIN_EXTERNAL_SIGNED =
        EvidenceOriginId.wrap(keccak256("SetrynEvidenceOriginV1:EXTERNAL_SIGNED"));
    EvidenceOriginId public constant EVIDENCE_ORIGIN_L1_FINALIZED =
        EvidenceOriginId.wrap(keccak256("SetrynEvidenceOriginV1:L1_FINALIZED"));

    ISeriesRegistry private immutable _seriesRegistry;
    IBenchmarkRegistry private immutable _benchmarkRegistry;

    mapping(bytes32 fixingKey => FixingStatus status) private _status;
    mapping(bytes32 fixingKey => FixingProposal proposal) private _proposals;
    mapping(bytes32 fixingKey => FixingResult result) private _results;
    mapping(bytes32 vectorKey => uint16 slotCount) private _vectorSlotCount;

    constructor(ISeriesRegistry seriesRegistry_) {
        if (address(seriesRegistry_) == address(0)) revert ZeroSeriesRegistry();
        if (address(seriesRegistry_).code.length == 0) {
            revert SeriesRegistryHasNoCode(address(seriesRegistry_));
        }
        IMarketRegistry markets = seriesRegistry_.marketRegistry();
        IBenchmarkRegistry benchmarks = markets.benchmarkRegistry();
        if (address(benchmarks) == address(0)) revert ZeroBenchmarkRegistry();
        if (address(benchmarks).code.length == 0) {
            revert BenchmarkRegistryHasNoCode(address(benchmarks));
        }
        _seriesRegistry = seriesRegistry_;
        _benchmarkRegistry = benchmarks;
    }

    function submitEvidence(
        SeriesId seriesId,
        uint32 seriesVersion,
        FixingSlot[] calldata fixingSlots,
        uint8 slot,
        uint8 candidateIndex,
        HistoricalObservation[] calldata observations,
        bytes calldata adapterEvidence
    ) external returns (bytes32 fixingKey, bytes32 proposalHash) {
        if (fixingSlots.length != 1) {
            revert IncompleteFixingVector(fixingSlots.length, 1);
        }
        return
            _submitEvidence(seriesId, seriesVersion, fixingSlots, slot, candidateIndex, observations, adapterEvidence);
    }

    function submitEvidenceVector(
        SeriesId seriesId,
        uint32 seriesVersion,
        FixingSlot[] calldata fixingSlots,
        FixingEvidenceSubmission[] calldata submissions
    ) external returns (bytes32 vectorHash) {
        uint256 count = fixingSlots.length;
        if (count == 0 || submissions.length != count) revert IncompleteFixingVector(count, submissions.length);
        bytes32[] memory proposalHashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            FixingEvidenceSubmission calldata submission = submissions[i];
            if (submission.slot != i) revert UnknownFixingSlot(submission.slot);
            (, proposalHashes[i]) = _submitEvidence(
                seriesId,
                seriesVersion,
                fixingSlots,
                submission.slot,
                submission.candidateIndex,
                submission.observations,
                submission.adapterEvidence
            );
        }
        vectorHash = keccak256(abi.encode(seriesId, seriesVersion, proposalHashes));
    }

    function _submitEvidence(
        SeriesId seriesId,
        uint32 seriesVersion,
        FixingSlot[] calldata fixingSlots,
        uint8 slot,
        uint8 candidateIndex,
        HistoricalObservation[] calldata observations,
        bytes calldata adapterEvidence
    ) private returns (bytes32 fixingKey, bytes32 proposalHash) {
        bytes32 vectorKey = _deriveVectorKey(seriesId, seriesVersion);
        uint16 recordedCount = _vectorSlotCount[vectorKey];
        if (recordedCount == 0) {
            _vectorSlotCount[vectorKey] = uint16(fixingSlots.length);
        } else if (recordedCount != fixingSlots.length) {
            revert IncompleteFixingVector(recordedCount, fixingSlots.length);
        }
        fixingKey = _deriveFixingKey(seriesId, seriesVersion, slot);
        FixingStatus currentStatus = _status[fixingKey];
        if (currentStatus == FixingStatus.Finalized) revert FixingAlreadyFinalized(fixingKey);

        FixingDependencies memory dependencies =
            _loadDependencies(seriesId, seriesVersion, fixingSlots, slot, candidateIndex);
        _requireSubmissionWindow(
            dependencies.series,
            fixingSlots[slot],
            candidateIndex,
            dependencies.candidateDeadline,
            currentStatus != FixingStatus.Unspecified
        );

        FixingProposal storage currentProposal = _proposals[fixingKey];
        if (currentStatus == FixingStatus.Proposed || currentStatus == FixingStatus.Disputed) {
            if (candidateIndex > currentProposal.candidateIndex) {
                revert CandidateCannotReplaceProposal(currentProposal.candidateIndex, candidateIndex);
            }
        }

        if (adapterEvidence.length > MAX_EVIDENCE_BYTES) {
            revert EvidenceTooLarge(adapterEvidence.length, MAX_EVIDENCE_BYTES);
        }
        bytes32 observationsHash = FixingEvidenceLib.hashObservations(observations);
        ObservationBatchValidation memory validation = _validateWithAdapter(
            seriesId, seriesVersion, slot, candidateIndex, dependencies, observationsHash, adapterEvidence
        );
        (uint64 firstObservedAt, uint64 lastObservedAt, uint64 latestPublishedAt) =
            _validateObservations(dependencies, observations, validation);
        int256 value = FixingAggregationLib.aggregate(dependencies.candidate, observations);

        FixingProposal memory proposal = FixingProposal({
            proposalHash: bytes32(0),
            observationsHash: observationsHash,
            evidenceHash: validation.evidenceHash,
            completenessHash: validation.completenessHash,
            evidenceOriginId: validation.evidenceOriginId,
            adapterId: dependencies.benchmark.definition.adapterId,
            adapterVersion: dependencies.benchmark.definition.adapterVersion,
            batchSequence: validation.batchSequence,
            candidateDeadline: dependencies.candidateDeadline,
            firstObservedAt: firstObservedAt,
            lastObservedAt: lastObservedAt,
            latestPublishedAt: latestPublishedAt,
            observationCount: uint16(observations.length),
            candidateIndex: candidateIndex,
            decimals: dependencies.benchmark.definition.outputDecimals,
            value: value
        });
        proposalHash = FixingEvidenceLib.hashProposal(fixingKey, proposal);
        proposal.proposalHash = proposalHash;
        if (
            (currentStatus == FixingStatus.Proposed || currentStatus == FixingStatus.Disputed)
                && candidateIndex == currentProposal.candidateIndex
        ) {
            if (validation.batchSequence < currentProposal.batchSequence) {
                revert BatchSequenceNotNewer(currentProposal.batchSequence, validation.batchSequence);
            }
            if (validation.batchSequence == currentProposal.batchSequence) {
                if (proposalHash == currentProposal.proposalHash) return (fixingKey, proposalHash);
                _status[fixingKey] = FixingStatus.Disputed;
                emit FixingDisputed(
                    fixingKey,
                    seriesId,
                    seriesVersion,
                    slot,
                    currentProposal.proposalHash,
                    proposalHash,
                    validation.batchSequence,
                    msg.sender
                );
                return (fixingKey, proposalHash);
            }
        }
        _proposals[fixingKey] = proposal;
        _status[fixingKey] = FixingStatus.Proposed;

        emit FixingEvidenceProposed(
            fixingKey,
            seriesId,
            seriesVersion,
            slot,
            candidateIndex,
            dependencies.candidate.benchmarkId,
            dependencies.candidate.benchmarkVersion,
            validation.evidenceOriginId,
            validation.batchSequence,
            observationsHash,
            validation.evidenceHash,
            validation.completenessHash,
            proposalHash,
            value,
            dependencies.benchmark.definition.outputDecimals,
            msg.sender
        );
    }

    function finalizeFixing(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        external
        returns (FixingResult memory result)
    {
        uint16 count = _vectorSlotCount[_deriveVectorKey(seriesId, seriesVersion)];
        if (count != 1 || slot != 0) revert IncompleteFixingVector(count, 1);
        return _finalizeFixing(seriesId, seriesVersion, slot);
    }

    function finalizeFixingVector(SeriesId seriesId, uint32 seriesVersion, FixingSlot[] calldata fixingSlots)
        external
        returns (bytes32 vectorResultHash)
    {
        uint256 count = fixingSlots.length;
        uint16 recordedCount = _vectorSlotCount[_deriveVectorKey(seriesId, seriesVersion)];
        if (count == 0 || recordedCount != count) revert IncompleteFixingVector(recordedCount, count);
        SeriesVersion memory series = _requireSeries(seriesId, seriesVersion);
        bytes32 actualSlotsHash = SeriesDefinitionLib.hashFixingSlots(series.definition, fixingSlots, MAX_FIXING_SLOTS);
        if (actualSlotsHash != series.definition.fixingSlotsHash) {
            revert FixingSlotsCommitmentMismatch(series.definition.fixingSlotsHash, actualSlotsHash);
        }
        bytes32[] memory resultHashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            if (fixingSlots[i].slot != i) revert UnknownFixingSlot(fixingSlots[i].slot);
            resultHashes[i] = _finalizeFixing(seriesId, seriesVersion, uint8(i)).resultHash;
        }
        vectorResultHash = keccak256(abi.encode(seriesId, seriesVersion, resultHashes));
    }

    function _finalizeFixing(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        private
        returns (FixingResult memory result)
    {
        bytes32 fixingKey = _deriveFixingKey(seriesId, seriesVersion, slot);
        FixingStatus currentStatus = _status[fixingKey];
        if (currentStatus == FixingStatus.Finalized) revert FixingAlreadyFinalized(fixingKey);
        if (currentStatus == FixingStatus.Disputed) revert FixingDisputedState(fixingKey);
        if (currentStatus != FixingStatus.Proposed) revert FixingNotProposed(fixingKey);

        SeriesVersion memory series = _requireSeries(seriesId, seriesVersion);
        if (
            block.timestamp < series.definition.correctionCutoffAt
                || block.timestamp >= series.definition.finalResolutionAt
        ) {
            revert NormalFinalizationNotOpen(
                series.definition.correctionCutoffAt, series.definition.finalResolutionAt, block.timestamp
            );
        }

        FixingProposal memory proposal = _proposals[fixingKey];
        FixingResolutionKind kind =
            proposal.candidateIndex == 0 ? FixingResolutionKind.PrimaryFinal : FixingResolutionKind.FallbackFinal;
        result = FixingResult({
            resultHash: bytes32(0),
            proposalHash: proposal.proposalHash,
            resolutionKind: kind,
            effectiveAt: series.definition.correctionCutoffAt,
            finalizedAt: uint64(block.timestamp),
            finalizedBlock: uint64(block.number),
            candidateIndex: proposal.candidateIndex,
            decimals: proposal.decimals,
            value: proposal.value,
            terminalDisruptionTransferMinorPerLot: 0
        });
        _storeFinalResult(fixingKey, seriesId, seriesVersion, slot, result);
        return _results[fixingKey];
    }

    function applyTerminalFallback(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        external
        returns (FixingResult memory result)
    {
        uint16 count = _vectorSlotCount[_deriveVectorKey(seriesId, seriesVersion)];
        if (count != 0 && (count != 1 || slot != 0)) revert IncompleteFixingVector(count, 1);
        return _applyTerminalFallback(seriesId, seriesVersion, slot);
    }

    function applyTerminalFallbackVector(SeriesId seriesId, uint32 seriesVersion, FixingSlot[] calldata fixingSlots)
        external
        returns (bytes32 vectorResultHash)
    {
        uint256 count = fixingSlots.length;
        if (count == 0) revert IncompleteFixingVector(1, 0);
        SeriesVersion memory series = _requireSeries(seriesId, seriesVersion);
        bytes32 actualSlotsHash = SeriesDefinitionLib.hashFixingSlots(series.definition, fixingSlots, MAX_FIXING_SLOTS);
        if (actualSlotsHash != series.definition.fixingSlotsHash) {
            revert FixingSlotsCommitmentMismatch(series.definition.fixingSlotsHash, actualSlotsHash);
        }
        bytes32 vectorKey = _deriveVectorKey(seriesId, seriesVersion);
        uint16 recordedCount = _vectorSlotCount[vectorKey];
        if (recordedCount != 0 && recordedCount != count) revert IncompleteFixingVector(recordedCount, count);
        if (recordedCount == 0) _vectorSlotCount[vectorKey] = uint16(count);
        bytes32[] memory resultHashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            if (fixingSlots[i].slot != i) revert UnknownFixingSlot(fixingSlots[i].slot);
            resultHashes[i] = _applyTerminalFallback(seriesId, seriesVersion, uint8(i)).resultHash;
        }
        vectorResultHash = keccak256(abi.encode(seriesId, seriesVersion, resultHashes));
    }

    function _applyTerminalFallback(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        private
        returns (FixingResult memory result)
    {
        bytes32 fixingKey = _deriveFixingKey(seriesId, seriesVersion, slot);
        if (_status[fixingKey] == FixingStatus.Finalized) revert FixingAlreadyFinalized(fixingKey);
        SeriesVersion memory series = _requireSeries(seriesId, seriesVersion);
        if (block.timestamp < series.definition.finalResolutionAt) {
            revert TerminalFallbackNotOpen(series.definition.finalResolutionAt, block.timestamp);
        }

        result = FixingResult({
            resultHash: bytes32(0),
            proposalHash: bytes32(0),
            resolutionKind: FixingResolutionKind.TerminalDisruption,
            effectiveAt: series.definition.finalResolutionAt,
            finalizedAt: uint64(block.timestamp),
            finalizedBlock: uint64(block.number),
            candidateIndex: type(uint8).max,
            decimals: 0,
            value: 0,
            terminalDisruptionTransferMinorPerLot: series.definition.terminalDisruptionTransferMinorPerLot
        });
        _storeFinalResult(fixingKey, seriesId, seriesVersion, slot, result);
        return _results[fixingKey];
    }

    function seriesRegistry() external view returns (ISeriesRegistry) {
        return _seriesRegistry;
    }

    function benchmarkRegistry() external view returns (IBenchmarkRegistry) {
        return _benchmarkRegistry;
    }

    function fixingStatus(SeriesId seriesId, uint32 seriesVersion, uint8 slot) external view returns (FixingStatus) {
        return _status[_deriveFixingKey(seriesId, seriesVersion, slot)];
    }

    function getProposal(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        external
        view
        returns (FixingProposal memory proposal)
    {
        return _proposals[_deriveFixingKey(seriesId, seriesVersion, slot)];
    }

    function getFinalizedFixing(SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        external
        view
        returns (FixingResult memory result)
    {
        return _results[_deriveFixingKey(seriesId, seriesVersion, slot)];
    }

    function deriveFixingKey(SeriesId seriesId, uint32 seriesVersion, uint8 slot) external view returns (bytes32) {
        return _deriveFixingKey(seriesId, seriesVersion, slot);
    }

    function _loadDependencies(
        SeriesId seriesId,
        uint32 seriesVersion,
        FixingSlot[] calldata fixingSlots,
        uint8 slot,
        uint8 candidateIndex
    ) private view returns (FixingDependencies memory dependencies) {
        SeriesVersion memory series = _requireSeries(seriesId, seriesVersion);
        bytes32 actualSlotsHash = SeriesDefinitionLib.hashFixingSlots(series.definition, fixingSlots, MAX_FIXING_SLOTS);
        if (actualSlotsHash != series.definition.fixingSlotsHash) {
            revert FixingSlotsCommitmentMismatch(series.definition.fixingSlotsHash, actualSlotsHash);
        }
        if (slot >= fixingSlots.length || fixingSlots[slot].slot != slot) revert UnknownFixingSlot(slot);
        if (candidateIndex >= fixingSlots[slot].candidates.length) {
            revert UnknownFixingCandidate(slot, candidateIndex);
        }
        FixingCandidate memory candidate = fixingSlots[slot].candidates[candidateIndex];
        uint16 supportedMaximum = FixingSelectionRuleId.unwrap(candidate.selectionRuleId)
            == FixingSelectionRuleId.unwrap(SeriesDefinitionLib.FIXING_SELECTION_MEDIAN)
            ? MAX_MEDIAN_OBSERVATIONS
            : MAX_ENGINE_OBSERVATIONS;
        if (candidate.maximumObservations > supportedMaximum) {
            revert CandidateObservationLimitUnsupported(candidate.maximumObservations, supportedMaximum);
        }
        BenchmarkVersion memory benchmark = _requireBenchmark(candidate.benchmarkId, candidate.benchmarkVersion);
        AdapterVersion memory adapter = _requireAdapter(benchmark);
        uint64 deadline = candidateIndex == 0 && series.definition.primaryEvidenceDeadline < candidate.unavailableAfter
            ? series.definition.primaryEvidenceDeadline
            : candidate.unavailableAfter;
        return FixingDependencies({
            series: series.definition,
            candidate: candidate,
            benchmark: benchmark,
            adapter: adapter,
            candidateDeadline: deadline
        });
    }

    function _validateWithAdapter(
        SeriesId seriesId,
        uint32 seriesVersion,
        uint8 slot,
        uint8 candidateIndex,
        FixingDependencies memory dependencies,
        bytes32 observationsHash,
        bytes calldata adapterEvidence
    ) private view returns (ObservationBatchValidation memory validation) {
        ObservationValidationContext memory context = ObservationValidationContext({
            chainId: block.chainid,
            fixingEngine: address(this),
            seriesId: seriesId,
            seriesVersion: seriesVersion,
            slot: slot,
            candidateIndex: candidateIndex,
            benchmarkId: dependencies.candidate.benchmarkId,
            benchmarkVersion: dependencies.candidate.benchmarkVersion,
            benchmarkVersionHash: dependencies.benchmark.versionHash,
            feedKey: dependencies.benchmark.definition.feedKey,
            requiredCapabilityHash: dependencies.benchmark.definition.requiredCapabilityHash,
            selectionRuleId: dependencies.candidate.selectionRuleId,
            selectionParametersHash: dependencies.candidate.selectionParametersHash,
            observationsHash: observationsHash,
            candidateDeadline: dependencies.candidateDeadline
        });
        bytes memory payload =
            abi.encodeCall(IFixingObservationAdapterV1.validateObservationBatch, (context, adapterEvidence));
        bytes memory returnData = _boundedStaticcall(
            dependencies.adapter.definition.implementation,
            IFixingObservationAdapterV1.validateObservationBatch.selector,
            payload,
            ADAPTER_RETURN_BYTES
        );
        validation = abi.decode(returnData, (ObservationBatchValidation));
        if (validation.observationsHash != observationsHash) {
            revert AdapterObservationHashMismatch(observationsHash, validation.observationsHash);
        }
        if (validation.feedKey != dependencies.benchmark.definition.feedKey) {
            revert AdapterFeedKeyMismatch(dependencies.benchmark.definition.feedKey, validation.feedKey);
        }
        if (validation.capabilityHash != dependencies.benchmark.definition.requiredCapabilityHash) {
            revert AdapterCapabilityMismatch(
                dependencies.benchmark.definition.requiredCapabilityHash, validation.capabilityHash
            );
        }
        if (!validation.complete || validation.completenessHash == bytes32(0)) {
            revert IncompleteObservationSelection();
        }
        if (validation.evidenceHash == bytes32(0) || validation.batchSequence == 0) {
            revert ZeroAdapterEvidenceCommitment();
        }
    }

    function _validateObservations(
        FixingDependencies memory dependencies,
        HistoricalObservation[] calldata observations,
        ObservationBatchValidation memory validation
    ) private view returns (uint64 firstObservedAt, uint64 lastObservedAt, uint64 latestPublishedAt) {
        uint256 count = observations.length;
        if (count == 0) revert EmptyObservationBatch();
        if (count < dependencies.candidate.minimumObservations || count > dependencies.candidate.maximumObservations) {
            revert ObservationCountOutsideCandidate(
                count, dependencies.candidate.minimumObservations, dependencies.candidate.maximumObservations
            );
        }
        _requireSupportedOrigin(validation.evidenceOriginId);

        uint64 previousObservedAt;
        uint64 previousSequence;
        for (uint256 i; i < count; ++i) {
            HistoricalObservation calldata observation = observations[i];
            if (
                observation.observedAt < dependencies.candidate.windowStartsAt
                    || observation.observedAt >= dependencies.candidate.windowEndsAt
            ) {
                revert ObservationOutsideWindow(
                    i,
                    observation.observedAt,
                    dependencies.candidate.windowStartsAt,
                    dependencies.candidate.windowEndsAt
                );
            }
            if (observation.publishedAt < observation.observedAt) {
                revert ObservationPublishedBeforeObserved(i, observation.observedAt, observation.publishedAt);
            }
            if (observation.publishedAt > block.timestamp) {
                revert FutureObservationPublication(i, observation.publishedAt, block.timestamp);
            }
            uint64 publicationLag = observation.publishedAt - observation.observedAt;
            if (publicationLag > dependencies.candidate.maxPublicationLagSeconds) {
                revert PublicationLagExceeded(i, publicationLag, dependencies.candidate.maxPublicationLagSeconds);
            }
            if (observation.decimals != dependencies.benchmark.definition.outputDecimals) {
                revert ObservationDecimalsMismatch(
                    i, dependencies.benchmark.definition.outputDecimals, observation.decimals
                );
            }
            if (observation.confidenceBps > dependencies.benchmark.definition.maxConfidenceBps) {
                revert ObservationConfidenceExceeded(
                    i, observation.confidenceBps, dependencies.benchmark.definition.maxConfidenceBps
                );
            }
            if (
                observation.providerSequence == 0 || observation.finalityReference == bytes32(0)
                    || observation.itemEvidenceHash == bytes32(0) || observation.sequencer.proofHash == bytes32(0)
            ) revert InvalidObservationEvidence(i);
            if (i != 0) {
                if (observation.observedAt <= previousObservedAt) {
                    revert ObservationTimesNotIncreasing(i, previousObservedAt, observation.observedAt);
                }
                if (observation.providerSequence <= previousSequence) {
                    revert ReplayedProviderSequence(i, previousSequence, observation.providerSequence);
                }
            }
            _validateSequencer(i, observation, validation);
            previousObservedAt = observation.observedAt;
            previousSequence = observation.providerSequence;
            if (observation.publishedAt > latestPublishedAt) latestPublishedAt = observation.publishedAt;
        }
        firstObservedAt = observations[0].observedAt;
        lastObservedAt = observations[count - 1].observedAt;
    }

    function _validateSequencer(
        uint256 index,
        HistoricalObservation calldata observation,
        ObservationBatchValidation memory validation
    ) private view {
        bool impaired = !observation.sequencer.sequencerUp || observation.sequencer.inRecoveryGrace;
        if (EvidenceOriginId.unwrap(validation.evidenceOriginId) == EvidenceOriginId.unwrap(EVIDENCE_ORIGIN_L2_STATE)) {
            if (impaired) revert InvalidL2StateDuringSequencerOutage(index);
            return;
        }
        if (!impaired) return;
        if (!validation.outageIndependent) revert EvidenceNotOutageIndependent();
        if (block.timestamp < observation.sequencer.recoveryGraceEndsAt) {
            revert SequencerRecoveryGraceActive(index, observation.sequencer.recoveryGraceEndsAt, block.timestamp);
        }
    }

    function _requireSubmissionWindow(
        SeriesDefinition memory series,
        FixingSlot calldata slot,
        uint8 candidateIndex,
        uint64 deadline,
        bool correction
    ) private view {
        if (block.timestamp >= series.correctionCutoffAt) {
            revert CorrectionWindowClosed(series.correctionCutoffAt, block.timestamp);
        }
        if (block.timestamp >= series.finalResolutionAt) {
            revert FinalResolutionReached(series.finalResolutionAt, block.timestamp);
        }
        if (candidateIndex != 0) {
            uint64 availableAt = slot.candidates[candidateIndex - 1].unavailableAfter;
            if (block.timestamp < availableAt) {
                revert CandidateNotYetAvailable(candidateIndex, availableAt, block.timestamp);
            }
        }
        if (!correction && block.timestamp > deadline) revert CandidateSubmissionClosed(deadline, block.timestamp);
    }

    function _requireSeries(SeriesId seriesId, uint32 seriesVersion)
        private
        view
        returns (SeriesVersion memory series)
    {
        if (!_seriesRegistry.isLifecycleEnabled(seriesId, seriesVersion)) {
            revert UnknownSeriesVersion(seriesId, seriesVersion);
        }
        series = _seriesRegistry.getSeries(seriesId, seriesVersion);
        if (
            series.version != seriesVersion
                || SeriesId.unwrap(SeriesDefinitionLib.deriveSeriesId(series.definition)) != SeriesId.unwrap(seriesId)
                || series.definitionHash != SeriesDefinitionLib.hashDefinition(series.definition, block.chainid)
                || series.versionHash
                    != SeriesDefinitionLib.hashVersion(seriesId, seriesVersion, series.definitionHash, block.chainid)
        ) revert SeriesRecordMismatch(seriesId, seriesVersion);
    }

    function _requireBenchmark(BenchmarkId benchmarkId, uint32 benchmarkVersion)
        private
        view
        returns (BenchmarkVersion memory benchmark)
    {
        if (!_benchmarkRegistry.isLifecycleEnabled(benchmarkId, benchmarkVersion)) {
            revert UnknownBenchmarkVersion(benchmarkId, benchmarkVersion);
        }
        benchmark = _benchmarkRegistry.getBenchmark(benchmarkId, benchmarkVersion);
        if (
            benchmark.version != benchmarkVersion
                || BenchmarkId.unwrap(BenchmarkDefinitionLib.deriveBenchmarkId(benchmark.definition))
                    != BenchmarkId.unwrap(benchmarkId)
                || benchmark.definitionHash
                    != BenchmarkDefinitionLib.hashDefinition(benchmark.definition, block.chainid)
                || benchmark.versionHash
                    != BenchmarkDefinitionLib.hashVersion(
                        benchmarkId, benchmarkVersion, benchmark.definitionHash, block.chainid
                    )
        ) revert BenchmarkRecordMismatch(benchmarkId, benchmarkVersion);
    }

    function _requireAdapter(BenchmarkVersion memory benchmark) private view returns (AdapterVersion memory adapter) {
        if (benchmark.definition.requiredInterfaceHash != FIXING_ADAPTER_INTERFACE_HASH) {
            revert UnsupportedAdapterInterface(benchmark.definition.requiredInterfaceHash);
        }
        IAdapterRegistry adapters = _benchmarkRegistry.adapterRegistry();
        AdapterId adapterId = benchmark.definition.adapterId;
        uint32 adapterVersion = benchmark.definition.adapterVersion;
        if (!adapters.isLifecycleEnabled(adapterId, adapterVersion)) revert UnknownAdapterVersion();
        adapter = adapters.getAdapter(adapterId, adapterVersion);
        if (
            adapter.version != adapterVersion
                || AdapterId.unwrap(AdapterDefinitionLib.deriveAdapterId(adapter.definition))
                    != AdapterId.unwrap(adapterId)
                || adapter.definitionHash != AdapterDefinitionLib.hashDefinition(adapter.definition, block.chainid)
                || adapter.versionHash
                    != AdapterDefinitionLib.hashVersion(
                        adapterId, adapterVersion, adapter.definitionHash, block.chainid
                    )
                || AdapterKindId.unwrap(adapter.definition.kindId)
                    != AdapterKindId.unwrap(AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK)
                || adapter.definition.interfaceHash != benchmark.definition.requiredInterfaceHash
                || adapter.definition.capabilityHash != benchmark.definition.requiredCapabilityHash
        ) revert AdapterRecordMismatch();
        if (!adapters.runtimeMatches(adapterId, adapterVersion)) revert AdapterRuntimeMismatch();
    }

    function _boundedStaticcall(address implementation, bytes4 selector, bytes memory payload, uint256 expectedLength)
        private
        view
        returns (bytes memory returnData)
    {
        bool success;
        uint256 returnLength;
        uint256 gasLimit = MAX_ADAPTER_VALIDATION_GAS;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, implementation, add(payload, 0x20), mload(payload), 0, 0)
            returnLength := returndatasize()
        }
        if (!success) revert AdapterCallFailed(selector);
        if (returnLength != expectedLength) revert InvalidAdapterReturn(selector, returnLength);
        returnData = new bytes(returnLength);
        assembly ("memory-safe") {
            returndatacopy(add(returnData, 0x20), 0, returnLength)
        }
    }

    function _storeFinalResult(
        bytes32 fixingKey,
        SeriesId seriesId,
        uint32 seriesVersion,
        uint8 slot,
        FixingResult memory result
    ) private {
        result.resultHash = FixingEvidenceLib.hashResult(fixingKey, result);
        _results[fixingKey] = result;
        _status[fixingKey] = FixingStatus.Finalized;
        emit FixingFinalized(
            fixingKey,
            seriesId,
            seriesVersion,
            slot,
            result.resolutionKind,
            result.proposalHash,
            result.resultHash,
            result.value,
            result.decimals,
            result.terminalDisruptionTransferMinorPerLot,
            result.effectiveAt,
            msg.sender
        );
    }

    function _requireSupportedOrigin(EvidenceOriginId originId) private pure {
        bytes32 raw = EvidenceOriginId.unwrap(originId);
        if (
            raw != EvidenceOriginId.unwrap(EVIDENCE_ORIGIN_L2_STATE)
                && raw != EvidenceOriginId.unwrap(EVIDENCE_ORIGIN_EXTERNAL_SIGNED)
                && raw != EvidenceOriginId.unwrap(EVIDENCE_ORIGIN_L1_FINALIZED)
        ) revert UnsupportedEvidenceOrigin(originId);
    }

    function _deriveFixingKey(SeriesId seriesId, uint32 seriesVersion, uint8 slot) private view returns (bytes32) {
        return FixingEvidenceLib.deriveFixingKey(block.chainid, address(this), seriesId, seriesVersion, slot);
    }

    function _deriveVectorKey(SeriesId seriesId, uint32 seriesVersion) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), seriesId, seriesVersion));
    }
}
