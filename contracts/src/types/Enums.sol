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
