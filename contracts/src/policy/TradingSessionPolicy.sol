// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ISequencerUptimeFeed} from "../interfaces/ISequencerUptimeFeed.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {ITradingSessionPolicy} from "../interfaces/ITradingSessionPolicy.sol";
import {SessionId, WindowKindId} from "../types/Identifiers.sol";
import {SessionDay, SessionWindow} from "../types/SessionDefinition.sol";

contract TradingSessionPolicy is ITradingSessionPolicy {
    uint256 public constant MAXIMUM_SESSION_WINDOWS = 16;

    ISessionRegistry public immutable sessionRegistry;
    ISequencerUptimeFeed public immutable sequencerFeed;
    WindowKindId public immutable tradingWindowKind;
    WindowKindId public immutable maintenanceWindowKind;
    uint64 public immutable recoveryGracePeriod;

    mapping(bytes32 scheduleKey => SessionDay day) private _days;
    mapping(bytes32 scheduleKey => SessionWindow[] windows) private _windows;

    error ZeroDependency();
    error InvalidSessionPolicy();
    error InvalidSessionProof();
    error DuplicateSessionDay();

    event SessionDayPublished(
        SessionId indexed sessionId,
        uint32 indexed sessionVersion,
        uint32 indexed day,
        bytes32 windowsHash,
        bytes32 evidenceHash
    );

    constructor(
        ISessionRegistry sessionRegistry_,
        ISequencerUptimeFeed sequencerFeed_,
        WindowKindId tradingWindowKind_,
        WindowKindId maintenanceWindowKind_,
        uint64 recoveryGracePeriod_
    ) {
        if (
            address(sessionRegistry_) == address(0) || address(sessionRegistry_).code.length == 0
                || address(sequencerFeed_) == address(0) || address(sequencerFeed_).code.length == 0
        ) revert ZeroDependency();
        if (
            WindowKindId.unwrap(tradingWindowKind_) == bytes32(0)
                || WindowKindId.unwrap(maintenanceWindowKind_) == bytes32(0)
                || tradingWindowKind_ == maintenanceWindowKind_ || recoveryGracePeriod_ == 0
        ) revert InvalidSessionPolicy();
        sessionRegistry = sessionRegistry_;
        sequencerFeed = sequencerFeed_;
        tradingWindowKind = tradingWindowKind_;
        maintenanceWindowKind = maintenanceWindowKind_;
        recoveryGracePeriod = recoveryGracePeriod_;
    }

    function publishSessionDay(
        SessionId sessionId,
        uint32 sessionVersion,
        SessionDay calldata sessionDay,
        SessionWindow[] calldata windows,
        bytes32[] calldata proof
    ) external {
        if (windows.length > MAXIMUM_SESSION_WINDOWS) revert InvalidSessionProof();
        bytes32 key = _scheduleKey(sessionId, sessionVersion, sessionDay.day);
        if (_days[key].evidenceHash != bytes32(0)) revert DuplicateSessionDay();
        if (
            sessionRegistry.hashWindows(windows) != sessionDay.windowsHash
                || !sessionRegistry.verifyDay(sessionId, sessionVersion, sessionDay, proof)
        ) revert InvalidSessionProof();
        _days[key] = sessionDay;
        for (uint256 i; i < windows.length; ++i) {
            _windows[key].push(windows[i]);
        }
        emit SessionDayPublished(
            sessionId, sessionVersion, sessionDay.day, sessionDay.windowsHash, sessionDay.evidenceHash
        );
    }

    function isOpenForNewRisk(SessionId sessionId, uint32 sessionVersion, uint64 timestamp)
        external
        view
        returns (bool)
    {
        if (!sequencerOperational()) return false;
        uint32 currentDay = uint32(uint256(timestamp) / 1 days);
        bool trading;
        bool maintenance;
        for (uint256 offset; offset < 3; ++offset) {
            if (offset == 0) {
                (trading, maintenance) =
                    _mergeWindowState(sessionId, sessionVersion, currentDay, timestamp, trading, maintenance);
            } else if (offset == 1 && currentDay != 0) {
                (trading, maintenance) =
                    _mergeWindowState(sessionId, sessionVersion, currentDay - 1, timestamp, trading, maintenance);
            } else if (offset == 2 && currentDay != type(uint32).max) {
                (trading, maintenance) =
                    _mergeWindowState(sessionId, sessionVersion, currentDay + 1, timestamp, trading, maintenance);
            }
        }
        return trading && !maintenance;
    }

    function sequencerOperational() public view returns (bool) {
        try sequencerFeed.latestRoundData() returns (
            uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
        ) {
            return roundId != 0 && answeredInRound >= roundId && answer == 0 && startedAt != 0 && updatedAt != 0
                && block.timestamp > startedAt + recoveryGracePeriod;
        } catch {
            return false;
        }
    }

    function _mergeWindowState(
        SessionId sessionId,
        uint32 sessionVersion,
        uint32 day,
        uint64 timestamp,
        bool trading,
        bool maintenance
    ) private view returns (bool nextTrading, bool nextMaintenance) {
        nextTrading = trading;
        nextMaintenance = maintenance;
        bytes32 key = _scheduleKey(sessionId, sessionVersion, day);
        if (_days[key].evidenceHash == bytes32(0) || !sessionRegistry.isOpenForNewRisk(sessionId, sessionVersion, day))
        {
            return (nextTrading, nextMaintenance);
        }
        SessionWindow[] storage windows = _windows[key];
        for (uint256 i; i < windows.length; ++i) {
            SessionWindow storage window = windows[i];
            if (timestamp < window.opensAt || timestamp >= window.closesAt) continue;
            if (window.kindId == tradingWindowKind) nextTrading = true;
            if (window.kindId == maintenanceWindowKind) nextMaintenance = true;
        }
    }

    function _scheduleKey(SessionId sessionId, uint32 sessionVersion, uint32 day) private pure returns (bytes32) {
        return keccak256(abi.encode(SessionId.unwrap(sessionId), sessionVersion, day));
    }
}
