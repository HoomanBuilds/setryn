// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IFixingEngine} from "../interfaces/IFixingEngine.sol";
import {IFundedFeeEngine} from "../interfaces/IFundedFeeEngine.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {PositionEconomics, PositionLifecycle} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";

// Shared definitions for CashSettlementCoordinator and its linked logic libraries.

// The immutable dependency graph of CashSettlementCoordinator, passed to linked libraries that execute in its context.
struct CashSettlementDependencies {
    IPositionEngine positionEngine;
    IFixingEngine fixingEngine;
    IFundedFeeEngine fundedFeeEngine;
    ICollateralVault collateralVault;
    ISeriesRegistry seriesRegistry;
    IPortfolioRiskEngine portfolioRiskEngine;
}

struct PositionContext {
    PositionEconomics economics;
    PositionLifecycle lifecycle;
    SeriesVersion series;
    InstrumentVersion instrument;
    MarketVersion market;
    bytes payoffTerms;
}
