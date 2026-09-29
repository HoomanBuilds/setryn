// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";

// Shared definitions for SeriesRegistry and its linked logic libraries.

// The immutable dependency graph of SeriesRegistry, passed to linked libraries that execute in its context.
struct SeriesRegistryDependencies {
    IMarketRegistry marketRegistry;
    IInstrumentRegistry instrumentRegistry;
}
