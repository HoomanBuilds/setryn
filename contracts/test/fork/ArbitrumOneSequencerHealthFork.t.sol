// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ChainlinkSequencerHealthAdapter} from "../../src/adapters/operational/ChainlinkSequencerHealthAdapter.sol";
import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {OperationalAdapterLib} from "../../src/libraries/OperationalAdapterLib.sol";
import {AccountId, MarketId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    AdapterRuntimeDescriptor,
    OperationalBinding,
    SequencerHealthResult
} from "../../src/types/OperationalAdapterTypes.sol";

/// @notice Pinned Arbitrum One fork qualification for the sequencer health adapter.
/// @dev Read-only: deploys the adapter against the configured feed and reads
///      both the feed and the adapter. No writes, no keys, no broadcast.
contract ArbitrumOneSequencerHealthForkTest is Test {
    uint256 internal constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    uint64 internal constant RECOVERY_GRACE = 1 hours;

    address internal sequencerFeed;
    ChainlinkSequencerHealthAdapter internal adapter;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ARBITRUM_RPC_URL", string(""));
        string memory blockNumber = vm.envOr("ARBITRUM_ONE_FORK_BLOCK_NUMBER", string(""));
        address configuredFeed = vm.envOr("SETRYN_SEQUENCER_UPTIME_FEED", address(0));

        if (bytes(rpcUrl).length == 0 || bytes(blockNumber).length == 0 || configuredFeed == address(0)) {
            vm.skip(
                true,
                "Set ARBITRUM_RPC_URL, ARBITRUM_ONE_FORK_BLOCK_NUMBER and SETRYN_SEQUENCER_UPTIME_FEED to run the sequencer health fork suite"
            );
        }

        vm.createSelectFork(rpcUrl, vm.parseUint(blockNumber));
        assertEq(block.chainid, ARBITRUM_ONE_CHAIN_ID, "RPC must resolve to Arbitrum One");
        assertGt(configuredFeed.code.length, 0, "configured sequencer feed must have code at the pinned block");

        sequencerFeed = configuredFeed;
        adapter = new ChainlinkSequencerHealthAdapter(ARBITRUM_ONE_CHAIN_ID, configuredFeed, RECOVERY_GRACE);
    }

    function test_ReadRealFeedThroughAdapter() public view {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            ISequencerUptimeFeed(sequencerFeed).latestRoundData();

        OperationalBinding memory binding = _binding();
        SequencerHealthResult memory result = adapter.readSequencerHealth(binding);

        AdapterRuntimeDescriptor memory descriptor = adapter.operationalAdapterDescriptor();
        assertEq(descriptor.self, address(adapter));
        assertEq(descriptor.chainId, ARBITRUM_ONE_CHAIN_ID);
        assertEq(descriptor.interfaceHash, OperationalAdapterLib.INTERFACE_SEQUENCER);
        assertEq(descriptor.capabilityHash, OperationalAdapterLib.CAPABILITY_SEQUENCER);
        assertTrue(descriptor.proxyFree);
        assertFalse(descriptor.valueMoving);

        assertEq(result.observedAt, uint64(block.timestamp));
        assertEq(result.publishedAt, uint64(updatedAt));
        assertEq(result.up, answer == 0);
        if (result.up) {
            assertEq(result.recoveryGraceEndsAt, uint64(startedAt) + RECOVERY_GRACE);
            assertEq(result.inRecoveryGrace, block.timestamp <= result.recoveryGraceEndsAt);
        } else {
            assertEq(result.recoveryGraceEndsAt, 0);
            assertFalse(result.inRecoveryGrace);
        }

        bytes32 expectedEvidence = keccak256(
            abi.encode(
                sequencerFeed,
                ARBITRUM_ONE_CHAIN_ID,
                roundId,
                answer,
                startedAt,
                updatedAt,
                answeredInRound,
                OperationalAdapterLib.hashBinding(binding)
            )
        );
        assertEq(result.evidenceHash, expectedEvidence);
        assertTrue(result.evidenceHash != bytes32(0));
    }

    function test_ForkReadCannotMutateFeed() public view {
        bytes32 codeHashBefore = sequencerFeed.codehash;
        OperationalBinding memory binding = _binding();
        adapter.readSequencerHealth(binding);
        adapter.readSequencerHealth(binding);
        assertEq(sequencerFeed.codehash, codeHashBefore);
    }

    function _binding() private view returns (OperationalBinding memory) {
        return OperationalBinding({
            chainId: block.chainid,
            deploymentId: keccak256("fork-qualification"),
            accountId: AccountId.wrap(keccak256("account")),
            marketId: MarketId.wrap(keccak256("market")),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            packageId: PackageId.wrap(keccak256("package")),
            packageVersion: 1,
            actionHash: keccak256("action"),
            nonce: 1,
            deadline: uint64(block.timestamp + 1 hours),
            minValue: 0,
            maxValue: 1_000,
            recipientPolicyHash: keccak256("recipient"),
            expectedPostconditionsHash: keccak256("postconditions")
        });
    }
}
