// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

interface IPositionPayoffModuleV1 {
    function evaluatePosition(bytes calldata payoffTerms, bytes calldata finalFixings)
        external
        view
        returns (int256 transferMinorPerLot);
}
