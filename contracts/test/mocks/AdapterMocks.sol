// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @dev A code stub, nothing more. The benchmark registry never calls an adapter implementation, so
/// an adapter version only needs an address that holds some bytecode with a stable runtime hash.
contract MockAdapterImplementation {
    uint256 public marker;
}

/// @dev A second stub whose bytecode differs from the first, so a test can etch it over a qualified
/// implementation and reproduce runtime drift.
contract MockDriftedAdapterImplementation {
    uint256 public marker;

    function drift() external pure returns (uint256) {
        return 1;
    }
}
