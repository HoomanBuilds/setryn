// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../../interfaces/IAdapterRegistry.sol";
import "./OperationalAdapterExecutor.sol";

// Shared definitions for OperationalAdapterExecutor and its linked logic libraries.

// The immutable dependency graph of OperationalAdapterExecutor, passed to linked libraries that execute in its context.
struct OperationalExecutorDependencies {
    IAdapterRegistry adapterRegistry;
    bytes32 deploymentId;
    uint64 readGasLimit;
    uint64 executionGasLimit;
}
