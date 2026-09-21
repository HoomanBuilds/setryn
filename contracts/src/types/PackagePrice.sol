// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @dev A package price is quoted from the buyer perspective in quote-asset minor units. A positive
/// value is a debit paid by the buyer, a negative value is a credit received by the buyer, and zero
/// is a valid costless package rather than an unset sentinel.
type PackagePrice is int256;

library PackagePriceLib {
    function isDebit(PackagePrice price) internal pure returns (bool) {
        return PackagePrice.unwrap(price) > 0;
    }

    function isCredit(PackagePrice price) internal pure returns (bool) {
        return PackagePrice.unwrap(price) < 0;
    }

    function isZero(PackagePrice price) internal pure returns (bool) {
        return PackagePrice.unwrap(price) == 0;
    }
}
