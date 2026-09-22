// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {SessionDefinitionLib, UnorderedSessionWindows} from "../../src/libraries/SessionDefinitionLib.sol";
import {CalendarRegistry} from "../../src/registry/CalendarRegistry.sol";
import {SessionRegistry} from "../../src/registry/SessionRegistry.sol";
import {CalendarDefinition} from "../../src/types/CalendarDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {CalendarId, SessionId, WindowKindId} from "../../src/types/Identifiers.sol";
import {SessionDay, SessionDefinition, SessionWindow} from "../../src/types/SessionDefinition.sol";

contract SessionRegistryFuzzTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.session");
    bytes32 internal constant REFERENCE_ID = keccak256("xnys:core");
    bytes32 internal constant WINDOW_KIND_SET_HASH = keccak256("kindset.v1");
    bytes32 internal constant RULE_SET_HASH = keccak256("session.ruleset.v1");
    bytes32 internal constant SOURCE_HASH = keccak256("session.source.v1");
    bytes32 internal constant DAY_SCHEDULE_ROOT = keccak256("session.root.v1");

    address internal admin = makeAddr("admin");

    CalendarRegistry internal calendars;
    SessionRegistry internal registry;

    CalendarId internal calendarId;

    function setUp() public {
        calendars = new CalendarRegistry(ADMIN_DELAY, admin);
        registry = new SessionRegistry(ADMIN_DELAY, admin, calendars);

        vm.startPrank(admin);
        (calendarId,) = calendars.registerCalendar(_calendarDefinition());
        calendars.activateCalendar(calendarId, 1);
        vm.stopPrank();
    }

    /// @dev Identity is the namespace and reference pair alone, so no revision of the schedule, the
    /// horizon, the calendar dependency, the kind set, or the provenance may split one lineage.
    function testFuzz_SessionIdIgnoresNonIdentityFields(
        uint32 validFromDay,
        uint32 validThroughDay,
        bytes32 dayScheduleRoot,
        bytes32 windowKindSetHash,
        bytes32 ruleSetHash,
        bytes32 sourceHash
    ) public {
        vm.assume(dayScheduleRoot != bytes32(0) && dayScheduleRoot != DAY_SCHEDULE_ROOT);
        vm.assume(windowKindSetHash != bytes32(0));
        vm.assume(ruleSetHash != bytes32(0));
        vm.assume(sourceHash != bytes32(0));
        validFromDay = uint32(bound(validFromDay, 0, type(uint32).max));
        validThroughDay = uint32(bound(validThroughDay, 0, type(uint32).max));
        if (validFromDay > validThroughDay) {
            (validFromDay, validThroughDay) = (validThroughDay, validFromDay);
        }

        SessionDefinition memory baseline = _definition();

        SessionDefinition memory revised = _definition();
        revised.validFromDay = validFromDay;
        revised.validThroughDay = validThroughDay;
        revised.dayScheduleRoot = dayScheduleRoot;
        revised.windowKindSetHash = windowKindSetHash;
        revised.ruleSetHash = ruleSetHash;
        revised.sourceHash = sourceHash;

        vm.startPrank(admin);
        (SessionId baselineId, uint32 baselineVersion) = registry.registerSession(baseline);
        vm.stopPrank();

        assertEq(baselineVersion, 1);

        // The revised horizon may fall outside the calendar horizon, which is a dependency failure
        // rather than an identity failure, so identity is checked on the derivation itself.
        assertEq(SessionId.unwrap(baselineId), SessionId.unwrap(SessionDefinitionLib.deriveSessionId(revised)));

        if (
            validFromDay >= _calendarDefinition().validFromDay
                && validThroughDay <= _calendarDefinition().validThroughDay
        ) {
            vm.prank(admin);
            (SessionId revisedId, uint32 revisedVersion) = registry.registerSession(revised);

            assertEq(SessionId.unwrap(baselineId), SessionId.unwrap(revisedId));
            assertEq(revisedVersion, 2);
            assertEq(registry.sessionCount(), 2);
        }
    }

    /// @dev The kind space is open: any nonzero tag hashes, and a pair that differs only by kind
    /// produces two distinct windows and one canonical ordering.
    function testFuzz_HashWindowsAcceptsAnyNonzeroKindAndOneOrdering(
        bytes32 firstKind,
        bytes32 secondKind,
        uint64 opensAt,
        uint32 span,
        bytes32 policyHash
    ) public {
        vm.assume(firstKind != bytes32(0) && secondKind != bytes32(0));
        vm.assume(uint256(firstKind) < uint256(secondKind));
        vm.assume(policyHash != bytes32(0));
        opensAt = uint64(bound(opensAt, 0, type(uint64).max - type(uint32).max - 1));
        uint64 closesAt = opensAt + uint64(bound(span, 1, type(uint32).max));

        SessionWindow[] memory sorted = new SessionWindow[](2);
        sorted[0] = SessionWindow({
            kindId: WindowKindId.wrap(firstKind), opensAt: opensAt, closesAt: closesAt, policyHash: policyHash
        });
        sorted[1] = SessionWindow({
            kindId: WindowKindId.wrap(secondKind), opensAt: opensAt, closesAt: closesAt, policyHash: policyHash
        });

        bytes32 sortedHash = registry.hashWindows(sorted);
        assertTrue(sortedHash != bytes32(0));
        assertTrue(registry.hashWindow(sorted[0]) != registry.hashWindow(sorted[1]));

        SessionWindow[] memory reversed = new SessionWindow[](2);
        reversed[0] = sorted[1];
        reversed[1] = sorted[0];

        vm.expectRevert(abi.encodeWithSelector(UnorderedSessionWindows.selector, uint256(1)));
        registry.hashWindows(reversed);

        SessionWindow[] memory single = new SessionWindow[](1);
        single[0] = sorted[0];
        assertTrue(registry.hashWindows(single) != sortedHash);
    }

    /// @dev coversDay is exactly the committed session horizon and never depends on status, while
    /// isOpenForNewRisk additionally requires the active pointer and a live calendar dependency.
    function testFuzz_CoversDayMatchesHorizonWhileNewRiskTracksDependency(uint32 validFromDay, uint32 span, uint32 day)
        public
    {
        CalendarDefinition memory calendar = _calendarDefinition();
        validFromDay = uint32(bound(validFromDay, calendar.validFromDay, calendar.validThroughDay));
        span = uint32(bound(span, 0, calendar.validThroughDay - validFromDay));
        uint32 validThroughDay = validFromDay + span;

        SessionDefinition memory definition = _definition();
        definition.validFromDay = validFromDay;
        definition.validThroughDay = validThroughDay;

        vm.prank(admin);
        (SessionId id, uint32 version) = registry.registerSession(definition);

        bool inHorizon = day >= validFromDay && day <= validThroughDay;

        assertEq(registry.coversDay(id, version, day), inHorizon);
        assertFalse(registry.isOpenForNewRisk(id, version, day));

        vm.prank(admin);
        registry.activateSession(id, version);
        assertEq(registry.isOpenForNewRisk(id, version, day), inHorizon);

        vm.prank(admin);
        calendars.pauseCalendar(calendarId, 1);
        assertEq(registry.coversDay(id, version, day), inHorizon);
        assertFalse(registry.isOpenForNewRisk(id, version, day));
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Active));

        vm.prank(admin);
        calendars.deprecateCalendar(calendarId, 1);
        assertTrue(registry.isLifecycleEnabled(id, version));
    }

    /// @dev A single-leaf schedule verifies only its own exact commitment. Any change to the day,
    /// the window list, or the evidence produces a different leaf and fails.
    function testFuzz_VerifyDayRejectsTamperedLeaves(
        uint32 day,
        bytes32 windowsHash,
        bytes32 evidenceHash,
        uint32 otherDay
    ) public {
        day = uint32(bound(day, 20_000, 20_364));
        otherDay = uint32(bound(otherDay, 20_000, 20_364));
        vm.assume(otherDay != day);
        vm.assume(windowsHash != bytes32(0));
        vm.assume(evidenceHash != bytes32(0));

        SessionId id = SessionDefinitionLib.deriveSessionId(_definition());
        SessionDay memory committed = SessionDay({day: day, windowsHash: windowsHash, evidenceHash: evidenceHash});

        uint32 version = _registerWithRoot(registry.hashDay(id, committed));
        bytes32[] memory emptyProof = new bytes32[](0);

        assertTrue(registry.verifyDay(id, version, committed, emptyProof));
        assertFalse(registry.verifyDay(id, version, _day(otherDay, windowsHash, evidenceHash), emptyProof));
        assertFalse(
            registry.verifyDay(id, version, _day(day, keccak256(abi.encode(windowsHash)), evidenceHash), emptyProof)
        );
        assertFalse(
            registry.verifyDay(id, version, _day(day, windowsHash, keccak256(abi.encode(evidenceHash))), emptyProof)
        );
        assertFalse(registry.verifyDay(id, version + 1, committed, emptyProof));
    }

    function _day(uint32 day, bytes32 windowsHash, bytes32 evidenceHash) internal pure returns (SessionDay memory) {
        return SessionDay({day: day, windowsHash: windowsHash, evidenceHash: evidenceHash});
    }

    /// @dev Registers one full-calendar-horizon version so the fuzzed day is always inside it.
    function _registerWithRoot(bytes32 dayScheduleRoot) internal returns (uint32 version) {
        SessionDefinition memory definition = _definition();
        definition.validFromDay = 20_000;
        definition.validThroughDay = 20_364;
        definition.dayScheduleRoot = dayScheduleRoot;

        vm.prank(admin);
        (, version) = registry.registerSession(definition);
    }

    function _calendarDefinition() internal pure returns (CalendarDefinition memory) {
        return CalendarDefinition({
            namespaceId: keccak256("setryn.calendar"),
            referenceId: keccak256("us:settlement"),
            timeZoneId: keccak256("America/New_York"),
            weekendMask: 0x60,
            validFromDay: 20_000,
            validThroughDay: 20_364,
            dayStatusRoot: keccak256("calendar.root.v1"),
            ruleSetHash: keccak256("calendar.ruleset.v1"),
            sourceHash: keccak256("calendar.source.v1")
        });
    }

    function _definition() internal view returns (SessionDefinition memory) {
        return SessionDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: REFERENCE_ID,
            calendarId: calendarId,
            calendarVersion: 1,
            validFromDay: 20_010,
            validThroughDay: 20_100,
            dayScheduleRoot: DAY_SCHEDULE_ROOT,
            windowKindSetHash: WINDOW_KIND_SET_HASH,
            ruleSetHash: RULE_SET_HASH,
            sourceHash: SOURCE_HASH
        });
    }
}
