// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IVerifiableReceiptLedger} from "../../src/interfaces/IVerifiableReceiptLedger.sol";
import {VerifiableReceiptLedger} from "../../src/evidence/VerifiableReceiptLedger.sol";
import {
    EvidenceReceipt,
    ReceiptAuthorityBinding,
    ReceiptDraft,
    ReceiptId,
    ReceiptSubjectTerminalState
} from "../../src/types/EvidenceTypes.sol";
import {PrivacyEnvelopeId} from "../../src/types/PrivacyTypes.sol";
import {ReceiptSubjectAuthorityMock} from "../mocks/EvidenceMocks.sol";

contract VerifiableReceiptLedgerTest is Test {
    ReceiptSubjectAuthorityMock internal authority;
    VerifiableReceiptLedger internal ledger;
    bytes32 internal kind = keccak256("SetrynReceiptSubjectV1:Settlement");
    bytes32 internal subjectId = keccak256("settlement.id");
    bytes32 internal deploymentHash = keccak256("deployment");

    function setUp() public {
        authority = new ReceiptSubjectAuthorityMock();
        ReceiptAuthorityBinding[] memory bindings = new ReceiptAuthorityBinding[](1);
        bindings[0] = ReceiptAuthorityBinding({
            subjectKindId: kind, authority: address(authority), deploymentHash: deploymentHash
        });
        ledger = new VerifiableReceiptLedger(bindings);
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

    function _draft(bytes32 journalRoot) private view returns (ReceiptDraft memory) {
        return ReceiptDraft({
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
            disclosurePolicyHash: keccak256("disclosure.policy"),
            publicFieldsHash: keccak256("approved.public.fields"),
            privacyEnvelopeId: PrivacyEnvelopeId.wrap(keccak256("privacy.envelope")),
            predecessorReceiptId: ReceiptId.wrap(bytes32(0)),
            evidenceGradeBitmap: 7,
            privateSubject: true
        });
    }
}
