// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {Eip712Lib} from "../../src/libraries/Eip712Lib.sol";
import {DeadlineExpired, ZeroAction, ZeroSigner, ZeroVerifyingContract} from "../../src/types/Errors.sol";
import {KernelHarness} from "./harness/KernelHarness.sol";

contract Eip712LibTest is Test {
    uint256 internal constant ARBITRUM_ONE = 42161;
    uint256 internal constant ARBITRUM_SEPOLIA = 421614;

    address internal constant VERIFIER_A = address(0xA11CE);
    address internal constant VERIFIER_B = address(0xB0B);

    bytes32 internal constant ACTION = keccak256("SetrynTestActionV1");
    address internal constant SIGNER = address(0xCAFE);
    uint256 internal constant NONCE = 7;
    uint64 internal constant DEADLINE = 1_900_000_000;

    bytes32 internal constant GOLDEN_DOMAIN_TYPEHASH =
        0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
    bytes32 internal constant GOLDEN_DOMAIN_NAME_HASH =
        0xb76f8921a415a56a97d2141ee03f78364252bbdf45613fdcf26995871d0fe461;
    bytes32 internal constant GOLDEN_DOMAIN_VERSION_HASH =
        0xc89efdaa54c0f20c7adf612882df0950f5a951637e0307cdcb4c672f298b8bc6;
    bytes32 internal constant GOLDEN_ARBITRUM_ONE_DOMAIN_SEPARATOR =
        0x10c47097a92e9eb81b28730a11bf2343a81bfbc90cc7bf93f0ec19f23abf3818;

    bytes32 internal constant GOLDEN_ACTION_HEADER_TYPEHASH =
        0x4bdfbe39fbdedb86f789e0c674174a56749a0687b86da7179765973bf7f4f338;
    bytes32 internal constant GOLDEN_ACTION = 0x2836ad8c705fd4761604ab25b832fbfcc780904e41093d6e1fbc5552388c27e9;
    bytes32 internal constant GOLDEN_ACTION_HEADER_HASH =
        0x0db1a2e23d2a2608b04b8f74ee836a9e1431d00ca31d24b5660185660f33bd72;

    KernelHarness internal harness;

    function setUp() public {
        harness = new KernelHarness();
    }

    function test_DomainTypehashMatchesLiteral() public pure {
        assertEq(
            Eip712Lib.DOMAIN_TYPEHASH,
            keccak256(bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
        );
        assertEq(Eip712Lib.DOMAIN_NAME_HASH, keccak256(bytes(Eip712Lib.DOMAIN_NAME)));
        assertEq(Eip712Lib.DOMAIN_VERSION_HASH, keccak256(bytes(Eip712Lib.DOMAIN_VERSION)));
    }

    function test_ActionHeaderTypehashMatchesTypestring() public pure {
        assertEq(Eip712Lib.ACTION_HEADER_TYPEHASH, keccak256(bytes(Eip712Lib.ACTION_HEADER_TYPESTRING)));
        assertEq(
            Eip712Lib.ACTION_HEADER_TYPESTRING,
            "ActionHeader(bytes32 action,address signer,uint256 nonce,uint64 deadline)"
        );
    }

    function test_GoldenVectorsForDomainAndActionHeader() public pure {
        assertEq(Eip712Lib.DOMAIN_TYPEHASH, GOLDEN_DOMAIN_TYPEHASH);
        assertEq(Eip712Lib.DOMAIN_NAME_HASH, GOLDEN_DOMAIN_NAME_HASH);
        assertEq(Eip712Lib.DOMAIN_VERSION_HASH, GOLDEN_DOMAIN_VERSION_HASH);
        assertEq(Eip712Lib.ACTION_HEADER_TYPEHASH, GOLDEN_ACTION_HEADER_TYPEHASH);
        assertEq(ACTION, GOLDEN_ACTION);

        assertEq(Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_A), GOLDEN_ARBITRUM_ONE_DOMAIN_SEPARATOR);
        assertEq(Eip712Lib.hashActionHeader(_header()), GOLDEN_ACTION_HEADER_HASH);
    }

    function test_DomainSeparatorMatchesCanonicalPreimage() public pure {
        assertEq(
            Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_A),
            keccak256(
                abi.encode(
                    keccak256(
                        bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
                    ),
                    keccak256(bytes("Setryn")),
                    keccak256(bytes("1")),
                    ARBITRUM_ONE,
                    VERIFIER_A
                )
            )
        );
    }

    function test_ActionHeaderHashMatchesCanonicalPreimage() public pure {
        assertEq(
            Eip712Lib.hashActionHeader(_header()),
            keccak256(
                abi.encode(
                    keccak256(bytes("ActionHeader(bytes32 action,address signer,uint256 nonce,uint64 deadline)")),
                    ACTION,
                    SIGNER,
                    NONCE,
                    DEADLINE
                )
            )
        );
    }

    function test_DomainSeparatorVariesByChainId() public pure {
        bytes32 onOne = Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_A);
        bytes32 onSepolia = Eip712Lib.domainSeparator(ARBITRUM_SEPOLIA, VERIFIER_A);

        assertTrue(onOne != onSepolia, "chainId must separate domains");
    }

    function test_DomainSeparatorVariesByVerifyingContract() public pure {
        bytes32 viaA = Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_A);
        bytes32 viaB = Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_B);

        assertTrue(viaA != viaB, "verifying contract must separate domains");
    }

    function test_ZeroVerifyingContractRejected() public {
        vm.expectRevert(ZeroVerifyingContract.selector);
        harness.domainSeparator(ARBITRUM_ONE, address(0));
    }

    function test_TypedDataDigestIsChainSeparated() public pure {
        bytes32 structHash = Eip712Lib.hashActionHeader(_header());

        bytes32 onOne = Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_A), structHash);
        bytes32 onSepolia =
            Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(ARBITRUM_SEPOLIA, VERIFIER_A), structHash);

        assertTrue(onOne != onSepolia, "digest must be chain separated");
    }

    function test_TypedDataDigestIsVerifyingContractSeparated() public pure {
        bytes32 structHash = Eip712Lib.hashActionHeader(_header());

        bytes32 viaA = Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_A), structHash);
        bytes32 viaB = Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_B), structHash);

        assertTrue(viaA != viaB, "digest must be verifying contract separated");
    }

    function test_TypedDataDigestMatchesEip712Prefix() public pure {
        bytes32 separator = Eip712Lib.domainSeparator(ARBITRUM_ONE, VERIFIER_A);
        bytes32 structHash = Eip712Lib.hashActionHeader(_header());

        assertEq(
            Eip712Lib.toTypedDataDigest(separator, structHash),
            keccak256(abi.encodePacked(hex"1901", separator, structHash))
        );
    }

    function test_EveryActionHeaderFieldAffectsHash() public pure {
        bytes32 baseline = Eip712Lib.hashActionHeader(_header());

        Eip712Lib.ActionHeader memory changedAction = _header();
        changedAction.action = keccak256("SetrynOtherActionV1");
        assertTrue(Eip712Lib.hashActionHeader(changedAction) != baseline, "action must affect hash");

        Eip712Lib.ActionHeader memory changedSigner = _header();
        changedSigner.signer = address(0xDEAD);
        assertTrue(Eip712Lib.hashActionHeader(changedSigner) != baseline, "signer must affect hash");

        Eip712Lib.ActionHeader memory changedNonce = _header();
        changedNonce.nonce = NONCE + 1;
        assertTrue(Eip712Lib.hashActionHeader(changedNonce) != baseline, "nonce must affect hash");

        Eip712Lib.ActionHeader memory changedDeadline = _header();
        changedDeadline.deadline = DEADLINE + 1;
        assertTrue(Eip712Lib.hashActionHeader(changedDeadline) != baseline, "deadline must affect hash");
    }

    function test_HashingIsDeterministicAndIgnoresValidity() public pure {
        Eip712Lib.ActionHeader memory invalid =
            Eip712Lib.ActionHeader({action: bytes32(0), signer: address(0), nonce: 0, deadline: 0});

        assertEq(Eip712Lib.hashActionHeader(invalid), Eip712Lib.hashActionHeader(invalid));
        assertEq(Eip712Lib.hashActionHeader(_header()), Eip712Lib.hashActionHeader(_header()));
    }

    function test_ValidationRejectsZeroAction() public {
        Eip712Lib.ActionHeader memory header = _header();
        header.action = bytes32(0);

        vm.expectRevert(ZeroAction.selector);
        harness.validateActionHeader(header, DEADLINE);
    }

    function test_ValidationRejectsZeroSigner() public {
        Eip712Lib.ActionHeader memory header = _header();
        header.signer = address(0);

        vm.expectRevert(ZeroSigner.selector);
        harness.validateActionHeader(header, DEADLINE);
    }

    function test_ValidationRejectsExpiredDeadline() public {
        Eip712Lib.ActionHeader memory header = _header();

        vm.expectRevert(abi.encodeWithSelector(DeadlineExpired.selector, DEADLINE, DEADLINE + 1));
        harness.validateActionHeader(header, DEADLINE + 1);
    }

    function test_DeadlineBoundaryIsInclusive() public view {
        harness.validateActionHeader(_header(), DEADLINE);
        harness.validateActionHeader(_header(), DEADLINE - 1);
    }

    function _header() internal pure returns (Eip712Lib.ActionHeader memory) {
        return Eip712Lib.ActionHeader({action: ACTION, signer: SIGNER, nonce: NONCE, deadline: DEADLINE});
    }
}
