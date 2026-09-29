// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import "./GmxV2OrderAdapter.sol";

// Shared definitions for GmxV2OrderAdapter and its linked logic libraries.

// The immutable dependency graph of GmxV2OrderAdapter, passed to linked libraries that execute in its context.
struct GmxV2OrderDependencies {
    uint256 expectedChainId;
    IGmxV2ExchangeRouter exchangeRouter;
    address tokenTransferRouter;
    address orderVault;
    address orderHandler;
    IGmxV2DataStore dataStore;
    IGmxV2Reader reader;
    address wnt;
    address executor;
    uint256 callbackGasLimit;
}
