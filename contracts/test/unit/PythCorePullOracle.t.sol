// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {
    IPythCoreReceiver,
    Price,
    PriceFeed,
    PythCorePullUpdateStore,
    PythVerifiedRecord
} from "../../src/adapters/oracle/PythCorePullUpdateStore.sol";
import {
    PythCorePullEvidenceItem,
    PythCorePullFixingAdapter
} from "../../src/adapters/oracle/PythCorePullFixingAdapter.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {FixingEvidenceLib} from "../../src/libraries/FixingEvidenceLib.sol";
import {DecimalScaleLib} from "../../src/libraries/DecimalScaleLib.sol";
import {FixedPointLib} from "../../src/libraries/FixedPointLib.sol";
import {BPS_DENOMINATOR} from "../../src/types/Units.sol";
import {BenchmarkId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    HistoricalObservation,
    ObservationBatchValidation,
    ObservationValidationContext,
    SequencerEvidence
} from "../../src/types/FixingTypes.sol";
import {FixingSelectionRuleId} from "../../src/types/SeriesQualification.sol";

contract MockPythCoreReceiver is IPythCoreReceiver {
    uint256 internal _fee;
    PriceFeed[] internal _feeds;
    Price internal _spot;
    bool internal _hasSpot;

    function setFee(uint256 fee) external {
        _fee = fee;
    }

    function setSingleFeed(bytes32 feedId, int64 price, uint64 conf, int32 expo, uint256 publishTime) external {
        delete _feeds;
        Price memory p = Price({price: price, conf: conf, expo: expo, publishTime: publishTime});
        _feeds.push(PriceFeed({id: feedId, price: p, emaPrice: p}));
        _spot = p;
        _hasSpot = true;
    }

    function setFeeds(PriceFeed[] memory feeds) external {
        delete _feeds;
        for (uint256 i; i < feeds.length; ++i) {
            _feeds.push(feeds[i]);
        }
    }

    function clearFeeds() external {
        delete _feeds;
    }

    function setSpot(Price memory spot) external {
        _spot = spot;
        _hasSpot = true;
    }

    function getUpdateFee(bytes[] calldata) external view returns (uint256) {
        return _fee;
    }

    function parsePriceFeedUpdatesUnique(bytes[] calldata, bytes32[] calldata, uint64, uint64)
        external
        payable
        returns (PriceFeed[] memory)
    {
        PriceFeed[] memory out = new PriceFeed[](_feeds.length);
        for (uint256 i; i < _feeds.length; ++i) {
            out[i] = _feeds[i];
        }
        return out;
    }

    function getPriceNoOlderThan(bytes32, uint256) external view returns (Price memory) {
        require(_hasSpot, "no spot");
        return _spot;
    }
}

contract MockPythSequencerFeed is ISequencerUptimeFeed {
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

contract PythCorePullOracleTest is Test {
    bytes32 internal constant FEED_ID = keccak256("pyth.eth.usd.price-id");
    bytes32 internal constant FEED_KEY = keccak256("pyth.eth.usd");
    bytes32 internal constant CAPABILITY_HASH = keccak256("SetrynCapabilityV1:PythCorePull");
    uint8 internal constant OUTPUT_DECIMALS = 8;
    uint16 internal constant MAX_CONF_BPS = 100;
    uint64 internal constant GRACE = 1 hours;

    bytes32 internal constant OBSERVATIONS_TYPEHASH =
        keccak256("SetrynHistoricalObservationsV1(bytes32 observationHashesHash)");

    MockPythCoreReceiver internal receiver;
    PythCorePullUpdateStore internal store;
    MockPythSequencerFeed internal sequencerFeed;
    PythCorePullFixingAdapter internal adapter;

    function setUp() public {
        vm.warp(1_700_000_000);
        receiver = new MockPythCoreReceiver();
        receiver.setFee(0);
        store = new PythCorePullUpdateStore(block.chainid, address(receiver));
        sequencerFeed = new MockPythSequencerFeed();
        sequencerFeed.setRound(1, 0, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);
        adapter = new PythCorePullFixingAdapter(
            block.chainid,
            address(store),
            FEED_ID,
            FEED_KEY,
            CAPABILITY_HASH,
            OUTPUT_DECIMALS,
            MAX_CONF_BPS,
            address(sequencerFeed),
            GRACE
        );
    }

    function test_ZeroFeePullSucceeds() public {
        receiver.setFee(0);
        uint64 publishTime = uint64(block.timestamp - 60);
        receiver.setSingleFeed(FEED_ID, 200_000_000_000, 1_000_000, -8, publishTime);
        bytes[] memory updateData = _updateData();

        PythVerifiedRecord memory record = store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, updateData);

        assertEq(record.price, 200_000_000_000);
        assertEq(record.publishTime, publishTime);
        assertEq(address(store).balance, 0);

        PythVerifiedRecord memory stored = store.getRecord(FEED_ID, publishTime);
        assertEq(stored.updateHash, record.updateHash);
        assertTrue(stored.updateHash != bytes32(0));
    }

    function test_NonzeroExactFeePullForwardsAndRetainsNothing() public {
        uint256 fee = 0.001 ether;
        receiver.setFee(fee);
        uint64 publishTime = uint64(block.timestamp - 30);
        receiver.setSingleFeed(FEED_ID, 200_100_000_000, 500_000, -8, publishTime);
        uint256 receiverBefore = address(receiver).balance;
        vm.deal(address(this), fee);

        PythVerifiedRecord memory record =
            store.pullAndVerify{value: fee}(FEED_ID, publishTime - 10, publishTime + 10, _updateData());

        assertEq(record.publishTime, publishTime);
        assertEq(address(store).balance, 0);
        assertEq(address(receiver).balance, receiverBefore + fee);
    }

    function test_RevertOnBadFee() public {
        receiver.setFee(0.002 ether);
        uint64 publishTime = uint64(block.timestamp - 30);
        receiver.setSingleFeed(FEED_ID, 200_100_000_000, 500_000, -8, publishTime);

        vm.expectRevert(abi.encodeWithSelector(PythCorePullUpdateStore.FeeMismatch.selector, 0.002 ether, uint256(0)));
        store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, _updateData());

        vm.deal(address(this), 0.003 ether);
        vm.expectRevert(abi.encodeWithSelector(PythCorePullUpdateStore.FeeMismatch.selector, 0.002 ether, 0.003 ether));
        store.pullAndVerify{value: 0.003 ether}(FEED_ID, publishTime - 10, publishTime + 10, _updateData());
    }

    function test_UniqueFixedWindowVerification() public {
        uint64 publishTime = uint64(block.timestamp - 50);
        receiver.setSingleFeed(FEED_ID, 100_000_000, 100_000, -8, publishTime);

        receiver.clearFeeds();
        vm.expectRevert(abi.encodeWithSelector(PythCorePullUpdateStore.WrongFeedCount.selector, uint256(0)));
        store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, _updateData());

        Price memory p = Price({price: 100_000_000, conf: 100_000, expo: -8, publishTime: publishTime});
        PriceFeed[] memory two = new PriceFeed[](2);
        two[0] = PriceFeed({id: FEED_ID, price: p, emaPrice: p});
        two[1] = PriceFeed({id: FEED_ID, price: p, emaPrice: p});
        receiver.setFeeds(two);
        vm.expectRevert(abi.encodeWithSelector(PythCorePullUpdateStore.WrongFeedCount.selector, uint256(2)));
        store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, _updateData());

        receiver.setSingleFeed(FEED_ID, 100_000_000, 100_000, -8, publishTime);
        PythVerifiedRecord memory record =
            store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, _updateData());
        assertEq(record.publishTime, publishTime);
    }

    function test_RevertOnWrongFeedAndWindow() public {
        uint64 publishTime = uint64(block.timestamp - 40);
        bytes32 wrongId = keccak256("wrong.feed");
        receiver.setSingleFeed(wrongId, 100_000_000, 100_000, -8, publishTime);
        vm.expectRevert(abi.encodeWithSelector(PythCorePullUpdateStore.FeedIdMismatch.selector, FEED_ID, wrongId));
        store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, _updateData());

        receiver.setSingleFeed(FEED_ID, 100_000_000, 100_000, -8, publishTime);
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullUpdateStore.PublishTimeBelowWindow.selector, publishTime, publishTime + 1, publishTime + 20
            )
        );
        store.pullAndVerify(FEED_ID, publishTime + 1, publishTime + 20, _updateData());

        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullUpdateStore.PublishTimeAboveWindow.selector, publishTime, publishTime - 20, publishTime - 1
            )
        );
        store.pullAndVerify(FEED_ID, publishTime - 20, publishTime - 1, _updateData());

        receiver.setSingleFeed(FEED_ID, 0, 100_000, -8, publishTime);
        vm.expectRevert(abi.encodeWithSelector(PythCorePullUpdateStore.NonPositivePrice.selector, int64(0)));
        store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, _updateData());

        receiver.setSingleFeed(FEED_ID, 100_000_000, 100_000, 40, publishTime);
        vm.expectRevert(abi.encodeWithSelector(PythCorePullUpdateStore.ExpoOutOfBounds.selector, int32(40)));
        store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, _updateData());

        uint64 tooBigConf = store.MAX_CONF() + 1;
        receiver.setSingleFeed(FEED_ID, 100_000_000, tooBigConf, -8, publishTime);
        vm.expectRevert(
            abi.encodeWithSelector(PythCorePullUpdateStore.ConfidenceOutOfBounds.selector, tooBigConf, store.MAX_CONF())
        );
        store.pullAndVerify(FEED_ID, publishTime - 10, publishTime + 10, _updateData());
    }

    function test_ConflictingReplayRejectsButExactReplaySucceeds() public {
        uint64 publishTime = uint64(block.timestamp - 20);
        receiver.setSingleFeed(FEED_ID, 150_000_000, 150_000, -8, publishTime);
        PythVerifiedRecord memory first = store.pullAndVerify(FEED_ID, publishTime - 5, publishTime + 5, _updateData());

        PythVerifiedRecord memory replay = store.pullAndVerify(FEED_ID, publishTime - 5, publishTime + 5, _updateData());
        assertEq(replay.updateHash, first.updateHash);
        assertEq(replay.price, first.price);

        receiver.setSingleFeed(FEED_ID, 150_000_001, 150_000, -8, publishTime);
        vm.expectRevert(
            abi.encodeWithSelector(PythCorePullUpdateStore.ConflictingRecord.selector, FEED_ID, publishTime)
        );
        store.pullAndVerify(FEED_ID, publishTime - 5, publishTime + 5, _updateData());

        receiver.setSingleFeed(FEED_ID, 150_000_000, 150_001, -8, publishTime);
        vm.expectRevert(
            abi.encodeWithSelector(PythCorePullUpdateStore.ConflictingRecord.selector, FEED_ID, publishTime)
        );
        store.pullAndVerify(FEED_ID, publishTime - 5, publishTime + 5, _updateData());
    }

    function test_ScaleAndConfidenceBoundaries() public {
        uint64 t0 = uint64(block.timestamp - 300);
        uint64 t1 = uint64(block.timestamp - 200);
        uint64 t2 = uint64(block.timestamp - 100);
        _verify(t0, 200_000_000_000, 2_000_000_000, -8, t0 - 5, t0 + 5);
        _verify(t1, 1_500_000, 15_000, -6, t1 - 5, t1 + 5);
        _verify(t2, 100, 1, 2, t2 - 5, t2 + 5);

        PythCorePullEvidenceItem[] memory items = _items(_times(t0, t1, t2));
        bytes memory evidence = abi.encode(items);
        bytes32 observationsHash = _expectedHash(items);
        ObservationBatchValidation memory validation =
            adapter.validateObservationBatch(_context(observationsHash), evidence);
        assertTrue(validation.complete);
        assertFalse(validation.outageIndependent);
        assertEq(validation.batchSequence, t2);

        HistoricalObservation[] memory observations = _expectedObservations(items);
        assertEq(observations[0].value, 200_000_000_000);
        assertEq(observations[0].confidenceBps, 100);
        assertEq(observations[1].value, 150_000_000);
        assertEq(observations[1].confidenceBps, 100);
        assertEq(observations[2].value, 100 * int256(10 ** 10));

        uint64 t3 = uint64(block.timestamp - 10);
        _verify(t3, 100_000_000, 2_000_000, -8, t3 - 5, t3 + 5);
        PythCorePullEvidenceItem[] memory over = _items(_times(t3));
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.ConfidenceExceedsMaximum.selector, uint256(0), uint256(200), MAX_CONF_BPS
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(over));

        uint64 t4 = uint64(block.timestamp - 5);
        _verify(t4, 100, 100_000_000, -8, t4 - 5, t4 + 5);
        PythCorePullEvidenceItem[] memory overflowItems = _items(_times(t4));
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.ConfidenceBpsOverflow.selector, uint256(0), uint256(10_000_000_000)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(overflowItems));
    }

    function test_ConfidenceBpsRoundsUpFractionalRemainder() public {
        uint64 publishTime = uint64(block.timestamp - 10);
        _verify(publishTime, 30, 11, -9, publishTime - 5, publishTime + 5);
        PythCorePullEvidenceItem[] memory items = _items(_times(publishTime));
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.ConfidenceExceedsMaximum.selector, uint256(0), uint256(6667), MAX_CONF_BPS
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));
    }

    function test_SequencerDownRequiresExactImpairedEvidence() public {
        uint64 publishTime = uint64(block.timestamp - 60);
        _verify(publishTime, 200_000_000_000, 1_000_000, -8, publishTime - 5, publishTime + 5);
        sequencerFeed.setRound(7, 1, block.timestamp - 100, block.timestamp - 50, 7);

        PythCorePullEvidenceItem[] memory impaired = _items(_times(publishTime));
        ObservationBatchValidation memory validation =
            adapter.validateObservationBatch(_context(_expectedHash(impaired)), abi.encode(impaired));
        assertTrue(validation.complete);
        assertFalse(validation.outageIndependent);

        PythCorePullEvidenceItem[] memory forged = _items(_times(publishTime));
        forged[0].sequencer.sequencerUp = true;
        vm.expectRevert(abi.encodeWithSelector(PythCorePullFixingAdapter.SequencerMismatch.selector, uint256(0)));
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(forged));
    }

    function test_SequencerGraceEndpointIsClosed() public {
        uint64 publishTime = uint64(block.timestamp - 400);
        _verify(publishTime, 200_000_000_000, 1_000_000, -8, publishTime - 5, publishTime + 5);
        uint64 graceEndsAt = uint64(block.timestamp + 100);
        uint64 startedAt = graceEndsAt - GRACE;
        sequencerFeed.setRound(5, 0, startedAt, startedAt, 5);

        vm.warp(graceEndsAt);
        PythCorePullEvidenceItem[] memory items = _items(_times(publishTime));
        ObservationBatchValidation memory validation =
            adapter.validateObservationBatch(_context(_expectedHash(items)), abi.encode(items));
        assertTrue(validation.complete);

        vm.warp(graceEndsAt + 1);
        items = _items(_times(publishTime));
        validation = adapter.validateObservationBatch(_context(_expectedHash(items)), abi.encode(items));
        assertTrue(validation.complete);

        vm.warp(graceEndsAt);
        PythCorePullEvidenceItem[] memory stale = _items(_times(publishTime));
        bytes memory staleEvidence = abi.encode(stale);
        bytes32 staleHash = _expectedHash(stale);
        vm.warp(graceEndsAt + 1);
        vm.expectRevert(abi.encodeWithSelector(PythCorePullFixingAdapter.SequencerMismatch.selector, uint256(0)));
        adapter.validateObservationBatch(_context(staleHash), staleEvidence);
    }

    function test_RevertOnMalformedEvidence() public {
        uint64 publishTime = uint64(block.timestamp - 60);
        _verify(publishTime, 200_000_000_000, 1_000_000, -8, publishTime - 5, publishTime + 5);
        PythCorePullEvidenceItem[] memory items = _items(_times(publishTime));
        bytes memory evidence = abi.encode(items);

        bytes memory truncated = new bytes(evidence.length - 1);
        for (uint256 i; i < truncated.length; ++i) {
            truncated[i] = evidence[i];
        }
        vm.expectRevert(
            abi.encodeWithSelector(PythCorePullFixingAdapter.MalformedEvidenceLength.selector, truncated.length)
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), truncated);

        vm.expectRevert(abi.encodeWithSelector(PythCorePullFixingAdapter.MalformedEvidenceLength.selector, uint256(0)));
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), new bytes(0));

        vm.expectRevert(PythCorePullFixingAdapter.EmptyEvidence.selector);
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(new PythCorePullEvidenceItem[](0)));

        uint256 tooMany = adapter.MAX_OBSERVATIONS() + 1;
        PythCorePullEvidenceItem[] memory many = new PythCorePullEvidenceItem[](tooMany);
        SequencerEvidence memory expected = _expectedSequencer();
        for (uint256 i; i < tooMany; ++i) {
            many[i] = PythCorePullEvidenceItem({publishTime: uint64(1 + i), sequencer: expected});
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.TooManyObservations.selector, tooMany, adapter.MAX_OBSERVATIONS()
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(many));
    }

    function test_RevertOnStaleUnverifiedAndNonIncreasing() public {
        uint64 publishTime = uint64(block.timestamp - 60);
        _verify(publishTime, 200_000_000_000, 1_000_000, -8, publishTime - 5, publishTime + 5);

        PythCorePullEvidenceItem[] memory missing = _items(_times(uint64(block.timestamp - 10)));
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.StaleOrUnverifiedRecord.selector, uint256(0), uint64(block.timestamp - 10)
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(missing));

        PythCorePullEvidenceItem[] memory dup = _items(_times(publishTime, publishTime));
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.NonIncreasingPublishTime.selector, uint256(1), publishTime, publishTime
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(dup));
    }

    function test_DeterministicAdapterOutput() public {
        uint64 t0 = uint64(block.timestamp - 200);
        uint64 t1 = uint64(block.timestamp - 100);
        _verify(t0, 200_000_000_000, 1_000_000, -8, t0 - 5, t0 + 5);
        _verify(t1, 200_100_000_000, 1_000_000, -8, t1 - 5, t1 + 5);
        PythCorePullEvidenceItem[] memory items = _items(_times(t0, t1));
        bytes memory evidence = abi.encode(items);
        bytes32 observationsHash = _expectedHash(items);

        ObservationBatchValidation memory first = adapter.validateObservationBatch(_context(observationsHash), evidence);
        ObservationBatchValidation memory second =
            adapter.validateObservationBatch(_context(observationsHash), evidence);

        assertEq(first.evidenceHash, second.evidenceHash);
        assertEq(first.completenessHash, second.completenessHash);
        assertEq(first.batchSequence, second.batchSequence);
        assertEq(first.batchSequence, t1);
        assertEq(first.feedKey, FEED_KEY);
        assertEq(first.capabilityHash, CAPABILITY_HASH);
    }

    function test_RevertOnWrongContextAndDeadline() public {
        uint64 publishTime = uint64(block.timestamp - 60);
        _verify(publishTime, 200_000_000_000, 1_000_000, -8, publishTime - 5, publishTime + 5);
        PythCorePullEvidenceItem[] memory items = _items(_times(publishTime));
        bytes memory evidence = abi.encode(items);
        bytes32 observationsHash = _expectedHash(items);

        ObservationValidationContext memory context = _context(observationsHash);
        context.chainId = block.chainid + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.BindingChainMismatch.selector, context.chainId, block.chainid
            )
        );
        adapter.validateObservationBatch(context, evidence);

        context = _context(observationsHash);
        context.feedKey = keccak256("wrong");
        vm.expectRevert(
            abi.encodeWithSelector(PythCorePullFixingAdapter.FeedKeyMismatch.selector, FEED_KEY, context.feedKey)
        );
        adapter.validateObservationBatch(context, evidence);

        context = _context(observationsHash);
        context.requiredCapabilityHash = keccak256("wrong");
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.CapabilityMismatch.selector, CAPABILITY_HASH, context.requiredCapabilityHash
            )
        );
        adapter.validateObservationBatch(context, evidence);

        context = _context(observationsHash);
        context.candidateDeadline = uint64(block.timestamp - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.CandidateDeadlineExpired.selector, context.candidateDeadline, block.timestamp
            )
        );
        adapter.validateObservationBatch(context, evidence);
    }

    function _updateData() internal pure returns (bytes[] memory data) {
        data = new bytes[](1);
        data[0] = hex"01020304";
    }

    function _verify(uint64 publishTime, int64 price, uint64 conf, int32 expo, uint64 minTime, uint64 maxTime)
        internal
    {
        receiver.setSingleFeed(FEED_ID, price, conf, expo, publishTime);
        uint256 fee = receiver.getUpdateFee(_updateData());
        if (fee > 0) vm.deal(address(this), fee);
        store.pullAndVerify{value: fee}(FEED_ID, minTime, maxTime, _updateData());
    }

    function _times(uint64 single) internal pure returns (uint64[] memory ids) {
        ids = new uint64[](1);
        ids[0] = single;
    }

    function _times(uint64 first, uint64 second) internal pure returns (uint64[] memory ids) {
        ids = new uint64[](2);
        ids[0] = first;
        ids[1] = second;
    }

    function _times(uint64 first, uint64 second, uint64 third) internal pure returns (uint64[] memory ids) {
        ids = new uint64[](3);
        ids[0] = first;
        ids[1] = second;
        ids[2] = third;
    }

    function _items(uint64[] memory times) internal view returns (PythCorePullEvidenceItem[] memory items) {
        items = new PythCorePullEvidenceItem[](times.length);
        SequencerEvidence memory expected = _expectedSequencer();
        for (uint256 i; i < times.length; ++i) {
            items[i] = PythCorePullEvidenceItem({publishTime: times[i], sequencer: expected});
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

    function _expectedHash(PythCorePullEvidenceItem[] memory items) internal view returns (bytes32) {
        return _hashObservations(_expectedObservations(items));
    }

    function _expectedObservations(PythCorePullEvidenceItem[] memory items)
        internal
        view
        returns (HistoricalObservation[] memory observations)
    {
        observations = new HistoricalObservation[](items.length);
        for (uint256 i; i < items.length; ++i) {
            PythVerifiedRecord memory record = store.getRecord(FEED_ID, items[i].publishTime);
            int256 scaledPrice = _scalePrice(record.price, record.expo);
            uint256 scaledConf = _scaleConf(record.conf, record.expo);
            uint256 bps = FixedPointLib.mulDivUp(scaledConf, BPS_DENOMINATOR, uint256(scaledPrice));
            bytes32 itemEvidenceHash = keccak256(
                abi.encode(
                    address(store),
                    address(receiver),
                    block.chainid,
                    FEED_ID,
                    record.price,
                    record.conf,
                    record.expo,
                    items[i].publishTime,
                    record.minPublishTime,
                    record.maxPublishTime,
                    record.updateHash,
                    OUTPUT_DECIMALS
                )
            );
            observations[i] = HistoricalObservation({
                value: scaledPrice,
                weight: 1,
                observedAt: items[i].publishTime,
                publishedAt: items[i].publishTime,
                providerSequence: items[i].publishTime,
                confidenceBps: uint16(bps),
                decimals: OUTPUT_DECIMALS,
                finalityReference: keccak256(abi.encode(FEED_ID, items[i].publishTime)),
                itemEvidenceHash: itemEvidenceHash,
                sequencer: items[i].sequencer
            });
        }
    }

    function _scalePrice(int64 raw, int32 expo) internal view returns (int256) {
        if (expo < 0) {
            return DecimalScaleLib.rescaleSignedFloor(int256(raw), uint8(uint32(-expo)), OUTPUT_DECIMALS);
        }
        uint256 sum = uint256(uint32(expo)) + OUTPUT_DECIMALS;
        return DecimalScaleLib.rescaleSignedFloor(int256(raw), 0, uint8(sum));
    }

    function _scaleConf(uint64 raw, int32 expo) internal view returns (uint256) {
        if (expo < 0) {
            return DecimalScaleLib.rescaleUp(uint256(raw), uint8(uint32(-expo)), OUTPUT_DECIMALS);
        }
        uint256 sum = uint256(uint32(expo)) + OUTPUT_DECIMALS;
        return DecimalScaleLib.rescaleUp(uint256(raw), 0, uint8(sum));
    }

    function _hashObservations(HistoricalObservation[] memory observations) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](observations.length);
        for (uint256 i; i < observations.length; ++i) {
            hashes[i] = FixingEvidenceLib.hashObservation(observations[i]);
        }
        return keccak256(abi.encode(OBSERVATIONS_TYPEHASH, keccak256(abi.encodePacked(hashes))));
    }
}
