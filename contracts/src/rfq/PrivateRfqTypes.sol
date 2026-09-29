// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IFirmCapacityVault} from "../interfaces/IFirmCapacityVault.sol";
import {IPrivateRfqValidationGate} from "../interfaces/IPrivateRfqValidationGate.sol";

// Shared definitions for PrivateRfqBook and its linked logic libraries.

// The immutable dependency graph of PrivateRfqBook, passed to linked libraries that execute in its context.
struct PrivateRfqDependencies {
    IFirmCapacityVault collateralVault;
    IPrivateRfqValidationGate validationGate;
    address clearingEngine;
    uint64 maximumCapacityTail;
}
