// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IPythCoreReceiver, Price, PythCorePullUpdateStore} from "../../src/adapters/oracle/PythCorePullUpdateStore.sol";
import {
    PythCorePullEvidenceItem,
    PythCorePullFixingAdapter
} from "../../src/adapters/oracle/PythCorePullFixingAdapter.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {BenchmarkId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    ObservationBatchValidation,
    ObservationValidationContext,
    SequencerEvidence
} from "../../src/types/FixingTypes.sol";

/// @notice Arbitrum Sepolia qualification for the Pyth Core pull oracle slice.
/// @dev Read-only by default: verifies receiver and sequencer code plus the core Pyth
///      receiver methods, and proves the local adapter rejects unverified records. A
///      fresh-payload pull runs only when explicit update bytes are supplied via env and
///      writes only to local fork state. No keys, no broadcast, no mainnet write.
contract ArbitrumSepoliaPythCorePullForkTest is Test {
    uint256 internal constant ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;
    bytes32 internal constant CAPABILITY_HASH = keccak256("SetrynCapabilityV1:PythCorePull");

    address internal receiver;
    bytes32 internal priceId;
    bytes32 internal feedKey;
    address internal sequencerFeed;
    uint64 internal recoveryGracePeriod = 1 hours;
    uint8 internal outputDecimals = 8;
    uint16 internal maxConfidenceBps = 1_000;
    PythCorePullUpdateStore internal store;
    PythCorePullFixingAdapter internal adapter;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string(""));
        string memory blockNumber = vm.envOr("ARBITRUM_SEPOLIA_FORK_BLOCK_NUMBER", string(""));
        address configuredReceiver = vm.envOr("SETRYN_PYTH_CORE_RECEIVER", address(0));
        string memory configuredPriceId = vm.envOr("SETRYN_PYTH_PRICE_ID", string(""));
        address configuredSequencer = vm.envOr("SETRYN_SEQUENCER_UPTIME_FEED", address(0));

        if (
            bytes(rpcUrl).length == 0 || bytes(blockNumber).length == 0 || configuredReceiver == address(0)
                || bytes(configuredPriceId).length == 0 || configuredSequencer == address(0)
        ) {
            vm.skip(
                true,
                "Set ARBITRUM_SEPOLIA_RPC_URL, ARBITRUM_SEPOLIA_FORK_BLOCK_NUMBER, SETRYN_PYTH_CORE_RECEIVER, SETRYN_PYTH_PRICE_ID and SETRYN_SEQUENCER_UPTIME_FEED to run the Pyth pull Sepolia suite"
            );
        }

        vm.createSelectFork(rpcUrl, vm.parseUint(blockNumber));
        assertEq(block.chainid, ARBITRUM_SEPOLIA_CHAIN_ID, "RPC must resolve to Arbitrum Sepolia");
        assertGt(configuredReceiver.code.length, 0, "configured Pyth receiver must have code at the pinned block");
        assertGt(configuredSequencer.code.length, 0, "configured sequencer feed must have code at the pinned block");

        receiver = configuredReceiver;
        priceId = _parseBytes32(configuredPriceId);
        assertTrue(priceId != bytes32(0), "parsed Pyth price ID must be nonzero");
        feedKey = priceId;
        sequencerFeed = configuredSequencer;

        uint256 configuredGrace = vm.envOr("SETRYN_SEQUENCER_GRACE_PERIOD", uint256(0));
        if (configuredGrace != 0 && configuredGrace <= type(uint64).max) {
            recoveryGracePeriod = uint64(configuredGrace);
        }
        uint256 configuredDecimals = vm.envOr("SETRYN_PYTH_OUTPUT_DECIMALS", uint256(0));
        if (configuredDecimals != 0 && configuredDecimals <= 36) {
            outputDecimals = uint8(configuredDecimals);
        }
        uint256 configuredMaxBps = vm.envOr("SETRYN_PYTH_MAX_CONF_BPS", uint256(0));
        if (configuredMaxBps != 0 && configuredMaxBps <= 10_000) {
            maxConfidenceBps = uint16(configuredMaxBps);
        }

        store = new PythCorePullUpdateStore(ARBITRUM_SEPOLIA_CHAIN_ID, receiver);
        adapter = new PythCorePullFixingAdapter(
            ARBITRUM_SEPOLIA_CHAIN_ID,
            address(store),
            priceId,
            feedKey,
            CAPABILITY_HASH,
            outputDecimals,
            maxConfidenceBps,
            sequencerFeed,
            recoveryGracePeriod
        );
    }

    function test_ReceiverHasCodeAndCoreMethods() public view {
        assertGt(receiver.code.length, 0, "Pyth receiver must have code");
        assertGt(sequencerFeed.code.length, 0, "sequencer feed must have code");

        bytes[] memory emptyUpdate = new bytes[](0);
        uint256 fee = IPythCoreReceiver(receiver).getUpdateFee(emptyUpdate);
        assertTrue(fee < 10 ether, "quoted fee must be bounded");

        Price memory spot = _trySpotPrice();
        if (spot.publishTime != 0) {
            assertGt(spot.price, 0, "spot price must be positive when available");
            assertGt(spot.publishTime, 0, "spot publish time must be nonzero when available");
        }
    }

    function test_SequencerFeedIsLive() public view {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            ISequencerUptimeFeed(sequencerFeed).latestRoundData();
        assertTrue(roundId != 0, "sequencer round must be nonzero");
        assertTrue(answeredInRound != 0, "sequencer answeredInRound must be nonzero");
        assertTrue(answer == 0 || answer == 1, "sequencer answer must be 0 or 1");
        assertGt(startedAt, 0, "sequencer startedAt must be nonzero");
        assertGt(updatedAt, 0, "sequencer updatedAt must be nonzero");
        assertLe(startedAt, updatedAt, "sequencer timestamps must be ordered");
        assertLe(updatedAt, block.timestamp, "sequencer must not be from the future");

        SequencerEvidence memory evidence = _sequencer();
        bytes32 proofHash = keccak256(
            abi.encode(
                sequencerFeed,
                ARBITRUM_SEPOLIA_CHAIN_ID,
                roundId,
                answer,
                startedAt,
                updatedAt,
                answeredInRound,
                recoveryGracePeriod
            )
        );
        assertEq(evidence.proofHash, proofHash, "sequencer proof must bind the exact round payload");
    }

    function test_AdapterRejectsUnverifiedRecord() public {
        uint64 unknownPublishTime = uint64(block.timestamp > 60 ? block.timestamp - 60 : 1);
        PythCorePullEvidenceItem[] memory items = new PythCorePullEvidenceItem[](1);
        items[0] = PythCorePullEvidenceItem({publishTime: unknownPublishTime, sequencer: _sequencer()});
        vm.expectRevert(
            abi.encodeWithSelector(
                PythCorePullFixingAdapter.StaleOrUnverifiedRecord.selector, uint256(0), unknownPublishTime
            )
        );
        adapter.validateObservationBatch(_context(bytes32(uint256(1))), abi.encode(items));
    }

    function test_ForkReadCannotMutateReceiver() public view {
        bytes32 receiverCodeHash = receiver.codehash;
        bytes32 sequencerCodeHash = sequencerFeed.codehash;
        bytes[] memory emptyUpdate = new bytes[](0);
        IPythCoreReceiver(receiver).getUpdateFee(emptyUpdate);
        ISequencerUptimeFeed(sequencerFeed).latestRoundData();
        _trySpotPrice();
        assertEq(receiver.codehash, receiverCodeHash);
        assertEq(sequencerFeed.codehash, sequencerCodeHash);
    }

    function test_FreshPullAndFixingOnFork() public {
        string memory updateHex = vm.envOr("SETRYN_PYTH_UPDATE_DATA", string(""));
        if (bytes(updateHex).length == 0) {
            vm.skip(true, "Set SETRYN_PYTH_UPDATE_DATA to run the fresh Pyth pull test on the fork");
        }
        bytes memory singleUpdate = vm.parseBytes(updateHex);
        if (singleUpdate.length == 0) {
            vm.skip(true, "SETRYN_PYTH_UPDATE_DATA must decode to nonempty bytes");
        }
        bytes[] memory updateData = new bytes[](1);
        updateData[0] = singleUpdate;
        uint64 minTime = uint64(vm.envOr("SETRYN_PYTH_MIN_PUBLISH_TIME", uint256(1)));
        uint64 maxTime = uint64(vm.envOr("SETRYN_PYTH_MAX_PUBLISH_TIME", uint256(0)));
        if (maxTime == 0) {
            maxTime = uint64(block.timestamp);
        }
        if (minTime > maxTime) {
            vm.skip(true, "SETRYN_PYTH_MIN_PUBLISH_TIME must not exceed SETRYN_PYTH_MAX_PUBLISH_TIME");
        }

        uint256 fee = IPythCoreReceiver(receiver).getUpdateFee(updateData);
        vm.deal(address(this), fee);
        (bool pullOk,) = address(store).call{value: fee}(
            abi.encodeCall(store.pullAndVerify, (priceId, minTime, maxTime, updateData))
        );
        if (!pullOk) {
            vm.skip(true, "Supplied Hermes payload did not verify inside the requested window at the pinned block");
        }

        uint64 publishTime = _latestPublishTime();
        assertTrue(publishTime != 0, "fresh pull must leave a verified record");

        PythCorePullEvidenceItem[] memory items = new PythCorePullEvidenceItem[](1);
        items[0] = PythCorePullEvidenceItem({publishTime: publishTime, sequencer: _sequencer()});
        bytes memory evidence = abi.encode(items);
        ObservationBatchValidation memory probe = _validateWithReconstructedHash(items, evidence);
        assertTrue(probe.complete);
        assertFalse(probe.outageIndependent);
        assertTrue(probe.evidenceHash != bytes32(0));
        assertTrue(probe.completenessHash != bytes32(0));
        assertEq(probe.feedKey, feedKey);

        ObservationBatchValidation memory repeat = _validateWithReconstructedHash(items, evidence);
        assertEq(repeat.evidenceHash, probe.evidenceHash);
        assertEq(repeat.completenessHash, probe.completenessHash);
        assertEq(repeat.batchSequence, probe.batchSequence);
    }

    function _trySpotPrice() internal view returns (Price memory spot) {
        (bool ok, bytes memory data) =
            receiver.staticcall(abi.encodeCall(IPythCoreReceiver.getPriceNoOlderThan, (priceId, 1_000_000_000)));
        if (!ok || data.length == 0) {
            return spot;
        }
        spot = abi.decode(data, (Price));
    }

    function _latestPublishTime() internal view returns (uint64) {
        Price memory spot = _trySpotPrice();
        if (spot.publishTime == 0 || spot.publishTime > type(uint64).max) return 0;
        return uint64(spot.publishTime);
    }

    function _validateWithReconstructedHash(PythCorePullEvidenceItem[] memory items, bytes memory evidence)
        internal
        view
        returns (ObservationBatchValidation memory)
    {
        uint256 count = items.length;
        bytes32[] memory hashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            (int256 value, uint16 confidenceBps, bytes32 finalityReference, bytes32 itemEvidenceHash) =
                _reconstruct(items[i].publishTime, items[i].sequencer);
            bytes32 sequencerHash = keccak256(
                abi.encode(
                    keccak256(
                        "SetrynSequencerEvidenceV1(bool sequencerUp,bool inRecoveryGrace,uint64 recoveryGraceEndsAt,bytes32 proofHash)"
                    ),
                    items[i].sequencer.sequencerUp,
                    items[i].sequencer.inRecoveryGrace,
                    items[i].sequencer.recoveryGraceEndsAt,
                    items[i].sequencer.proofHash
                )
            );
            hashes[i] = keccak256(
                abi.encode(
                    keccak256(
                        "SetrynHistoricalObservationV1(int256 value,uint128 weight,uint64 observedAt,uint64 publishedAt,uint64 providerSequence,uint16 confidenceBps,uint8 decimals,bytes32 finalityReference,bytes32 itemEvidenceHash,bytes32 sequencerEvidenceHash)"
                    ),
                    value,
                    uint128(1),
                    items[i].publishTime,
                    items[i].publishTime,
                    items[i].publishTime,
                    confidenceBps,
                    outputDecimals,
                    finalityReference,
                    itemEvidenceHash,
                    sequencerHash
                )
            );
        }
        bytes32 observationsHash = keccak256(
            abi.encode(
                keccak256("SetrynHistoricalObservationsV1(bytes32 observationHashesHash)"),
                keccak256(abi.encodePacked(hashes))
            )
        );
        return adapter.validateObservationBatch(_context(observationsHash), evidence);
    }

    function _reconstruct(uint64 publishTime, SequencerEvidence memory)
        internal
        view
        returns (int256 value, uint16 confidenceBps, bytes32 finalityReference, bytes32 itemEvidenceHash)
    {
        (int64 rawPrice, uint64 rawConf, int32 expo, uint64 minTime, uint64 maxTime, bytes32 updateHash) =
            _recordFields(publishTime);
        value = _scalePrice(rawPrice, expo);
        uint256 scaledConf = _scaleConf(rawConf, expo);
        uint256 bps = (scaledConf * BPS_FOR_TEST) / uint256(value);
        confidenceBps = uint16(bps);
        finalityReference = keccak256(abi.encode(priceId, publishTime));
        itemEvidenceHash = keccak256(
            abi.encode(
                address(store),
                receiver,
                ARBITRUM_SEPOLIA_CHAIN_ID,
                priceId,
                rawPrice,
                rawConf,
                expo,
                publishTime,
                minTime,
                maxTime,
                updateHash,
                outputDecimals
            )
        );
    }

    uint256 internal constant BPS_FOR_TEST = 10_000;

    function _recordFields(uint64 publishTime)
        internal
        view
        returns (int64 rawPrice, uint64 rawConf, int32 expo, uint64 minTime, uint64 maxTime, bytes32 updateHash)
    {
        (bool ok, bytes memory data) =
            address(store).staticcall(abi.encodeCall(store.getRecord, (priceId, publishTime)));
        require(ok && data.length > 0, "record read must succeed");
        (int64 p, uint64 c, int32 e, uint64 pt, uint64 minT, uint64 maxT, bytes32 uh) =
            abi.decode(data, (int64, uint64, int32, uint64, uint64, uint64, bytes32));
        require(pt == publishTime && uh != bytes32(0), "record must be verified");
        return (p, c, e, minT, maxT, uh);
    }

    function _scalePrice(int64 raw, int32 expo) internal view returns (int256) {
        if (expo < 0) {
            uint8 fromDecimals = uint8(uint32(-expo));
            return _rescaleSignedFloor(int256(raw), fromDecimals, outputDecimals);
        }
        uint256 sum = uint256(uint32(expo)) + outputDecimals;
        require(sum <= 36, "expo out of bounds");
        return _rescaleSignedFloor(int256(raw), 0, uint8(sum));
    }

    function _scaleConf(uint64 raw, int32 expo) internal view returns (uint256) {
        if (expo < 0) {
            return _rescaleDown(uint256(raw), uint8(uint32(-expo)), outputDecimals);
        }
        uint256 sum = uint256(uint32(expo)) + outputDecimals;
        require(sum <= 36, "expo out of bounds");
        return _rescaleDown(uint256(raw), 0, uint8(sum));
    }

    function _rescaleDown(uint256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        if (toDecimals >= fromDecimals) {
            return amount * (10 ** (toDecimals - fromDecimals));
        }
        return amount / (10 ** (fromDecimals - toDecimals));
    }

    function _rescaleSignedFloor(int256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (int256) {
        if (toDecimals >= fromDecimals) {
            return amount * int256(10 ** (toDecimals - fromDecimals));
        }
        uint256 divisor = 10 ** (fromDecimals - toDecimals);
        int256 quotient = amount / int256(divisor);
        if (amount < 0 && amount % int256(divisor) != 0) {
            quotient -= 1;
        }
        return quotient;
    }

    function _context(bytes32 observationsHash) internal view returns (ObservationValidationContext memory) {
        return ObservationValidationContext({
            chainId: block.chainid,
            fixingEngine: address(this),
            seriesId: SeriesId.wrap(keccak256("fork.series")),
            seriesVersion: 1,
            slot: 0,
            candidateIndex: 0,
            benchmarkId: BenchmarkId.wrap(keccak256("fork.benchmark")),
            benchmarkVersion: 1,
            benchmarkVersionHash: keccak256("fork.benchmark.version"),
            feedKey: feedKey,
            requiredCapabilityHash: CAPABILITY_HASH,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_OFFICIAL,
            selectionParametersHash: keccak256("fork.selection"),
            observationsHash: observationsHash,
            candidateDeadline: uint64(block.timestamp + 1 hours)
        });
    }

    function _sequencer() internal view returns (SequencerEvidence memory) {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            ISequencerUptimeFeed(sequencerFeed).latestRoundData();
        bool up = answer == 0;
        bool inGrace;
        uint64 endsAt;
        if (up) {
            endsAt = uint64(startedAt) + recoveryGracePeriod;
            inGrace = block.timestamp <= endsAt;
        }
        bytes32 proofHash = keccak256(
            abi.encode(
                sequencerFeed,
                ARBITRUM_SEPOLIA_CHAIN_ID,
                roundId,
                answer,
                startedAt,
                updatedAt,
                answeredInRound,
                recoveryGracePeriod
            )
        );
        return SequencerEvidence({
            sequencerUp: up, inRecoveryGrace: inGrace, recoveryGraceEndsAt: endsAt, proofHash: proofHash
        });
    }

    function _parseBytes32(string memory raw) internal pure returns (bytes32) {
        bytes memory data = bytes(raw);
        if (data.length == 66 && data[0] == "0" && (data[1] == "x" || data[1] == "X")) {
            bytes32 parsed;
            for (uint256 i; i < 32; ++i) {
                uint8 hi = _hexNibble(data[2 + i * 2]);
                uint8 lo = _hexNibble(data[3 + i * 2]);
                parsed |= bytes32(uint256(uint8(hi * 16 + lo)) << (8 * (31 - i)));
            }
            return parsed;
        }
        if (data.length == 64) {
            bytes32 parsed;
            for (uint256 i; i < 32; ++i) {
                uint8 hi = _hexNibble(data[i * 2]);
                uint8 lo = _hexNibble(data[i * 2 + 1]);
                parsed |= bytes32(uint256(uint8(hi * 16 + lo)) << (8 * (31 - i)));
            }
            return parsed;
        }
        return keccak256(data);
    }

    function _hexNibble(bytes1 ch) internal pure returns (uint8) {
        uint8 value = uint8(ch);
        if (value >= 48 && value <= 57) return value - 48;
        if (value >= 97 && value <= 102) return value - 87;
        if (value >= 65 && value <= 70) return value - 55;
        revert("invalid hex");
    }
}
