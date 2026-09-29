// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IFixingObservationAdapterV1} from "../../interfaces/IFixingObservationAdapterV1.sol";
import {ISequencerUptimeFeed} from "../../interfaces/ISequencerUptimeFeed.sol";
import {FixingEvidenceLib} from "../../libraries/FixingEvidenceLib.sol";
import {EvidenceOriginId} from "../../types/Identifiers.sol";
import {
    HistoricalObservation,
    ObservationBatchValidation,
    ObservationValidationContext,
    SequencerEvidence
} from "../../types/FixingTypes.sol";

/// @notice Minimal Chainlink AggregatorV3 surface required for historical fixing evidence.
interface IChainlinkHistoricalFeed {
    function decimals() external view returns (uint8);
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice One canonical evidence item binding a Chainlink round to bound sequencer evidence.
struct ChainlinkHistoricalEvidenceItem {
    uint80 roundId;
    SequencerEvidence sequencer;
}

/// @notice Production Chainlink historical-round fixing observation adapter.
/// @dev Binds one chain, one exact price feed, one feed key, one capability hash, one expected
///      decimal scale, one exact sequencer uptime feed, and one nonzero recovery grace. Evidence
///      is a bounded canonical list of round items corresponding one-for-one, in order, to the
///      HistoricalObservation list the FixingEngine hashes. Each observation is reconstructed from
///      the exact onchain historical round: value is the round answer, weight is fixed to one,
///      confidence is fixed to zero, decimals is the bound feed scale, observedAt and publishedAt
///      are both the round updatedAt, providerSequence is the low 64 bits of the round ID,
///      finalityReference is the round ID as bytes32, and itemEvidenceHash commits the full round
///      payload. L2_STATE observations never accept caller-invented sequencer evidence: every
///      validateObservationBatch call reads the bound sequencer feed latestRoundData, validates it
///      with the exact ChainlinkSequencerHealthAdapter semantics (answer 0/1 only, round ordering,
///      timestamp ordering/future bounds, closed recovery-grace endpoint), deterministically
///      derives the single expected SequencerEvidence and proofHash from the exact sequencer round
///      payload plus chain and grace, and requires every evidence item to equal it exactly. A live
///      down or in-grace feed therefore cannot be forged as healthy; impaired submissions validate
///      here only when they exactly match the derived impaired value and are then rejected
///      downstream by the FixingEngine for L2_STATE.
contract ChainlinkHistoricalRoundFixingAdapter is IFixingObservationAdapterV1 {
    IChainlinkHistoricalFeed public immutable feed;
    uint256 public immutable expectedChainId;
    bytes32 public immutable feedKey;
    bytes32 public immutable capabilityHash;
    uint8 public immutable expectedDecimals;
    ISequencerUptimeFeed public immutable sequencerFeed;
    uint64 public immutable recoveryGracePeriod;

    uint256 public constant MAX_ROUNDS = 16;
    uint256 internal constant EVIDENCE_PREFIX_BYTES = 64;
    uint256 internal constant EVIDENCE_ITEM_BYTES = 160;

    EvidenceOriginId public constant EVIDENCE_ORIGIN =
        EvidenceOriginId.wrap(keccak256("SetrynEvidenceOriginV1:L2_STATE"));

    bytes32 internal constant OBSERVATIONS_TYPEHASH =
        keccak256("SetrynHistoricalObservationsV1(bytes32 observationHashesHash)");

    error WrongDeploymentChain(uint256 expectedChainId, uint256 actualChainId);
    error ZeroFeed();
    error FeedWithoutCode(address feed);
    error ZeroFeedKey();
    error ZeroCapabilityHash();
    error FeedDecimalsMismatch(uint8 expected, uint8 actual);
    error ZeroSequencerFeed();
    error SequencerFeedWithoutCode(address feed);
    error ZeroRecoveryGrace();
    error BindingChainMismatch(uint256 bindingChainId, uint256 actualChainId);
    error FeedKeyMismatch(bytes32 expected, bytes32 actual);
    error CapabilityMismatch(bytes32 expected, bytes32 actual);
    error CandidateDeadlineExpired(uint64 deadline, uint256 timestamp);
    error MalformedEvidenceLength(uint256 actual);
    error EmptyEvidence();
    error TooManyRounds(uint256 actual, uint256 maximum);
    error ZeroRoundId(uint256 index);
    error NonIncreasingRoundId(uint256 index, uint80 previous, uint80 current);
    error SequencerMismatch(uint256 index);
    error RoundIdMismatch(uint256 index, uint80 requested, uint80 returned);
    error AnsweredInRoundMismatch(uint256 index, uint80 roundId, uint80 answeredInRound);
    error NonPositiveAnswer(uint256 index, int256 answer);
    error ZeroFeedTimestamp(uint256 index);
    error FeedTimestampsOutOfOrder(uint256 index, uint256 startedAt, uint256 updatedAt);
    error FutureFeedTimestamp(uint256 index, uint256 startedAt, uint256 updatedAt, uint256 timestamp);
    error FeedTimestampOverflow(uint256 index, uint256 startedAt, uint256 updatedAt);
    error ZeroProviderSequence(uint256 index, uint80 roundId);
    error NonIncreasingProviderSequence(uint256 index, uint64 previous, uint64 current);
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
        address feed_,
        bytes32 feedKey_,
        bytes32 capabilityHash_,
        uint8 expectedDecimals_,
        address sequencerFeed_,
        uint64 recoveryGracePeriod_
    ) {
        if (expectedChainId_ == 0 || expectedChainId_ != block.chainid) {
            revert WrongDeploymentChain(expectedChainId_, block.chainid);
        }
        if (feed_ == address(0)) revert ZeroFeed();
        if (feed_.code.length == 0) revert FeedWithoutCode(feed_);
        if (feedKey_ == bytes32(0)) revert ZeroFeedKey();
        if (capabilityHash_ == bytes32(0)) revert ZeroCapabilityHash();
        if (sequencerFeed_ == address(0)) revert ZeroSequencerFeed();
        if (sequencerFeed_.code.length == 0) revert SequencerFeedWithoutCode(sequencerFeed_);
        if (recoveryGracePeriod_ == 0) revert ZeroRecoveryGrace();
        uint8 liveDecimals = IChainlinkHistoricalFeed(feed_).decimals();
        if (liveDecimals != expectedDecimals_) revert FeedDecimalsMismatch(expectedDecimals_, liveDecimals);
        expectedChainId = expectedChainId_;
        feed = IChainlinkHistoricalFeed(feed_);
        feedKey = feedKey_;
        capabilityHash = capabilityHash_;
        expectedDecimals = expectedDecimals_;
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
        if (feed.decimals() != expectedDecimals) {
            revert FeedDecimalsMismatch(expectedDecimals, feed.decimals());
        }

        if (evidence.length < EVIDENCE_PREFIX_BYTES) revert MalformedEvidenceLength(evidence.length);
        if ((evidence.length - EVIDENCE_PREFIX_BYTES) % EVIDENCE_ITEM_BYTES != 0) {
            revert MalformedEvidenceLength(evidence.length);
        }
        uint256 expectedCount = (evidence.length - EVIDENCE_PREFIX_BYTES) / EVIDENCE_ITEM_BYTES;
        if (expectedCount == 0) revert EmptyEvidence();
        if (expectedCount > MAX_ROUNDS) revert TooManyRounds(expectedCount, MAX_ROUNDS);

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

        ChainlinkHistoricalEvidenceItem[] memory items = abi.decode(evidence, (ChainlinkHistoricalEvidenceItem[]));
        uint256 count = items.length;
        if (count == 0) revert EmptyEvidence();
        if (count > MAX_ROUNDS) revert TooManyRounds(count, MAX_ROUNDS);
        if (count != expectedCount) revert MalformedEvidenceLength(evidence.length);

        bytes32[] memory hashes = new bytes32[](count);
        uint80 previousRoundId;
        uint64 previousSequence;
        uint64 lastUpdatedAt;
        for (uint256 i; i < count; ++i) {
            uint80 roundId = items[i].roundId;
            if (roundId == 0) revert ZeroRoundId(i);
            if (i != 0 && roundId <= previousRoundId) revert NonIncreasingRoundId(i, previousRoundId, roundId);
            SequencerEvidence memory submitted = items[i].sequencer;
            if (
                submitted.sequencerUp != expectedUp || submitted.inRecoveryGrace != expectedInGrace
                    || submitted.recoveryGraceEndsAt != expectedGraceEndsAt || submitted.proofHash != expectedProofHash
            ) revert SequencerMismatch(i);

            (uint80 returnedId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
                feed.getRoundData(roundId);
            if (returnedId != roundId) revert RoundIdMismatch(i, roundId, returnedId);
            if (answeredInRound != roundId) revert AnsweredInRoundMismatch(i, roundId, answeredInRound);
            if (answer <= 0) revert NonPositiveAnswer(i, answer);
            if (startedAt == 0 || updatedAt == 0) revert ZeroFeedTimestamp(i);
            if (updatedAt < startedAt) revert FeedTimestampsOutOfOrder(i, startedAt, updatedAt);
            if (startedAt > block.timestamp || updatedAt > block.timestamp) {
                revert FutureFeedTimestamp(i, startedAt, updatedAt, block.timestamp);
            }
            if (startedAt > type(uint64).max || updatedAt > type(uint64).max) {
                revert FeedTimestampOverflow(i, startedAt, updatedAt);
            }

            uint64 observedAt = uint64(updatedAt);
            uint64 publishedAt = uint64(updatedAt);
            uint64 providerSequence = uint64(roundId);
            if (providerSequence == 0) revert ZeroProviderSequence(i, roundId);
            if (i != 0 && providerSequence <= previousSequence) {
                revert NonIncreasingProviderSequence(i, previousSequence, providerSequence);
            }

            bytes32 itemEvidenceHash = keccak256(
                abi.encode(
                    address(feed),
                    expectedChainId,
                    roundId,
                    answer,
                    startedAt,
                    updatedAt,
                    answeredInRound,
                    expectedDecimals
                )
            );

            HistoricalObservation memory observation = HistoricalObservation({
                value: answer,
                weight: 1,
                observedAt: observedAt,
                publishedAt: publishedAt,
                providerSequence: providerSequence,
                confidenceBps: 0,
                decimals: expectedDecimals,
                finalityReference: bytes32(uint256(roundId)),
                itemEvidenceHash: itemEvidenceHash,
                sequencer: items[i].sequencer
            });
            hashes[i] = FixingEvidenceLib.hashObservation(observation);
            previousRoundId = roundId;
            previousSequence = providerSequence;
            lastUpdatedAt = publishedAt;
        }

        bytes32 observationsHash = keccak256(abi.encode(OBSERVATIONS_TYPEHASH, keccak256(abi.encodePacked(hashes))));
        if (observationsHash != context.observationsHash) {
            revert ObservationHashMismatch(context.observationsHash, observationsHash);
        }

        uint64 batchSequence = lastUpdatedAt;
        bytes32 contextHash = keccak256(abi.encode(context));
        bytes32 evidenceHash = keccak256(
            abi.encode(
                address(feed),
                address(sequencerFeed),
                expectedChainId,
                feedKey,
                capabilityHash,
                expectedDecimals,
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
}
