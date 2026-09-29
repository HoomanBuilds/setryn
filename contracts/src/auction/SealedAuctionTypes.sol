// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAuctionValidationGate} from "../interfaces/IAuctionValidationGate.sol";
import {IAuctionVault} from "../interfaces/IAuctionVault.sol";

// Shared definitions for SealedAuctionHouse and its linked logic libraries.

// The immutable dependency graph of SealedAuctionHouse, passed to linked libraries that execute in its context.
struct SealedAuctionDependencies {
    IAuctionVault auctionVault;
    IAuctionValidationGate validationGate;
    address clearingEngine;
}
