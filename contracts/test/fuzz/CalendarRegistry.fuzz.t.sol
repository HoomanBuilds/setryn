// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {CalendarDefinitionLib} from "../../src/libraries/CalendarDefinitionLib.sol";
import {CalendarRegistry} from "../../src/registry/CalendarRegistry.sol";
import {CalendarDay, CalendarDefinition} from "../../src/types/CalendarDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {CalendarId} from "../../src/types/Identifiers.sol";

contract CalendarRegistryFuzzTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.calendar");
    bytes32 internal constant REFERENCE_ID = keccak256("us:settlement");
    bytes32 internal constant TIME_ZONE_ID = keccak256("America/New_York");
    bytes32 internal constant RULE_SET_HASH = keccak256("ruleset.v1");
    bytes32 internal constant SOURCE_HASH = keccak256("source.v1");
    bytes32 internal constant DAY_STATUS_ROOT = keccak256("root.v1");

    address internal admin = makeAddr("admin");

    CalendarRegistry internal registry;

    function setUp() public {
        registry = new CalendarRegistry(ADMIN_DELAY, admin);
    }

    /// @dev Identity is the namespace and reference pair alone, so no revision of the schedule, the
    /// horizon, the timezone, the mask, or the provenance may ever split one lineage into two.
    function testFuzz_CalendarIdIgnoresNonIdentityFields(
        bytes32 timeZoneId,
        uint8 weekendMask,
        uint32 validFromDay,
        uint32 validThroughDay,
        bytes32 dayStatusRoot,
        bytes32 ruleSetHash,
        bytes32 sourceHash
    ) public {
        vm.assume(timeZoneId != bytes32(0));
        vm.assume(dayStatusRoot != bytes32(0) && dayStatusRoot != DAY_STATUS_ROOT);
        vm.assume(ruleSetHash != bytes32(0));
        vm.assume(sourceHash != bytes32(0));
        weekendMask = uint8(bound(weekendMask, 0, CalendarDefinitionLib.WEEKEND_MASK_MAX - 1));
        if (validFromDay > validThroughDay) {
            (validFromDay, validThroughDay) = (validThroughDay, validFromDay);
        }

        CalendarDefinition memory baseline = _definition();

        CalendarDefinition memory revised = _definition();
        revised.timeZoneId = timeZoneId;
        revised.weekendMask = weekendMask;
        revised.validFromDay = validFromDay;
        revised.validThroughDay = validThroughDay;
        revised.dayStatusRoot = dayStatusRoot;
        revised.ruleSetHash = ruleSetHash;
        revised.sourceHash = sourceHash;

        vm.startPrank(admin);
        (CalendarId baselineId, uint32 baselineVersion) = registry.registerCalendar(baseline);
        (CalendarId revisedId, uint32 revisedVersion) = registry.registerCalendar(revised);
        vm.stopPrank();

        assertEq(CalendarId.unwrap(baselineId), CalendarId.unwrap(revisedId));
        assertEq(baselineVersion, 1);
        assertEq(revisedVersion, 2);
        assertEq(registry.calendarCount(), 2);
    }

    /// @dev Versions are sequential, land Paused, and never overwrite an earlier record.
    function testFuzz_VersionsAreSequentialAndPaused(bytes32[4] memory rootSeeds) public {
        bytes32 previousRoot = DAY_STATUS_ROOT;

        for (uint256 i = 0; i < rootSeeds.length; i++) {
            bytes32 root = keccak256(abi.encode(rootSeeds[i], i));
            vm.assume(root != previousRoot);

            CalendarDefinition memory definition = _definition();
            definition.dayStatusRoot = root;

            vm.prank(admin);
            (CalendarId id, uint32 version) = registry.registerCalendar(definition);

            assertEq(version, uint32(i + 1));
            assertEq(registry.latestVersion(id), version);
            assertEq(registry.activeVersion(id), 0);
            assertEq(uint8(registry.statusOf(id, version)), uint8(RegistryStatus.Paused));
            assertEq(registry.getCalendar(id, version).definition.dayStatusRoot, root);

            if (i > 0) {
                assertTrue(registry.getCalendar(id, 1).definition.dayStatusRoot != root);
            }

            previousRoot = root;
        }

        assertEq(registry.calendarCount(), rootSeeds.length);
    }

    /// @dev coversDay is exactly the committed horizon and never depends on status, while
    /// isOpenForNewRisk additionally requires the active pointer.
    function testFuzz_CoversDayMatchesHorizonIndependentOfStatus(uint32 validFromDay, uint32 span, uint32 day) public {
        validFromDay = uint32(bound(validFromDay, 0, type(uint32).max - 1));
        span = uint32(bound(span, 0, type(uint32).max - validFromDay));
        uint32 validThroughDay = validFromDay + span;

        CalendarDefinition memory definition = _definition();
        definition.validFromDay = validFromDay;
        definition.validThroughDay = validThroughDay;

        vm.prank(admin);
        (CalendarId id, uint32 version) = registry.registerCalendar(definition);

        bool inHorizon = day >= validFromDay && day <= validThroughDay;

        assertEq(registry.coversDay(id, version, day), inHorizon);
        assertFalse(registry.isOpenForNewRisk(id, version, day));

        vm.prank(admin);
        registry.activateCalendar(id, version);
        assertEq(registry.coversDay(id, version, day), inHorizon);
        assertEq(registry.isOpenForNewRisk(id, version, day), inHorizon);

        vm.prank(admin);
        registry.deprecateCalendar(id, version);
        assertEq(registry.coversDay(id, version, day), inHorizon);
        assertFalse(registry.isOpenForNewRisk(id, version, day));
        assertTrue(registry.isLifecycleEnabled(id, version));
    }

    /// @dev A single-leaf schedule verifies only its own exact classification. Any change to the
    /// day, the business-day flag, or the evidence produces a different leaf and fails.
    function testFuzz_VerifyDayRejectsTamperedLeaves(
        uint32 day,
        bool isBusinessDay,
        bytes32 evidenceHash,
        uint32 otherDay,
        bytes32 otherEvidenceHash
    ) public {
        vm.assume(evidenceHash != bytes32(0));
        vm.assume(otherEvidenceHash != bytes32(0) && otherEvidenceHash != evidenceHash);
        vm.assume(otherDay != day);

        CalendarId id = CalendarDefinitionLib.deriveCalendarId(_definition());
        CalendarDay memory committed = CalendarDay({day: day, isBusinessDay: isBusinessDay, evidenceHash: evidenceHash});

        CalendarDefinition memory definition = _definition();
        definition.validFromDay = 0;
        definition.validThroughDay = type(uint32).max;
        definition.dayStatusRoot = CalendarDefinitionLib.hashDay(id, committed);

        vm.prank(admin);
        (, uint32 version) = registry.registerCalendar(definition);

        bytes32[] memory emptyProof = new bytes32[](0);

        assertTrue(registry.verifyDay(id, version, committed, emptyProof));

        CalendarDay memory flipped = CalendarDay({day: day, isBusinessDay: !isBusinessDay, evidenceHash: evidenceHash});
        assertFalse(registry.verifyDay(id, version, flipped, emptyProof));

        CalendarDay memory moved =
            CalendarDay({day: otherDay, isBusinessDay: isBusinessDay, evidenceHash: evidenceHash});
        assertFalse(registry.verifyDay(id, version, moved, emptyProof));

        CalendarDay memory reevidenced =
            CalendarDay({day: day, isBusinessDay: isBusinessDay, evidenceHash: otherEvidenceHash});
        assertFalse(registry.verifyDay(id, version, reevidenced, emptyProof));

        assertFalse(registry.verifyDay(id, version + 1, committed, emptyProof));
    }

    function _definition() internal pure returns (CalendarDefinition memory) {
        return CalendarDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: REFERENCE_ID,
            timeZoneId: TIME_ZONE_ID,
            weekendMask: 0x60,
            validFromDay: 20_000,
            validThroughDay: 20_364,
            dayStatusRoot: DAY_STATUS_ROOT,
            ruleSetHash: RULE_SET_HASH,
            sourceHash: SOURCE_HASH
        });
    }
}
