// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICashSettlementCoordinator} from "../interfaces/ICashSettlementCoordinator.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IFixingEngine} from "../interfaces/IFixingEngine.sol";
import {IFundedFeeEngine} from "../interfaces/IFundedFeeEngine.sol";
import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {PositionTerminalState} from "../interfaces/IPositionEngineTerminalState.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {FeeEngineLib} from "../libraries/FeeEngineLib.sol";
import {FeeScheduleDefinitionLib} from "../libraries/FeeScheduleDefinitionLib.sol";
import {InstrumentDefinitionLib} from "../libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../libraries/MarketDefinitionLib.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {SettlementLib} from "../libraries/SettlementLib.sol";
import {TerminalClaim, TerminalLiabilityReservation} from "../types/CollateralTypes.sol";
import {TerminalClaimStatus, TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "../types/Enums.sol";
import {FeeActionRequest, FeeActionResult, FeeComputation} from "../types/FeeEngineTypes.sol";
import {FixingResolutionKind, FixingResult, FixingStatus} from "../types/FixingTypes.sol";
import {
    AccountId,
    AssetId,
    FeeActionId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PositionId,
    SeriesId,
    SettlementId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../types/PositionTypes.sol";
import {
    CanonicalSettlementFixing,
    SettlementCollateralDelta,
    SettlementFeeReceipt,
    SettlementMode,
    SettlementRecord
} from "../types/SettlementTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {FixingSlot} from "../types/SeriesQualification.sol";

contract CashSettlementCoordinator is ICashSettlementCoordinator, ReentrancyGuard {
    uint256 internal constant MAX_FEE_ACTIONS = 2;

    IPositionEngine private immutable _positionEngine;
    IFixingEngine private immutable _fixingEngine;
    IFundedFeeEngine private immutable _fundedFeeEngine;
    ICollateralVault private immutable _collateralVault;
    ISeriesRegistry private immutable _seriesRegistry;

    mapping(SettlementId settlementId => SettlementRecord record) private _settlements;
    mapping(PositionId positionId => SettlementId settlementId) private _positionSettlement;
    mapping(TerminalClaimId claimId => SettlementId settlementId) private _claimSettlement;

    struct PositionContext {
        PositionEconomics economics;
        PositionLifecycle lifecycle;
        SeriesVersion series;
        InstrumentVersion instrument;
        MarketVersion market;
        bytes payoffTerms;
    }

    constructor(IPositionEngine positionEngine_, IFixingEngine fixingEngine_, IFundedFeeEngine fundedFeeEngine_) {
        _requireDependency(address(positionEngine_));
        _requireDependency(address(fixingEngine_));
        _requireDependency(address(fundedFeeEngine_));
        ISeriesRegistry seriesRegistry_ = positionEngine_.seriesRegistry();
        ICollateralVault collateralVault_ = positionEngine_.collateralVault();
        _requireDependency(address(seriesRegistry_));
        _requireDependency(address(collateralVault_));
        if (address(fixingEngine_.seriesRegistry()) != address(seriesRegistry_)) {
            revert DependencyGraphMismatch(address(seriesRegistry_), address(fixingEngine_.seriesRegistry()));
        }
        if (address(fundedFeeEngine_.collateralVault()) != address(collateralVault_)) {
            revert DependencyGraphMismatch(address(collateralVault_), address(fundedFeeEngine_.collateralVault()));
        }
        _positionEngine = positionEngine_;
        _fixingEngine = fixingEngine_;
        _fundedFeeEngine = fundedFeeEngine_;
        _collateralVault = collateralVault_;
        _seriesRegistry = seriesRegistry_;
    }

    function finalizeNormalSettlement(
        PositionId positionId,
        FixingSlot[] calldata fixingSlots,
        FeeActionRequest[] calldata feeActions
    ) external nonReentrant returns (SettlementId settlementId) {
        SettlementId existing = _positionSettlement[positionId];
        if (SettlementId.unwrap(existing) != bytes32(0)) return existing;
        PositionContext memory context = _loadContext(positionId, fixingSlots, true);
        if (block.timestamp >= context.economics.finalResolutionAt) {
            revert NormalSettlementClosed(context.economics.finalResolutionAt, block.timestamp);
        }

        CanonicalSettlementFixing[] memory fixings = _collectNormalFixings(context.economics, fixingSlots);
        bytes32 fixingsHash = SettlementLib.hashFixings(fixings);
        settlementId = SettlementLib.deriveSettlementId(
            block.chainid, address(this), positionId, SettlementMode.Normal, fixingsHash
        );
        bytes memory encodedFixings = abi.encode(fixings);
        _advanceNormalPosition(positionId, context.lifecycle, fixingsHash, encodedFixings);
        (, PositionLifecycle memory terminalLifecycle) = _positionEngine.getPosition(positionId);
        if (terminalLifecycle.status != PositionStatus.Settled) revert SettlementOutcomeMismatch();

        SettlementFeeReceipt[] memory feeReceipts = _consumeFees(settlementId, context.economics, feeActions);
        (SettlementCollateralDelta memory longDelta, SettlementCollateralDelta memory shortDelta) =
            _terminalizeReservations(context.economics, terminalLifecycle, false);
        _storeSettlement(
            settlementId,
            positionId,
            SettlementMode.Normal,
            context,
            fixingsHash,
            terminalLifecycle,
            feeReceipts,
            longDelta,
            shortDelta
        );
    }

    function finalizeTerminalDisruption(
        PositionId positionId,
        FixingSlot[] calldata fixingSlots,
        FeeActionRequest[] calldata feeActions
    ) external nonReentrant returns (SettlementId settlementId) {
        SettlementId existing = _positionSettlement[positionId];
        if (SettlementId.unwrap(existing) != bytes32(0)) return existing;
        PositionContext memory context = _loadContext(positionId, fixingSlots, true);
        if (block.timestamp < context.economics.finalResolutionAt) {
            revert TerminalFallbackNotOpen(context.economics.finalResolutionAt, block.timestamp);
        }

        CanonicalSettlementFixing[] memory fixings = _collectDisruptionFixings(context.economics, fixingSlots);
        bytes32 fixingsHash = SettlementLib.hashFixings(fixings);
        settlementId = SettlementLib.deriveSettlementId(
            block.chainid, address(this), positionId, SettlementMode.TerminalDisruption, fixingsHash
        );
        if (!_isPositionTerminal(context.lifecycle.status)) {
            _positionEngine.applyTerminalFallback(positionId);
        }
        (, PositionLifecycle memory terminalLifecycle) = _positionEngine.getPosition(positionId);
        int256 expectedTransfer = _scaleDisruptionTransfer(context.economics);
        if (
            terminalLifecycle.terminalTransferMinor != expectedTransfer
                || terminalLifecycle.terminalOutcomeReference == bytes32(0)
                || (terminalLifecycle.status != PositionStatus.Settled
                    && terminalLifecycle.status != PositionStatus.TerminalClaim)
        ) revert SettlementOutcomeMismatch();

        SettlementFeeReceipt[] memory feeReceipts = _consumeFees(settlementId, context.economics, feeActions);
        (SettlementCollateralDelta memory longDelta, SettlementCollateralDelta memory shortDelta) =
            _terminalizeReservations(context.economics, terminalLifecycle, true);
        _storeSettlement(
            settlementId,
            positionId,
            SettlementMode.TerminalDisruption,
            context,
            fixingsHash,
            terminalLifecycle,
            feeReceipts,
            longDelta,
            shortDelta
        );
    }

    function finalizeLapsedPosition(PositionId positionId, FeeActionRequest[] calldata feeActions)
        external
        nonReentrant
        returns (SettlementId settlementId)
    {
        SettlementId existing = _positionSettlement[positionId];
        if (SettlementId.unwrap(existing) != bytes32(0)) return existing;
        PositionContext memory context = _loadContext(positionId, new FixingSlot[](0), false);
        if (context.lifecycle.status != PositionStatus.Lapsed || context.lifecycle.terminalTransferMinor != 0) {
            revert InvalidPositionStatus(context.lifecycle.status);
        }
        bytes32 fixingsHash = SettlementLib.hashFixings(new CanonicalSettlementFixing[](0));
        settlementId = SettlementLib.deriveSettlementId(
            block.chainid, address(this), positionId, SettlementMode.Lapsed, fixingsHash
        );
        SettlementFeeReceipt[] memory feeReceipts = _consumeFees(settlementId, context.economics, feeActions);
        (SettlementCollateralDelta memory longDelta, SettlementCollateralDelta memory shortDelta) = _terminalizeReservations(
            context.economics, context.lifecycle, block.timestamp >= context.economics.finalResolutionAt
        );
        _storeSettlement(
            settlementId,
            positionId,
            SettlementMode.Lapsed,
            context,
            fixingsHash,
            context.lifecycle,
            feeReceipts,
            longDelta,
            shortDelta
        );
    }

    function fulfillClaim(TerminalClaimId claimId) external nonReentrant {
        SettlementId settlementId = _claimSettlement[claimId];
        if (SettlementId.unwrap(settlementId) == bytes32(0)) revert UnknownClaim(claimId);
        TerminalClaimStatus status = _collateralVault.terminalClaimStatusOf(claimId);
        if (status == TerminalClaimStatus.Active) {
            _collateralVault.fulfillTerminalClaim(claimId);
        } else if (status != TerminalClaimStatus.Fulfilled) {
            revert UnknownClaim(claimId);
        }
        emit SettlementClaimFulfilled(claimId, _settlements[settlementId].positionId, settlementId, msg.sender);
    }

    function positionEngine() external view returns (IPositionEngine) {
        return _positionEngine;
    }

    function fixingEngine() external view returns (IFixingEngine) {
        return _fixingEngine;
    }

    function fundedFeeEngine() external view returns (IFundedFeeEngine) {
        return _fundedFeeEngine;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function getSettlement(SettlementId settlementId) external view returns (SettlementRecord memory record) {
        record = _settlements[settlementId];
        if (SettlementId.unwrap(record.settlementId) == bytes32(0)) {
            revert UnknownSettlement(settlementId);
        }
    }

    function settlementOf(PositionId positionId) external view returns (SettlementId settlementId) {
        return _positionSettlement[positionId];
    }

    function _loadContext(PositionId positionId, FixingSlot[] memory fixingSlots, bool requireFixingWitness)
        private
        view
        returns (PositionContext memory context)
    {
        if (_positionEngine.positionStatus(positionId) == PositionStatus.Unspecified) {
            revert UnknownPosition(positionId);
        }
        (context.economics, context.lifecycle) = _positionEngine.getPosition(positionId);
        if (PositionId.unwrap(context.economics.positionId) != PositionId.unwrap(positionId)) {
            revert PositionRecordMismatch(positionId);
        }
        if (!_seriesRegistry.isLifecycleEnabled(context.economics.seriesId, context.economics.seriesVersion)) {
            revert SeriesRecordMismatch();
        }
        context.series = _seriesRegistry.getSeries(context.economics.seriesId, context.economics.seriesVersion);
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
        ) revert SeriesRecordMismatch();

        IMarketRegistry markets = _seriesRegistry.marketRegistry();
        if (!markets.isLifecycleEnabled(context.economics.marketId, context.economics.marketVersion)) {
            revert MarketRecordMismatch();
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
                || context.market.definition.riskDomainId != context.economics.riskDomainId
                || context.market.definition.riskDomainVersion != context.economics.riskDomainVersion
                || FeeScheduleId.unwrap(context.market.definition.feeScheduleId)
                    != FeeScheduleId.unwrap(context.economics.feeScheduleId)
                || context.market.definition.feeScheduleVersion != context.economics.feeScheduleVersion
        ) revert MarketRecordMismatch();

        IInstrumentRegistry instruments = _seriesRegistry.instrumentRegistry();
        if (!instruments.isLifecycleEnabled(context.economics.instrumentId, context.economics.instrumentVersion)) {
            revert InstrumentRecordMismatch();
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
                    ) || context.instrument.definition.payoffModuleId != context.economics.payoffModuleId
                || context.instrument.definition.payoffModuleVersion != context.economics.payoffModuleVersion
                || context.instrument.definition.maxEvaluationGas != context.economics.maxEvaluationGas
        ) revert InstrumentRecordMismatch();

        context.payoffTerms = _positionEngine.payoffTerms(positionId);
        bytes32 payoffTermsHash =
            _seriesRegistry.hashPayoffTerms(context.instrument.definition.termsSchemaHash, context.payoffTerms);
        if (
            payoffTermsHash != context.economics.payoffTermsHash
                || payoffTermsHash != context.series.definition.payoffTermsHash
        ) revert PayoffTermsMismatch(context.series.definition.payoffTermsHash, payoffTermsHash);
        _requireEconomicMatch(context.economics, context.series);

        if (requireFixingWitness) {
            uint256 count = fixingSlots.length;
            if (count == 0) revert EmptyFixingSlots();
            if (count > context.instrument.definition.maxFixingSlots) {
                revert TooManyFixingSlots(count, context.instrument.definition.maxFixingSlots);
            }
            bytes32 slotsHash = _seriesRegistry.hashFixingSlots(
                context.series.definition, fixingSlots, context.instrument.definition.maxFixingSlots
            );
            if (
                slotsHash != context.economics.fixingSlotsHash || slotsHash != context.series.definition.fixingSlotsHash
            ) {
                revert FixingSlotsMismatch(context.series.definition.fixingSlotsHash, slotsHash);
            }
            for (uint256 i; i < count; ++i) {
                if (fixingSlots[i].slot != i) revert FixingSlotOrderMismatch(i, fixingSlots[i].slot);
            }
        }
    }

    function _requireEconomicMatch(PositionEconomics memory economics, SeriesVersion memory series) private pure {
        if (
            series.definition.marketId != economics.marketId
                || series.definition.marketVersion != economics.marketVersion
                || series.definition.instrumentId != economics.instrumentId
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
        ) revert PositionRecordMismatch(economics.positionId);
    }

    function _collectNormalFixings(PositionEconomics memory economics, FixingSlot[] calldata fixingSlots)
        private
        returns (CanonicalSettlementFixing[] memory fixings)
    {
        fixings = new CanonicalSettlementFixing[](fixingSlots.length);
        for (uint256 i; i < fixingSlots.length; ++i) {
            FixingStatus status = _fixingEngine.fixingStatus(economics.seriesId, economics.seriesVersion, uint8(i));
            if (status == FixingStatus.Proposed) {
                _fixingEngine.finalizeFixing(economics.seriesId, economics.seriesVersion, uint8(i));
            } else if (status != FixingStatus.Finalized) {
                revert FixingNotFinalized(uint8(i));
            }
            FixingResult memory result =
                _fixingEngine.getFinalizedFixing(economics.seriesId, economics.seriesVersion, uint8(i));
            if (
                result.resultHash == bytes32(0)
                    || (result.resolutionKind != FixingResolutionKind.PrimaryFinal
                        && result.resolutionKind != FixingResolutionKind.FallbackFinal)
            ) revert InvalidNormalFixingResolution(uint8(i), uint8(result.resolutionKind));
            fixings[i] = _canonicalFixing(economics, uint8(i), result);
        }
    }

    function _collectDisruptionFixings(PositionEconomics memory economics, FixingSlot[] calldata fixingSlots)
        private
        returns (CanonicalSettlementFixing[] memory fixings)
    {
        fixings = new CanonicalSettlementFixing[](fixingSlots.length);
        for (uint256 i; i < fixingSlots.length; ++i) {
            FixingStatus status = _fixingEngine.fixingStatus(economics.seriesId, economics.seriesVersion, uint8(i));
            if (status != FixingStatus.Finalized) {
                _fixingEngine.applyTerminalFallback(economics.seriesId, economics.seriesVersion, uint8(i));
            }
            FixingResult memory result =
                _fixingEngine.getFinalizedFixing(economics.seriesId, economics.seriesVersion, uint8(i));
            if (result.resultHash == bytes32(0)) revert InvalidDisruptionFixing(uint8(i));
            if (
                result.resolutionKind == FixingResolutionKind.TerminalDisruption
                    && result.terminalDisruptionTransferMinorPerLot != economics.terminalDisruptionTransferMinorPerLot
            ) revert InvalidDisruptionFixing(uint8(i));
            fixings[i] = _canonicalFixing(economics, uint8(i), result);
        }
    }

    function _canonicalFixing(PositionEconomics memory economics, uint8 slot, FixingResult memory result)
        private
        view
        returns (CanonicalSettlementFixing memory)
    {
        return CanonicalSettlementFixing({
            fixingKey: _fixingEngine.deriveFixingKey(economics.seriesId, economics.seriesVersion, slot),
            resultHash: result.resultHash,
            resolutionKind: result.resolutionKind,
            value: result.value,
            terminalDisruptionTransferMinorPerLot: result.terminalDisruptionTransferMinorPerLot,
            effectiveAt: result.effectiveAt,
            slot: slot,
            decimals: result.decimals
        });
    }

    function _advanceNormalPosition(
        PositionId positionId,
        PositionLifecycle memory lifecycle,
        bytes32 fixingsHash,
        bytes memory encodedFixings
    ) private {
        if (lifecycle.status == PositionStatus.Live) {
            _positionEngine.beginFixing(positionId);
            lifecycle.status = PositionStatus.Fixing;
        }
        if (lifecycle.status == PositionStatus.Fixing) {
            _positionEngine.acceptFinalFixing(positionId, fixingsHash, encodedFixings);
            (, lifecycle) = _positionEngine.getPosition(positionId);
        }
        if (lifecycle.status == PositionStatus.SettlementReady) {
            if (
                lifecycle.finalFixingReference != fixingsHash || lifecycle.finalFixingsHash != keccak256(encodedFixings)
            ) {
                revert ExistingPositionOutcomeMismatch();
            }
            _positionEngine.settle(positionId);
            return;
        }
        if (lifecycle.status != PositionStatus.Settled) revert InvalidPositionStatus(lifecycle.status);
        if (lifecycle.finalFixingReference != fixingsHash || lifecycle.finalFixingsHash != keccak256(encodedFixings)) {
            revert ExistingPositionOutcomeMismatch();
        }
    }

    function _consumeFees(
        SettlementId settlementId,
        PositionEconomics memory economics,
        FeeActionRequest[] calldata feeActions
    ) private returns (SettlementFeeReceipt[] memory receipts) {
        uint256 count = feeActions.length;
        if (count > MAX_FEE_ACTIONS) revert FeeRequestLimitExceeded(count, MAX_FEE_ACTIONS);
        receipts = new SettlementFeeReceipt[](count);
        uint32 previousOrdinal;
        for (uint256 i; i < count; ++i) {
            FeeActionRequest calldata request = feeActions[i];
            if (i != 0 && request.actionOrdinal <= previousOrdinal) {
                revert FeeRequestOrderMismatch(i, request.actionOrdinal);
            }
            if (
                FeeScheduleId.unwrap(request.feeScheduleId) != FeeScheduleId.unwrap(economics.feeScheduleId)
                    || request.feeScheduleVersion != economics.feeScheduleVersion
            ) revert FeeRequestScheduleMismatch(i);
            bytes32 parentActionId = SettlementId.unwrap(settlementId);
            if (request.parentActionId != parentActionId) {
                revert FeeRequestParentMismatch(i, parentActionId, request.parentActionId);
            }

            bytes32 action = FeeActionId.unwrap(request.actionId);
            bool isSettlement = action == FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_SETTLEMENT);
            bool isKeeper = action == FeeActionId.unwrap(FeeEngineLib.FEE_ACTION_KEEPER_REWARD);
            if (!isSettlement && !isKeeper) revert UnsupportedSettlementFeeAction(i, request.actionId);
            uint32 expectedOrdinal = isSettlement ? 0 : 1;
            if (request.actionOrdinal != expectedOrdinal) revert FeeRequestOrderMismatch(i, request.actionOrdinal);
            if (
                isSettlement && AccountId.unwrap(request.chargePayerAccountId) != bytes32(0)
                    && AccountId.unwrap(request.chargePayerAccountId) != AccountId.unwrap(economics.longAccountId)
                    && AccountId.unwrap(request.chargePayerAccountId) != AccountId.unwrap(economics.shortAccountId)
            ) revert SettlementFeePayerMismatch(i);

            FeeComputation memory preview = _fundedFeeEngine.previewFeeAction(
                request.feeScheduleId,
                request.feeScheduleVersion,
                request.actionId,
                request.notionalMinor,
                request.qualifyingVolumeMinor
            );
            if (isKeeper && (preview.chargeMinor != 0 || preview.rebateMinor == 0)) {
                revert InvalidKeeperReward(i);
            }
            FeeActionResult memory result = _fundedFeeEngine.consumeFeeAction(request);
            receipts[i] = SettlementFeeReceipt({
                actionId: request.actionId,
                consumptionId: result.consumptionId,
                resultHash: result.resultHash,
                chargeMinor: result.chargeMinor,
                rebateMinor: result.rebateMinor
            });
            previousOrdinal = request.actionOrdinal;
        }
    }

    function _terminalizeReservations(
        PositionEconomics memory economics,
        PositionLifecycle memory lifecycle,
        bool afterFinalResolution
    ) private returns (SettlementCollateralDelta memory longDelta, SettlementCollateralDelta memory shortDelta) {
        _validateTerminalStates(economics, lifecycle, afterFinalResolution);
        longDelta = _terminalizeReservation(
            economics.longReservationId, economics.longLiabilityKey, economics, afterFinalResolution
        );
        shortDelta = _terminalizeReservation(
            economics.shortReservationId, economics.shortLiabilityKey, economics, afterFinalResolution
        );
    }

    function _validateTerminalStates(
        PositionEconomics memory economics,
        PositionLifecycle memory lifecycle,
        bool afterFinalResolution
    ) private view {
        PositionTerminalState memory longState = _positionEngine.terminalState(economics.longLiabilityKey);
        PositionTerminalState memory shortState = _positionEngine.terminalState(economics.shortLiabilityKey);
        if (longState.positionId != economics.longLiabilityKey || shortState.positionId != economics.shortLiabilityKey)
        {
            revert TerminalStateMismatch(economics.longLiabilityKey);
        }
        int256 transfer = lifecycle.terminalTransferMinor;
        if (transfer == 0) {
            if (!_isFlat(longState) || !_isFlat(shortState)) revert SettlementOutcomeMismatch();
            return;
        }
        bool longPays = transfer < 0;
        uint128 amount = uint128(longPays ? uint256(-transfer) : uint256(transfer));
        PositionTerminalState memory payerState = longPays ? longState : shortState;
        PositionTerminalState memory otherState = longPays ? shortState : longState;
        AccountId expectedReceiver = longPays ? economics.shortAccountId : economics.longAccountId;
        uint128 maximum = longPays ? economics.maxLongDebitMinor : economics.maxShortDebitMinor;
        if (amount > maximum) revert TerminalAmountOutsideBounds(amount, maximum);
        TerminalOutcomeKind expectedOutcome =
            afterFinalResolution ? TerminalOutcomeKind.Claim : TerminalOutcomeKind.Payout;
        if (
            payerState.outcome != expectedOutcome || payerState.amount != amount
                || AccountId.unwrap(payerState.receiverAccountId) != AccountId.unwrap(expectedReceiver)
                || !_isFlat(otherState)
        ) revert SettlementOutcomeMismatch();
    }

    function _terminalizeReservation(
        TerminalLiabilityReservationId reservationId,
        bytes32 liabilityKey,
        PositionEconomics memory economics,
        bool afterFinalResolution
    ) private returns (SettlementCollateralDelta memory delta) {
        if (TerminalLiabilityReservationId.unwrap(reservationId) == bytes32(0)) return delta;
        TerminalLiabilityReservation memory beforeRecord =
            _collateralVault.terminalLiabilityReservationOf(reservationId);
        if (
            beforeRecord.positionId != liabilityKey || beforeRecord.positionEngine != address(_positionEngine)
                || AssetId.unwrap(beforeRecord.assetId) != AssetId.unwrap(economics.settlementAssetId)
                || beforeRecord.bindingVersion != economics.settlementAssetVersion
        ) revert ReservationRecordMismatch();
        if (beforeRecord.status == TerminalLiabilityReservationStatus.Active) {
            if (afterFinalResolution) {
                _collateralVault.materializeTerminalClaimAfterFinalResolution(reservationId);
            } else {
                _collateralVault.finalizeTerminalLiabilityReservation(reservationId);
            }
        }
        TerminalLiabilityReservation memory afterRecord = _collateralVault.terminalLiabilityReservationOf(reservationId);
        TerminalClaimId claimId;
        AccountId receiver;
        uint128 claimAmount;
        if (afterRecord.status == TerminalLiabilityReservationStatus.ConvertedToClaim) {
            claimId = _collateralVault.deriveTerminalClaimId(reservationId, afterRecord.terminalOutcomeReference);
            TerminalClaim memory claim = _collateralVault.terminalClaimOf(claimId);
            if (
                TerminalLiabilityReservationId.unwrap(claim.reservationId)
                        != TerminalLiabilityReservationId.unwrap(reservationId) || claim.positionId != liabilityKey
                    || claim.amount != afterRecord.terminalAmount
            ) revert ReservationRecordMismatch();
            receiver = claim.receiverAccountId;
            claimAmount = claim.amount;
        } else if (afterRecord.status != TerminalLiabilityReservationStatus.ReleasedAtTerminal) {
            revert ReservationRecordMismatch();
        }
        uint128 reservedBefore =
            beforeRecord.remainingAmount == 0 ? beforeRecord.initialAmount : beforeRecord.remainingAmount;
        if (claimAmount > reservedBefore) revert ReservationRecordMismatch();
        uint128 releasedAmount = reservedBefore - claimAmount;
        return SettlementCollateralDelta({
            reservationId: reservationId,
            claimId: claimId,
            status: afterRecord.status,
            payerAccountId: afterRecord.payerAccountId,
            receiverAccountId: receiver,
            reservedBefore: reservedBefore,
            claimAmount: claimAmount,
            releasedAmount: releasedAmount
        });
    }

    function _storeSettlement(
        SettlementId settlementId,
        PositionId positionId,
        SettlementMode mode,
        PositionContext memory context,
        bytes32 fixingsHash,
        PositionLifecycle memory lifecycle,
        SettlementFeeReceipt[] memory feeReceipts,
        SettlementCollateralDelta memory longDelta,
        SettlementCollateralDelta memory shortDelta
    ) private {
        if (SettlementId.unwrap(_positionSettlement[positionId]) != bytes32(0)) {
            revert SettlementAlreadyRecorded(positionId, _positionSettlement[positionId]);
        }
        (AccountId payer, AccountId receiver, uint128 amount) = _terminalParties(context.economics, lifecycle);
        bytes32 outcomeHash = SettlementLib.hashOutcome(
            settlementId,
            positionId,
            mode,
            context.economics.seriesVersionHash,
            context.economics.payoffTermsHash,
            context.economics.fixingSlotsHash,
            fixingsHash,
            lifecycle.terminalOutcomeReference,
            lifecycle.terminalTransferMinor,
            feeReceipts,
            longDelta,
            shortDelta
        );
        SettlementRecord memory record = SettlementRecord({
            settlementId: settlementId,
            positionId: positionId,
            mode: mode,
            seriesVersionHash: context.economics.seriesVersionHash,
            payoffTermsHash: context.economics.payoffTermsHash,
            fixingSlotsHash: context.economics.fixingSlotsHash,
            fixingsHash: fixingsHash,
            positionOutcomeReference: lifecycle.terminalOutcomeReference,
            outcomeHash: outcomeHash,
            payerAccountId: payer,
            receiverAccountId: receiver,
            terminalTransferMinor: lifecycle.terminalTransferMinor,
            terminalAmount: amount,
            finalizedAt: uint64(block.timestamp),
            longCollateral: longDelta,
            shortCollateral: shortDelta,
            feeReceipts: feeReceipts
        });
        _settlements[settlementId] = record;
        _positionSettlement[positionId] = settlementId;
        if (TerminalClaimId.unwrap(longDelta.claimId) != bytes32(0)) {
            _claimSettlement[longDelta.claimId] = settlementId;
        }
        if (TerminalClaimId.unwrap(shortDelta.claimId) != bytes32(0)) {
            _claimSettlement[shortDelta.claimId] = settlementId;
        }
        emit CashSettlementFinalized(
            settlementId,
            positionId,
            mode,
            outcomeHash,
            fixingsHash,
            lifecycle.terminalOutcomeReference,
            lifecycle.terminalTransferMinor,
            amount,
            msg.sender
        );
    }

    function _terminalParties(PositionEconomics memory economics, PositionLifecycle memory lifecycle)
        private
        pure
        returns (AccountId payer, AccountId receiver, uint128 amount)
    {
        int256 transfer = lifecycle.terminalTransferMinor;
        if (transfer == 0) return (AccountId.wrap(bytes32(0)), AccountId.wrap(bytes32(0)), 0);
        if (transfer < 0) {
            return (economics.longAccountId, economics.shortAccountId, uint128(uint256(-transfer)));
        }
        return (economics.shortAccountId, economics.longAccountId, uint128(uint256(transfer)));
    }

    function _scaleDisruptionTransfer(PositionEconomics memory economics) private pure returns (int256) {
        return PositionMathLib.scaleTransfer(economics.terminalDisruptionTransferMinorPerLot, economics.lots);
    }

    function _isPositionTerminal(PositionStatus status) private pure returns (bool) {
        return status == PositionStatus.Settled || status == PositionStatus.TerminalClaim;
    }

    function _isFlat(PositionTerminalState memory state) private pure returns (bool) {
        return state.outcome == TerminalOutcomeKind.Flat && state.amount == 0
            && AccountId.unwrap(state.receiverAccountId) == bytes32(0);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
