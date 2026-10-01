// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {MerkleTreeLib} from "./MerkleTreeLib.sol";

import {CalendarDefinitionLib} from "../src/libraries/CalendarDefinitionLib.sol";
import {SeriesDefinitionLib} from "../src/libraries/SeriesDefinitionLib.sol";
import {SessionDefinitionLib} from "../src/libraries/SessionDefinitionLib.sol";
import {CalendarDay} from "../src/types/CalendarDefinition.sol";
import {BenchmarkId, CalendarId, SessionId, WindowKindId} from "../src/types/Identifiers.sol";
import {SeriesDefinition} from "../src/types/SeriesDefinition.sol";
import {
    CalendarDayProof,
    FixingCandidate,
    FixingSlot,
    SeriesDateKind,
    SeriesDateProof,
    SeriesQualificationData
} from "../src/types/SeriesQualification.sol";
import {SessionDay, SessionWindow} from "../src/types/SessionDefinition.sol";

/// @notice The network listing's calendar, session, schedule and series qualification witness, shared by the bootstrap
/// that first qualifies each dated range forward (BootstrapSetrynMarkets) and by the fee schedule update that re-versions
/// it onto a new market version (UpdateFeeSchedule). Both must publish byte-identical data for the same series, so every
/// rule lives here: everything is a pure function of the calendar horizon, the benchmark, and the series definition.
///
/// @dev The calendar is continuous UTC (no weekend, every day a business day) over a horizon from the listing day to two
/// days after the last expiry, committed as a Merkle root of one leaf per day. The session publishes, every day of that
/// horizon, a trading window over the whole UTC day and a fixing window from 07:00 to 08:00 UTC, the hour before the
/// 08:00 UTC expiries.
library NetworkSeriesQualification {
    /// Each benchmark is registered once per deployment, so every fixing candidate names its first version.
    uint32 internal constant BENCHMARK_VERSION = 1;
    /// The capped forward terms schema the instrument commits to.
    bytes32 internal constant TERMS_SCHEMA = keccak256("SETRYN_CANONICAL_CAPPED_FORWARD_TERMS_V1");
    bytes32 internal constant CALENDAR_DAY_EVIDENCE = keccak256("SETRYN_CONTINUOUS_UTC_CALENDAR_DAY_V1");
    bytes32 internal constant SESSION_DAY_EVIDENCE = keccak256("SETRYN_CONTINUOUS_UTC_SESSION_DAY_V1");
    bytes32 internal constant TRADING_WINDOW_POLICY = keccak256("SETRYN_CONTINUOUS_TRADING_WINDOW_V1");
    bytes32 internal constant FIXING_WINDOW_POLICY = keccak256("SETRYN_DAILY_0700_0800_UTC_FIXING_WINDOW_V1");
    uint64 internal constant FIXING_WINDOW_OPENS_AFTER_MIDNIGHT = 7 hours;
    uint64 internal constant EXPIRY_AFTER_MIDNIGHT = 8 hours;
    /// Days the calendar and session keep after the last expiry, so every post-expiry lifecycle date stays covered.
    uint32 internal constant HORIZON_TAIL_DAYS = 2;
    /// One hour: an observation is the answer in force at the target, attested any time up to an hour later.
    uint32 internal constant MAX_PUBLICATION_LAG_SECONDS = 1 hours;
    bytes32 internal constant SELECTION_PARAMETERS_TYPEHASH = keccak256(
        "SetrynLastAtOrBeforeSelectionV1(bytes32 benchmarkId,uint64 targetAt,uint64 windowStartsAt,uint64 windowEndsAt,uint32 maxPublicationLagSeconds)"
    );

    error DayOutsideHorizon(uint32 day, uint32 fromDay, uint32 throughDay);
    error InvalidHorizon(uint32 fromDay, uint32 throughDay);

    /// The days a calendar and its session cover, inclusive, and the calendar whose identity every leaf commits.
    struct Horizon {
        CalendarId calendarId;
        uint32 fromDay;
        uint32 throughDay;
    }

    /// One series' lifecycle, all relative to its 08:00 UTC expiry except the trading start.
    struct Schedule {
        uint64 tradingStartsAt;
        uint64 lastTradingAt;
        uint64 expiryAt;
        uint64 exerciseOpensAt;
        uint64 exerciseCutoffAt;
        uint64 fixingWindowOpen;
        uint64 fixingWindowClose;
        uint64 primaryEvidenceDeadline;
        uint64 correctionCutoffAt;
        uint64 finalResolutionAt;
        uint64 settlementDeadline;
    }

    /// Trading from listing to two hours before expiry; the fixing window is the hour before expiry; evidence closes an
    /// hour after expiry and corrections an hour later, when holder election opens for 45 minutes; final resolution is
    /// three hours after expiry and settlement must complete within the following half hour.
    function schedule(uint64 listedAt, uint64 expiryAt) internal pure returns (Schedule memory) {
        return Schedule({
            tradingStartsAt: listedAt,
            lastTradingAt: expiryAt - 2 hours,
            expiryAt: expiryAt,
            exerciseOpensAt: expiryAt + 2 hours,
            exerciseCutoffAt: expiryAt + 2 hours + 45 minutes,
            fixingWindowOpen: expiryAt - 1 hours,
            fixingWindowClose: expiryAt,
            primaryEvidenceDeadline: expiryAt + 1 hours,
            correctionCutoffAt: expiryAt + 2 hours,
            finalResolutionAt: expiryAt + 3 hours,
            settlementDeadline: expiryAt + 3 hours + 30 minutes
        });
    }

    // ------------------------------------------------------------------------------------------------------------
    // Calendar

    function calendarDay(uint32 day) internal pure returns (CalendarDay memory) {
        return CalendarDay({day: day, isBusinessDay: true, evidenceHash: CALENDAR_DAY_EVIDENCE});
    }

    /// Every level of the calendar's day-status tree, one leaf per horizon day in day order.
    function calendarTree(Horizon memory horizon) internal pure returns (bytes32[][] memory) {
        _requireHorizon(horizon);
        bytes32[] memory leaves = new bytes32[](uint256(horizon.throughDay - horizon.fromDay) + 1);
        for (uint256 i; i < leaves.length; ++i) {
            leaves[i] = CalendarDefinitionLib.hashDay(horizon.calendarId, calendarDay(horizon.fromDay + uint32(i)));
        }
        return MerkleTreeLib.build(leaves);
    }

    function calendarDayProof(Horizon memory horizon, bytes32[][] memory tree, uint32 day)
        internal
        pure
        returns (CalendarDayProof memory)
    {
        return CalendarDayProof({
            calendarDay: calendarDay(day), merkleProof: MerkleTreeLib.proof(tree, _offset(horizon, day))
        });
    }

    // ------------------------------------------------------------------------------------------------------------
    // Session

    /// A trading window over the whole UTC day and the 07:00 to 08:00 UTC fixing window, sorted as the registry requires.
    function sessionWindows(uint32 day) internal pure returns (SessionWindow[] memory windows) {
        uint64 dayStart = uint64(day) * 1 days;
        windows = new SessionWindow[](2);
        windows[0] = SessionWindow({
            kindId: SessionDefinitionLib.WINDOW_KIND_TRADING,
            opensAt: dayStart,
            closesAt: dayStart + 1 days,
            policyHash: TRADING_WINDOW_POLICY
        });
        windows[1] = SessionWindow({
            kindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            opensAt: dayStart + FIXING_WINDOW_OPENS_AFTER_MIDNIGHT,
            closesAt: dayStart + EXPIRY_AFTER_MIDNIGHT,
            policyHash: FIXING_WINDOW_POLICY
        });
    }

    /// SessionDefinitionLib.hashWindows over memory, for windows already in canonical order.
    function hashWindows(SessionWindow[] memory windows) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](windows.length);
        for (uint256 i; i < windows.length; ++i) {
            hashes[i] = keccak256(
                abi.encode(
                    SessionDefinitionLib.SESSION_WINDOW_TYPEHASH,
                    WindowKindId.unwrap(windows[i].kindId),
                    windows[i].opensAt,
                    windows[i].closesAt,
                    windows[i].policyHash
                )
            );
        }
        return
            keccak256(
                abi.encode(SessionDefinitionLib.SESSION_WINDOW_LIST_TYPEHASH, keccak256(abi.encodePacked(hashes)))
            );
    }

    function sessionDay(uint32 day) internal pure returns (SessionDay memory) {
        return SessionDay({day: day, windowsHash: hashWindows(sessionWindows(day)), evidenceHash: SESSION_DAY_EVIDENCE});
    }

    /// Every level of the session's day-schedule tree, one leaf per horizon day in day order.
    function sessionTree(SessionId sessionId, Horizon memory horizon) internal pure returns (bytes32[][] memory) {
        _requireHorizon(horizon);
        bytes32[] memory leaves = new bytes32[](uint256(horizon.throughDay - horizon.fromDay) + 1);
        for (uint256 i; i < leaves.length; ++i) {
            leaves[i] = SessionDefinitionLib.hashDay(sessionId, sessionDay(horizon.fromDay + uint32(i)));
        }
        return MerkleTreeLib.build(leaves);
    }

    function sessionDayProof(Horizon memory horizon, bytes32[][] memory tree, uint32 day)
        internal
        pure
        returns (bytes32[] memory)
    {
        return MerkleTreeLib.proof(tree, _offset(horizon, day));
    }

    // ------------------------------------------------------------------------------------------------------------
    // Series

    /// The fixing: the benchmark's last observation at or before one second before expiry, observed inside the fixing
    /// window. The window cannot reach expiry itself because a candidate's target must precede its window end and the
    /// window must close by expiry.
    function fixingCandidate(BenchmarkId benchmarkId, SeriesDefinition memory definition)
        internal
        pure
        returns (FixingCandidate memory candidate)
    {
        uint64 targetAt = definition.fixingWindowClose - 1;
        candidate = FixingCandidate({
            benchmarkId: benchmarkId,
            benchmarkVersion: BENCHMARK_VERSION,
            requiredWindowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_LAST_AT_OR_BEFORE,
            targetAt: targetAt,
            windowStartsAt: definition.fixingWindowOpen,
            windowEndsAt: definition.fixingWindowClose,
            unavailableAfter: definition.primaryEvidenceDeadline,
            maxPublicationLagSeconds: MAX_PUBLICATION_LAG_SECONDS,
            minimumObservations: 1,
            maximumObservations: 1,
            selectionParametersHash: keccak256(
                abi.encode(
                    SELECTION_PARAMETERS_TYPEHASH,
                    BenchmarkId.unwrap(benchmarkId),
                    targetAt,
                    definition.fixingWindowOpen,
                    definition.fixingWindowClose,
                    MAX_PUBLICATION_LAG_SECONDS
                )
            )
        });
    }

    function fixingSlots(BenchmarkId benchmarkId, SeriesDefinition memory definition)
        internal
        pure
        returns (FixingSlot[] memory slots)
    {
        slots = new FixingSlot[](1);
        slots[0].slot = 0;
        slots[0].candidates = new FixingCandidate[](1);
        slots[0].candidates[0] = fixingCandidate(benchmarkId, definition);
    }

    /// The complete qualification witness: the payoff terms, the single fixing slot, and an unadjusted date proof for
    /// every lifecycle date, each proving its day against the calendar tree.
    function qualification(
        Horizon memory horizon,
        bytes32[][] memory calendar,
        BenchmarkId benchmarkId,
        SeriesDefinition memory definition,
        bytes memory payoffTerms
    ) internal pure returns (SeriesQualificationData memory data) {
        data.payoffTerms = payoffTerms;
        data.fixingSlots = fixingSlots(benchmarkId, definition);
        data.dateProofs = new SeriesDateProof[](11);
        for (uint8 rawKind = 1; rawKind <= 11; ++rawKind) {
            SeriesDateKind kind = SeriesDateKind(rawKind);
            uint32 day = uint32(SeriesDefinitionLib.timestampForKind(definition, kind) / 1 days);
            SeriesDateProof memory proof = data.dateProofs[rawKind - 1];
            proof.kind = kind;
            proof.conventionId = SeriesDefinitionLib.DATE_ADJUSTMENT_UNADJUSTED;
            proof.scheduledDay = day;
            proof.calendarDays = new CalendarDayProof[](1);
            proof.calendarDays[0] = calendarDayProof(horizon, calendar, day);
        }
    }

    function _offset(Horizon memory horizon, uint32 day) private pure returns (uint256) {
        if (day < horizon.fromDay || day > horizon.throughDay) {
            revert DayOutsideHorizon(day, horizon.fromDay, horizon.throughDay);
        }
        return day - horizon.fromDay;
    }

    function _requireHorizon(Horizon memory horizon) private pure {
        if (horizon.fromDay > horizon.throughDay) revert InvalidHorizon(horizon.fromDay, horizon.throughDay);
    }
}
