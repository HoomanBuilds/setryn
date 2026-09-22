// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {ISettlementAssetRegistry} from "../../src/interfaces/ISettlementAssetRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {
    AccountLiabilityExceedsAggregate,
    AccountReservationExceedsAccountLiability,
    AccountReservationExceedsAggregateReservation,
    AggregateReservationExceedsAggregateLiability,
    PartialReservationEnablement,
    RiskDomainDefinitionLib,
    ZeroConcentrationRulesHash,
    ZeroDefaultProcessHash,
    ZeroInsurancePolicyHash,
    ZeroMarginRulesHash,
    ZeroMaxAccountLiability,
    ZeroMaxAggregateLiability,
    ZeroMaxOpenInterest,
    ZeroRiskDomainAdapterId,
    ZeroRiskDomainAdapterVersion,
    ZeroRiskDomainCollateralAssetId,
    ZeroRiskDomainCollateralAssetVersion,
    ZeroRiskDomainEvidenceHash,
    ZeroRiskDomainKey,
    ZeroRiskDomainNamespaceId,
    ZeroRiskDomainRequiredAdapterKindId,
    ZeroRiskDomainRequiredCapabilityHash,
    ZeroRiskDomainRequiredInterfaceHash,
    ZeroRiskModelId,
    ZeroScenarioSetHash
} from "../../src/libraries/RiskDomainDefinitionLib.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {RiskDomainRegistry} from "../../src/registry/RiskDomainRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {AdapterId, AdapterKindId, AssetId, RiskDomainId, RiskModelId} from "../../src/types/Identifiers.sol";
import {RiskDomainDefinition, RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {MockAdapterImplementation, MockDriftedAdapterImplementation} from "../mocks/AdapterMocks.sol";
import {MockERC20Metadata} from "../mocks/TokenMocks.sol";

contract RiskDomainRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.risk");
    bytes32 internal constant DOMAIN_KEY = keccak256("risk:perp:isolated");

    bytes32 internal constant INTERFACE_HASH = keccak256("risk.adapter.interface.v1");
    bytes32 internal constant CAPABILITY_HASH = keccak256("risk.adapter.capability.v1");

    bytes32 internal constant MARGIN_RULES_HASH = keccak256("risk.margin.v1");
    bytes32 internal constant SCENARIO_SET_HASH = keccak256("risk.scenarios.v1");
    bytes32 internal constant CONCENTRATION_RULES_HASH = keccak256("risk.concentration.v1");
    bytes32 internal constant DEFAULT_PROCESS_HASH = keccak256("risk.default.v1");
    bytes32 internal constant INSURANCE_POLICY_HASH = keccak256("risk.insurance.v1");
    bytes32 internal constant EVIDENCE_HASH = keccak256("risk.evidence.v1");

    uint128 internal constant MAX_OPEN_INTEREST = 500_000_000;
    uint128 internal constant MAX_AGGREGATE_LIABILITY = 200_000_000;
    uint128 internal constant MAX_ACCOUNT_LIABILITY = 20_000_000;
    uint128 internal constant MAX_AGGREGATE_RESERVATION = 10_000_000;
    uint128 internal constant MAX_ACCOUNT_RESERVATION = 5_000_000;

    uint8 internal constant CANONICAL_DECIMALS = 6;

    /// @dev One entry per unconditionally nonzero field of a definition, in the order `validate`
    /// checks them, so the table below and `_definitionWithZeroField` stay a single aligned sweep. The
    /// two reservation caps are absent on purpose: they are the only optional part of the envelope and
    /// are swept by the containment test instead.
    uint256 internal constant ZERO_FIELD_COUNT = 19;

    /// @dev Every field of the definition, so the hash sweep proves the commitment covers all of
    /// them rather than only the ones a hand-picked sample names.
    uint256 internal constant FIELD_COUNT = 21;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");

    AssetRegistry internal assets;
    SettlementAssetRegistry internal settlement;
    AdapterRegistry internal adapters;
    RiskDomainRegistry internal registry;

    MockERC20Metadata internal token;
    MockAdapterImplementation internal riskImplementation;

    AssetId internal collateralAssetId;
    AdapterId internal riskAdapterId;
    RiskDomainId internal riskDomainId;

    function setUp() public {
        assets = new AssetRegistry(ADMIN_DELAY, admin);
        settlement = new SettlementAssetRegistry(ADMIN_DELAY, admin, assets);
        adapters = new AdapterRegistry(ADMIN_DELAY, admin);
        registry = new RiskDomainRegistry(ADMIN_DELAY, admin, settlement, adapters);

        token = new MockERC20Metadata(CANONICAL_DECIMALS);
        riskImplementation = new MockAdapterImplementation();

        vm.startPrank(admin);
        registry.grantRole(registry.RISK_DOMAIN_QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.RISK_DOMAIN_STATUS_MANAGER_ROLE(), statusManager);

        collateralAssetId = assets.registerAsset(_assetDefinition());
        settlement.registerBinding(_bindingDefinition(keccak256("settlement.qualification.v1")));
        settlement.activateBinding(collateralAssetId, 1);

        (riskAdapterId,) = adapters.registerAdapter(
            _adapterDefinition(
                keccak256("risk:engine"), AdapterDefinitionLib.ADAPTER_KIND_RISK, INTERFACE_HASH, CAPABILITY_HASH
            )
        );
        adapters.activateAdapter(riskAdapterId, 1);
        vm.stopPrank();

        riskDomainId = RiskDomainDefinitionLib.deriveRiskDomainId(_definition());
    }

    /// @dev Every hashing rule is versioned inside its own literal, and the published risk model tag
    /// set is a convenience list over an open bytes32 space rather than an enum, so the literals must
    /// be frozen and no tag may collide with another.
    function test_ConstantsAreFrozenAndDistinct() public view {
        assertEq(
            keccak256(bytes(RiskDomainDefinitionLib.RISK_DOMAIN_KEY_TYPESTRING)),
            RiskDomainDefinitionLib.RISK_DOMAIN_KEY_TYPEHASH
        );
        assertEq(
            keccak256(bytes(RiskDomainDefinitionLib.RISK_DOMAIN_DEFINITION_TYPESTRING)),
            RiskDomainDefinitionLib.RISK_DOMAIN_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(RiskDomainDefinitionLib.RISK_DOMAIN_VERSION_TYPESTRING)),
            RiskDomainDefinitionLib.RISK_DOMAIN_VERSION_TYPEHASH
        );

        RiskModelId[4] memory models = [
            RiskDomainDefinitionLib.RISK_MODEL_ISOLATED_MARGIN,
            RiskDomainDefinitionLib.RISK_MODEL_PORTFOLIO_MARGIN,
            RiskDomainDefinitionLib.RISK_MODEL_SCENARIO_GRID,
            RiskDomainDefinitionLib.RISK_MODEL_FULLY_COLLATERALIZED
        ];
        assertEq(RiskModelId.unwrap(models[0]), keccak256(bytes("SetrynRiskModelV1:IsolatedMargin")));
        for (uint256 i = 0; i < models.length; i++) {
            assertTrue(RiskModelId.unwrap(models[i]) != bytes32(0));
            for (uint256 j = i + 1; j < models.length; j++) {
                assertTrue(RiskModelId.unwrap(models[i]) != RiskModelId.unwrap(models[j]));
            }
        }

        assertEq(registry.RISK_DOMAIN_QUALIFIER_ROLE(), keccak256(bytes("SETRYN_RISK_DOMAIN_QUALIFIER_ROLE")));
        assertEq(registry.RISK_DOMAIN_STATUS_MANAGER_ROLE(), keccak256(bytes("SETRYN_RISK_DOMAIN_STATUS_MANAGER_ROLE")));
        assertTrue(registry.RISK_DOMAIN_QUALIFIER_ROLE() != registry.RISK_DOMAIN_STATUS_MANAGER_ROLE());
        assertTrue(registry.RISK_DOMAIN_QUALIFIER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
        assertTrue(registry.RISK_DOMAIN_STATUS_MANAGER_ROLE() != registry.DEFAULT_ADMIN_ROLE());
    }

    /// @dev Both dependencies are immutable and both must be a deployed contract, so the wiring and
    /// the four ways it can be refused are asserted as one sweep. No relationship is asserted
    /// between the two registries, because there is no objective graph relationship to close.
    function test_ConstructorWiresDependenciesAndRejectsInvalidArguments() public {
        RiskDomainRegistry fresh = new RiskDomainRegistry(ADMIN_DELAY, admin, settlement, adapters);

        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.RISK_DOMAIN_QUALIFIER_ROLE(), admin));
        assertTrue(fresh.hasRole(fresh.RISK_DOMAIN_STATUS_MANAGER_ROLE(), admin));
        assertEq(fresh.defaultAdmin(), admin);
        assertEq(fresh.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(address(fresh.settlementAssetRegistry()), address(settlement));
        assertEq(address(fresh.adapterRegistry()), address(adapters));
        assertEq(fresh.riskDomainCount(), 0);

        vm.expectRevert(IRiskDomainRegistry.ZeroInitialAdmin.selector);
        new RiskDomainRegistry(ADMIN_DELAY, address(0), settlement, adapters);

        vm.expectRevert(IRiskDomainRegistry.ZeroSettlementAssetRegistry.selector);
        new RiskDomainRegistry(ADMIN_DELAY, admin, ISettlementAssetRegistry(address(0)), adapters);

        vm.expectRevert(abi.encodeWithSelector(IRiskDomainRegistry.SettlementAssetRegistryHasNoCode.selector, outsider));
        new RiskDomainRegistry(ADMIN_DELAY, admin, ISettlementAssetRegistry(outsider), adapters);

        vm.expectRevert(IRiskDomainRegistry.ZeroAdapterRegistry.selector);
        new RiskDomainRegistry(ADMIN_DELAY, admin, settlement, IAdapterRegistry(address(0)));

        vm.expectRevert(abi.encodeWithSelector(IRiskDomainRegistry.AdapterRegistryHasNoCode.selector, outsider));
        new RiskDomainRegistry(ADMIN_DELAY, admin, settlement, IAdapterRegistry(outsider));
    }

    /// @dev The V1 key commits the namespaced domain name alone. Retuning margin, replacing the
    /// scenario set, switching risk model, repointing at a newer collateral binding or adapter
    /// version, and widening the caps all land on the same lineage under a new version, which is
    /// what keeps a domain reference inside an open position stable across retunings. Only the
    /// namespace or the key mints a new lineage.
    function test_RiskDomainIdIsStableAcrossRetuningAndSplitsOnNamespaceOrKey() public {
        vm.startPrank(admin);
        settlement.registerBinding(_bindingDefinition(keccak256("settlement.qualification.v2")));
        adapters.registerAdapter(
            _adapterDefinition(
                keccak256("risk:engine"),
                AdapterDefinitionLib.ADAPTER_KIND_RISK,
                keccak256("risk.adapter.interface.v2"),
                CAPABILITY_HASH
            )
        );
        vm.stopPrank();

        RiskDomainDefinition memory retuned = _definition();
        retuned.riskModelId = RiskDomainDefinitionLib.RISK_MODEL_PORTFOLIO_MARGIN;
        retuned.collateralAssetVersion = 2;
        retuned.riskAdapterVersion = 2;
        retuned.requiredInterfaceHash = keccak256("risk.adapter.interface.v2");
        retuned.marginRulesHash = keccak256("risk.margin.v2");
        retuned.scenarioSetHash = keccak256("risk.scenarios.v2");
        retuned.maxOpenInterestBaseUnits = MAX_OPEN_INTEREST * 2;

        RiskDomainDefinition memory otherNamespace = _definition();
        otherNamespace.namespaceId = keccak256("acme.risk");

        RiskDomainDefinition memory otherKey = _definition();
        otherKey.domainKey = keccak256("risk:perp:portfolio");

        vm.startPrank(qualifier);
        (RiskDomainId firstId, uint32 firstVersion) = registry.registerRiskDomain(_definition());
        (RiskDomainId secondId, uint32 secondVersion) = registry.registerRiskDomain(retuned);
        (RiskDomainId namespaceId, uint32 namespaceVersion) = registry.registerRiskDomain(otherNamespace);
        (RiskDomainId keyId, uint32 keyVersion) = registry.registerRiskDomain(otherKey);
        vm.stopPrank();

        assertEq(RiskDomainId.unwrap(firstId), RiskDomainId.unwrap(secondId));
        assertEq(firstVersion, 1);
        assertEq(secondVersion, 2);
        assertEq(registry.latestVersion(firstId), 2);

        assertTrue(RiskDomainId.unwrap(firstId) != RiskDomainId.unwrap(namespaceId));
        assertTrue(RiskDomainId.unwrap(firstId) != RiskDomainId.unwrap(keyId));
        assertTrue(RiskDomainId.unwrap(namespaceId) != RiskDomainId.unwrap(keyId));
        assertEq(namespaceVersion, 1);
        assertEq(keyVersion, 1);
        assertEq(registry.riskDomainCount(), 4);
    }

    /// @dev Identity is chain portable; the qualification commitment is not, because both
    /// dependencies are chain local and every cap is denominated in a chain-local token. Each field
    /// must move the definition hash on its own, otherwise the duplicate check could silently accept
    /// a retuning as an exact resubmission. The split encoding must also be the very commitment the
    /// typestring describes rather than a second one.
    function test_DefinitionHashBindsChainIdAndEveryField() public view {
        RiskDomainDefinition memory definition = _definition();
        bytes32 here = RiskDomainDefinitionLib.hashDefinition(definition, block.chainid);

        assertEq(here, RiskDomainDefinitionLib.hashDefinitionUnsplit(definition, block.chainid));
        assertTrue(here != RiskDomainDefinitionLib.hashDefinition(definition, block.chainid + 1));

        for (uint256 i = 0; i < FIELD_COUNT; i++) {
            assertTrue(here != RiskDomainDefinitionLib.hashDefinition(_definitionWithMutatedField(i), block.chainid));
        }

        assertTrue(
            RiskDomainDefinitionLib.hashVersion(riskDomainId, 1, here, block.chainid)
                != RiskDomainDefinitionLib.hashVersion(riskDomainId, 1, here, block.chainid + 1)
        );
        assertTrue(
            RiskDomainDefinitionLib.hashVersion(riskDomainId, 1, here, block.chainid)
                != RiskDomainDefinitionLib.hashVersion(riskDomainId, 2, here, block.chainid)
        );
        assertEq(
            RiskDomainId.unwrap(RiskDomainDefinitionLib.deriveRiskDomainId(definition)),
            RiskDomainId.unwrap(registry.deriveRiskDomainId(definition))
        );
    }

    /// @dev Every identifier, both dependency version numbers, every compatibility requirement,
    /// every commitment hash, and the three unconditional caps are required, so the whole set is swept
    /// as one table against the error each field must raise by itself.
    function test_RegistrationRejectsZeroDefinitionFields() public {
        bytes4[ZERO_FIELD_COUNT] memory expected = [
            ZeroRiskDomainNamespaceId.selector,
            ZeroRiskDomainKey.selector,
            ZeroRiskModelId.selector,
            ZeroRiskDomainCollateralAssetId.selector,
            ZeroRiskDomainCollateralAssetVersion.selector,
            ZeroRiskDomainAdapterId.selector,
            ZeroRiskDomainAdapterVersion.selector,
            ZeroRiskDomainRequiredAdapterKindId.selector,
            ZeroRiskDomainRequiredInterfaceHash.selector,
            ZeroRiskDomainRequiredCapabilityHash.selector,
            ZeroMarginRulesHash.selector,
            ZeroScenarioSetHash.selector,
            ZeroConcentrationRulesHash.selector,
            ZeroDefaultProcessHash.selector,
            ZeroInsurancePolicyHash.selector,
            ZeroRiskDomainEvidenceHash.selector,
            ZeroMaxOpenInterest.selector,
            ZeroMaxAggregateLiability.selector,
            ZeroMaxAccountLiability.selector
        ];

        vm.startPrank(qualifier);
        for (uint256 i = 0; i < ZERO_FIELD_COUNT; i++) {
            vm.expectRevert(expected[i]);
            registry.registerRiskDomain(_definitionWithZeroField(i));
        }
        vm.stopPrank();

        assertEq(registry.riskDomainCount(), 0);
    }

    /// @dev Every asserted relationship is containment of one measure inside a wider one at the same
    /// or a wider scope, and only in that direction. Open interest is notional exposure while the
    /// liability and reservation caps are loss exposure, so a domain whose open interest cap sits
    /// below any of them is a legitimate policy rather than an inversion, and no ordering between them
    /// is invented. Reservations are optional: both reservation caps zero disables reservation-backed
    /// quote modes and registers cleanly, while one zero and one nonzero is a partial envelope and is
    /// refused in both directions.
    function test_RegistrationEnforcesLiabilityAndReservationContainmentOnly() public {
        vm.startPrank(qualifier);

        RiskDomainDefinition memory definition = _definition();
        definition.maxAccountLiabilityBaseUnits = MAX_AGGREGATE_LIABILITY + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                AccountLiabilityExceedsAggregate.selector, MAX_AGGREGATE_LIABILITY + 1, MAX_AGGREGATE_LIABILITY
            )
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.maxAccountReservationBaseUnits = 0;
        vm.expectRevert(
            abi.encodeWithSelector(PartialReservationEnablement.selector, MAX_AGGREGATE_RESERVATION, uint128(0))
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.maxAggregateReservationBaseUnits = 0;
        vm.expectRevert(
            abi.encodeWithSelector(PartialReservationEnablement.selector, uint128(0), MAX_ACCOUNT_RESERVATION)
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.maxAccountReservationBaseUnits = MAX_AGGREGATE_RESERVATION + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                AccountReservationExceedsAggregateReservation.selector,
                MAX_AGGREGATE_RESERVATION + 1,
                MAX_AGGREGATE_RESERVATION
            )
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.maxAggregateReservationBaseUnits = MAX_AGGREGATE_LIABILITY + 1;
        definition.maxAccountReservationBaseUnits = MAX_AGGREGATE_LIABILITY + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                AggregateReservationExceedsAggregateLiability.selector,
                MAX_AGGREGATE_LIABILITY + 1,
                MAX_AGGREGATE_LIABILITY
            )
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.maxAggregateReservationBaseUnits = MAX_AGGREGATE_LIABILITY;
        definition.maxAccountReservationBaseUnits = MAX_ACCOUNT_LIABILITY + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                AccountReservationExceedsAccountLiability.selector, MAX_ACCOUNT_LIABILITY + 1, MAX_ACCOUNT_LIABILITY
            )
        );
        registry.registerRiskDomain(definition);

        RiskDomainDefinition memory narrowOpenInterest = _definition();
        narrowOpenInterest.maxOpenInterestBaseUnits = 1;
        (, uint32 narrowVersion) = registry.registerRiskDomain(narrowOpenInterest);

        RiskDomainDefinition memory equalEnvelopes = _definition();
        equalEnvelopes.maxAccountLiabilityBaseUnits = MAX_AGGREGATE_LIABILITY;
        equalEnvelopes.maxAggregateReservationBaseUnits = MAX_AGGREGATE_LIABILITY;
        equalEnvelopes.maxAccountReservationBaseUnits = MAX_AGGREGATE_LIABILITY;
        (, uint32 equalVersion) = registry.registerRiskDomain(equalEnvelopes);

        RiskDomainDefinition memory reservationsDisabled = _definition();
        reservationsDisabled.maxAggregateReservationBaseUnits = 0;
        reservationsDisabled.maxAccountReservationBaseUnits = 0;
        (, uint32 disabledVersion) = registry.registerRiskDomain(reservationsDisabled);

        vm.stopPrank();

        assertEq(narrowVersion, 1);
        assertEq(equalVersion, 2);
        assertEq(disabledVersion, 3);
        assertEq(registry.riskDomainCount(), 3);

        RiskDomainVersion memory disabledRecord = registry.getRiskDomain(riskDomainId, disabledVersion);
        assertEq(disabledRecord.definition.maxAggregateReservationBaseUnits, 0);
        assertEq(disabledRecord.definition.maxAccountReservationBaseUnits, 0);
    }

    /// @dev Both dependencies are named by exact versions, and the adapter must additionally carry
    /// exactly the capability category, ABI revision, and capability set the domain demands. A
    /// superset is refused as firmly as an unrelated adapter, and nothing is stored on any of these
    /// paths.
    function test_RegistrationRejectsUnknownOrIncompatibleDependencies() public {
        AssetId ghostAsset = AssetId.wrap(keccak256("ghost.asset"));
        AdapterId ghostAdapter = AdapterId.wrap(keccak256("ghost.adapter"));

        vm.startPrank(qualifier);

        RiskDomainDefinition memory definition = _definition();
        definition.collateralAssetId = ghostAsset;
        vm.expectRevert(
            abi.encodeWithSelector(IRiskDomainRegistry.UnknownCollateralDependency.selector, ghostAsset, uint32(1))
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.collateralAssetVersion = 9;
        vm.expectRevert(
            abi.encodeWithSelector(
                IRiskDomainRegistry.UnknownCollateralDependency.selector, collateralAssetId, uint32(9)
            )
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.riskAdapterId = ghostAdapter;
        vm.expectRevert(
            abi.encodeWithSelector(IRiskDomainRegistry.UnknownRiskAdapterDependency.selector, ghostAdapter, uint32(1))
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.requiredAdapterKindId = AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK;
        vm.expectRevert(
            abi.encodeWithSelector(
                IRiskDomainRegistry.RiskAdapterKindMismatch.selector,
                riskAdapterId,
                uint32(1),
                AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
                AdapterDefinitionLib.ADAPTER_KIND_RISK
            )
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.requiredInterfaceHash = keccak256("risk.adapter.interface.v2");
        vm.expectRevert(
            abi.encodeWithSelector(
                IRiskDomainRegistry.RiskAdapterInterfaceMismatch.selector,
                riskAdapterId,
                uint32(1),
                keccak256("risk.adapter.interface.v2"),
                INTERFACE_HASH
            )
        );
        registry.registerRiskDomain(definition);

        definition = _definition();
        definition.requiredCapabilityHash = keccak256("risk.adapter.capability.v2");
        vm.expectRevert(
            abi.encodeWithSelector(
                IRiskDomainRegistry.RiskAdapterCapabilityMismatch.selector,
                riskAdapterId,
                uint32(1),
                keccak256("risk.adapter.capability.v2"),
                CAPABILITY_HASH
            )
        );
        registry.registerRiskDomain(definition);

        vm.stopPrank();
        assertEq(registry.riskDomainCount(), 0);
    }

    function test_RegistrationLandsPausedAndStoresTheWholeDefinition() public {
        RiskDomainDefinition memory definition = _definition();
        bytes32 definitionHash = RiskDomainDefinitionLib.hashDefinition(definition, block.chainid);
        bytes32 versionHash = RiskDomainDefinitionLib.hashVersion(riskDomainId, 1, definitionHash, block.chainid);

        vm.expectEmit(true, true, true, true, address(registry));
        emit IRiskDomainRegistry.RiskDomainRegistered(
            riskDomainId, 1, versionHash, definitionHash, definition, block.chainid, RegistryStatus.Paused, qualifier
        );

        vm.prank(qualifier);
        registry.registerRiskDomain(definition);

        RiskDomainVersion memory record = registry.getRiskDomain(riskDomainId, 1);
        assertEq(uint8(record.status), uint8(RegistryStatus.Paused));
        assertEq(record.version, 1);
        assertEq(record.definitionHash, definitionHash);
        assertEq(record.versionHash, versionHash);
        assertEq(RiskModelId.unwrap(record.definition.riskModelId), RiskModelId.unwrap(definition.riskModelId));
        assertEq(AssetId.unwrap(record.definition.collateralAssetId), AssetId.unwrap(collateralAssetId));
        assertEq(record.definition.collateralAssetVersion, 1);
        assertEq(AdapterId.unwrap(record.definition.riskAdapterId), AdapterId.unwrap(riskAdapterId));
        assertEq(record.definition.riskAdapterVersion, 1);
        assertEq(
            AdapterKindId.unwrap(record.definition.requiredAdapterKindId),
            AdapterKindId.unwrap(AdapterDefinitionLib.ADAPTER_KIND_RISK)
        );
        assertEq(record.definition.requiredInterfaceHash, INTERFACE_HASH);
        assertEq(record.definition.requiredCapabilityHash, CAPABILITY_HASH);
        assertEq(record.definition.marginRulesHash, MARGIN_RULES_HASH);
        assertEq(record.definition.scenarioSetHash, SCENARIO_SET_HASH);
        assertEq(record.definition.concentrationRulesHash, CONCENTRATION_RULES_HASH);
        assertEq(record.definition.defaultProcessHash, DEFAULT_PROCESS_HASH);
        assertEq(record.definition.insurancePolicyHash, INSURANCE_POLICY_HASH);
        assertEq(record.definition.qualificationEvidenceHash, EVIDENCE_HASH);
        assertEq(record.definition.maxOpenInterestBaseUnits, MAX_OPEN_INTEREST);
        assertEq(record.definition.maxAggregateLiabilityBaseUnits, MAX_AGGREGATE_LIABILITY);
        assertEq(record.definition.maxAccountLiabilityBaseUnits, MAX_ACCOUNT_LIABILITY);
        assertEq(record.definition.maxAggregateReservationBaseUnits, MAX_AGGREGATE_RESERVATION);
        assertEq(record.definition.maxAccountReservationBaseUnits, MAX_ACCOUNT_RESERVATION);

        assertEq(registry.riskDomainCount(), 1);
        assertEq(registry.latestVersion(riskDomainId), 1);
        assertEq(registry.activeVersion(riskDomainId), 0);
        assertTrue(registry.exists(riskDomainId, 1));
        assertFalse(registry.isOpenForNewRisk(riskDomainId, 1));
        assertTrue(registry.isLifecycleEnabled(riskDomainId, 1));
    }

    /// @dev Qualification opens no risk, so a risk policy may be published ahead of the collateral
    /// binding and the adapter it will eventually be switched on against.
    function test_RegistrationSucceedsAgainstPausedAndDeprecatedDependencies() public {
        vm.startPrank(admin);
        settlement.pauseBinding(collateralAssetId, 1);
        adapters.pauseAdapter(riskAdapterId, 1);
        adapters.deprecateAdapter(riskAdapterId, 1);
        vm.stopPrank();

        vm.prank(qualifier);
        (RiskDomainId id, uint32 version) = registry.registerRiskDomain(_definition());

        assertEq(RiskDomainId.unwrap(id), RiskDomainId.unwrap(riskDomainId));
        assertEq(version, 1);
        assertEq(uint8(registry.statusOf(riskDomainId, 1)), uint8(RegistryStatus.Paused));
        assertFalse(registry.isOpenForNewRisk(riskDomainId, 1));
    }

    /// @dev Versions are append-only and never edited: the same definition is refused as a duplicate
    /// of the version that already carries it, a retuning becomes the next version, and neither a
    /// later registration nor a status change may rewrite an earlier record.
    function test_VersionsAreAppendOnlyImmutableAndDeduplicated() public {
        vm.prank(qualifier);
        (, uint32 first) = registry.registerRiskDomain(_definition());
        RiskDomainVersion memory before = registry.getRiskDomain(riskDomainId, 1);

        RiskDomainDefinition memory retuned = _definition();
        retuned.marginRulesHash = keccak256("risk.margin.v2");
        vm.prank(qualifier);
        (, uint32 second) = registry.registerRiskDomain(retuned);

        bytes32 duplicateHash = RiskDomainDefinitionLib.hashDefinition(_definition(), block.chainid);
        vm.prank(qualifier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRiskDomainRegistry.DuplicateRiskDomainDefinition.selector, riskDomainId, duplicateHash, uint32(1)
            )
        );
        registry.registerRiskDomain(_definition());

        vm.startPrank(statusManager);
        registry.activateRiskDomain(riskDomainId, 1);
        registry.pauseRiskDomain(riskDomainId, 1);
        vm.stopPrank();

        RiskDomainVersion memory afterChanges = registry.getRiskDomain(riskDomainId, 1);
        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(registry.riskDomainCount(), 2);
        assertEq(registry.latestVersion(riskDomainId), 2);
        assertEq(afterChanges.definitionHash, before.definitionHash);
        assertEq(afterChanges.versionHash, before.versionHash);
        assertEq(afterChanges.definition.marginRulesHash, MARGIN_RULES_HASH);
        assertEq(registry.getRiskDomain(riskDomainId, 2).definition.marginRulesHash, keccak256("risk.margin.v2"));
    }

    /// @dev Exhaustion is unreachable in practice, so the latest-version pointer is poked directly to
    /// prove the named error replaces what would otherwise be an opaque arithmetic panic. The slot is
    /// discovered through the getter rather than hardcoded, so an inherited storage layout change
    /// cannot silently point this at the wrong word.
    function test_VersionExhaustionIsANamedError() public {
        vm.record();
        registry.latestVersion(riskDomainId);
        (bytes32[] memory readSlots,) = vm.accesses(address(registry));
        vm.store(address(registry), readSlots[0], bytes32(uint256(type(uint32).max)));

        vm.prank(qualifier);
        vm.expectRevert(abi.encodeWithSelector(IRiskDomainRegistry.RiskDomainVersionExhausted.selector, riskDomainId));
        registry.registerRiskDomain(_definition());
    }

    /// @dev Proposing a clearing perimeter and opening risk inside it are different authorities, so
    /// the qualifier may never move status and an outsider may never qualify anything.
    function test_MutationsAreGatedByRoles() public {
        bytes memory unqualified = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registry.RISK_DOMAIN_QUALIFIER_ROLE()
        );

        vm.prank(outsider);
        vm.expectRevert(unqualified);
        registry.registerRiskDomain(_definition());

        vm.prank(qualifier);
        registry.registerRiskDomain(_definition());

        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector,
            qualifier,
            registry.RISK_DOMAIN_STATUS_MANAGER_ROLE()
        );

        vm.startPrank(qualifier);
        vm.expectRevert(expected);
        registry.activateRiskDomain(riskDomainId, 1);
        vm.expectRevert(expected);
        registry.pauseRiskDomain(riskDomainId, 1);
        vm.expectRevert(expected);
        registry.deprecateRiskDomain(riskDomainId, 1);
        vm.stopPrank();
    }

    /// @dev At most one version of a lineage may be active, an old version is never silently paused
    /// to make room, and pausing the active one clears the pointer rather than leaving it dangling.
    function test_OnlyOneVersionIsActiveAndPausingClearsThePointer() public {
        RiskDomainDefinition memory retuned = _definition();
        retuned.scenarioSetHash = keccak256("risk.scenarios.v2");

        vm.startPrank(qualifier);
        registry.registerRiskDomain(_definition());
        registry.registerRiskDomain(retuned);
        vm.stopPrank();

        vm.startPrank(statusManager);
        registry.activateRiskDomain(riskDomainId, 1);
        assertEq(registry.activeVersion(riskDomainId), 1);

        vm.expectRevert(
            abi.encodeWithSelector(IRiskDomainRegistry.AnotherRiskDomainVersionActive.selector, riskDomainId, uint32(1))
        );
        registry.activateRiskDomain(riskDomainId, 2);
        assertEq(uint8(registry.statusOf(riskDomainId, 1)), uint8(RegistryStatus.Active));

        vm.expectEmit(true, true, false, true, address(registry));
        emit IRiskDomainRegistry.RiskDomainActiveVersionChanged(riskDomainId, 1, 0, statusManager);
        registry.pauseRiskDomain(riskDomainId, 1);
        assertEq(registry.activeVersion(riskDomainId), 0);

        registry.activateRiskDomain(riskDomainId, 2);
        assertEq(registry.activeVersion(riskDomainId), 2);
        vm.stopPrank();
    }

    function test_DeprecationIsTerminalAndNothingIsDeleted() public {
        vm.prank(qualifier);
        registry.registerRiskDomain(_definition());

        vm.startPrank(statusManager);
        registry.activateRiskDomain(riskDomainId, 1);
        registry.deprecateRiskDomain(riskDomainId, 1);

        assertEq(registry.activeVersion(riskDomainId), 0);
        assertEq(uint8(registry.statusOf(riskDomainId, 1)), uint8(RegistryStatus.Deprecated));

        vm.expectRevert(
            abi.encodeWithSelector(
                IRiskDomainRegistry.InvalidRiskDomainTransition.selector,
                riskDomainId,
                uint32(1),
                RegistryStatus.Deprecated,
                RegistryStatus.Active
            )
        );
        registry.activateRiskDomain(riskDomainId, 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IRiskDomainRegistry.InvalidRiskDomainTransition.selector,
                riskDomainId,
                uint32(1),
                RegistryStatus.Deprecated,
                RegistryStatus.Paused
            )
        );
        registry.pauseRiskDomain(riskDomainId, 1);
        vm.stopPrank();

        assertTrue(registry.exists(riskDomainId, 1));
        assertTrue(registry.isLifecycleEnabled(riskDomainId, 1));
    }

    /// @dev Activation is the dependency-aware gate that registration deliberately is not: both the
    /// collateral binding and the risk adapter must be open for new risk at the moment the domain is
    /// switched on, and each closes activation on its own.
    function test_ActivationRequiresBothDependenciesOpen() public {
        vm.prank(qualifier);
        registry.registerRiskDomain(_definition());

        vm.prank(admin);
        settlement.pauseBinding(collateralAssetId, 1);

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                IRiskDomainRegistry.CollateralDependencyNotOpen.selector, collateralAssetId, uint32(1)
            )
        );
        registry.activateRiskDomain(riskDomainId, 1);

        vm.startPrank(admin);
        settlement.activateBinding(collateralAssetId, 1);
        adapters.pauseAdapter(riskAdapterId, 1);
        vm.stopPrank();

        vm.prank(statusManager);
        vm.expectRevert(
            abi.encodeWithSelector(IRiskDomainRegistry.RiskAdapterDependencyNotOpen.selector, riskAdapterId, uint32(1))
        );
        registry.activateRiskDomain(riskDomainId, 1);
        assertEq(uint8(registry.statusOf(riskDomainId, 1)), uint8(RegistryStatus.Paused));

        vm.prank(admin);
        adapters.activateAdapter(riskAdapterId, 1);
        vm.prank(statusManager);
        registry.activateRiskDomain(riskDomainId, 1);

        assertTrue(registry.isOpenForNewRisk(riskDomainId, 1));
    }

    /// @dev The live gate keeps watching after activation: pausing the collateral binding or letting
    /// the adapter drift from its qualified bytecode closes the domain for new risk with no status
    /// change here, and restoring the dependency reopens it.
    function test_LiveGateClosesWhenEitherDependencyCloses() public {
        _registerAndActivate();
        assertTrue(registry.isOpenForNewRisk(riskDomainId, 1));

        vm.prank(admin);
        settlement.pauseBinding(collateralAssetId, 1);
        assertFalse(registry.isOpenForNewRisk(riskDomainId, 1));
        assertEq(uint8(registry.statusOf(riskDomainId, 1)), uint8(RegistryStatus.Active));
        assertTrue(registry.isLifecycleEnabled(riskDomainId, 1));

        vm.prank(admin);
        settlement.activateBinding(collateralAssetId, 1);
        assertTrue(registry.isOpenForNewRisk(riskDomainId, 1));

        bytes memory qualified = address(riskImplementation).code;
        vm.etch(address(riskImplementation), address(new MockDriftedAdapterImplementation()).code);
        assertFalse(registry.isOpenForNewRisk(riskDomainId, 1));
        assertTrue(registry.isLifecycleEnabled(riskDomainId, 1));

        vm.etch(address(riskImplementation), qualified);
        assertTrue(registry.isOpenForNewRisk(riskDomainId, 1));
    }

    /// @dev Carrying an open position, running a default process, settling, recovering, replaying a
    /// receipt, and auditing under a retired domain must never require current Active status
    /// anywhere in the dependency graph.
    function test_LifecycleSurvivesFullRetirement() public {
        _registerAndActivate();

        vm.startPrank(admin);
        settlement.pauseBinding(collateralAssetId, 1);
        settlement.deprecateBinding(collateralAssetId, 1);
        assets.deprecateAsset(collateralAssetId);
        adapters.pauseAdapter(riskAdapterId, 1);
        adapters.deprecateAdapter(riskAdapterId, 1);
        vm.stopPrank();
        vm.prank(statusManager);
        registry.deprecateRiskDomain(riskDomainId, 1);

        assertTrue(registry.isLifecycleEnabled(riskDomainId, 1));
        assertFalse(registry.isOpenForNewRisk(riskDomainId, 1));

        RiskDomainVersion memory record = registry.getRiskDomain(riskDomainId, 1);
        assertEq(record.definition.marginRulesHash, MARGIN_RULES_HASH);
        assertEq(record.definition.defaultProcessHash, DEFAULT_PROCESS_HASH);
        assertEq(record.definition.insurancePolicyHash, INSURANCE_POLICY_HASH);
        assertEq(record.definition.maxAggregateLiabilityBaseUnits, MAX_AGGREGATE_LIABILITY);
        assertEq(uint8(record.status), uint8(RegistryStatus.Deprecated));
    }

    /// @dev Reads split deliberately: the record getter reverts, because a zeroed record would name
    /// the zero model and the zero collateral asset and would read as a usable uncapped domain, while
    /// the gate views answer with sentinels so a router may probe blind.
    function test_UnknownRiskDomainRevertsOnGetAndAnswersSentinelsElsewhere() public {
        RiskDomainId ghost = RiskDomainId.wrap(keccak256("ghost.domain"));

        vm.expectRevert(abi.encodeWithSelector(IRiskDomainRegistry.UnknownRiskDomainVersion.selector, ghost, uint32(1)));
        registry.getRiskDomain(ghost, 1);

        vm.prank(statusManager);
        vm.expectRevert(abi.encodeWithSelector(IRiskDomainRegistry.UnknownRiskDomainVersion.selector, ghost, uint32(1)));
        registry.activateRiskDomain(ghost, 1);

        assertEq(registry.latestVersion(ghost), 0);
        assertEq(registry.activeVersion(ghost), 0);
        assertEq(uint8(registry.statusOf(ghost, 1)), uint8(RegistryStatus.Unspecified));
        assertFalse(registry.exists(ghost, 1));
        assertFalse(registry.isOpenForNewRisk(ghost, 1));
        assertFalse(registry.isLifecycleEnabled(ghost, 1));
    }

    function _registerAndActivate() private {
        vm.prank(qualifier);
        registry.registerRiskDomain(_definition());
        vm.prank(statusManager);
        registry.activateRiskDomain(riskDomainId, 1);
    }

    /// @dev Zeroes exactly one required field, indexed in the order `validate` checks them so the
    /// expectation table in the sweep above reads as one aligned list.
    function _definitionWithZeroField(uint256 index) private view returns (RiskDomainDefinition memory definition) {
        definition = _definition();
        if (index == 0) {
            definition.namespaceId = bytes32(0);
        } else if (index == 1) {
            definition.domainKey = bytes32(0);
        } else if (index == 2) {
            definition.riskModelId = RiskModelId.wrap(bytes32(0));
        } else if (index == 3) {
            definition.collateralAssetId = AssetId.wrap(bytes32(0));
        } else if (index == 4) {
            definition.collateralAssetVersion = 0;
        } else if (index == 5) {
            definition.riskAdapterId = AdapterId.wrap(bytes32(0));
        } else if (index == 6) {
            definition.riskAdapterVersion = 0;
        } else if (index == 7) {
            definition.requiredAdapterKindId = AdapterKindId.wrap(bytes32(0));
        } else if (index == 8) {
            definition.requiredInterfaceHash = bytes32(0);
        } else if (index == 9) {
            definition.requiredCapabilityHash = bytes32(0);
        } else if (index == 10) {
            definition.marginRulesHash = bytes32(0);
        } else if (index == 11) {
            definition.scenarioSetHash = bytes32(0);
        } else if (index == 12) {
            definition.concentrationRulesHash = bytes32(0);
        } else if (index == 13) {
            definition.defaultProcessHash = bytes32(0);
        } else if (index == 14) {
            definition.insurancePolicyHash = bytes32(0);
        } else if (index == 15) {
            definition.qualificationEvidenceHash = bytes32(0);
        } else if (index == 16) {
            definition.maxOpenInterestBaseUnits = 0;
        } else if (index == 17) {
            definition.maxAggregateLiabilityBaseUnits = 0;
        } else {
            definition.maxAccountLiabilityBaseUnits = 0;
        }
    }

    /// @dev Moves exactly one field to a different legal value, so the hash sweep proves every one
    /// of them is inside the commitment rather than merely stored beside it.
    function _definitionWithMutatedField(uint256 index) private view returns (RiskDomainDefinition memory definition) {
        definition = _definition();
        if (index == 0) {
            definition.namespaceId = keccak256("acme.risk");
        } else if (index == 1) {
            definition.domainKey = keccak256("risk:perp:portfolio");
        } else if (index == 2) {
            definition.riskModelId = RiskDomainDefinitionLib.RISK_MODEL_PORTFOLIO_MARGIN;
        } else if (index == 3) {
            definition.collateralAssetId = AssetId.wrap(keccak256("other.asset"));
        } else if (index == 4) {
            definition.collateralAssetVersion = 2;
        } else if (index == 5) {
            definition.riskAdapterId = AdapterId.wrap(keccak256("other.adapter"));
        } else if (index == 6) {
            definition.riskAdapterVersion = 2;
        } else if (index == 7) {
            definition.requiredAdapterKindId = AdapterDefinitionLib.ADAPTER_KIND_CURVE;
        } else if (index == 8) {
            definition.requiredInterfaceHash = keccak256("risk.adapter.interface.v2");
        } else if (index == 9) {
            definition.requiredCapabilityHash = keccak256("risk.adapter.capability.v2");
        } else if (index == 10) {
            definition.marginRulesHash = keccak256("risk.margin.v2");
        } else if (index == 11) {
            definition.scenarioSetHash = keccak256("risk.scenarios.v2");
        } else if (index == 12) {
            definition.concentrationRulesHash = keccak256("risk.concentration.v2");
        } else if (index == 13) {
            definition.defaultProcessHash = keccak256("risk.default.v2");
        } else if (index == 14) {
            definition.insurancePolicyHash = keccak256("risk.insurance.v2");
        } else if (index == 15) {
            definition.qualificationEvidenceHash = keccak256("risk.evidence.v2");
        } else if (index == 16) {
            definition.maxOpenInterestBaseUnits = MAX_OPEN_INTEREST + 1;
        } else if (index == 17) {
            definition.maxAggregateLiabilityBaseUnits = MAX_AGGREGATE_LIABILITY + 1;
        } else if (index == 18) {
            definition.maxAccountLiabilityBaseUnits = MAX_ACCOUNT_LIABILITY + 1;
        } else if (index == 19) {
            definition.maxAggregateReservationBaseUnits = MAX_AGGREGATE_RESERVATION + 1;
        } else {
            definition.maxAccountReservationBaseUnits = MAX_ACCOUNT_RESERVATION + 1;
        }
    }

    function _assetDefinition() private pure returns (AssetDefinition memory) {
        return AssetDefinition({
            namespaceId: keccak256("setryn.asset"),
            referenceId: keccak256("iso4217:USD"),
            symbol: "USDC",
            assetClass: AssetClass.Stablecoin,
            decimals: CANONICAL_DECIMALS
        });
    }

    function _bindingDefinition(bytes32 qualificationHash) private view returns (SettlementAssetDefinition memory) {
        return SettlementAssetDefinition({
            assetId: collateralAssetId,
            token: address(token),
            expectedRuntimeCodeHash: address(token).codehash,
            qualificationHash: qualificationHash
        });
    }

    function _adapterDefinition(
        bytes32 referenceId,
        AdapterKindId kindId,
        bytes32 interfaceHash,
        bytes32 capabilityHash
    ) private view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: keccak256("setryn.adapter"),
            referenceId: referenceId,
            kindId: kindId,
            implementation: address(riskImplementation),
            expectedRuntimeCodeHash: address(riskImplementation).codehash,
            interfaceHash: interfaceHash,
            capabilityHash: capabilityHash,
            configurationSchemaHash: keccak256("risk.adapter.config.v1"),
            evidenceHash: keccak256("risk.adapter.evidence.v1")
        });
    }

    function _definition() private view returns (RiskDomainDefinition memory) {
        return RiskDomainDefinition({
            namespaceId: NAMESPACE_ID,
            domainKey: DOMAIN_KEY,
            riskModelId: RiskDomainDefinitionLib.RISK_MODEL_ISOLATED_MARGIN,
            collateralAssetId: collateralAssetId,
            collateralAssetVersion: 1,
            riskAdapterId: riskAdapterId,
            riskAdapterVersion: 1,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_RISK,
            requiredInterfaceHash: INTERFACE_HASH,
            requiredCapabilityHash: CAPABILITY_HASH,
            marginRulesHash: MARGIN_RULES_HASH,
            scenarioSetHash: SCENARIO_SET_HASH,
            concentrationRulesHash: CONCENTRATION_RULES_HASH,
            defaultProcessHash: DEFAULT_PROCESS_HASH,
            insurancePolicyHash: INSURANCE_POLICY_HASH,
            qualificationEvidenceHash: EVIDENCE_HASH,
            maxOpenInterestBaseUnits: MAX_OPEN_INTEREST,
            maxAggregateLiabilityBaseUnits: MAX_AGGREGATE_LIABILITY,
            maxAccountLiabilityBaseUnits: MAX_ACCOUNT_LIABILITY,
            maxAggregateReservationBaseUnits: MAX_AGGREGATE_RESERVATION,
            maxAccountReservationBaseUnits: MAX_ACCOUNT_RESERVATION
        });
    }
}
