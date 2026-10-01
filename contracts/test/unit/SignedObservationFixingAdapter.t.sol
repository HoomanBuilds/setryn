// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {SignedObservationFixingAdapter} from "../../src/adapters/oracle/SignedObservationFixingAdapter.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {BenchmarkId, EvidenceOriginId, SeriesId} from "../../src/types/Identifiers.sol";
import {ObservationBatchValidation, ObservationValidationContext} from "../../src/types/FixingTypes.sol";

contract SignedObservationFixingAdapterTest is Test {
    bytes32 internal constant CAPABILITY = keccak256("SETRYN_SIGNED_OBSERVATION_FIXING_CAPABILITY_V1");
    uint64 internal constant SEQUENCE = 7;

    SignedObservationFixingAdapter internal adapter;
    /// Publisher keys ordered by their addresses, so signatures built from them in this order are canonical.
    uint256[3] internal keys;
    address[3] internal publishers;

    function setUp() public {
        uint256[3] memory raw = [uint256(0xA11CE), uint256(0xB0B), uint256(0xC0FFEE)];
        // Insertion sort by address.
        for (uint256 i = 1; i < 3; ++i) {
            uint256 key = raw[i];
            uint256 j = i;
            while (j > 0 && vm.addr(raw[j - 1]) > vm.addr(key)) {
                raw[j] = raw[j - 1];
                --j;
            }
            raw[j] = key;
        }
        address[] memory signers = new address[](3);
        for (uint256 i; i < 3; ++i) {
            keys[i] = raw[i];
            publishers[i] = vm.addr(raw[i]);
            signers[i] = publishers[i];
        }
        adapter = new SignedObservationFixingAdapter(signers, 2, CAPABILITY);
    }

    function test_TypehashMatchesTypestring() public view {
        assertEq(
            adapter.BATCH_TYPEHASH(),
            keccak256(
                "SetrynSignedObservationBatchV1(address fixingEngine,bytes32 seriesId,uint32 seriesVersion,uint8 slot,uint8 candidateIndex,bytes32 benchmarkId,uint32 benchmarkVersion,bytes32 benchmarkVersionHash,bytes32 feedKey,bytes32 capabilityHash,bytes32 selectionRuleId,bytes32 selectionParametersHash,bytes32 observationsHash,uint64 batchSequence)"
            )
        );
    }

    function test_ThresholdOfDistinctSignersValidates() public view {
        ObservationValidationContext memory context = _context();
        bytes[] memory two = new bytes[](2);
        two[0] = _sign(keys[0], context, SEQUENCE);
        two[1] = _sign(keys[2], context, SEQUENCE);
        ObservationBatchValidation memory validation =
            adapter.validateObservationBatch(context, abi.encode(SEQUENCE, two));

        assertEq(validation.observationsHash, context.observationsHash);
        assertEq(
            EvidenceOriginId.unwrap(validation.evidenceOriginId), keccak256("SetrynEvidenceOriginV1:EXTERNAL_SIGNED")
        );
        assertEq(validation.feedKey, context.feedKey);
        assertEq(validation.capabilityHash, CAPABILITY);
        assertEq(validation.batchSequence, SEQUENCE);
        assertTrue(validation.complete);
        assertTrue(validation.outageIndependent);
        assertTrue(validation.evidenceHash != bytes32(0) && validation.completenessHash != bytes32(0));

        // Every signer, or a different qualifying subset, attests the same batch: the same commitments, never a dispute.
        bytes[] memory all = new bytes[](3);
        for (uint256 i; i < 3; ++i) {
            all[i] = _sign(keys[i], context, SEQUENCE);
        }
        ObservationBatchValidation memory everyone =
            adapter.validateObservationBatch(context, abi.encode(SEQUENCE, all));
        assertEq(everyone.evidenceHash, validation.evidenceHash);
        assertEq(everyone.completenessHash, validation.completenessHash);
    }

    function test_RevertWhen_BelowThreshold() public {
        ObservationValidationContext memory context = _context();
        bytes[] memory one = new bytes[](1);
        one[0] = _sign(keys[1], context, SEQUENCE);
        vm.expectRevert(abi.encodeWithSelector(SignedObservationFixingAdapter.InsufficientSignatures.selector, 1, 2));
        adapter.validateObservationBatch(context, abi.encode(SEQUENCE, one));
    }

    function test_RevertWhen_DuplicateSigner() public {
        ObservationValidationContext memory context = _context();
        bytes[] memory twice = new bytes[](2);
        twice[0] = _sign(keys[1], context, SEQUENCE);
        twice[1] = twice[0];
        vm.expectRevert(
            abi.encodeWithSelector(SignedObservationFixingAdapter.DuplicateSigner.selector, 1, publishers[1])
        );
        adapter.validateObservationBatch(context, abi.encode(SEQUENCE, twice));
    }

    function test_RevertWhen_UnknownSigner() public {
        ObservationValidationContext memory context = _context();
        uint256 outsider = 0xBAD;
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _sign(keys[0], context, SEQUENCE);
        signatures[1] = _sign(outsider, context, SEQUENCE);
        vm.expectRevert(
            abi.encodeWithSelector(SignedObservationFixingAdapter.UnknownSigner.selector, 1, vm.addr(outsider))
        );
        adapter.validateObservationBatch(context, abi.encode(SEQUENCE, signatures));
    }

    function test_RevertWhen_SignedForAnotherFeed() public {
        ObservationValidationContext memory signed = _context();
        bytes[] memory signatures = _quorum(signed);
        ObservationValidationContext memory submitted = _context();
        submitted.feedKey = keccak256("Crypto.ETH/USD");
        vm.expectPartialRevert(SignedObservationFixingAdapter.UnknownSigner.selector);
        adapter.validateObservationBatch(submitted, abi.encode(SEQUENCE, signatures));
    }

    function test_RevertWhen_ObservationsDiffer() public {
        ObservationValidationContext memory signed = _context();
        bytes[] memory signatures = _quorum(signed);
        ObservationValidationContext memory submitted = _context();
        submitted.observationsHash = keccak256("other observations");
        vm.expectPartialRevert(SignedObservationFixingAdapter.UnknownSigner.selector);
        adapter.validateObservationBatch(submitted, abi.encode(SEQUENCE, signatures));
    }

    function test_RevertWhen_SignedForAnotherSeriesVersionOrSequence() public {
        ObservationValidationContext memory signed = _context();
        bytes[] memory signatures = _quorum(signed);
        ObservationValidationContext memory submitted = _context();
        submitted.seriesVersion = 2;
        vm.expectPartialRevert(SignedObservationFixingAdapter.UnknownSigner.selector);
        adapter.validateObservationBatch(submitted, abi.encode(SEQUENCE, signatures));

        vm.expectPartialRevert(SignedObservationFixingAdapter.UnknownSigner.selector);
        adapter.validateObservationBatch(signed, abi.encode(SEQUENCE + 1, signatures));
    }

    function test_RevertWhen_SignaturesOutOfOrderOrMalformed() public {
        ObservationValidationContext memory context = _context();
        bytes[] memory reversed = new bytes[](2);
        reversed[0] = _sign(keys[2], context, SEQUENCE);
        reversed[1] = _sign(keys[0], context, SEQUENCE);
        vm.expectRevert(
            abi.encodeWithSelector(
                SignedObservationFixingAdapter.SignaturesNotOrdered.selector, 1, publishers[2], publishers[0]
            )
        );
        adapter.validateObservationBatch(context, abi.encode(SEQUENCE, reversed));

        bytes[] memory malformed = _quorum(context);
        malformed[1] = bytes.concat(malformed[1], hex"00");
        vm.expectRevert(abi.encodeWithSelector(SignedObservationFixingAdapter.MalformedSignature.selector, 1));
        adapter.validateObservationBatch(context, abi.encode(SEQUENCE, malformed));
    }

    function test_RevertWhen_ContextIsForAnotherChainOrCapability() public {
        ObservationValidationContext memory context = _context();
        bytes[] memory signatures = _quorum(context);
        context.chainId = block.chainid + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                SignedObservationFixingAdapter.BindingChainMismatch.selector, block.chainid + 1, block.chainid
            )
        );
        adapter.validateObservationBatch(context, abi.encode(SEQUENCE, signatures));

        context = _context();
        context.requiredCapabilityHash = keccak256("another capability");
        vm.expectRevert(
            abi.encodeWithSelector(
                SignedObservationFixingAdapter.CapabilityMismatch.selector, CAPABILITY, keccak256("another capability")
            )
        );
        adapter.validateObservationBatch(context, abi.encode(SEQUENCE, signatures));
    }

    function test_ConstructorRejectsMalformedConfiguration() public {
        address[] memory unsorted = new address[](2);
        unsorted[0] = publishers[1];
        unsorted[1] = publishers[0];
        vm.expectRevert(
            abi.encodeWithSelector(
                SignedObservationFixingAdapter.SignersNotStrictlyIncreasing.selector, 1, publishers[1], publishers[0]
            )
        );
        new SignedObservationFixingAdapter(unsorted, 1, CAPABILITY);

        address[] memory one = new address[](1);
        one[0] = publishers[0];
        vm.expectRevert(abi.encodeWithSelector(SignedObservationFixingAdapter.InvalidThreshold.selector, 2, 1));
        new SignedObservationFixingAdapter(one, 2, CAPABILITY);

        vm.expectRevert(abi.encodeWithSelector(SignedObservationFixingAdapter.InvalidSignerCount.selector, 0, 16));
        new SignedObservationFixingAdapter(new address[](0), 1, CAPABILITY);
    }

    function _quorum(ObservationValidationContext memory context) internal view returns (bytes[] memory signatures) {
        signatures = new bytes[](2);
        signatures[0] = _sign(keys[0], context, SEQUENCE);
        signatures[1] = _sign(keys[1], context, SEQUENCE);
    }

    function _sign(uint256 key, ObservationValidationContext memory context, uint64 sequence)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, adapter.batchDigest(context, sequence));
        return abi.encodePacked(r, s, v);
    }

    function _context() internal view returns (ObservationValidationContext memory) {
        return ObservationValidationContext({
            chainId: block.chainid,
            fixingEngine: address(0xF1),
            seriesId: SeriesId.wrap(keccak256("series")),
            seriesVersion: 1,
            slot: 0,
            candidateIndex: 0,
            benchmarkId: BenchmarkId.wrap(keccak256("benchmark")),
            benchmarkVersion: 1,
            benchmarkVersionHash: keccak256("benchmark version"),
            feedKey: keccak256("Crypto.BTC/USD"),
            requiredCapabilityHash: CAPABILITY,
            selectionRuleId: SeriesDefinitionLib.FIXING_SELECTION_LAST_AT_OR_BEFORE,
            selectionParametersHash: keccak256("selection"),
            observationsHash: keccak256("observations"),
            candidateDeadline: uint64(block.timestamp + 1 hours)
        });
    }
}
