// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ISequencerUptimeFeed} from "../../src/interfaces/ISequencerUptimeFeed.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {TradingSessionPolicy} from "../../src/policy/TradingSessionPolicy.sol";
import {SessionId, WindowKindId} from "../../src/types/Identifiers.sol";
import {SessionDay, SessionWindow} from "../../src/types/SessionDefinition.sol";

contract SessionPolicyRegistryMock {
    bool public open = true;

    function setOpen(bool open_) external {
        open = open_;
    }

    function hashWindows(SessionWindow[] calldata windows) external pure returns (bytes32) {
        return keccak256(abi.encode(windows));
    }

    function verifyDay(SessionId, uint32, SessionDay calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }

    function isOpenForNewRisk(SessionId, uint32, uint32) external view returns (bool) {
        return open;
    }
}

contract SequencerFeedMock {
    int256 public answer;
    uint256 public startedAt;

    function setStatus(int256 answer_, uint256 startedAt_) external {
        answer = answer_;
        startedAt = startedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, block.timestamp, 1);
    }
}

contract TradingSessionPolicyTest is Test {
    SessionPolicyRegistryMock internal sessions;
    SequencerFeedMock internal sequencer;
    TradingSessionPolicy internal policy;

    SessionId internal constant SESSION = SessionId.wrap(keccak256("session"));
    WindowKindId internal constant TRADING = WindowKindId.wrap(keccak256("trading"));
    WindowKindId internal constant MAINTENANCE = WindowKindId.wrap(keccak256("maintenance"));

    function setUp() public {
        vm.warp(10 days);
        sessions = new SessionPolicyRegistryMock();
        sequencer = new SequencerFeedMock();
        sequencer.setStatus(0, block.timestamp - 1 hours);
        policy = new TradingSessionPolicy(
            ISessionRegistry(address(sessions)), ISequencerUptimeFeed(address(sequencer)), TRADING, MAINTENANCE, 60
        );
    }

    function test_HalfOpenTradingAndMaintenanceOverride() public {
        uint32 day = uint32(block.timestamp / 1 days);
        SessionWindow[] memory windows = new SessionWindow[](2);
        windows[0] = SessionWindow({
            kindId: TRADING,
            opensAt: uint64(block.timestamp),
            closesAt: uint64(block.timestamp + 1 hours),
            policyHash: keccak256("trading policy")
        });
        windows[1] = SessionWindow({
            kindId: MAINTENANCE,
            opensAt: uint64(block.timestamp + 20 minutes),
            closesAt: uint64(block.timestamp + 30 minutes),
            policyHash: keccak256("maintenance policy")
        });
        SessionDay memory sessionDay =
            SessionDay({day: day, windowsHash: keccak256(abi.encode(windows)), evidenceHash: keccak256("evidence")});
        policy.publishSessionDay(SESSION, 1, sessionDay, windows, new bytes32[](0));

        assertTrue(policy.isOpenForNewRisk(SESSION, 1, uint64(block.timestamp)));
        assertFalse(policy.isOpenForNewRisk(SESSION, 1, uint64(block.timestamp + 25 minutes)));
        assertFalse(policy.isOpenForNewRisk(SESSION, 1, uint64(block.timestamp + 1 hours)));
    }

    function test_SequencerRecoveryGraceFailsClosed() public {
        sequencer.setStatus(0, block.timestamp - 30);
        assertFalse(policy.sequencerOperational());
        sequencer.setStatus(1, block.timestamp - 1 hours);
        assertFalse(policy.sequencerOperational());
    }
}
