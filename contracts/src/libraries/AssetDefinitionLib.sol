// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AssetDefinition} from "../types/AssetDefinition.sol";
import {AssetClass} from "../types/Enums.sol";
import {AssetId} from "../types/Identifiers.sol";
import {IdLib} from "./IdLib.sol";

error ZeroNamespaceId();

error ZeroReferenceId();

error ZeroSymbol();

error UnspecifiedAssetClass();

library AssetDefinitionLib {
    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    ///
    /// @dev Each literal carries its version. A hashing rule may never be edited in place; it is
    /// replaced by a new V2 literal, so previously derived hashes can never silently re-derive.
    string internal constant ASSET_KEY_TYPESTRING = "SetrynAssetKeyV1(bytes32 namespaceId,bytes32 referenceId)";
    bytes32 internal constant ASSET_KEY_TYPEHASH =
        keccak256("SetrynAssetKeyV1(bytes32 namespaceId,bytes32 referenceId)");

    string internal constant ASSET_DEFINITION_TYPESTRING =
        "SetrynAssetDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 symbol,uint8 assetClass,uint8 decimals)";
    bytes32 internal constant ASSET_DEFINITION_TYPEHASH = keccak256(
        "SetrynAssetDefinitionV1(bytes32 namespaceId,bytes32 referenceId,bytes32 symbol,uint8 assetClass,uint8 decimals)"
    );

    function validate(AssetDefinition memory definition) internal pure {
        if (definition.namespaceId == bytes32(0)) {
            revert ZeroNamespaceId();
        }
        if (definition.referenceId == bytes32(0)) {
            revert ZeroReferenceId();
        }
        if (definition.symbol == bytes32(0)) {
            revert ZeroSymbol();
        }
        if (definition.assetClass == AssetClass.Unspecified) {
            revert UnspecifiedAssetClass();
        }
    }

    /// @dev Hashes the identity key alone, so reclassifying an asset or correcting its display
    /// fields can never mint a second identity for the same namespaced reference.
    function hashKey(AssetDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(abi.encode(ASSET_KEY_TYPEHASH, definition.namespaceId, definition.referenceId));
    }

    /// @dev Hashes every field, including the non-identity ones, so an indexer can detect that two
    /// registrations of one identity would have disagreed on classification or accounting.
    function hashDefinition(AssetDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ASSET_DEFINITION_TYPEHASH,
                definition.namespaceId,
                definition.referenceId,
                definition.symbol,
                uint8(definition.assetClass),
                definition.decimals
            )
        );
    }

    function deriveAssetId(AssetDefinition memory definition) internal pure returns (AssetId) {
        return IdLib.deriveAssetId(hashKey(definition));
    }
}
