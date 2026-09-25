// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PublicBookLib} from "../../../src/libraries/PublicBookLib.sol";
import {Side} from "../../../src/types/Enums.sol";
import {PriceTicks} from "../../../src/types/Units.sol";

contract PublicBookOrderingHandler {
    int128 public bestBid;
    int128 public bestAsk;
    uint64 public bidSequence;
    uint64 public askSequence;
    bool public hasBid;
    bool public hasAsk;

    function admitBid(int128 price) external {
        if (hasAsk && PublicBookLib.crosses(Side.Buy, PriceTicks.wrap(price), PriceTicks.wrap(bestAsk))) return;
        if (!hasBid || PublicBookLib.isBefore(Side.Buy, PriceTicks.wrap(price), PriceTicks.wrap(bestBid))) {
            bestBid = price;
            hasBid = true;
        }
        bidSequence += 1;
    }

    function admitAsk(int128 price) external {
        if (hasBid && PublicBookLib.crosses(Side.Sell, PriceTicks.wrap(price), PriceTicks.wrap(bestBid))) return;
        if (!hasAsk || PublicBookLib.isBefore(Side.Sell, PriceTicks.wrap(price), PriceTicks.wrap(bestAsk))) {
            bestAsk = price;
            hasAsk = true;
        }
        askSequence += 1;
    }
}
