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

    /// A holder-election position's final fixing was accepted and persisted on the position engine. The position
    /// stays Live awaiting election through `exerciseCutoffAt`; no settlement record exists until it is exercised or
    /// its unelected lots lapse. When acceptance happens after the cutoff, the same transaction lapses the unelected
    /// lots and emits `CashSettlementFinalized`.
    event HolderElectionFixingAccepted(
        PositionId indexed positionId,
        bytes32 indexed fixingsHash,
        bytes32 finalFixingsHash,
        uint64 exerciseOpensAt,
        uint64 exerciseCutoffAt,
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
    error HolderElectionPending(PositionId positionId, uint64 exerciseCutoffAt);
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
    /// Accepts the normal final fixing and settles the position. For a holder-election position whose election window
    /// has not closed, the first call only persists the fixing, emits `HolderElectionFixingAccepted` and returns a zero
    /// settlement ID; later calls revert `HolderElectionPending` until the holder exercises (then this records the
    /// normal settlement) or `exerciseCutoffAt` passes (then this lapses every unelected lot and records the result).
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
    /// Records a lapsed position. A holder-election position still Live or Fixing after `exerciseCutoffAt` and before
    /// `finalResolutionAt` is lapsed permissionlessly first; it needs no fixing witness.
    function finalizeLapsedPosition(PositionId positionId, FeeActionRequest[] calldata feeActions)
        external
        returns (SettlementId settlementId);
    function fulfillClaim(TerminalClaimId claimId) external;
    function getSettlement(SettlementId settlementId) external view returns (SettlementRecord memory record);
    function settlementOf(PositionId positionId) external view returns (SettlementId settlementId);
}
