// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {Eip712Lib} from "../../src/libraries/Eip712Lib.sol";
import {DeadlineExpired, ZeroAction, ZeroSigner, ZeroVerifyingContract} from "../../src/types/Errors.sol";
import {KernelHarness} from "../unit/harness/KernelHarness.sol";

contract Eip712LibFuzzTest is Test {
    KernelHarness internal harness;

    function setUp() public {
        harness = new KernelHarness();
    }

    function testFuzz_DomainSeparatorIsDeterministic(uint256 chainId, address verifyingContract) public pure {
        vm.assume(verifyingContract != address(0));

        assertEq(
            Eip712Lib.domainSeparator(chainId, verifyingContract), Eip712Lib.domainSeparator(chainId, verifyingContract)
        );
    }

    function testFuzz_DomainSeparatorMatchesCanonicalPreimage(uint256 chainId, address verifyingContract) public pure {
        vm.assume(verifyingContract != address(0));

        assertEq(
            Eip712Lib.domainSeparator(chainId, verifyingContract),
            keccak256(
                abi.encode(
                    Eip712Lib.DOMAIN_TYPEHASH,
                    Eip712Lib.DOMAIN_NAME_HASH,
                    Eip712Lib.DOMAIN_VERSION_HASH,
                    chainId,
                    verifyingContract
                )
            )
        );
    }

    function testFuzz_DomainSeparatorVariesByChainId(uint256 chainA, uint256 chainB, address verifyingContract)
        public
        pure
    {
        vm.assume(verifyingContract != address(0));
        vm.assume(chainA != chainB);

        assertTrue(
            Eip712Lib.domainSeparator(chainA, verifyingContract)
                != Eip712Lib.domainSeparator(chainB, verifyingContract),
            "chainId must separate domains"
        );
    }

    function testFuzz_DomainSeparatorVariesByVerifyingContract(uint256 chainId, address verifierA, address verifierB)
        public
        pure
    {
        vm.assume(verifierA != address(0));
        vm.assume(verifierB != address(0));
        vm.assume(verifierA != verifierB);

        assertTrue(
            Eip712Lib.domainSeparator(chainId, verifierA) != Eip712Lib.domainSeparator(chainId, verifierB),
            "verifying contract must separate domains"
        );
    }

    function testFuzz_ZeroVerifyingContractAlwaysRejected(uint256 chainId) public {
        vm.expectRevert(ZeroVerifyingContract.selector);
        harness.domainSeparator(chainId, address(0));
    }

    function testFuzz_ActionHeaderHashIsDeterministic(bytes32 action, address signer, uint256 nonce, uint64 deadline)
        public
        pure
    {
        Eip712Lib.ActionHeader memory header =
            Eip712Lib.ActionHeader({action: action, signer: signer, nonce: nonce, deadline: deadline});

        assertEq(Eip712Lib.hashActionHeader(header), Eip712Lib.hashActionHeader(header));
        assertEq(
            Eip712Lib.hashActionHeader(header),
            keccak256(abi.encode(Eip712Lib.ACTION_HEADER_TYPEHASH, action, signer, nonce, deadline))
        );
    }

    function testFuzz_TypedDataDigestMatchesEip712Prefix(uint256 chainId, address verifyingContract, bytes32 structHash)
        public
        pure
    {
        vm.assume(verifyingContract != address(0));

        bytes32 separator = Eip712Lib.domainSeparator(chainId, verifyingContract);

        assertEq(
            Eip712Lib.toTypedDataDigest(separator, structHash),
            keccak256(abi.encodePacked(hex"1901", separator, structHash))
        );
    }

    function testFuzz_TypedDataDigestIsReplaySeparated(
        uint256 chainA,
        uint256 chainB,
        address verifierA,
        address verifierB,
        bytes32 structHash
    ) public pure {
        vm.assume(verifierA != address(0));
        vm.assume(verifierB != address(0));
        vm.assume(chainA != chainB);
        vm.assume(verifierA != verifierB);

        bytes32 digestA = Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainA, verifierA), structHash);
        bytes32 digestChainShifted =
            Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainB, verifierA), structHash);
        bytes32 digestVerifierShifted =
            Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainA, verifierB), structHash);

        assertTrue(digestA != digestChainShifted, "digest must be chain separated");
        assertTrue(digestA != digestVerifierShifted, "digest must be verifying contract separated");
    }

    function testFuzz_ValidationAcceptsDeadlineAtOrAfterNow(
        bytes32 action,
        address signer,
        uint256 nonce,
        uint64 deadline,
        uint64 nowTs
    ) public view {
        vm.assume(action != bytes32(0));
        vm.assume(signer != address(0));
        nowTs = uint64(bound(uint256(nowTs), 0, uint256(deadline)));

        harness.validateActionHeader(
            Eip712Lib.ActionHeader({action: action, signer: signer, nonce: nonce, deadline: deadline}), nowTs
        );
    }

    function testFuzz_ValidationRejectsDeadlineBeforeNow(
        bytes32 action,
        address signer,
        uint256 nonce,
        uint64 deadline,
        uint64 nowTs
    ) public {
        vm.assume(action != bytes32(0));
        vm.assume(signer != address(0));
        deadline = uint64(bound(uint256(deadline), 0, type(uint64).max - 1));
        nowTs = uint64(bound(uint256(nowTs), uint256(deadline) + 1, type(uint64).max));

        vm.expectRevert(abi.encodeWithSelector(DeadlineExpired.selector, deadline, nowTs));
        harness.validateActionHeader(
            Eip712Lib.ActionHeader({action: action, signer: signer, nonce: nonce, deadline: deadline}), nowTs
        );
    }

    function testFuzz_ValidationRejectsZeroAction(address signer, uint256 nonce, uint64 deadline, uint64 nowTs) public {
        vm.expectRevert(ZeroAction.selector);
        harness.validateActionHeader(
            Eip712Lib.ActionHeader({action: bytes32(0), signer: signer, nonce: nonce, deadline: deadline}), nowTs
        );
    }

    function testFuzz_ValidationRejectsZeroSigner(bytes32 action, uint256 nonce, uint64 deadline, uint64 nowTs) public {
        vm.assume(action != bytes32(0));

        vm.expectRevert(ZeroSigner.selector);
        harness.validateActionHeader(
            Eip712Lib.ActionHeader({action: action, signer: address(0), nonce: nonce, deadline: deadline}), nowTs
        );
    }
}
