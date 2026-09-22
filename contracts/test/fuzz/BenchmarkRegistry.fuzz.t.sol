// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {
    BenchmarkConfidenceOutOfRange,
    BenchmarkDecimalsOutOfRange,
    BenchmarkDefinitionLib
} from "../../src/libraries/BenchmarkDefinitionLib.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {BenchmarkRegistry} from "../../src/registry/BenchmarkRegistry.sol";
import {CalendarRegistry} from "../../src/registry/CalendarRegistry.sol";
import {SessionRegistry} from "../../src/registry/SessionRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {BenchmarkDefinition} from "../../src/types/BenchmarkDefinition.sol";
import {CalendarDefinition} from "../../src/types/CalendarDefinition.sol";
import {AssetClass} from "../../src/types/Enums.sol";
import {AdapterId, AssetId, BenchmarkId, BenchmarkKindId, CalendarId, SessionId} from "../../src/types/Identifiers.sol";
import {SessionDefinition} from "../../src/types/SessionDefinition.sol";
import {MAX_DECIMALS} from "../../src/types/Units.sol";
import {MockAdapterImplementation} from "../mocks/AdapterMocks.sol";

contract BenchmarkRegistryFuzzTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.benchmark");
    bytes32 internal constant REFERENCE_ID = keccak256("fx:eurusd:wmr16");
    bytes32 internal constant INTERFACE_HASH = keccak256("benchmark.adapter.interface.v1");
    bytes32 internal constant CAPABILITY_HASH = keccak256("benchmark.adapter.capability.v1");

    uint32 internal constant CALENDAR_FROM_DAY = 20_000;
    uint32 internal constant CALENDAR_THROUGH_DAY = 20_364;
    uint32 internal constant SESSION_FROM_DAY = 20_010;
    uint32 internal constant SESSION_THROUGH_DAY = 20_100;

    address internal admin = makeAddr("admin");

    AssetRegistry internal assets;
    AdapterRegistry internal adapters;
    CalendarRegistry internal calendars;
    SessionRegistry internal sessions;
    BenchmarkRegistry internal registry;

    address internal implementation;

    AssetId internal baseAssetId;
    AssetId internal quoteAssetId;
    AdapterId internal adapterId;
    CalendarId internal calendarId;
    SessionId internal sessionId;
    BenchmarkId internal benchmarkId;

    function setUp() public {
        assets = new AssetRegistry(ADMIN_DELAY, admin);
        adapters = new AdapterRegistry(ADMIN_DELAY, admin);
        calendars = new CalendarRegistry(ADMIN_DELAY, admin);
        sessions = new SessionRegistry(ADMIN_DELAY, admin, calendars);
        registry = new BenchmarkRegistry(ADMIN_DELAY, admin, assets, adapters, calendars, sessions);

        implementation = address(new MockAdapterImplementation());

        vm.startPrank(admin);
        baseAssetId = assets.registerAsset(_assetDefinition(keccak256("iso4217:EUR"), "EUR"));
        quoteAssetId = assets.registerAsset(_assetDefinition(keccak256("iso4217:USD"), "USD"));

        (adapterId,) = adapters.registerAdapter(_adapterDefinition());
        adapters.activateAdapter(adapterId, 1);

        (calendarId,) = calendars.registerCalendar(_calendarDefinition());
        calendars.activateCalendar(calendarId, 1);

        (sessionId,) = sessions.registerSession(_sessionDefinition());
        sessions.activateSession(sessionId, 1);
        vm.stopPrank();

        benchmarkId = BenchmarkDefinitionLib.deriveBenchmarkId(_definition());
    }

    /// @dev Identity is the namespaced reference, the kind, and the ordered pair alone. No revision
    /// of a dependency version, a feed, a validity bound, or a policy may split one lineage, while
    /// the kind space is open, so any two distinct nonzero tags are always two lineages of their own.
    function testFuzz_IdentityIgnoresQualificationAndSplitsOnKind(
        uint32 adapterVersion,
        uint32 calendarVersion,
        uint32 sessionVersion,
        bytes32 feedKey,
        uint8 outputDecimals,
        uint32 maxStalenessSeconds,
        uint16 maxConfidenceBps,
        bytes32 fallbackPolicyHash,
        bytes32 firstKind,
        bytes32 secondKind
    ) public view {
        vm.assume(firstKind != bytes32(0) && secondKind != bytes32(0) && firstKind != secondKind);

        BenchmarkDefinition memory revised = _definition();
        revised.adapterVersion = adapterVersion;
        revised.calendarVersion = calendarVersion;
        revised.sessionVersion = sessionVersion;
        revised.feedKey = feedKey;
        revised.outputDecimals = outputDecimals;
        revised.maxStalenessSeconds = maxStalenessSeconds;
        revised.maxConfidenceBps = maxConfidenceBps;
        revised.fallbackPolicyHash = fallbackPolicyHash;

        assertEq(BenchmarkId.unwrap(benchmarkId), BenchmarkId.unwrap(BenchmarkDefinitionLib.deriveBenchmarkId(revised)));

        BenchmarkDefinition memory first = _definition();
        first.kindId = BenchmarkKindId.wrap(firstKind);

        BenchmarkDefinition memory second = _definition();
        second.kindId = BenchmarkKindId.wrap(secondKind);

        BenchmarkId firstId = BenchmarkDefinitionLib.deriveBenchmarkId(first);
        BenchmarkId secondId = BenchmarkDefinitionLib.deriveBenchmarkId(second);

        assertTrue(BenchmarkId.unwrap(firstId) != bytes32(0));
        assertTrue(BenchmarkId.unwrap(firstId) != BenchmarkId.unwrap(secondId));
        assertEq(BenchmarkId.unwrap(firstId), BenchmarkId.unwrap(registry.deriveBenchmarkId(first)));
    }

    /// @dev The live gate is closed on every day outside the session horizon and open on every day
    /// inside it while all dependencies are open, with no benchmark horizon field of its own.
    function testFuzz_LiveGateFollowsTheSessionHorizon(uint32 day) public {
        vm.prank(admin);
        registry.registerBenchmark(_definition());
        vm.prank(admin);
        registry.activateBenchmark(benchmarkId, 1);

        bool inside = day >= SESSION_FROM_DAY && day <= SESSION_THROUGH_DAY;

        assertEq(registry.coversDay(benchmarkId, 1, day), inside);
        assertEq(registry.isOpenForNewRisk(benchmarkId, 1, day), inside);
    }

    /// @dev Output decimals and confidence are hard bounds, so every value above them is refused and
    /// every value at or below them is accepted, with no silent clamping in either direction.
    function testFuzz_DecimalsAndConfidenceBoundsAreExact(uint8 outputDecimals, uint16 maxConfidenceBps) public {
        BenchmarkDefinition memory definition = _definition();
        definition.outputDecimals = outputDecimals;
        definition.maxConfidenceBps = maxConfidenceBps;

        vm.prank(admin);
        if (outputDecimals > MAX_DECIMALS) {
            vm.expectRevert(abi.encodeWithSelector(BenchmarkDecimalsOutOfRange.selector, outputDecimals));
            registry.registerBenchmark(definition);
            return;
        }
        if (maxConfidenceBps > 10_000) {
            vm.expectRevert(abi.encodeWithSelector(BenchmarkConfidenceOutOfRange.selector, maxConfidenceBps));
            registry.registerBenchmark(definition);
            return;
        }

        (, uint32 version) = registry.registerBenchmark(definition);
        assertEq(version, 1);
    }

    function _assetDefinition(bytes32 referenceId, bytes32 symbol) private pure returns (AssetDefinition memory) {
        return AssetDefinition({
            namespaceId: keccak256("setryn.asset"),
            referenceId: referenceId,
            symbol: symbol,
            assetClass: AssetClass.Fx,
            decimals: 2
        });
    }

    function _adapterDefinition() private view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: keccak256("setryn.adapter"),
            referenceId: keccak256("oracle.primary"),
            kindId: AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
            implementation: implementation,
            expectedRuntimeCodeHash: implementation.codehash,
            interfaceHash: INTERFACE_HASH,
            capabilityHash: CAPABILITY_HASH,
            configurationSchemaHash: keccak256("adapter.config.v1"),
            evidenceHash: keccak256("adapter.evidence.v1")
        });
    }

    function _calendarDefinition() private pure returns (CalendarDefinition memory) {
        return CalendarDefinition({
            namespaceId: keccak256("setryn.calendar"),
            referenceId: keccak256("fx:global"),
            timeZoneId: keccak256("Etc/UTC"),
            weekendMask: 0x60,
            validFromDay: CALENDAR_FROM_DAY,
            validThroughDay: CALENDAR_THROUGH_DAY,
            dayStatusRoot: keccak256("calendar.root.v1"),
            ruleSetHash: keccak256("calendar.ruleset.v1"),
            sourceHash: keccak256("calendar.source.v1")
        });
    }

    function _sessionDefinition() private view returns (SessionDefinition memory) {
        return SessionDefinition({
            namespaceId: keccak256("setryn.session"),
            referenceId: keccak256("fx:global"),
            calendarId: calendarId,
            calendarVersion: 1,
            validFromDay: SESSION_FROM_DAY,
            validThroughDay: SESSION_THROUGH_DAY,
            dayScheduleRoot: keccak256("session.root.v1"),
            windowKindSetHash: keccak256("session.kindset.v1"),
            ruleSetHash: keccak256("session.ruleset.v1"),
            sourceHash: keccak256("session.source.v1")
        });
    }

    function _definition() private view returns (BenchmarkDefinition memory) {
        return BenchmarkDefinition({
            namespaceId: NAMESPACE_ID,
            referenceId: REFERENCE_ID,
            kindId: BenchmarkDefinitionLib.BENCHMARK_KIND_SPOT,
            baseAssetId: baseAssetId,
            quoteAssetId: quoteAssetId,
            adapterId: adapterId,
            adapterVersion: 1,
            calendarId: calendarId,
            calendarVersion: 1,
            sessionId: sessionId,
            sessionVersion: 1,
            feedKey: keccak256("feed.eurusd.v1"),
            requiredInterfaceHash: INTERFACE_HASH,
            requiredCapabilityHash: CAPABILITY_HASH,
            outputDecimals: 18,
            maxStalenessSeconds: 60,
            maxFutureSkewSeconds: 5,
            maxConfidenceBps: 50,
            observationRuleHash: keccak256("benchmark.observation.v1"),
            fallbackPolicyHash: keccak256("benchmark.fallback.v1"),
            disruptionPolicyHash: keccak256("benchmark.disruption.v1"),
            dataRightsHash: keccak256("benchmark.rights.v1"),
            evidenceHash: keccak256("benchmark.evidence.v1")
        });
    }
}
