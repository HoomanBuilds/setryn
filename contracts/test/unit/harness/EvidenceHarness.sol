// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {EvidenceReceiptLib} from "../../../src/libraries/EvidenceReceiptLib.sol";
import {PrivacyCommitmentLib} from "../../../src/libraries/PrivacyCommitmentLib.sol";
import {EvidenceJournalBatch} from "../../../src/types/EvidenceTypes.sol";

contract EvidenceHarness {
    function hashJournalBatch(bytes32 subjectKindId, bytes32 subjectId, uint64 firstLeafIndex, bytes32[] memory leaves)
        external
        pure
        returns (bytes32)
    {
        return EvidenceReceiptLib.hashJournalBatch(subjectKindId, subjectId, firstLeafIndex, leaves);
    }

    function rollJournalRoot(EvidenceJournalBatch memory batch) external pure returns (bytes32) {
        return EvidenceReceiptLib.rollJournalRoot(batch);
    }

    function verifyMerkleProof(bytes32 leafHash, uint256 index, bytes32[] memory proof, bytes32 root)
        external
        pure
        returns (bool)
    {
        return EvidenceReceiptLib.verifyMerkleProof(leafHash, index, proof, root);
    }

    function journalLeafHash(bytes32 subjectKindId, bytes32 subjectId, uint64 leafIndex, bytes32 leaf)
        external
        pure
        returns (bytes32)
    {
        return
            keccak256(abi.encode(EvidenceReceiptLib.JOURNAL_LEAF_TYPEHASH, subjectKindId, subjectId, leafIndex, leaf));
    }

    function consumerCommitment(uint256 chainId, address consumer) external pure returns (bytes32) {
        return PrivacyCommitmentLib.consumerCommitment(chainId, consumer);
    }
}
