// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {IdLib} from "../../src/libraries/IdLib.sol";
import {
    DuplicateSessionWindow,
    InvalidSessionHorizon,
    InvalidWindowInterval,
    SessionDefinitionLib,
    TooManyWindows,
    UnorderedSessionWindows,
    ZeroDayScheduleRoot,
    ZeroSessionCalendarId,
    ZeroSessionCalendarVersion,
    ZeroSessionEvidenceHash,
    ZeroSessionNamespaceId,
    ZeroSessionReferenceId,
    ZeroSessionRuleSetHash,
    ZeroSessionSourceHash,
    ZeroWindowKindId,
    ZeroWindowKindSetHash,
    ZeroWindowPolicyHash,
    ZeroWindowsHash
} from "../../src/libraries/SessionDefinitionLib.sol";
import {CalendarRegistry} from "../../src/registry/CalendarRegistry.sol";
import {SessionRegistry} from "../../src/registry/SessionRegistry.sol";
import {CalendarDefinition} from "../../src/types/CalendarDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {CalendarId, SessionId, WindowKindId} from "../../src/types/Identifiers.sol";
import {SessionDay, SessionDefinition, SessionVersion, SessionWindow} from "../../src/types/SessionDefinition.sol";

contract SessionRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    uint64 internal constant DAY_SECONDS = 86_400;

    bytes32 internal constant CALENDAR_NAMESPACE_ID = keccak256("setryn.calendar");
    bytes32 internal constant CALENDAR_REFERENCE_ID = keccak256("us:settlement");

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.session");
    bytes32 internal constant REFERENCE_PRIMARY = keccak256("xnys:core");
    bytes32 internal constant REFERENCE_SECONDARY = keccak256("xlon:core");
    bytes32 internal constant WINDOW_KIND_SET_HASH = keccak256("kindset.v1");
    bytes32 internal constant RULE_SET_HASH = keccak256("session.ruleset.v1");
    bytes32 internal constant SOURCE_HASH = keccak256("session.source.v1");

    uint32 internal constant CALENDAR_FROM_DAY = 20_000;
    uint32 internal constant CALENDAR_THROUGH_DAY = 20_364;

    uint32 internal constant FROM_DAY = 20_010;
    uint32 internal constant THROUGH_DAY = 20_100;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

    CalendarRegistry internal calendars;
    SessionRegistry internal registry;

    CalendarId internal calendarId;
    SessionId internal sessionId;
    bytes32 internal scheduleRoot;

    function setUp() public {
        calendars = new CalendarRegistry(ADMIN_DELAY, admin);
        registry = new SessionRegistry(ADMIN_DELAY, admin, calendars);

        vm.startPrank(admin);
        registry.grantRole(registry.SESSION_REGISTRAR_ROLE(), registrar);
        registry.grantRole(registry.SESSION_STATUS_MANAGER_ROLE(), statusManager);
        (calendarId,) = calendars.registerCalendar(_calendarDefinition());
        calendars.activateCalendar(calendarId, 1);
        vm.stopPrank();

        sessionId = _sessionIdFor(REFERENCE_PRIMARY);
        scheduleRoot = _root(_leaves(sessionId));
    }

    function test_TypestringsMatchTheirTypehashes() public pure {
        assertEq(
            keccak256(bytes(SessionDefinitionLib.SESSION_KEY_TYPESTRING)), SessionDefinitionLib.SESSION_KEY_TYPEHASH
        );
        assertEq(
            keccak256(bytes(SessionDefinitionLib.SESSION_DEFINITION_TYPESTRING)),
            SessionDefinitionLib.SESSION_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(SessionDefinitionLib.SESSION_VERSION_TYPESTRING)),
            SessionDefinitionLib.SESSION_VERSION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(SessionDefinitionLib.SESSION_WINDOW_TYPESTRING)),
            SessionDefinitionLib.SESSION_WINDOW_TYPEHASH
        );
        assertEq(
            keccak256(bytes(SessionDefinitionLib.SESSION_WINDOW_LIST_TYPESTRING)),
            SessionDefinitionLib.SESSION_WINDOW_LIST_TYPEHASH
        );
        assertEq(
            keccak256(bytes(SessionDefinitionLib.SESSION_DAY_TYPESTRING)), SessionDefinitionLib.SESSION_DAY_TYPEHASH
        );
    }

    function test_RoleConstantsAreFrozenAndDistinct() public view {
        assertEq(registry.SESSION_REGISTRAR_ROLE(), keccak256(bytes("SETRYN_SESSION_REGISTRAR_ROLE")));
        assertEq(registry.SESSION_STATUS_MANAGER_ROLE(), keccak256(bytes("SETRYN_SESSION_STATUS_MANAGER_ROLE")));
        assertTrue(registry.SESSION_REGISTRAR_ROLE() != registry.SESSION_STATUS_MANAGER_ROLE());
        assertTrue(registry.SESSION_REGISTRAR_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.SESSION_STATUS_MANAGER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
    }

    function test_ConstructorGrantsOperationalRolesToInitialAdmin() public {
        SessionRegistry fresh = new SessionRegistry(ADMIN_DELAY, admin, calendars);

        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.SESSION_REGISTRAR_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.SESSION_STATUS_MANAGER_ROLE(), admin));
        assertEq(fresh.defaultAdmin(), admin);
        assertEq(fresh.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(address(fresh.calendarRegistry()), address(calendars));
        assertEq(fresh.sessionCount(), 0);
    }

    function test_ConstructorRejectsZeroAdminAndInvalidCalendarRegistry() public {
        vm.expectRevert(ISessionRegistry.ZeroInitialAdmin.selector);
        new SessionRegistry(ADMIN_DELAY, address(0), calendars);

        vm.expectRevert(ISessionRegistry.ZeroCalendarRegistry.selector);
        new SessionRegistry(ADMIN_DELAY, admin, CalendarRegistry(address(0)));

        vm.expectRevert(abi.encodeWithSelector(ISessionRegistry.CalendarRegistryHasNoCode.selector, outsider));
        new SessionRegistry(ADMIN_DELAY, admin, CalendarRegistry(outsider));
    }

    /// @dev The V1 key commits namespace and reference alone, so republishing a schedule with a new
    /// horizon, a corrected root, and a newer calendar version must land on the same lineage.
    function test_SessionIdIsStableAcrossScheduleRevisions() public {
        SessionDefinition memory first = _definition();

        vm.prank(admin);
        calendars.registerCalendar(_revisedCalendarDefinition());

        SessionDefinition memory revised = _definition();
        revised.calendarVersion = 2;
        revised.validFromDay = FROM_DAY + 1;
        revised.validThroughDay = THROUGH_DAY + 10;
        revised.dayScheduleRoot = keccak256("revised.root");
        revised.windowKindSetHash = keccak256("kindset.v2");
        revised.ruleSetHash = keccak256("session.ruleset.v2");
        revised.sourceHash = keccak256("session.source.v2");

        (SessionId firstId, uint32 firstVersion) = _register(first);
        (SessionId revisedId, uint32 revisedVersion) = _register(revised);

        assertEq(SessionId.unwrap(firstId), SessionId.unwrap(revisedId));
        assertEq(
            SessionId.unwrap(firstId), SessionId.unwrap(IdLib.deriveSessionId(SessionDefinitionLib.hashKey(first)))
        );
        assertEq(firstVersion, 1);
        assertEq(revisedVersion, 2);
        assertTrue(registry.getSession(firstId, 1).definitionHash != registry.getSession(firstId, 2).definitionHash);
    }

    function test_RegisterRejectsZeroFieldsAndInvalidHorizon() public {
        SessionDefinition memory definition = _definition();
        definition.namespaceId = bytes32(0);
        _expectRegisterRevert(definition, ZeroSessionNamespaceId.selector);

        definition = _definition();
        definition.referenceId = bytes32(0);
        _expectRegisterRevert(definition, ZeroSessionReferenceId.selector);

        definition = _definition();
        definition.calendarId = CalendarId.wrap(bytes32(0));
        _expectRegisterRevert(definition, ZeroSessionCalendarId.selector);

        definition = _definition();
        definition.calendarVersion = 0;
        _expectRegisterRevert(definition, ZeroSessionCalendarVersion.selector);

        definition = _definition();
        definition.dayScheduleRoot = bytes32(0);
        _expectRegisterRevert(definition, ZeroDayScheduleRoot.selector);

        definition = _definition();
        definition.windowKindSetHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroWindowKindSetHash.selector);

        definition = _definition();
        definition.ruleSetHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroSessionRuleSetHash.selector);

        definition = _definition();
        definition.sourceHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroSessionSourceHash.selector);

        definition = _definition();
        definition.validFromDay = THROUGH_DAY;
        definition.validThroughDay = FROM_DAY;
        vm.expectRevert(abi.encodeWithSelector(InvalidSessionHorizon.selector, THROUGH_DAY, FROM_DAY));
        vm.prank(registrar);
        registry.registerSession(definition);
    }

    function test_RegisterRejectsUnknownCalendarDependency() public {
        SessionDefinition memory definition = _definition();
        definition.calendarVersion = 2;

        vm.expectRevert(abi.encodeWithSelector(ISessionRegistry.UnknownCalendarDependency.selector, calendarId, 2));
        vm.prank(registrar);
        registry.registerSession(definition);

        CalendarId strangerId = IdLib.deriveCalendarId(keccak256("no.such.calendar"));
        definition = _definition();
        definition.calendarId = strangerId;

        vm.expectRevert(abi.encodeWithSelector(ISessionRegistry.UnknownCalendarDependency.selector, strangerId, 1));
        vm.prank(registrar);
        registry.registerSession(definition);

        assertEq(registry.sessionCount(), 0);
    }

    function test_RegisterRejectsCalendarHorizonTooNarrow() public {
        SessionDefinition memory definition = _definition();
        definition.validFromDay = CALENDAR_FROM_DAY - 1;

        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionRegistry.CalendarHorizonTooNarrow.selector,
                calendarId,
                uint32(1),
                CALENDAR_FROM_DAY - 1,
                THROUGH_DAY
            )
        );
        vm.prank(registrar);
        registry.registerSession(definition);

        definition = _definition();
        definition.validThroughDay = CALENDAR_THROUGH_DAY + 1;

        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionRegistry.CalendarHorizonTooNarrow.selector,
                calendarId,
                uint32(1),
                FROM_DAY,
                CALENDAR_THROUGH_DAY + 1
            )
        );
        vm.prank(registrar);
        registry.registerSession(definition);
    }

    function test_RegisterLandsPausedAndEmitsCompleteEvent() public {
        SessionDefinition memory definition = _definition();
        bytes32 definitionHash = SessionDefinitionLib.hashDefinition(definition);
        bytes32 versionHash = SessionDefinitionLib.hashVersion(sessionId, 1, definitionHash);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ISessionRegistry.SessionRegistered(
            sessionId, 1, versionHash, definitionHash, definition, RegistryStatus.Paused, registrar
        );

        (SessionId id, uint32 version) = _register(definition);

        assertEq(SessionId.unwrap(id), SessionId.unwrap(sessionId));
        assertEq(version, 1);

        SessionVersion memory record = registry.getSession(id, version);
        assertEq(record.definitionHash, definitionHash);
        assertEq(record.versionHash, versionHash);
        assertEq(record.version, 1);
        assertEq(uint8(record.status), uint8(RegistryStatus.Paused));
        assertEq(record.definition.namespaceId, NAMESPACE_ID);
        assertEq(record.definition.referenceId, REFERENCE_PRIMARY);
        assertEq(CalendarId.unwrap(record.definition.calendarId), CalendarId.unwrap(calendarId));
        assertEq(record.definition.calendarVersion, 1);
        assertEq(record.definition.validFromDay, FROM_DAY);
        assertEq(record.definition.validThroughDay, THROUGH_DAY);
        assertEq(record.definition.dayScheduleRoot, scheduleRoot);
        assertEq(record.definition.windowKindSetHash, WINDOW_KIND_SET_HASH);
        assertEq(record.definition.ruleSetHash, RULE_SET_HASH);
        assertEq(record.definition.sourceHash, SOURCE_HASH);

        assertEq(registry.latestVersion(id), 1);
        assertEq(registry.activeVersion(id), 0);
        assertEq(registry.sessionCount(), 1);
        assertTrue(registry.exists(id, 1));
        assertTrue(registry.isLifecycleEnabled(id, 1));
        assertFalse(registry.isOpenForNewRisk(id, 1, FROM_DAY));
    }

    /// @dev Registration grants no risk authority, so a schedule may be published against a calendar
    /// version that is only Paused, or even one that has already been retired.
    function test_RegisterSucceedsAgainstPausedAndDeprecatedCalendar() public {
        vm.prank(admin);
        calendars.pauseCalendar(calendarId, 1);

        (SessionId id, uint32 firstVersion) = _register(_definition());
        assertEq(firstVersion, 1);

        vm.prank(admin);
        calendars.deprecateCalendar(calendarId, 1);

        SessionDefinition memory revised = _definition();
        revised.dayScheduleRoot = keccak256("revised.root");
        (, uint32 secondVersion) = _register(revised);

        assertEq(secondVersion, 2);
        assertEq(registry.sessionCount(), 2);
        assertTrue(registry.isLifecycleEnabled(id, 1));
        assertTrue(registry.isLifecycleEnabled(id, 2));
    }

    function test_VersionsAreSequentialAndDuplicateDefinitionRejected() public {
        SessionDefinition memory definition = _definition();
        (SessionId id, uint32 first) = _register(definition);

        bytes32 definitionHash = SessionDefinitionLib.hashDefinition(definition);
        vm.expectRevert(
            abi.encodeWithSelector(ISessionRegistry.DuplicateSessionDefinition.selector, id, definitionHash, first)
        );
        vm.prank(registrar);
        registry.registerSession(definition);

        SessionDefinition memory revised = _definition();
        revised.dayScheduleRoot = keccak256("revised.root");
        (, uint32 second) = _register(revised);

        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(registry.latestVersion(id), 2);
        assertEq(registry.sessionCount(), 2);
        assertEq(registry.getSession(id, 1).definition.dayScheduleRoot, scheduleRoot);
        assertEq(registry.getSession(id, 2).definition.dayScheduleRoot, keccak256("revised.root"));
    }

    function test_RoleSeparationIsEnforced() public {
        SessionDefinition memory definition = _definition();

        _expectMissingRole(outsider, registry.SESSION_REGISTRAR_ROLE());
        vm.prank(outsider);
        registry.registerSession(definition);

        _expectMissingRole(statusManager, registry.SESSION_REGISTRAR_ROLE());
        vm.prank(statusManager);
        registry.registerSession(definition);

        (SessionId id, uint32 version) = _register(definition);

        _expectMissingRole(registrar, registry.SESSION_STATUS_MANAGER_ROLE());
        vm.prank(registrar);
        registry.activateSession(id, version);

        _expectMissingRole(outsider, registry.SESSION_STATUS_MANAGER_ROLE());
        vm.prank(outsider);
        registry.deprecateSession(id, version);

        vm.prank(statusManager);
        registry.activateSession(id, version);
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Active));
    }

    function test_TransitionGraphIsEnforced() public {
        (SessionId id, uint32 version) = _register(_definition());

        _expectInvalidTransition(id, version, RegistryStatus.Paused, RegistryStatus.Paused);
        vm.prank(statusManager);
        registry.pauseSession(id, version);

        vm.prank(statusManager);
        registry.activateSession(id, version);

        _expectInvalidTransition(id, version, RegistryStatus.Active, RegistryStatus.Active);
        vm.prank(statusManager);
        registry.activateSession(id, version);

        vm.prank(statusManager);
        registry.pauseSession(id, version);

        vm.prank(statusManager);
        registry.deprecateSession(id, version);

        _expectInvalidTransition(id, version, RegistryStatus.Deprecated, RegistryStatus.Active);
        vm.prank(statusManager);
        registry.activateSession(id, version);

        _expectInvalidTransition(id, version, RegistryStatus.Deprecated, RegistryStatus.Paused);
        vm.prank(statusManager);
        registry.pauseSession(id, version);

        _expectInvalidTransition(id, version, RegistryStatus.Deprecated, RegistryStatus.Deprecated);
        vm.prank(statusManager);
        registry.deprecateSession(id, version);
    }

    function test_OnlyOneVersionActiveAndPauseClearsPointer() public {
        (SessionId id,) = _register(_definition());

        SessionDefinition memory revised = _definition();
        revised.dayScheduleRoot = keccak256("revised.root");
        _register(revised);

        vm.prank(statusManager);
        registry.activateSession(id, 1);
        assertEq(registry.activeVersion(id), 1);

        vm.expectRevert(abi.encodeWithSelector(ISessionRegistry.AnotherSessionVersionActive.selector, id, uint32(1)));
        vm.prank(statusManager);
        registry.activateSession(id, 2);

        assertEq(registry.activeVersion(id), 1);
        assertEq(uint8(registry.statusOf(id, 1)), uint8(RegistryStatus.Active));
        assertEq(uint8(registry.statusOf(id, 2)), uint8(RegistryStatus.Paused));

        vm.expectEmit(true, true, true, true, address(registry));
        emit ISessionRegistry.SessionActiveVersionChanged(id, 1, 0, statusManager);
        vm.prank(statusManager);
        registry.pauseSession(id, 1);

        assertEq(registry.activeVersion(id), 0);

        vm.prank(statusManager);
        registry.activateSession(id, 2);
        assertEq(registry.activeVersion(id), 2);
    }

    function test_DeprecationClearsPointerAndIsTerminal() public {
        (SessionId id, uint32 version) = _register(_definition());

        vm.prank(statusManager);
        registry.activateSession(id, version);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ISessionRegistry.SessionStatusChanged(
            id, version, RegistryStatus.Active, RegistryStatus.Deprecated, statusManager
        );
        vm.prank(statusManager);
        registry.deprecateSession(id, version);

        assertEq(registry.activeVersion(id), 0);
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Deprecated));
        assertTrue(registry.isLifecycleEnabled(id, version));
        assertTrue(registry.coversDay(id, version, FROM_DAY));
        assertFalse(registry.isOpenForNewRisk(id, version, FROM_DAY));
    }

    /// @dev Activation is the fail-closed dependency gate. A registered session whose calendar is no
    /// longer open for new risk cannot be switched on, and the refusal names the dependency.
    function test_ActivationFailsClosedOnCalendarDependency() public {
        (SessionId id, uint32 version) = _register(_definition());

        vm.prank(admin);
        calendars.pauseCalendar(calendarId, 1);

        bytes memory expectedRevert = abi.encodeWithSelector(
            ISessionRegistry.CalendarDependencyNotOpen.selector, calendarId, uint32(1), FROM_DAY, THROUGH_DAY
        );

        vm.expectRevert(expectedRevert);
        vm.prank(statusManager);
        registry.activateSession(id, version);

        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Paused));
        assertEq(registry.activeVersion(id), 0);

        vm.prank(admin);
        calendars.deprecateCalendar(calendarId, 1);

        vm.expectRevert(expectedRevert);
        vm.prank(statusManager);
        registry.activateSession(id, version);

        assertTrue(registry.isLifecycleEnabled(id, version));
    }

    function test_IsOpenForNewRiskRequiresLiveCalendarDependency() public {
        (SessionId id, uint32 version) = _register(_definition());

        vm.prank(statusManager);
        registry.activateSession(id, version);

        assertTrue(registry.isOpenForNewRisk(id, version, FROM_DAY));
        assertTrue(registry.isOpenForNewRisk(id, version, THROUGH_DAY));

        vm.prank(admin);
        calendars.pauseCalendar(calendarId, 1);

        assertFalse(registry.isOpenForNewRisk(id, version, FROM_DAY));
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Active));
        assertTrue(registry.coversDay(id, version, FROM_DAY));
        assertTrue(registry.isLifecycleEnabled(id, version));

        vm.prank(admin);
        calendars.activateCalendar(calendarId, 1);
        assertTrue(registry.isOpenForNewRisk(id, version, FROM_DAY));
    }

    function test_LifecycleAndEvidenceSurviveRetirement() public {
        (SessionId id, uint32 version) = _register(_definition());

        SessionDay[] memory schedule = _schedule();
        bytes32[] memory leaves = _leaves(id);

        vm.startPrank(statusManager);
        registry.activateSession(id, version);
        registry.pauseSession(id, version);
        registry.deprecateSession(id, version);
        vm.stopPrank();

        vm.prank(admin);
        calendars.deprecateCalendar(calendarId, 1);

        assertTrue(registry.isLifecycleEnabled(id, version));
        assertFalse(registry.isOpenForNewRisk(id, version, FROM_DAY));

        for (uint256 i = 0; i < schedule.length; i++) {
            assertTrue(registry.verifyDay(id, version, schedule[i], _proof(leaves, i)));
        }
    }

    function test_CoversDayIsExactlyTheCommittedHorizon() public {
        (SessionId id, uint32 version) = _register(_definition());

        assertFalse(registry.coversDay(id, version, FROM_DAY - 1));
        assertTrue(registry.coversDay(id, version, FROM_DAY));
        assertTrue(registry.coversDay(id, version, THROUGH_DAY));
        assertFalse(registry.coversDay(id, version, THROUGH_DAY + 1));

        vm.prank(statusManager);
        registry.activateSession(id, version);

        assertFalse(registry.isOpenForNewRisk(id, version, FROM_DAY - 1));
        assertTrue(registry.isOpenForNewRisk(id, version, FROM_DAY));
        assertTrue(registry.isOpenForNewRisk(id, version, THROUGH_DAY));
        assertFalse(registry.isOpenForNewRisk(id, version, THROUGH_DAY + 1));
    }

    /// @dev The kind space is open. A tag this deployment has never heard of hashes exactly like a
    /// published one, so a new window kind never needs a redeploy. Cross-kind overlap and a window
    /// that runs past UTC midnight are both legal, because honest venue days need them.
    function test_HashWindowAcceptsOpenKindsOverlapAndMidnightCrossing() public view {
        WindowKindId invented = WindowKindId.wrap(keccak256("SomeVenueKindInventedLater"));

        SessionWindow memory trading = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 48_600, 72_000);
        SessionWindow memory unknown = _window(invented, FROM_DAY, 48_600, 72_000);

        bytes32 tradingHash = registry.hashWindow(trading);
        bytes32 unknownHash = registry.hashWindow(unknown);

        assertTrue(tradingHash != bytes32(0));
        assertTrue(unknownHash != bytes32(0));
        assertTrue(tradingHash != unknownHash);

        assertTrue(WindowKindId.unwrap(SessionDefinitionLib.WINDOW_KIND_TRADING) != bytes32(0));
        assertTrue(
            WindowKindId.unwrap(SessionDefinitionLib.WINDOW_KIND_OBSERVATION)
                != WindowKindId.unwrap(SessionDefinitionLib.WINDOW_KIND_FIXING)
        );
        assertTrue(
            WindowKindId.unwrap(SessionDefinitionLib.WINDOW_KIND_AUCTION)
                != WindowKindId.unwrap(SessionDefinitionLib.WINDOW_KIND_MAINTENANCE)
        );

        SessionWindow[] memory overlapping = _windowsFor(2);
        assertTrue(overlapping[1].opensAt < overlapping[0].closesAt);
        assertTrue(registry.hashWindows(overlapping) != bytes32(0));

        SessionWindow[] memory crossing = _windowsFor(3);
        assertTrue(crossing[0].closesAt > uint64(THROUGH_DAY + 1) * DAY_SECONDS);
        assertTrue(registry.hashWindows(crossing) != bytes32(0));
    }

    /// @dev A closed day is a positive commitment: the empty list hashes to one stable nonzero value
    /// that is distinct from every populated day.
    function test_HashWindowsEmptyListIsStableAndNonzero() public view {
        SessionWindow[] memory empty = new SessionWindow[](0);

        bytes32 first = registry.hashWindows(empty);
        bytes32 second = registry.hashWindows(new SessionWindow[](0));

        assertTrue(first != bytes32(0));
        assertEq(first, second);
        assertEq(
            first,
            keccak256(
                abi.encode(
                    SessionDefinitionLib.SESSION_WINDOW_LIST_TYPEHASH, keccak256(abi.encodePacked(new bytes32[](0)))
                )
            )
        );
        assertTrue(first != registry.hashWindows(_windowsFor(0)));
    }

    function test_HashWindowsRejectsMalformedWindows() public {
        SessionWindow[] memory windows = new SessionWindow[](1);

        windows[0] = _window(WindowKindId.wrap(bytes32(0)), FROM_DAY, 48_600, 72_000);
        vm.expectRevert(ZeroWindowKindId.selector);
        registry.hashWindows(windows);

        windows[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 48_600, 72_000);
        windows[0].policyHash = bytes32(0);
        vm.expectRevert(ZeroWindowPolicyHash.selector);
        registry.hashWindows(windows);

        uint64 base = uint64(FROM_DAY) * DAY_SECONDS;
        windows[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 72_000, 72_000);
        vm.expectRevert(abi.encodeWithSelector(InvalidWindowInterval.selector, base + 72_000, base + 72_000));
        registry.hashWindows(windows);

        windows[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 72_000, 48_600);
        vm.expectRevert(abi.encodeWithSelector(InvalidWindowInterval.selector, base + 72_000, base + 48_600));
        registry.hashWindows(windows);
    }

    function test_HashWindowsRejectsOversizedUnsortedAndDuplicateLists() public {
        SessionWindow[] memory oversized = new SessionWindow[](SessionDefinitionLib.MAX_SESSION_WINDOWS + 1);
        for (uint256 i = 0; i < oversized.length; i++) {
            oversized[i] =
                _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, uint64(3_600 * i), uint64(3_600 * i) + 600);
        }
        vm.expectRevert(abi.encodeWithSelector(TooManyWindows.selector, oversized.length));
        registry.hashWindows(oversized);

        SessionWindow[] memory sorted = new SessionWindow[](SessionDefinitionLib.MAX_SESSION_WINDOWS);
        for (uint256 i = 0; i < sorted.length; i++) {
            sorted[i] = oversized[i];
        }
        assertTrue(registry.hashWindows(sorted) != bytes32(0));

        SessionWindow[] memory unsorted = new SessionWindow[](2);
        unsorted[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 48_600, 72_000);
        unsorted[1] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 30_000, 40_000);
        vm.expectRevert(abi.encodeWithSelector(UnorderedSessionWindows.selector, uint256(1)));
        registry.hashWindows(unsorted);

        SessionWindow[] memory sameOpen = new SessionWindow[](2);
        sameOpen[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 48_600, 72_000);
        sameOpen[1] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 48_600, 60_000);
        vm.expectRevert(abi.encodeWithSelector(UnorderedSessionWindows.selector, uint256(1)));
        registry.hashWindows(sameOpen);

        SessionWindow[] memory duplicated = new SessionWindow[](2);
        duplicated[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 48_600, 72_000);
        duplicated[1] = duplicated[0];
        vm.expectRevert(abi.encodeWithSelector(DuplicateSessionWindow.selector, uint256(1)));
        registry.hashWindows(duplicated);
    }

    function test_HashDayRejectsZeroHashesButVerifyDayReturnsFalse() public {
        (SessionId id, uint32 version) = _register(_definition());
        bytes32[] memory leaves = _leaves(id);

        SessionDay memory noWindows =
            SessionDay({day: FROM_DAY, windowsHash: bytes32(0), evidenceHash: keccak256("session.evidence.0")});
        vm.expectRevert(ZeroWindowsHash.selector);
        registry.hashDay(id, noWindows);
        assertFalse(registry.verifyDay(id, version, noWindows, _proof(leaves, 0)));

        SessionDay memory noEvidence =
            SessionDay({day: FROM_DAY, windowsHash: registry.hashWindows(_windowsFor(0)), evidenceHash: bytes32(0)});
        vm.expectRevert(ZeroSessionEvidenceHash.selector);
        registry.hashDay(id, noEvidence);
        assertFalse(registry.verifyDay(id, version, noEvidence, _proof(leaves, 0)));
    }

    function test_VerifyDayAcceptsEveryCommittedLeafAndRejectsTampering() public {
        (SessionId id, uint32 version) = _register(_definition());

        SessionDay[] memory schedule = _schedule();
        bytes32[] memory leaves = _leaves(id);

        for (uint256 i = 0; i < schedule.length; i++) {
            assertTrue(registry.verifyDay(id, version, schedule[i], _proof(leaves, i)));
        }

        SessionDay memory tamperedWindows = _copyDay(schedule[0]);
        tamperedWindows.windowsHash = registry.hashWindows(_windowsFor(2));
        assertFalse(registry.verifyDay(id, version, tamperedWindows, _proof(leaves, 0)));

        SessionDay memory tamperedEvidence = _copyDay(schedule[1]);
        tamperedEvidence.evidenceHash = keccak256("other.evidence");
        assertFalse(registry.verifyDay(id, version, tamperedEvidence, _proof(leaves, 1)));

        SessionDay memory outOfHorizon = _copyDay(schedule[0]);
        outOfHorizon.day = THROUGH_DAY + 1;
        assertFalse(registry.verifyDay(id, version, outOfHorizon, _proof(leaves, 0)));

        assertFalse(registry.verifyDay(id, version, schedule[0], _proof(leaves, 1)));
        assertFalse(registry.verifyDay(_sessionIdFor(REFERENCE_SECONDARY), version, schedule[0], _proof(leaves, 0)));
    }

    /// @dev A single-leaf schedule needs an empty proof, which is the degenerate case an offchain
    /// builder is most likely to get wrong.
    function test_VerifyDayHandlesSingleLeafSchedules() public {
        SessionId id = _sessionIdFor(REFERENCE_SECONDARY);

        SessionDay memory only = SessionDay({
            day: FROM_DAY,
            windowsHash: registry.hashWindows(new SessionWindow[](0)),
            evidenceHash: keccak256("session.evidence.only")
        });

        SessionDefinition memory definition = _definition();
        definition.referenceId = REFERENCE_SECONDARY;
        definition.dayScheduleRoot = registry.hashDay(id, only);

        (SessionId registered, uint32 version) = _register(definition);
        assertEq(SessionId.unwrap(registered), SessionId.unwrap(id));

        bytes32[] memory emptyProof = new bytes32[](0);
        assertTrue(registry.verifyDay(id, version, only, emptyProof));

        SessionDay memory moved = _copyDay(only);
        moved.day = FROM_DAY + 1;
        assertFalse(registry.verifyDay(id, version, moved, emptyProof));
    }

    function test_UnknownRecordsUseSentinelsAndRevert() public {
        (SessionId id,) = _register(_definition());
        uint32 unknownVersion = 2;

        assertEq(uint8(registry.statusOf(id, unknownVersion)), uint8(RegistryStatus.Unspecified));
        assertFalse(registry.exists(id, unknownVersion));
        assertFalse(registry.isLifecycleEnabled(id, unknownVersion));
        assertFalse(registry.coversDay(id, unknownVersion, FROM_DAY));
        assertFalse(registry.isOpenForNewRisk(id, unknownVersion, FROM_DAY));
        assertFalse(registry.verifyDay(id, unknownVersion, _schedule()[0], _proof(_leaves(id), 0)));
        assertEq(registry.latestVersion(_sessionIdFor(REFERENCE_SECONDARY)), 0);
        assertEq(registry.activeVersion(_sessionIdFor(REFERENCE_SECONDARY)), 0);

        bytes memory expectedRevert =
            abi.encodeWithSelector(ISessionRegistry.UnknownSessionVersion.selector, id, unknownVersion);

        vm.expectRevert(expectedRevert);
        registry.getSession(id, unknownVersion);

        vm.startPrank(statusManager);
        vm.expectRevert(expectedRevert);
        registry.activateSession(id, unknownVersion);

        vm.expectRevert(expectedRevert);
        registry.pauseSession(id, unknownVersion);

        vm.expectRevert(expectedRevert);
        registry.deprecateSession(id, unknownVersion);
        vm.stopPrank();
    }

    function _calendarDefinition() internal pure returns (CalendarDefinition memory) {
        return CalendarDefinition({
            namespaceId: CALENDAR_NAMESPACE_ID,
            referenceId: CALENDAR_REFERENCE_ID,
            timeZoneId: keccak256("America/New_York"),
            weekendMask: 0x60,
            validFromDay: CALENDAR_FROM_DAY,
            validThroughDay: CALENDAR_THROUGH_DAY,
            dayStatusRoot: keccak256("calendar.root.v1"),
            ruleSetHash: keccak256("calendar.ruleset.v1"),
            sourceHash: keccak256("calendar.source.v1")
        });
    }

    function _revisedCalendarDefinition() internal pure returns (CalendarDefinition memory definition) {
        definition = _calendarDefinition();
        definition.dayStatusRoot = keccak256("calendar.root.v2");
    }

    function _definition() internal view returns (SessionDefinition memory) {
        return SessionDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: REFERENCE_PRIMARY,
            calendarId: calendarId,
            calendarVersion: 1,
            validFromDay: FROM_DAY,
            validThroughDay: THROUGH_DAY,
            dayScheduleRoot: scheduleRoot,
            windowKindSetHash: WINDOW_KIND_SET_HASH,
            ruleSetHash: RULE_SET_HASH,
            sourceHash: SOURCE_HASH
        });
    }

    function _register(SessionDefinition memory definition) internal returns (SessionId id, uint32 version) {
        vm.prank(registrar);
        (id, version) = registry.registerSession(definition);
    }

    function _expectRegisterRevert(SessionDefinition memory definition, bytes4 selector) internal {
        vm.expectRevert(selector);
        vm.prank(registrar);
        registry.registerSession(definition);
    }

    function _expectInvalidTransition(
        SessionId id,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionRegistry.InvalidSessionTransition.selector, id, version, previousStatus, newStatus
            )
        );
    }

    function _expectMissingRole(address account, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role));
    }

    function _sessionIdFor(bytes32 referenceId) internal pure returns (SessionId) {
        return IdLib.deriveSessionId(
            keccak256(abi.encode(SessionDefinitionLib.SESSION_KEY_TYPEHASH, NAMESPACE_ID, referenceId))
        );
    }

    /// @dev A memory struct assignment aliases rather than copies, so a tamper case must build a
    /// fresh value instead of mutating the fixture it came from.
    function _copyDay(SessionDay memory sessionDay) internal pure returns (SessionDay memory) {
        return
            SessionDay({
                day: sessionDay.day, windowsHash: sessionDay.windowsHash, evidenceHash: sessionDay.evidenceHash
            });
    }

    function _window(WindowKindId kindId, uint32 day, uint64 openOffset, uint64 closeOffset)
        internal
        pure
        returns (SessionWindow memory)
    {
        uint64 base = uint64(day) * DAY_SECONDS;
        return SessionWindow({
            kindId: kindId,
            opensAt: base + openOffset,
            closesAt: base + closeOffset,
            policyHash: keccak256(abi.encode("session.policy", WindowKindId.unwrap(kindId)))
        });
    }

    /// @dev Four fixture days: a plain trading day, a closed day, a day whose fixing window sits
    /// inside its trading window, and a day whose single window crosses UTC midnight.
    function _windowsFor(uint256 index) internal pure returns (SessionWindow[] memory windows) {
        if (index == 0) {
            windows = new SessionWindow[](1);
            windows[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY, 48_600, 72_000);
            return windows;
        }
        if (index == 1) {
            return new SessionWindow[](0);
        }
        if (index == 2) {
            windows = new SessionWindow[](2);
            windows[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, FROM_DAY + 2, 48_600, 72_000);
            windows[1] = _window(SessionDefinitionLib.WINDOW_KIND_FIXING, FROM_DAY + 2, 71_400, 72_000);
            return windows;
        }

        windows = new SessionWindow[](1);
        windows[0] = _window(SessionDefinitionLib.WINDOW_KIND_TRADING, THROUGH_DAY, 79_200, DAY_SECONDS + 21_600);
    }

    function _scheduleDay(uint256 index) internal pure returns (uint32) {
        if (index == 0) {
            return FROM_DAY;
        }
        if (index == 1) {
            return FROM_DAY + 1;
        }
        if (index == 2) {
            return FROM_DAY + 2;
        }
        return THROUGH_DAY;
    }

    function _schedule() internal view returns (SessionDay[] memory schedule) {
        schedule = new SessionDay[](4);
        for (uint256 i = 0; i < schedule.length; i++) {
            schedule[i] = SessionDay({
                day: _scheduleDay(i),
                windowsHash: registry.hashWindows(_windowsFor(i)),
                evidenceHash: keccak256(abi.encode("session.evidence", i))
            });
        }
    }

    function _leaves(SessionId id) internal view returns (bytes32[] memory leaves) {
        SessionDay[] memory schedule = _schedule();
        leaves = new bytes32[](schedule.length);
        for (uint256 i = 0; i < schedule.length; i++) {
            leaves[i] = registry.hashDay(id, schedule[i]);
        }
    }

    /// @dev A minimal sorted-pair Merkle builder over a power-of-two leaf count. It mirrors the
    /// OpenZeppelin MerkleProof pair ordering, which is what the registry verifies against.
    function _root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            bytes32[] memory next = new bytes32[](level.length / 2);
            for (uint256 i = 0; i < next.length; i++) {
                next[i] = _hashPair(level[2 * i], level[2 * i + 1]);
            }
            level = next;
        }
        return level[0];
    }

    function _proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory proof) {
        uint256 depth = 0;
        for (uint256 width = leaves.length; width > 1; width /= 2) {
            depth++;
        }

        proof = new bytes32[](depth);
        bytes32[] memory level = leaves;
        uint256 position = index;

        for (uint256 d = 0; d < depth; d++) {
            proof[d] = level[position ^ 1];

            bytes32[] memory next = new bytes32[](level.length / 2);
            for (uint256 i = 0; i < next.length; i++) {
                next[i] = _hashPair(level[2 * i], level[2 * i + 1]);
            }
            level = next;
            position /= 2;
        }
    }

    function _hashPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return left < right ? keccak256(abi.encode(left, right)) : keccak256(abi.encode(right, left));
    }
}
