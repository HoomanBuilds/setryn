// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IClearingAdmissionGate} from "../interfaces/IClearingAdmissionGate.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IFundedFeeEngine} from "../interfaces/IFundedFeeEngine.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOrderState} from "../interfaces/IOrderState.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {AccountId, AssetId, FillId, PositionId} from "../types/Identifiers.sol";
import {FeeActionResult} from "../types/FeeEngineTypes.sol";
import {OrderRecord} from "../types/OrderTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

// Shared definitions for the atomic clearing engine and its linked logic libraries.

bytes32 constant CLEARING_TERMINAL_LIABILITY_PURPOSE = keccak256("SETRYN_FILL_TERMINAL_LIABILITY");
bytes32 constant CLEARING_CONSIDERATION_PURPOSE = keccak256("SETRYN_FILL_CONSIDERATION");
bytes32 constant CLEARING_DIRECT_CHANNEL_TYPEHASH =
    keccak256("SetrynDirectClearingChannelV1(bytes32 fillId,address submitter,bytes32 witnessHash)");
bytes32 constant CLEARING_ROUTE_COMMITMENT_TYPEHASH = keccak256(
    "SetrynClearingRouteV1(bytes32 fillId,bytes32 takerOrderHash,bytes32 makerOrderHash,bytes32 executionModeId,bytes32 witnessHash)"
);

// The engine's immutable dependency graph, passed to linked libraries that execute in the engine's context.
struct ClearingDependencies {
    IOrderState orderState;
    ISeriesRegistry seriesRegistry;
    IPackageRegistry packageRegistry;
    IPositionEngine positionEngine;
    ICollateralVault collateralVault;
    IMarketRegistry marketRegistry;
    IClearingAdmissionGate admissionGate;
    IFundedFeeEngine fundedFeeEngine;
    IPortfolioRiskEngine riskEngine;
}

struct MatchContext {
    OrderRecord taker;
    OrderRecord maker;
    bytes32 takerOrderHash;
    bytes32 makerOrderHash;
    FillId fillId;
    Lots takerCumulativeLots;
    Lots makerCumulativeLots;
    Lots fillLots;
    PriceTicks executionPriceTicks;
    AccountId buyerAccountId;
    AccountId sellerAccountId;
    bool takerIsBuyer;
}

struct SettlementContext {
    AssetId assetId;
    uint32 bindingVersion;
    int256 considerationMinor;
    uint128 longLiabilityMinor;
    uint128 shortLiabilityMinor;
}

struct FeeContext {
    FeeActionResult maker;
    FeeActionResult taker;
}

struct PackagePositionResult {
    PositionId[] exposurePositions;
    uint256 buyerLiabilityCreated;
    uint256 sellerLiabilityCreated;
}
