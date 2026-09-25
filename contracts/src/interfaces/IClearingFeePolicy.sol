// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingFeeQuote} from "../types/ClearingTypes.sol";
import {PublicOrder} from "../types/OrderTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

interface IClearingFeePolicy {
    function quoteFees(
        PublicOrder calldata takerOrder,
        PublicOrder calldata makerOrder,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        bytes32 witnessHash
    ) external view returns (ClearingFeeQuote memory quote);
}
