// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    DisclosureGrantId,
    PrivacyEnvelopeId,
    PrivacyEpochKey,
    PrivacyPolicyDefinition,
    PrivacyPolicyId
} from "../types/PrivacyTypes.sol";

library PrivacyCommitmentLib {
    bytes32 internal constant POLICY_KEY_TYPEHASH =
        keccak256("SetrynPrivacyPolicyKeyV1(bytes32 namespaceId,bytes32 policyKey)");
    bytes32 internal constant POLICY_DEFINITION_TYPEHASH = keccak256(
        "SetrynPrivacyPolicyDefinitionV1(bytes32 namespaceId,bytes32 policyKey,bytes32 encryptionSchemeId,bytes32 envelopeFormatId,bytes32 accessModelId,bytes32 metadataPolicyHash,bytes32 qualificationEvidenceHash,uint32 maximumEnvelopeLifetimeSeconds,uint16 maximumRecipients,uint16 maximumGrants,bool allowGrantRevocation,bool allowPublicReveal,uint256 chainId)"
    );
    bytes32 internal constant POLICY_VERSION_TYPEHASH = keccak256(
        "SetrynPrivacyPolicyVersionV1(bytes32 policyId,uint32 version,bytes32 definitionHash,uint256 chainId,address registry)"
    );
    bytes32 internal constant EPOCH_KEY_TYPEHASH = keccak256(
        "SetrynPrivacyEpochKeyV1(bytes32 policyId,uint32 policyVersion,uint64 epoch,bytes32 publicKeyCommitment,bytes32 keyServiceId,bytes32 keyMetadataHash,uint64 validFrom,uint64 validUntil)"
    );
    bytes32 internal constant ENVELOPE_ID_TYPEHASH = keccak256(
        "SetrynPrivacyEnvelopeIdV1(uint256 chainId,address registry,bytes32 subjectKindId,bytes32 subjectId,bytes32 policyId,uint32 policyVersion,uint64 keyEpoch,bytes32 envelopeCommitment,address submitter)"
    );
    bytes32 internal constant GRANT_ID_TYPEHASH = keccak256(
        "SetrynDisclosureGrantIdV1(uint256 chainId,address registry,bytes32 envelopeId,bytes32 consumerCommitment,bytes32 disclosureScopeHash,uint16 ordinal)"
    );
    bytes32 internal constant CONSUMER_TYPEHASH =
        keccak256("SetrynDisclosureConsumerV1(uint256 chainId,address consumer)");

    function derivePolicyId(PrivacyPolicyDefinition memory definition) internal pure returns (PrivacyPolicyId) {
        return
            PrivacyPolicyId.wrap(
                keccak256(abi.encode(POLICY_KEY_TYPEHASH, definition.namespaceId, definition.policyKey))
            );
    }

    function hashPolicyDefinition(PrivacyPolicyDefinition memory definition, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                POLICY_DEFINITION_TYPEHASH,
                definition.namespaceId,
                definition.policyKey,
                definition.encryptionSchemeId,
                definition.envelopeFormatId,
                definition.accessModelId,
                definition.metadataPolicyHash,
                definition.qualificationEvidenceHash,
                definition.maximumEnvelopeLifetimeSeconds,
                definition.maximumRecipients,
                definition.maximumGrants,
                definition.allowGrantRevocation,
                definition.allowPublicReveal,
                chainId
            )
        );
    }

    function hashPolicyVersion(
        PrivacyPolicyId policyId,
        uint32 version,
        bytes32 definitionHash,
        uint256 chainId,
        address registry
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POLICY_VERSION_TYPEHASH, PrivacyPolicyId.unwrap(policyId), version, definitionHash, chainId, registry
            )
        );
    }

    function hashEpochKey(PrivacyEpochKey memory key) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EPOCH_KEY_TYPEHASH,
                PrivacyPolicyId.unwrap(key.policyId),
                key.policyVersion,
                key.epoch,
                key.publicKeyCommitment,
                key.keyServiceId,
                key.keyMetadataHash,
                key.validFrom,
                key.validUntil
            )
        );
    }

    function deriveEnvelopeId(
        uint256 chainId,
        address registry,
        bytes32 subjectKindId,
        bytes32 subjectId,
        PrivacyPolicyId policyId,
        uint32 policyVersion,
        uint64 keyEpoch,
        bytes32 envelopeCommitment,
        address submitter
    ) internal pure returns (PrivacyEnvelopeId) {
        return PrivacyEnvelopeId.wrap(
            keccak256(
                abi.encode(
                    ENVELOPE_ID_TYPEHASH,
                    chainId,
                    registry,
                    subjectKindId,
                    subjectId,
                    PrivacyPolicyId.unwrap(policyId),
                    policyVersion,
                    keyEpoch,
                    envelopeCommitment,
                    submitter
                )
            )
        );
    }

    function deriveGrantId(
        uint256 chainId,
        address registry,
        PrivacyEnvelopeId envelopeId,
        bytes32 consumerCommitment,
        bytes32 disclosureScopeHash,
        uint16 ordinal
    ) internal pure returns (DisclosureGrantId) {
        return DisclosureGrantId.wrap(
            keccak256(
                abi.encode(
                    GRANT_ID_TYPEHASH,
                    chainId,
                    registry,
                    PrivacyEnvelopeId.unwrap(envelopeId),
                    consumerCommitment,
                    disclosureScopeHash,
                    ordinal
                )
            )
        );
    }

    function consumerCommitment(uint256 chainId, address consumer) internal pure returns (bytes32) {
        return keccak256(abi.encode(CONSUMER_TYPEHASH, chainId, consumer));
    }
}
