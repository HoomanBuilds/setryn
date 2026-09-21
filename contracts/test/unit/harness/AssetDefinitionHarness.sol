// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AssetDefinitionLib} from "../../../src/libraries/AssetDefinitionLib.sol";
import {AssetDefinition} from "../../../src/types/AssetDefinition.sol";
import {AssetId} from "../../../src/types/Identifiers.sol";

contract AssetDefinitionHarness {
    function validate(AssetDefinition calldata definition) external pure {
        AssetDefinitionLib.validate(definition);
    }

    function hashKey(AssetDefinition calldata definition) external pure returns (bytes32) {
        return AssetDefinitionLib.hashKey(definition);
    }

    function hashDefinition(AssetDefinition calldata definition) external pure returns (bytes32) {
        return AssetDefinitionLib.hashDefinition(definition);
    }

    function deriveAssetId(AssetDefinition calldata definition) external pure returns (AssetId) {
        return AssetDefinitionLib.deriveAssetId(definition);
    }
}
