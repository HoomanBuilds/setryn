// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

interface IPositionPayoffModuleV1 {
    /// @dev Compatibility-only per-lot evaluation. Multiplying this rounded result by lots is not exact for general
    /// rational payoffs. Production multi-lot settlement must require IExactLotsPayoffModuleV1.
    function evaluatePosition(bytes calldata payoffTerms, bytes calldata finalFixings)
        external
        view
        returns (int256 transferMinorPerLot);
}
