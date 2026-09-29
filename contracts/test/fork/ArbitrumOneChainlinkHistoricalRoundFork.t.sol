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
import {BenchmarkId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    ObservationBatchValidation,
    ObservationValidationContext,
    SequencerEvidence
} from "../../src/types/FixingTypes.sol";

interface IChainlinkLatestFeed is IChainlinkHistoricalFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Pinned Arbitrum One fork qualification for the Chainlink historical-round adapter.
/// @dev Read-only: deploys the adapter against the configured price feed and the real sequencer
///      uptime feed and validates one exact historical round with getRoundData. No writes, no keys,
///      no broadcast, no Pyth.
contract ArbitrumOneChainlinkHistoricalRoundForkTest is Test {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    bytes32 internal constant CAPABILITY_HASH = keccak256("SetrynCapabilityV1:ChainlinkHistoricalRound");

    address internal feed;
    bytes32 internal feedKey;
    address internal sequencerFeed;
    uint64 internal recoveryGracePeriod;
    ChainlinkHistoricalRoundFixingAdapter internal adapter;
    uint80 internal pinnedRoundId;
    bool internal hasPinnedRound;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        string memory blockNumber = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));
        address configuredFeed = vm.envOr("SETRYN_CHAINLINK_FEED", address(0));
        string memory configuredKey = vm.envOr("SETRYN_CHAINLINK_FEED_KEY", string(""));
        address configuredSequencer = vm.envOr("SETRYN_SEQUENCER_UPTIME_FEED", address(0));

        if (
            bytes(rpcUrl).length == 0 || bytes(blockNumber).length == 0 || configuredFeed == address(0)
                || configuredSequencer == address(0)
        ) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL, ARBITRUM_ONE_FORK_BLOCK_NUMBER, SETRYN_CHAINLINK_FEED and SETRYN_SEQUENCER_UPTIME_FEED to run the Chainlink historical-round fork suite"
            );
        }
        if (bytes(configuredKey).length == 0) {
            vm.skip(true, "Set SETRYN_CHAINLINK_FEED_KEY to run the Chainlink historical-round fork suite");
        }

        vm.createSelectFork(rpcUrl, vm.parseUint(blockNumber));
        assertEq(block.chainid, ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
        assertGt(configuredFeed.code.length, 0, "configured Chainlink feed must have code at the pinned block");
        assertGt(configuredSequencer.code.length, 0, "configured sequencer feed must have code at the pinned block");

        feed = configuredFeed;
        sequencerFeed = configuredSequencer;
        feedKey = _parseFeedKey(configuredKey);
        uint256 configuredGrace = vm.envOr("SETRYN_SEQUENCER_GRACE_PERIOD", uint256(0));
        recoveryGracePeriod =
            configuredGrace != 0 && configuredGrace <= type(uint64).max ? uint64(configuredGrace) : uint64(1 hours);
        uint8 liveDecimals = IChainlinkHistoricalFeed(feed).decimals();
        adapter = new ChainlinkHistoricalRoundFixingAdapter(
            ARBITRUM_ONE_CHAIN_ID, feed, feedKey, CAPABILITY_HASH, liveDecimals, sequencerFeed, recoveryGracePeriod
        );

        uint256 configuredRound = vm.envOr("SETRYN_CHAINLINK_ROUND_ID", uint256(0));
        if (configuredRound != 0 && configuredRound <= type(uint80).max) {
            pinnedRoundId = uint80(configuredRound);
            hasPinnedRound = true;
        }
    }

    function test_ValidateExactHistoricalRoundOnFork() public view {
        uint80 roundId = _resolveRoundId();
        (uint80 returnedId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            IChainlinkHistoricalFeed(feed).getRoundData(roundId);

        assertEq(returnedId, roundId, "fork feed must return the exact requested round");
        assertEq(answeredInRound, roundId, "fork round must be self-answered");
        assertGt(answer, 0, "fork round answer must be positive");
        assertGt(startedAt, 0, "fork round startedAt must be nonzero");
        assertGt(updatedAt, 0, "fork round updatedAt must be nonzero");
        assertLe(startedAt, updatedAt, "fork round timestamps must be ordered");
        assertLe(updatedAt, block.timestamp, "fork round must not be from the future");

        ChainlinkHistoricalEvidenceItem[] memory items = new ChainlinkHistoricalEvidenceItem[](1);
        items[0] = ChainlinkHistoricalEvidenceItem({roundId: roundId, sequencer: _sequencer()});
        bytes memory evidence = abi.encode(items);

        ObservationBatchValidation memory probe = _validateWithReconstructedHash(items, evidence);
        assertTrue(probe.complete);
        assertFalse(probe.outageIndependent);
        assertTrue(probe.batchSequence != 0);
        assertTrue(probe.evidenceHash != bytes32(0));
        assertTrue(probe.completenessHash != bytes32(0));
        assertEq(probe.feedKey, feedKey);
        assertEq(probe.capabilityHash, CAPABILITY_HASH);

        ObservationBatchValidation memory repeat = _validateWithReconstructedHash(items, evidence);
        assertEq(repeat.evidenceHash, probe.evidenceHash);
        assertEq(repeat.completenessHash, probe.completenessHash);
        assertEq(repeat.batchSequence, probe.batchSequence);
    }

    function test_ForkReadCannotMutateFeed() public view {
        uint80 roundId = _resolveRoundId();
        bytes32 codeHashBefore = feed.codehash;
        bytes32 sequencerCodeHashBefore = sequencerFeed.codehash;
        ChainlinkHistoricalEvidenceItem[] memory items = new ChainlinkHistoricalEvidenceItem[](1);
        items[0] = ChainlinkHistoricalEvidenceItem({roundId: roundId, sequencer: _sequencer()});
        _validateWithReconstructedHash(items, abi.encode(items));
        _validateWithReconstructedHash(items, abi.encode(items));
        assertEq(feed.codehash, codeHashBefore);
        assertEq(sequencerFeed.codehash, sequencerCodeHashBefore);
    }

    function _resolveRoundId() internal view returns (uint80) {
        if (hasPinnedRound) return pinnedRoundId;
        (uint80 latestId,,,,) = IChainlinkLatestFeed(feed).latestRoundData();
        assertTrue(latestId != 0, "fork feed must expose a nonzero latest round");
        return latestId;
    }

    function _validateWithReconstructedHash(ChainlinkHistoricalEvidenceItem[] memory items, bytes memory evidence)
        internal
        view
        returns (ObservationBatchValidation memory)
    {
        uint256 count = items.length;
        bytes32[] memory hashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            (, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
                IChainlinkHistoricalFeed(feed).getRoundData(items[i].roundId);
            uint8 liveDecimals = IChainlinkHistoricalFeed(feed).decimals();
            bytes32 itemEvidenceHash = keccak256(
                abi.encode(
                    feed,
                    ARBITRUM_ONE_CHAIN_ID,
                    items[i].roundId,
                    answer,
                    startedAt,
                    updatedAt,
                    answeredInRound,
                    liveDecimals
                )
            );
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
            bytes32 observationHash = keccak256(
                abi.encode(
                    keccak256(
                        "SetrynHistoricalObservationV1(int256 value,uint128 weight,uint64 observedAt,uint64 publishedAt,uint64 providerSequence,uint16 confidenceBps,uint8 decimals,bytes32 finalityReference,bytes32 itemEvidenceHash,bytes32 sequencerEvidenceHash)"
                    ),
                    answer,
                    uint128(1),
                    uint64(updatedAt),
                    uint64(updatedAt),
                    uint64(items[i].roundId),
                    uint16(0),
                    liveDecimals,
                    bytes32(uint256(items[i].roundId)),
                    itemEvidenceHash,
                    sequencerHash
                )
            );
            hashes[i] = observationHash;
        }
        bytes32 observationsHash = keccak256(
            abi.encode(
                keccak256("SetrynHistoricalObservationsV1(bytes32 observationHashesHash)"),
                keccak256(abi.encodePacked(hashes))
            )
        );
        ObservationValidationContext memory context = ObservationValidationContext({
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
        return adapter.validateObservationBatch(context, evidence);
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
                ARBITRUM_ONE_CHAIN_ID,
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

    function _parseFeedKey(string memory raw) internal pure returns (bytes32) {
        bytes memory data = bytes(raw);
        if (data.length == 66 && data[0] == "0" && (data[1] == "x" || data[1] == "X")) {
            bytes32 parsed;
            for (uint256 i; i < 32; ++i) {
                uint8 hi = _hexNibble(data[2 + i * 2]);
                uint8 lo = _hexNibble(data[3 + i * 2]);
                parsed |= bytes32(uint256(uint8(hi * 16 + lo)) << (8 * (31 - i)));
            }
            require(parsed != bytes32(0), "feed key hex must be nonzero");
            return parsed;
        }
        return keccak256(data);
    }

    function _hexNibble(bytes1 ch) internal pure returns (uint8) {
        uint8 value = uint8(ch);
        if (value >= 48 && value <= 57) return value - 48;
        if (value >= 97 && value <= 102) return value - 87;
        if (value >= 65 && value <= 70) return value - 55;
        revert("invalid feed key hex");
    }
}
