// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {StrategyCompileInput, StrategyCompileResult} from "../types/PayoffTypes.sol";

interface ICanonicalStrategyCompiler {
    function compileStrategy(StrategyCompileInput calldata input)
        external
        pure
        returns (StrategyCompileResult memory result);
}
