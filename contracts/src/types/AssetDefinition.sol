// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AssetClass} from "./Enums.sol";

/// @dev An asset definition carries only chain-portable facts, so one canonical asset keeps one
/// identity across every deployment. Token address, chainId, oracle wiring, deliverability,
/// settlement behavior, metadata URI, and adapter binding are deployment-specific qualification
/// concerns and belong to later registries, never to this definition.
///
/// @dev Identity is the namespaceId plus referenceId pair alone. symbol, assetClass, and decimals
/// are display and accounting fields that must never be able to split one namespaced asset into two
/// competing identities.
///
/// @dev decimals is stored semantics only. This type imposes no cap; any arithmetic module that
/// consumes it must enforce its own safe bounds.
struct AssetDefinition {
    bytes32 namespaceId;
    bytes32 referenceId;
    bytes32 symbol;
    AssetClass assetClass;
    uint8 decimals;
}
