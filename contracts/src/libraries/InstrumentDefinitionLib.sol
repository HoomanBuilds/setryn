// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AdapterDefinitionLib} from "./AdapterDefinitionLib.sol";
import {IdLib} from "./IdLib.sol";
import {InstrumentDefinition} from "../types/InstrumentDefinition.sol";
import {AdapterId, AdapterKindId, InstrumentId, PayoffFamilyId, SettlementClassId} from "../types/Identifiers.sol";

error ZeroInstrumentNamespaceId();
error ZeroInstrumentKey();
error ZeroPayoffFamilyId();
error UnsupportedSettlementClass(SettlementClassId settlementClassId);
error ZeroPayoffModule();
error UnsupportedPayoffAdapterKind(AdapterKindId adapterKindId);
error ZeroInstrumentInterfaceHash();
error ZeroInstrumentCapabilityHash();
error ZeroTermsSchemaHash();
error InvalidMaxFixingSlots(uint16 maxFixingSlots);
error InvalidMaxTermsBytes(uint32 maxTermsBytes);
error InvalidMaxEvaluationGas(uint64 maxEvaluationGas, uint64 hardCap);
error ZeroLifecyclePolicyHash();
error ZeroInstrumentQualificationEvidenceHash();

library InstrumentDefinitionLib {
    uint16 internal constant MAX_FIXING_SLOTS = 16;
    uint32 internal constant MAX_TERMS_BYTES = 4_096;

    SettlementClassId internal constant SETTLEMENT_CLASS_CASH =
        SettlementClassId.wrap(keccak256("SetrynSettlementClassV1:Cash"));

    string internal constant INSTRUMENT_KEY_TYPESTRING =
        "SetrynInstrumentKeyV1(bytes32 namespaceId,bytes32 instrumentKey,bytes32 payoffFamilyId)";
    bytes32 internal constant INSTRUMENT_KEY_TYPEHASH =
        keccak256("SetrynInstrumentKeyV1(bytes32 namespaceId,bytes32 instrumentKey,bytes32 payoffFamilyId)");

    string internal constant INSTRUMENT_DEFINITION_TYPESTRING =
        "SetrynInstrumentDefinitionV1(bytes32 namespaceId,bytes32 instrumentKey,bytes32 payoffFamilyId,bytes32 settlementClassId,bytes32 payoffModuleId,uint32 payoffModuleVersion,bytes32 requiredAdapterKindId,bytes32 requiredInterfaceHash,bytes32 requiredCapabilityHash,bytes32 termsSchemaHash,uint16 maxFixingSlots,uint32 maxTermsBytes,uint64 maxEvaluationGas,bytes32 lifecyclePolicyHash,bytes32 qualificationEvidenceHash,uint256 chainId)";
    bytes32 internal constant INSTRUMENT_DEFINITION_TYPEHASH = keccak256(
        "SetrynInstrumentDefinitionV1(bytes32 namespaceId,bytes32 instrumentKey,bytes32 payoffFamilyId,bytes32 settlementClassId,bytes32 payoffModuleId,uint32 payoffModuleVersion,bytes32 requiredAdapterKindId,bytes32 requiredInterfaceHash,bytes32 requiredCapabilityHash,bytes32 termsSchemaHash,uint16 maxFixingSlots,uint32 maxTermsBytes,uint64 maxEvaluationGas,bytes32 lifecyclePolicyHash,bytes32 qualificationEvidenceHash,uint256 chainId)"
    );

    string internal constant INSTRUMENT_VERSION_TYPESTRING =
        "SetrynInstrumentVersionV1(bytes32 instrumentId,uint32 version,bytes32 definitionHash,uint256 chainId)";
    bytes32 internal constant INSTRUMENT_VERSION_TYPEHASH = keccak256(
        "SetrynInstrumentVersionV1(bytes32 instrumentId,uint32 version,bytes32 definitionHash,uint256 chainId)"
    );

    function validate(InstrumentDefinition memory definition, uint64 evaluationGasHardCap) internal pure {
        if (definition.namespaceId == bytes32(0)) revert ZeroInstrumentNamespaceId();
        if (definition.instrumentKey == bytes32(0)) revert ZeroInstrumentKey();
        if (PayoffFamilyId.unwrap(definition.payoffFamilyId) == bytes32(0)) revert ZeroPayoffFamilyId();
        if (SettlementClassId.unwrap(definition.settlementClassId) != SettlementClassId.unwrap(SETTLEMENT_CLASS_CASH)) {
            revert UnsupportedSettlementClass(definition.settlementClassId);
        }
        if (AdapterId.unwrap(definition.payoffModuleId) == bytes32(0) || definition.payoffModuleVersion == 0) {
            revert ZeroPayoffModule();
        }
        if (
            AdapterKindId.unwrap(definition.requiredAdapterKindId)
                != AdapterKindId.unwrap(AdapterDefinitionLib.ADAPTER_KIND_PAYOFF)
        ) revert UnsupportedPayoffAdapterKind(definition.requiredAdapterKindId);
        if (definition.requiredInterfaceHash == bytes32(0)) revert ZeroInstrumentInterfaceHash();
        if (definition.requiredCapabilityHash == bytes32(0)) revert ZeroInstrumentCapabilityHash();
        if (definition.termsSchemaHash == bytes32(0)) revert ZeroTermsSchemaHash();
        if (definition.maxFixingSlots == 0 || definition.maxFixingSlots > MAX_FIXING_SLOTS) {
            revert InvalidMaxFixingSlots(definition.maxFixingSlots);
        }
        if (definition.maxTermsBytes == 0 || definition.maxTermsBytes > MAX_TERMS_BYTES) {
            revert InvalidMaxTermsBytes(definition.maxTermsBytes);
        }
        if (definition.maxEvaluationGas == 0 || definition.maxEvaluationGas > evaluationGasHardCap) {
            revert InvalidMaxEvaluationGas(definition.maxEvaluationGas, evaluationGasHardCap);
        }
        if (definition.lifecyclePolicyHash == bytes32(0)) revert ZeroLifecyclePolicyHash();
        if (definition.qualificationEvidenceHash == bytes32(0)) {
            revert ZeroInstrumentQualificationEvidenceHash();
        }
    }

    function hashKey(InstrumentDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INSTRUMENT_KEY_TYPEHASH,
                definition.namespaceId,
                definition.instrumentKey,
                PayoffFamilyId.unwrap(definition.payoffFamilyId)
            )
        );
    }

    function hashDefinition(InstrumentDefinition memory definition, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INSTRUMENT_DEFINITION_TYPEHASH,
                definition.namespaceId,
                definition.instrumentKey,
                PayoffFamilyId.unwrap(definition.payoffFamilyId),
                SettlementClassId.unwrap(definition.settlementClassId),
                AdapterId.unwrap(definition.payoffModuleId),
                definition.payoffModuleVersion,
                AdapterKindId.unwrap(definition.requiredAdapterKindId),
                definition.requiredInterfaceHash,
                definition.requiredCapabilityHash,
                definition.termsSchemaHash,
                definition.maxFixingSlots,
                definition.maxTermsBytes,
                definition.maxEvaluationGas,
                definition.lifecyclePolicyHash,
                definition.qualificationEvidenceHash,
                chainId
            )
        );
    }

    function hashVersion(InstrumentId instrumentId, uint32 version, bytes32 definitionHash, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(INSTRUMENT_VERSION_TYPEHASH, InstrumentId.unwrap(instrumentId), version, definitionHash, chainId)
        );
    }

    function deriveInstrumentId(InstrumentDefinition memory definition) internal pure returns (InstrumentId) {
        return IdLib.deriveInstrumentId(hashKey(definition));
    }
}
