// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "../types/Enums.sol";
import {
    DisclosureGrant,
    DisclosureGrantId,
    PrivacyEnvelopeCommitment,
    PrivacyEnvelopeId,
    PrivacyEpochKey,
    PrivacyPolicyDefinition,
    PrivacyPolicyId,
    PrivacyPolicyVersion
} from "../types/PrivacyTypes.sol";

interface IPrivacyCommitmentRegistry {
    event PrivacyPolicyRegistered(
        PrivacyPolicyId indexed policyId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        PrivacyPolicyDefinition definition,
        RegistryStatus initialStatus,
        address qualifier
    );
    event PrivacyPolicyStatusChanged(
        PrivacyPolicyId indexed policyId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address operator
    );
    event PrivacyEpochKeyPublished(
        PrivacyPolicyId indexed policyId,
        uint32 indexed policyVersion,
        uint64 indexed epoch,
        bytes32 keyCommitmentHash,
        bytes32 publicKeyCommitment,
        bytes32 keyServiceId,
        uint64 validFrom,
        uint64 validUntil
    );
    event PrivacyEnvelopeCommitted(
        PrivacyEnvelopeId indexed envelopeId,
        bytes32 indexed subjectKindId,
        bytes32 indexed subjectId,
        PrivacyPolicyId policyId,
        uint32 policyVersion,
        uint64 keyEpoch,
        bytes32 recipientSetCommitment,
        bytes32 encryptedContentHash,
        bytes32 envelopeCommitment,
        bytes32 disclosureRoot,
        bytes32 contextHash,
        uint64 expiresAt,
        uint16 recipientCount,
        bytes32 metadataLimitationsHash
    );
    event DisclosureGrantCreated(
        DisclosureGrantId indexed grantId,
        PrivacyEnvelopeId indexed envelopeId,
        bytes32 indexed consumerCommitment,
        bytes32 disclosureScopeHash,
        bytes32 disclosedCiphertextHash,
        bytes32 disclosureProofHash,
        uint64 expiresAt,
        bool oneTime
    );
    event DisclosureGrantRevoked(DisclosureGrantId indexed grantId, PrivacyEnvelopeId indexed envelopeId);
    event DisclosureAccessRecorded(
        DisclosureGrantId indexed grantId,
        PrivacyEnvelopeId indexed envelopeId,
        bytes32 indexed consumerCommitment,
        bytes32 accessReceiptCommitment,
        bool consumed
    );
    event PrivacyRevealRecorded(
        PrivacyEnvelopeId indexed envelopeId, bytes32 revealCommitment, bytes32 revealEvidenceHash
    );
    event PrivacyEnvelopeExpired(
        PrivacyEnvelopeId indexed envelopeId, bytes32 indexed subjectId, bytes32 nonRevealOutcomeHash
    );

    function registerPolicy(PrivacyPolicyDefinition calldata definition)
        external
        returns (PrivacyPolicyId policyId, uint32 version);
    function activatePolicy(PrivacyPolicyId policyId, uint32 version) external;
    function pausePolicy(PrivacyPolicyId policyId, uint32 version) external;
    function deprecatePolicy(PrivacyPolicyId policyId, uint32 version) external;
    function publishEpochKey(PrivacyEpochKey calldata key) external;
    function commitEnvelope(
        bytes32 subjectKindId,
        bytes32 subjectId,
        PrivacyPolicyId policyId,
        uint32 policyVersion,
        uint64 keyEpoch,
        bytes32 recipientSetCommitment,
        bytes32 encryptedContentHash,
        bytes32 envelopeCommitment,
        bytes32 disclosureRoot,
        bytes32 contextHash,
        uint64 expiresAt,
        uint16 recipientCount
    ) external returns (PrivacyEnvelopeId envelopeId);
    function createDisclosureGrant(
        PrivacyEnvelopeId envelopeId,
        address consumer,
        bytes32 disclosureScopeHash,
        bytes32 disclosedCiphertextHash,
        bytes32 disclosureProofHash,
        uint64 expiresAt,
        bool oneTime
    ) external returns (DisclosureGrantId grantId);
    function revokeDisclosureGrant(DisclosureGrantId grantId) external;
    function recordDisclosureAccess(DisclosureGrantId grantId, bytes32 accessReceiptCommitment) external;
    function recordPublicReveal(PrivacyEnvelopeId envelopeId, bytes32 revealCommitment, bytes32 revealEvidenceHash)
        external;
    function expireEnvelope(PrivacyEnvelopeId envelopeId) external;
    function getPolicy(PrivacyPolicyId policyId, uint32 version) external view returns (PrivacyPolicyVersion memory);
    function getEpochKey(PrivacyPolicyId policyId, uint32 version, uint64 epoch)
        external
        view
        returns (PrivacyEpochKey memory);
    function getEnvelope(PrivacyEnvelopeId envelopeId) external view returns (PrivacyEnvelopeCommitment memory);
    function getDisclosureGrant(DisclosureGrantId grantId) external view returns (DisclosureGrant memory);
}
