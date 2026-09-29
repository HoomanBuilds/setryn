// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {NotionalLib} from "../libraries/NotionalLib.sol";
import {PackageDefinitionLib} from "../libraries/PackageDefinitionLib.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {ClearingHandoffClaim} from "../types/ClearingHandoffTypes.sol";
import {BilateralMatch, ClearingChannelKind, FillRecord, PackageClearingRequest} from "../types/ClearingTypes.sol";
import {AccountId, FillId, PackageId, PositionId} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {OrderRecord, OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageDefinition, PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";
import {PositionCreation, PositionEconomics} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

import {
    ClearingDependencies,
    FeeContext,
    MatchContext,
    PackagePositionResult,
    SettlementContext
} from "./AtomicClearingTypes.sol";
import {AtomicClearingFundingLib} from "./AtomicClearingFundingLib.sol";
import {AtomicClearingMatchLib} from "./AtomicClearingMatchLib.sol";
import {AtomicClearingPositionLib} from "./AtomicClearingPositionLib.sol";

/// Linked logic for clearing one bilateral package match. Runs through DELEGATECALL in the engine's context.
library AtomicClearingPackageLib {
    function clearPackage(
        ClearingDependencies memory deps,
        mapping(FillId fillId => FillRecord record) storage fills,
        mapping(FillId fillId => PositionId[] positionIds) storage fillPositions,
        mapping(ClearingChannelKind channelKind => IClearingChannelHandoffAdapter adapter) storage channelAdapters,
        PackageClearingRequest calldata request,
        ClearingHandoffClaim memory channelClaim,
        address channelSource
    ) external returns (FillId fillId) {
        BilateralMatch calldata matchData = request.matchData;
        OrderRecord memory taker = deps.orderState.getOrder(matchData.takerOrderHash);
        OrderRecord memory maker = deps.orderState.getOrder(matchData.makerOrderHash);
        if (taker.order.targetKind != OrderTargetKind.Package || maker.order.targetKind != OrderTargetKind.Package) {
            revert IAtomicClearingEngine.OrderTargetMismatch();
        }
        bytes32 legsHash = deps.packageRegistry.hashLegs(request.legs);
        bytes32 witnessHash = keccak256(abi.encode(legsHash, request.legEntryPriceTicks, request.legPayoffTerms));
        MatchContext memory context =
            AtomicClearingMatchLib.prepareMatch(deps, fills, matchData, taker, maker, witnessHash, true);
        PackageId packageId = taker.order.packageId;
        uint32 packageVersion = taker.order.targetVersion;
        if (!deps.packageRegistry
                .isOpenForNewRisk(packageId, packageVersion, request.legs, AtomicClearingPositionLib.currentDay())) {
            revert IAtomicClearingEngine.InvalidPackageWitness();
        }
        PackageVersion memory packageRecord = deps.packageRegistry.getPackage(packageId, packageVersion);
        PackageDefinition memory definition = packageRecord.definition;
        if (
            legsHash != definition.legsHash || request.legs.length != request.legEntryPriceTicks.length
                || request.legs.length != request.legPayoffTerms.length
        ) revert IAtomicClearingEngine.InvalidPackageWitness();
        PackageDefinitionLib.validateOrder(definition, matchData.fillLots, matchData.executionPriceTicks);
        _validatePackageLegPrices(
            deps,
            definition,
            request.legs,
            request.legEntryPriceTicks,
            matchData.fillLots,
            matchData.executionPriceTicks
        );

        SettlementContext memory settlement = SettlementContext({
            assetId: definition.settlementAssetId,
            bindingVersion: definition.settlementAssetVersion,
            considerationMinor: PackageDefinitionLib.compileFillNotional(
                definition, matchData.fillLots, matchData.executionPriceTicks
            ),
            longLiabilityMinor: PositionMathLib.checkedAmount(
                definition.maxLongDebitMinorPerPackageLot, matchData.fillLots
            ),
            shortLiabilityMinor: PositionMathLib.checkedAmount(
                definition.maxShortDebitMinorPerPackageLot, matchData.fillLots
            )
        });
        AtomicClearingMatchLib.consumeMatch(deps, context, matchData, settlement, uint16(request.legs.length));
        AtomicClearingMatchLib.validateChannelMatch(
            deps, context, matchData, request.channelKind, channelClaim, legsHash
        );
        AtomicClearingFundingLib.applyFunding(deps, context, matchData, settlement, request.channelKind, channelClaim);
        FeeContext memory fees =
            AtomicClearingFundingLib.consumeFees(deps, context, matchData, settlement, request.channelKind);

        PackagePositionResult memory positions =
            _createPackagePositions(deps, fillPositions, request, channelClaim, context);
        if (
            positions.buyerLiabilityCreated != settlement.longLiabilityMinor
                || positions.sellerLiabilityCreated != settlement.shortLiabilityMinor
        ) {
            revert IAtomicClearingEngine.PositionCreationMismatch(
                settlement.longLiabilityMinor, positions.buyerLiabilityCreated
            );
        }
        AtomicClearingMatchLib.bindRiskExposures(
            deps, matchData, FillId.unwrap(context.fillId), positions.exposurePositions
        );
        AtomicClearingMatchLib.recordFill(
            fills,
            fillPositions,
            channelAdapters,
            context,
            matchData,
            witnessHash,
            settlement,
            fees,
            uint16(request.legs.length),
            true,
            request.channelKind,
            channelClaim,
            channelSource
        );
        return context.fillId;
    }

    function _createPackagePositions(
        ClearingDependencies memory deps,
        mapping(FillId fillId => PositionId[] positionIds) storage fillPositions,
        PackageClearingRequest calldata request,
        ClearingHandoffClaim memory channelClaim,
        MatchContext memory context
    ) internal returns (PackagePositionResult memory result) {
        uint256 legCount = request.legs.length;
        result.exposurePositions = new PositionId[](legCount);
        for (uint256 i; i < legCount; ++i) {
            (PositionId positionId, uint128 buyerLiability, uint128 sellerLiability) =
                _createPackagePosition(deps, fillPositions, request, channelClaim, context, i);
            result.exposurePositions[i] = positionId;
            result.buyerLiabilityCreated += buyerLiability;
            result.sellerLiabilityCreated += sellerLiability;
        }
    }

    function _createPackagePosition(
        ClearingDependencies memory deps,
        mapping(FillId fillId => PositionId[] positionIds) storage fillPositions,
        PackageClearingRequest calldata request,
        ClearingHandoffClaim memory channelClaim,
        MatchContext memory context,
        uint256 index
    ) internal returns (PositionId positionId, uint128 buyerLiability, uint128 sellerLiability) {
        PackageLeg calldata leg = request.legs[index];
        Lots legLots = PackageDefinitionLib.legLots(request.matchData.fillLots, leg.ratio);
        bool packageBuyerIsLong = leg.ratio > 0;
        AccountId longAccountId = packageBuyerIsLong ? context.buyerAccountId : context.sellerAccountId;
        AccountId shortAccountId = packageBuyerIsLong ? context.sellerAccountId : context.buyerAccountId;
        SeriesVersion memory legSeries = deps.seriesRegistry.getSeries(leg.seriesId, leg.seriesVersion);
        uint128 createdLongAmount = PositionMathLib.checkedAmount(legSeries.definition.maxLongDebitMinorPerLot, legLots);
        uint128 createdShortAmount =
            PositionMathLib.checkedAmount(legSeries.definition.maxShortDebitMinorPerLot, legLots);
        positionId = deps.positionEngine
            .createPosition(
                PositionCreation({
                    fillIdentity: FillId.unwrap(context.fillId),
                    seriesId: leg.seriesId,
                    seriesVersion: leg.seriesVersion,
                    longAccountId: longAccountId,
                    shortAccountId: shortAccountId,
                    ordinal: uint32(index),
                    lots: legLots,
                    entryPriceTicks: request.legEntryPriceTicks[index],
                    longFunding: AtomicClearingPositionLib.positionFunding(
                        channelClaim, uint32(index), true, longAccountId, createdLongAmount
                    ),
                    shortFunding: AtomicClearingPositionLib.positionFunding(
                        channelClaim, uint32(index), false, shortAccountId, createdShortAmount
                    ),
                    payoffTerms: request.legPayoffTerms[index]
                })
            );
        PositionEconomics memory created =
            AtomicClearingPositionLib.verifyPosition(deps, positionId, context.fillId, uint32(index));
        AtomicClearingPositionLib.verifyAdoptedReservation(channelClaim, uint32(index), true, created.longReservationId);
        AtomicClearingPositionLib.verifyAdoptedReservation(
            channelClaim, uint32(index), false, created.shortReservationId
        );
        AtomicClearingPositionLib.recordPosition(
            fillPositions,
            context.fillId,
            positionId,
            leg.seriesId,
            leg.seriesVersion,
            uint16(index),
            leg.ratio,
            legLots,
            request.legEntryPriceTicks[index],
            created.longReservationId,
            created.shortReservationId
        );
        buyerLiability = packageBuyerIsLong ? created.maxLongDebitMinor : created.maxShortDebitMinor;
        sellerLiability = packageBuyerIsLong ? created.maxShortDebitMinor : created.maxLongDebitMinor;
    }

    function _validatePackageLegPrices(
        ClearingDependencies memory deps,
        PackageDefinition memory definition,
        PackageLeg[] calldata legs,
        PriceTicks[] calldata legPrices,
        Lots packageLots,
        PriceTicks packagePrice
    ) internal view {
        int256 actual;
        for (uint256 i; i < legs.length; ++i) {
            SeriesVersion memory series = deps.seriesRegistry.getSeries(legs[i].seriesId, legs[i].seriesVersion);
            MarketVersion memory market =
                deps.marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
            Lots ratioLots = Lots.wrap(uint128(PackageDefinitionLib.ratioMagnitude(legs[i].ratio)));
            int256 legValue = NotionalLib.fillNotional(ratioLots, legPrices[i], market.definition.tickSizeMinor);
            actual += legs[i].ratio > 0 ? legValue : -legValue;
            AtomicClearingPositionLib.validateMarketOrder(
                market, PackageDefinitionLib.legLots(packageLots, legs[i].ratio), legPrices[i]
            );
        }
        int256 expected = NotionalLib.fillNotional(Lots.wrap(1), packagePrice, definition.tickSizeMinor);
        if (actual != expected) revert IAtomicClearingEngine.PackageLegPriceMismatch(expected, actual);
    }
}
