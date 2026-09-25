// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IReceiptSubjectAuthority} from "../interfaces/IReceiptSubjectAuthority.sol";
import {IPrivacyCommitmentRegistry} from "../interfaces/IPrivacyCommitmentRegistry.sol";
import {IVerifiableReceiptLedger} from "../interfaces/IVerifiableReceiptLedger.sol";
import {EvidenceReceiptLib} from "../libraries/EvidenceReceiptLib.sol";
import {
    EvidenceJournalBatch,
    EvidenceReceipt,
    ReceiptAuthorityBinding,
    ReceiptDraft,
    ReceiptId,
    ReceiptSubjectTerminalState
} from "../types/EvidenceTypes.sol";
import {
    DisclosureGrant,
    DisclosureGrantId,
    DisclosureGrantStatus,
    PrivacyEnvelopeCommitment,
    PrivacyEnvelopeId,
    PrivacyPolicyId,
    PrivacyPolicyVersion
} from "../types/PrivacyTypes.sol";

contract VerifiableReceiptLedger is IVerifiableReceiptLedger {
    bytes32 public constant SUBJECT_ORDER = keccak256("SetrynReceiptSubjectV1:Order");
    bytes32 public constant SUBJECT_RFQ = keccak256("SetrynReceiptSubjectV1:RFQ");
    bytes32 public constant SUBJECT_BOOK = keccak256("SetrynReceiptSubjectV1:Book");
    bytes32 public constant SUBJECT_AUCTION = keccak256("SetrynReceiptSubjectV1:Auction");
    bytes32 public constant SUBJECT_SOLVER = keccak256("SetrynReceiptSubjectV1:Solver");
    bytes32 public constant SUBJECT_FILL = keccak256("SetrynReceiptSubjectV1:Fill");
    bytes32 public constant SUBJECT_FIXING = keccak256("SetrynReceiptSubjectV1:Fixing");
    bytes32 public constant SUBJECT_SETTLEMENT = keccak256("SetrynReceiptSubjectV1:Settlement");
    bytes32 public constant SUBJECT_DEFAULT = keccak256("SetrynReceiptSubjectV1:Default");
    bytes32 public constant SUBJECT_RECOVERY = keccak256("SetrynReceiptSubjectV1:Recovery");
    bytes32 public constant SUBJECT_LIFECYCLE = keccak256("SetrynReceiptSubjectV1:Lifecycle");
    bytes32 public constant SUBJECT_STREAM = keccak256("SetrynReceiptSubjectV1:Stream");
    bytes32 public constant SUBJECT_ROUTE = keccak256("SetrynReceiptSubjectV1:Route");
    bytes32 public constant SUBJECT_POSITION = keccak256("SetrynReceiptSubjectV1:Position");
    bytes32 public constant SUBJECT_FEE = keccak256("SetrynReceiptSubjectV1:Fee");
    bytes32 public constant SUBJECT_RISK = keccak256("SetrynReceiptSubjectV1:Risk");
    bytes32 public constant SUBJECT_PRIVACY = keccak256("SetrynReceiptSubjectV1:Privacy");
    bytes32 public constant SUBJECT_ASYNC = keccak256("SetrynReceiptSubjectV1:Async");

    uint256 internal constant MAX_AUTHORITIES = 32;
    uint256 internal constant MAX_TERMINAL_STATE_GAS = 100_000;
    uint256 internal constant MAX_MERKLE_PROOF = 32;

    IPrivacyCommitmentRegistry public immutable privacyRegistry;

    struct SubjectLedgerState {
        ReceiptId latestReceiptId;
        bytes32 journalRoot;
        uint64 receiptCount;
        uint64 journalLeafCount;
        uint64 journalBatchCount;
        bool finalized;
    }

    mapping(bytes32 subjectKindId => ReceiptAuthorityBinding binding) private _authorities;
    mapping(bytes32 subjectKey => SubjectLedgerState state) private _subjects;
    mapping(ReceiptId receiptId => EvidenceReceipt receipt) private _receipts;
    mapping(bytes32 subjectKey => mapping(uint64 batchIndex => EvidenceJournalBatch batch)) private _journalBatches;

    error InvalidAuthorityBindings();
    error AuthorityHasNoCode(address authority);
    error UnauthorizedReceiptAuthority(bytes32 subjectKindId, address expected, address actual);
    error UnknownSubjectKind(bytes32 subjectKindId);
    error InvalidSubject();
    error SubjectAlreadyFinalized(bytes32 subjectKindId, bytes32 subjectId);
    error InvalidJournalBatch(uint256 count);
    error InvalidReceiptDraft();
    error ReceiptDeploymentMismatch(bytes32 expected, bytes32 actual);
    error ReceiptPredecessorMismatch(ReceiptId expected, ReceiptId actual);
    error ReceiptJournalMismatch(bytes32 expected, bytes32 actual);
    error DuplicateReceipt(ReceiptId receiptId);
    error UnknownReceipt(ReceiptId receiptId);
    error UnknownJournalBatch(uint64 batchIndex);
    error SubjectNotTerminal();
    error InvalidSubjectTransition();
    error SubjectStateCallFailed();
    error SubjectStateMismatch();
    error MerkleProofTooLong(uint256 length);
    error ZeroPrivacyRegistry();
    error InvalidAuthoritativeState();
    error InvalidPrivacyEvidence();
    error PublicFieldsCommitmentMismatch(bytes32 expected, bytes32 actual);

    constructor(ReceiptAuthorityBinding[] memory bindings, IPrivacyCommitmentRegistry privacyRegistry_) {
        if (address(privacyRegistry_) == address(0) || address(privacyRegistry_).code.length == 0) {
            revert ZeroPrivacyRegistry();
        }
        privacyRegistry = privacyRegistry_;
        uint256 count = bindings.length;
        if (count == 0 || count > MAX_AUTHORITIES) revert InvalidAuthorityBindings();
        bytes32 previous;
        for (uint256 i; i < count; ++i) {
            ReceiptAuthorityBinding memory binding = bindings[i];
            if (
                binding.subjectKindId == bytes32(0) || binding.subjectKindId <= previous
                    || binding.authority == address(0) || binding.deploymentHash == bytes32(0)
            ) revert InvalidAuthorityBindings();
            if (binding.authority.code.length == 0) revert AuthorityHasNoCode(binding.authority);
            _authorities[binding.subjectKindId] = binding;
            previous = binding.subjectKindId;
        }
    }

    function appendJournalBatch(bytes32 subjectKindId, bytes32 subjectId, bytes32[] calldata leaves)
        external
        returns (bytes32 journalRoot)
    {
        if (subjectId == bytes32(0)) revert InvalidSubject();
        ReceiptAuthorityBinding storage binding = _requireBinding(subjectKindId);
        ReceiptSubjectTerminalState memory authoritative = _readAuthoritativeState(binding, subjectKindId, subjectId);
        if (!authoritative.transitionValid || authoritative.stateHash == bytes32(0)) {
            revert InvalidAuthoritativeState();
        }
        SubjectLedgerState storage subject = _subjects[_subjectKey(subjectKindId, subjectId)];
        if (subject.finalized) revert SubjectAlreadyFinalized(subjectKindId, subjectId);
        uint256 count = leaves.length;
        if (count == 0 || count > EvidenceReceiptLib.MAX_JOURNAL_BATCH) revert InvalidJournalBatch(count);
        bytes32[] memory leafWitness = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            if (leaves[i] == bytes32(0)) revert InvalidJournalBatch(count);
            leafWitness[i] = leaves[i];
        }
        bytes32 batchRoot =
            EvidenceReceiptLib.hashJournalBatch(subjectKindId, subjectId, subject.journalLeafCount, leafWitness);
        EvidenceJournalBatch memory batch = EvidenceJournalBatch({
            subjectKindId: subjectKindId,
            subjectId: subjectId,
            previousRoot: subject.journalRoot,
            batchRoot: batchRoot,
            journalRoot: bytes32(0),
            batchIndex: subject.journalBatchCount,
            firstLeafIndex: subject.journalLeafCount,
            leafCount: uint32(count)
        });
        journalRoot = EvidenceReceiptLib.rollJournalRoot(batch);
        batch.journalRoot = journalRoot;
        _journalBatches[_subjectKey(subjectKindId, subjectId)][batch.batchIndex] = batch;
        subject.journalRoot = journalRoot;
        subject.journalLeafCount += uint64(count);
        subject.journalBatchCount += 1;
        emit EvidenceJournalBatchAppended(
            subjectKindId,
            subjectId,
            batch.batchIndex,
            batch.previousRoot,
            batch.batchRoot,
            journalRoot,
            batch.firstLeafIndex,
            batch.leafCount,
            msg.sender
        );
    }

    function appendReceipt(ReceiptDraft calldata draft) external returns (ReceiptId receiptId) {
        ReceiptAuthorityBinding storage binding = _requireBinding(draft.subjectKindId);
        _validateDraft(draft, binding);
        ReceiptSubjectTerminalState memory authoritative =
            _readAuthoritativeState(binding, draft.subjectKindId, draft.subjectId);
        if (
            !authoritative.transitionValid || authoritative.stateHash == bytes32(0)
                || authoritative.outcomeHash == bytes32(0) || authoritative.stateHash != draft.subjectStateHash
                || authoritative.outcomeHash != draft.onchainOutcomeHash
        ) revert InvalidAuthoritativeState();
        bytes32 subjectKey = _subjectKey(draft.subjectKindId, draft.subjectId);
        SubjectLedgerState storage subject = _subjects[subjectKey];
        if (subject.finalized) revert SubjectAlreadyFinalized(draft.subjectKindId, draft.subjectId);
        if (ReceiptId.unwrap(draft.predecessorReceiptId) != ReceiptId.unwrap(subject.latestReceiptId)) {
            revert ReceiptPredecessorMismatch(subject.latestReceiptId, draft.predecessorReceiptId);
        }
        if (draft.recoveryJournalRoot != subject.journalRoot) {
            revert ReceiptJournalMismatch(subject.journalRoot, draft.recoveryJournalRoot);
        }
        uint64 sequence = subject.receiptCount + 1;
        ReceiptDraft memory draftWitness = draft;
        bytes32 draftHash = EvidenceReceiptLib.hashDraft(draftWitness, block.chainid);
        receiptId = EvidenceReceiptLib.deriveReceiptId(
            block.chainid, address(this), draft.subjectKindId, draft.subjectId, sequence, draftHash
        );
        if (ReceiptId.unwrap(_receipts[receiptId].receiptId) != bytes32(0)) revert DuplicateReceipt(receiptId);
        _receipts[receiptId] = EvidenceReceipt({
            receiptId: receiptId,
            draft: draft,
            sequence: sequence,
            recordedAt: uint64(block.timestamp),
            recordedBlock: uint64(block.number),
            authority: binding.authority
        });
        subject.latestReceiptId = receiptId;
        subject.receiptCount = sequence;
        emit EvidenceReceiptAppended(
            receiptId,
            draft.subjectKindId,
            draft.subjectId,
            sequence,
            ReceiptId.unwrap(draft.predecessorReceiptId),
            draft.subjectStateHash,
            draft.onchainOutcomeHash,
            draft.recoveryJournalRoot,
            draft.evidenceGradeBitmap,
            draft.environmentId,
            block.chainid,
            draft.deploymentHash,
            draft.privateSubject,
            PrivacyPolicyId.unwrap(draft.privacyPolicyId),
            draft.privacyPolicyVersion,
            PrivacyEnvelopeId.unwrap(draft.privacyEnvelopeId),
            DisclosureGrantId.unwrap(draft.disclosureGrantId),
            draft.disclosurePolicyHash,
            draft.disclosureScopeHash,
            draft.publicFieldsHash,
            msg.sender
        );
    }

    function finalizeSubject(bytes32 subjectKindId, bytes32 subjectId) external {
        ReceiptAuthorityBinding storage binding = _requireBinding(subjectKindId);
        bytes32 subjectKey = _subjectKey(subjectKindId, subjectId);
        SubjectLedgerState storage subject = _subjects[subjectKey];
        if (subject.finalized) return;
        ReceiptId finalReceiptId = subject.latestReceiptId;
        if (ReceiptId.unwrap(finalReceiptId) == bytes32(0)) revert UnknownReceipt(finalReceiptId);
        ReceiptSubjectTerminalState memory terminalState = _readAuthoritativeState(binding, subjectKindId, subjectId);
        if (!terminalState.terminal) revert SubjectNotTerminal();
        if (!terminalState.transitionValid) revert InvalidSubjectTransition();
        EvidenceReceipt storage receipt = _receipts[finalReceiptId];
        if (
            terminalState.stateHash == bytes32(0) || terminalState.outcomeHash == bytes32(0)
                || receipt.draft.subjectStateHash != terminalState.stateHash
                || receipt.draft.onchainOutcomeHash != terminalState.outcomeHash
        ) revert SubjectStateMismatch();
        subject.finalized = true;
        emit ReceiptSubjectFinalized(
            subjectKindId, subjectId, finalReceiptId, terminalState.stateHash, terminalState.outcomeHash, msg.sender
        );
    }

    function getReceipt(ReceiptId receiptId) external view returns (EvidenceReceipt memory receipt) {
        receipt = _receipts[receiptId];
        if (ReceiptId.unwrap(receipt.receiptId) == bytes32(0)) revert UnknownReceipt(receiptId);
    }

    function getJournalBatch(bytes32 subjectKindId, bytes32 subjectId, uint64 batchIndex)
        external
        view
        returns (EvidenceJournalBatch memory batch)
    {
        batch = _journalBatches[_subjectKey(subjectKindId, subjectId)][batchIndex];
        if (batch.leafCount == 0) revert UnknownJournalBatch(batchIndex);
    }

    function latestReceipt(bytes32 subjectKindId, bytes32 subjectId)
        external
        view
        returns (ReceiptId receiptId, uint64 sequence)
    {
        SubjectLedgerState storage subject = _subjects[_subjectKey(subjectKindId, subjectId)];
        return (subject.latestReceiptId, subject.receiptCount);
    }

    function journalState(bytes32 subjectKindId, bytes32 subjectId)
        external
        view
        returns (bytes32 root, uint64 leafCount, uint64 batchCount)
    {
        SubjectLedgerState storage subject = _subjects[_subjectKey(subjectKindId, subjectId)];
        return (subject.journalRoot, subject.journalLeafCount, subject.journalBatchCount);
    }

    function authorityOf(bytes32 subjectKindId) external view returns (ReceiptAuthorityBinding memory binding) {
        return _requireBinding(subjectKindId);
    }

    function verifyJournalProof(
        bytes32 subjectKindId,
        bytes32 subjectId,
        uint64 batchIndex,
        uint64 leafIndex,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        if (proof.length > MAX_MERKLE_PROOF) revert MerkleProofTooLong(proof.length);
        EvidenceJournalBatch storage batch = _journalBatches[_subjectKey(subjectKindId, subjectId)][batchIndex];
        if (batch.leafCount == 0) revert UnknownJournalBatch(batchIndex);
        if (leafIndex < batch.firstLeafIndex || leafIndex >= batch.firstLeafIndex + batch.leafCount) return false;
        bytes32 leafHash =
            keccak256(abi.encode(EvidenceReceiptLib.JOURNAL_LEAF_TYPEHASH, subjectKindId, subjectId, leafIndex, leaf));
        bytes32[] memory proofWitness = proof;
        return
            EvidenceReceiptLib.verifyMerkleProof(
                leafHash, leafIndex - batch.firstLeafIndex, proofWitness, batch.batchRoot
            );
    }

    function _validateDraft(ReceiptDraft calldata draft, ReceiptAuthorityBinding storage binding) private view {
        if (
            draft.subjectId == bytes32(0) || draft.subjectStateHash == bytes32(0)
                || draft.authorizationHash == bytes32(0) || draft.dependencyVersionsHash == bytes32(0)
                || draft.routeProvenanceHash == bytes32(0) || draft.sourceLiquidityEvidenceHash == bytes32(0)
                || draft.reservationEvidenceHash == bytes32(0) || draft.submittedActionsHash == bytes32(0)
                || draft.onchainOutcomeHash == bytes32(0) || draft.feesResidualsHash == bytes32(0)
                || draft.environmentId == bytes32(0) || draft.publicFieldsHash == bytes32(0)
                || draft.evidenceGradeBitmap == 0
        ) revert InvalidReceiptDraft();
        if (draft.deploymentHash != binding.deploymentHash) {
            revert ReceiptDeploymentMismatch(binding.deploymentHash, draft.deploymentHash);
        }
        if (draft.privateSubject) {
            _validatePrivateEvidence(draft);
        } else if (
            PrivacyPolicyId.unwrap(draft.privacyPolicyId) != bytes32(0) || draft.privacyPolicyVersion != 0
                || PrivacyEnvelopeId.unwrap(draft.privacyEnvelopeId) != bytes32(0)
                || DisclosureGrantId.unwrap(draft.disclosureGrantId) != bytes32(0)
                || draft.disclosurePolicyHash != bytes32(0) || draft.disclosureScopeHash != bytes32(0)
        ) {
            revert InvalidReceiptDraft();
        }
        ReceiptDraft memory witness = draft;
        bytes32 expectedPublicFieldsHash = EvidenceReceiptLib.hashPublicFields(witness, block.chainid);
        if (draft.publicFieldsHash != expectedPublicFieldsHash) {
            revert PublicFieldsCommitmentMismatch(expectedPublicFieldsHash, draft.publicFieldsHash);
        }
    }

    function _validatePrivateEvidence(ReceiptDraft calldata draft) private view {
        if (
            PrivacyPolicyId.unwrap(draft.privacyPolicyId) == bytes32(0) || draft.privacyPolicyVersion == 0
                || PrivacyEnvelopeId.unwrap(draft.privacyEnvelopeId) == bytes32(0)
                || DisclosureGrantId.unwrap(draft.disclosureGrantId) == bytes32(0)
                || draft.disclosurePolicyHash == bytes32(0) || draft.disclosureScopeHash == bytes32(0)
        ) revert InvalidPrivacyEvidence();
        PrivacyEnvelopeCommitment memory envelope = privacyRegistry.getEnvelope(draft.privacyEnvelopeId);
        if (
            envelope.subjectKindId != draft.subjectKindId || envelope.subjectId != draft.subjectId
                || envelope.policyId != draft.privacyPolicyId || envelope.policyVersion != draft.privacyPolicyVersion
        ) revert InvalidPrivacyEvidence();
        PrivacyPolicyVersion memory policy =
            privacyRegistry.getPolicy(draft.privacyPolicyId, draft.privacyPolicyVersion);
        if (policy.definitionHash == bytes32(0) || draft.disclosurePolicyHash != policy.definitionHash) {
            revert InvalidPrivacyEvidence();
        }
        DisclosureGrant memory grant = privacyRegistry.getDisclosureGrant(draft.disclosureGrantId);
        if (
            grant.envelopeId != draft.privacyEnvelopeId || grant.disclosureScopeHash != draft.disclosureScopeHash
                || grant.status != DisclosureGrantStatus.Consumed || grant.accessReceiptCommitment == bytes32(0)
        ) revert InvalidPrivacyEvidence();
    }

    function _readAuthoritativeState(ReceiptAuthorityBinding storage binding, bytes32 subjectKindId, bytes32 subjectId)
        private
        view
        returns (ReceiptSubjectTerminalState memory terminalState)
    {
        (bool success, bytes memory returnData) = binding.authority.staticcall{gas: MAX_TERMINAL_STATE_GAS}(
            abi.encodeCall(IReceiptSubjectAuthority.receiptSubjectTerminalState, (subjectKindId, subjectId))
        );
        if (!success || returnData.length != 128) revert SubjectStateCallFailed();
        terminalState = abi.decode(returnData, (ReceiptSubjectTerminalState));
        if (terminalState.stateHash == bytes32(0)) {
            revert InvalidAuthoritativeState();
        }
    }

    function _requireBinding(bytes32 subjectKindId) private view returns (ReceiptAuthorityBinding storage binding) {
        binding = _authorities[subjectKindId];
        if (binding.authority == address(0)) revert UnknownSubjectKind(subjectKindId);
    }

    function _subjectKey(bytes32 subjectKindId, bytes32 subjectId) private pure returns (bytes32) {
        return keccak256(abi.encode(subjectKindId, subjectId));
    }
}
