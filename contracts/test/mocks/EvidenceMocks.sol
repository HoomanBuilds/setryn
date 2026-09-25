// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IVerifiableReceiptLedger} from "../../src/interfaces/IVerifiableReceiptLedger.sol";
import {ReceiptDraft, ReceiptId, ReceiptSubjectTerminalState} from "../../src/types/EvidenceTypes.sol";

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
