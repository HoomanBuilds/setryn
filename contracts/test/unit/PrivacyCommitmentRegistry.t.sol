// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PrivacyCommitmentRegistry} from "../../src/privacy/PrivacyCommitmentRegistry.sol";
import {
    DisclosureGrantId,
    DisclosureGrantStatus,
    PrivacyEnvelopeId,
    PrivacyEnvelopeStatus,
    PrivacyEpochKey,
    PrivacyPolicyDefinition,
    PrivacyPolicyId
} from "../../src/types/PrivacyTypes.sol";

contract PrivacyCommitmentRegistryTest is Test {
    PrivacyCommitmentRegistry internal registry;
    PrivacyPolicyId internal policyId;
    address internal submitter = address(0xA11CE);
    address internal consumer = address(0xB0B);

    function setUp() public {
        vm.warp(100);
        registry = new PrivacyCommitmentRegistry(0, address(this));
        (policyId,) = registry.registerPolicy(_policy());
        registry.activatePolicy(policyId, 1);
        registry.publishEpochKey(
            PrivacyEpochKey({
                policyId: policyId,
                publicKeyCommitment: keccak256("public.key"),
                keyServiceId: keccak256("key.service"),
                keyMetadataHash: keccak256("key.metadata"),
                policyVersion: 1,
                epoch: 1,
                validFrom: 90,
                validUntil: 1_000
            })
        );
    }

    function test_OneTimeSelectiveDisclosureStoresOnlyCommitments() public {
        PrivacyEnvelopeId envelopeId = _commitEnvelope(500);
        vm.prank(submitter);
        DisclosureGrantId grantId = registry.createDisclosureGrant(
            envelopeId,
            consumer,
            keccak256("scope"),
            keccak256("disclosed.ciphertext"),
            keccak256("disclosure.proof"),
            400,
            true
        );

        vm.prank(consumer);
        registry.recordDisclosureAccess(grantId, keccak256("access.receipt"));

        assertEq(uint8(registry.getDisclosureGrant(grantId).status), uint8(DisclosureGrantStatus.Consumed));
        assertEq(registry.getDisclosureGrant(grantId).accessReceiptCommitment, keccak256("access.receipt"));
    }

    function test_ExpiryRecordsObjectiveNonRevealOutcome() public {
        PrivacyEnvelopeId envelopeId = _commitEnvelope(200);
        vm.warp(200);

        registry.expireEnvelope(envelopeId);

        assertEq(uint8(registry.getEnvelope(envelopeId).status), uint8(PrivacyEnvelopeStatus.Expired));
    }

    function _commitEnvelope(uint64 expiresAt) private returns (PrivacyEnvelopeId envelopeId) {
        vm.prank(submitter);
        return registry.commitEnvelope(
            keccak256("rfq"),
            keccak256("rfq.id"),
            policyId,
            1,
            1,
            keccak256("recipients"),
            keccak256("encrypted.content"),
            keccak256("envelope"),
            keccak256("disclosure.root"),
            keccak256("context"),
            expiresAt,
            2
        );
    }

    function _policy() private pure returns (PrivacyPolicyDefinition memory) {
        return PrivacyPolicyDefinition({
            namespaceId: keccak256("setryn"),
            policyKey: keccak256("private.rfq"),
            encryptionSchemeId: keccak256("hpke"),
            envelopeFormatId: keccak256("envelope.v1"),
            accessModelId: keccak256("selective.disclosure"),
            metadataPolicyHash: keccak256("metadata.limitations"),
            qualificationEvidenceHash: keccak256("qualification"),
            maximumEnvelopeLifetimeSeconds: 900,
            maximumRecipients: 16,
            maximumGrants: 8,
            allowGrantRevocation: true,
            allowPublicReveal: true
        });
    }
}
