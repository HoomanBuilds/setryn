// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SettlementAssetDefinition} from "../types/SettlementAssetDefinition.sol";
import {AssetId} from "../types/Identifiers.sol";

error ZeroSettlementToken();

error SettlementTokenHasNoCode(address token);

error ZeroRuntimeCodeHash();

error ZeroQualificationHash();

error RuntimeCodeHashMismatch(address token, bytes32 expectedCodeHash, bytes32 actualCodeHash);

library SettlementAssetLib {
    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    ///
    /// @dev chainId is hashed in deliberately, the opposite of canonical identity. The same token
    /// address on two chains is two different contracts, so the two qualifications must never share
    /// one commitment.
    ///
    /// @dev Each literal carries its version. A hashing rule may never be edited in place; it is
    /// replaced by a new V2 literal, so previously derived hashes can never silently re-derive.
    string internal constant SETTLEMENT_ASSET_DEFINITION_TYPESTRING =
        "SetrynSettlementAssetDefinitionV1(bytes32 assetId,address token,bytes32 expectedRuntimeCodeHash,bytes32 qualificationHash,uint256 chainId)";
    bytes32 internal constant SETTLEMENT_ASSET_DEFINITION_TYPEHASH = keccak256(
        "SetrynSettlementAssetDefinitionV1(bytes32 assetId,address token,bytes32 expectedRuntimeCodeHash,bytes32 qualificationHash,uint256 chainId)"
    );

    /// @dev The version commitment binds the sequence number and the decimals snapshot to the
    /// definition, so a stored record can never be replayed as a different version of itself.
    string internal constant SETTLEMENT_ASSET_VERSION_TYPESTRING =
        "SetrynSettlementAssetVersionV1(bytes32 definitionHash,uint32 version,uint8 decimals)";
    bytes32 internal constant SETTLEMENT_ASSET_VERSION_TYPEHASH =
        keccak256("SetrynSettlementAssetVersionV1(bytes32 definitionHash,uint32 version,uint8 decimals)");

    /// @dev Checks only the fields this library can judge on its own. Canonical asset existence,
    /// canonical decimals, and the live token decimals read belong to the registry, which owns the
    /// external calls.
    function validate(SettlementAssetDefinition memory definition) internal view {
        if (definition.token == address(0)) {
            revert ZeroSettlementToken();
        }
        if (definition.token.code.length == 0) {
            revert SettlementTokenHasNoCode(definition.token);
        }
        if (definition.expectedRuntimeCodeHash == bytes32(0)) {
            revert ZeroRuntimeCodeHash();
        }
        if (definition.qualificationHash == bytes32(0)) {
            revert ZeroQualificationHash();
        }
        requireRuntimeCodeHash(definition.token, definition.expectedRuntimeCodeHash);
    }

    function requireRuntimeCodeHash(address token, bytes32 expectedCodeHash) internal view {
        bytes32 actualCodeHash = token.codehash;
        if (actualCodeHash != expectedCodeHash) {
            revert RuntimeCodeHashMismatch(token, expectedCodeHash, actualCodeHash);
        }
    }

    function runtimeCodeHashMatches(address token, bytes32 expectedCodeHash) internal view returns (bool) {
        return token.code.length != 0 && token.codehash == expectedCodeHash;
    }

    function hashDefinition(SettlementAssetDefinition memory definition, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                SETTLEMENT_ASSET_DEFINITION_TYPEHASH,
                AssetId.unwrap(definition.assetId),
                definition.token,
                definition.expectedRuntimeCodeHash,
                definition.qualificationHash,
                chainId
            )
        );
    }

    function hashVersion(bytes32 definitionHash, uint32 version, uint8 decimals) internal pure returns (bytes32) {
        return keccak256(abi.encode(SETTLEMENT_ASSET_VERSION_TYPEHASH, definitionHash, version, decimals));
    }
}
