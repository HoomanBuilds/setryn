// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPositionEngineTerminalState} from "./IPositionEngineTerminalState.sol";
import {ILifecyclePositionSource} from "./ILifecyclePositionSource.sol";
import {ICompressionPositionSource} from "./ICompressionPositionSource.sol";
import {ICollateralVault} from "./ICollateralVault.sol";
import {ISeriesRegistry} from "./ISeriesRegistry.sol";
import {
    AccountId,
    AssetId,
    CollateralLockId,
    PositionId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {TerminalLiabilityReplacement} from "../types/CollateralTypes.sol";
import {
    PositionCreation,
    PositionEconomics,
    PositionLifecycle,
    PositionProvenance,
    PositionStatus
} from "../types/PositionTypes.sol";
import {Lots} from "../types/Units.sol";
import {PositionRiskSnapshot} from "../types/RiskTypes.sol";

interface IPositionEngine is IPositionEngineTerminalState, ILifecyclePositionSource, ICompressionPositionSource {
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
    event PositionExactPayoffComputed(
        PositionId indexed positionId,
        bytes32 indexed fixingReference,
        bytes32 finalFixingsHash,
        uint128 evaluatedLots,
        int256 terminalTransferMinor
    );
    event PositionQuantityChanged(
        PositionId indexed positionId,
        uint128 remainingLots,
        uint128 exercisedLots,
        uint128 closedLots,
        uint64 lifecycleNonce,
        bytes32 indexed transitionReference
    );

    event PositionFundingLockCreated(
        CollateralLockId indexed lockId,
        bytes32 indexed lockReference,
        AccountId indexed accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry,
        address requester
    );

    event PositionFundingLockReleased(
        CollateralLockId indexed lockId, bytes32 indexed lockReference, address indexed requester
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
    error PositionFundingMismatch(bytes32 liabilityKey, CollateralLockId lockId);
    error UnexpectedPositionFunding(bytes32 liabilityKey, CollateralLockId lockId);
    error UnauthorizedPositionFundingRequester(CollateralLockId lockId, address expected, address actual);
    error UnsupportedTerminalAlternative(PositionStatus status);
    error ExactLotsCapabilityMismatch(address implementation, bytes32 actualCapability);
    error InvalidPositionQuantity(PositionId positionId, uint128 remaining, uint128 requested);
    error LifecycleOwnerMismatch(PositionId positionId, AccountId expected, AccountId actual);
    error LifecycleNonceMismatch(PositionId positionId, uint64 expected, uint64 actual);
    error PositionRiskAccountMismatch(PositionId positionId, AccountId accountId);
    error PositionRiskLotsOverflow(PositionId positionId, uint128 lots);

    function createPosition(PositionCreation calldata creation) external returns (PositionId positionId);

    function createLifecycleSuccessor(PositionCreation calldata creation) external returns (PositionId positionId);
    function createLifecycleSuccessorWithProvenance(
        PositionCreation calldata creation,
        PositionProvenance calldata provenance
    ) external returns (PositionId positionId);
    function replaceLifecycleReservations(
        TerminalLiabilityReservationId[] calldata sourceReservationIds,
        TerminalLiabilityReplacement[] calldata replacements
    ) external returns (TerminalLiabilityReservationId[] memory replacementReservationIds);

    function createPositionFundingLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry
    ) external returns (CollateralLockId lockId);

    function releasePositionFundingLock(CollateralLockId lockId) external;

    function positionFundingRequester(CollateralLockId lockId) external view returns (address);

    function seriesRegistry() external view returns (ISeriesRegistry);

    function collateralVault() external view returns (ICollateralVault);

    function beginFixing(PositionId positionId) external;

    function acceptFinalFixing(PositionId positionId, bytes32 fixingReference, bytes calldata finalFixings) external;
    function exercisePositionQuantity(
        PositionId positionId,
        Lots exerciseLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        bytes32 fixingReference,
        bytes calldata finalFixings
    ) external;
    function abandonPositionQuantity(
        PositionId positionId,
        Lots abandonLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        bytes32 transitionReference
    ) external;
    function closePositionQuantity(
        PositionId positionId,
        Lots closeLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        PositionStatus terminalStatus,
        bytes32 transitionReference
    ) external;
    function transferLifecycleOwner(
        PositionId positionId,
        AccountId currentOwnerAccountId,
        AccountId newOwnerAccountId,
        uint64 expectedOwnerNonce,
        bytes32 transitionReference
    ) external;

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

    function positionRiskSnapshot(PositionId positionId, AccountId accountId)
        external
        view
        returns (PositionRiskSnapshot memory snapshot);

    function payoffTerms(PositionId positionId) external view returns (bytes memory);

    function positionStatus(PositionId positionId) external view returns (PositionStatus);

    function positionCount() external view returns (uint256);
}
