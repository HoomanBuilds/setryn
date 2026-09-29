// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICapacityReservationRegistry} from "../interfaces/ICapacityReservationRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPrivateRfqBook} from "../interfaces/IPrivateRfqBook.sol";
import {IPublicOrderBook} from "../interfaces/IPublicOrderBook.sol";
import {ISealedAuctionHouse} from "../interfaces/ISealedAuctionHouse.sol";
import {ISessionRegistry} from "../interfaces/ISessionRegistry.sol";
import {IStreamingQuoteEngine} from "../interfaces/IStreamingQuoteEngine.sol";
import "./ProtocolRouteLiquiditySource.sol";

// Shared definitions for ProtocolRouteLiquiditySource and its linked logic libraries.

// The immutable dependency graph of ProtocolRouteLiquiditySource, passed to linked libraries that execute in its context.
struct RouteLiquidityDependencies {
    IPublicOrderBook publicOrderBook;
    IPackageRegistry packageRegistry;
    IPrivateRfqBook privateRfqBook;
    IStreamingQuoteEngine streamingQuoteEngine;
    ISealedAuctionHouse sealedAuctionHouse;
    ICollateralVault collateralVault;
    ISessionRegistry sessionRegistry;
    ICapacityReservationRegistry reservationRegistry;
}
