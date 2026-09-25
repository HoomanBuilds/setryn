// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {EvidenceJournalHandler} from "./handlers/EvidenceJournalHandler.sol";
import {EvidenceHarness} from "../unit/harness/EvidenceHarness.sol";

contract VerifiableReceiptLedgerInvariantTest is StdInvariant, Test {
    EvidenceJournalHandler internal handler;

    function setUp() public {
        handler = new EvidenceJournalHandler(new EvidenceHarness());
        targetContract(address(handler));
    }

    function invariant_JournalCountsAdvanceTogether() public view {
        assertEq(handler.leafCount(), handler.batchCount());
        assertGe(handler.leafCount(), handler.previousLeafCount());
    }
}
