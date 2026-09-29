// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ISequencerUptimeFeed} from "../../interfaces/ISequencerUptimeFeed.sol";
import {ISequencerHealthAdapterV1} from "../../interfaces/IOperationalAdapters.sol";
import {OperationalAdapterLib} from "../../libraries/OperationalAdapterLib.sol";
import {
    AdapterRuntimeDescriptor,
    OperationalBinding,
    SequencerHealthResult
} from "../../types/OperationalAdapterTypes.sol";

/// @notice Chainlink-compatible sequencer health operational adapter.
/// @dev Binds an explicit chain, one exact feed address, and a recovery grace.
///      Answer 0 means sequencer up, answer 1 means sequencer down. Any other
///      answer is unsupported. Recovery grace is derived from `startedAt` only
///      while the answer reports up. Never writes chain state.
contract ChainlinkSequencerHealthAdapter is ISequencerHealthAdapterV1 {
    ISequencerUptimeFeed public immutable sequencerFeed;
    uint256 public immutable expectedChainId;
    uint64 public immutable recoveryGracePeriod;

    error ZeroSequencerFeed();
    error SequencerFeedWithoutCode(address feed);
    error WrongDeploymentChain(uint256 expectedChainId, uint256 actualChainId);
    error ZeroRecoveryGrace();
    error BindingChainMismatch(uint256 bindingChainId, uint256 actualChainId);
    error BindingExpired(uint64 deadline, uint256 timestamp);
    error MalformedRoundData();
    error InconsistentRoundIds(uint80 roundId, uint80 answeredInRound);
    error UnsupportedAnswer(int256 answer);
    error ZeroFeedTimestamp();
    error FutureFeedTimestamp(uint256 startedAt, uint256 updatedAt, uint256 timestamp);
    error FeedTimestampOverflow(uint256 value);
    error RecoveryGraceOverflow(uint64 startedAt, uint64 grace);

    constructor(uint256 expectedChainId_, address feed_, uint64 recoveryGracePeriod_) {
        if (expectedChainId_ == 0 || expectedChainId_ != block.chainid) {
            revert WrongDeploymentChain(expectedChainId_, block.chainid);
        }
        if (feed_ == address(0)) revert ZeroSequencerFeed();
        if (feed_.code.length == 0) revert SequencerFeedWithoutCode(feed_);
        if (recoveryGracePeriod_ == 0) revert ZeroRecoveryGrace();
        expectedChainId = expectedChainId_;
        sequencerFeed = ISequencerUptimeFeed(feed_);
        recoveryGracePeriod = recoveryGracePeriod_;
    }

    function operationalAdapterDescriptor() external view returns (AdapterRuntimeDescriptor memory descriptor) {
        descriptor = AdapterRuntimeDescriptor({
            self: address(this),
            chainId: block.chainid,
            interfaceHash: OperationalAdapterLib.INTERFACE_SEQUENCER,
            capabilityHash: OperationalAdapterLib.CAPABILITY_SEQUENCER,
            proxyFree: true,
            valueMoving: false
        });
    }

    function readSequencerHealth(OperationalBinding calldata binding)
        external
        view
        returns (SequencerHealthResult memory result)
    {
        if (binding.chainId != block.chainid) revert BindingChainMismatch(binding.chainId, block.chainid);
        if (block.chainid != expectedChainId) revert WrongDeploymentChain(expectedChainId, block.chainid);
        if (block.timestamp > binding.deadline) revert BindingExpired(binding.deadline, block.timestamp);

        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            sequencerFeed.latestRoundData();

        if (roundId == 0 || answeredInRound == 0) revert MalformedRoundData();
        if (answeredInRound < roundId) revert InconsistentRoundIds(roundId, answeredInRound);
        if (answer != 0 && answer != 1) revert UnsupportedAnswer(answer);
        if (startedAt == 0 || updatedAt == 0) revert ZeroFeedTimestamp();
        if (updatedAt < startedAt) revert MalformedRoundData();
        if (startedAt > block.timestamp || updatedAt > block.timestamp) {
            revert FutureFeedTimestamp(startedAt, updatedAt, block.timestamp);
        }
        if (startedAt > type(uint64).max || updatedAt > type(uint64).max || block.timestamp > type(uint64).max) {
            revert FeedTimestampOverflow(block.timestamp);
        }

        uint64 observedAt = uint64(block.timestamp);
        uint64 publishedAt = uint64(updatedAt);
        bool up = answer == 0;

        uint64 recoveryGraceEndsAt;
        bool inRecoveryGrace;
        if (up) {
            uint64 startedAt64 = uint64(startedAt);
            if (uint256(startedAt64) + uint256(recoveryGracePeriod) > type(uint64).max) {
                revert RecoveryGraceOverflow(startedAt64, recoveryGracePeriod);
            }
            recoveryGraceEndsAt = startedAt64 + recoveryGracePeriod;
            inRecoveryGrace = block.timestamp <= recoveryGraceEndsAt;
        }

        OperationalBinding memory bindingCopy = binding;
        bytes32 evidenceHash = keccak256(
            abi.encode(
                address(sequencerFeed),
                expectedChainId,
                roundId,
                answer,
                startedAt,
                updatedAt,
                answeredInRound,
                OperationalAdapterLib.hashBinding(bindingCopy)
            )
        );

        result = SequencerHealthResult({
            up: up,
            inRecoveryGrace: inRecoveryGrace,
            observedAt: observedAt,
            publishedAt: publishedAt,
            recoveryGraceEndsAt: recoveryGraceEndsAt,
            evidenceHash: evidenceHash
        });
    }
}
