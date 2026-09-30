// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test, Vm} from "forge-std/Test.sol";

import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../../src/interfaces/ICalendarRegistry.sol";
import {IFeeScheduleRegistry} from "../../src/interfaces/IFeeScheduleRegistry.sol";
import {IInstrumentRegistry} from "../../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IPackageRegistry} from "../../src/interfaces/IPackageRegistry.sol";
import {IPrivacyCommitmentRegistry} from "../../src/interfaces/IPrivacyCommitmentRegistry.sol";
import {IRegistryStatusController} from "../../src/interfaces/IRegistryStatusController.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {RegistryStatusController} from "../../src/policy/RegistryStatusController.sol";
import {PrivacyCommitmentRegistry} from "../../src/privacy/PrivacyCommitmentRegistry.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {BenchmarkRegistry} from "../../src/registry/BenchmarkRegistry.sol";
import {CalendarRegistry} from "../../src/registry/CalendarRegistry.sol";
import {FeeScheduleRegistry} from "../../src/registry/FeeScheduleRegistry.sol";
import {InstrumentRegistry} from "../../src/registry/InstrumentRegistry.sol";
import {MarketRegistry} from "../../src/registry/MarketRegistry.sol";
import {PackageRegistry} from "../../src/registry/PackageRegistry.sol";
import {RiskDomainRegistry} from "../../src/registry/RiskDomainRegistry.sol";
import {SeriesRegistry} from "../../src/registry/SeriesRegistry.sol";
import {SessionRegistry} from "../../src/registry/SessionRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {
    AdapterId,
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PackageId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {PrivacyPolicyId} from "../../src/types/PrivacyTypes.sol";
import {SeriesQualificationData} from "../../src/types/SeriesQualification.sol";

/// @dev Minimal live implementation so an adapter version can pass activation's runtime code-hash revalidation.
contract StatusControllerAdapterImplementation {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

contract RegistryStatusControllerTest is Test {
    uint48 internal constant ADMIN_DELAY = 2 days;
    uint256 internal constant REGISTRY_COUNT = 13;

    address internal admin = makeAddr("status-admin");
    address internal guardian = makeAddr("status-guardian");
    address internal governance = makeAddr("status-governance-timelock");
    address internal operator = makeAddr("status-operator");
    address internal outsider = makeAddr("status-outsider");

    AssetRegistry internal assets;
    AdapterRegistry internal adapters;
    CalendarRegistry internal calendars;
    SessionRegistry internal sessions;
    SettlementAssetRegistry internal settlementAssets;
    BenchmarkRegistry internal benchmarks;
    FeeScheduleRegistry internal fees;
    RiskDomainRegistry internal risks;
    InstrumentRegistry internal instruments;
    CollateralVault internal vault;
    MarketRegistry internal markets;
    SeriesRegistry internal series;
    PackageRegistry internal packages;
    PrivacyCommitmentRegistry internal privacy;

    RegistryStatusController internal controller;

    function setUp() public {
        assets = new AssetRegistry(ADMIN_DELAY, admin);
        adapters = new AdapterRegistry(ADMIN_DELAY, admin);
        calendars = new CalendarRegistry(ADMIN_DELAY, admin);
        sessions = new SessionRegistry(ADMIN_DELAY, admin, calendars);
        settlementAssets = new SettlementAssetRegistry(ADMIN_DELAY, admin, assets);
        benchmarks = new BenchmarkRegistry(ADMIN_DELAY, admin, assets, adapters, calendars, sessions);
        fees = new FeeScheduleRegistry(ADMIN_DELAY, admin, settlementAssets);
        risks = new RiskDomainRegistry(ADMIN_DELAY, admin, settlementAssets, adapters);
        instruments = new InstrumentRegistry(ADMIN_DELAY, admin, adapters, 2_000_000);
        vault = new CollateralVault(ADMIN_DELAY, admin, settlementAssets, risks, 30 days);
        markets = new MarketRegistry(
            ADMIN_DELAY, admin, assets, settlementAssets, vault, benchmarks, calendars, sessions, risks, fees
        );
        series = new SeriesRegistry(ADMIN_DELAY, admin, markets, instruments);
        packages = new PackageRegistry(ADMIN_DELAY, admin, series);
        privacy = new PrivacyCommitmentRegistry(ADMIN_DELAY, admin);

        controller = new RegistryStatusController(guardian, governance, _bindings());

        (address[REGISTRY_COUNT] memory registries, bytes32[REGISTRY_COUNT] memory roles) = _statusRoles();
        vm.startPrank(admin);
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            IAccessControl(registries[i]).grantRole(roles[i], address(controller));
            IAccessControl(registries[i]).revokeRole(roles[i], admin);
        }
        assets.grantRole(assets.REGISTRAR_ROLE(), operator);
        adapters.grantRole(adapters.ADAPTER_QUALIFIER_ROLE(), operator);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------------------
    // Selector table
    // ---------------------------------------------------------------------------------------------

    function test_BindsPrincipalsAndEveryCombinedStatusRegistry() public view {
        assertEq(controller.guardian(), guardian);
        assertEq(controller.governance(), governance);
        IRegistryStatusController.RegistryBinding[] memory bound = controller.registries();
        IRegistryStatusController.RegistryBinding[] memory expected = _bindings();
        assertEq(bound.length, REGISTRY_COUNT);
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            assertEq(bound[i].registry, expected[i].registry);
            assertEq(uint8(bound[i].kind), uint8(expected[i].kind));
            assertEq(uint8(controller.registryKind(expected[i].registry)), uint8(expected[i].kind));
        }
        assertEq(
            uint8(controller.registryKind(address(vault))), uint8(IRegistryStatusController.RegistryKind.Unspecified)
        );
    }

    function test_ClassifiesExactlyOnePauseAndTwoGovernSelectorsPerRegistry() public view {
        (address[REGISTRY_COUNT] memory registries,) = _statusRoles();
        bytes[REGISTRY_COUNT] memory pauseCalls = _pauseCalls();
        bytes[REGISTRY_COUNT] memory activateCalls = _activateCalls();
        bytes[REGISTRY_COUNT] memory deprecateCalls = _deprecateCalls();
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            assertEq(_class(registries[i], pauseCalls[i]), uint8(IRegistryStatusController.StatusCallClass.Pause));
            assertEq(_class(registries[i], activateCalls[i]), uint8(IRegistryStatusController.StatusCallClass.Govern));
            assertEq(_class(registries[i], deprecateCalls[i]), uint8(IRegistryStatusController.StatusCallClass.Govern));
            // Role administration and any other registry entry point are never bound.
            assertEq(_selectorClass(registries[i], IAccessControl.grantRole.selector), 0);
            assertEq(_selectorClass(registries[i], IAccessControl.revokeRole.selector), 0);
            assertEq(_selectorClass(registries[i], IAccessControl.renounceRole.selector), 0);
            // A selector bound on one registry is not bound on an unrelated address.
            assertEq(_class(address(vault), pauseCalls[i]), 0);
        }
        assertEq(_selectorClass(address(assets), IAssetRegistry.registerAsset.selector), 0);
        assertEq(_selectorClass(address(adapters), IAdapterRegistry.registerAdapter.selector), 0);
        assertEq(_selectorClass(address(privacy), IPrivacyCommitmentRegistry.publishEpochKey.selector), 0);
    }

    // ---------------------------------------------------------------------------------------------
    // Guardian: pause only
    // ---------------------------------------------------------------------------------------------

    /// Every registry type's pause selector is forwarded past the registry role check; the registry then rejects
    /// the unknown version with its own error, never an access-control error.
    function test_GuardianReachesThePauseSelectorOfEveryRegistryType() public {
        (address[REGISTRY_COUNT] memory registries,) = _statusRoles();
        bytes[REGISTRY_COUNT] memory pauseCalls = _pauseCalls();
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            vm.prank(guardian);
            (bool success, bytes memory reason) =
                address(controller).call(abi.encodeCall(controller.pause, (registries[i], pauseCalls[i])));
            assertFalse(success, "unknown version must be rejected by the registry");
            _assertRegistryLevelRevert(reason);
        }
    }

    function test_GuardianCannotActivateResumeOrDeprecateAnyRegistry() public {
        (address[REGISTRY_COUNT] memory registries,) = _statusRoles();
        bytes[REGISTRY_COUNT] memory activateCalls = _activateCalls();
        bytes[REGISTRY_COUNT] memory deprecateCalls = _deprecateCalls();
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            // Governance path: the caller check fires before any selector is read.
            vm.prank(guardian);
            vm.expectRevert(_unauthorized(guardian, IRegistryStatusController.StatusCallClass.Govern));
            controller.govern(registries[i], activateCalls[i]);

            // Pause path with a govern selector: the selector class is exact.
            vm.expectRevert(_mismatch(registries[i], activateCalls[i], IRegistryStatusController.StatusCallClass.Pause));
            vm.prank(guardian);
            controller.pause(registries[i], activateCalls[i]);

            vm.expectRevert(
                _mismatch(registries[i], deprecateCalls[i], IRegistryStatusController.StatusCallClass.Pause)
            );
            vm.prank(guardian);
            controller.pause(registries[i], deprecateCalls[i]);
        }
    }

    function test_GuardianCannotUsePauseToAdministerRoles() public {
        bytes memory grant = abi.encodeCall(IAccessControl.grantRole, (assets.STATUS_MANAGER_ROLE(), guardian));
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRegistryStatusController.UnknownStatusCall.selector, address(assets), IAccessControl.grantRole.selector
            )
        );
        controller.pause(address(assets), grant);
    }

    // ---------------------------------------------------------------------------------------------
    // Governance: activate, resume, deprecate only
    // ---------------------------------------------------------------------------------------------

    function test_GovernanceReachesTheActivateAndDeprecateSelectorsOfEveryRegistryType() public {
        (address[REGISTRY_COUNT] memory registries,) = _statusRoles();
        bytes[REGISTRY_COUNT] memory activateCalls = _activateCalls();
        bytes[REGISTRY_COUNT] memory deprecateCalls = _deprecateCalls();
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            vm.prank(governance);
            (bool activated, bytes memory activateReason) =
                address(controller).call(abi.encodeCall(controller.govern, (registries[i], activateCalls[i])));
            assertFalse(activated, "unknown version must be rejected by the registry");
            _assertRegistryLevelRevert(activateReason);

            vm.prank(governance);
            (bool deprecated, bytes memory deprecateReason) =
                address(controller).call(abi.encodeCall(controller.govern, (registries[i], deprecateCalls[i])));
            assertFalse(deprecated, "unknown version must be rejected by the registry");
            _assertRegistryLevelRevert(deprecateReason);
        }
    }

    function test_GovernanceCannotPauseThroughEitherPath() public {
        (address[REGISTRY_COUNT] memory registries,) = _statusRoles();
        bytes[REGISTRY_COUNT] memory pauseCalls = _pauseCalls();
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            vm.prank(governance);
            vm.expectRevert(_unauthorized(governance, IRegistryStatusController.StatusCallClass.Pause));
            controller.pause(registries[i], pauseCalls[i]);

            vm.expectRevert(_mismatch(registries[i], pauseCalls[i], IRegistryStatusController.StatusCallClass.Govern));
            vm.prank(governance);
            controller.govern(registries[i], pauseCalls[i]);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // End-to-end status transitions
    // ---------------------------------------------------------------------------------------------

    function test_AssetPauseResumeAndDeprecateSplitAcrossPrincipals() public {
        vm.prank(operator);
        AssetId assetId = assets.registerAsset(
            AssetDefinition({
                namespaceId: keccak256("setryn.status-controller"),
                referenceId: keccak256("asset:eth"),
                symbol: keccak256("ETH"),
                assetClass: AssetClass.Crypto,
                decimals: 18
            })
        );
        assertEq(uint8(assets.statusOf(assetId)), uint8(RegistryStatus.Active));

        bytes memory pauseCall = abi.encodeCall(IAssetRegistry.pauseAsset, (assetId));
        vm.expectEmit(address(controller));
        emit IRegistryStatusController.StatusCallForwarded(
            address(assets),
            IAssetRegistry.pauseAsset.selector,
            guardian,
            IRegistryStatusController.StatusCallClass.Pause,
            keccak256(pauseCall)
        );
        vm.prank(guardian);
        controller.pause(address(assets), pauseCall);
        assertEq(uint8(assets.statusOf(assetId)), uint8(RegistryStatus.Paused));

        // The guardian cannot resume what it paused.
        bytes memory resumeCall = abi.encodeCall(IAssetRegistry.activateAsset, (assetId));
        vm.expectRevert(_mismatch(address(assets), resumeCall, IRegistryStatusController.StatusCallClass.Pause));
        vm.prank(guardian);
        controller.pause(address(assets), resumeCall);

        vm.prank(governance);
        controller.govern(address(assets), resumeCall);
        assertEq(uint8(assets.statusOf(assetId)), uint8(RegistryStatus.Active));

        vm.prank(governance);
        controller.govern(address(assets), abi.encodeCall(IAssetRegistry.deprecateAsset, (assetId)));
        assertEq(uint8(assets.statusOf(assetId)), uint8(RegistryStatus.Deprecated));

        // Registry reverts bubble unchanged: a deprecated asset cannot be paused again.
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAssetRegistry.InvalidStatusTransition.selector,
                assetId,
                RegistryStatus.Deprecated,
                RegistryStatus.Paused
            )
        );
        controller.pause(address(assets), pauseCall);
    }

    function test_AdapterActivatePauseResumeAndDeprecateThroughController() public {
        StatusControllerAdapterImplementation implementation = new StatusControllerAdapterImplementation();
        vm.prank(operator);
        (AdapterId adapterId, uint32 version) = adapters.registerAdapter(
            AdapterDefinition({
                namespaceId: keccak256("setryn.status-controller"),
                referenceId: keccak256("adapter:primary"),
                kindId: AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
                implementation: address(implementation),
                expectedRuntimeCodeHash: address(implementation).codehash,
                interfaceHash: keccak256("interface"),
                capabilityHash: keccak256("capability"),
                configurationSchemaHash: keccak256("configuration"),
                evidenceHash: keccak256("evidence")
            })
        );
        assertEq(uint8(adapters.statusOf(adapterId, version)), uint8(RegistryStatus.Paused));

        vm.prank(governance);
        controller.govern(address(adapters), abi.encodeCall(IAdapterRegistry.activateAdapter, (adapterId, version)));
        assertEq(adapters.activeVersion(adapterId), version);

        vm.prank(guardian);
        controller.pause(address(adapters), abi.encodeCall(IAdapterRegistry.pauseAdapter, (adapterId, version)));
        assertEq(uint8(adapters.statusOf(adapterId, version)), uint8(RegistryStatus.Paused));
        assertEq(adapters.activeVersion(adapterId), 0);

        vm.prank(governance);
        controller.govern(address(adapters), abi.encodeCall(IAdapterRegistry.activateAdapter, (adapterId, version)));
        assertEq(uint8(adapters.statusOf(adapterId, version)), uint8(RegistryStatus.Active));

        vm.prank(governance);
        controller.govern(address(adapters), abi.encodeCall(IAdapterRegistry.deprecateAdapter, (adapterId, version)));
        assertEq(uint8(adapters.statusOf(adapterId, version)), uint8(RegistryStatus.Deprecated));
        assertTrue(adapters.isLifecycleEnabled(adapterId, version), "history must stay resolvable");
    }

    // ---------------------------------------------------------------------------------------------
    // Allowlist, callers, and direct registry access
    // ---------------------------------------------------------------------------------------------

    function test_UnknownRegistryReverts() public {
        address unknown = address(vault);
        bytes memory pauseCall = abi.encodeCall(IAssetRegistry.pauseAsset, (AssetId.wrap(bytes32(uint256(1)))));
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRegistryStatusController.UnknownStatusCall.selector, unknown, IAssetRegistry.pauseAsset.selector
            )
        );
        controller.pause(unknown, pauseCall);

        bytes memory activateCall = abi.encodeCall(IAssetRegistry.activateAsset, (AssetId.wrap(bytes32(uint256(1)))));
        vm.prank(governance);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRegistryStatusController.UnknownStatusCall.selector, unknown, IAssetRegistry.activateAsset.selector
            )
        );
        controller.govern(unknown, activateCall);
    }

    function test_SelectorOfAnotherRegistryKindReverts() public {
        // A market pause selector is not bound on the asset registry, even though both are known registries.
        bytes memory marketPause = abi.encodeCall(IMarketRegistry.pauseMarket, (MarketId.wrap(bytes32(uint256(1))), 1));
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRegistryStatusController.UnknownStatusCall.selector,
                address(assets),
                IMarketRegistry.pauseMarket.selector
            )
        );
        controller.pause(address(assets), marketPause);
    }

    function test_MalformedCalldataReverts() public {
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(IRegistryStatusController.MalformedStatusCall.selector, uint256(3)));
        controller.pause(address(assets), hex"aabbcc");

        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IRegistryStatusController.MalformedStatusCall.selector, uint256(0)));
        controller.govern(address(assets), "");
    }

    function test_NobodyElseCanCallEitherPath() public {
        address[3] memory callers = [outsider, admin, operator];
        bytes memory pauseCall = abi.encodeCall(IAssetRegistry.pauseAsset, (AssetId.wrap(bytes32(uint256(1)))));
        bytes memory activateCall = abi.encodeCall(IAssetRegistry.activateAsset, (AssetId.wrap(bytes32(uint256(1)))));
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(_unauthorized(callers[i], IRegistryStatusController.StatusCallClass.Pause));
            controller.pause(address(assets), pauseCall);

            vm.prank(callers[i]);
            vm.expectRevert(_unauthorized(callers[i], IRegistryStatusController.StatusCallClass.Govern));
            controller.govern(address(assets), activateCall);
        }
    }

    function testFuzz_OnlyTheTwoPrincipalsCanCall(address caller, bytes4 selector) public {
        vm.assume(caller != guardian && caller != governance);
        bytes memory data = abi.encodePacked(selector, bytes32(uint256(1)), bytes32(uint256(1)));
        vm.prank(caller);
        vm.expectRevert(_unauthorized(caller, IRegistryStatusController.StatusCallClass.Pause));
        controller.pause(address(markets), data);
        vm.prank(caller);
        vm.expectRevert(_unauthorized(caller, IRegistryStatusController.StatusCallClass.Govern));
        controller.govern(address(markets), data);
    }

    function testFuzz_GuardianReachesNoSelectorButPause(bytes4 selector) public {
        vm.assume(selector != IMarketRegistry.pauseMarket.selector);
        bytes memory data = abi.encodePacked(selector, bytes32(uint256(1)), bytes32(uint256(1)));
        vm.prank(guardian);
        (bool success, bytes memory reason) =
            address(controller).call(abi.encodeCall(controller.pause, (address(markets), data)));
        assertFalse(success);
        bytes4 errorSelector = bytes4(reason);
        assertTrue(
            errorSelector == IRegistryStatusController.UnknownStatusCall.selector
                || errorSelector == IRegistryStatusController.StatusCallClassMismatch.selector,
            "guardian must be stopped by the selector allowlist"
        );
    }

    function test_RegistriesRejectDirectStatusCallsFromGuardianAndGovernance() public {
        (address[REGISTRY_COUNT] memory registries, bytes32[REGISTRY_COUNT] memory roles) = _statusRoles();
        bytes[REGISTRY_COUNT] memory pauseCalls = _pauseCalls();
        bytes[REGISTRY_COUNT] memory activateCalls = _activateCalls();
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            assertTrue(IAccessControl(registries[i]).hasRole(roles[i], address(controller)));
            assertFalse(IAccessControl(registries[i]).hasRole(roles[i], guardian));
            assertFalse(IAccessControl(registries[i]).hasRole(roles[i], governance));

            vm.prank(guardian);
            (bool guardianSuccess, bytes memory guardianReason) = registries[i].call(pauseCalls[i]);
            assertFalse(guardianSuccess, "registry must reject a direct guardian pause");
            assertEq(
                guardianReason,
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, roles[i])
            );

            vm.prank(governance);
            (bool governanceSuccess, bytes memory governanceReason) = registries[i].call(activateCalls[i]);
            assertFalse(governanceSuccess, "registry must reject a direct governance activation");
            assertEq(
                governanceReason,
                abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, governance, roles[i])
            );
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------------

    function test_ConstructorRejectsInvalidPrincipals() public {
        IRegistryStatusController.RegistryBinding[] memory bindings = _bindings();
        vm.expectRevert(abi.encodeWithSelector(IRegistryStatusController.InvalidStatusPrincipal.selector, address(0)));
        new RegistryStatusController(address(0), governance, bindings);
        vm.expectRevert(abi.encodeWithSelector(IRegistryStatusController.InvalidStatusPrincipal.selector, address(0)));
        new RegistryStatusController(guardian, address(0), bindings);
        vm.expectRevert(abi.encodeWithSelector(IRegistryStatusController.InvalidStatusPrincipal.selector, guardian));
        new RegistryStatusController(guardian, guardian, bindings);
    }

    function test_ConstructorRejectsInvalidRegistrySets() public {
        vm.expectRevert(IRegistryStatusController.EmptyStatusRegistrySet.selector);
        new RegistryStatusController(guardian, governance, new IRegistryStatusController.RegistryBinding[](0));

        IRegistryStatusController.RegistryBinding[] memory one = new IRegistryStatusController.RegistryBinding[](1);
        one[0] = IRegistryStatusController.RegistryBinding({
            kind: IRegistryStatusController.RegistryKind.Unspecified, registry: address(assets)
        });
        vm.expectRevert(
            abi.encodeWithSelector(
                IRegistryStatusController.InvalidStatusRegistry.selector,
                address(assets),
                IRegistryStatusController.RegistryKind.Unspecified
            )
        );
        new RegistryStatusController(guardian, governance, one);

        one[0] = IRegistryStatusController.RegistryBinding({
            kind: IRegistryStatusController.RegistryKind.Asset, registry: outsider
        });
        vm.expectRevert(
            abi.encodeWithSelector(
                IRegistryStatusController.InvalidStatusRegistry.selector,
                outsider,
                IRegistryStatusController.RegistryKind.Asset
            )
        );
        new RegistryStatusController(guardian, governance, one);

        IRegistryStatusController.RegistryBinding[] memory duplicate =
            new IRegistryStatusController.RegistryBinding[](2);
        duplicate[0] = IRegistryStatusController.RegistryBinding({
            kind: IRegistryStatusController.RegistryKind.Asset, registry: address(assets)
        });
        duplicate[1] = IRegistryStatusController.RegistryBinding({
            kind: IRegistryStatusController.RegistryKind.Market, registry: address(assets)
        });
        vm.expectRevert(
            abi.encodeWithSelector(IRegistryStatusController.DuplicateStatusRegistry.selector, address(assets))
        );
        new RegistryStatusController(guardian, governance, duplicate);
    }

    function test_ConstructionPublishesTheCompleteSelectorTable() public {
        vm.recordLogs();
        RegistryStatusController fresh = new RegistryStatusController(guardian, governance, _bindings());
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 principals;
        uint256 pauseBindings;
        uint256 governBindings;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(fresh)) continue;
            if (logs[i].topics[0] == IRegistryStatusController.StatusPrincipalsBound.selector) {
                ++principals;
            } else if (logs[i].topics[0] == IRegistryStatusController.StatusSelectorBound.selector) {
                (, IRegistryStatusController.StatusCallClass callClass) = abi.decode(
                    logs[i].data, (IRegistryStatusController.RegistryKind, IRegistryStatusController.StatusCallClass)
                );
                address registry = address(uint160(uint256(logs[i].topics[1])));
                bytes4 selector = bytes4(logs[i].topics[2]);
                assertEq(uint8(fresh.statusCallClass(registry, selector)), uint8(callClass));
                if (callClass == IRegistryStatusController.StatusCallClass.Pause) ++pauseBindings;
                else ++governBindings;
            }
        }
        assertEq(principals, 1);
        assertEq(pauseBindings, REGISTRY_COUNT);
        assertEq(governBindings, 2 * REGISTRY_COUNT);
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    function _bindings() internal view returns (IRegistryStatusController.RegistryBinding[] memory bindings) {
        (address[REGISTRY_COUNT] memory registries,) = _statusRoles();
        IRegistryStatusController.RegistryKind[REGISTRY_COUNT] memory kinds = [
            IRegistryStatusController.RegistryKind.Asset,
            IRegistryStatusController.RegistryKind.Adapter,
            IRegistryStatusController.RegistryKind.Calendar,
            IRegistryStatusController.RegistryKind.Session,
            IRegistryStatusController.RegistryKind.SettlementAsset,
            IRegistryStatusController.RegistryKind.Benchmark,
            IRegistryStatusController.RegistryKind.FeeSchedule,
            IRegistryStatusController.RegistryKind.RiskDomain,
            IRegistryStatusController.RegistryKind.Instrument,
            IRegistryStatusController.RegistryKind.Market,
            IRegistryStatusController.RegistryKind.Series,
            IRegistryStatusController.RegistryKind.Package,
            IRegistryStatusController.RegistryKind.PrivacyPolicy
        ];
        bindings = new IRegistryStatusController.RegistryBinding[](REGISTRY_COUNT);
        for (uint256 i; i < REGISTRY_COUNT; ++i) {
            bindings[i] = IRegistryStatusController.RegistryBinding({kind: kinds[i], registry: registries[i]});
        }
    }

    function _statusRoles()
        internal
        view
        returns (address[REGISTRY_COUNT] memory registries, bytes32[REGISTRY_COUNT] memory roles)
    {
        registries = [
            address(assets),
            address(adapters),
            address(calendars),
            address(sessions),
            address(settlementAssets),
            address(benchmarks),
            address(fees),
            address(risks),
            address(instruments),
            address(markets),
            address(series),
            address(packages),
            address(privacy)
        ];
        roles = [
            assets.STATUS_MANAGER_ROLE(),
            adapters.ADAPTER_STATUS_MANAGER_ROLE(),
            calendars.CALENDAR_STATUS_MANAGER_ROLE(),
            sessions.SESSION_STATUS_MANAGER_ROLE(),
            settlementAssets.STATUS_MANAGER_ROLE(),
            benchmarks.BENCHMARK_STATUS_MANAGER_ROLE(),
            fees.FEE_SCHEDULE_STATUS_MANAGER_ROLE(),
            risks.RISK_DOMAIN_STATUS_MANAGER_ROLE(),
            instruments.INSTRUMENT_STATUS_MANAGER_ROLE(),
            markets.MARKET_STATUS_MANAGER_ROLE(),
            series.SERIES_STATUS_MANAGER_ROLE(),
            packages.PACKAGE_STATUS_MANAGER_ROLE(),
            privacy.POLICY_ACTIVATOR_ROLE()
        ];
    }

    bytes32 internal constant UNKNOWN_ID = bytes32(uint256(0xdead));
    uint32 internal constant UNKNOWN_VERSION = 7;

    function _pauseCalls() internal pure returns (bytes[REGISTRY_COUNT] memory calls) {
        calls = [
            abi.encodeCall(IAssetRegistry.pauseAsset, (AssetId.wrap(UNKNOWN_ID))),
            abi.encodeCall(IAdapterRegistry.pauseAdapter, (AdapterId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ICalendarRegistry.pauseCalendar, (CalendarId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISessionRegistry.pauseSession, (SessionId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISettlementAssetRegistry.pauseBinding, (AssetId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IBenchmarkRegistry.pauseBenchmark, (BenchmarkId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IFeeScheduleRegistry.pauseFeeSchedule, (FeeScheduleId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IRiskDomainRegistry.pauseRiskDomain, (RiskDomainId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IInstrumentRegistry.pauseInstrument, (InstrumentId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IMarketRegistry.pauseMarket, (MarketId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISeriesRegistry.pauseSeries, (SeriesId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IPackageRegistry.pausePackage, (PackageId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IPrivacyCommitmentRegistry.pausePolicy, (PrivacyPolicyId.wrap(UNKNOWN_ID), UNKNOWN_VERSION))
        ];
    }

    function _activateCalls() internal pure returns (bytes[REGISTRY_COUNT] memory calls) {
        SeriesQualificationData memory qualification;
        calls = [
            abi.encodeCall(IAssetRegistry.activateAsset, (AssetId.wrap(UNKNOWN_ID))),
            abi.encodeCall(IAdapterRegistry.activateAdapter, (AdapterId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ICalendarRegistry.activateCalendar, (CalendarId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISessionRegistry.activateSession, (SessionId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISettlementAssetRegistry.activateBinding, (AssetId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IBenchmarkRegistry.activateBenchmark, (BenchmarkId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IFeeScheduleRegistry.activateFeeSchedule, (FeeScheduleId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IRiskDomainRegistry.activateRiskDomain, (RiskDomainId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IInstrumentRegistry.activateInstrument, (InstrumentId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IMarketRegistry.activateMarket, (MarketId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISeriesRegistry.activateSeries, (SeriesId.wrap(UNKNOWN_ID), UNKNOWN_VERSION, qualification)),
            abi.encodeCall(
                IPackageRegistry.activatePackage, (PackageId.wrap(UNKNOWN_ID), UNKNOWN_VERSION, new PackageLeg[](0))
            ),
            abi.encodeCall(
                IPrivacyCommitmentRegistry.activatePolicy, (PrivacyPolicyId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)
            )
        ];
    }

    function _deprecateCalls() internal pure returns (bytes[REGISTRY_COUNT] memory calls) {
        calls = [
            abi.encodeCall(IAssetRegistry.deprecateAsset, (AssetId.wrap(UNKNOWN_ID))),
            abi.encodeCall(IAdapterRegistry.deprecateAdapter, (AdapterId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ICalendarRegistry.deprecateCalendar, (CalendarId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISessionRegistry.deprecateSession, (SessionId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISettlementAssetRegistry.deprecateBinding, (AssetId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IBenchmarkRegistry.deprecateBenchmark, (BenchmarkId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(
                IFeeScheduleRegistry.deprecateFeeSchedule, (FeeScheduleId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)
            ),
            abi.encodeCall(IRiskDomainRegistry.deprecateRiskDomain, (RiskDomainId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IInstrumentRegistry.deprecateInstrument, (InstrumentId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IMarketRegistry.deprecateMarket, (MarketId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(ISeriesRegistry.deprecateSeries, (SeriesId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(IPackageRegistry.deprecatePackage, (PackageId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)),
            abi.encodeCall(
                IPrivacyCommitmentRegistry.deprecatePolicy, (PrivacyPolicyId.wrap(UNKNOWN_ID), UNKNOWN_VERSION)
            )
        ];
    }

    function _class(address registry, bytes memory data) internal view returns (uint8) {
        return _selectorClass(registry, bytes4(data));
    }

    function _selectorClass(address registry, bytes4 selector) internal view returns (uint8) {
        return uint8(controller.statusCallClass(registry, selector));
    }

    function _unauthorized(address caller, IRegistryStatusController.StatusCallClass callClass)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(IRegistryStatusController.StatusCallerUnauthorized.selector, caller, callClass);
    }

    function _mismatch(address registry, bytes memory data, IRegistryStatusController.StatusCallClass requiredClass)
        internal
        view
        returns (bytes memory)
    {
        bytes4 selector = bytes4(data);
        return abi.encodeWithSelector(
            IRegistryStatusController.StatusCallClassMismatch.selector,
            registry,
            selector,
            requiredClass,
            controller.statusCallClass(registry, selector)
        );
    }

    /// A forwarded call must fail inside the registry body, never at its role check or at the controller.
    function _assertRegistryLevelRevert(bytes memory reason) internal pure {
        assertGe(reason.length, 4, "registry must revert with a typed error");
        bytes4 errorSelector = bytes4(reason);
        assertTrue(
            errorSelector != IAccessControl.AccessControlUnauthorizedAccount.selector,
            "controller must hold the registry status role"
        );
        assertTrue(errorSelector != IRegistryStatusController.UnknownStatusCall.selector, "selector must be bound");
        assertTrue(
            errorSelector != IRegistryStatusController.StatusCallClassMismatch.selector, "selector class must match"
        );
        assertTrue(
            errorSelector != IRegistryStatusController.StatusCallerUnauthorized.selector, "caller must be authorized"
        );
    }
}
