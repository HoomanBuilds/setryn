// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingLib} from "../../../src/libraries/ClearingLib.sol";
import {FillId} from "../../../src/types/Identifiers.sol";
import {OrderRecord} from "../../../src/types/OrderTypes.sol";
import {Lots, PriceTicks} from "../../../src/types/Units.sol";

contract ClearingHarness {
    function validateMatch(
        bytes32 takerHash,
        OrderRecord calldata taker,
        bytes32 makerHash,
        OrderRecord calldata maker,
        Lots fillLots,
        PriceTicks executionPrice
    ) external pure returns (bool) {
        return ClearingLib.validateMatch(takerHash, taker, makerHash, maker, fillLots, executionPrice);
    }

    function deriveFillId(
        uint256 chainId,
        address engine,
        bytes32 takerHash,
        bytes32 makerHash,
        Lots takerCumulative,
        Lots makerCumulative,
        Lots fillLots,
        PriceTicks executionPrice,
        bytes32 witnessHash
    ) external pure returns (FillId) {
        return ClearingLib.deriveFillId(
            chainId,
            engine,
            takerHash,
            makerHash,
            takerCumulative,
            makerCumulative,
            fillLots,
            executionPrice,
            witnessHash
        );
    }

    function deriveFundingReference(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose)
        external
        pure
        returns (bytes32)
    {
        return ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
    }
}
