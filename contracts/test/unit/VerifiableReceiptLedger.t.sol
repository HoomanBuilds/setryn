// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IVerifiableReceiptLedger} from "../../src/interfaces/IVerifiableReceiptLedger.sol";
import {IPrivacyCommitmentRegistry} from "../../src/interfaces/IPrivacyCommitmentRegistry.sol";
import {VerifiableReceiptLedger} from "../../src/evidence/VerifiableReceiptLedger.sol";
import {EvidenceReceiptLib} from "../../src/libraries/EvidenceReceiptLib.sol";
import {
    EvidenceReceipt,
    ReceiptAuthorityBinding,
    ReceiptDraft,
    ReceiptId,
    ReceiptSubjectTerminalState
} from "../../src/types/EvidenceTypes.sol";
import {
    DisclosureGrant,
    DisclosureGrantId,
    DisclosureGrantStatus,
    PrivacyEnvelopeCommitment,
    PrivacyEnvelopeId,
    PrivacyPolicyId,
    PrivacyPolicyVersion
} from "../../src/types/PrivacyTypes.sol";
import {ReceiptPrivacyRegistryMock, ReceiptSubjectAuthorityMock} from "../mocks/EvidenceMocks.sol";

contract VerifiableReceiptLedgerTest is Test {
    ReceiptSubjectAuthorityMock internal authority;
    VerifiableReceiptLedger internal ledger;
    bytes32 internal kind = keccak256("SetrynReceiptSubjectV1:Settlement");
    bytes32 internal subjectId = keccak256("settlement.id");
    bytes32 internal deploymentHash = keccak256("deployment");
    PrivacyPolicyId internal policyId = PrivacyPolicyId.wrap(keccak256("privacy.policy"));
    PrivacyEnvelopeId internal envelopeId = PrivacyEnvelopeId.wrap(keccak256("privacy.envelope"));
    DisclosureGrantId internal grantId = DisclosureGrantId.wrap(keccak256("privacy.grant"));
    bytes32 internal disclosurePolicyHash = keccak256("disclosure.policy");
    bytes32 internal disclosureScopeHash = keccak256("disclosure.scope");

    function setUp() public {
        authority = new ReceiptSubjectAuthorityMock();
        ReceiptAuthorityBinding[] memory bindings = new ReceiptAuthorityBinding[](1);
        bindings[0] = ReceiptAuthorityBinding({
            subjectKindId: kind, authority: address(authority), deploymentHash: deploymentHash
        });
        ReceiptPrivacyRegistryMock privacyRegistry = new ReceiptPrivacyRegistryMock();
        PrivacyPolicyVersion memory policy;
        policy.definitionHash = disclosurePolicyHash;
        PrivacyEnvelopeCommitment memory envelope;
        envelope.envelopeId = envelopeId;
        envelope.policyId = policyId;
        envelope.subjectKindId = kind;
        envelope.subjectId = subjectId;
        envelope.policyVersion = 1;
        DisclosureGrant memory grant;
        grant.grantId = grantId;
        grant.envelopeId = envelopeId;
        grant.disclosureScopeHash = disclosureScopeHash;
        grant.status = DisclosureGrantStatus.Consumed;
        grant.accessReceiptCommitment = keccak256("privacy.access");
        privacyRegistry.seed(policyId, 1, policy, envelope, grant);
        ledger = new VerifiableReceiptLedger(bindings, IPrivacyCommitmentRegistry(address(privacyRegistry)));
    }

    function test_AppendJournalReceiptAndFinalizeAgainstAuthoritativeTerminalState() public {
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = keccak256("submitted");
        leaves[1] = keccak256("settled");
        bytes32 journalRoot = authority.appendJournal(ledger, kind, subjectId, leaves);
        ReceiptDraft memory draft = _draft(journalRoot);
        ReceiptId receiptId = authority.appendReceipt(IVerifiableReceiptLedger(address(ledger)), draft);
        authority.setTerminalState(
            ReceiptSubjectTerminalState({
                stateHash: draft.subjectStateHash,
                outcomeHash: draft.onchainOutcomeHash,
                terminal: true,
                transitionValid: true
            })
        );

        ledger.finalizeSubject(kind, subjectId);
        EvidenceReceipt memory receipt = ledger.getReceipt(receiptId);

        assertEq(receipt.sequence, 1);
        assertEq(receipt.draft.recoveryJournalRoot, journalRoot);
        assertEq(receipt.authority, address(authority));
    }

    function _draft(bytes32 journalRoot) private view returns (ReceiptDraft memory draft) {
        draft = ReceiptDraft({
            subjectKindId: kind,
            subjectId: subjectId,
            subjectStateHash: keccak256("state"),
            authorizationHash: keccak256("authorization"),
            dependencyVersionsHash: keccak256("dependencies"),
            routeProvenanceHash: keccak256("route"),
            sourceLiquidityEvidenceHash: keccak256("liquidity"),
            reservationEvidenceHash: keccak256("reservations"),
            submittedActionsHash: keccak256("actions"),
            onchainOutcomeHash: keccak256("outcome"),
            feesResidualsHash: keccak256("fees.residuals"),
            recoveryJournalRoot: journalRoot,
            environmentId: keccak256("arbitrum.sepolia"),
            deploymentHash: deploymentHash,
            disclosurePolicyHash: disclosurePolicyHash,
            disclosureScopeHash: disclosureScopeHash,
            publicFieldsHash: bytes32(0),
            privacyPolicyId: policyId,
            privacyEnvelopeId: envelopeId,
            disclosureGrantId: grantId,
            predecessorReceiptId: ReceiptId.wrap(bytes32(0)),
            evidenceGradeBitmap: 7,
            privacyPolicyVersion: 1,
            privateSubject: true
        });
        draft.publicFieldsHash = EvidenceReceiptLib.hashPublicFields(draft, block.chainid);
    }
}
