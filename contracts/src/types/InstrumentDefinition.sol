// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {AdapterId, AdapterKindId, PayoffFamilyId, SettlementClassId} from "./Identifiers.sol";

struct InstrumentDefinition {
    bytes32 namespaceId;
    bytes32 instrumentKey;
    PayoffFamilyId payoffFamilyId;
    SettlementClassId settlementClassId;
    AdapterId payoffModuleId;
    uint32 payoffModuleVersion;
    AdapterKindId requiredAdapterKindId;
    bytes32 requiredInterfaceHash;
    bytes32 requiredCapabilityHash;
    bytes32 termsSchemaHash;
    uint16 maxFixingSlots;
    uint32 maxTermsBytes;
    uint64 maxEvaluationGas;
    bytes32 lifecyclePolicyHash;
    bytes32 qualificationEvidenceHash;
}

struct InstrumentVersion {
    InstrumentDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}
