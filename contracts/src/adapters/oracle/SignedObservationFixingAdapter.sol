// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IFixingObservationAdapterV1} from "../../interfaces/IFixingObservationAdapterV1.sol";
import {Eip712Lib} from "../../libraries/Eip712Lib.sol";
import {BenchmarkId, EvidenceOriginId, SeriesId} from "../../types/Identifiers.sol";
import {ObservationBatchValidation, ObservationValidationContext} from "../../types/FixingTypes.sol";
import {FixingSelectionRuleId} from "../../types/SeriesQualification.sol";

/// @notice Fixing observation adapter for signed external feeds: a batch is valid when at least `threshold` distinct
/// publishers of an immutable signer set signed its EIP-712 digest.
/// @dev The digest is a `SetrynSignedObservationBatchV1` under the Setryn EIP-712 domain bound to this chain and this
/// adapter, and it commits every identifying field of the engine's validation context: the fixing engine, the exact
/// series version, slot and candidate, the benchmark version and its version hash (which commits the benchmark's feed,
/// observation rule and data rights), the feed key, the required capability, the selection rule and its parameters,
/// the observations hash the engine computed from the submitted observations, and the publisher's batch sequence. A
/// signature therefore attests exactly one observation list for exactly one fixing, and cannot be replayed onto another
/// feed, series, version, candidate, chain or adapter.
///
/// @dev Evidence is `abi.encode(uint64 batchSequence, bytes[] signatures)`: a nonzero batch sequence (a newer sequence
/// replaces an earlier proposal for the same candidate) and 65-byte `r || s || v` signatures ordered by strictly
/// increasing recovered signer. Malformed or high-s signatures, unknown signers, repeated signers and out-of-order
/// signers are rejected rather than skipped, so one evidence payload has one meaning. The evidence and completeness
/// hashes are derived from the digest and the signer configuration only, never from the signature bytes or the subset
/// that signed, so two valid attestations of the same batch produce the same proposal instead of a dispute.
///
/// @dev The signer set, threshold and capability are fixed at construction and committed in the runtime code through
/// `configurationHash`, so the AdapterRegistry's expected runtime code hash binds them. There is no owner and no setter:
/// rotating a key is a new adapter version (and new benchmark versions pinning it) in the versioned registries.
///
/// @dev Submission timing (primary deadline, corrections, final resolution) is enforced by the FixingEngine, not here,
/// so a signed correction stays admissible for as long as the engine accepts corrections.
contract SignedObservationFixingAdapter is IFixingObservationAdapterV1 {
    uint256 public constant MAX_SIGNERS = 16;
    uint256 internal constant SIGNATURE_BYTES = 65;

    EvidenceOriginId public constant EVIDENCE_ORIGIN =
        EvidenceOriginId.wrap(keccak256("SetrynEvidenceOriginV1:EXTERNAL_SIGNED"));

    string internal constant BATCH_TYPESTRING =
        "SetrynSignedObservationBatchV1(address fixingEngine,bytes32 seriesId,uint32 seriesVersion,uint8 slot,uint8 candidateIndex,bytes32 benchmarkId,uint32 benchmarkVersion,bytes32 benchmarkVersionHash,bytes32 feedKey,bytes32 capabilityHash,bytes32 selectionRuleId,bytes32 selectionParametersHash,bytes32 observationsHash,uint64 batchSequence)";
    bytes32 public constant BATCH_TYPEHASH = keccak256(
        "SetrynSignedObservationBatchV1(address fixingEngine,bytes32 seriesId,uint32 seriesVersion,uint8 slot,uint8 candidateIndex,bytes32 benchmarkId,uint32 benchmarkVersion,bytes32 benchmarkVersionHash,bytes32 feedKey,bytes32 capabilityHash,bytes32 selectionRuleId,bytes32 selectionParametersHash,bytes32 observationsHash,uint64 batchSequence)"
    );
    bytes32 public constant CONFIGURATION_TYPEHASH = keccak256(
        "SetrynSignedObservationAdapterConfigurationV1(address[] signers,uint8 threshold,bytes32 capabilityHash)"
    );
    bytes32 internal constant EVIDENCE_TYPEHASH =
        keccak256("SetrynSignedObservationEvidenceV1(address adapter,bytes32 configurationHash,bytes32 batchDigest)");
    bytes32 internal constant COMPLETENESS_TYPEHASH = keccak256(
        "SetrynSignedObservationCompletenessV1(bytes32 batchDigest,bytes32 observationsHash,bytes32 selectionParametersHash,uint64 batchSequence)"
    );

    /// Capability the benchmarks this adapter serves must require.
    bytes32 public immutable capabilityHash;
    /// Minimum number of distinct authorized signatures a batch needs.
    uint8 public immutable threshold;
    /// Number of authorized signers.
    uint8 public immutable signerCount;
    /// Commits the ordered signer set, the threshold and the capability into the runtime code.
    bytes32 public immutable configurationHash;

    address[] private _signers;
    mapping(address signer => bool authorized) private _authorized;

    error InvalidSignerCount(uint256 count, uint256 maximum);
    error InvalidThreshold(uint256 threshold, uint256 signerCount);
    error ZeroCapabilityHash();
    error InvalidSigner(uint256 index, address signer);
    error SignersNotStrictlyIncreasing(uint256 index, address previous, address current);
    error BindingChainMismatch(uint256 bindingChainId, uint256 actualChainId);
    error CapabilityMismatch(bytes32 expected, bytes32 actual);
    error ZeroObservationsHash();
    error ZeroBatchSequence();
    error InsufficientSignatures(uint256 count, uint256 threshold);
    error TooManySignatures(uint256 count, uint256 maximum);
    error MalformedSignature(uint256 index);
    error UnknownSigner(uint256 index, address signer);
    error DuplicateSigner(uint256 index, address signer);
    error SignaturesNotOrdered(uint256 index, address previous, address current);

    /// @param signers_ The authorized publishers, strictly increasing by address, between one and MAX_SIGNERS.
    /// @param threshold_ Distinct signatures required, between one and the number of signers.
    /// @param capabilityHash_ The capability hash the served benchmarks require and this adapter reports.
    constructor(address[] memory signers_, uint8 threshold_, bytes32 capabilityHash_) {
        uint256 count = signers_.length;
        if (count == 0 || count > MAX_SIGNERS) revert InvalidSignerCount(count, MAX_SIGNERS);
        if (threshold_ == 0 || threshold_ > count) revert InvalidThreshold(threshold_, count);
        if (capabilityHash_ == bytes32(0)) revert ZeroCapabilityHash();
        address previous;
        for (uint256 i; i < count; ++i) {
            address signer = signers_[i];
            if (signer == address(0)) revert InvalidSigner(i, signer);
            if (signer <= previous) revert SignersNotStrictlyIncreasing(i, previous, signer);
            _signers.push(signer);
            _authorized[signer] = true;
            previous = signer;
        }
        capabilityHash = capabilityHash_;
        threshold = threshold_;
        signerCount = uint8(count);
        configurationHash = keccak256(
            abi.encode(CONFIGURATION_TYPEHASH, keccak256(abi.encodePacked(signers_)), threshold_, capabilityHash_)
        );
    }

    function validateObservationBatch(ObservationValidationContext calldata context, bytes calldata evidence)
        external
        view
        returns (ObservationBatchValidation memory validation)
    {
        if (context.chainId != block.chainid) revert BindingChainMismatch(context.chainId, block.chainid);
        if (context.requiredCapabilityHash != capabilityHash) {
            revert CapabilityMismatch(capabilityHash, context.requiredCapabilityHash);
        }
        if (context.observationsHash == bytes32(0)) revert ZeroObservationsHash();

        (uint64 batchSequence, bytes[] memory signatures) = abi.decode(evidence, (uint64, bytes[]));
        if (batchSequence == 0) revert ZeroBatchSequence();
        uint256 count = signatures.length;
        if (count < threshold) revert InsufficientSignatures(count, threshold);
        if (count > signerCount) revert TooManySignatures(count, signerCount);

        bytes32 digest = batchDigest(context, batchSequence);
        address previous;
        for (uint256 i; i < count; ++i) {
            bytes memory signature = signatures[i];
            if (signature.length != SIGNATURE_BYTES) revert MalformedSignature(i);
            (address signer, ECDSA.RecoverError recoverError,) = ECDSA.tryRecover(digest, signature);
            if (recoverError != ECDSA.RecoverError.NoError || signer == address(0)) revert MalformedSignature(i);
            if (!_authorized[signer]) revert UnknownSigner(i, signer);
            if (signer == previous) revert DuplicateSigner(i, signer);
            if (signer < previous) revert SignaturesNotOrdered(i, previous, signer);
            previous = signer;
        }

        bytes32 evidenceHash = keccak256(abi.encode(EVIDENCE_TYPEHASH, address(this), configurationHash, digest));
        validation = ObservationBatchValidation({
            observationsHash: context.observationsHash,
            evidenceOriginId: EVIDENCE_ORIGIN,
            feedKey: context.feedKey,
            capabilityHash: capabilityHash,
            completenessHash: keccak256(
                abi.encode(
                    COMPLETENESS_TYPEHASH,
                    digest,
                    context.observationsHash,
                    context.selectionParametersHash,
                    batchSequence
                )
            ),
            evidenceHash: evidenceHash,
            batchSequence: batchSequence,
            complete: true,
            // Publishers attest data observed off this chain, so the attestation does not depend on its sequencer.
            outageIndependent: true
        });
    }

    /// @notice The EIP-712 digest publishers sign for one batch under the engine's validation context.
    function batchDigest(ObservationValidationContext calldata context, uint64 batchSequence)
        public
        view
        returns (bytes32)
    {
        return Eip712Lib.toTypedDataDigest(domainSeparator(), hashBatch(context, batchSequence));
    }

    /// @notice The EIP-712 struct hash of one batch; the domain is the Setryn domain bound to this chain and adapter.
    function hashBatch(ObservationValidationContext calldata context, uint64 batchSequence)
        public
        pure
        returns (bytes32)
    {
        bytes memory identity = abi.encode(
            BATCH_TYPEHASH,
            context.fixingEngine,
            SeriesId.unwrap(context.seriesId),
            context.seriesVersion,
            context.slot,
            context.candidateIndex,
            BenchmarkId.unwrap(context.benchmarkId),
            context.benchmarkVersion,
            context.benchmarkVersionHash
        );
        bytes memory batch = abi.encode(
            context.feedKey,
            context.requiredCapabilityHash,
            FixingSelectionRuleId.unwrap(context.selectionRuleId),
            context.selectionParametersHash,
            context.observationsHash,
            batchSequence
        );
        return keccak256(bytes.concat(identity, batch));
    }

    function domainSeparator() public view returns (bytes32) {
        return Eip712Lib.domainSeparator(block.chainid, address(this));
    }

    function signers() external view returns (address[] memory) {
        return _signers;
    }

    function isSigner(address account) external view returns (bool) {
        return _authorized[account];
    }
}
