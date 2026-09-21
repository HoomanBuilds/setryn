// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PackagePrice, PackagePriceLib} from "../../src/types/PackagePrice.sol";

contract PackagePriceFuzzTest is Test {
    function testFuzz_ExactlyOneClassificationHolds(int256 raw) public pure {
        PackagePrice price = PackagePrice.wrap(raw);

        uint256 matched;
        if (PackagePriceLib.isDebit(price)) {
            matched++;
        }
        if (PackagePriceLib.isCredit(price)) {
            matched++;
        }
        if (PackagePriceLib.isZero(price)) {
            matched++;
        }

        assertEq(matched, 1);
    }

    function testFuzz_ClassificationFollowsBuyerPerspective(int256 raw) public pure {
        PackagePrice price = PackagePrice.wrap(raw);

        assertEq(PackagePriceLib.isDebit(price), raw > 0);
        assertEq(PackagePriceLib.isCredit(price), raw < 0);
        assertEq(PackagePriceLib.isZero(price), raw == 0);
    }

    function testFuzz_CanonicalEncodingRoundTrips(int256 raw) public pure {
        PackagePrice price = PackagePrice.wrap(raw);

        bytes memory encoded = abi.encode(PackagePrice.unwrap(price));

        assertEq(encoded.length, 32);
        assertEq(abi.decode(encoded, (int256)), raw);
    }

    function testFuzz_OppositeSignsEncodeDistinctly(int256 raw) public pure {
        vm.assume(raw != 0);
        vm.assume(raw != type(int256).min);

        PackagePrice debit = PackagePrice.wrap(raw);
        PackagePrice credit = PackagePrice.wrap(-raw);

        assertTrue(
            keccak256(abi.encode(PackagePrice.unwrap(debit))) != keccak256(abi.encode(PackagePrice.unwrap(credit))),
            "sign must survive encoding and hashing"
        );
        assertTrue(PackagePriceLib.isDebit(debit) != PackagePriceLib.isDebit(credit), "sign must flip classification");
    }

    function testFuzz_UnwrapIsLossless(int256 raw) public pure {
        assertEq(PackagePrice.unwrap(PackagePrice.wrap(raw)), raw);
    }
}
