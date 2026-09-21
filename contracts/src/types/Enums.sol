// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

/// @dev AssetClass is classification metadata for discovery and presentation only. It must never
/// drive payoff, quote, settlement, or risk behavior, which must read explicit convention fields
/// instead. The classes overlap in practice, so branching on this enum is always a modeling error.
enum AssetClass {
    Unspecified,
    Crypto,
    Stablecoin,
    Fx,
    Commodity,
    Rate,
    Index,
    TokenizedAsset
}

enum Side {
    Unspecified,
    Buy,
    Sell
}

/// @dev RegistryStatus gates future qualification only. A paused or deprecated definition never
/// invalidates historical positions, unwind, fixing, or settlement, and a registry never deletes a
/// definition. Unspecified is the nonexistent sentinel, so it is never a reachable stored state.
///
/// @dev Ordinals are append-only. A later member may be added at the end, never reordered or
/// removed, because stored values and indexed event topics are compared against these numbers.
enum RegistryStatus {
    Unspecified,
    Active,
    Paused,
    Deprecated
}
