// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {
    BenchmarkConfidenceOutOfRange,
    BenchmarkDecimalsOutOfRange,
    BenchmarkDefinitionLib,
    IdenticalBenchmarkAssets,
    ZeroBenchmarkAdapterId,
    ZeroBenchmarkAdapterVersion,
    ZeroBenchmarkBaseAssetId,
    ZeroBenchmarkCalendarId,
    ZeroBenchmarkCalendarVersion,
    ZeroBenchmarkDataRightsHash,
    ZeroBenchmarkDisruptionPolicyHash,
    ZeroBenchmarkEvidenceHash,
    ZeroBenchmarkFallbackPolicyHash,
    ZeroBenchmarkFeedKey,
    ZeroBenchmarkKindId,
    ZeroBenchmarkMaxStalenessSeconds,
    ZeroBenchmarkNamespaceId,
    ZeroBenchmarkObservationRuleHash,
    ZeroBenchmarkQuoteAssetId,
    ZeroBenchmarkReferenceId,
    ZeroBenchmarkRequiredCapabilityHash,
    ZeroBenchmarkRequiredInterfaceHash,
    ZeroBenchmarkSessionId,
    ZeroBenchmarkSessionVersion
} from "../../src/libraries/BenchmarkDefinitionLib.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {BenchmarkRegistry} from "../../src/registry/BenchmarkRegistry.sol";
import {CalendarRegistry} from "../../src/registry/CalendarRegistry.sol";
import {SessionRegistry} from "../../src/registry/SessionRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {BenchmarkDefinition, BenchmarkVersion} from "../../src/types/BenchmarkDefinition.sol";
import {CalendarDefinition} from "../../src/types/CalendarDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {
    AdapterId,
    AdapterKindId,
    AssetId,
    BenchmarkId,
    BenchmarkKindId,
    CalendarId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {SessionDefinition} from "../../src/types/SessionDefinition.sol";
import {MAX_DECIMALS} from "../../src/types/Units.sol";
import {MockAdapterImplementation, MockDriftedAdapterImplementation} from "../mocks/AdapterMocks.sol";

contract BenchmarkRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.benchmark");
    bytes32 internal constant REFERENCE_PRIMARY = keccak256("fx:eurusd:wmr16");

    bytes32 internal constant FEED_KEY = keccak256("feed.eurusd.v1");
    bytes32 internal constant INTERFACE_HASH = keccak256("benchmark.adapter.interface.v1");
    bytes32 internal constant CAPABILITY_HASH = keccak256("benchmark.adapter.capability.v1");
    bytes32 internal constant OBSERVATION_RULE_HASH = keccak256("benchmark.observation.v1");
    bytes32 internal constant FALLBACK_POLICY_HASH = keccak256("benchmark.fallback.v1");
    bytes32 internal constant DISRUPTION_POLICY_HASH = keccak256("benchmark.disruption.v1");
    bytes32 internal constant DATA_RIGHTS_HASH = keccak256("benchmark.rights.v1");
    bytes32 internal constant EVIDENCE_HASH = keccak256("benchmark.evidence.v1");

    uint32 internal constant CALENDAR_FROM_DAY = 20_000;
    uint32 internal constant CALENDAR_THROUGH_DAY = 20_364;
    uint32 internal constant SESSION_FROM_DAY = 20_010;
    uint32 internal constant SESSION_THROUGH_DAY = 20_100;

    /// @dev One entry per required nonzero field of a definition, in the order `validate` checks
    /// them, so the table below and `_definitionWithZeroField` stay a single aligned sweep.
    uint256 internal constant ZERO_FIELD_COUNT = 19;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

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
        registry.grantRole(registry.BENCHMARK_QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.BENCHMARK_STATUS_MANAGER_ROLE(), statusManager);

        baseAssetId = assets.registerAsset(_assetDefinition(keccak256("iso4217:EUR"), "EUR", AssetClass.Fx, 2));
        quoteAssetId = assets.registerAsset(_assetDefinition(keccak256("iso4217:USD"), "USD", AssetClass.Fx, 2));

        (adapterId,) = adapters.registerAdapter(_adapterDefinition(AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK));
        adapters.activateAdapter(adapterId, 1);

        (calendarId,) = calendars.registerCalendar(_calendarDefinition());
        calendars.activateCalendar(calendarId, 1);

        (sessionId,) = sessions.registerSession(_sessionDefinition(keccak256("fx:global"), 1));
        sessions.activateSession(sessionId, 1);
        vm.stopPrank();

        benchmarkId = BenchmarkDefinitionLib.deriveBenchmarkId(_definition());
    }

    /// @dev Every hashing rule is versioned inside its own literal and every published kind tag is a
    /// convenience constant over an open bytes32 space, never an enum, so all three literal sets must
    /// be frozen and the tags must never collide.
    function test_ConstantsAreFrozenAndDistinct() public view {
        assertEq(
            keccak256(bytes(BenchmarkDefinitionLib.BENCHMARK_KEY_TYPESTRING)),
            BenchmarkDefinitionLib.BENCHMARK_KEY_TYPEHASH
        );
        assertEq(
            keccak256(bytes(BenchmarkDefinitionLib.BENCHMARK_DEFINITION_TYPESTRING)),
            BenchmarkDefinitionLib.BENCHMARK_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(BenchmarkDefinitionLib.BENCHMARK_VERSION_TYPESTRING)),
            BenchmarkDefinitionLib.BENCHMARK_VERSION_TYPEHASH
        );

        BenchmarkKindId[7] memory kinds = [
            BenchmarkDefinitionLib.BENCHMARK_KIND_SPOT,
            BenchmarkDefinitionLib.BENCHMARK_KIND_PERPETUAL_MARK,
            BenchmarkDefinitionLib.BENCHMARK_KIND_INDEX,
            BenchmarkDefinitionLib.BENCHMARK_KIND_NAV,
            BenchmarkDefinitionLib.BENCHMARK_KIND_REDEMPTION,
            BenchmarkDefinitionLib.BENCHMARK_KIND_REFERENCE_RATE,
            BenchmarkDefinitionLib.BENCHMARK_KIND_SETTLEMENT_FIXING
        ];

        assertEq(BenchmarkKindId.unwrap(kinds[0]), keccak256(bytes("SetrynBenchmarkKindV1:Spot")));
        assertEq(BenchmarkKindId.unwrap(kinds[3]), keccak256(bytes("SetrynBenchmarkKindV1:NAV")));
        assertEq(BenchmarkKindId.unwrap(kinds[6]), keccak256(bytes("SetrynBenchmarkKindV1:SettlementFixing")));

        for (uint256 i = 0; i < kinds.length; i++) {
            assertTrue(BenchmarkKindId.unwrap(kinds[i]) != bytes32(0));
            for (uint256 j = i + 1; j < kinds.length; j++) {
                assertTrue(BenchmarkKindId.unwrap(kinds[i]) != BenchmarkKindId.unwrap(kinds[j]));
            }
        }

        assertEq(registry.BENCHMARK_QUALIFIER_ROLE(), keccak256(bytes("SETRYN_BENCHMARK_QUALIFIER_ROLE")));
        assertEq(registry.BENCHMARK_STATUS_MANAGER_ROLE(), keccak256(bytes("SETRYN_BENCHMARK_STATUS_MANAGER_ROLE")));
        assertTrue(registry.BENCHMARK_QUALIFIER_ROLE() != registry.BENCHMARK_STATUS_MANAGER_ROLE());
        assertTrue(registry.BENCHMARK_QUALIFIER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.BENCHMARK_STATUS_MANAGER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
    }

    function test_ConstructorWiresDependenciesAndGrantsRoles() public {
        BenchmarkRegistry fresh = new BenchmarkRegistry(ADMIN_DELAY, admin, assets, adapters, calendars, sessions);

        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.BENCHMARK_QUALIFIER_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.BENCHMARK_STATUS_MANAGER_ROLE(), admin));
        assertEq(fresh.defaultAdmin(), admin);
        assertEq(fresh.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(address(fresh.assetRegistry()), address(assets));
        assertEq(address(fresh.adapterRegistry()), address(adapters));
        assertEq(address(fresh.calendarRegistry()), address(calendars));
        assertEq(address(fresh.sessionRegistry()), address(sessions));
        assertEq(fresh.benchmarkCount(), 0);
    }

    /// @dev The last case is the one that is not merely a zero check: a session registry built on a
    /// different calendar deployment would let a benchmark pin a calendar version its own session was
    /// never checked against, so the wiring is refused rather than left to close later.
    function test_ConstructorRejectsZeroAdminUndeployedAndMismatchedDependencies() public {
        vm.expectRevert(IBenchmarkRegistry.ZeroInitialAdmin.selector);
        new BenchmarkRegistry(ADMIN_DELAY, address(0), assets, adapters, calendars, sessions);

        vm.expectRevert(IBenchmarkRegistry.ZeroAssetRegistry.selector);
        new BenchmarkRegistry(ADMIN_DELAY, admin, AssetRegistry(address(0)), adapters, calendars, sessions);
        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.AssetRegistryHasNoCode.selector, outsider));
        new BenchmarkRegistry(ADMIN_DELAY, admin, AssetRegistry(outsider), adapters, calendars, sessions);

        vm.expectRevert(IBenchmarkRegistry.ZeroAdapterRegistry.selector);
        new BenchmarkRegistry(ADMIN_DELAY, admin, assets, AdapterRegistry(address(0)), calendars, sessions);
        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.AdapterRegistryHasNoCode.selector, outsider));
        new BenchmarkRegistry(ADMIN_DELAY, admin, assets, AdapterRegistry(outsider), calendars, sessions);

        vm.expectRevert(IBenchmarkRegistry.ZeroCalendarRegistry.selector);
        new BenchmarkRegistry(ADMIN_DELAY, admin, assets, adapters, CalendarRegistry(address(0)), sessions);
        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.CalendarRegistryHasNoCode.selector, outsider));
        new BenchmarkRegistry(ADMIN_DELAY, admin, assets, adapters, CalendarRegistry(outsider), sessions);

        vm.expectRevert(IBenchmarkRegistry.ZeroSessionRegistry.selector);
        new BenchmarkRegistry(ADMIN_DELAY, admin, assets, adapters, calendars, SessionRegistry(address(0)));
        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.SessionRegistryHasNoCode.selector, outsider));
        new BenchmarkRegistry(ADMIN_DELAY, admin, assets, adapters, calendars, SessionRegistry(outsider));

        CalendarRegistry otherCalendars = new CalendarRegistry(ADMIN_DELAY, admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.DependencyGraphMismatch.selector, address(otherCalendars), address(calendars)
            )
        );
        new BenchmarkRegistry(ADMIN_DELAY, admin, assets, adapters, otherCalendars, sessions);
    }

    /// @dev The V1 key commits namespace, reference, kind, and the ordered pair alone. Re-qualifying
    /// against a replacement adapter, a different session, a new feed, or a corrected policy lands on
    /// the same lineage under a new version, while changing the kind or either leg of the pair mints a
    /// different lineage that starts again at version one.
    function test_BenchmarkIdIsStableAcrossRevisionsAndSplitsOnIdentityFields() public {
        vm.startPrank(admin);
        (, uint32 secondAdapterVersion) = adapters.registerAdapter(_revisedAdapterDefinition());
        (SessionId secondSessionId,) = sessions.registerSession(_sessionDefinition(keccak256("fx:asia"), 1));
        vm.stopPrank();

        BenchmarkDefinition memory revised = _definition();
        revised.adapterVersion = secondAdapterVersion;
        revised.sessionId = secondSessionId;
        revised.sessionVersion = 1;
        revised.feedKey = keccak256("feed.eurusd.v2");
        revised.maxStalenessSeconds = 90;
        revised.fallbackPolicyHash = keccak256("benchmark.fallback.v2");

        BenchmarkDefinition memory inventedKind = _definition();
        inventedKind.kindId = BenchmarkKindId.wrap(keccak256("acme.kind:WeatherIndexV7"));

        BenchmarkDefinition memory flippedPair = _definition();
        flippedPair.baseAssetId = quoteAssetId;
        flippedPair.quoteAssetId = baseAssetId;

        vm.startPrank(qualifier);
        (BenchmarkId firstId, uint32 firstVersion) = registry.registerBenchmark(_definition());
        (BenchmarkId secondId, uint32 secondVersion) = registry.registerBenchmark(revised);
        (BenchmarkId inventedId, uint32 inventedVersion) = registry.registerBenchmark(inventedKind);
        (BenchmarkId flippedId, uint32 flippedVersion) = registry.registerBenchmark(flippedPair);
        vm.stopPrank();

        assertEq(BenchmarkId.unwrap(firstId), BenchmarkId.unwrap(secondId));
        assertEq(firstVersion, 1);
        assertEq(secondVersion, 2);
        assertEq(registry.latestVersion(firstId), 2);

        assertTrue(BenchmarkId.unwrap(firstId) != BenchmarkId.unwrap(inventedId));
        assertTrue(BenchmarkId.unwrap(firstId) != BenchmarkId.unwrap(flippedId));
        assertTrue(BenchmarkId.unwrap(inventedId) != BenchmarkId.unwrap(flippedId));
        assertEq(inventedVersion, 1);
        assertEq(flippedVersion, 1);
        assertEq(registry.benchmarkCount(), 4);
    }

    /// @dev Identity is chain portable; the qualification commitment is not, because adapter,
    /// calendar, and session versions are chain-local operational dependencies. The definition hash is
    /// split across two abi.encode calls only to keep twenty-four static values off one stack frame,
    /// so it must still commit exactly the tuple the typestring describes.
    function test_DefinitionHashesBindChainIdAndMatchUnsplitEncoding() public view {
        BenchmarkDefinition memory definition = _definition();

        bytes32 here = BenchmarkDefinitionLib.hashDefinition(definition, block.chainid);
        bytes32 elsewhere = BenchmarkDefinitionLib.hashDefinition(definition, block.chainid + 1);
        assertTrue(here != elsewhere);
        assertEq(here, BenchmarkDefinitionLib.hashDefinitionUnsplit(definition, block.chainid));

        assertTrue(
            BenchmarkDefinitionLib.hashVersion(benchmarkId, 1, here, block.chainid)
                != BenchmarkDefinitionLib.hashVersion(benchmarkId, 1, here, block.chainid + 1)
        );
        assertTrue(
            BenchmarkDefinitionLib.hashVersion(benchmarkId, 1, here, block.chainid)
                != BenchmarkDefinitionLib.hashVersion(benchmarkId, 2, here, block.chainid)
        );
        assertEq(
            BenchmarkId.unwrap(BenchmarkDefinitionLib.deriveBenchmarkId(definition)),
            BenchmarkId.unwrap(registry.deriveBenchmarkId(definition))
        );
    }

    /// @dev Every identifier, every dependency version number, and every commitment hash is required,
    /// so the whole set is swept as one table against the error each field must raise by itself.
    function test_RegistrationRejectsZeroDefinitionFields() public {
        bytes4[ZERO_FIELD_COUNT] memory expected = [
            ZeroBenchmarkNamespaceId.selector,
            ZeroBenchmarkReferenceId.selector,
            ZeroBenchmarkKindId.selector,
            ZeroBenchmarkBaseAssetId.selector,
            ZeroBenchmarkQuoteAssetId.selector,
            ZeroBenchmarkAdapterId.selector,
            ZeroBenchmarkAdapterVersion.selector,
            ZeroBenchmarkCalendarId.selector,
            ZeroBenchmarkCalendarVersion.selector,
            ZeroBenchmarkSessionId.selector,
            ZeroBenchmarkSessionVersion.selector,
            ZeroBenchmarkFeedKey.selector,
            ZeroBenchmarkRequiredInterfaceHash.selector,
            ZeroBenchmarkRequiredCapabilityHash.selector,
            ZeroBenchmarkObservationRuleHash.selector,
            ZeroBenchmarkFallbackPolicyHash.selector,
            ZeroBenchmarkDisruptionPolicyHash.selector,
            ZeroBenchmarkDataRightsHash.selector,
            ZeroBenchmarkEvidenceHash.selector
        ];

        vm.startPrank(qualifier);
        for (uint256 i = 0; i < ZERO_FIELD_COUNT; i++) {
            vm.expectRevert(expected[i]);
            registry.registerBenchmark(_definitionWithZeroField(i));
        }
        vm.stopPrank();

        assertEq(registry.benchmarkCount(), 0);
    }

    /// @dev maxFutureSkewSeconds is the one numeric field allowed to be zero, because a venue whose
    /// observations never run ahead of the chain clock has no skew tolerance to grant. The final case
    /// proves the boundaries themselves are accepted rather than silently clamped.
    function test_RegistrationEnforcesNumericBoundsAndDistinctAssets() public {
        vm.startPrank(qualifier);

        BenchmarkDefinition memory definition = _definition();
        definition.quoteAssetId = baseAssetId;
        vm.expectRevert(abi.encodeWithSelector(IdenticalBenchmarkAssets.selector, baseAssetId));
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.outputDecimals = MAX_DECIMALS + 1;
        vm.expectRevert(abi.encodeWithSelector(BenchmarkDecimalsOutOfRange.selector, MAX_DECIMALS + 1));
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.maxStalenessSeconds = 0;
        vm.expectRevert(ZeroBenchmarkMaxStalenessSeconds.selector);
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.maxConfidenceBps = 10_001;
        vm.expectRevert(abi.encodeWithSelector(BenchmarkConfidenceOutOfRange.selector, uint16(10_001)));
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.outputDecimals = MAX_DECIMALS;
        definition.maxConfidenceBps = 10_000;
        definition.maxFutureSkewSeconds = 0;
        (, uint32 version) = registry.registerBenchmark(definition);
        assertEq(version, 1);

        vm.stopPrank();
    }

    /// @dev Every dependency is named by an exact version, so an unregistered asset, an adapter
    /// version that was never qualified, an unknown calendar lineage, and a session version that does
    /// not exist each fail closed with the error that names them.
    function test_RegistrationRejectsUnknownDependencies() public {
        AssetId ghostAsset = AssetId.wrap(keccak256("ghost.asset"));
        CalendarId ghostCalendar = CalendarId.wrap(keccak256("ghost.calendar"));

        vm.startPrank(qualifier);

        BenchmarkDefinition memory definition = _definition();
        definition.baseAssetId = ghostAsset;
        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.UnknownAssetDependency.selector, ghostAsset));
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.quoteAssetId = ghostAsset;
        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.UnknownAssetDependency.selector, ghostAsset));
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.adapterVersion = 7;
        vm.expectRevert(
            abi.encodeWithSelector(IBenchmarkRegistry.UnknownAdapterDependency.selector, adapterId, uint32(7))
        );
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.calendarId = ghostCalendar;
        vm.expectRevert(
            abi.encodeWithSelector(IBenchmarkRegistry.UnknownCalendarDependency.selector, ghostCalendar, uint32(1))
        );
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.sessionVersion = 4;
        vm.expectRevert(
            abi.encodeWithSelector(IBenchmarkRegistry.UnknownSessionDependency.selector, sessionId, uint32(4))
        );
        registry.registerBenchmark(definition);

        vm.stopPrank();
    }

    /// @dev Compatibility is exact equality, never a superset, a subset, or a best-effort match: a
    /// venue adapter, a stale ABI revision, and a different capability set each fail closed. The
    /// session must additionally name the very calendar version the benchmark commits to, because the
    /// session horizon is the benchmark operating horizon and both must agree on which days exist.
    function test_RegistrationRejectsIncompatibleDependencyCommitments() public {
        vm.startPrank(admin);
        AdapterDefinition memory venue = _adapterDefinition(AdapterDefinitionLib.ADAPTER_KIND_VENUE);
        venue.referenceId = keccak256("venue.adapter");
        (AdapterId venueAdapterId,) = adapters.registerAdapter(venue);
        calendars.registerCalendar(_revisedCalendarDefinition());
        (SessionId otherSessionId,) = sessions.registerSession(_sessionDefinition(keccak256("fx:europe"), 2));
        vm.stopPrank();

        vm.startPrank(qualifier);

        BenchmarkDefinition memory definition = _definition();
        definition.adapterId = venueAdapterId;
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.AdapterKindMismatch.selector,
                venueAdapterId,
                uint32(1),
                AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
                AdapterDefinitionLib.ADAPTER_KIND_VENUE
            )
        );
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.requiredInterfaceHash = keccak256("benchmark.adapter.interface.v2");
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.AdapterInterfaceMismatch.selector,
                adapterId,
                uint32(1),
                definition.requiredInterfaceHash,
                INTERFACE_HASH
            )
        );
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.requiredCapabilityHash = keccak256("benchmark.adapter.capability.v2");
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.AdapterCapabilityMismatch.selector,
                adapterId,
                uint32(1),
                definition.requiredCapabilityHash,
                CAPABILITY_HASH
            )
        );
        registry.registerBenchmark(definition);

        definition = _definition();
        definition.sessionId = otherSessionId;
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.SessionCalendarMismatch.selector,
                otherSessionId,
                uint32(1),
                calendarId,
                uint32(1),
                calendarId,
                uint32(2)
            )
        );
        registry.registerBenchmark(definition);

        vm.stopPrank();
    }

    function test_RegistrationLandsPausedAndStoresTheWholeDefinition() public {
        BenchmarkDefinition memory definition = _definition();
        bytes32 definitionHash = BenchmarkDefinitionLib.hashDefinition(definition, block.chainid);
        bytes32 versionHash = BenchmarkDefinitionLib.hashVersion(benchmarkId, 1, definitionHash, block.chainid);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IBenchmarkRegistry.BenchmarkRegistered(
            benchmarkId, 1, versionHash, definitionHash, definition, block.chainid, RegistryStatus.Paused, qualifier
        );

        vm.prank(qualifier);
        registry.registerBenchmark(definition);

        BenchmarkVersion memory record = registry.getBenchmark(benchmarkId, 1);
        assertEq(uint8(record.status), uint8(RegistryStatus.Paused));
        assertEq(record.version, 1);
        assertEq(record.definitionHash, definitionHash);
        assertEq(record.versionHash, versionHash);
        assertEq(record.definition.feedKey, FEED_KEY);
        assertEq(record.definition.outputDecimals, 18);
        assertEq(record.definition.maxStalenessSeconds, 60);
        assertEq(record.definition.maxConfidenceBps, 50);
        assertEq(record.definition.disruptionPolicyHash, DISRUPTION_POLICY_HASH);
        assertEq(AssetId.unwrap(record.definition.baseAssetId), AssetId.unwrap(baseAssetId));

        assertEq(registry.benchmarkCount(), 1);
        assertEq(registry.latestVersion(benchmarkId), 1);
        assertEq(registry.activeVersion(benchmarkId), 0);
        assertTrue(registry.exists(benchmarkId, 1));
        assertFalse(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY));
        assertTrue(registry.isLifecycleEnabled(benchmarkId, 1));
    }

    /// @dev Registration opens no risk, so a reference may be published ahead of the dependencies it
    /// will eventually be switched on against.
    function test_RegistrationSucceedsAgainstPausedAndDeprecatedDependencies() public {
        vm.startPrank(admin);
        assets.pauseAsset(baseAssetId);
        assets.deprecateAsset(quoteAssetId);
        adapters.pauseAdapter(adapterId, 1);
        sessions.pauseSession(sessionId, 1);
        calendars.pauseCalendar(calendarId, 1);
        vm.stopPrank();

        vm.prank(qualifier);
        (BenchmarkId registeredId, uint32 version) = registry.registerBenchmark(_definition());

        assertEq(BenchmarkId.unwrap(registeredId), BenchmarkId.unwrap(benchmarkId));
        assertEq(version, 1);
        assertEq(uint8(registry.statusOf(benchmarkId, 1)), uint8(RegistryStatus.Paused));
    }

    /// @dev Versions are append-only and never edited: the same definition is refused as a duplicate
    /// of the version that already carries it, a revision becomes the next version, and neither a
    /// later registration nor a status change may rewrite an earlier record.
    function test_VersionsAreAppendOnlyImmutableAndDeduplicated() public {
        vm.prank(qualifier);
        (, uint32 first) = registry.registerBenchmark(_definition());
        BenchmarkVersion memory before = registry.getBenchmark(benchmarkId, 1);

        BenchmarkDefinition memory revised = _definition();
        revised.observationRuleHash = keccak256("benchmark.observation.v2");
        vm.prank(qualifier);
        (, uint32 second) = registry.registerBenchmark(revised);

        bytes32 duplicateHash = BenchmarkDefinitionLib.hashDefinition(_definition(), block.chainid);
        vm.prank(qualifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.DuplicateBenchmarkDefinition.selector, benchmarkId, duplicateHash, uint32(1)
            )
        );
        registry.registerBenchmark(_definition());

        vm.startPrank(statusManager);
        registry.activateBenchmark(benchmarkId, 1);
        registry.pauseBenchmark(benchmarkId, 1);
        vm.stopPrank();

        BenchmarkVersion memory afterChanges = registry.getBenchmark(benchmarkId, 1);
        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(registry.benchmarkCount(), 2);
        assertEq(registry.latestVersion(benchmarkId), 2);
        assertEq(afterChanges.definitionHash, before.definitionHash);
        assertEq(afterChanges.versionHash, before.versionHash);
        assertEq(afterChanges.definition.observationRuleHash, OBSERVATION_RULE_HASH);
        assertEq(registry.getBenchmark(benchmarkId, 2).definition.observationRuleHash, revised.observationRuleHash);
    }

    /// @dev Exhaustion is unreachable in practice, so the latest-version pointer is poked directly to
    /// prove the named error replaces what would otherwise be an opaque arithmetic panic. The slot is
    /// discovered through the getter rather than hardcoded, so an inherited storage layout change
    /// cannot silently point this at the wrong word.
    function test_VersionExhaustionIsANamedError() public {
        vm.record();
        registry.latestVersion(benchmarkId);
        (bytes32[] memory readSlots,) = vm.accesses(address(registry));
        vm.store(address(registry), readSlots[0], bytes32(uint256(type(uint32).max)));

        vm.prank(qualifier);
        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.BenchmarkVersionExhausted.selector, benchmarkId));
        registry.registerBenchmark(_definition());
    }

    /// @dev Qualifying a reference and opening risk against it are different authorities, so the
    /// qualifier may never move status and an outsider may never qualify anything.
    function test_MutationsAreGatedByRoles() public {
        bytes memory unqualified = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registry.BENCHMARK_QUALIFIER_ROLE()
        );

        vm.prank(outsider);
        vm.expectRevert(unqualified);
        registry.registerBenchmark(_definition());

        vm.prank(qualifier);
        registry.registerBenchmark(_definition());

        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector,
            qualifier,
            registry.BENCHMARK_STATUS_MANAGER_ROLE()
        );

        vm.startPrank(qualifier);
        vm.expectRevert(expected);
        registry.activateBenchmark(benchmarkId, 1);
        vm.expectRevert(expected);
        registry.pauseBenchmark(benchmarkId, 1);
        vm.expectRevert(expected);
        registry.deprecateBenchmark(benchmarkId, 1);
        vm.stopPrank();
    }

    /// @dev At most one version of a lineage may be active, an old version is never silently paused
    /// to make room, and pausing the active one clears the pointer rather than leaving it dangling.
    function test_OnlyOneVersionIsActiveAndPausingClearsThePointer() public {
        vm.startPrank(qualifier);
        registry.registerBenchmark(_definition());
        BenchmarkDefinition memory revised = _definition();
        revised.feedKey = keccak256("feed.eurusd.v2");
        registry.registerBenchmark(revised);
        vm.stopPrank();

        vm.startPrank(statusManager);
        registry.activateBenchmark(benchmarkId, 1);
        assertEq(registry.activeVersion(benchmarkId), 1);

        vm.expectRevert(
            abi.encodeWithSelector(IBenchmarkRegistry.AnotherBenchmarkVersionActive.selector, benchmarkId, uint32(1))
        );
        registry.activateBenchmark(benchmarkId, 2);
        assertEq(uint8(registry.statusOf(benchmarkId, 1)), uint8(RegistryStatus.Active));

        vm.expectEmit(true, true, false, true, address(registry));
        emit IBenchmarkRegistry.BenchmarkActiveVersionChanged(benchmarkId, 1, 0, statusManager);
        registry.pauseBenchmark(benchmarkId, 1);
        assertEq(registry.activeVersion(benchmarkId), 0);

        registry.activateBenchmark(benchmarkId, 2);
        assertEq(registry.activeVersion(benchmarkId), 2);
        vm.stopPrank();
    }

    function test_DeprecationIsTerminalAndNothingIsDeleted() public {
        vm.prank(qualifier);
        registry.registerBenchmark(_definition());

        vm.startPrank(statusManager);
        registry.activateBenchmark(benchmarkId, 1);
        registry.deprecateBenchmark(benchmarkId, 1);

        assertEq(registry.activeVersion(benchmarkId), 0);
        assertEq(uint8(registry.statusOf(benchmarkId, 1)), uint8(RegistryStatus.Deprecated));

        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.InvalidBenchmarkTransition.selector,
                benchmarkId,
                uint32(1),
                RegistryStatus.Deprecated,
                RegistryStatus.Active
            )
        );
        registry.activateBenchmark(benchmarkId, 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.InvalidBenchmarkTransition.selector,
                benchmarkId,
                uint32(1),
                RegistryStatus.Deprecated,
                RegistryStatus.Paused
            )
        );
        registry.pauseBenchmark(benchmarkId, 1);
        vm.stopPrank();

        assertTrue(registry.exists(benchmarkId, 1));
        assertTrue(registry.isLifecycleEnabled(benchmarkId, 1));
    }

    /// @dev Activation is the full dependency-aware gate. Each class of dependency must be able to
    /// refuse it on its own, with an error that names which one did.
    function test_ActivationFailsForEachInactiveDependencyClass() public {
        vm.prank(qualifier);
        registry.registerBenchmark(_definition());

        vm.prank(admin);
        assets.pauseAsset(baseAssetId);
        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.AssetDependencyNotActive.selector, baseAssetId, RegistryStatus.Paused
            )
        );
        registry.activateBenchmark(benchmarkId, 1);

        vm.startPrank(admin);
        assets.activateAsset(baseAssetId);
        adapters.pauseAdapter(adapterId, 1);
        vm.stopPrank();
        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(IBenchmarkRegistry.AdapterDependencyNotOpen.selector, adapterId, uint32(1))
        );
        registry.activateBenchmark(benchmarkId, 1);

        vm.startPrank(admin);
        adapters.activateAdapter(adapterId, 1);
        calendars.pauseCalendar(calendarId, 1);
        vm.stopPrank();
        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.CalendarDependencyNotOpen.selector,
                calendarId,
                uint32(1),
                SESSION_FROM_DAY,
                SESSION_THROUGH_DAY
            )
        );
        registry.activateBenchmark(benchmarkId, 1);

        vm.startPrank(admin);
        calendars.activateCalendar(calendarId, 1);
        sessions.pauseSession(sessionId, 1);
        vm.stopPrank();
        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IBenchmarkRegistry.SessionDependencyNotOpen.selector,
                sessionId,
                uint32(1),
                SESSION_FROM_DAY,
                SESSION_THROUGH_DAY
            )
        );
        registry.activateBenchmark(benchmarkId, 1);

        vm.prank(admin);
        sessions.activateSession(sessionId, 1);
        vm.prank(statusManager);
        registry.activateBenchmark(benchmarkId, 1);
        assertTrue(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY));
    }

    /// @dev The live gate keeps watching after activation and reads the horizon straight off the
    /// session version rather than a horizon of its own: an asset pause, an adapter pause, bytecode
    /// drift under a still-Active adapter, and a day outside the session endpoints each close it
    /// without any status change here.
    function test_LiveGateReactsToDependencyPauseRuntimeDriftAndDayBoundary() public {
        _registerAndActivate();
        assertTrue(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY));

        assertFalse(registry.coversDay(benchmarkId, 1, SESSION_FROM_DAY - 1));
        assertTrue(registry.coversDay(benchmarkId, 1, SESSION_FROM_DAY));
        assertTrue(registry.coversDay(benchmarkId, 1, SESSION_THROUGH_DAY));
        assertFalse(registry.coversDay(benchmarkId, 1, SESSION_THROUGH_DAY + 1));
        assertFalse(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY - 1));
        assertTrue(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_THROUGH_DAY));
        assertFalse(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_THROUGH_DAY + 1));

        vm.prank(admin);
        assets.pauseAsset(quoteAssetId);
        assertFalse(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY));

        vm.startPrank(admin);
        assets.activateAsset(quoteAssetId);
        adapters.pauseAdapter(adapterId, 1);
        vm.stopPrank();
        assertFalse(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY));

        vm.prank(admin);
        adapters.activateAdapter(adapterId, 1);
        assertTrue(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY));

        vm.etch(implementation, address(new MockDriftedAdapterImplementation()).code);
        assertFalse(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY));

        assertEq(uint8(registry.statusOf(benchmarkId, 1)), uint8(RegistryStatus.Active));
        assertTrue(registry.isLifecycleEnabled(benchmarkId, 1));
    }

    /// @dev Fixing, settlement, and replay of positions already opened against a retired benchmark
    /// must never require current Active status anywhere in the dependency graph.
    function test_LifecycleSurvivesFullDependencyRetirement() public {
        _registerAndActivate();

        vm.startPrank(admin);
        assets.deprecateAsset(baseAssetId);
        adapters.deprecateAdapter(adapterId, 1);
        sessions.deprecateSession(sessionId, 1);
        calendars.deprecateCalendar(calendarId, 1);
        vm.stopPrank();
        vm.prank(statusManager);
        registry.deprecateBenchmark(benchmarkId, 1);

        assertTrue(registry.isLifecycleEnabled(benchmarkId, 1));
        assertFalse(registry.isOpenForNewRisk(benchmarkId, 1, SESSION_FROM_DAY));
        assertTrue(registry.coversDay(benchmarkId, 1, SESSION_FROM_DAY));

        BenchmarkVersion memory record = registry.getBenchmark(benchmarkId, 1);
        assertEq(record.definition.feedKey, FEED_KEY);
        assertEq(uint8(record.status), uint8(RegistryStatus.Deprecated));
    }

    /// @dev Reads split deliberately: the record getter reverts, because a zeroed record would name
    /// the zero asset pair and read as usable, while monitoring and gate views answer with sentinels.
    function test_UnknownBenchmarkRevertsOnGetAndAnswersSentinelsElsewhere() public {
        BenchmarkId ghost = BenchmarkId.wrap(keccak256("ghost.benchmark"));

        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.UnknownBenchmarkVersion.selector, ghost, uint32(1)));
        registry.getBenchmark(ghost, 1);

        vm.prank(statusManager);
        vm.expectRevert(abi.encodeWithSelector(IBenchmarkRegistry.UnknownBenchmarkVersion.selector, ghost, uint32(1)));
        registry.activateBenchmark(ghost, 1);

        assertEq(registry.latestVersion(ghost), 0);
        assertEq(registry.activeVersion(ghost), 0);
        assertEq(uint8(registry.statusOf(ghost, 1)), uint8(RegistryStatus.Unspecified));
        assertFalse(registry.exists(ghost, 1));
        assertFalse(registry.coversDay(ghost, 1, SESSION_FROM_DAY));
        assertFalse(registry.isOpenForNewRisk(ghost, 1, SESSION_FROM_DAY));
        assertFalse(registry.isLifecycleEnabled(ghost, 1));
    }

    function _registerAndActivate() private {
        vm.prank(qualifier);
        registry.registerBenchmark(_definition());
        vm.prank(statusManager);
        registry.activateBenchmark(benchmarkId, 1);
    }

    /// @dev Zeroes exactly one required field, indexed in the order `validate` checks them so the
    /// expectation table in the sweep above reads as one aligned list.
    function _definitionWithZeroField(uint256 index) private view returns (BenchmarkDefinition memory definition) {
        definition = _definition();
        if (index == 0) {
            definition.namespaceId = bytes32(0);
        } else if (index == 1) {
            definition.referenceId = bytes32(0);
        } else if (index == 2) {
            definition.kindId = BenchmarkKindId.wrap(bytes32(0));
        } else if (index == 3) {
            definition.baseAssetId = AssetId.wrap(bytes32(0));
        } else if (index == 4) {
            definition.quoteAssetId = AssetId.wrap(bytes32(0));
        } else if (index == 5) {
            definition.adapterId = AdapterId.wrap(bytes32(0));
        } else if (index == 6) {
            definition.adapterVersion = 0;
        } else if (index == 7) {
            definition.calendarId = CalendarId.wrap(bytes32(0));
        } else if (index == 8) {
            definition.calendarVersion = 0;
        } else if (index == 9) {
            definition.sessionId = SessionId.wrap(bytes32(0));
        } else if (index == 10) {
            definition.sessionVersion = 0;
        } else if (index == 11) {
            definition.feedKey = bytes32(0);
        } else if (index == 12) {
            definition.requiredInterfaceHash = bytes32(0);
        } else if (index == 13) {
            definition.requiredCapabilityHash = bytes32(0);
        } else if (index == 14) {
            definition.observationRuleHash = bytes32(0);
        } else if (index == 15) {
            definition.fallbackPolicyHash = bytes32(0);
        } else if (index == 16) {
            definition.disruptionPolicyHash = bytes32(0);
        } else if (index == 17) {
            definition.dataRightsHash = bytes32(0);
        } else {
            definition.evidenceHash = bytes32(0);
        }
    }

    function _assetDefinition(bytes32 referenceId, bytes32 symbol, AssetClass assetClass, uint8 decimals)
        private
        pure
        returns (AssetDefinition memory)
    {
        return AssetDefinition({
            namespaceId: keccak256("setryn.asset"),
            referenceId: referenceId,
            symbol: symbol,
            assetClass: assetClass,
            decimals: decimals
        });
    }

    function _adapterDefinition(AdapterKindId kindId) private view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: keccak256("setryn.adapter"),
            referenceId: keccak256("oracle.primary"),
            kindId: kindId,
            implementation: implementation,
            expectedRuntimeCodeHash: implementation.codehash,
            interfaceHash: INTERFACE_HASH,
            capabilityHash: CAPABILITY_HASH,
            configurationSchemaHash: keccak256("adapter.config.v1"),
            evidenceHash: keccak256("adapter.evidence.v1")
        });
    }

    function _revisedAdapterDefinition() private view returns (AdapterDefinition memory definition) {
        definition = _adapterDefinition(AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK);
        definition.evidenceHash = keccak256("adapter.evidence.v2");
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

    function _revisedCalendarDefinition() private pure returns (CalendarDefinition memory definition) {
        definition = _calendarDefinition();
        definition.dayStatusRoot = keccak256("calendar.root.v2");
    }

    function _sessionDefinition(bytes32 referenceId, uint32 calendarVersion)
        private
        view
        returns (SessionDefinition memory)
    {
        return SessionDefinition({
            namespaceId: keccak256("setryn.session"),
            referenceId: referenceId,
            calendarId: calendarId,
            calendarVersion: calendarVersion,
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
            referenceId: REFERENCE_PRIMARY,
            kindId: BenchmarkDefinitionLib.BENCHMARK_KIND_SETTLEMENT_FIXING,
            baseAssetId: baseAssetId,
            quoteAssetId: quoteAssetId,
            adapterId: adapterId,
            adapterVersion: 1,
            calendarId: calendarId,
            calendarVersion: 1,
            sessionId: sessionId,
            sessionVersion: 1,
            feedKey: FEED_KEY,
            requiredInterfaceHash: INTERFACE_HASH,
            requiredCapabilityHash: CAPABILITY_HASH,
            outputDecimals: 18,
            maxStalenessSeconds: 60,
            maxFutureSkewSeconds: 5,
            maxConfidenceBps: 50,
            observationRuleHash: OBSERVATION_RULE_HASH,
            fallbackPolicyHash: FALLBACK_POLICY_HASH,
            disruptionPolicyHash: DISRUPTION_POLICY_HASH,
            dataRightsHash: DATA_RIGHTS_HASH,
            evidenceHash: EVIDENCE_HASH
        });
    }
}
