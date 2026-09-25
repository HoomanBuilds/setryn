// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ClearingChannelHarness} from "./harness/ClearingChannelHarness.sol";
import {UnsupportedClearingChannel} from "../../src/libraries/ClearingChannelLib.sol";
import {ClearingChannelKind} from "../../src/types/ClearingTypes.sol";

contract ClearingChannelLibTest is Test {
    ClearingChannelHarness internal harness = new ClearingChannelHarness();

    function test_DirectChannelIsEnabled() public view {
        harness.requireDirect(ClearingChannelKind.Direct);
    }

    function test_PrivateRfqActivationFailsClosed() public {
        vm.expectRevert(abi.encodeWithSelector(UnsupportedClearingChannel.selector, ClearingChannelKind.PrivateRfq));
        harness.requireDirect(ClearingChannelKind.PrivateRfq);
    }

    function test_SealedAuctionActivationFailsClosed() public {
        vm.expectRevert(abi.encodeWithSelector(UnsupportedClearingChannel.selector, ClearingChannelKind.SealedAuction));
        harness.requireDirect(ClearingChannelKind.SealedAuction);
    }

    function test_UnspecifiedActivationFailsClosed() public {
        vm.expectRevert(abi.encodeWithSelector(UnsupportedClearingChannel.selector, ClearingChannelKind.Unspecified));
        harness.requireDirect(ClearingChannelKind.Unspecified);
    }
}
