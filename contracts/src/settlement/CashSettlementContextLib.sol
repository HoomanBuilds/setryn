// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICashSettlementCoordinator} from "../interfaces/ICashSettlementCoordinator.sol";
import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {InstrumentDefinitionLib} from "../libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../libraries/MarketDefinitionLib.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {FixingResolutionKind, FixingResult, FixingStatus} from "../types/FixingTypes.sol";
import {
    AdapterId,
    AssetId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PositionId,
    RiskDomainId,
    SeriesId
} from "../types/Identifiers.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../types/PositionTypes.sol";
import {CanonicalFixing} from "../types/PayoffTypes.sol";
import {CanonicalSettlementFixing} from "../types/SettlementTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {FixingSlot} from "../types/SeriesQualification.sol";

import {CashSettlementDependencies, PositionContext} from "./CashSettlementTypes.sol";

/// Linked logic for the cash settlement coordinator: position context loading and fixing collection.
/// Runs through DELEGATECALL in the coordinator's context.
library CashSettlementContextLib {
    function loadContext(
        CashSettlementDependencies memory deps,
        PositionId positionId,
        FixingSlot[] memory fixingSlots,
        bool requireFixingWitness
    ) external view returns (PositionContext memory context) {
        if (deps.positionEngine.positionStatus(positionId) == PositionStatus.Unspecified) {
            revert ICashSettlementCoordinator.UnknownPosition(positionId);
        }
        (context.economics, context.lifecycle) = deps.positionEngine.getPosition(positionId);
        if (PositionId.unwrap(context.economics.positionId) != PositionId.unwrap(positionId)) {
            revert ICashSettlementCoordinator.PositionRecordMismatch(positionId);
        }
        if (!deps.seriesRegistry.isLifecycleEnabled(context.economics.seriesId, context.economics.seriesVersion)) {
            revert ICashSettlementCoordinator.SeriesRecordMismatch();
        }
        context.series = deps.seriesRegistry.getSeries(context.economics.seriesId, context.economics.seriesVersion);
        bytes32 seriesDefinitionHash = SeriesDefinitionLib.hashDefinition(context.series.definition, block.chainid);
        if (
            context.series.version != context.economics.seriesVersion
                || context.series.definitionHash != seriesDefinitionHash
                || SeriesId.unwrap(SeriesDefinitionLib.deriveSeriesId(context.series.definition))
                    != SeriesId.unwrap(context.economics.seriesId)
                || context.series.versionHash != context.economics.seriesVersionHash
                || context.series.versionHash
                    != SeriesDefinitionLib.hashVersion(
                        context.economics.seriesId, context.economics.seriesVersion, seriesDefinitionHash, block.chainid
                    )
        ) revert ICashSettlementCoordinator.SeriesRecordMismatch();

        IMarketRegistry markets = deps.seriesRegistry.marketRegistry();
        if (!markets.isLifecycleEnabled(context.economics.marketId, context.economics.marketVersion)) {
            revert ICashSettlementCoordinator.MarketRecordMismatch();
        }
        context.market = markets.getMarket(context.economics.marketId, context.economics.marketVersion);
        bytes32 marketDefinitionHash = MarketDefinitionLib.hashDefinition(context.market.definition, block.chainid);
        if (
            context.market.version != context.economics.marketVersion
                || context.market.definitionHash != marketDefinitionHash
                || MarketId.unwrap(MarketDefinitionLib.deriveMarketId(context.market.definition))
                    != MarketId.unwrap(context.economics.marketId)
                || context.market.versionHash
                    != MarketDefinitionLib.hashVersion(
                        context.economics.marketId, context.economics.marketVersion, marketDefinitionHash, block.chainid
                    )
                || AssetId.unwrap(context.market.definition.settlementAssetId)
                    != AssetId.unwrap(context.economics.settlementAssetId)
                || context.market.definition.settlementAssetVersion != context.economics.settlementAssetVersion
                || RiskDomainId.unwrap(context.market.definition.riskDomainId)
                    != RiskDomainId.unwrap(context.economics.riskDomainId)
                || context.market.definition.riskDomainVersion != context.economics.riskDomainVersion
                || FeeScheduleId.unwrap(context.market.definition.feeScheduleId)
                    != FeeScheduleId.unwrap(context.economics.feeScheduleId)
                || context.market.definition.feeScheduleVersion != context.economics.feeScheduleVersion
        ) revert ICashSettlementCoordinator.MarketRecordMismatch();

        IInstrumentRegistry instruments = deps.seriesRegistry.instrumentRegistry();
        if (!instruments.isLifecycleEnabled(context.economics.instrumentId, context.economics.instrumentVersion)) {
            revert ICashSettlementCoordinator.InstrumentRecordMismatch();
        }
        context.instrument =
            instruments.getInstrument(context.economics.instrumentId, context.economics.instrumentVersion);
        bytes32 instrumentDefinitionHash =
            InstrumentDefinitionLib.hashDefinition(context.instrument.definition, block.chainid);
        if (
            context.instrument.version != context.economics.instrumentVersion
                || context.instrument.definitionHash != instrumentDefinitionHash
                || InstrumentId.unwrap(InstrumentDefinitionLib.deriveInstrumentId(context.instrument.definition))
                    != InstrumentId.unwrap(context.economics.instrumentId)
                || context.instrument.versionHash
                    != InstrumentDefinitionLib.hashVersion(
                        context.economics.instrumentId,
                        context.economics.instrumentVersion,
                        instrumentDefinitionHash,
                        block.chainid
                    )
                || AdapterId.unwrap(context.instrument.definition.payoffModuleId)
                    != AdapterId.unwrap(context.economics.payoffModuleId)
                || context.instrument.definition.payoffModuleVersion != context.economics.payoffModuleVersion
                || context.instrument.definition.maxEvaluationGas != context.economics.maxEvaluationGas
        ) revert ICashSettlementCoordinator.InstrumentRecordMismatch();

        context.payoffTerms = deps.positionEngine.payoffTerms(positionId);
        bytes32 payoffTermsHash =
            deps.seriesRegistry.hashPayoffTerms(context.instrument.definition.termsSchemaHash, context.payoffTerms);
        if (
            payoffTermsHash != context.economics.payoffTermsHash
                || payoffTermsHash != context.series.definition.payoffTermsHash
        ) {
            revert ICashSettlementCoordinator.PayoffTermsMismatch(
                context.series.definition.payoffTermsHash, payoffTermsHash
            );
        }
        _requireEconomicMatch(context.economics, context.series);

        if (requireFixingWitness) {
            uint256 count = fixingSlots.length;
            if (count == 0) revert ICashSettlementCoordinator.EmptyFixingSlots();
            if (count > context.instrument.definition.maxFixingSlots) {
                revert ICashSettlementCoordinator.TooManyFixingSlots(
                    count, context.instrument.definition.maxFixingSlots
                );
            }
            bytes32 slotsHash = deps.seriesRegistry
                .hashFixingSlots(context.series.definition, fixingSlots, context.instrument.definition.maxFixingSlots);
            if (
                slotsHash != context.economics.fixingSlotsHash || slotsHash != context.series.definition.fixingSlotsHash
            ) {
                revert ICashSettlementCoordinator.FixingSlotsMismatch(
                    context.series.definition.fixingSlotsHash, slotsHash
                );
            }
            for (uint256 i; i < count; ++i) {
                if (fixingSlots[i].slot != i) {
                    revert ICashSettlementCoordinator.FixingSlotOrderMismatch(i, fixingSlots[i].slot);
                }
            }
        }
    }

    function _requireEconomicMatch(PositionEconomics memory economics, SeriesVersion memory series) internal pure {
        if (
            MarketId.unwrap(series.definition.marketId) != MarketId.unwrap(economics.marketId)
                || series.definition.marketVersion != economics.marketVersion
                || InstrumentId.unwrap(series.definition.instrumentId) != InstrumentId.unwrap(economics.instrumentId)
                || series.definition.instrumentVersion != economics.instrumentVersion
                || series.definition.fixingWindowOpen != economics.fixingWindowOpen
                || series.definition.finalResolutionAt != economics.finalResolutionAt
                || series.definition.settlementDeadline != economics.settlementDeadline
                || series.definition.maxLongDebitMinorPerLot != economics.maxLongDebitMinorPerLot
                || series.definition.maxShortDebitMinorPerLot != economics.maxShortDebitMinorPerLot
                || series.definition.terminalDisruptionTransferMinorPerLot
                    != economics.terminalDisruptionTransferMinorPerLot
                || PositionMathLib.checkedAmount(series.definition.maxLongDebitMinorPerLot, economics.lots)
                    != economics.maxLongDebitMinor
                || PositionMathLib.checkedAmount(series.definition.maxShortDebitMinorPerLot, economics.lots)
                    != economics.maxShortDebitMinor
        ) revert ICashSettlementCoordinator.PositionRecordMismatch(economics.positionId);
    }

    function collectNormalFixings(
        CashSettlementDependencies memory deps,
        PositionEconomics memory economics,
        FixingSlot[] calldata fixingSlots
    ) external returns (CanonicalSettlementFixing[] memory fixings) {
        fixings = new CanonicalSettlementFixing[](fixingSlots.length);
        bool requiresFinalization;
        for (uint256 i; i < fixingSlots.length; ++i) {
            FixingStatus status = deps.fixingEngine.fixingStatus(economics.seriesId, economics.seriesVersion, uint8(i));
            if (status == FixingStatus.Proposed) {
                requiresFinalization = true;
            } else if (status != FixingStatus.Finalized) {
                revert ICashSettlementCoordinator.FixingNotFinalized(uint8(i));
            }
        }
        if (requiresFinalization) {
            deps.fixingEngine.finalizeFixingVector(economics.seriesId, economics.seriesVersion, fixingSlots);
        }
        for (uint256 i; i < fixingSlots.length; ++i) {
            FixingResult memory result =
                deps.fixingEngine.getFinalizedFixing(economics.seriesId, economics.seriesVersion, uint8(i));
            if (
                result.resultHash == bytes32(0)
                    || (result.resolutionKind != FixingResolutionKind.PrimaryFinal
                        && result.resolutionKind != FixingResolutionKind.FallbackFinal)
            ) revert ICashSettlementCoordinator.InvalidNormalFixingResolution(uint8(i), uint8(result.resolutionKind));
            fixings[i] = _canonicalFixing(deps, economics, uint8(i), result);
        }
    }

    function collectDisruptionFixings(
        CashSettlementDependencies memory deps,
        PositionEconomics memory economics,
        FixingSlot[] calldata fixingSlots
    ) external returns (CanonicalSettlementFixing[] memory fixings) {
        fixings = new CanonicalSettlementFixing[](fixingSlots.length);
        bool requiresFallback;
        for (uint256 i; i < fixingSlots.length; ++i) {
            FixingStatus status = deps.fixingEngine.fixingStatus(economics.seriesId, economics.seriesVersion, uint8(i));
            if (status != FixingStatus.Finalized) requiresFallback = true;
        }
        if (requiresFallback) {
            deps.fixingEngine.applyTerminalFallbackVector(economics.seriesId, economics.seriesVersion, fixingSlots);
        }
        for (uint256 i; i < fixingSlots.length; ++i) {
            FixingResult memory result =
                deps.fixingEngine.getFinalizedFixing(economics.seriesId, economics.seriesVersion, uint8(i));
            if (result.resultHash == bytes32(0)) revert ICashSettlementCoordinator.InvalidDisruptionFixing(uint8(i));
            if (
                result.resolutionKind == FixingResolutionKind.TerminalDisruption
                    && result.terminalDisruptionTransferMinorPerLot != economics.terminalDisruptionTransferMinorPerLot
            ) revert ICashSettlementCoordinator.InvalidDisruptionFixing(uint8(i));
            fixings[i] = _canonicalFixing(deps, economics, uint8(i), result);
        }
    }

    function encodePayoffFixings(
        CashSettlementDependencies memory deps,
        PositionEconomics memory economics,
        FixingSlot[] calldata fixingSlots
    ) external view returns (bytes memory) {
        CanonicalFixing[] memory payoffFixings = new CanonicalFixing[](fixingSlots.length);
        for (uint256 i; i < fixingSlots.length; ++i) {
            FixingResult memory result =
                deps.fixingEngine.getFinalizedFixing(economics.seriesId, economics.seriesVersion, uint8(i));
            if (result.candidateIndex >= fixingSlots[i].candidates.length) {
                revert ICashSettlementCoordinator.FixingSlotsMismatch(bytes32(0), bytes32(0));
            }
            payoffFixings[i] = CanonicalFixing({
                slot: uint8(i),
                benchmarkId: fixingSlots[i].candidates[result.candidateIndex].benchmarkId,
                benchmarkVersion: fixingSlots[i].candidates[result.candidateIndex].benchmarkVersion,
                decimals: result.decimals,
                value: result.value
            });
        }
        return abi.encode(payoffFixings);
    }

    function _canonicalFixing(
        CashSettlementDependencies memory deps,
        PositionEconomics memory economics,
        uint8 slot,
        FixingResult memory result
    ) internal view returns (CanonicalSettlementFixing memory) {
        return CanonicalSettlementFixing({
            fixingKey: deps.fixingEngine.deriveFixingKey(economics.seriesId, economics.seriesVersion, slot),
            resultHash: result.resultHash,
            resolutionKind: result.resolutionKind,
            value: result.value,
            terminalDisruptionTransferMinorPerLot: result.terminalDisruptionTransferMinorPerLot,
            effectiveAt: result.effectiveAt,
            slot: slot,
            decimals: result.decimals
        });
    }

    /// Applies every normal transition the position can take now and returns its resulting lifecycle.
    /// Settled and Lapsed are terminal results to record. Live is returned only for a holder-election position whose
    /// final fixing this call accepted while its election window is still open; the caller records nothing then.
    function advanceNormalPosition(
        CashSettlementDependencies memory deps,
        PositionId positionId,
        PositionEconomics memory economics,
        PositionLifecycle memory lifecycle,
        bytes32 fixingsHash,
        bytes memory encodedFixings
    ) external returns (PositionLifecycle memory) {
        bool accepted;
        if (lifecycle.status == PositionStatus.Live && lifecycle.finalFixingReference == bytes32(0)) {
            deps.positionEngine.beginFixing(positionId);
            lifecycle.status = PositionStatus.Fixing;
        }
        if (lifecycle.status == PositionStatus.Fixing) {
            deps.positionEngine.acceptFinalFixing(positionId, fixingsHash, encodedFixings);
            (, lifecycle) = deps.positionEngine.getPosition(positionId);
            accepted = true;
        }
        PositionStatus status = lifecycle.status;
        if (
            status != PositionStatus.Live && status != PositionStatus.SettlementReady
                && status != PositionStatus.Settled && status != PositionStatus.Lapsed
        ) revert ICashSettlementCoordinator.InvalidPositionStatus(status);
        if (lifecycle.finalFixingReference != fixingsHash || lifecycle.finalFixingsHash != keccak256(encodedFixings)) {
            revert ICashSettlementCoordinator.ExistingPositionOutcomeMismatch();
        }
        if (status == PositionStatus.Live) {
            // Only holder election returns a position to Live with an accepted final fixing (or keeps it Live after a
            // partial exercise). Settlement waits for the holder until the inclusive cutoff, then unelected lots lapse.
            if (accepted) {
                emit ICashSettlementCoordinator.HolderElectionFixingAccepted(
                    positionId,
                    fixingsHash,
                    lifecycle.finalFixingsHash,
                    economics.exerciseOpensAt,
                    economics.exerciseCutoffAt,
                    msg.sender
                );
            }
            if (block.timestamp <= economics.exerciseCutoffAt) {
                if (!accepted) {
                    revert ICashSettlementCoordinator.HolderElectionPending(positionId, economics.exerciseCutoffAt);
                }
                return lifecycle;
            }
            deps.positionEngine.lapseUnelectedLots(positionId);
        } else if (status == PositionStatus.SettlementReady) {
            deps.positionEngine.settle(positionId);
        } else {
            return lifecycle;
        }
        (, lifecycle) = deps.positionEngine.getPosition(positionId);
        if (lifecycle.status != PositionStatus.Settled && lifecycle.status != PositionStatus.Lapsed) {
            revert ICashSettlementCoordinator.InvalidPositionStatus(lifecycle.status);
        }
        return lifecycle;
    }
}
