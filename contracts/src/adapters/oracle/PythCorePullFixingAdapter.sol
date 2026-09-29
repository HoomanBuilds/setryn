// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IFixingObservationAdapterV1} from "../../interfaces/IFixingObservationAdapterV1.sol";
import {ISequencerUptimeFeed} from "../../interfaces/ISequencerUptimeFeed.sol";
import {FixingEvidenceLib} from "../../libraries/FixingEvidenceLib.sol";
import {DecimalScaleLib} from "../../libraries/DecimalScaleLib.sol";
import {FixedPointLib} from "../../libraries/FixedPointLib.sol";
import {EvidenceOriginId} from "../../types/Identifiers.sol";
import {BPS_DENOMINATOR, MAX_DECIMALS} from "../../types/Units.sol";
import {
    HistoricalObservation,
    ObservationBatchValidation,
    ObservationValidationContext,
    SequencerEvidence
} from "../../types/FixingTypes.sol";
import {IPythCoreReceiver, PythVerifiedRecord} from "./PythCorePullUpdateStore.sol";

/// @notice Minimal store surface consumed by the Pyth fixing adapter.
interface IPythPullUpdateStore {
    function expectedChainId() external view returns (uint256);
    function pythReceiver() external view returns (IPythCoreReceiver);
    function getRecord(bytes32 feedId, uint64 publishTime) external view returns (PythVerifiedRecord memory);
}

/// @notice One canonical evidence item binding a verified Pyth publish time to sequencer evidence.
struct PythCorePullEvidenceItem {
    uint64 publishTime;
    SequencerEvidence sequencer;
}

/// @notice View-only Pyth Core pull fixing adapter bound to one store, feed, and sequencer.
/// @dev Evidence is a bounded canonical list of verified publish times with exact sequencer
///      evidence, ordered strictly increasingly, corresponding one-for-one to the
///      HistoricalObservation list the FixingEngine hashes. Each observation is reconstructed
///      from the immutable store record: value is safely scaled from the Pyth
///      exponent to the bound output decimals, confidence is scaled conservatively
///      upward so uncertainty is never understated, confidence bps is derived with
///      full-precision ceiling division without overflow and
///      bounded by the configured maximum, weight is fixed to one, observedAt/publishedAt and
///      providerSequence are the verified publish time, finality commits the feed ID plus
///      publish time, and itemEvidenceHash commits store, receiver, chain, feed, raw fields,
///      window, payload hash, and output scale. Sequencer evidence is authenticated exactly
///      like the Chainlink historical adapter: the bound feed latestRoundData is validated and
///      every item must equal the derived expected value.
contract PythCorePullFixingAdapter is IFixingObservationAdapterV1 {
    IPythPullUpdateStore public immutable store;
    IPythCoreReceiver public immutable pythReceiver;
    uint256 public immutable expectedChainId;
    bytes32 public immutable feedId;
    bytes32 public immutable feedKey;
    bytes32 public immutable capabilityHash;
    uint8 public immutable outputDecimals;
    uint16 public immutable maxConfidenceBps;
    ISequencerUptimeFeed public immutable sequencerFeed;
    uint64 public immutable recoveryGracePeriod;

    uint256 public constant MAX_OBSERVATIONS = 16;
    uint256 internal constant EVIDENCE_PREFIX_BYTES = 64;
    uint256 internal constant EVIDENCE_ITEM_BYTES = 160;

    int32 internal constant MIN_EXPO = -36;
    int32 internal constant MAX_EXPO = 36;

    EvidenceOriginId public constant EVIDENCE_ORIGIN =
        EvidenceOriginId.wrap(keccak256("SetrynEvidenceOriginV1:L2_STATE"));

    bytes32 internal constant OBSERVATIONS_TYPEHASH =
        keccak256("SetrynHistoricalObservationsV1(bytes32 observationHashesHash)");

    error WrongDeploymentChain(uint256 expectedChainId, uint256 actualChainId);
    error ZeroStore();
    error StoreWithoutCode(address store);
    error StoreChainMismatch(uint256 expectedChainId, uint256 storeChainId);
    error ZeroPythReceiver();
    error ReceiverWithoutCode(address receiver);
    error ReceiverMismatch(address expected, address actual);
    error ZeroFeedId();
    error ZeroFeedKey();
    error ZeroCapabilityHash();
    error OutputDecimalsOutOfRange(uint8 decimals);
    error MaxConfidenceBpsOutOfRange(uint16 maximum);
    error ZeroSequencerFeed();
    error SequencerFeedWithoutCode(address feed);
    error ZeroRecoveryGrace();
    error BindingChainMismatch(uint256 bindingChainId, uint256 actualChainId);
    error FeedKeyMismatch(bytes32 expected, bytes32 actual);
    error CapabilityMismatch(bytes32 expected, bytes32 actual);
    error CandidateDeadlineExpired(uint64 deadline, uint256 timestamp);
    error MalformedEvidenceLength(uint256 actual);
    error EmptyEvidence();
    error TooManyObservations(uint256 actual, uint256 maximum);
    error ZeroPublishTime(uint256 index);
    error NonIncreasingPublishTime(uint256 index, uint64 previous, uint64 current);
    error SequencerMismatch(uint256 index);
    error StaleOrUnverifiedRecord(uint256 index, uint64 publishTime);
    error FuturePublishTime(uint256 index, uint256 publishTime, uint256 timestamp);
    error ExpoOutOfBounds(uint256 index, int32 expo);
    error NonPositiveScaledPrice(uint256 index, int256 scaled);
    error ConfidenceBpsOverflow(uint256 index, uint256 confidenceBps);
    error ConfidenceExceedsMaximum(uint256 index, uint256 confidenceBps, uint16 maximum);
    error ObservationHashMismatch(bytes32 expected, bytes32 actual);
    error ZeroEvidenceCommitment();
    error SequencerMalformedRoundData();
    error SequencerInconsistentRoundIds(uint80 roundId, uint80 answeredInRound);
    error SequencerUnsupportedAnswer(int256 answer);
    error SequencerZeroTimestamp();
    error SequencerFutureTimestamp(uint256 startedAt, uint256 updatedAt, uint256 timestamp);
    error SequencerTimestampOverflow(uint256 value);
    error SequencerRecoveryGraceOverflow(uint64 startedAt, uint64 grace);

    constructor(
        uint256 expectedChainId_,
        address store_,
        bytes32 feedId_,
        bytes32 feedKey_,
        bytes32 capabilityHash_,
        uint8 outputDecimals_,
        uint16 maxConfidenceBps_,
        address sequencerFeed_,
        uint64 recoveryGracePeriod_
    ) {
        if (expectedChainId_ == 0 || expectedChainId_ != block.chainid) {
            revert WrongDeploymentChain(expectedChainId_, block.chainid);
        }
        if (store_ == address(0)) revert ZeroStore();
        if (store_.code.length == 0) revert StoreWithoutCode(store_);
        uint256 storeChain = IPythPullUpdateStore(store_).expectedChainId();
        if (storeChain != expectedChainId_) revert StoreChainMismatch(expectedChainId_, storeChain);
        IPythCoreReceiver receiver = IPythPullUpdateStore(store_).pythReceiver();
        if (address(receiver) == address(0)) revert ZeroPythReceiver();
        if (address(receiver).code.length == 0) revert ReceiverWithoutCode(address(receiver));
        if (feedId_ == bytes32(0)) revert ZeroFeedId();
        if (feedKey_ == bytes32(0)) revert ZeroFeedKey();
        if (capabilityHash_ == bytes32(0)) revert ZeroCapabilityHash();
        if (outputDecimals_ > MAX_DECIMALS) revert OutputDecimalsOutOfRange(outputDecimals_);
        if (maxConfidenceBps_ > BPS_DENOMINATOR) revert MaxConfidenceBpsOutOfRange(maxConfidenceBps_);
        if (sequencerFeed_ == address(0)) revert ZeroSequencerFeed();
        if (sequencerFeed_.code.length == 0) revert SequencerFeedWithoutCode(sequencerFeed_);
        if (recoveryGracePeriod_ == 0) revert ZeroRecoveryGrace();

        expectedChainId = expectedChainId_;
        store = IPythPullUpdateStore(store_);
        pythReceiver = receiver;
        feedId = feedId_;
        feedKey = feedKey_;
        capabilityHash = capabilityHash_;
        outputDecimals = outputDecimals_;
        maxConfidenceBps = maxConfidenceBps_;
        sequencerFeed = ISequencerUptimeFeed(sequencerFeed_);
        recoveryGracePeriod = recoveryGracePeriod_;
    }

    function validateObservationBatch(ObservationValidationContext calldata context, bytes calldata evidence)
        external
        view
        returns (ObservationBatchValidation memory validation)
    {
        if (context.chainId != block.chainid) revert BindingChainMismatch(context.chainId, block.chainid);
        if (block.chainid != expectedChainId) revert WrongDeploymentChain(expectedChainId, block.chainid);
        if (context.feedKey != feedKey) revert FeedKeyMismatch(feedKey, context.feedKey);
        if (context.requiredCapabilityHash != capabilityHash) {
            revert CapabilityMismatch(capabilityHash, context.requiredCapabilityHash);
        }
        if (block.timestamp > context.candidateDeadline) {
            revert CandidateDeadlineExpired(context.candidateDeadline, block.timestamp);
        }
        if (address(store.pythReceiver()) != address(pythReceiver)) {
            revert ReceiverMismatch(address(pythReceiver), address(store.pythReceiver()));
        }

        if (evidence.length < EVIDENCE_PREFIX_BYTES) revert MalformedEvidenceLength(evidence.length);
        if ((evidence.length - EVIDENCE_PREFIX_BYTES) % EVIDENCE_ITEM_BYTES != 0) {
            revert MalformedEvidenceLength(evidence.length);
        }
        uint256 expectedCount = (evidence.length - EVIDENCE_PREFIX_BYTES) / EVIDENCE_ITEM_BYTES;
        if (expectedCount == 0) revert EmptyEvidence();
        if (expectedCount > MAX_OBSERVATIONS) revert TooManyObservations(expectedCount, MAX_OBSERVATIONS);

        (uint80 seqRoundId, int256 seqAnswer, uint256 seqStartedAt, uint256 seqUpdatedAt, uint80 seqAnsweredInRound) =
            sequencerFeed.latestRoundData();
        if (seqRoundId == 0 || seqAnsweredInRound == 0) revert SequencerMalformedRoundData();
        if (seqAnsweredInRound < seqRoundId) revert SequencerInconsistentRoundIds(seqRoundId, seqAnsweredInRound);
        if (seqAnswer != 0 && seqAnswer != 1) revert SequencerUnsupportedAnswer(seqAnswer);
        if (seqStartedAt == 0 || seqUpdatedAt == 0) revert SequencerZeroTimestamp();
        if (seqUpdatedAt < seqStartedAt) revert SequencerMalformedRoundData();
        if (seqStartedAt > block.timestamp || seqUpdatedAt > block.timestamp) {
            revert SequencerFutureTimestamp(seqStartedAt, seqUpdatedAt, block.timestamp);
        }
        if (seqStartedAt > type(uint64).max || seqUpdatedAt > type(uint64).max || block.timestamp > type(uint64).max) {
            revert SequencerTimestampOverflow(block.timestamp);
        }

        bool expectedUp = seqAnswer == 0;
        bool expectedInGrace;
        uint64 expectedGraceEndsAt;
        if (expectedUp) {
            uint64 seqStartedAt64 = uint64(seqStartedAt);
            if (uint256(seqStartedAt64) + uint256(recoveryGracePeriod) > type(uint64).max) {
                revert SequencerRecoveryGraceOverflow(seqStartedAt64, recoveryGracePeriod);
            }
            expectedGraceEndsAt = seqStartedAt64 + recoveryGracePeriod;
            expectedInGrace = block.timestamp <= expectedGraceEndsAt;
        }
        bytes32 expectedProofHash = keccak256(
            abi.encode(
                address(sequencerFeed),
                expectedChainId,
                seqRoundId,
                seqAnswer,
                seqStartedAt,
                seqUpdatedAt,
                seqAnsweredInRound,
                recoveryGracePeriod
            )
        );

        PythCorePullEvidenceItem[] memory items = abi.decode(evidence, (PythCorePullEvidenceItem[]));
        uint256 count = items.length;
        if (count == 0) revert EmptyEvidence();
        if (count > MAX_OBSERVATIONS) revert TooManyObservations(count, MAX_OBSERVATIONS);
        if (count != expectedCount) revert MalformedEvidenceLength(evidence.length);

        bytes32[] memory hashes = new bytes32[](count);
        uint64 previousPublishTime;
        uint64 lastPublishTime;
        for (uint256 i; i < count; ++i) {
            uint64 publishTime = items[i].publishTime;
            if (publishTime == 0) revert ZeroPublishTime(i);
            if (i != 0 && publishTime <= previousPublishTime) {
                revert NonIncreasingPublishTime(i, previousPublishTime, publishTime);
            }
            SequencerEvidence memory submitted = items[i].sequencer;
            if (
                submitted.sequencerUp != expectedUp || submitted.inRecoveryGrace != expectedInGrace
                    || submitted.recoveryGraceEndsAt != expectedGraceEndsAt || submitted.proofHash != expectedProofHash
            ) revert SequencerMismatch(i);

            PythVerifiedRecord memory record = store.getRecord(feedId, publishTime);
            if (record.publishTime == 0 || record.publishTime != publishTime || record.updateHash == bytes32(0)) {
                revert StaleOrUnverifiedRecord(i, publishTime);
            }
            if (publishTime > block.timestamp) revert FuturePublishTime(i, publishTime, block.timestamp);
            if (record.expo < MIN_EXPO || record.expo > MAX_EXPO) revert ExpoOutOfBounds(i, record.expo);

            int256 scaledPrice = _scalePrice(record.price, record.expo, outputDecimals);
            if (scaledPrice <= 0) revert NonPositiveScaledPrice(i, scaledPrice);
            uint256 scaledConf = _scaleConf(record.conf, record.expo, outputDecimals);
            uint256 confidenceBps = FixedPointLib.mulDivUp(scaledConf, BPS_DENOMINATOR, uint256(scaledPrice));
            if (confidenceBps > type(uint16).max) revert ConfidenceBpsOverflow(i, confidenceBps);
            if (confidenceBps > maxConfidenceBps) {
                revert ConfidenceExceedsMaximum(i, confidenceBps, maxConfidenceBps);
            }

            bytes32 itemEvidenceHash = keccak256(
                abi.encode(
                    address(store),
                    address(pythReceiver),
                    expectedChainId,
                    feedId,
                    record.price,
                    record.conf,
                    record.expo,
                    publishTime,
                    record.minPublishTime,
                    record.maxPublishTime,
                    record.updateHash,
                    outputDecimals
                )
            );
            bytes32 finalityReference = keccak256(abi.encode(feedId, publishTime));

            HistoricalObservation memory observation = HistoricalObservation({
                value: scaledPrice,
                weight: 1,
                observedAt: publishTime,
                publishedAt: publishTime,
                providerSequence: publishTime,
                confidenceBps: uint16(confidenceBps),
                decimals: outputDecimals,
                finalityReference: finalityReference,
                itemEvidenceHash: itemEvidenceHash,
                sequencer: items[i].sequencer
            });
            hashes[i] = FixingEvidenceLib.hashObservation(observation);
            previousPublishTime = publishTime;
            lastPublishTime = publishTime;
        }

        bytes32 observationsHash = keccak256(abi.encode(OBSERVATIONS_TYPEHASH, keccak256(abi.encodePacked(hashes))));
        if (observationsHash != context.observationsHash) {
            revert ObservationHashMismatch(context.observationsHash, observationsHash);
        }

        uint64 batchSequence = lastPublishTime;
        bytes32 contextHash = keccak256(abi.encode(context));
        bytes32 evidenceHash = keccak256(
            abi.encode(
                address(store),
                address(pythReceiver),
                address(sequencerFeed),
                expectedChainId,
                feedId,
                feedKey,
                capabilityHash,
                outputDecimals,
                maxConfidenceBps,
                recoveryGracePeriod,
                seqRoundId,
                seqAnswer,
                seqStartedAt,
                seqUpdatedAt,
                seqAnsweredInRound,
                keccak256(evidence),
                observationsHash,
                contextHash
            )
        );
        bytes32 completenessHash = keccak256(abi.encode(evidenceHash, observationsHash, contextHash, batchSequence));
        if (evidenceHash == bytes32(0) || completenessHash == bytes32(0) || batchSequence == 0) {
            revert ZeroEvidenceCommitment();
        }

        validation = ObservationBatchValidation({
            observationsHash: observationsHash,
            evidenceOriginId: EVIDENCE_ORIGIN,
            feedKey: feedKey,
            capabilityHash: capabilityHash,
            completenessHash: completenessHash,
            evidenceHash: evidenceHash,
            batchSequence: batchSequence,
            complete: true,
            outageIndependent: false
        });
    }

    function _scalePrice(int64 raw, int32 expo, uint8 outDecimals) internal pure returns (int256) {
        if (expo < 0) {
            uint8 fromDecimals = uint8(uint32(-expo));
            return DecimalScaleLib.rescaleSignedFloor(int256(raw), fromDecimals, outDecimals);
        }
        uint256 sum = uint256(uint32(expo)) + uint256(outDecimals);
        if (sum > MAX_DECIMALS) revert ExpoOutOfBounds(0, expo);
        return DecimalScaleLib.rescaleSignedFloor(int256(raw), 0, uint8(sum));
    }

    function _scaleConf(uint64 raw, int32 expo, uint8 outDecimals) internal pure returns (uint256) {
        if (expo < 0) {
            uint8 fromDecimals = uint8(uint32(-expo));
            return DecimalScaleLib.rescaleUp(uint256(raw), fromDecimals, outDecimals);
        }
        uint256 sum = uint256(uint32(expo)) + uint256(outDecimals);
        if (sum > MAX_DECIMALS) revert ExpoOutOfBounds(0, expo);
        return DecimalScaleLib.rescaleUp(uint256(raw), 0, uint8(sum));
    }
}
