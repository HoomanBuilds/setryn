// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReceiptSubjectTerminalState} from "../types/EvidenceTypes.sol";

interface IReceiptSubjectAuthority {
    function receiptSubjectTerminalState(bytes32 subjectKindId, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory state);
}
