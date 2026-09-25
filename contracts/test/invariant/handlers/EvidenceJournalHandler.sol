// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {EvidenceJournalBatch} from "../../../src/types/EvidenceTypes.sol";
import {EvidenceHarness} from "../../unit/harness/EvidenceHarness.sol";

contract EvidenceJournalHandler {
    EvidenceHarness public immutable harness;
    bytes32 public journalRoot;
    uint64 public leafCount;
    uint64 public batchCount;
    uint64 public previousLeafCount;

    constructor(EvidenceHarness harness_) {
        harness = harness_;
    }

    function append(bytes32 leaf) external {
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = leaf;
        bytes32 kind = keccak256("kind");
        bytes32 subjectId = keccak256("subject");
        bytes32 batchRoot = harness.hashJournalBatch(kind, subjectId, leafCount, leaves);
        EvidenceJournalBatch memory batch = EvidenceJournalBatch({
            subjectKindId: kind,
            subjectId: subjectId,
            previousRoot: journalRoot,
            batchRoot: batchRoot,
            journalRoot: bytes32(0),
            batchIndex: batchCount,
            firstLeafIndex: leafCount,
            leafCount: 1
        });
        previousLeafCount = leafCount;
        journalRoot = harness.rollJournalRoot(batch);
        leafCount += 1;
        batchCount += 1;
    }
}
