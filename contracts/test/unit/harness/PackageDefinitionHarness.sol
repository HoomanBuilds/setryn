// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PackageDefinitionLib} from "../../../src/libraries/PackageDefinitionLib.sol";
import {PackageDefinition, PackageLeg} from "../../../src/types/PackageDefinition.sol";
import {Lots, PriceTicks} from "../../../src/types/Units.sol";

contract PackageDefinitionHarness {
    function deriveTerminalDebitBounds(
        PackageLeg[] calldata legs,
        uint128[] calldata longBounds,
        uint128[] calldata shortBounds
    ) external pure returns (uint128 longDebit, uint128 shortDebit) {
        return PackageDefinitionLib.deriveTerminalDebitBounds(legs, longBounds, shortBounds);
    }

    function legLots(Lots packageLots, int32 ratio) external pure returns (Lots) {
        return PackageDefinitionLib.legLots(packageLots, ratio);
    }

    function validateOrder(PackageDefinition calldata definition, Lots packageLots, PriceTicks priceTicks)
        external
        pure
    {
        PackageDefinitionLib.validateOrder(definition, packageLots, priceTicks);
    }

    function compileFillNotional(PackageDefinition calldata definition, Lots packageLots, PriceTicks priceTicks)
        external
        pure
        returns (int256)
    {
        return PackageDefinitionLib.compileFillNotional(definition, packageLots, priceTicks);
    }
}
