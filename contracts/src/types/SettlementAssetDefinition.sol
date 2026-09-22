// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {AssetId} from "./Identifiers.sol";

/// @dev A settlement asset definition is chain-local operational qualification, never identity. It
/// names the ERC-20 contract that one canonical AssetId settles against on this chain. None of these
/// fields may ever migrate into AssetDefinition, which stays chain-portable.
///
/// @dev expectedRuntimeCodeHash attests the runtime bytecode found at token only. For a proxy that
/// is the proxy bytecode, not the implementation behind it, so an upgradeable token can change
/// behavior without changing this hash. qualificationHash is the commitment to the broader offchain
/// review evidence, including the implementation, the upgrade authority, and the pause authority.
struct SettlementAssetDefinition {
    AssetId assetId;
    address token;
    bytes32 expectedRuntimeCodeHash;
    bytes32 qualificationHash;
}

/// @dev One immutable historical version of a chain-local binding. decimals is the canonical asset
/// decimals snapshot taken at registration and verified against the token at that moment, so a later
/// read never has to trust the token to report the same value again.
struct SettlementAssetBinding {
    SettlementAssetDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    uint8 decimals;
    RegistryStatus status;
}
