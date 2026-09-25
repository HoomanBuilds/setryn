// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    DefaultExecutionResult,
    DefaultProcess,
    DefaultProcessRules,
    InsurancePolicy,
    LiquidationBidRecord
} from "../types/DefaultTypes.sol";

interface IDefaultLifecycleExecutor {
    function executeDefaultNovation(
        DefaultProcess calldata process,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        LiquidationBidRecord calldata winningBid,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    ) external returns (DefaultExecutionResult memory result);

    function applyTerminalDefaultRule(
        DefaultProcess calldata process,
        DefaultProcessRules calldata rules,
        InsurancePolicy calldata policy,
        uint128 insuranceDrawMinor,
        uint128 terminalResidualMinor
    ) external returns (DefaultExecutionResult memory result);
}
