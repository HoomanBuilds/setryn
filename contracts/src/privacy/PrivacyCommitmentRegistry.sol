// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IPrivacyCommitmentRegistry} from "../interfaces/IPrivacyCommitmentRegistry.sol";
import {PrivacyCommitmentLib} from "../libraries/PrivacyCommitmentLib.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {
    DisclosureGrant,
    DisclosureGrantId,
    DisclosureGrantStatus,
    PrivacyEnvelopeCommitment,
    PrivacyEnvelopeId,
    PrivacyEnvelopeStatus,
    PrivacyEpochKey,
    PrivacyPolicyDefinition,
    PrivacyPolicyId,
    PrivacyPolicyVersion
} from "../types/PrivacyTypes.sol";

contract PrivacyCommitmentRegistry is IPrivacyCommitmentRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant POLICY_QUALIFIER_ROLE = keccak256("SETRYN_PRIVACY_POLICY_QUALIFIER_ROLE");
    bytes32 public constant POLICY_ACTIVATOR_ROLE = keccak256("SETRYN_PRIVACY_POLICY_ACTIVATOR_ROLE");
    bytes32 public constant EPOCH_KEY_PUBLISHER_ROLE = keccak256("SETRYN_PRIVACY_EPOCH_KEY_PUBLISHER_ROLE");
    bytes32 public constant NON_REVEAL_OUTCOME = keccak256("SetrynPrivacyOutcomeV1:NonRevealExpired");

    mapping(PrivacyPolicyId policyId => mapping(uint32 version => PrivacyPolicyVersion record)) private _policies;
    mapping(PrivacyPolicyId policyId => uint32 version) private _latestPolicyVersion;
    mapping(PrivacyPolicyId policyId => uint32 version) private _activePolicyVersion;
    mapping(PrivacyPolicyId policyId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersions;
    mapping(bytes32 epochKey => PrivacyEpochKey key) private _epochKeys;
    mapping(PrivacyEnvelopeId envelopeId => PrivacyEnvelopeCommitment envelope) private _envelopes;
    mapping(DisclosureGrantId grantId => DisclosureGrant grant) private _grants;

    error ZeroInitialAdmin();
    error InvalidPolicyDefinition();
    error DuplicatePolicyDefinition(PrivacyPolicyId policyId, bytes32 definitionHash);
    error UnknownPolicyVersion(PrivacyPolicyId policyId, uint32 version);
    error InvalidPolicyTransition(RegistryStatus current, RegistryStatus requested);
    error AnotherPolicyVersionActive(PrivacyPolicyId policyId, uint32 version);
    error PolicyNotActive(PrivacyPolicyId policyId, uint32 version);
    error DuplicateEpochKey(PrivacyPolicyId policyId, uint32 version, uint64 epoch);
    error InvalidEpochKey();
    error EpochKeyNotUsable();
    error InvalidEnvelopeCommitment();
    error DuplicateEnvelope(PrivacyEnvelopeId envelopeId);
    error UnknownEnvelope(PrivacyEnvelopeId envelopeId);
    error InvalidEnvelopeStatus(PrivacyEnvelopeStatus status);
    error EnvelopeExpired(uint64 expiresAt, uint256 currentTimestamp);
    error GrantLimitReached(uint16 maximum);
    error InvalidDisclosureGrant();
    error UnknownDisclosureGrant(DisclosureGrantId grantId);
    error InvalidDisclosureGrantStatus(DisclosureGrantStatus status);
    error UnauthorizedEnvelopeSubmitter(address expected, address actual);
    error UnauthorizedDisclosureConsumer();
    error GrantRevocationForbidden();
    error PublicRevealForbidden();
    error ExpiryNotReached(uint64 expiresAt, uint256 currentTimestamp);

    constructor(uint48 defaultAdminDelay, address initialAdmin)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireAdmin(initialAdmin))
    {
        _grantRole(POLICY_QUALIFIER_ROLE, initialAdmin);
        _grantRole(POLICY_ACTIVATOR_ROLE, initialAdmin);
        _grantRole(EPOCH_KEY_PUBLISHER_ROLE, initialAdmin);
    }

    function registerPolicy(PrivacyPolicyDefinition calldata definition)
        external
        onlyRole(POLICY_QUALIFIER_ROLE)
        returns (PrivacyPolicyId policyId, uint32 version)
    {
        _validatePolicy(definition);
        policyId = PrivacyCommitmentLib.derivePolicyId(definition);
        bytes32 definitionHash = PrivacyCommitmentLib.hashPolicyDefinition(definition, block.chainid);
        if (_definitionVersions[policyId][definitionHash] != 0) {
            revert DuplicatePolicyDefinition(policyId, definitionHash);
        }
        version = _latestPolicyVersion[policyId] + 1;
        bytes32 versionHash =
            PrivacyCommitmentLib.hashPolicyVersion(policyId, version, definitionHash, block.chainid, address(this));
        _policies[policyId][version] = PrivacyPolicyVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: versionHash,
            version: version,
            status: RegistryStatus.Paused
        });
        _latestPolicyVersion[policyId] = version;
        _definitionVersions[policyId][definitionHash] = version;
        emit PrivacyPolicyRegistered(
            policyId, version, versionHash, definitionHash, definition, RegistryStatus.Paused, msg.sender
        );
    }

    function activatePolicy(PrivacyPolicyId policyId, uint32 version) external onlyRole(POLICY_ACTIVATOR_ROLE) {
        PrivacyPolicyVersion storage record = _requirePolicy(policyId, version);
        if (record.status != RegistryStatus.Paused) {
            revert InvalidPolicyTransition(record.status, RegistryStatus.Active);
        }
        uint32 active = _activePolicyVersion[policyId];
        if (active != 0 && active != version) revert AnotherPolicyVersionActive(policyId, active);
        record.status = RegistryStatus.Active;
        _activePolicyVersion[policyId] = version;
        emit PrivacyPolicyStatusChanged(policyId, version, RegistryStatus.Paused, RegistryStatus.Active, msg.sender);
    }

    function pausePolicy(PrivacyPolicyId policyId, uint32 version) external onlyRole(POLICY_ACTIVATOR_ROLE) {
        PrivacyPolicyVersion storage record = _requirePolicy(policyId, version);
        if (record.status != RegistryStatus.Active) {
            revert InvalidPolicyTransition(record.status, RegistryStatus.Paused);
        }
        record.status = RegistryStatus.Paused;
        _activePolicyVersion[policyId] = 0;
        emit PrivacyPolicyStatusChanged(policyId, version, RegistryStatus.Active, RegistryStatus.Paused, msg.sender);
    }

    function deprecatePolicy(PrivacyPolicyId policyId, uint32 version) external onlyRole(POLICY_ACTIVATOR_ROLE) {
        PrivacyPolicyVersion storage record = _requirePolicy(policyId, version);
        RegistryStatus previous = record.status;
        if (previous != RegistryStatus.Paused) {
            revert InvalidPolicyTransition(previous, RegistryStatus.Deprecated);
        }
        record.status = RegistryStatus.Deprecated;
        emit PrivacyPolicyStatusChanged(policyId, version, previous, RegistryStatus.Deprecated, msg.sender);
    }

    function publishEpochKey(PrivacyEpochKey calldata key) external onlyRole(EPOCH_KEY_PUBLISHER_ROLE) {
        _requireActivePolicy(key.policyId, key.policyVersion);
        if (
            key.epoch == 0 || key.publicKeyCommitment == bytes32(0) || key.keyServiceId == bytes32(0)
                || key.keyMetadataHash == bytes32(0) || key.validFrom >= key.validUntil
        ) revert InvalidEpochKey();
        bytes32 storageKey = _epochStorageKey(key.policyId, key.policyVersion, key.epoch);
        if (_epochKeys[storageKey].epoch != 0) {
            revert DuplicateEpochKey(key.policyId, key.policyVersion, key.epoch);
        }
        _epochKeys[storageKey] = key;
        emit PrivacyEpochKeyPublished(
            key.policyId,
            key.policyVersion,
            key.epoch,
            PrivacyCommitmentLib.hashEpochKey(key),
            key.publicKeyCommitment,
            key.keyServiceId,
            key.validFrom,
            key.validUntil
        );
    }

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
    ) external returns (PrivacyEnvelopeId envelopeId) {
        PrivacyPolicyVersion storage policy = _requireActivePolicy(policyId, policyVersion);
        PrivacyEpochKey storage key = _epochKeys[_epochStorageKey(policyId, policyVersion, keyEpoch)];
        if (key.epoch == 0 || block.timestamp < key.validFrom || block.timestamp >= key.validUntil) {
            revert EpochKeyNotUsable();
        }
        if (
            subjectKindId == bytes32(0) || subjectId == bytes32(0) || recipientSetCommitment == bytes32(0)
                || encryptedContentHash == bytes32(0) || envelopeCommitment == bytes32(0)
                || disclosureRoot == bytes32(0) || contextHash == bytes32(0) || recipientCount == 0
                || recipientCount > policy.definition.maximumRecipients || expiresAt <= block.timestamp
                || expiresAt > key.validUntil
                || expiresAt - block.timestamp > policy.definition.maximumEnvelopeLifetimeSeconds
        ) revert InvalidEnvelopeCommitment();
        envelopeId = PrivacyCommitmentLib.deriveEnvelopeId(
            block.chainid,
            address(this),
            subjectKindId,
            subjectId,
            policyId,
            policyVersion,
            keyEpoch,
            envelopeCommitment,
            msg.sender
        );
        if (_envelopes[envelopeId].status != PrivacyEnvelopeStatus.Unspecified) revert DuplicateEnvelope(envelopeId);
        _envelopes[envelopeId] = PrivacyEnvelopeCommitment({
            envelopeId: envelopeId,
            policyId: policyId,
            subjectKindId: subjectKindId,
            subjectId: subjectId,
            recipientSetCommitment: recipientSetCommitment,
            encryptedContentHash: encryptedContentHash,
            envelopeCommitment: envelopeCommitment,
            disclosureRoot: disclosureRoot,
            contextHash: contextHash,
            submitter: msg.sender,
            policyVersion: policyVersion,
            keyEpoch: keyEpoch,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            recipientCount: recipientCount,
            grantCount: 0,
            status: PrivacyEnvelopeStatus.Active,
            revealCommitment: bytes32(0)
        });
        emit PrivacyEnvelopeCommitted(
            envelopeId,
            subjectKindId,
            subjectId,
            policyId,
            policyVersion,
            keyEpoch,
            recipientSetCommitment,
            encryptedContentHash,
            envelopeCommitment,
            disclosureRoot,
            contextHash,
            expiresAt,
            recipientCount,
            policy.definition.metadataPolicyHash
        );
    }

    function createDisclosureGrant(
        PrivacyEnvelopeId envelopeId,
        address consumer,
        bytes32 disclosureScopeHash,
        bytes32 disclosedCiphertextHash,
        bytes32 disclosureProofHash,
        uint64 expiresAt,
        bool oneTime
    ) external returns (DisclosureGrantId grantId) {
        PrivacyEnvelopeCommitment storage envelope = _requireActiveEnvelope(envelopeId);
        if (envelope.submitter != msg.sender) revert UnauthorizedEnvelopeSubmitter(envelope.submitter, msg.sender);
        PrivacyPolicyVersion storage policy = _requirePolicy(envelope.policyId, envelope.policyVersion);
        if (envelope.grantCount >= policy.definition.maximumGrants) {
            revert GrantLimitReached(policy.definition.maximumGrants);
        }
        if (
            consumer == address(0) || disclosureScopeHash == bytes32(0) || disclosedCiphertextHash == bytes32(0)
                || disclosureProofHash == bytes32(0) || expiresAt <= block.timestamp || expiresAt > envelope.expiresAt
                || !oneTime
        ) revert InvalidDisclosureGrant();
        bytes32 consumerHash = PrivacyCommitmentLib.consumerCommitment(block.chainid, consumer);
        uint16 ordinal = envelope.grantCount;
        grantId = PrivacyCommitmentLib.deriveGrantId(
            block.chainid, address(this), envelopeId, consumerHash, disclosureScopeHash, ordinal
        );
        if (_grants[grantId].status != DisclosureGrantStatus.Unspecified) revert InvalidDisclosureGrant();
        _grants[grantId] = DisclosureGrant({
            grantId: grantId,
            envelopeId: envelopeId,
            consumerCommitment: consumerHash,
            disclosureScopeHash: disclosureScopeHash,
            disclosedCiphertextHash: disclosedCiphertextHash,
            disclosureProofHash: disclosureProofHash,
            expiresAt: expiresAt,
            oneTime: oneTime,
            status: DisclosureGrantStatus.Active,
            accessReceiptCommitment: bytes32(0)
        });
        envelope.grantCount = ordinal + 1;
        emit DisclosureGrantCreated(
            grantId,
            envelopeId,
            consumerHash,
            disclosureScopeHash,
            disclosedCiphertextHash,
            disclosureProofHash,
            expiresAt,
            oneTime
        );
    }

    function revokeDisclosureGrant(DisclosureGrantId grantId) external {
        DisclosureGrant storage grant = _requireGrant(grantId);
        PrivacyEnvelopeCommitment storage envelope = _requireEnvelope(grant.envelopeId);
        if (envelope.submitter != msg.sender) revert UnauthorizedEnvelopeSubmitter(envelope.submitter, msg.sender);
        PrivacyPolicyVersion storage policy = _requirePolicy(envelope.policyId, envelope.policyVersion);
        if (!policy.definition.allowGrantRevocation) revert GrantRevocationForbidden();
        if (grant.status != DisclosureGrantStatus.Active) revert InvalidDisclosureGrantStatus(grant.status);
        grant.status = DisclosureGrantStatus.Revoked;
        emit DisclosureGrantRevoked(grantId, grant.envelopeId);
    }

    function recordDisclosureAccess(DisclosureGrantId grantId, bytes32 accessReceiptCommitment) external {
        DisclosureGrant storage grant = _requireGrant(grantId);
        PrivacyEnvelopeCommitment storage envelope = _requireActiveEnvelope(grant.envelopeId);
        if (grant.status != DisclosureGrantStatus.Active) revert InvalidDisclosureGrantStatus(grant.status);
        if (block.timestamp >= grant.expiresAt) revert EnvelopeExpired(grant.expiresAt, block.timestamp);
        if (accessReceiptCommitment == bytes32(0)) revert InvalidDisclosureGrant();
        if (PrivacyCommitmentLib.consumerCommitment(block.chainid, msg.sender) != grant.consumerCommitment) {
            revert UnauthorizedDisclosureConsumer();
        }
        bool consumed = grant.oneTime;
        if (consumed) grant.status = DisclosureGrantStatus.Consumed;
        grant.accessReceiptCommitment = accessReceiptCommitment;
        emit DisclosureAccessRecorded(
            grantId, envelope.envelopeId, grant.consumerCommitment, accessReceiptCommitment, consumed
        );
    }

    function recordPublicReveal(PrivacyEnvelopeId envelopeId, bytes32 revealCommitment, bytes32 revealEvidenceHash)
        external
    {
        PrivacyEnvelopeCommitment storage envelope = _requireActiveEnvelope(envelopeId);
        if (envelope.submitter != msg.sender) revert UnauthorizedEnvelopeSubmitter(envelope.submitter, msg.sender);
        PrivacyPolicyVersion storage policy = _requirePolicy(envelope.policyId, envelope.policyVersion);
        if (!policy.definition.allowPublicReveal) revert PublicRevealForbidden();
        if (revealCommitment == bytes32(0) || revealEvidenceHash == bytes32(0)) revert InvalidEnvelopeCommitment();
        envelope.revealCommitment = revealCommitment;
        envelope.status = PrivacyEnvelopeStatus.Revealed;
        emit PrivacyRevealRecorded(envelopeId, revealCommitment, revealEvidenceHash);
    }

    function expireEnvelope(PrivacyEnvelopeId envelopeId) external {
        PrivacyEnvelopeCommitment storage envelope = _requireEnvelope(envelopeId);
        if (envelope.status == PrivacyEnvelopeStatus.Expired) return;
        if (envelope.status != PrivacyEnvelopeStatus.Active) revert InvalidEnvelopeStatus(envelope.status);
        if (block.timestamp < envelope.expiresAt) revert ExpiryNotReached(envelope.expiresAt, block.timestamp);
        envelope.status = PrivacyEnvelopeStatus.Expired;
        bytes32 outcomeHash = keccak256(
            abi.encode(
                NON_REVEAL_OUTCOME,
                PrivacyEnvelopeId.unwrap(envelopeId),
                envelope.subjectId,
                envelope.envelopeCommitment,
                envelope.expiresAt
            )
        );
        emit PrivacyEnvelopeExpired(envelopeId, envelope.subjectId, outcomeHash);
    }

    function getPolicy(PrivacyPolicyId policyId, uint32 version) external view returns (PrivacyPolicyVersion memory) {
        return _requirePolicy(policyId, version);
    }

    function getEpochKey(PrivacyPolicyId policyId, uint32 version, uint64 epoch)
        external
        view
        returns (PrivacyEpochKey memory key)
    {
        key = _epochKeys[_epochStorageKey(policyId, version, epoch)];
        if (key.epoch == 0) revert InvalidEpochKey();
    }

    function getEnvelope(PrivacyEnvelopeId envelopeId) external view returns (PrivacyEnvelopeCommitment memory) {
        return _requireEnvelope(envelopeId);
    }

    function getDisclosureGrant(DisclosureGrantId grantId) external view returns (DisclosureGrant memory) {
        return _requireGrant(grantId);
    }

    function _validatePolicy(PrivacyPolicyDefinition calldata definition) private pure {
        if (
            definition.namespaceId == bytes32(0) || definition.policyKey == bytes32(0)
                || definition.encryptionSchemeId == bytes32(0) || definition.envelopeFormatId == bytes32(0)
                || definition.accessModelId == bytes32(0) || definition.metadataPolicyHash == bytes32(0)
                || definition.qualificationEvidenceHash == bytes32(0) || definition.maximumEnvelopeLifetimeSeconds == 0
                || definition.maximumRecipients == 0 || definition.maximumGrants == 0
        ) revert InvalidPolicyDefinition();
    }

    function _requireActivePolicy(PrivacyPolicyId policyId, uint32 version)
        private
        view
        returns (PrivacyPolicyVersion storage policy)
    {
        policy = _requirePolicy(policyId, version);
        if (policy.status != RegistryStatus.Active || _activePolicyVersion[policyId] != version) {
            revert PolicyNotActive(policyId, version);
        }
    }

    function _requirePolicy(PrivacyPolicyId policyId, uint32 version)
        private
        view
        returns (PrivacyPolicyVersion storage policy)
    {
        policy = _policies[policyId][version];
        if (policy.version == 0) revert UnknownPolicyVersion(policyId, version);
    }

    function _requireEnvelope(PrivacyEnvelopeId envelopeId)
        private
        view
        returns (PrivacyEnvelopeCommitment storage envelope)
    {
        envelope = _envelopes[envelopeId];
        if (envelope.status == PrivacyEnvelopeStatus.Unspecified) revert UnknownEnvelope(envelopeId);
    }

    function _requireActiveEnvelope(PrivacyEnvelopeId envelopeId)
        private
        view
        returns (PrivacyEnvelopeCommitment storage envelope)
    {
        envelope = _requireEnvelope(envelopeId);
        if (envelope.status != PrivacyEnvelopeStatus.Active) revert InvalidEnvelopeStatus(envelope.status);
        if (block.timestamp >= envelope.expiresAt) revert EnvelopeExpired(envelope.expiresAt, block.timestamp);
    }

    function _requireGrant(DisclosureGrantId grantId) private view returns (DisclosureGrant storage grant) {
        grant = _grants[grantId];
        if (grant.status == DisclosureGrantStatus.Unspecified) revert UnknownDisclosureGrant(grantId);
    }

    function _epochStorageKey(PrivacyPolicyId policyId, uint32 version, uint64 epoch) private pure returns (bytes32) {
        return keccak256(abi.encode(PrivacyPolicyId.unwrap(policyId), version, epoch));
    }

    function _requireAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
