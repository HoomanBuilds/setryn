// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {
    CalendarDefinitionLib,
    EmptyBusinessWeek,
    InvalidCalendarHorizon,
    InvalidWeekendMask,
    ZeroCalendarNamespaceId,
    ZeroCalendarReferenceId,
    ZeroCalendarSourceHash,
    ZeroDayStatusRoot,
    ZeroEvidenceHash,
    ZeroRuleSetHash,
    ZeroTimeZoneId
} from "../../src/libraries/CalendarDefinitionLib.sol";
import {IdLib} from "../../src/libraries/IdLib.sol";
import {CalendarRegistry} from "../../src/registry/CalendarRegistry.sol";
import {CalendarDay, CalendarDefinition, CalendarVersion} from "../../src/types/CalendarDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {CalendarId} from "../../src/types/Identifiers.sol";

contract CalendarRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.calendar");
    bytes32 internal constant REFERENCE_PRIMARY = keccak256("us:settlement");
    bytes32 internal constant REFERENCE_SECONDARY = keccak256("uk:settlement");
    bytes32 internal constant TIME_ZONE_ID = keccak256("America/New_York");
    bytes32 internal constant RULE_SET_HASH = keccak256("ruleset.v1");
    bytes32 internal constant SOURCE_HASH = keccak256("source.v1");

    /// @dev Saturday and Sunday. Bits 0 through 6 are Monday through Sunday.
    uint8 internal constant WEEKEND_SAT_SUN = 0x60;

    uint32 internal constant FROM_DAY = 20_000;
    uint32 internal constant THROUGH_DAY = 20_364;

    address internal admin = makeAddr("admin");
    address internal registrar = makeAddr("registrar");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

    CalendarRegistry internal registry;

    CalendarId internal calendarId;
    bytes32 internal scheduleRoot;

    function setUp() public {
        registry = new CalendarRegistry(ADMIN_DELAY, admin);

        vm.startPrank(admin);
        registry.grantRole(registry.CALENDAR_REGISTRAR_ROLE(), registrar);
        registry.grantRole(registry.CALENDAR_STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();

        calendarId = _calendarIdFor(REFERENCE_PRIMARY);
        scheduleRoot = _root(_leaves(calendarId));
    }

    function test_TypestringsMatchTheirTypehashes() public pure {
        assertEq(
            keccak256(bytes(CalendarDefinitionLib.CALENDAR_KEY_TYPESTRING)), CalendarDefinitionLib.CALENDAR_KEY_TYPEHASH
        );
        assertEq(
            keccak256(bytes(CalendarDefinitionLib.CALENDAR_DEFINITION_TYPESTRING)),
            CalendarDefinitionLib.CALENDAR_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(CalendarDefinitionLib.CALENDAR_VERSION_TYPESTRING)),
            CalendarDefinitionLib.CALENDAR_VERSION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(CalendarDefinitionLib.CALENDAR_DAY_TYPESTRING)), CalendarDefinitionLib.CALENDAR_DAY_TYPEHASH
        );
    }

    function test_RoleConstantsAreFrozenAndDistinct() public view {
        assertEq(registry.CALENDAR_REGISTRAR_ROLE(), keccak256(bytes("SETRYN_CALENDAR_REGISTRAR_ROLE")));
        assertEq(registry.CALENDAR_STATUS_MANAGER_ROLE(), keccak256(bytes("SETRYN_CALENDAR_STATUS_MANAGER_ROLE")));
        assertTrue(registry.CALENDAR_REGISTRAR_ROLE() != registry.CALENDAR_STATUS_MANAGER_ROLE());
        assertTrue(registry.CALENDAR_REGISTRAR_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.CALENDAR_STATUS_MANAGER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
    }

    function test_ConstructorGrantsOperationalRolesToInitialAdmin() public {
        CalendarRegistry fresh = new CalendarRegistry(ADMIN_DELAY, admin);

        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.CALENDAR_REGISTRAR_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.CALENDAR_STATUS_MANAGER_ROLE(), admin));
        assertEq(fresh.defaultAdmin(), admin);
        assertEq(fresh.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(fresh.calendarCount(), 0);
    }

    function test_ConstructorRejectsZeroInitialAdmin() public {
        vm.expectRevert(ICalendarRegistry.ZeroInitialAdmin.selector);
        new CalendarRegistry(ADMIN_DELAY, address(0));
    }

    /// @dev The V1 key commits namespace and reference alone, so republishing a schedule with a new
    /// horizon, a corrected root, and a different methodology must land on the same lineage.
    function test_CalendarIdIsStableAcrossScheduleRevisions() public {
        CalendarDefinition memory first = _definition();
        CalendarDefinition memory revised = _definition();
        revised.weekendMask = 0;
        revised.timeZoneId = keccak256("Europe/London");
        revised.validFromDay = THROUGH_DAY + 1;
        revised.validThroughDay = THROUGH_DAY + 365;
        revised.dayStatusRoot = keccak256("revised.root");
        revised.ruleSetHash = keccak256("ruleset.v2");
        revised.sourceHash = keccak256("source.v2");

        (CalendarId firstId, uint32 firstVersion) = _register(first);
        (CalendarId revisedId, uint32 revisedVersion) = _register(revised);

        assertEq(CalendarId.unwrap(firstId), CalendarId.unwrap(revisedId));
        assertEq(
            CalendarId.unwrap(firstId), CalendarId.unwrap(IdLib.deriveCalendarId(CalendarDefinitionLib.hashKey(first)))
        );
        assertEq(firstVersion, 1);
        assertEq(revisedVersion, 2);
        assertTrue(registry.getCalendar(firstId, 1).definitionHash != registry.getCalendar(firstId, 2).definitionHash);
    }

    function test_RegisterRejectsZeroFields() public {
        _expectRegisterRevert(_withNamespace(bytes32(0)), ZeroCalendarNamespaceId.selector);
        _expectRegisterRevert(_withReference(bytes32(0)), ZeroCalendarReferenceId.selector);

        CalendarDefinition memory definition = _definition();
        definition.timeZoneId = bytes32(0);
        _expectRegisterRevert(definition, ZeroTimeZoneId.selector);

        definition = _definition();
        definition.dayStatusRoot = bytes32(0);
        _expectRegisterRevert(definition, ZeroDayStatusRoot.selector);

        definition = _definition();
        definition.ruleSetHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroRuleSetHash.selector);

        definition = _definition();
        definition.sourceHash = bytes32(0);
        _expectRegisterRevert(definition, ZeroCalendarSourceHash.selector);

        assertEq(registry.calendarCount(), 0);
    }

    function test_RegisterRejectsMalformedWeekendMask() public {
        CalendarDefinition memory definition = _definition();
        definition.weekendMask = 0x80;
        vm.expectRevert(abi.encodeWithSelector(InvalidWeekendMask.selector, uint8(0x80)));
        vm.prank(registrar);
        registry.registerCalendar(definition);

        definition.weekendMask = type(uint8).max;
        vm.expectRevert(abi.encodeWithSelector(InvalidWeekendMask.selector, type(uint8).max));
        vm.prank(registrar);
        registry.registerCalendar(definition);

        definition.weekendMask = 0x7f;
        vm.expectRevert(abi.encodeWithSelector(EmptyBusinessWeek.selector, uint8(0x7f)));
        vm.prank(registrar);
        registry.registerCalendar(definition);
    }

    /// @dev A zero mask is the 24/7 calendar, which is a legitimate schedule rather than a mistake.
    function test_RegisterAcceptsContinuousCalendarMask() public {
        CalendarDefinition memory definition = _definition();
        definition.weekendMask = 0;

        (CalendarId id, uint32 version) = _register(definition);

        assertEq(registry.getCalendar(id, version).definition.weekendMask, 0);
    }

    function test_RegisterEnforcesHorizonBounds() public {
        CalendarDefinition memory inverted = _definition();
        inverted.validFromDay = THROUGH_DAY;
        inverted.validThroughDay = FROM_DAY;
        vm.expectRevert(abi.encodeWithSelector(InvalidCalendarHorizon.selector, THROUGH_DAY, FROM_DAY));
        vm.prank(registrar);
        registry.registerCalendar(inverted);

        CalendarDefinition memory single = _definition();
        single.validFromDay = FROM_DAY;
        single.validThroughDay = FROM_DAY;
        (CalendarId id, uint32 version) = _register(single);

        assertTrue(registry.coversDay(id, version, FROM_DAY));
        assertFalse(registry.coversDay(id, version, FROM_DAY + 1));
    }

    function test_RegistrationLandsPausedAndStoresCompleteRecord() public {
        CalendarDefinition memory definition = _definition();
        (CalendarId id, uint32 version) = _register(definition);

        CalendarVersion memory record = registry.getCalendar(id, version);

        assertEq(uint8(record.status), uint8(RegistryStatus.Paused));
        assertEq(record.version, 1);
        assertEq(record.definitionHash, CalendarDefinitionLib.hashDefinition(definition));
        assertEq(record.versionHash, CalendarDefinitionLib.hashVersion(id, 1, record.definitionHash));
        assertEq(record.definition.namespaceId, NAMESPACE_ID);
        assertEq(record.definition.referenceId, REFERENCE_PRIMARY);
        assertEq(record.definition.timeZoneId, TIME_ZONE_ID);
        assertEq(record.definition.weekendMask, WEEKEND_SAT_SUN);
        assertEq(record.definition.validFromDay, FROM_DAY);
        assertEq(record.definition.validThroughDay, THROUGH_DAY);
        assertEq(record.definition.dayStatusRoot, scheduleRoot);
        assertEq(record.definition.ruleSetHash, RULE_SET_HASH);
        assertEq(record.definition.sourceHash, SOURCE_HASH);

        assertEq(registry.latestVersion(id), 1);
        assertEq(registry.activeVersion(id), 0);
        assertEq(registry.calendarCount(), 1);
        assertTrue(registry.exists(id, 1));
    }

    function test_RegistrationEmitsCompleteEvent() public {
        CalendarDefinition memory definition = _definition();
        bytes32 definitionHash = CalendarDefinitionLib.hashDefinition(definition);
        bytes32 versionHash = CalendarDefinitionLib.hashVersion(calendarId, 1, definitionHash);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ICalendarRegistry.CalendarRegistered(
            calendarId, 1, versionHash, definitionHash, definition, RegistryStatus.Paused, registrar
        );

        vm.prank(registrar);
        registry.registerCalendar(definition);
    }

    function test_VersionsAreSequentialAndHistoryIsImmutable() public {
        CalendarDefinition memory first = _definition();
        (CalendarId id,) = _register(first);

        CalendarDefinition memory second = _definition();
        second.dayStatusRoot = keccak256("second.root");
        _register(second);

        CalendarDefinition memory third = _definition();
        third.validThroughDay = THROUGH_DAY + 365;
        _register(third);

        assertEq(registry.latestVersion(id), 3);
        assertEq(registry.calendarCount(), 3);
        assertEq(registry.getCalendar(id, 1).definitionHash, CalendarDefinitionLib.hashDefinition(first));
        assertEq(registry.getCalendar(id, 1).definition.dayStatusRoot, scheduleRoot);
        assertEq(registry.getCalendar(id, 2).definition.dayStatusRoot, keccak256("second.root"));
        assertEq(registry.getCalendar(id, 3).definition.validThroughDay, THROUGH_DAY + 365);
    }

    function test_DuplicateDefinitionIsRejected() public {
        CalendarDefinition memory definition = _definition();
        (CalendarId id,) = _register(definition);

        vm.expectRevert(
            abi.encodeWithSelector(
                ICalendarRegistry.DuplicateCalendarDefinition.selector,
                id,
                CalendarDefinitionLib.hashDefinition(definition),
                uint32(1)
            )
        );
        vm.prank(registrar);
        registry.registerCalendar(definition);

        assertEq(registry.latestVersion(id), 1);
        assertEq(registry.calendarCount(), 1);
    }

    /// @dev The counter is forced to its ceiling directly, because reaching it by registration is
    /// not executable. The slot is discovered through the getter rather than hardcoded, so inherited
    /// storage layout changes cannot silently point this at the wrong word.
    function test_VersionExhaustionRevertsWithNamedErrorInsteadOfPanicking() public {
        (CalendarId id,) = _register(_definition());

        vm.record();
        registry.latestVersion(id);
        (bytes32[] memory readSlots,) = vm.accesses(address(registry));
        vm.store(address(registry), readSlots[0], bytes32(uint256(type(uint32).max)));

        assertEq(registry.latestVersion(id), type(uint32).max);

        CalendarDefinition memory next = _definition();
        next.dayStatusRoot = keccak256("next.root");

        vm.expectRevert(abi.encodeWithSelector(ICalendarRegistry.CalendarVersionExhausted.selector, id));
        vm.prank(registrar);
        registry.registerCalendar(next);

        assertEq(registry.calendarCount(), 1);
    }

    function test_RolesAreSeparated() public {
        (CalendarId id, uint32 version) = _register(_definition());

        bytes32 statusRole = registry.CALENDAR_STATUS_MANAGER_ROLE();
        bytes32 registrarRole = registry.CALENDAR_REGISTRAR_ROLE();

        assertFalse(registry.hasRole(statusRole, registrar));
        assertFalse(registry.hasRole(registrarRole, statusManager));

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, statusRole)
        );
        vm.prank(registrar);
        registry.activateCalendar(id, version);

        CalendarDefinition memory other = _definition();
        other.dayStatusRoot = keccak256("other.root");
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, statusManager, registrarRole
            )
        );
        vm.prank(statusManager);
        registry.registerCalendar(other);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, statusRole)
        );
        vm.prank(outsider);
        registry.pauseCalendar(id, version);
    }

    function test_TransitionGraphIsEnforced() public {
        (CalendarId id, uint32 version) = _register(_definition());

        _expectInvalidTransition(id, version, RegistryStatus.Paused, RegistryStatus.Paused);
        vm.prank(statusManager);
        registry.pauseCalendar(id, version);

        vm.prank(statusManager);
        registry.activateCalendar(id, version);
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Active));

        _expectInvalidTransition(id, version, RegistryStatus.Active, RegistryStatus.Active);
        vm.prank(statusManager);
        registry.activateCalendar(id, version);

        vm.prank(statusManager);
        registry.pauseCalendar(id, version);
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Paused));

        vm.prank(statusManager);
        registry.deprecateCalendar(id, version);
        assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Deprecated));

        _expectInvalidTransition(id, version, RegistryStatus.Deprecated, RegistryStatus.Active);
        vm.prank(statusManager);
        registry.activateCalendar(id, version);

        _expectInvalidTransition(id, version, RegistryStatus.Deprecated, RegistryStatus.Paused);
        vm.prank(statusManager);
        registry.pauseCalendar(id, version);

        _expectInvalidTransition(id, version, RegistryStatus.Deprecated, RegistryStatus.Deprecated);
        vm.prank(statusManager);
        registry.deprecateCalendar(id, version);
    }

    /// @dev Activating a second version must fail loudly. Silently pausing the live one would move
    /// the whole protocol onto a new schedule inside a single transaction nobody reviewed as such.
    function test_AtMostOneVersionIsActive() public {
        (CalendarId id,) = _register(_definition());
        CalendarDefinition memory second = _definition();
        second.dayStatusRoot = keccak256("second.root");
        _register(second);

        vm.prank(statusManager);
        registry.activateCalendar(id, 1);

        vm.expectRevert(abi.encodeWithSelector(ICalendarRegistry.AnotherCalendarVersionActive.selector, id, uint32(1)));
        vm.prank(statusManager);
        registry.activateCalendar(id, 2);

        assertEq(registry.activeVersion(id), 1);
        assertEq(uint8(registry.statusOf(id, 1)), uint8(RegistryStatus.Active));
        assertEq(uint8(registry.statusOf(id, 2)), uint8(RegistryStatus.Paused));
    }

    function test_PausingOrDeprecatingActiveClearsThePointer() public {
        (CalendarId id,) = _register(_definition());
        CalendarDefinition memory second = _definition();
        second.dayStatusRoot = keccak256("second.root");
        _register(second);

        vm.startPrank(statusManager);
        registry.activateCalendar(id, 1);

        vm.expectEmit(true, false, false, true, address(registry));
        emit ICalendarRegistry.CalendarActiveVersionChanged(id, 1, 0, statusManager);
        registry.pauseCalendar(id, 1);
        assertEq(registry.activeVersion(id), 0);

        registry.activateCalendar(id, 2);
        assertEq(registry.activeVersion(id), 2);

        registry.deprecateCalendar(id, 2);
        assertEq(registry.activeVersion(id), 0);

        registry.activateCalendar(id, 1);
        assertEq(registry.activeVersion(id), 1);
        vm.stopPrank();

        assertEq(uint8(registry.statusOf(id, 2)), uint8(RegistryStatus.Deprecated));
    }

    function test_CoversDayHonorsHorizonBoundariesRegardlessOfStatus() public {
        (CalendarId id, uint32 version) = _register(_definition());

        assertFalse(registry.coversDay(id, version, FROM_DAY - 1));
        assertTrue(registry.coversDay(id, version, FROM_DAY));
        assertTrue(registry.coversDay(id, version, THROUGH_DAY));
        assertFalse(registry.coversDay(id, version, THROUGH_DAY + 1));

        vm.startPrank(statusManager);
        registry.activateCalendar(id, version);
        assertTrue(registry.coversDay(id, version, FROM_DAY));
        registry.deprecateCalendar(id, version);
        vm.stopPrank();

        assertTrue(registry.coversDay(id, version, FROM_DAY));
        assertTrue(registry.coversDay(id, version, THROUGH_DAY));
        assertFalse(registry.coversDay(id, version, THROUGH_DAY + 1));
    }

    function test_NewRiskRequiresActivePointerAndHorizon() public {
        (CalendarId id,) = _register(_definition());
        CalendarDefinition memory second = _definition();
        second.dayStatusRoot = keccak256("second.root");
        _register(second);

        assertFalse(registry.isOpenForNewRisk(id, 1, FROM_DAY));

        vm.prank(statusManager);
        registry.activateCalendar(id, 1);

        assertTrue(registry.isOpenForNewRisk(id, 1, FROM_DAY));
        assertTrue(registry.isOpenForNewRisk(id, 1, THROUGH_DAY));
        assertFalse(registry.isOpenForNewRisk(id, 1, THROUGH_DAY + 1));
        assertFalse(registry.isOpenForNewRisk(id, 2, FROM_DAY));

        vm.prank(statusManager);
        registry.pauseCalendar(id, 1);
        assertFalse(registry.isOpenForNewRisk(id, 1, FROM_DAY));
    }

    function test_LifecycleStaysEnabledForEveryRegisteredVersion() public {
        (CalendarId id,) = _register(_definition());
        CalendarDefinition memory second = _definition();
        second.dayStatusRoot = keccak256("second.root");
        _register(second);

        assertTrue(registry.isLifecycleEnabled(id, 1));
        assertTrue(registry.isLifecycleEnabled(id, 2));

        vm.startPrank(statusManager);
        registry.activateCalendar(id, 1);
        registry.deprecateCalendar(id, 1);
        vm.stopPrank();

        assertTrue(registry.isLifecycleEnabled(id, 1));
        assertFalse(registry.isOpenForNewRisk(id, 1, FROM_DAY));
        assertFalse(registry.isLifecycleEnabled(id, 3));
    }

    function test_VerifyDaySucceedsForSingleLeafAndMultiLeafTrees() public {
        (CalendarId id, uint32 version) = _register(_definition());

        CalendarDay[] memory schedule = _schedule();
        bytes32[] memory leaves = _leaves(id);

        for (uint256 i = 0; i < schedule.length; i++) {
            assertTrue(registry.verifyDay(id, version, schedule[i], _proof(leaves, i)));
            assertEq(registry.hashDay(id, schedule[i]), leaves[i]);
        }

        CalendarDefinition memory single = _definition();
        single.referenceId = REFERENCE_SECONDARY;
        CalendarId singleId = _calendarIdFor(REFERENCE_SECONDARY);
        CalendarDay memory only = CalendarDay({day: FROM_DAY, isBusinessDay: true, evidenceHash: keccak256("only")});
        single.dayStatusRoot = CalendarDefinitionLib.hashDay(singleId, only);
        (, uint32 singleVersion) = _register(single);

        assertTrue(registry.verifyDay(singleId, singleVersion, only, new bytes32[](0)));
    }

    function test_VerifyDayRejectsWrongCalendarDayStatusEvidenceAndProof() public {
        (CalendarId id, uint32 version) = _register(_definition());

        CalendarDefinition memory other = _definition();
        other.referenceId = REFERENCE_SECONDARY;
        other.dayStatusRoot = scheduleRoot;
        (CalendarId otherId, uint32 otherVersion) = _register(other);

        CalendarDay[] memory schedule = _schedule();
        bytes32[] memory leaves = _leaves(id);
        bytes32[] memory proof = _proof(leaves, 0);

        assertTrue(registry.verifyDay(id, version, schedule[0], proof));

        assertFalse(registry.verifyDay(otherId, otherVersion, schedule[0], proof));

        CalendarDay memory flipped = _copy(schedule[0]);
        flipped.isBusinessDay = !flipped.isBusinessDay;
        assertFalse(registry.verifyDay(id, version, flipped, proof));

        CalendarDay memory reevidenced = _copy(schedule[0]);
        reevidenced.evidenceHash = keccak256("forged");
        assertFalse(registry.verifyDay(id, version, reevidenced, proof));

        assertFalse(registry.verifyDay(id, version, schedule[1], proof));

        bytes32[] memory forgedProof = _proof(leaves, 0);
        forgedProof[0] = keccak256("forged.sibling");
        assertFalse(registry.verifyDay(id, version, schedule[0], forgedProof));

        CalendarDay memory outside = _copy(schedule[0]);
        outside.day = THROUGH_DAY + 1;
        assertFalse(registry.verifyDay(id, version, outside, proof));
    }

    /// @dev Settlement, unwind, and receipt replay of an already open position must keep resolving
    /// after the schedule stops taking new risk, so proofs are deliberately status independent.
    function test_ProofsStayValidWhilePausedAndDeprecated() public {
        (CalendarId id, uint32 version) = _register(_definition());

        CalendarDay[] memory schedule = _schedule();
        bytes32[] memory proof = _proof(_leaves(id), 2);

        assertTrue(registry.verifyDay(id, version, schedule[2], proof));

        vm.startPrank(statusManager);
        registry.activateCalendar(id, version);
        assertTrue(registry.verifyDay(id, version, schedule[2], proof));

        registry.pauseCalendar(id, version);
        assertTrue(registry.verifyDay(id, version, schedule[2], proof));

        registry.deprecateCalendar(id, version);
        vm.stopPrank();

        assertTrue(registry.verifyDay(id, version, schedule[2], proof));
        assertFalse(registry.isOpenForNewRisk(id, version, schedule[2].day));
    }

    function test_UnknownVersionsUseSentinelsAndRevertOnMutation() public {
        (CalendarId id,) = _register(_definition());
        uint32 unknownVersion = 7;

        assertEq(uint8(registry.statusOf(id, unknownVersion)), uint8(RegistryStatus.Unspecified));
        assertFalse(registry.exists(id, unknownVersion));
        assertFalse(registry.isLifecycleEnabled(id, unknownVersion));
        assertFalse(registry.coversDay(id, unknownVersion, FROM_DAY));
        assertFalse(registry.isOpenForNewRisk(id, unknownVersion, FROM_DAY));
        assertFalse(registry.verifyDay(id, unknownVersion, _schedule()[0], _proof(_leaves(id), 0)));
        assertEq(registry.activeVersion(_calendarIdFor(REFERENCE_SECONDARY)), 0);
        assertEq(registry.latestVersion(_calendarIdFor(REFERENCE_SECONDARY)), 0);

        bytes memory expectedRevert =
            abi.encodeWithSelector(ICalendarRegistry.UnknownCalendarVersion.selector, id, unknownVersion);

        vm.expectRevert(expectedRevert);
        registry.getCalendar(id, unknownVersion);

        vm.startPrank(statusManager);
        vm.expectRevert(expectedRevert);
        registry.activateCalendar(id, unknownVersion);

        vm.expectRevert(expectedRevert);
        registry.pauseCalendar(id, unknownVersion);

        vm.expectRevert(expectedRevert);
        registry.deprecateCalendar(id, unknownVersion);
        vm.stopPrank();
    }

    function test_HashDayRejectsZeroEvidenceButVerifyDayReturnsFalse() public {
        (CalendarId id, uint32 version) = _register(_definition());

        CalendarDay memory blank = CalendarDay({day: FROM_DAY, isBusinessDay: true, evidenceHash: bytes32(0)});

        vm.expectRevert(ZeroEvidenceHash.selector);
        registry.hashDay(id, blank);

        assertFalse(registry.verifyDay(id, version, blank, _proof(_leaves(id), 0)));
    }

    function _definition() internal view returns (CalendarDefinition memory) {
        return CalendarDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: REFERENCE_PRIMARY,
            timeZoneId: TIME_ZONE_ID,
            weekendMask: WEEKEND_SAT_SUN,
            validFromDay: FROM_DAY,
            validThroughDay: THROUGH_DAY,
            dayStatusRoot: scheduleRoot,
            ruleSetHash: RULE_SET_HASH,
            sourceHash: SOURCE_HASH
        });
    }

    function _withNamespace(bytes32 namespaceId) internal view returns (CalendarDefinition memory definition) {
        definition = _definition();
        definition.namespaceId = namespaceId;
    }

    function _withReference(bytes32 referenceId) internal view returns (CalendarDefinition memory definition) {
        definition = _definition();
        definition.referenceId = referenceId;
    }

    function _register(CalendarDefinition memory definition) internal returns (CalendarId id, uint32 version) {
        vm.prank(registrar);
        (id, version) = registry.registerCalendar(definition);
    }

    function _expectRegisterRevert(CalendarDefinition memory definition, bytes4 selector) internal {
        vm.expectRevert(selector);
        vm.prank(registrar);
        registry.registerCalendar(definition);
    }

    function _expectInvalidTransition(
        CalendarId id,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                ICalendarRegistry.InvalidCalendarTransition.selector, id, version, previousStatus, newStatus
            )
        );
    }

    function _calendarIdFor(bytes32 referenceId) internal pure returns (CalendarId) {
        return IdLib.deriveCalendarId(
            keccak256(abi.encode(CalendarDefinitionLib.CALENDAR_KEY_TYPEHASH, NAMESPACE_ID, referenceId))
        );
    }

    /// @dev A memory struct assignment aliases rather than copies, so a tamper case must build a
    /// fresh value instead of mutating the fixture it came from.
    function _copy(CalendarDay memory calendarDay) internal pure returns (CalendarDay memory) {
        return CalendarDay({
            day: calendarDay.day, isBusinessDay: calendarDay.isBusinessDay, evidenceHash: calendarDay.evidenceHash
        });
    }

    function _schedule() internal pure returns (CalendarDay[] memory schedule) {
        schedule = new CalendarDay[](4);
        schedule[0] = CalendarDay({day: FROM_DAY, isBusinessDay: true, evidenceHash: keccak256("evidence.0")});
        schedule[1] = CalendarDay({day: FROM_DAY + 1, isBusinessDay: false, evidenceHash: keccak256("evidence.1")});
        schedule[2] = CalendarDay({day: FROM_DAY + 2, isBusinessDay: true, evidenceHash: keccak256("evidence.2")});
        schedule[3] = CalendarDay({day: THROUGH_DAY, isBusinessDay: false, evidenceHash: keccak256("evidence.3")});
    }

    function _leaves(CalendarId id) internal pure returns (bytes32[] memory leaves) {
        CalendarDay[] memory schedule = _schedule();
        leaves = new bytes32[](schedule.length);
        for (uint256 i = 0; i < schedule.length; i++) {
            leaves[i] = CalendarDefinitionLib.hashDay(id, schedule[i]);
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
