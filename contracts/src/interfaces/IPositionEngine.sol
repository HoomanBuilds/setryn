// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPositionEngineTerminalState} from "./IPositionEngineTerminalState.sol";
import {ICollateralVault} from "./ICollateralVault.sol";
import {ISeriesRegistry} from "./ISeriesRegistry.sol";
import {PositionId} from "../types/Identifiers.sol";
import {PositionCreation, PositionEconomics, PositionLifecycle, PositionStatus} from "../types/PositionTypes.sol";

interface IPositionEngine is IPositionEngineTerminalState {
    event PositionCreated(
        PositionId indexed positionId,
        bytes32 indexed fillIdentity,
        bytes32 indexed seriesId,
        uint32 seriesVersion,
        bytes32 longAccountId,
        bytes32 shortAccountId,
        uint128 lots,
        bytes32 longReservationId,
        bytes32 shortReservationId,
        address clearingEngine
    );

    event PositionStatusChanged(
        PositionId indexed positionId,
        PositionStatus previousStatus,
        PositionStatus newStatus,
        bytes32 indexed transitionReference,
        address caller
    );

    event PositionPayoffComputed(
        PositionId indexed positionId,
        bytes32 indexed finalFixingReference,
        bytes32 finalFixingsHash,
        int256 transferMinorPerLot,
        int256 terminalTransferMinor
    );

    error ZeroInitialAdmin();
    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error ZeroFillIdentity();
    error ZeroAccount();
    error IdenticalPositionAccounts();
    error ZeroLots();
    error SeriesClosedForNewRisk(bytes32 seriesId, uint32 version);
    error PositionAlreadyExists(PositionId positionId);
    error UnknownPosition(PositionId positionId);
    error InvalidPositionTransition(PositionId positionId, PositionStatus current, PositionStatus requested);
    error FixingWindowNotOpen(PositionId positionId, uint64 opensAt, uint64 nowTs);
    error FinalResolutionNotReached(PositionId positionId, uint64 finalResolutionAt, uint64 nowTs);
    error FinalResolutionReached(PositionId positionId, uint64 finalResolutionAt, uint64 nowTs);
    error ZeroReference();
    error PayoffTermsHashMismatch(bytes32 expected, bytes32 actual);
    error PayoffModuleRuntimeMismatch(address implementation, bytes32 expected, bytes32 actual);
    error PayoffModuleCallFailed(bytes4 selector);
    error InvalidPayoffModuleReturn(bytes4 selector, uint256 length);
    error PayoffOutsideDebitBounds(int256 transferMinorPerLot, uint128 maxLongDebit, uint128 maxShortDebit);
    error PositionAmountOverflow(uint256 perLot, uint256 lots);
    error TerminalAmountOverflow(uint256 amount);
    error ReservationMismatch(bytes32 liabilityKey, bytes32 expectedReservationId, bytes32 actualReservationId);
    error ReservationRecordMismatch(bytes32 reservationId);
    error UnsupportedTerminalAlternative(PositionStatus status);

    function createPosition(PositionCreation calldata creation) external returns (PositionId positionId);

    function seriesRegistry() external view returns (ISeriesRegistry);

    function collateralVault() external view returns (ICollateralVault);

    function beginFixing(PositionId positionId) external;

    function acceptFinalFixing(PositionId positionId, bytes32 fixingReference, bytes calldata finalFixings) external;

    function settle(PositionId positionId) external;

    function applyTerminalFallback(PositionId positionId) external;

    function markDefaulted(PositionId positionId, bytes32 defaultReference) external;

    function recordZeroLiabilityAlternative(
        PositionId positionId,
        PositionStatus terminalStatus,
        bytes32 transitionReference
    ) external;

    function derivePositionId(PositionCreation calldata creation) external view returns (PositionId);

    function deriveLiabilityKey(PositionId positionId, uint8 side) external pure returns (bytes32);

    function getPosition(PositionId positionId)
        external
        view
        returns (PositionEconomics memory economics, PositionLifecycle memory lifecycle);

    function payoffTerms(PositionId positionId) external view returns (bytes memory);

    function positionStatus(PositionId positionId) external view returns (PositionStatus);

    function positionCount() external view returns (uint256);
}
