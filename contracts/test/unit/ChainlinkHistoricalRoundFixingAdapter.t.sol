// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {
    ChainlinkHistoricalEvidenceItem,
    ChainlinkHistoricalRoundFixingAdapter,
    IChainlinkHistoricalFeed
} from "../../src/adapters/oracle/ChainlinkHistoricalRoundFixingAdapter.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {FixingEvidenceLib} from "../../src/libraries/FixingEvidenceLib.sol";
import {BenchmarkId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    HistoricalObservation,
    ObservationBatchValidation,
    ObservationValidationContext,
    SequencerEvidence
} from "../../src/types/FixingTypes.sol";
import {FixingSelectionRuleId} from "../../src/types/SeriesQualification.sol";

contract MockChainlinkHistoricalFeed is IChainlinkHistoricalFeed {
    uint8 public feedDecimals = 8;

    struct StoredRound {
        bool exists;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    mapping(uint80 roundId => StoredRound round) internal _rounds;
    mapping(uint80 requested => uint80 returned_) internal _spoofedReturnId;
    mapping(uint80 requested => bool spoofed) internal _hasSpoof;

    function setDecimals(uint8 value) external {
        feedDecimals = value;
    }

    function decimals() external view returns (uint8) {
        return feedDecimals;
    }

    function setRound(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
        external
    {
        _rounds[roundId] = StoredRound({
            exists: true, answer: answer, startedAt: startedAt, updatedAt: updatedAt, answeredInRound: answeredInRound
        });
    }

    function setSpoofedReturnId(uint80 requested, uint80 returned_) external {
        _spoofedReturnId[requested] = returned_;
        _hasSpoof[requested] = true;
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        StoredRound memory stored = _rounds[roundId];
        if (!stored.exists) return (0, 0, 0, 0, 0);
        uint80 returnedId = _hasSpoof[roundId] ? _spoofedReturnId[roundId] : roundId;
        return (returnedId, stored.answer, stored.startedAt, stored.updatedAt, stored.answeredInRound);
    }
}

contract MockSequencerUptimeFeed is ISequencerUptimeFeed {
    uint80 internal _roundId = 1;
    int256 internal _answer = 0;
    uint256 internal _startedAt;
    uint256 internal _updatedAt;
    uint80 internal _answeredInRound = 1;

    constructor() {
        _startedAt = block.timestamp > 2 hours ? block.timestamp - 2 hours : 1;
        _updatedAt = _startedAt;
    }

    function setRound(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
        external
    {
        _roundId = roundId;
        _answer = answer;
        _startedAt = startedAt;
        _updatedAt = updatedAt;
        _answeredInRound = answeredInRound;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }
}

contract ChainlinkHistoricalRoundFixingAdapterTest is Test {
    bytes32 internal constant FEED_KEY = keccak256("chainlink.eth.usd");
    bytes32 internal constant CAPABILITY_HASH = keccak256("SetrynCapabilityV1:ChainlinkHistoricalRound");
    uint8 internal constant DECIMALS = 8;
    uint64 internal constant GRACE = 1 hours;

    bytes32 internal constant OBSERVATIONS_TYPEHASH =
        keccak256("SetrynHistoricalObservationsV1(bytes32 observationHashesHash)");

    MockChainlinkHistoricalFeed internal feed;
    MockSequencerUptimeFeed internal sequencerFeed;
    ChainlinkHistoricalRoundFixingAdapter internal adapter;

    function setUp() public {
        vm.warp(1_700_000_000);
        feed = new MockChainlinkHistoricalFeed();
        feed.setRound(1, 200_000_000_000, block.timestamp - 300, block.timestamp - 200, 1);
        feed.setRound(2, 200_100_000_000, block.timestamp - 200, block.timestamp - 100, 2);
        feed.setRound(3, 200_200_000_000, block.timestamp - 100, block.timestamp - 10, 3);
        sequencerFeed = new MockSequencerUptimeFeed();
        sequencerFeed.setRound(1, 0, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);
        adapter = new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, address(feed), FEED_KEY, CAPABILITY_HASH, DECIMALS, address(sequencerFeed), GRACE
        );
    }

    function test_SuccessSingleRound() public view {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        bytes memory evidence = abi.encode(items);
        bytes32 observationsHash = _expectedHash(items);
        ObservationValidationContext memory context = _context(observationsHash);

        ObservationBatchValidation memory validation = adapter.validateObservationBatch(context, evidence);

        assertEq(validation.observationsHash, observationsHash);
        assertEq(validation.feedKey, FEED_KEY);
        assertEq(validation.capabilityHash, CAPABILITY_HASH);
        assertTrue(validation.complete);
        assertFalse(validation.outageIndependent);
        assertTrue(validation.batchSequence != 0);
        assertTrue(validation.evidenceHash != bytes32(0));
        assertTrue(validation.completenessHash != bytes32(0));
    }

    function test_SuccessMultipleOrderedRoundsIsDeterministic() public view {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1, 2, 3));
        bytes memory evidence = abi.encode(items);
        bytes32 observationsHash = _expectedHash(items);

        ObservationBatchValidation memory first = adapter.validateObservationBatch(_context(observationsHash), evidence);
        ObservationBatchValidation memory second =
            adapter.validateObservationBatch(_context(observationsHash), evidence);

        assertEq(first.evidenceHash, second.evidenceHash);
        assertEq(first.completenessHash, second.completenessHash);
        assertEq(first.batchSequence, second.batchSequence);
        assertEq(first.batchSequence, uint64(block.timestamp - 10));
    }

    function test_RevertOnSequencerMismatch() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        items[0].sequencer.sequencerUp = false;
        bytes memory evidence = abi.encode(items);
        ObservationValidationContext memory context = _context(_expectedHash(items));
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.SequencerMismatch.selector, uint256(0))
        );
        adapter.validateObservationBatch(context, evidence);

        items = _items(_roundIds(1));
        items[0].sequencer.proofHash = keccak256("forged.proof");
        evidence = abi.encode(items);
        context = _context(_expectedHash(items));
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.SequencerMismatch.selector, uint256(0))
        );
        adapter.validateObservationBatch(context, evidence);

        items = _items(_roundIds(1));
        items[0].sequencer.inRecoveryGrace = true;
        items[0].sequencer.recoveryGraceEndsAt = uint64(block.timestamp + 1 hours);
        evidence = abi.encode(items);
        context = _context(_expectedHash(items));
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.SequencerMismatch.selector, uint256(0))
        );
        adapter.validateObservationBatch(context, evidence);
    }

    function test_SequencerDownRequiresExactImpairedEvidence() public {
        sequencerFeed.setRound(7, 1, block.timestamp - 100, block.timestamp - 50, 7);
        SequencerEvidence memory expected = _expectedSequencer();
        assertFalse(expected.sequencerUp);
        assertFalse(expected.inRecoveryGrace);
        assertEq(expected.recoveryGraceEndsAt, 0);

        ChainlinkHistoricalEvidenceItem[] memory impaired = _items(_roundIds(1));
        bytes memory evidence = abi.encode(impaired);
        bytes32 observationsHash = _expectedHash(impaired);
        ObservationBatchValidation memory validation =
            adapter.validateObservationBatch(_context(observationsHash), evidence);
        assertTrue(validation.complete);
        assertFalse(validation.outageIndependent);

        ChainlinkHistoricalEvidenceItem[] memory forged = _items(_roundIds(1));
        forged[0].sequencer.sequencerUp = true;
        forged[0].sequencer.inRecoveryGrace = false;
        forged[0].sequencer.recoveryGraceEndsAt = 0;
        forged[0].sequencer.proofHash = keccak256("forged.healthy");
        bytes memory forgedEvidence = abi.encode(forged);
        ObservationValidationContext memory forgedContext = _context(_expectedHash(forged));
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.SequencerMismatch.selector, uint256(0))
        );
        adapter.validateObservationBatch(forgedContext, forgedEvidence);
    }

    function test_SequencerGraceEndpointIsClosed() public {
        uint64 graceEndsAt = uint64(block.timestamp + 100);
        uint64 startedAt = graceEndsAt - GRACE;
        sequencerFeed.setRound(5, 0, startedAt, startedAt, 5);

        vm.warp(graceEndsAt);
        SequencerEvidence memory atEndpoint = _expectedSequencer();
        assertTrue(atEndpoint.sequencerUp);
        assertTrue(atEndpoint.inRecoveryGrace);
        assertEq(atEndpoint.recoveryGraceEndsAt, graceEndsAt);
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        ObservationBatchValidation memory validation =
            adapter.validateObservationBatch(_context(_expectedHash(items)), abi.encode(items));
        assertTrue(validation.complete);

        vm.warp(graceEndsAt + 1);
        SequencerEvidence memory afterEndpoint = _expectedSequencer();
        assertTrue(afterEndpoint.sequencerUp);
        assertFalse(afterEndpoint.inRecoveryGrace);
        items = _items(_roundIds(1));
        validation = adapter.validateObservationBatch(_context(_expectedHash(items)), abi.encode(items));
        assertTrue(validation.complete);

        vm.warp(graceEndsAt);
        ChainlinkHistoricalEvidenceItem[] memory stale = _items(_roundIds(1));
        bytes32 staleHash = _expectedHash(stale);
        ObservationValidationContext memory staleContext = _context(staleHash);
        bytes memory staleEvidence = abi.encode(stale);
        vm.warp(graceEndsAt + 1);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.SequencerMismatch.selector, uint256(0))
        );
        adapter.validateObservationBatch(staleContext, staleEvidence);
    }

    function test_RevertOnMalformedEvidenceLength() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        bytes memory evidence = abi.encode(items);
        ObservationValidationContext memory context = _context(_expectedHash(items));

        bytes memory truncated = new bytes(evidence.length - 1);
        for (uint256 i; i < truncated.length; ++i) {
            truncated[i] = evidence[i];
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.MalformedEvidenceLength.selector, truncated.length
            )
        );
        adapter.validateObservationBatch(context, truncated);

        bytes memory oversized = bytes.concat(evidence, bytes1(0x00));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.MalformedEvidenceLength.selector, oversized.length
            )
        );
        adapter.validateObservationBatch(context, oversized);

        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.MalformedEvidenceLength.selector, uint256(0))
        );
        adapter.validateObservationBatch(context, new bytes(0));

        bytes memory short = new bytes(32);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.MalformedEvidenceLength.selector, short.length)
        );
        adapter.validateObservationBatch(context, short);
    }

    function test_ContextBindingCoversFullContext() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        bytes memory evidence = abi.encode(items);
        bytes32 observationsHash = _expectedHash(items);

        ObservationBatchValidation memory base = adapter.validateObservationBatch(_context(observationsHash), evidence);

        ObservationValidationContext memory modified = _context(observationsHash);
        modified.fixingEngine = makeAddr("other-engine");
        ObservationBatchValidation memory changed = adapter.validateObservationBatch(modified, evidence);
        assertTrue(changed.evidenceHash != base.evidenceHash);
        assertTrue(changed.completenessHash != base.completenessHash);

        modified = _context(observationsHash);
        modified.benchmarkVersionHash = keccak256("other.benchmark.version");
        changed = adapter.validateObservationBatch(modified, evidence);
        assertTrue(changed.evidenceHash != base.evidenceHash);
        assertTrue(changed.completenessHash != base.completenessHash);

        modified = _context(observationsHash);
        modified.selectionParametersHash = keccak256("other.selection");
        changed = adapter.validateObservationBatch(modified, evidence);
        assertTrue(changed.evidenceHash != base.evidenceHash);
        assertTrue(changed.completenessHash != base.completenessHash);
    }

    function test_RevertOnSequencerFeedValidation() public {
        sequencerFeed.setRound(0, 0, block.timestamp - 10, block.timestamp - 5, 0);
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        bytes memory evidence = abi.encode(items);
        ObservationValidationContext memory context = _context(bytes32(uint256(1)));
        vm.expectRevert(ChainlinkHistoricalRoundFixingAdapter.SequencerMalformedRoundData.selector);
        adapter.validateObservationBatch(context, evidence);

        sequencerFeed.setRound(5, 2, block.timestamp - 10, block.timestamp - 5, 5);
        items = _items(_roundIds(1));
        evidence = abi.encode(items);
        context = _context(bytes32(uint256(1)));
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.SequencerUnsupportedAnswer.selector, int256(2))
        );
        adapter.validateObservationBatch(context, evidence);

        sequencerFeed.setRound(5, 0, block.timestamp - 10, block.timestamp - 5, 4);
        items = _items(_roundIds(1));
        evidence = abi.encode(items);
        context = _context(bytes32(uint256(1)));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.SequencerInconsistentRoundIds.selector, uint80(5), uint80(4)
            )
        );
        adapter.validateObservationBatch(context, evidence);
    }

    function test_RevertWhenChainMismatch() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        bytes32 observationsHash = _expectedHash(items);
        ObservationValidationContext memory context = _context(observationsHash);
        context.chainId = block.chainid + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.BindingChainMismatch.selector, context.chainId, block.chainid
            )
        );
        adapter.validateObservationBatch(context, abi.encode(items));
    }

    function test_RevertWhenFeedKeyMismatch() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        ObservationValidationContext memory context = _context(_expectedHash(items));
        context.feedKey = keccak256("wrong.feed");
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.FeedKeyMismatch.selector, FEED_KEY, context.feedKey
            )
        );
        adapter.validateObservationBatch(context, abi.encode(items));
    }

    function test_RevertWhenCapabilityMismatch() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        ObservationValidationContext memory context = _context(_expectedHash(items));
        context.requiredCapabilityHash = keccak256("wrong.capability");
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.CapabilityMismatch.selector,
                CAPABILITY_HASH,
                context.requiredCapabilityHash
            )
        );
        adapter.validateObservationBatch(context, abi.encode(items));
    }

    function test_RevertWhenPastDeadline() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        ObservationValidationContext memory context = _context(_expectedHash(items));
        context.candidateDeadline = uint64(block.timestamp - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.CandidateDeadlineExpired.selector,
                context.candidateDeadline,
                block.timestamp
            )
        );
        adapter.validateObservationBatch(context, abi.encode(items));
    }

    function test_RevertOnEmptyAndOversizedBatches() public {
        ObservationValidationContext memory context = _context(bytes32(uint256(1)));
        vm.expectRevert(ChainlinkHistoricalRoundFixingAdapter.EmptyEvidence.selector);
        adapter.validateObservationBatch(context, abi.encode(new ChainlinkHistoricalEvidenceItem[](0)));

        uint256 tooMany = adapter.MAX_ROUNDS() + 1;
        ChainlinkHistoricalEvidenceItem[] memory items = new ChainlinkHistoricalEvidenceItem[](tooMany);
        SequencerEvidence memory expected = _expectedSequencer();
        for (uint256 i; i < tooMany; ++i) {
            items[i] = ChainlinkHistoricalEvidenceItem({roundId: uint80(i + 1), sequencer: expected});
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.TooManyRounds.selector, tooMany, adapter.MAX_ROUNDS()
            )
        );
        adapter.validateObservationBatch(context, abi.encode(items));
    }

    function test_RevertOnDuplicateAndNonIncreasingRounds() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(2, 2));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.NonIncreasingRoundId.selector, uint256(1), uint80(2), uint80(2)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));

        items = _items(_roundIds(2, 1));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.NonIncreasingRoundId.selector, uint256(1), uint80(2), uint80(1)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));
    }

    function test_RevertOnStaleCachedSubstitution() public {
        feed.setSpoofedReturnId(1, 99);
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.RoundIdMismatch.selector, uint256(0), uint80(1), uint80(99)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));
    }

    function test_RevertOnAnsweredInRoundMismatch() public {
        feed.setRound(9, 200_000_000_000, block.timestamp - 300, block.timestamp - 200, 8);
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(9));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.AnsweredInRoundMismatch.selector, uint256(0), uint80(9), uint80(8)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));
    }

    function test_RevertOnNonPositiveAnswer() public {
        feed.setRound(10, 0, block.timestamp - 300, block.timestamp - 200, 10);
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(10));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.NonPositiveAnswer.selector, uint256(0), int256(0)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));

        feed.setRound(11, -5, block.timestamp - 300, block.timestamp - 200, 11);
        items = _items(_roundIds(11));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.NonPositiveAnswer.selector, uint256(0), int256(-5)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));
    }

    function test_RevertOnMalformedTimestamps() public {
        feed.setRound(20, 100, 0, block.timestamp - 10, 20);
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(20));
        bytes memory evidence = abi.encode(items);
        ObservationValidationContext memory context = _context(bytes32(uint256(1)));
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.ZeroFeedTimestamp.selector, uint256(0))
        );
        adapter.validateObservationBatch(context, evidence);

        feed.setRound(21, 100, block.timestamp - 10, block.timestamp - 20, 21);
        items = _items(_roundIds(21));
        evidence = abi.encode(items);
        context = _context(bytes32(uint256(1)));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.FeedTimestampsOutOfOrder.selector,
                uint256(0),
                block.timestamp - 10,
                block.timestamp - 20
            )
        );
        adapter.validateObservationBatch(context, evidence);

        feed.setRound(22, 100, block.timestamp + 1, block.timestamp + 1, 22);
        items = _items(_roundIds(22));
        evidence = abi.encode(items);
        context = _context(bytes32(uint256(1)));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.FutureFeedTimestamp.selector,
                uint256(0),
                block.timestamp + 1,
                block.timestamp + 1,
                block.timestamp
            )
        );
        adapter.validateObservationBatch(context, evidence);
    }

    function test_RevertWhenFeedDecimalsDrift() public {
        feed.setDecimals(18);
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.FeedDecimalsMismatch.selector, DECIMALS, uint8(18)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));
    }

    function test_RevertOnObservationsHashMismatchCoversValueAndConventions() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(1));
        bytes32 correct = _expectedHash(items);

        HistoricalObservation[] memory wrong = _expectedObservations(items);
        wrong[0].value += 1;
        bytes32 wrongHash = _hashObservations(wrong);
        assertTrue(wrongHash != correct);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.ObservationHashMismatch.selector, wrongHash, correct
            )
        );
        adapter.validateObservationBatch(_context(wrongHash), abi.encode(items));

        wrong = _expectedObservations(items);
        wrong[0].weight = 0;
        wrongHash = _hashObservations(wrong);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.ObservationHashMismatch.selector, wrongHash, correct
            )
        );
        adapter.validateObservationBatch(_context(wrongHash), abi.encode(items));

        wrong = _expectedObservations(items);
        wrong[0].confidenceBps = 10;
        wrongHash = _hashObservations(wrong);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.ObservationHashMismatch.selector, wrongHash, correct
            )
        );
        adapter.validateObservationBatch(_context(wrongHash), abi.encode(items));

        wrong = _expectedObservations(items);
        wrong[0].itemEvidenceHash = keccak256("tampered");
        wrongHash = _hashObservations(wrong);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.ObservationHashMismatch.selector, wrongHash, correct
            )
        );
        adapter.validateObservationBatch(_context(wrongHash), abi.encode(items));
    }

    function test_RevertOnMissingRoundMapsToMalformedResponse() public {
        ChainlinkHistoricalEvidenceItem[] memory items = _items(_roundIds(77));
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.RoundIdMismatch.selector, uint256(0), uint80(77), uint80(0)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));
    }

    function test_ConstructorRejectsInvalidBindings() public {
        vm.expectRevert(ChainlinkHistoricalRoundFixingAdapter.ZeroFeed.selector);
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, address(0), FEED_KEY, CAPABILITY_HASH, DECIMALS, address(sequencerFeed), GRACE
        );

        address codeless = makeAddr("codeless-feed");
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkHistoricalRoundFixingAdapter.FeedWithoutCode.selector, codeless)
        );
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, codeless, FEED_KEY, CAPABILITY_HASH, DECIMALS, address(sequencerFeed), GRACE
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.WrongDeploymentChain.selector, block.chainid + 1, block.chainid
            )
        );
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid + 1, address(feed), FEED_KEY, CAPABILITY_HASH, DECIMALS, address(sequencerFeed), GRACE
        );

        vm.expectRevert(ChainlinkHistoricalRoundFixingAdapter.ZeroFeedKey.selector);
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, address(feed), bytes32(0), CAPABILITY_HASH, DECIMALS, address(sequencerFeed), GRACE
        );

        vm.expectRevert(ChainlinkHistoricalRoundFixingAdapter.ZeroCapabilityHash.selector);
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, address(feed), FEED_KEY, bytes32(0), DECIMALS, address(sequencerFeed), GRACE
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.FeedDecimalsMismatch.selector, uint8(18), DECIMALS
            )
        );
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, address(feed), FEED_KEY, CAPABILITY_HASH, 18, address(sequencerFeed), GRACE
        );

        vm.expectRevert(ChainlinkHistoricalRoundFixingAdapter.ZeroSequencerFeed.selector);
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, address(feed), FEED_KEY, CAPABILITY_HASH, DECIMALS, address(0), GRACE
        );

        address codelessSequencer = makeAddr("codeless-sequencer");
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkHistoricalRoundFixingAdapter.SequencerFeedWithoutCode.selector, codelessSequencer
            )
        );
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, address(feed), FEED_KEY, CAPABILITY_HASH, DECIMALS, codelessSequencer, GRACE
        );

        vm.expectRevert(ChainlinkHistoricalRoundFixingAdapter.ZeroRecoveryGrace.selector);
        new ChainlinkHistoricalRoundFixingAdapter(
            block.chainid, address(feed), FEED_KEY, CAPABILITY_HASH, DECIMALS, address(sequencerFeed), 0
        );
    }

    function _roundIds(uint80 single) internal pure returns (uint80[] memory ids) {
        ids = new uint80[](1);
        ids[0] = single;
    }

    function _roundIds(uint80 first, uint80 second, uint80 third) internal pure returns (uint80[] memory ids) {
        ids = new uint80[](3);
        ids[0] = first;
        ids[1] = second;
        ids[2] = third;
    }

    function _roundIds(uint80 first, uint80 second) internal pure returns (uint80[] memory ids) {
        ids = new uint80[](2);
        ids[0] = first;
        ids[1] = second;
    }

    function _items(uint80[] memory ids) internal view returns (ChainlinkHistoricalEvidenceItem[] memory items) {
        items = new ChainlinkHistoricalEvidenceItem[](ids.length);
        SequencerEvidence memory expected = _expectedSequencer();
        for (uint256 i; i < ids.length; ++i) {
            items[i] = ChainlinkHistoricalEvidenceItem({roundId: ids[i], sequencer: expected});
        }
    }

    function _expectedSequencer() internal view returns (SequencerEvidence memory) {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            sequencerFeed.latestRoundData();
        bool up = answer == 0;
        bool inGrace;
        uint64 endsAt;
        if (up) {
            endsAt = uint64(startedAt) + GRACE;
            inGrace = block.timestamp <= endsAt;
        }
        bytes32 proofHash = keccak256(
            abi.encode(
                address(sequencerFeed), block.chainid, roundId, answer, startedAt, updatedAt, answeredInRound, GRACE
            )
        );
        return SequencerEvidence({
            sequencerUp: up, inRecoveryGrace: inGrace, recoveryGraceEndsAt: endsAt, proofHash: proofHash
        });
    }

    function _context(bytes32 observationsHash) internal view returns (ObservationValidationContext memory) {
        return ObservationValidationContext({
            chainId: block.chainid,
            fixingEngine: address(this),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            slot: 0,
            candidateIndex: 0,
            benchmarkId: BenchmarkId.wrap(keccak256("benchmark")),
            benchmarkVersion: 1,
            benchmarkVersionHash: keccak256("benchmark.version"),
            feedKey: FEED_KEY,
            requiredCapabilityHash: CAPABILITY_HASH,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            selectionParametersHash: keccak256("selection"),
            observationsHash: observationsHash,
            candidateDeadline: uint64(block.timestamp + 1 hours)
        });
    }

    function _expectedHash(ChainlinkHistoricalEvidenceItem[] memory items) internal view returns (bytes32) {
        return _hashObservations(_expectedObservations(items));
    }

    function _expectedObservations(ChainlinkHistoricalEvidenceItem[] memory items)
        internal
        view
        returns (HistoricalObservation[] memory observations)
    {
        observations = new HistoricalObservation[](items.length);
        for (uint256 i; i < items.length; ++i) {
            (, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
                feed.getRoundData(items[i].roundId);
            bytes32 itemEvidenceHash = keccak256(
                abi.encode(
                    address(feed),
                    block.chainid,
                    items[i].roundId,
                    answer,
                    startedAt,
                    updatedAt,
                    answeredInRound,
                    DECIMALS
                )
            );
            observations[i] = HistoricalObservation({
                value: answer,
                weight: 1,
                observedAt: uint64(updatedAt),
                publishedAt: uint64(updatedAt),
                providerSequence: uint64(items[i].roundId),
                confidenceBps: 0,
                decimals: DECIMALS,
                finalityReference: bytes32(uint256(items[i].roundId)),
                itemEvidenceHash: itemEvidenceHash,
                sequencer: items[i].sequencer
            });
        }
    }

    function _hashObservations(HistoricalObservation[] memory observations) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](observations.length);
        for (uint256 i; i < observations.length; ++i) {
            hashes[i] = FixingEvidenceLib.hashObservation(observations[i]);
        }
        return keccak256(abi.encode(OBSERVATIONS_TYPEHASH, keccak256(abi.encodePacked(hashes))));
    }
}
