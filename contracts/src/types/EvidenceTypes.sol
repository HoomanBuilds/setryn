// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {DisclosureGrantId, PrivacyEnvelopeId, PrivacyPolicyId} from "./PrivacyTypes.sol";

type ReceiptId is bytes32;

struct ReceiptAuthorityBinding {
    bytes32 subjectKindId;
    address authority;
    bytes32 deploymentHash;
}

struct ReceiptDraft {
    bytes32 subjectKindId;
    bytes32 subjectId;
    bytes32 subjectStateHash;
    bytes32 authorizationHash;
    bytes32 dependencyVersionsHash;
    bytes32 routeProvenanceHash;
    bytes32 sourceLiquidityEvidenceHash;
    bytes32 reservationEvidenceHash;
    bytes32 submittedActionsHash;
    bytes32 onchainOutcomeHash;
    bytes32 feesResidualsHash;
    bytes32 recoveryJournalRoot;
    bytes32 environmentId;
    bytes32 deploymentHash;
    bytes32 disclosurePolicyHash;
    bytes32 disclosureScopeHash;
    bytes32 publicFieldsHash;
    PrivacyPolicyId privacyPolicyId;
    PrivacyEnvelopeId privacyEnvelopeId;
    DisclosureGrantId disclosureGrantId;
    ReceiptId predecessorReceiptId;
    uint256 evidenceGradeBitmap;
    uint32 privacyPolicyVersion;
    bool privateSubject;
}

struct EvidenceReceipt {
    ReceiptId receiptId;
    ReceiptDraft draft;
    uint64 sequence;
    uint64 recordedAt;
    uint64 recordedBlock;
    address authority;
}

struct EvidenceJournalBatch {
    bytes32 subjectKindId;
    bytes32 subjectId;
    bytes32 previousRoot;
    bytes32 batchRoot;
    bytes32 journalRoot;
    uint64 batchIndex;
    uint64 firstLeafIndex;
    uint32 leafCount;
}

struct ReceiptSubjectTerminalState {
    bytes32 stateHash;
    bytes32 outcomeHash;
    bool terminal;
    bool transitionValid;
}
