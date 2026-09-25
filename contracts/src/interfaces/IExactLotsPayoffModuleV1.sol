// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

interface IExactLotsPayoffModuleV1 {
    function exactLotsCapability() external pure returns (bytes32 capabilityHash);

    function evaluatePositionLots(bytes calldata payoffTerms, bytes calldata finalFixings, uint128 lots)
        external
        view
        returns (int256 terminalTransferMinor);
}
