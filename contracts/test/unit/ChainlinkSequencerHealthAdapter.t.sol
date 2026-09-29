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

contract MockChainlinkSequencerFeed is ISequencerUptimeFeed {
    uint80 public roundId = 1;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;

    function setRound(uint80 roundId_, int256 answer_, uint256 startedAt_, uint256 updatedAt_, uint80 answeredInRound_)
        external
    {
        roundId = roundId_;
        answer = answer_;
        startedAt = startedAt_;
        updatedAt = updatedAt_;
        answeredInRound = answeredInRound_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

contract ChainlinkSequencerHealthAdapterTest is Test {
    uint64 private constant GRACE = 1 hours;

    MockChainlinkSequencerFeed private feed;
    ChainlinkSequencerHealthAdapter private adapter;

    function setUp() external {
        vm.warp(10 days);
        feed = new MockChainlinkSequencerFeed();
        feed.setRound(1, 0, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);
        adapter = new ChainlinkSequencerHealthAdapter(block.chainid, address(feed), GRACE);
    }

    function test_DescriptorUsesOperationalAdapterLibConstants() external view {
        AdapterRuntimeDescriptor memory descriptor = adapter.operationalAdapterDescriptor();
        assertEq(descriptor.self, address(adapter));
        assertEq(descriptor.chainId, block.chainid);
        assertEq(descriptor.interfaceHash, OperationalAdapterLib.INTERFACE_SEQUENCER);
        assertEq(descriptor.capabilityHash, OperationalAdapterLib.CAPABILITY_SEQUENCER);
        assertTrue(descriptor.proxyFree);
        assertFalse(descriptor.valueMoving);
    }

    function test_UpOutsideGrace() external view {
        SequencerHealthResult memory result = adapter.readSequencerHealth(_binding());
        assertTrue(result.up);
        assertFalse(result.inRecoveryGrace);
        assertEq(result.observedAt, uint64(block.timestamp));
        assertEq(result.publishedAt, uint64(feed.updatedAt()));
        assertEq(result.recoveryGraceEndsAt, uint64(feed.startedAt()) + GRACE);
        assertTrue(result.evidenceHash != bytes32(0));
    }

    function test_DownHasNoGrace() external {
        feed.setRound(2, 1, block.timestamp - 10 minutes, block.timestamp - 10 minutes, 2);
        SequencerHealthResult memory result = adapter.readSequencerHealth(_binding());
        assertFalse(result.up);
        assertFalse(result.inRecoveryGrace);
        assertEq(result.recoveryGraceEndsAt, 0);
        assertEq(result.observedAt, uint64(block.timestamp));
        assertEq(result.publishedAt, uint64(feed.updatedAt()));
        assertTrue(result.evidenceHash != bytes32(0));
    }

    function test_RecoveryGraceDerivedFromStartedAtOnlyWhenUp() external {
        feed.setRound(3, 0, block.timestamp - 30 minutes, block.timestamp - 30 minutes, 3);
        SequencerHealthResult memory upResult = adapter.readSequencerHealth(_binding());
        assertTrue(upResult.up);
        assertTrue(upResult.inRecoveryGrace);
        assertEq(upResult.recoveryGraceEndsAt, uint64(feed.startedAt()) + GRACE);

        feed.setRound(4, 1, block.timestamp - 30 minutes, block.timestamp - 30 minutes, 4);
        SequencerHealthResult memory downResult = adapter.readSequencerHealth(_binding());
        assertFalse(downResult.up);
        assertFalse(downResult.inRecoveryGrace);
        assertEq(downResult.recoveryGraceEndsAt, 0);
    }

    function test_RecoveryGraceEndpointIsStillInGrace() external {
        feed.setRound(5, 0, block.timestamp - GRACE, block.timestamp - GRACE, 5);
        SequencerHealthResult memory atEndpoint = adapter.readSequencerHealth(_binding());
        assertTrue(atEndpoint.up);
        assertTrue(atEndpoint.inRecoveryGrace);
        assertEq(atEndpoint.recoveryGraceEndsAt, block.timestamp);

        vm.warp(block.timestamp + 1);
        SequencerHealthResult memory pastEndpoint =
            adapter.readSequencerHealth(_bindingAt(uint64(block.timestamp + 1 hours)));
        assertTrue(pastEndpoint.up);
        assertFalse(pastEndpoint.inRecoveryGrace);
    }

    function test_RevertWhenUpdatedAtBeforeStartedAt() external {
        uint256 startedAt = block.timestamp - 1 hours;
        uint256 updatedAt = startedAt - 1;
        feed.setRound(6, 0, startedAt, updatedAt, 6);
        vm.expectRevert(ChainlinkSequencerHealthAdapter.MalformedRoundData.selector);
        adapter.readSequencerHealth(_binding());
    }

    function test_EvidenceHashBindsFeedRoundAndBinding() external view {
        OperationalBinding memory binding = _binding();
        SequencerHealthResult memory result = adapter.readSequencerHealth(binding);
        bytes32 expected = keccak256(
            abi.encode(
                address(feed),
                block.chainid,
                feed.roundId(),
                feed.answer(),
                feed.startedAt(),
                feed.updatedAt(),
                feed.answeredInRound(),
                OperationalAdapterLib.hashBinding(binding)
            )
        );
        assertEq(result.evidenceHash, expected);
    }

    function test_RevertWhenBindingChainMismatch() external {
        OperationalBinding memory binding = _binding();
        binding.chainId = block.chainid + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkSequencerHealthAdapter.BindingChainMismatch.selector, binding.chainId, block.chainid
            )
        );
        adapter.readSequencerHealth(binding);
    }

    function test_RevertWhenBindingExpired() external {
        OperationalBinding memory binding = _binding();
        binding.deadline = uint64(block.timestamp - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkSequencerHealthAdapter.BindingExpired.selector, binding.deadline, block.timestamp
            )
        );
        adapter.readSequencerHealth(binding);
    }

    function test_RevertOnUnsupportedAnswer() external {
        feed.setRound(1, 2, block.timestamp - 1 hours, block.timestamp - 1 hours, 1);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkSequencerHealthAdapter.UnsupportedAnswer.selector, int256(2)));
        adapter.readSequencerHealth(_binding());
    }

    function test_RevertOnZeroTimestamps() external {
        feed.setRound(1, 0, 0, block.timestamp - 1 hours, 1);
        vm.expectRevert(ChainlinkSequencerHealthAdapter.ZeroFeedTimestamp.selector);
        adapter.readSequencerHealth(_binding());
    }

    function test_RevertOnFutureTimestamps() external {
        uint256 future = block.timestamp + 1;
        feed.setRound(1, 0, future, future, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkSequencerHealthAdapter.FutureFeedTimestamp.selector, future, future, block.timestamp
            )
        );
        adapter.readSequencerHealth(_binding());
    }

    function test_RevertOnInconsistentRoundIds() external {
        feed.setRound(5, 0, block.timestamp - 1 hours, block.timestamp - 1 hours, 4);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkSequencerHealthAdapter.InconsistentRoundIds.selector, uint80(5), uint80(4))
        );
        adapter.readSequencerHealth(_binding());
    }

    function test_RevertOnMalformedRoundData() external {
        feed.setRound(0, 0, block.timestamp - 1 hours, block.timestamp - 1 hours, 0);
        vm.expectRevert(ChainlinkSequencerHealthAdapter.MalformedRoundData.selector);
        adapter.readSequencerHealth(_binding());
    }

    function test_RevertOnRecoveryGraceOverflow() external {
        uint64 overflowStartedAt = type(uint64).max - GRACE + 1;
        vm.warp(type(uint64).max);
        feed.setRound(1, 0, overflowStartedAt, overflowStartedAt, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkSequencerHealthAdapter.RecoveryGraceOverflow.selector, overflowStartedAt, GRACE
            )
        );
        adapter.readSequencerHealth(_bindingAt(type(uint64).max));
    }

    function test_ConstructorRejectsInvalidInputs() external {
        vm.expectRevert(ChainlinkSequencerHealthAdapter.ZeroSequencerFeed.selector);
        new ChainlinkSequencerHealthAdapter(block.chainid, address(0), GRACE);

        address codeless = makeAddr("codeless-feed");
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkSequencerHealthAdapter.SequencerFeedWithoutCode.selector, codeless)
        );
        new ChainlinkSequencerHealthAdapter(block.chainid, codeless, GRACE);

        vm.expectRevert(
            abi.encodeWithSelector(
                ChainlinkSequencerHealthAdapter.WrongDeploymentChain.selector, block.chainid + 1, block.chainid
            )
        );
        new ChainlinkSequencerHealthAdapter(block.chainid + 1, address(feed), GRACE);

        vm.expectRevert(ChainlinkSequencerHealthAdapter.ZeroRecoveryGrace.selector);
        new ChainlinkSequencerHealthAdapter(block.chainid, address(feed), 0);
    }

    function _binding() private view returns (OperationalBinding memory) {
        return _bindingAt(uint64(block.timestamp + 1 hours));
    }

    function _bindingAt(uint64 deadline) private view returns (OperationalBinding memory) {
        return OperationalBinding({
            chainId: block.chainid,
            deploymentId: keccak256("deployment"),
            accountId: AccountId.wrap(keccak256("account")),
            marketId: MarketId.wrap(keccak256("market")),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            packageId: PackageId.wrap(keccak256("package")),
            packageVersion: 1,
            actionHash: keccak256("action"),
            nonce: 1,
            deadline: deadline,
            minValue: 0,
            maxValue: 1_000,
            recipientPolicyHash: keccak256("recipient"),
            expectedPostconditionsHash: keccak256("postconditions")
        });
    }
}
