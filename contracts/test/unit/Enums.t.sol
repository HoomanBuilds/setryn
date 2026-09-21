// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {AssetClass, Side} from "../../src/types/Enums.sol";

contract EnumsTest is Test {
    function test_AssetClassOrdinalsAreStable() public pure {
        assertEq(uint8(AssetClass.Unspecified), 0);
        assertEq(uint8(AssetClass.Crypto), 1);
        assertEq(uint8(AssetClass.Stablecoin), 2);
        assertEq(uint8(AssetClass.Fx), 3);
        assertEq(uint8(AssetClass.Commodity), 4);
        assertEq(uint8(AssetClass.Rate), 5);
        assertEq(uint8(AssetClass.Index), 6);
        assertEq(uint8(AssetClass.TokenizedAsset), 7);
    }

    function test_SideOrdinalsAreStable() public pure {
        assertEq(uint8(Side.Unspecified), 0);
        assertEq(uint8(Side.Buy), 1);
        assertEq(uint8(Side.Sell), 2);
    }

    function test_DefaultValuesAreUnspecified() public pure {
        AssetClass assetClass;
        Side side;

        assertEq(uint8(assetClass), uint8(AssetClass.Unspecified));
        assertEq(uint8(side), uint8(Side.Unspecified));
    }
}
