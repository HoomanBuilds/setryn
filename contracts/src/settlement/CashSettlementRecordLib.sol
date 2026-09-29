// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICashSettlementCoordinator} from "../interfaces/ICashSettlementCoordinator.sol";
import {PositionTerminalState} from "../interfaces/IPositionEngineTerminalState.sol";
import {FeeEngineLib} from "../libraries/FeeEngineLib.sol";
import {FeeScheduleDefinitionLib} from "../libraries/FeeScheduleDefinitionLib.sol";
import {SettlementLib} from "../libraries/SettlementLib.sol";
import {TerminalClaim, TerminalLiabilityReservation} from "../types/CollateralTypes.sol";
import {TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "../types/Enums.sol";
import {FeeActionRequest, FeeActionResult, FeeComputation} from "../types/FeeEngineTypes.sol";
import {
    AccountId,
    AssetId,
    FeeActionId,
    FeeScheduleId,
    PositionId,
    SettlementId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {PositionEconomics, PositionLifecycle} from "../types/PositionTypes.sol";
import {RiskExposureReduction} from "../types/RiskTypes.sol";
import {
    SettlementCollateralDelta,
    SettlementFeeReceipt,
    SettlementMode,
    SettlementRecord
} from "../types/SettlementTypes.sol";

import {CashSettlementDependencies, PositionContext} from "./CashSettlementTypes.sol";

/// Linked logic for the cash settlement coordinator: fees, reservation terminalization, exposure release,
/// and settlement records. Runs through DELEGATECALL in the coordinator's context against its storage.
library CashSettlementRecordLib {
    uint256 internal constant MAX_FEE_ACTIONS = 2;

    function consumeFees(
        CashSettlementDependencies memory deps,
        SettlementId settlementId,
        PositionEconomics memory economics,
        FeeActionRequest[] calldata feeActions
    ) external returns (SettlementFeeReceipt[] memory receipts) {
        uint256 count = feeActions.length;
        if (count > MAX_FEE_ACTIONS) revert ICashSettlementCoordinator.FeeRequestLimitExceeded(count, MAX_FEE_ACTIONS);
        receipts = new SettlementFeeReceipt[](count);
        uint32 previousOrdinal;
        for (uint256 i; i < count; ++i) {
            FeeActionRequest calldata request = feeActions[i];
            if (i != 0 && request.actionOrdinal <= previousOrdinal) {
                revert ICashSettlementCoordinator.FeeRequestOrderMismatch(i, request.actionOrdinal);
            }
            if (
                FeeScheduleId.unwrap(request.feeScheduleId) != FeeScheduleId.unwrap(economics.feeScheduleId)
                    || request.feeScheduleVersion != economics.feeScheduleVersion
            ) revert ICashSettlementCoordinator.FeeRequestScheduleMismatch(i);
            bytes32 parentActionId = SettlementId.unwrap(settlementId);
            if (request.parentActionId != parentActionId) {
                revert ICashSettlementCoordinator.FeeRequestParentMismatch(i, parentActionId, request.parentActionId);
            }

            bytes32 action = FeeActionId.unwrap(request.actionId);
            bool isSettlement = action == FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_SETTLEMENT);
            bool isKeeper = action == FeeActionId.unwrap(FeeEngineLib.FEE_ACTION_KEEPER_REWARD);
            if (!isSettlement && !isKeeper) {
                revert ICashSettlementCoordinator.UnsupportedSettlementFeeAction(i, request.actionId);
            }
            uint32 expectedOrdinal = isSettlement ? 0 : 1;
            if (request.actionOrdinal != expectedOrdinal) {
                revert ICashSettlementCoordinator.FeeRequestOrderMismatch(i, request.actionOrdinal);
            }
            if (
                isSettlement && AccountId.unwrap(request.chargePayerAccountId) != bytes32(0)
                    && AccountId.unwrap(request.chargePayerAccountId) != AccountId.unwrap(economics.longAccountId)
                    && AccountId.unwrap(request.chargePayerAccountId) != AccountId.unwrap(economics.shortAccountId)
            ) revert ICashSettlementCoordinator.SettlementFeePayerMismatch(i);

            FeeComputation memory preview = deps.fundedFeeEngine
                .previewFeeAction(
                    request.feeScheduleId,
                    request.feeScheduleVersion,
                    request.actionId,
                    request.notionalMinor,
                    request.qualifyingVolumeMinor
                );
            if (isKeeper && (preview.chargeMinor != 0 || preview.rebateMinor == 0)) {
                revert ICashSettlementCoordinator.InvalidKeeperReward(i);
            }
            FeeActionResult memory result = deps.fundedFeeEngine.consumeFeeAction(request);
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

    function terminalizeReservations(
        CashSettlementDependencies memory deps,
        PositionEconomics memory economics,
        PositionLifecycle memory lifecycle,
        bool afterFinalResolution
    ) external returns (SettlementCollateralDelta memory longDelta, SettlementCollateralDelta memory shortDelta) {
        _validateTerminalStates(deps, economics, lifecycle, afterFinalResolution);
        longDelta = _terminalizeReservation(
            deps, economics.longReservationId, economics.longLiabilityKey, economics, afterFinalResolution
        );
        shortDelta = _terminalizeReservation(
            deps, economics.shortReservationId, economics.shortLiabilityKey, economics, afterFinalResolution
        );
    }

    function _validateTerminalStates(
        CashSettlementDependencies memory deps,
        PositionEconomics memory economics,
        PositionLifecycle memory lifecycle,
        bool afterFinalResolution
    ) internal view {
        PositionTerminalState memory longState = deps.positionEngine.terminalState(economics.longLiabilityKey);
        PositionTerminalState memory shortState = deps.positionEngine.terminalState(economics.shortLiabilityKey);
        if (longState.positionId != economics.longLiabilityKey || shortState.positionId != economics.shortLiabilityKey)
        {
            revert ICashSettlementCoordinator.TerminalStateMismatch(economics.longLiabilityKey);
        }
        int256 transfer = lifecycle.terminalTransferMinor;
        if (transfer == 0) {
            if (!_isFlat(longState) || !_isFlat(shortState)) {
                revert ICashSettlementCoordinator.SettlementOutcomeMismatch();
            }
            return;
        }
        bool longPays = transfer < 0;
        uint128 amount = uint128(longPays ? uint256(-transfer) : uint256(transfer));
        PositionTerminalState memory payerState = longPays ? longState : shortState;
        PositionTerminalState memory otherState = longPays ? shortState : longState;
        AccountId expectedReceiver = longPays ? economics.shortAccountId : economics.longAccountId;
        uint128 maximum = longPays ? economics.maxLongDebitMinor : economics.maxShortDebitMinor;
        if (amount > maximum) revert ICashSettlementCoordinator.TerminalAmountOutsideBounds(amount, maximum);
        TerminalOutcomeKind expectedOutcome =
            afterFinalResolution ? TerminalOutcomeKind.Claim : TerminalOutcomeKind.Payout;
        if (
            payerState.outcome != expectedOutcome || payerState.amount != amount
                || AccountId.unwrap(payerState.receiverAccountId) != AccountId.unwrap(expectedReceiver)
                || !_isFlat(otherState)
        ) revert ICashSettlementCoordinator.SettlementOutcomeMismatch();
    }

    function _terminalizeReservation(
        CashSettlementDependencies memory deps,
        TerminalLiabilityReservationId reservationId,
        bytes32 liabilityKey,
        PositionEconomics memory economics,
        bool afterFinalResolution
    ) internal returns (SettlementCollateralDelta memory delta) {
        if (TerminalLiabilityReservationId.unwrap(reservationId) == bytes32(0)) return delta;
        TerminalLiabilityReservation memory beforeRecord =
            deps.collateralVault.terminalLiabilityReservationOf(reservationId);
        if (
            beforeRecord.positionId != liabilityKey || beforeRecord.positionEngine != address(deps.positionEngine)
                || AssetId.unwrap(beforeRecord.assetId) != AssetId.unwrap(economics.settlementAssetId)
                || beforeRecord.bindingVersion != economics.settlementAssetVersion
        ) revert ICashSettlementCoordinator.ReservationRecordMismatch();
        if (beforeRecord.status == TerminalLiabilityReservationStatus.Active) {
            if (afterFinalResolution) {
                deps.collateralVault.materializeTerminalClaimAfterFinalResolution(reservationId);
            } else {
                deps.collateralVault.finalizeTerminalLiabilityReservation(reservationId);
            }
        }
        TerminalLiabilityReservation memory afterRecord =
            deps.collateralVault.terminalLiabilityReservationOf(reservationId);
        TerminalClaimId claimId;
        AccountId receiver;
        uint128 claimAmount;
        if (afterRecord.status == TerminalLiabilityReservationStatus.ConvertedToClaim) {
            claimId = deps.collateralVault.deriveTerminalClaimId(reservationId, afterRecord.terminalOutcomeReference);
            TerminalClaim memory claim = deps.collateralVault.terminalClaimOf(claimId);
            if (
                TerminalLiabilityReservationId.unwrap(claim.reservationId)
                        != TerminalLiabilityReservationId.unwrap(reservationId) || claim.positionId != liabilityKey
                    || claim.amount != afterRecord.terminalAmount
            ) revert ICashSettlementCoordinator.ReservationRecordMismatch();
            receiver = claim.receiverAccountId;
            claimAmount = claim.amount;
        } else if (afterRecord.status != TerminalLiabilityReservationStatus.ReleasedAtTerminal) {
            revert ICashSettlementCoordinator.ReservationRecordMismatch();
        }
        uint128 reservedBefore =
            beforeRecord.remainingAmount == 0 ? beforeRecord.initialAmount : beforeRecord.remainingAmount;
        if (claimAmount > reservedBefore) revert ICashSettlementCoordinator.ReservationRecordMismatch();
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

    function storeSettlement(
        mapping(SettlementId settlementId => SettlementRecord record) storage $settlements,
        mapping(
            PositionId positionId => SettlementId settlementId
        ) storage $positionSettlement,
        mapping(TerminalClaimId claimId => SettlementId settlementId) storage $claimSettlement,
        SettlementId settlementId,
        PositionId positionId,
        SettlementMode mode,
        PositionContext memory context,
        bytes32 fixingsHash,
        PositionLifecycle memory lifecycle,
        SettlementFeeReceipt[] memory feeReceipts,
        SettlementCollateralDelta memory longDelta,
        SettlementCollateralDelta memory shortDelta
    ) external {
        if (SettlementId.unwrap($positionSettlement[positionId]) != bytes32(0)) {
            revert ICashSettlementCoordinator.SettlementAlreadyRecorded(positionId, $positionSettlement[positionId]);
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
        $settlements[settlementId] = record;
        $positionSettlement[positionId] = settlementId;
        if (TerminalClaimId.unwrap(longDelta.claimId) != bytes32(0)) {
            $claimSettlement[longDelta.claimId] = settlementId;
        }
        if (TerminalClaimId.unwrap(shortDelta.claimId) != bytes32(0)) {
            $claimSettlement[shortDelta.claimId] = settlementId;
        }
        emit ICashSettlementCoordinator.CashSettlementFinalized(
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
        internal
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

    function _isFlat(PositionTerminalState memory state) internal pure returns (bool) {
        return state.outcome == TerminalOutcomeKind.Flat && state.amount == 0
            && AccountId.unwrap(state.receiverAccountId) == bytes32(0);
    }

    function reducePositionExposure(
        CashSettlementDependencies memory deps,
        PositionId positionId,
        PositionEconomics memory economics
    ) external {
        _reduceAccountExposure(deps, positionId, economics.longAccountId);
        if (AccountId.unwrap(economics.shortAccountId) != AccountId.unwrap(economics.longAccountId)) {
            _reduceAccountExposure(deps, positionId, economics.shortAccountId);
        }
    }

    function _reduceAccountExposure(CashSettlementDependencies memory deps, PositionId positionId, AccountId accountId)
        internal
    {
        RiskExposureReduction memory reduction =
            deps.portfolioRiskEngine.exposureReductionWitness(positionId, accountId);
        if (reduction.exposureId != bytes32(0)) deps.portfolioRiskEngine.reduceExposure(reduction);
    }
}
