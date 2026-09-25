// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IInstrumentRegistry} from "../../src/interfaces/IInstrumentRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {
    InstrumentDefinitionLib,
    InvalidMaxEvaluationGas,
    InvalidMaxFixingSlots,
    UnsupportedPayoffAdapterKind,
    UnsupportedSettlementClass
} from "../../src/libraries/InstrumentDefinitionLib.sol";
import {AdapterRegistry} from "../../src/registry/AdapterRegistry.sol";
import {InstrumentRegistry} from "../../src/registry/InstrumentRegistry.sol";
import {AdapterDefinition} from "../../src/types/AdapterDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {
    AdapterId,
    AdapterKindId,
    InstrumentId,
    PayoffFamilyId,
    SettlementClassId
} from "../../src/types/Identifiers.sol";
import {InstrumentDefinition, InstrumentVersion} from "../../src/types/InstrumentDefinition.sol";

contract InstrumentRegistryTest is Test {
    uint48 internal constant ADMIN_DELAY = 3 days;
    uint64 internal constant GAS_HARD_CAP = 2_000_000;
    bytes internal constant RUNTIME_CODE = hex"60006000f3";
    bytes32 internal constant INTERFACE_HASH = keccak256("payoff.interface.v1");
    bytes32 internal constant CAPABILITY_HASH = keccak256("payoff.capability.v1");

    address internal admin = makeAddr("admin");
    address internal qualifier = makeAddr("qualifier");
    address internal statusManager = makeAddr("statusManager");
    address internal outsider = makeAddr("outsider");
    address internal implementation = makeAddr("payoffImplementation");

    AdapterRegistry internal adapters;
    InstrumentRegistry internal registry;
    AdapterId internal payoffModuleId;

    function setUp() public {
        adapters = new AdapterRegistry(ADMIN_DELAY, admin);
        registry = new InstrumentRegistry(ADMIN_DELAY, admin, IAdapterRegistry(address(adapters)), GAS_HARD_CAP);

        vm.startPrank(admin);
        registry.grantRole(registry.INSTRUMENT_QUALIFIER_ROLE(), qualifier);
        registry.grantRole(registry.INSTRUMENT_STATUS_MANAGER_ROLE(), statusManager);
        vm.stopPrank();

        vm.etch(implementation, RUNTIME_CODE);
        vm.prank(admin);
        (payoffModuleId,) = adapters.registerAdapter(_adapterDefinition());
    }

    function test_TypestringsMatchTypehashesAndLimits() public pure {
        assertEq(
            keccak256(bytes(InstrumentDefinitionLib.INSTRUMENT_KEY_TYPESTRING)),
            InstrumentDefinitionLib.INSTRUMENT_KEY_TYPEHASH
        );
        assertEq(
            keccak256(bytes(InstrumentDefinitionLib.INSTRUMENT_DEFINITION_TYPESTRING)),
            InstrumentDefinitionLib.INSTRUMENT_DEFINITION_TYPEHASH
        );
        assertEq(
            keccak256(bytes(InstrumentDefinitionLib.INSTRUMENT_VERSION_TYPESTRING)),
            InstrumentDefinitionLib.INSTRUMENT_VERSION_TYPEHASH
        );
        assertEq(InstrumentDefinitionLib.MAX_FIXING_SLOTS, 16);
        assertEq(InstrumentDefinitionLib.MAX_TERMS_BYTES, 4_096);
    }

    function test_RegistrationDoesNotOpenRiskUntilPayoffAndInstrumentActivate() public {
        vm.prank(qualifier);
        (InstrumentId instrumentId, uint32 version) = registry.registerInstrument(_definition());

        assertEq(uint8(registry.statusOf(instrumentId, version)), uint8(RegistryStatus.Paused));
        assertFalse(registry.isOpenForNewRisk(instrumentId, version));

        vm.expectRevert(
            abi.encodeWithSelector(
                IInstrumentRegistry.PayoffModuleDependencyNotOpen.selector, payoffModuleId, uint32(1)
            )
        );
        vm.prank(statusManager);
        registry.activateInstrument(instrumentId, version);

        vm.prank(admin);
        adapters.activateAdapter(payoffModuleId, 1);
        vm.prank(statusManager);
        registry.activateInstrument(instrumentId, version);

        assertTrue(registry.isOpenForNewRisk(instrumentId, version));
    }

    function test_RolesSeparateQualificationFromActivation() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, registry.INSTRUMENT_QUALIFIER_ROLE()
            )
        );
        vm.prank(outsider);
        registry.registerInstrument(_definition());

        vm.prank(qualifier);
        (InstrumentId instrumentId, uint32 version) = registry.registerInstrument(_definition());

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                qualifier,
                registry.INSTRUMENT_STATUS_MANAGER_ROLE()
            )
        );
        vm.prank(qualifier);
        registry.activateInstrument(instrumentId, version);
    }

    function test_RegistrationRejectsUnsupportedCapabilitiesAndBounds() public {
        InstrumentDefinition memory definition = _definition();
        definition.settlementClassId = SettlementClassId.wrap(keccak256("physical"));
        _expectRegistrationRevert(definition, UnsupportedSettlementClass.selector);

        definition = _definition();
        definition.requiredAdapterKindId = AdapterDefinitionLib.ADAPTER_KIND_RISK;
        _expectRegistrationRevert(definition, UnsupportedPayoffAdapterKind.selector);

        definition = _definition();
        definition.maxFixingSlots = 17;
        _expectRegistrationRevert(definition, InvalidMaxFixingSlots.selector);

        definition = _definition();
        definition.maxEvaluationGas = GAS_HARD_CAP + 1;
        _expectRegistrationRevert(definition, InvalidMaxEvaluationGas.selector);
    }

    function test_RegistrationRejectsAdapterCapabilityMismatch() public {
        InstrumentDefinition memory definition = _definition();
        definition.requiredCapabilityHash = keccak256("different.capability");

        vm.expectPartialRevert(IInstrumentRegistry.PayoffModuleCapabilityMismatch.selector);
        vm.prank(qualifier);
        registry.registerInstrument(definition);
    }

    function test_AppendOnlyVersionsPreserveDefinitionsAndHashes() public {
        InstrumentDefinition memory first = _definition();
        vm.prank(qualifier);
        (InstrumentId instrumentId, uint32 firstVersion) = registry.registerInstrument(first);

        InstrumentDefinition memory second = _definition();
        second.maxTermsBytes = 2_048;
        second.qualificationEvidenceHash = keccak256("instrument.evidence.v2");
        vm.prank(qualifier);
        (InstrumentId secondId, uint32 secondVersion) = registry.registerInstrument(second);

        InstrumentVersion memory storedFirst = registry.getInstrument(instrumentId, firstVersion);
        InstrumentVersion memory storedSecond = registry.getInstrument(secondId, secondVersion);
        assertEq(InstrumentId.unwrap(instrumentId), InstrumentId.unwrap(secondId));
        assertEq(firstVersion, 1);
        assertEq(secondVersion, 2);
        assertEq(storedFirst.definitionHash, InstrumentDefinitionLib.hashDefinition(first, block.chainid));
        assertEq(storedSecond.definitionHash, InstrumentDefinitionLib.hashDefinition(second, block.chainid));
        assertEq(storedFirst.definition.maxTermsBytes, 4_096);
        assertTrue(storedFirst.definitionHash != storedSecond.definitionHash);
    }

    function test_PauseAndDeprecationPreserveHistoricalResolution() public {
        vm.prank(qualifier);
        (InstrumentId instrumentId, uint32 version) = registry.registerInstrument(_definition());
        vm.prank(admin);
        adapters.activateAdapter(payoffModuleId, 1);

        vm.startPrank(statusManager);
        registry.activateInstrument(instrumentId, version);
        registry.pauseInstrument(instrumentId, version);
        registry.deprecateInstrument(instrumentId, version);
        vm.stopPrank();

        assertEq(registry.activeVersion(instrumentId), 0);
        assertTrue(registry.isLifecycleEnabled(instrumentId, version));
        assertEq(uint8(registry.statusOf(instrumentId, version)), uint8(RegistryStatus.Deprecated));
    }

    function _adapterDefinition() internal view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: keccak256("setryn.payoff"),
            referenceId: keccak256("cash.payoff"),
            kindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            implementation: implementation,
            expectedRuntimeCodeHash: keccak256(RUNTIME_CODE),
            interfaceHash: INTERFACE_HASH,
            capabilityHash: CAPABILITY_HASH,
            configurationSchemaHash: keccak256("payoff.config.v1"),
            evidenceHash: keccak256("payoff.adapter.evidence")
        });
    }

    function _definition() internal view returns (InstrumentDefinition memory) {
        return InstrumentDefinition({
            namespaceId: keccak256("setryn.instrument"),
            instrumentKey: keccak256("capped-forward"),
            payoffFamilyId: PayoffFamilyId.wrap(keccak256("payoff.capped-forward")),
            settlementClassId: InstrumentDefinitionLib.SETTLEMENT_CLASS_CASH,
            payoffModuleId: payoffModuleId,
            payoffModuleVersion: 1,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            requiredInterfaceHash: INTERFACE_HASH,
            requiredCapabilityHash: CAPABILITY_HASH,
            termsSchemaHash: keccak256("terms.capped-forward.v1"),
            maxFixingSlots: 4,
            maxTermsBytes: 4_096,
            maxEvaluationGas: 1_000_000,
            lifecyclePolicyHash: keccak256("lifecycle.cash.v1"),
            qualificationEvidenceHash: keccak256("instrument.evidence.v1")
        });
    }

    function _expectRegistrationRevert(InstrumentDefinition memory definition, bytes4 selector) internal {
        vm.expectPartialRevert(selector);
        vm.prank(qualifier);
        registry.registerInstrument(definition);
    }
}
