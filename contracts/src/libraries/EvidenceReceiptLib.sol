// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {EvidenceJournalBatch, ReceiptDraft, ReceiptId} from "../types/EvidenceTypes.sol";
import {DisclosureGrantId, PrivacyEnvelopeId, PrivacyPolicyId} from "../types/PrivacyTypes.sol";

library EvidenceReceiptLib {
    uint256 internal constant MAX_JOURNAL_BATCH = 32;
    bytes32 internal constant JOURNAL_LEAF_TYPEHASH =
        keccak256("SetrynEvidenceJournalLeafV1(bytes32 subjectKindId,bytes32 subjectId,uint64 leafIndex,bytes32 leaf)");
    bytes32 internal constant JOURNAL_NODE_TYPEHASH =
        keccak256("SetrynEvidenceJournalNodeV1(bytes32 left,bytes32 right)");
    bytes32 internal constant JOURNAL_ROOT_TYPEHASH = keccak256(
        "SetrynEvidenceJournalRootV1(bytes32 subjectKindId,bytes32 subjectId,bytes32 previousRoot,bytes32 batchRoot,uint64 batchIndex,uint64 firstLeafIndex,uint32 leafCount)"
    );
    bytes32 internal constant RECEIPT_DRAFT_TYPEHASH = keccak256(
        "SetrynEvidenceReceiptDraftV2(bytes32 subjectKindId,bytes32 subjectId,bytes32 subjectStateHash,bytes32 authorizationHash,bytes32 dependencyVersionsHash,bytes32 routeProvenanceHash,bytes32 sourceLiquidityEvidenceHash,bytes32 reservationEvidenceHash,bytes32 submittedActionsHash,bytes32 onchainOutcomeHash,bytes32 feesResidualsHash,bytes32 recoveryJournalRoot,uint256 evidenceGradeBitmap,bytes32 environmentId,uint256 chainId,bytes32 deploymentHash,bool privateSubject,bytes32 privacyPolicyId,uint32 privacyPolicyVersion,bytes32 privacyEnvelopeId,bytes32 disclosureGrantId,bytes32 disclosurePolicyHash,bytes32 disclosureScopeHash,bytes32 publicFieldsHash,bytes32 predecessorReceiptId)"
    );
    bytes32 internal constant RECEIPT_PUBLIC_FIELDS_TYPEHASH = keccak256(
        "SetrynEvidenceReceiptPublicFieldsV1(bytes32 subjectKindId,bytes32 subjectId,bytes32 subjectStateHash,bytes32 authorizationHash,bytes32 dependencyVersionsHash,bytes32 routeProvenanceHash,bytes32 sourceLiquidityEvidenceHash,bytes32 reservationEvidenceHash,bytes32 submittedActionsHash,bytes32 onchainOutcomeHash,bytes32 feesResidualsHash,bytes32 recoveryJournalRoot,uint256 evidenceGradeBitmap,bytes32 environmentId,uint256 chainId,bytes32 deploymentHash,bool privateSubject,bytes32 privacyPolicyId,uint32 privacyPolicyVersion,bytes32 privacyEnvelopeId,bytes32 disclosureGrantId,bytes32 disclosurePolicyHash,bytes32 disclosureScopeHash,bytes32 predecessorReceiptId)"
    );
    bytes32 internal constant RECEIPT_ID_TYPEHASH = keccak256(
        "SetrynEvidenceReceiptIdV1(uint256 chainId,address ledger,bytes32 subjectKindId,bytes32 subjectId,uint64 sequence,bytes32 draftHash)"
    );

    function hashDraft(ReceiptDraft memory draft, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RECEIPT_DRAFT_TYPEHASH,
                draft.subjectKindId,
                draft.subjectId,
                draft.subjectStateHash,
                draft.authorizationHash,
                draft.dependencyVersionsHash,
                draft.routeProvenanceHash,
                draft.sourceLiquidityEvidenceHash,
                draft.reservationEvidenceHash,
                draft.submittedActionsHash,
                draft.onchainOutcomeHash,
                draft.feesResidualsHash,
                draft.recoveryJournalRoot,
                draft.evidenceGradeBitmap,
                draft.environmentId,
                chainId,
                draft.deploymentHash,
                draft.privateSubject,
                PrivacyPolicyId.unwrap(draft.privacyPolicyId),
                draft.privacyPolicyVersion,
                PrivacyEnvelopeId.unwrap(draft.privacyEnvelopeId),
                DisclosureGrantId.unwrap(draft.disclosureGrantId),
                draft.disclosurePolicyHash,
                draft.disclosureScopeHash,
                draft.publicFieldsHash,
                ReceiptId.unwrap(draft.predecessorReceiptId)
            )
        );
    }

    function hashPublicFields(ReceiptDraft memory draft, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RECEIPT_PUBLIC_FIELDS_TYPEHASH,
                draft.subjectKindId,
                draft.subjectId,
                draft.subjectStateHash,
                draft.authorizationHash,
                draft.dependencyVersionsHash,
                draft.routeProvenanceHash,
                draft.sourceLiquidityEvidenceHash,
                draft.reservationEvidenceHash,
                draft.submittedActionsHash,
                draft.onchainOutcomeHash,
                draft.feesResidualsHash,
                draft.recoveryJournalRoot,
                draft.evidenceGradeBitmap,
                draft.environmentId,
                chainId,
                draft.deploymentHash,
                draft.privateSubject,
                PrivacyPolicyId.unwrap(draft.privacyPolicyId),
                draft.privacyPolicyVersion,
                PrivacyEnvelopeId.unwrap(draft.privacyEnvelopeId),
                DisclosureGrantId.unwrap(draft.disclosureGrantId),
                draft.disclosurePolicyHash,
                draft.disclosureScopeHash,
                ReceiptId.unwrap(draft.predecessorReceiptId)
            )
        );
    }

    function deriveReceiptId(
        uint256 chainId,
        address ledger,
        bytes32 subjectKindId,
        bytes32 subjectId,
        uint64 sequence,
        bytes32 draftHash
    ) internal pure returns (ReceiptId) {
        return ReceiptId.wrap(
            keccak256(abi.encode(RECEIPT_ID_TYPEHASH, chainId, ledger, subjectKindId, subjectId, sequence, draftHash))
        );
    }

    function hashJournalBatch(bytes32 subjectKindId, bytes32 subjectId, uint64 firstLeafIndex, bytes32[] memory leaves)
        internal
        pure
        returns (bytes32)
    {
        uint256 count = leaves.length;
        bytes32[] memory level = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            level[i] = keccak256(
                abi.encode(JOURNAL_LEAF_TYPEHASH, subjectKindId, subjectId, firstLeafIndex + uint64(i), leaves[i])
            );
        }
        while (count > 1) {
            uint256 nextCount = (count + 1) / 2;
            for (uint256 i; i < nextCount; ++i) {
                bytes32 left = level[i * 2];
                bytes32 right = i * 2 + 1 < count ? level[i * 2 + 1] : left;
                level[i] = keccak256(abi.encode(JOURNAL_NODE_TYPEHASH, left, right));
            }
            count = nextCount;
        }
        return level[0];
    }

    function rollJournalRoot(EvidenceJournalBatch memory batch) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                JOURNAL_ROOT_TYPEHASH,
                batch.subjectKindId,
                batch.subjectId,
                batch.previousRoot,
                batch.batchRoot,
                batch.batchIndex,
                batch.firstLeafIndex,
                batch.leafCount
            )
        );
    }

    function verifyMerkleProof(bytes32 leafHash, uint256 index, bytes32[] memory proof, bytes32 root)
        internal
        pure
        returns (bool)
    {
        bytes32 computed = leafHash;
        for (uint256 i; i < proof.length; ++i) {
            if ((index & 1) == 0) computed = keccak256(abi.encode(JOURNAL_NODE_TYPEHASH, computed, proof[i]));
            else computed = keccak256(abi.encode(JOURNAL_NODE_TYPEHASH, proof[i], computed));
            index >>= 1;
        }
        return computed == root;
    }
}
