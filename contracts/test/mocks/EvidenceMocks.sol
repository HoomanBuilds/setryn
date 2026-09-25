// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IVerifiableReceiptLedger} from "../../src/interfaces/IVerifiableReceiptLedger.sol";
import {ReceiptDraft, ReceiptId, ReceiptSubjectTerminalState} from "../../src/types/EvidenceTypes.sol";
import {
    DisclosureGrant,
    DisclosureGrantId,
    PrivacyEnvelopeCommitment,
    PrivacyEnvelopeId,
    PrivacyPolicyId,
    PrivacyPolicyVersion
} from "../../src/types/PrivacyTypes.sol";

contract ReceiptPrivacyRegistryMock {
    mapping(PrivacyPolicyId policyId => mapping(uint32 version => PrivacyPolicyVersion policy)) private _policies;
    mapping(PrivacyEnvelopeId envelopeId => PrivacyEnvelopeCommitment envelope) private _envelopes;
    mapping(DisclosureGrantId grantId => DisclosureGrant grant) private _grants;

    function seed(
        PrivacyPolicyId policyId,
        uint32 version,
        PrivacyPolicyVersion calldata policy,
        PrivacyEnvelopeCommitment calldata envelope,
        DisclosureGrant calldata grant
    ) external {
        _policies[policyId][version] = policy;
        _envelopes[envelope.envelopeId] = envelope;
        _grants[grant.grantId] = grant;
    }

    function getPolicy(PrivacyPolicyId policyId, uint32 version) external view returns (PrivacyPolicyVersion memory) {
        return _policies[policyId][version];
    }

    function getEnvelope(PrivacyEnvelopeId envelopeId) external view returns (PrivacyEnvelopeCommitment memory) {
        return _envelopes[envelopeId];
    }

    function getDisclosureGrant(DisclosureGrantId grantId) external view returns (DisclosureGrant memory) {
        return _grants[grantId];
    }
}

contract ReceiptSubjectAuthorityMock {
    ReceiptSubjectTerminalState private _state;

    function setTerminalState(ReceiptSubjectTerminalState calldata state) external {
        _state = state;
    }

    function receiptSubjectTerminalState(bytes32, bytes32) external view returns (ReceiptSubjectTerminalState memory) {
        return _state;
    }

    function appendJournal(
        IVerifiableReceiptLedger ledger,
        bytes32 subjectKindId,
        bytes32 subjectId,
        bytes32[] calldata leaves
    ) external returns (bytes32) {
        return ledger.appendJournalBatch(subjectKindId, subjectId, leaves);
    }

    function appendReceipt(IVerifiableReceiptLedger ledger, ReceiptDraft calldata draft) external returns (ReceiptId) {
        return ledger.appendReceipt(draft);
    }
}
