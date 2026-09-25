// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {EvidenceHarness} from "../unit/harness/EvidenceHarness.sol";

contract EvidenceReceiptLibFuzzTest is Test {
    EvidenceHarness internal harness = new EvidenceHarness();

    function testFuzz_SingleLeafProofRoundTrips(
        bytes32 subjectKindId,
        bytes32 subjectId,
        uint64 leafIndex,
        bytes32 leaf
    ) public view {
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = leaf;
        bytes32 root = harness.hashJournalBatch(subjectKindId, subjectId, leafIndex, leaves);
        bytes32 leafHash = harness.journalLeafHash(subjectKindId, subjectId, leafIndex, leaf);
        assertTrue(harness.verifyMerkleProof(leafHash, 0, new bytes32[](0), root));
    }

    function testFuzz_ConsumerCommitmentIsChainAndAddressBound(uint256 chainId, address consumer) public view {
        assertNotEq(harness.consumerCommitment(chainId, consumer), harness.consumerCommitment(chainId ^ 1, consumer));
    }
}
