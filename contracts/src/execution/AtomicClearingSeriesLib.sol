// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {NotionalLib} from "../libraries/NotionalLib.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {ClearingHandoffClaim} from "../types/ClearingHandoffTypes.sol";
import {BilateralMatch, ClearingChannelKind, FillRecord, SeriesClearingRequest} from "../types/ClearingTypes.sol";
import {FeeScheduleId, FillId, PositionId, SeriesId} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {OrderRecord, OrderTargetKind} from "../types/OrderTypes.sol";
import {PositionCreation, PositionEconomics} from "../types/PositionTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";

import {ClearingDependencies, FeeContext, MatchContext, SettlementContext} from "./AtomicClearingTypes.sol";
import {AtomicClearingFundingLib} from "./AtomicClearingFundingLib.sol";
import {AtomicClearingMatchLib} from "./AtomicClearingMatchLib.sol";
import {AtomicClearingPositionLib} from "./AtomicClearingPositionLib.sol";

/// Linked logic for clearing one bilateral series match. Runs through DELEGATECALL in the engine's context.
library AtomicClearingSeriesLib {
    function clearSeries(
        ClearingDependencies memory deps,
        mapping(FillId fillId => FillRecord record) storage fills,
        mapping(FillId fillId => PositionId[] positionIds) storage fillPositions,
        mapping(ClearingChannelKind channelKind => IClearingChannelHandoffAdapter adapter) storage channelAdapters,
        SeriesClearingRequest calldata request,
        ClearingHandoffClaim memory channelClaim,
        address channelSource
    ) external returns (FillId fillId) {
        BilateralMatch calldata matchData = request.matchData;
        OrderRecord memory taker = deps.orderState.getOrder(matchData.takerOrderHash);
        OrderRecord memory maker = deps.orderState.getOrder(matchData.makerOrderHash);
        if (taker.order.targetKind != OrderTargetKind.Series || maker.order.targetKind != OrderTargetKind.Series) {
            revert IAtomicClearingEngine.OrderTargetMismatch();
        }
        bytes32 witnessHash = keccak256(request.payoffTerms);
        MatchContext memory context =
            AtomicClearingMatchLib.prepareMatch(deps, fills, matchData, taker, maker, witnessHash, false);

        SeriesId seriesId = taker.order.seriesId;
        uint32 seriesVersion = taker.order.targetVersion;
        if (!deps.seriesRegistry.isOpenForNewRisk(seriesId, seriesVersion, AtomicClearingPositionLib.currentDay())) {
            revert IAtomicClearingEngine.OrderTargetMismatch();
        }
        SeriesVersion memory series = deps.seriesRegistry.getSeries(seriesId, seriesVersion);
        MarketVersion memory market =
            deps.marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
        if (
            FeeScheduleId.unwrap(market.definition.feeScheduleId) != FeeScheduleId.unwrap(taker.order.feeScheduleId)
                || market.definition.feeScheduleVersion != taker.order.feeScheduleVersion
        ) revert IAtomicClearingEngine.FeeScheduleMismatch();
        AtomicClearingPositionLib.validateMarketOrder(market, matchData.fillLots, matchData.executionPriceTicks);

        SettlementContext memory settlement = SettlementContext({
            assetId: market.definition.settlementAssetId,
            bindingVersion: market.definition.settlementAssetVersion,
            considerationMinor: NotionalLib.fillNotional(
                matchData.fillLots, matchData.executionPriceTicks, market.definition.tickSizeMinor
            ),
            longLiabilityMinor: PositionMathLib.checkedAmount(
                series.definition.maxLongDebitMinorPerLot, matchData.fillLots
            ),
            shortLiabilityMinor: PositionMathLib.checkedAmount(
                series.definition.maxShortDebitMinorPerLot, matchData.fillLots
            )
        });

        AtomicClearingMatchLib.consumeMatch(deps, context, matchData, settlement, 1);
        AtomicClearingMatchLib.validateChannelMatch(
            deps, context, matchData, request.channelKind, channelClaim, bytes32(0)
        );
        AtomicClearingFundingLib.applyFunding(deps, context, matchData, settlement, request.channelKind, channelClaim);
        FeeContext memory fees =
            AtomicClearingFundingLib.consumeFees(deps, context, matchData, settlement, request.channelKind);

        PositionId positionId = deps.positionEngine
            .createPosition(
                PositionCreation({
                    fillIdentity: FillId.unwrap(context.fillId),
                    seriesId: seriesId,
                    seriesVersion: seriesVersion,
                    longAccountId: context.buyerAccountId,
                    shortAccountId: context.sellerAccountId,
                    ordinal: 0,
                    lots: matchData.fillLots,
                    entryPriceTicks: matchData.executionPriceTicks,
                    longFunding: AtomicClearingPositionLib.positionFunding(
                        channelClaim, 0, true, context.buyerAccountId, settlement.longLiabilityMinor
                    ),
                    shortFunding: AtomicClearingPositionLib.positionFunding(
                        channelClaim, 0, false, context.sellerAccountId, settlement.shortLiabilityMinor
                    ),
                    payoffTerms: request.payoffTerms
                })
            );
        PositionEconomics memory created = AtomicClearingPositionLib.verifyPosition(deps, positionId, context.fillId, 0);
        PositionId[] memory exposurePositions = new PositionId[](1);
        exposurePositions[0] = positionId;
        AtomicClearingMatchLib.bindRiskExposures(deps, matchData, FillId.unwrap(context.fillId), exposurePositions);
        AtomicClearingPositionLib.verifyAdoptedReservation(channelClaim, 0, true, created.longReservationId);
        AtomicClearingPositionLib.verifyAdoptedReservation(channelClaim, 0, false, created.shortReservationId);
        if (
            created.maxLongDebitMinor != settlement.longLiabilityMinor
                || created.maxShortDebitMinor != settlement.shortLiabilityMinor
        ) {
            revert IAtomicClearingEngine.PositionCreationMismatch(
                settlement.longLiabilityMinor, created.maxLongDebitMinor
            );
        }
        AtomicClearingPositionLib.recordPosition(
            fillPositions,
            context.fillId,
            positionId,
            seriesId,
            seriesVersion,
            0,
            1,
            matchData.fillLots,
            matchData.executionPriceTicks,
            created.longReservationId,
            created.shortReservationId
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
            1,
            false,
            request.channelKind,
            channelClaim,
            channelSource
        );
        return context.fillId;
    }
}
