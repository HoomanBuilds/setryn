// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IExecutionPolicyRegistry} from "../interfaces/IExecutionPolicyRegistry.sol";
import {IFeeScheduleRegistry} from "../interfaces/IFeeScheduleRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ISettlementAssetRegistry} from "../interfaces/ISettlementAssetRegistry.sol";
import {ITradingSessionPolicy} from "../interfaces/ITradingSessionPolicy.sol";
import {PackageDefinitionLib} from "./PackageDefinitionLib.sol";
import {AssetId, FeeScheduleId, MarketId, PackageId, RiskDomainId, SeriesId, SessionId} from "../types/Identifiers.sol";
import {MarketDefinition, MarketVersion} from "../types/MarketDefinition.sol";
import {OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageDefinition, PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

library ExecutionPolicyLib {
    struct Dependencies {
        ISeriesRegistry seriesRegistry;
        IPackageRegistry packageRegistry;
        IMarketRegistry marketRegistry;
        IExecutionPolicyRegistry policyRegistry;
        ITradingSessionPolicy sessionPolicy;
    }

    struct ResolvedTarget {
        AssetId settlementAssetId;
        uint32 settlementAssetVersion;
        RiskDomainId riskDomainId;
        uint32 riskDomainVersion;
        FeeScheduleId feeScheduleId;
        uint32 feeScheduleVersion;
        bytes32 executionModeSetHash;
        SessionId sessionId;
        uint32 sessionVersion;
        bytes32 packageWitnessHash;
    }

    error InvalidPolicyDependency();
    error TargetNotOpen();
    error TargetDependencyMismatch();
    error UnsupportedExecutionMode(bytes32 executionModeId);
    error InvalidPackageWitness();
    error InvalidMarketOrder();

    function validateTarget(
        Dependencies memory dependencies,
        OrderTargetKind targetKind,
        SeriesId seriesId,
        PackageId packageId,
        uint32 targetVersion,
        PackageLeg[] memory packageLegs,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        bytes32 executionModeId,
        Lots lots,
        PriceTicks priceTicks,
        bool validatePrice
    ) internal view returns (ResolvedTarget memory resolved) {
        _requireDependencies(dependencies);
        if (targetKind == OrderTargetKind.Series) {
            if (packageLegs.length != 0 || PackageId.unwrap(packageId) != bytes32(0)) {
                revert TargetDependencyMismatch();
            }
            SeriesVersion memory series = dependencies.seriesRegistry.getSeries(seriesId, targetVersion);
            if (!dependencies.seriesRegistry.isOpenForNewRisk(seriesId, targetVersion, _currentDay())) {
                revert TargetNotOpen();
            }
            resolved = _validateMarket(
                dependencies,
                series.definition.marketId,
                series.definition.marketVersion,
                feeScheduleId,
                feeScheduleVersion,
                executionModeId
            );
            _validateMarketOrder(
                dependencies.marketRegistry
                .getMarket(series.definition.marketId, series.definition.marketVersion)
                .definition,
                lots,
                priceTicks,
                validatePrice
            );
            return resolved;
        }
        if (targetKind != OrderTargetKind.Package || SeriesId.unwrap(seriesId) != bytes32(0)) {
            revert TargetDependencyMismatch();
        }
        PackageVersion memory package = dependencies.packageRegistry.getPackage(packageId, targetVersion);
        bytes32 legsHash = dependencies.packageRegistry.hashLegs(packageLegs);
        if (
            packageLegs.length == 0 || legsHash != package.definition.legsHash
                || !dependencies.packageRegistry.isOpenForNewRisk(packageId, targetVersion, packageLegs, _currentDay())
        ) revert InvalidPackageWitness();
        if (validatePrice) PackageDefinitionLib.validateOrder(package.definition, lots, priceTicks);
        else _validatePackageLots(package.definition, lots);
        for (uint256 i; i < packageLegs.length; ++i) {
            PackageLeg memory leg = packageLegs[i];
            SeriesVersion memory series = dependencies.seriesRegistry.getSeries(leg.seriesId, leg.seriesVersion);
            if (!dependencies.seriesRegistry.isOpenForNewRisk(leg.seriesId, leg.seriesVersion, _currentDay())) {
                revert TargetNotOpen();
            }
            ResolvedTarget memory legResolved = _validateMarket(
                dependencies,
                series.definition.marketId,
                series.definition.marketVersion,
                feeScheduleId,
                feeScheduleVersion,
                executionModeId
            );
            if (i == 0) resolved = legResolved;
            else _requireSamePolicy(resolved, legResolved);
        }
        if (
            resolved.settlementAssetId != package.definition.settlementAssetId
                || resolved.settlementAssetVersion != package.definition.settlementAssetVersion
        ) revert TargetDependencyMismatch();
        resolved.packageWitnessHash = legsHash;
    }

    function _validateMarket(
        Dependencies memory dependencies,
        MarketId marketId,
        uint32 marketVersion,
        FeeScheduleId feeScheduleId,
        uint32 feeScheduleVersion,
        bytes32 executionModeId
    ) private view returns (ResolvedTarget memory resolved) {
        if (!dependencies.marketRegistry.isOpenForNewRisk(marketId, marketVersion, _currentDay())) {
            revert TargetNotOpen();
        }
        MarketVersion memory market = dependencies.marketRegistry.getMarket(marketId, marketVersion);
        MarketDefinition memory definition = market.definition;
        if (
            definition.feeScheduleId != feeScheduleId || definition.feeScheduleVersion != feeScheduleVersion
                || !dependencies.policyRegistry.executionModeAllowed(definition.executionModeSetHash, executionModeId)
        ) {
            if (definition.feeScheduleId == feeScheduleId && definition.feeScheduleVersion == feeScheduleVersion) {
                revert UnsupportedExecutionMode(executionModeId);
            }
            revert TargetDependencyMismatch();
        }
        if (!dependencies.sessionPolicy
                .isOpenForNewRisk(
                    definition.tradingSessionId, definition.tradingSessionVersion, uint64(block.timestamp)
                )) revert TargetNotOpen();
        ISettlementAssetRegistry settlementAssets = dependencies.marketRegistry.settlementAssetRegistry();
        IRiskDomainRegistry riskDomains = dependencies.marketRegistry.riskDomainRegistry();
        IFeeScheduleRegistry feeSchedules = dependencies.marketRegistry.feeScheduleRegistry();
        if (
            !settlementAssets.isOpenForNewRisk(definition.settlementAssetId, definition.settlementAssetVersion)
                || !riskDomains.isOpenForNewRisk(definition.riskDomainId, definition.riskDomainVersion)
                || !feeSchedules.isOpenForNewRisk(definition.feeScheduleId, definition.feeScheduleVersion)
        ) revert TargetNotOpen();
        resolved = ResolvedTarget({
            settlementAssetId: definition.settlementAssetId,
            settlementAssetVersion: definition.settlementAssetVersion,
            riskDomainId: definition.riskDomainId,
            riskDomainVersion: definition.riskDomainVersion,
            feeScheduleId: definition.feeScheduleId,
            feeScheduleVersion: definition.feeScheduleVersion,
            executionModeSetHash: definition.executionModeSetHash,
            sessionId: definition.tradingSessionId,
            sessionVersion: definition.tradingSessionVersion,
            packageWitnessHash: bytes32(0)
        });
    }

    function _requireSamePolicy(ResolvedTarget memory left, ResolvedTarget memory right) private pure {
        if (
            left.settlementAssetId != right.settlementAssetId
                || left.settlementAssetVersion != right.settlementAssetVersion
                || left.riskDomainId != right.riskDomainId || left.riskDomainVersion != right.riskDomainVersion
                || left.feeScheduleId != right.feeScheduleId || left.feeScheduleVersion != right.feeScheduleVersion
        ) revert TargetDependencyMismatch();
    }

    function _validateMarketOrder(
        MarketDefinition memory definition,
        Lots lots,
        PriceTicks priceTicks,
        bool validatePrice
    ) private pure {
        uint128 amount = Lots.unwrap(lots);
        uint128 step = Lots.unwrap(definition.lotStep);
        int128 price = PriceTicks.unwrap(priceTicks);
        if (
            step == 0 || amount < Lots.unwrap(definition.minOrderLots) || amount > Lots.unwrap(definition.maxOrderLots)
                || amount % step != 0 || validatePrice && price < PriceTicks.unwrap(definition.minPriceTicks)
                || validatePrice && price > PriceTicks.unwrap(definition.maxPriceTicks)
        ) revert InvalidMarketOrder();
    }

    function _validatePackageLots(PackageDefinition memory definition, Lots lots) private pure {
        uint128 amount = Lots.unwrap(lots);
        uint128 step = Lots.unwrap(definition.lotStep);
        if (
            step == 0 || amount < Lots.unwrap(definition.minOrderLots) || amount > Lots.unwrap(definition.maxOrderLots)
                || amount % step != 0
        ) revert InvalidMarketOrder();
    }

    function _requireDependencies(Dependencies memory dependencies) private view {
        if (
            address(dependencies.seriesRegistry) == address(0) || address(dependencies.packageRegistry) == address(0)
                || address(dependencies.marketRegistry) == address(0)
                || address(dependencies.policyRegistry) == address(0)
                || address(dependencies.sessionPolicy) == address(0)
        ) revert InvalidPolicyDependency();
    }

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }
}
