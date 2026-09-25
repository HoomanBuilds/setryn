// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

contract DefaultWaterfallHandler {
    uint128 public deficiency;
    uint128 public defaulterApplied;
    uint128 public takeoverApplied;
    uint128 public insuranceApplied;
    uint128 public terminalResidual;

    function allocate(uint128 deficiency_, uint128 defaulterAvailable, uint128 takeoverAvailable, uint128 insuranceCap)
        external
    {
        deficiency = deficiency_;
        uint128 remaining = deficiency_;
        defaulterApplied = _minimum(remaining, defaulterAvailable);
        remaining -= defaulterApplied;
        takeoverApplied = _minimum(remaining, takeoverAvailable);
        remaining -= takeoverApplied;
        insuranceApplied = _minimum(remaining, insuranceCap);
        remaining -= insuranceApplied;
        terminalResidual = remaining;
    }

    function _minimum(uint128 left, uint128 right) private pure returns (uint128) {
        return left < right ? left : right;
    }
}
