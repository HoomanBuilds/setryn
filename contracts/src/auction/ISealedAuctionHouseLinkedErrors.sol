// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// Errors raised by internal library code that now executes inside linked libraries. Declaring them here keeps
/// them in SealedAuctionHouse's ABI exactly as before the modular split, so clients decode every revert unchanged.
interface ISealedAuctionHouseLinkedErrors {
    error InvalidAuctionDeadlines();
    error InvalidAuctionField();
    error InvalidAuctionLots();
    error InvalidAuctionRules();
    error InvalidAuctionTarget();
    error InvalidBidField();
    error InvalidBidLots();
    error InvalidPackageLegCommitment();
    error InvalidPackageLegCount(uint256 count, uint256 minimum, uint256 maximum);
    error InvalidPackageLegOrder(uint256 index);
    error InvalidPackageOrientation(int32 firstRatio);
    error InvalidRouteField();
    error InvalidRouteGraph();
    error NonPrimitivePackageRatios(uint256 greatestCommonDivisor);
    error ZeroPackageLegRatio(uint256 index);
    error ZeroPackageSeriesId(uint256 index);
    error ZeroPackageSeriesVersion(uint256 index);
    error ZeroVerifyingContract();
}
