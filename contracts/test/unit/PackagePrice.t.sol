// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PackagePrice, PackagePriceLib} from "../../src/types/PackagePrice.sol";

contract PackagePriceTest is Test {
    function test_DebitIsPositive() public pure {
        PackagePrice price = PackagePrice.wrap(2_500_000);

        assertTrue(PackagePriceLib.isDebit(price));
        assertFalse(PackagePriceLib.isCredit(price));
        assertFalse(PackagePriceLib.isZero(price));
    }

    function test_CreditIsNegative() public pure {
        PackagePrice price = PackagePrice.wrap(-2_500_000);

        assertTrue(PackagePriceLib.isCredit(price));
        assertFalse(PackagePriceLib.isDebit(price));
        assertFalse(PackagePriceLib.isZero(price));
    }

    function test_ZeroIsValidAndClassified() public pure {
        PackagePrice price = PackagePrice.wrap(0);

        assertTrue(PackagePriceLib.isZero(price));
        assertFalse(PackagePriceLib.isDebit(price));
        assertFalse(PackagePriceLib.isCredit(price));
    }

    function test_ExtremesKeepTheirClassification() public pure {
        assertTrue(PackagePriceLib.isDebit(PackagePrice.wrap(type(int256).max)));
        assertTrue(PackagePriceLib.isCredit(PackagePrice.wrap(type(int256).min)));
        assertTrue(PackagePriceLib.isDebit(PackagePrice.wrap(1)));
        assertTrue(PackagePriceLib.isCredit(PackagePrice.wrap(-1)));
    }

    function test_CanonicalEncodingIsTwosComplement() public pure {
        assertEq(abi.decode(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(0))), (bytes32)), bytes32(0));
        assertEq(abi.decode(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(1))), (bytes32)), bytes32(uint256(1)));
        assertEq(
            abi.decode(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(-1))), (bytes32)), bytes32(type(uint256).max)
        );
        assertEq(
            abi.decode(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(-2))), (bytes32)),
            bytes32(type(uint256).max - 1)
        );
        assertEq(
            abi.decode(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(type(int256).min))), (bytes32)),
            bytes32(uint256(1) << 255)
        );
    }

    function test_EncodingWidthIsOneWord() public pure {
        assertEq(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(-1))).length, 32);
        assertEq(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(1))).length, 32);
    }

    function test_HashingSeparatesDebitFromCredit() public pure {
        bytes32 debit = keccak256(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(1_000))));
        bytes32 credit = keccak256(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(-1_000))));
        bytes32 costless = keccak256(abi.encode(PackagePrice.unwrap(PackagePrice.wrap(0))));

        assertTrue(debit != credit, "sign must survive hashing");
        assertTrue(debit != costless, "debit must not hash as costless");
        assertTrue(credit != costless, "credit must not hash as costless");
    }
}
