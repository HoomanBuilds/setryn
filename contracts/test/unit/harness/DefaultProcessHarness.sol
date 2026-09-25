// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {DefaultProcessLib} from "../../../src/libraries/DefaultProcessLib.sol";
import {LiquidationBidId} from "../../../src/types/DefaultTypes.sol";

contract DefaultProcessHarness {
    function isBetterBid(
        uint128 candidateContribution,
        uint128 candidateDiscount,
        LiquidationBidId candidateId,
        uint128 incumbentContribution,
        uint128 incumbentDiscount,
        LiquidationBidId incumbentId
    ) external pure returns (bool) {
        return DefaultProcessLib.isBetterBid(
            candidateContribution, candidateDiscount, candidateId, incumbentContribution, incumbentDiscount, incumbentId
        );
    }
}
