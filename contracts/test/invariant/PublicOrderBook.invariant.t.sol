// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PublicBookOrderingHandler} from "./handlers/PublicBookOrderingHandler.sol";

contract PublicOrderBookInvariantTest is Test {
    PublicBookOrderingHandler internal handler;

    function setUp() public {
        handler = new PublicBookOrderingHandler();
        targetContract(address(handler));
    }

    function invariant_DirectBookNeverRestsCrossedBestPrices() public view {
        if (handler.hasBid() && handler.hasAsk()) assertLt(handler.bestBid(), handler.bestAsk());
    }
}
