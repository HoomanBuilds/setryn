// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingLib} from "../../../src/libraries/ClearingLib.sol";
import {FillId} from "../../../src/types/Identifiers.sol";
import {Lots, PriceTicks} from "../../../src/types/Units.sol";

contract ClearingIdentityHandler {
    uint128 public cumulativeLots;
    uint256 public uniqueFillCount;
    mapping(FillId fillId => bool seen) public seen;

    function clear(uint64 rawLots, int128 executionPrice, bytes32 witness) external {
        uint128 lots = uint128(uint256(rawLots) + 1);
        if (type(uint128).max - cumulativeLots < lots) return;
        cumulativeLots += lots;
        FillId fillId = ClearingLib.deriveFillId(
            42161,
            address(this),
            keccak256("invariant.taker"),
            keccak256("invariant.maker"),
            Lots.wrap(cumulativeLots),
            Lots.wrap(cumulativeLots),
            Lots.wrap(lots),
            PriceTicks.wrap(executionPrice),
            witness
        );
        if (seen[fillId]) revert();
        seen[fillId] = true;
        uniqueFillCount += 1;
    }
}
