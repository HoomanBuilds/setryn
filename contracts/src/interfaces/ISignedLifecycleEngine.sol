// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleActionRecord,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecycleInput,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";

interface ISignedLifecycleEngine {
    event LifecycleActionAuthorized(
        LifecycleActionId indexed actionId,
        bytes32 indexed actionHash,
        uint8 indexed actionKind,
        address actor,
        bytes32 actorAccountId,
        address permittedExecutor
    );
    event LifecycleActionExecuted(LifecycleActionId indexed actionId, bytes32 indexed outcomeHash);
    event LifecycleActionCancelled(LifecycleActionId indexed actionId, bytes32 indexed reason);
    event LifecycleActionExpired(LifecycleActionId indexed actionId);

    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error InvalidLifecycleAction();
    error InvalidLifecyclePayload();
    error InvalidLifecycleState(LifecycleActionId actionId);
    error UnknownLifecycleAction(LifecycleActionId actionId);
    error PositionSnapshotMismatch(bytes32 positionId);
    error PositionActionIneligible(bytes32 positionId, uint8 actionKind);
    error InvalidActorSignature(address actor);
    error InvalidConsentSignature(bytes32 accountId, address signer);
    error MissingConsent(bytes32 accountId);
    error NonceAlreadyUsed(bytes32 accountId, uint256 nonce);
    error UnauthorizedExecutor(address required, address caller);
    error LifecycleDeadlinePassed(uint64 deadline, uint256 currentTimestamp);
    error ExerciseWindowClosed(bytes32 positionId, uint64 opensAt, uint64 closesAt, uint256 currentTimestamp);
    error ExerciseQuantityExceeded(bytes32 positionId, uint128 remaining, uint128 requested);
    error LapseNotAvailable(bytes32 positionId, uint64 lapseEligibleAt, uint256 currentTimestamp);
    error QuantityNotConserved();
    error LiabilityToleranceExceeded(bytes32 accountId, uint256 beforeAmount, uint256 afterAmount, uint256 tolerance);
    error CollateralReplacementMismatch(bytes32 accountId);
    error PackageBreakNotAuthorized(bytes32 accountId);
    error RiskDomainUnavailable(bytes32 riskDomainId, uint32 version);
    error ZeroReference();

    function authorizeAction(
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements,
        LifecycleConsent[] calldata consents,
        bytes[] calldata consentSignatures,
        bytes calldata actorSignature
    ) external returns (LifecycleActionId actionId);
    function executeAction(
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements,
        LifecycleConsent[] calldata consents
    ) external returns (bytes32 outcomeHash);
    function cancelAction(LifecycleActionId actionId, bytes32 reason) external;
    function expireAction(LifecycleAction calldata action) external;
    function getAction(LifecycleActionId actionId) external view returns (LifecycleActionRecord memory record);
}
