// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {InstrumentDefinitionLib} from "../../src/libraries/InstrumentDefinitionLib.sol";
import {AdapterId, InstrumentId, PayoffFamilyId} from "../../src/types/Identifiers.sol";
import {InstrumentDefinition} from "../../src/types/InstrumentDefinition.sol";

contract InstrumentRegistryFuzzTest is Test {
    uint64 internal constant GAS_HARD_CAP = 5_000_000;

    function testFuzz_AnyNonzeroPayoffFamilyUsesIndependentLineage(bytes32 firstFamily, bytes32 secondFamily) public {
        vm.assume(firstFamily != bytes32(0) && secondFamily != bytes32(0) && firstFamily != secondFamily);
        InstrumentDefinition memory first = _definition();
        InstrumentDefinition memory second = _definition();
        first.payoffFamilyId = PayoffFamilyId.wrap(firstFamily);
        second.payoffFamilyId = PayoffFamilyId.wrap(secondFamily);

        InstrumentDefinitionLib.validate(first, GAS_HARD_CAP);
        InstrumentDefinitionLib.validate(second, GAS_HARD_CAP);
        assertTrue(
            InstrumentId.unwrap(InstrumentDefinitionLib.deriveInstrumentId(first))
                != InstrumentId.unwrap(InstrumentDefinitionLib.deriveInstrumentId(second))
        );
    }

    function testFuzz_LineageIgnoresQualifiedModuleRevision(
        uint32 payoffVersion,
        uint16 maxFixingSlots,
        uint32 maxTermsBytes,
        uint64 maxEvaluationGas,
        bytes32 evidenceHash
    ) public {
        payoffVersion = uint32(bound(payoffVersion, 1, type(uint32).max));
        maxFixingSlots = uint16(bound(maxFixingSlots, 1, InstrumentDefinitionLib.MAX_FIXING_SLOTS));
        maxTermsBytes = uint32(bound(maxTermsBytes, 1, InstrumentDefinitionLib.MAX_TERMS_BYTES));
        maxEvaluationGas = uint64(bound(maxEvaluationGas, 1, GAS_HARD_CAP));
        if (evidenceHash == bytes32(0)) evidenceHash = bytes32(uint256(1));

        InstrumentDefinition memory baseline = _definition();
        InstrumentDefinition memory revised = _definition();
        revised.payoffModuleVersion = payoffVersion;
        revised.maxFixingSlots = maxFixingSlots;
        revised.maxTermsBytes = maxTermsBytes;
        revised.maxEvaluationGas = maxEvaluationGas;
        revised.qualificationEvidenceHash = evidenceHash;

        InstrumentDefinitionLib.validate(revised, GAS_HARD_CAP);
        InstrumentId firstId = InstrumentDefinitionLib.deriveInstrumentId(baseline);
        InstrumentId secondId = InstrumentDefinitionLib.deriveInstrumentId(revised);
        assertEq(InstrumentId.unwrap(firstId), InstrumentId.unwrap(secondId));

        bytes32 firstHash = InstrumentDefinitionLib.hashDefinition(baseline, 42_161);
        bytes32 secondHash = InstrumentDefinitionLib.hashDefinition(revised, 42_161);
        if (keccak256(abi.encode(baseline)) != keccak256(abi.encode(revised))) assertTrue(firstHash != secondHash);
    }

    function testFuzz_DefinitionHashIsStableAndChainBound(uint64 firstChain, uint64 secondChain) public {
        firstChain = uint64(bound(firstChain, 1, type(uint64).max));
        secondChain = uint64(bound(secondChain, 1, type(uint64).max));
        vm.assume(firstChain != secondChain);
        InstrumentDefinition memory definition = _definition();

        bytes32 firstHash = InstrumentDefinitionLib.hashDefinition(definition, firstChain);
        assertEq(firstHash, InstrumentDefinitionLib.hashDefinition(definition, firstChain));
        assertTrue(firstHash != InstrumentDefinitionLib.hashDefinition(definition, secondChain));
    }

    function _definition() private pure returns (InstrumentDefinition memory) {
        return InstrumentDefinition({
            namespaceId: keccak256("namespace"),
            instrumentKey: keccak256("instrument"),
            payoffFamilyId: PayoffFamilyId.wrap(keccak256("family")),
            settlementClassId: InstrumentDefinitionLib.SETTLEMENT_CLASS_CASH,
            payoffModuleId: AdapterId.wrap(keccak256("module")),
            payoffModuleVersion: 1,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            requiredInterfaceHash: keccak256("interface"),
            requiredCapabilityHash: keccak256("capability"),
            termsSchemaHash: keccak256("terms"),
            maxFixingSlots: 16,
            maxTermsBytes: 4_096,
            maxEvaluationGas: 1_000_000,
            lifecyclePolicyHash: keccak256("lifecycle"),
            qualificationEvidenceHash: keccak256("evidence")
        });
    }
}
