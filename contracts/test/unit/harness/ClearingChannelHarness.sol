// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingChannelLib} from "../../../src/libraries/ClearingChannelLib.sol";
import {ClearingChannelKind} from "../../../src/types/ClearingTypes.sol";

contract ClearingChannelHarness {
    function requireDirect(ClearingChannelKind channelKind) external pure {
        ClearingChannelLib.requireDirect(channelKind);
    }
}
