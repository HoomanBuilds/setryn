// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IDefaultBidderGate} from "../interfaces/IDefaultBidderGate.sol";
import {IDefaultLifecycleExecutor} from "../interfaces/IDefaultLifecycleExecutor.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";

// Shared definitions for DefaultProcessEngine and its linked logic libraries.

// The immutable dependency graph of DefaultProcessEngine, passed to linked libraries that execute in its context.
struct DefaultProcessDependencies {
    IPortfolioRiskEngine portfolioRiskEngine;
    ICollateralVault collateralVault;
    IRiskDomainRegistry riskDomainRegistry;
    IDefaultBidderGate bidderGate;
    IDefaultLifecycleExecutor lifecycleExecutor;
}
