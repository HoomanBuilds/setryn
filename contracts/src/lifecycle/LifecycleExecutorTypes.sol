// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {AccountId, CollateralId, RiskDomainId} from "../types/Identifiers.sol";
import "./PositionLifecycleExecutor.sol";

// Shared definitions for PositionLifecycleExecutor and its linked logic libraries.

// The immutable dependency graph of PositionLifecycleExecutor, passed to linked libraries that execute in its context.
struct LifecycleExecutorDependencies {
    IPositionEngine positionEngine;
    ICollateralVault collateralVault;
    IPortfolioRiskEngine portfolioRiskEngine;
}

struct BackingTarget {
    bytes32 liabilityKey;
    AccountId payerAccountId;
    CollateralId collateralId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint64 settlementDeadline;
    uint64 finalResolutionAt;
    uint128 amount;
}
