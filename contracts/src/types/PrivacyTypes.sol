// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";

type PrivacyPolicyId is bytes32;
type PrivacyEnvelopeId is bytes32;
type DisclosureGrantId is bytes32;

enum PrivacyEnvelopeStatus {
    Unspecified,
    Active,
    Revealed,
    Expired
}

enum DisclosureGrantStatus {
    Unspecified,
    Active,
    Consumed,
    Revoked,
    Expired
}

struct PrivacyPolicyDefinition {
    bytes32 namespaceId;
    bytes32 policyKey;
    bytes32 encryptionSchemeId;
    bytes32 envelopeFormatId;
    bytes32 accessModelId;
    bytes32 metadataPolicyHash;
    bytes32 qualificationEvidenceHash;
    uint32 maximumEnvelopeLifetimeSeconds;
    uint16 maximumRecipients;
    uint16 maximumGrants;
    bool allowGrantRevocation;
    bool allowPublicReveal;
}

struct PrivacyPolicyVersion {
    PrivacyPolicyDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}

struct PrivacyEpochKey {
    PrivacyPolicyId policyId;
    bytes32 publicKeyCommitment;
    bytes32 keyServiceId;
    bytes32 keyMetadataHash;
    uint32 policyVersion;
    uint64 epoch;
    uint64 validFrom;
    uint64 validUntil;
}

struct PrivacyEnvelopeCommitment {
    PrivacyEnvelopeId envelopeId;
    PrivacyPolicyId policyId;
    bytes32 subjectKindId;
    bytes32 subjectId;
    bytes32 recipientSetCommitment;
    bytes32 encryptedContentHash;
    bytes32 envelopeCommitment;
    bytes32 disclosureRoot;
    bytes32 contextHash;
    address submitter;
    uint32 policyVersion;
    uint64 keyEpoch;
    uint64 createdAt;
    uint64 expiresAt;
    uint16 recipientCount;
    uint16 grantCount;
    PrivacyEnvelopeStatus status;
    bytes32 revealCommitment;
}

struct DisclosureGrant {
    DisclosureGrantId grantId;
    PrivacyEnvelopeId envelopeId;
    bytes32 consumerCommitment;
    bytes32 disclosureScopeHash;
    bytes32 disclosedCiphertextHash;
    bytes32 disclosureProofHash;
    uint64 expiresAt;
    bool oneTime;
    DisclosureGrantStatus status;
    bytes32 accessReceiptCommitment;
}
