// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// Errors raised by internal library code that now executes inside linked libraries. Declaring them here keeps
/// them in PrivateRfqBook's ABI exactly as before the modular split, so clients decode every revert unchanged.
interface IPrivateRfqBookLinkedErrors {
    error InvalidCapacityExpiry();
    error InvalidPackageLegCommitment();
    error InvalidPackageLegCount(uint256 count, uint256 minimum, uint256 maximum);
    error InvalidPackageLegOrder(uint256 index);
    error InvalidPackageOrientation(int32 firstRatio);
    error InvalidPartialFillPolicy();
    error InvalidQuotePricePolicy();
    error InvalidRfqDeadline(uint64 deadline, uint256 currentTimestamp);
    error InvalidRfqSidePolicy();
    error InvalidRfqTarget();
    error NonPrimitivePackageRatios(uint256 greatestCommonDivisor);
    error ZeroPackageLegRatio(uint256 index);
    error ZeroPackageSeriesId(uint256 index);
    error ZeroPackageSeriesVersion(uint256 index);
    error ZeroRfqField();
}
