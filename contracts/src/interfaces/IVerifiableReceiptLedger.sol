// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    EvidenceJournalBatch,
    EvidenceReceipt,
    ReceiptAuthorityBinding,
    ReceiptDraft,
    ReceiptId
} from "../types/EvidenceTypes.sol";

interface IVerifiableReceiptLedger {
    event EvidenceJournalBatchAppended(
        bytes32 indexed subjectKindId,
        bytes32 indexed subjectId,
        uint64 indexed batchIndex,
        bytes32 previousRoot,
        bytes32 batchRoot,
        bytes32 journalRoot,
        uint64 firstLeafIndex,
        uint32 leafCount,
        address authority
    );
    event EvidenceReceiptAppended(
        ReceiptId indexed receiptId,
        bytes32 indexed subjectKindId,
        bytes32 indexed subjectId,
        uint64 sequence,
        bytes32 predecessorReceiptId,
        bytes32 subjectStateHash,
        bytes32 onchainOutcomeHash,
        bytes32 recoveryJournalRoot,
        uint256 evidenceGradeBitmap,
        bytes32 environmentId,
        uint256 chainId,
        bytes32 deploymentHash,
        bool privateSubject,
        bytes32 privacyEnvelopeId,
        bytes32 disclosurePolicyHash,
        bytes32 publicFieldsHash,
        address authority
    );
    event ReceiptSubjectFinalized(
        bytes32 indexed subjectKindId,
        bytes32 indexed subjectId,
        ReceiptId indexed finalReceiptId,
        bytes32 stateHash,
        bytes32 outcomeHash,
        address caller
    );

    function appendJournalBatch(bytes32 subjectKindId, bytes32 subjectId, bytes32[] calldata leaves)
        external
        returns (bytes32 journalRoot);
    function appendReceipt(ReceiptDraft calldata draft) external returns (ReceiptId receiptId);
    function finalizeSubject(bytes32 subjectKindId, bytes32 subjectId) external;
    function getReceipt(ReceiptId receiptId) external view returns (EvidenceReceipt memory receipt);
    function getJournalBatch(bytes32 subjectKindId, bytes32 subjectId, uint64 batchIndex)
        external
        view
        returns (EvidenceJournalBatch memory batch);
    function latestReceipt(bytes32 subjectKindId, bytes32 subjectId)
        external
        view
        returns (ReceiptId receiptId, uint64 sequence);
    function journalState(bytes32 subjectKindId, bytes32 subjectId)
        external
        view
        returns (bytes32 root, uint64 leafCount, uint64 batchCount);
    function authorityOf(bytes32 subjectKindId) external view returns (ReceiptAuthorityBinding memory binding);
    function verifyJournalProof(
        bytes32 subjectKindId,
        bytes32 subjectId,
        uint64 batchIndex,
        uint64 leafIndex,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool);
}
