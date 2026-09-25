// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "./ICollateralVault.sol";
import {IFixingEngine} from "./IFixingEngine.sol";
import {IFundedFeeEngine} from "./IFundedFeeEngine.sol";
import {IPositionEngine} from "./IPositionEngine.sol";
import {FeeActionRequest} from "../types/FeeEngineTypes.sol";
import {PositionStatus} from "../types/PositionTypes.sol";
import {SettlementMode, SettlementRecord} from "../types/SettlementTypes.sol";
import {FixingSlot} from "../types/SeriesQualification.sol";
import {FeeActionId, PositionId, SettlementId, TerminalClaimId} from "../types/Identifiers.sol";

interface ICashSettlementCoordinator {
    event CashSettlementFinalized(
        SettlementId indexed settlementId,
        PositionId indexed positionId,
        SettlementMode indexed mode,
        bytes32 outcomeHash,
        bytes32 fixingsHash,
        bytes32 positionOutcomeReference,
        int256 terminalTransferMinor,
        uint128 terminalAmount,
        address caller
    );

    event SettlementClaimFulfilled(
        TerminalClaimId indexed claimId,
        PositionId indexed positionId,
        SettlementId indexed settlementId,
        address caller
    );

    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error DependencyGraphMismatch(address expected, address actual);
    error UnknownPosition(PositionId positionId);
    error PositionRecordMismatch(PositionId positionId);
    error SeriesRecordMismatch();
    error InstrumentRecordMismatch();
    error MarketRecordMismatch();
    error PayoffTermsMismatch(bytes32 expected, bytes32 actual);
    error FixingSlotsMismatch(bytes32 expected, bytes32 actual);
    error EmptyFixingSlots();
    error TooManyFixingSlots(uint256 actual, uint256 maximum);
    error FixingSlotOrderMismatch(uint256 index, uint8 supplied);
    error FixingNotFinalized(uint8 slot);
    error InvalidNormalFixingResolution(uint8 slot, uint8 resolutionKind);
    error InvalidDisruptionFixing(uint8 slot);
    error NormalSettlementClosed(uint64 finalResolutionAt, uint256 currentTimestamp);
    error TerminalFallbackNotOpen(uint64 finalResolutionAt, uint256 currentTimestamp);
    error InvalidPositionStatus(PositionStatus status);
    error ExistingPositionOutcomeMismatch();
    error SettlementAlreadyRecorded(PositionId positionId, SettlementId settlementId);
    error FeeRequestLimitExceeded(uint256 actual, uint256 maximum);
    error FeeRequestOrderMismatch(uint256 index, uint32 actionOrdinal);
    error FeeRequestScheduleMismatch(uint256 index);
    error FeeRequestParentMismatch(uint256 index, bytes32 expected, bytes32 actual);
    error UnsupportedSettlementFeeAction(uint256 index, FeeActionId actionId);
    error SettlementFeePayerMismatch(uint256 index);
    error InvalidKeeperReward(uint256 index);
    error ReservationRecordMismatch();
    error TerminalStateMismatch(bytes32 liabilityKey);
    error TerminalAmountOutsideBounds(uint128 amount, uint128 maximum);
    error SettlementOutcomeMismatch();
    error UnknownClaim(TerminalClaimId claimId);
    error UnknownSettlement(SettlementId settlementId);
    error ClaimSettlementMismatch(TerminalClaimId claimId);

    function positionEngine() external view returns (IPositionEngine);
    function fixingEngine() external view returns (IFixingEngine);
    function fundedFeeEngine() external view returns (IFundedFeeEngine);
    function collateralVault() external view returns (ICollateralVault);
    function finalizeNormalSettlement(
        PositionId positionId,
        FixingSlot[] calldata fixingSlots,
        FeeActionRequest[] calldata feeActions
    ) external returns (SettlementId settlementId);
    function finalizeTerminalDisruption(
        PositionId positionId,
        FixingSlot[] calldata fixingSlots,
        FeeActionRequest[] calldata feeActions
    ) external returns (SettlementId settlementId);
    function finalizeLapsedPosition(PositionId positionId, FeeActionRequest[] calldata feeActions)
        external
        returns (SettlementId settlementId);
    function fulfillClaim(TerminalClaimId claimId) external;
    function getSettlement(SettlementId settlementId) external view returns (SettlementRecord memory record);
    function settlementOf(PositionId positionId) external view returns (SettlementId settlementId);
}
