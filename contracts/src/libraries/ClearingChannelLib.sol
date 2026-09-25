// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ClearingChannelKind} from "../types/ClearingTypes.sol";

error UnsupportedClearingChannel(ClearingChannelKind channelKind);

library ClearingChannelLib {
    function requireDirect(ClearingChannelKind channelKind) internal pure {
        if (channelKind != ClearingChannelKind.Direct) revert UnsupportedClearingChannel(channelKind);
    }
}
