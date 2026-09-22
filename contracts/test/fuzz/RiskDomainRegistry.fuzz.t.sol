// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {RiskDomainDefinitionLib} from "../../src/libraries/RiskDomainDefinitionLib.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {RiskDomainRegistry} from "../../src/registry/RiskDomainRegistry.sol";
import {SettlementAssetRegistry} from "../../src/registry/SettlementAssetRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../../src/types/AssetDefinition.sol";
import {AssetClass, RegistryStatus} from "../../src/types/Enums.sol";
import {AdapterId, AssetId, RiskDomainId, RiskModelId} from "../../src/types/Identifiers.sol";
import {RiskDomainDefinition, RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";
import {SettlementAssetDefinition} from "../../src/types/SettlementAssetDefinition.sol";
import {MockAdapterImplementation} from "../mocks/AdapterMocks.sol";
import {MockERC20Metadata} from "../mocks/TokenMocks.sol";

contract RiskDomainRegistryFuzzTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;

    bytes32 internal constant NAMESPACE_ID = keccak256("setryn.risk");
    bytes32 internal constant DOMAIN_KEY = keccak256("risk:perp:isolated");

    bytes32 internal constant INTERFACE_HASH = keccak256("risk.adapter.interface.v1");
    bytes32 internal constant CAPABILITY_HASH = keccak256("risk.adapter.capability.v1");

    uint8 internal constant CANONICAL_DECIMALS = 6;

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");

    AssetRegistry internal assets;
    SettlementAssetRegistry internal settlement;
    AdapterRegistry internal adapters;
    RiskDomainRegistry internal registry;

    AssetId internal collateralAssetId;
    AdapterId internal riskAdapterId;

    function setUp() public {
        assets = new AssetRegistry(ADMIN_DELAY, admin);
        settlement = new SettlementAssetRegistry(ADMIN_DELAY, admin, assets);
        adapters = new AdapterRegistry(ADMIN_DELAY, admin);
        registry = new RiskDomainRegistry(ADMIN_DELAY, admin, settlement, adapters);

        MockERC20Metadata token = new MockERC20Metadata(CANONICAL_DECIMALS);
        MockAdapterImplementation implementation = new MockAdapterImplementation();

        vm.startPrank(admin);
        registry.grantRole(registry.RISK_DOMAIN_QUALIFIER_ROLE(), qualifier);
        collateralAssetId = assets.registerAsset(
            AssetDefinition({
                namespaceId: keccak256("setryn.asset"),
                referenceId: keccak256("iso4217:USD"),
                symbol: "USDC",
                assetClass: AssetClass.Stablecoin,
                decimals: CANONICAL_DECIMALS
            })
        );
        settlement.registerBinding(
            SettlementAssetDefinition({
                assetId: collateralAssetId,
                token: address(token),
                expectedRuntimeCodeHash: address(token).codehash,
                qualificationHash: keccak256("settlement.qualification.v1")
            })
        );
        (riskAdapterId,) = adapters.registerAdapter(
            AdapterDefinition({
                namespaceId: keccak256("setryn.adapter"),
                referenceId: keccak256("risk:engine"),
                kindId: AdapterDefinitionLib.ADAPTER_KIND_RISK,
                implementation: address(implementation),
                expectedRuntimeCodeHash: address(implementation).codehash,
                interfaceHash: INTERFACE_HASH,
                capabilityHash: CAPABILITY_HASH,
                configurationSchemaHash: keccak256("risk.adapter.config.v1"),
                evidenceHash: keccak256("risk.adapter.evidence.v1")
            })
        );
        vm.stopPrank();
    }

    /// @dev The cap envelope must hold across the entire uint128 domain rather than at the handful
    /// of points a unit test can name. Open interest and both liability caps must be nonzero, the
    /// account liability must sit inside the aggregate one, and the two reservation caps are either
    /// both zero, which disables reservation-backed quote modes, or both nonzero with the account
    /// reservation inside the aggregate reservation and each reservation inside the liability cap at
    /// its own scope. Every other combination registers and stores back exactly what was submitted,
    /// including an open interest cap far below or far above any other cap, because notional exposure
    /// and loss exposure are different risk measures with no ordering between them. Acceptance is
    /// never a solvency statement; it only records the ceilings a clearing engine must additionally
    /// respect.
    function testFuzz_CapEnvelopeIsEnforcedAcrossTheWholeDomain(
        uint128 maxOpenInterest,
        uint128 maxAggregateLiability,
        uint128 maxAccountLiability,
        uint128 maxAggregateReservation,
        uint128 maxAccountReservation
    ) public {
        RiskDomainDefinition memory definition = _definition();
        definition.maxOpenInterestBaseUnits = maxOpenInterest;
        definition.maxAggregateLiabilityBaseUnits = maxAggregateLiability;
        definition.maxAccountLiabilityBaseUnits = maxAccountLiability;
        definition.maxAggregateReservationBaseUnits = maxAggregateReservation;
        definition.maxAccountReservationBaseUnits = maxAccountReservation;

        bool anyZero = maxOpenInterest == 0 || maxAggregateLiability == 0 || maxAccountLiability == 0;
        bool reservationsEnabled = maxAggregateReservation != 0 && maxAccountReservation != 0;
        bool partialReservations = (maxAggregateReservation == 0) != (maxAccountReservation == 0);
        bool inverted = maxAccountLiability > maxAggregateLiability
            || (reservationsEnabled
                && (maxAccountReservation > maxAggregateReservation
                    || maxAggregateReservation > maxAggregateLiability
                    || maxAccountReservation > maxAccountLiability));

        if (anyZero || partialReservations || inverted) {
            vm.prank(qualifier);
            vm.expectRevert();
            registry.registerRiskDomain(definition);
            assertEq(registry.riskDomainCount(), 0);
            return;
        }

        vm.prank(qualifier);
        (RiskDomainId riskDomainId, uint32 version) = registry.registerRiskDomain(definition);

        RiskDomainVersion memory record = registry.getRiskDomain(riskDomainId, version);
        assertEq(record.definition.maxOpenInterestBaseUnits, maxOpenInterest);
        assertEq(record.definition.maxAggregateLiabilityBaseUnits, maxAggregateLiability);
        assertEq(record.definition.maxAccountLiabilityBaseUnits, maxAccountLiability);
        assertEq(record.definition.maxAggregateReservationBaseUnits, maxAggregateReservation);
        assertEq(record.definition.maxAccountReservationBaseUnits, maxAccountReservation);
        assertEq(uint8(record.status), uint8(RegistryStatus.Paused));
        assertEq(record.definitionHash, RiskDomainDefinitionLib.hashDefinition(definition, block.chainid));
        assertEq(record.definitionHash, RiskDomainDefinitionLib.hashDefinitionUnsplit(definition, block.chainid));
    }

    /// @dev Identity is the namespaced domain name alone, so an arbitrary risk model and an
    /// arbitrary set of rule, scenario, and default commitments must all collapse onto one lineage,
    /// take sequential versions, stay readable unchanged, and never be registrable twice.
    function testFuzz_ArbitraryRiskModelsAndCommitmentsShareOneLineage(bytes32[4] memory seeds) public {
        RiskDomainId expectedId = RiskDomainDefinitionLib.deriveRiskDomainId(_definition());
        bytes32[4] memory storedHashes;

        for (uint256 i = 0; i < seeds.length; i++) {
            RiskDomainDefinition memory definition = _definition();
            definition.riskModelId = RiskModelId.wrap(keccak256(abi.encode(seeds[i], "model", i)));
            definition.marginRulesHash = keccak256(abi.encode(seeds[i], "margin", i));
            definition.scenarioSetHash = keccak256(abi.encode(seeds[i], "scenarios", i));
            definition.defaultProcessHash = keccak256(abi.encode(seeds[i], "default", i));

            vm.prank(qualifier);
            (RiskDomainId riskDomainId, uint32 version) = registry.registerRiskDomain(definition);

            assertEq(RiskDomainId.unwrap(riskDomainId), RiskDomainId.unwrap(expectedId));
            assertEq(version, uint32(i + 1));
            assertEq(registry.latestVersion(riskDomainId), version);
            assertEq(registry.riskDomainCount(), i + 1);

            storedHashes[i] = registry.getRiskDomain(riskDomainId, version).definitionHash;

            vm.expectRevert(
                abi.encodeWithSelector(
                    IRiskDomainRegistry.DuplicateRiskDomainDefinition.selector, riskDomainId, storedHashes[i], version
                )
            );
            vm.prank(qualifier);
            registry.registerRiskDomain(definition);
        }

        for (uint256 i = 0; i < seeds.length; i++) {
            uint32 version = uint32(i + 1);
            RiskDomainVersion memory record = registry.getRiskDomain(expectedId, version);

            assertEq(record.version, version);
            assertEq(record.definitionHash, storedHashes[i]);
            assertEq(
                record.versionHash,
                RiskDomainDefinitionLib.hashVersion(expectedId, version, storedHashes[i], block.chainid)
            );
            assertTrue(registry.isLifecycleEnabled(expectedId, version));
            assertFalse(registry.isOpenForNewRisk(expectedId, version));
        }
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
            marginRulesHash: keccak256("risk.margin.v1"),
            scenarioSetHash: keccak256("risk.scenarios.v1"),
            concentrationRulesHash: keccak256("risk.concentration.v1"),
            defaultProcessHash: keccak256("risk.default.v1"),
            insurancePolicyHash: keccak256("risk.insurance.v1"),
            qualificationEvidenceHash: keccak256("risk.evidence.v1"),
            maxOpenInterestBaseUnits: 500_000_000,
            maxAggregateLiabilityBaseUnits: 200_000_000,
            maxAccountLiabilityBaseUnits: 20_000_000,
            maxAggregateReservationBaseUnits: 10_000_000,
            maxAccountReservationBaseUnits: 5_000_000
        });
    }
}
