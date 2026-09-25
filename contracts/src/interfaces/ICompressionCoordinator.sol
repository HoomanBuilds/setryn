// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    CompressionConsent,
    CompressionPlanDefinition,
    CompressionPlanId,
    CompressionPlanRecord,
    CompressionPosition,
    CompressionSuccessor,
    ReplacementCollateral
} from "../types/CompressionTypes.sol";

interface ICompressionCoordinator {
    event CompressionAuthorized(
        CompressionPlanId indexed planId,
        bytes32 indexed definitionHash,
        bytes32 indexed planNonce,
        uint16 inputCount,
        uint16 successorCount,
        uint16 accountCount
    );
    event CompressionExecuted(CompressionPlanId indexed planId, bytes32 indexed outcomeHash);
    event CompressionCancelled(CompressionPlanId indexed planId, bytes32 indexed reason);
    event CompressionExpired(CompressionPlanId indexed planId);

    error ZeroDependency(address dependency);
    error DependencyHasNoCode(address dependency);
    error InvalidCompressionDefinition();
    error InvalidCompressionInput();
    error InvalidCompressionSuccessor();
    error PositionRecordMismatch(bytes32 positionId);
    error PositionNotCompressionEligible(bytes32 positionId);
    error CrossRiskDomainCompression();
    error CrossCollateralCompression();
    error ExposureNotConserved(bytes32 accountId, bytes32 seriesId, bytes32 economicsHash);
    error LiabilityToleranceExceeded(bytes32 accountId, uint256 beforeAmount, uint256 afterAmount, uint256 tolerance);
    error ReplacementCollateralMismatch(bytes32 accountId);
    error MissingAccountConsent(bytes32 accountId);
    error InvalidConsentSignature(bytes32 accountId, address signer);
    error ConsentExpired(bytes32 accountId, uint64 deadline);
    error ConsentNonceAlreadyUsed(bytes32 accountId, uint256 nonce);
    error PlanNonceAlreadyUsed(bytes32 planNonce);
    error UnknownCompressionPlan(CompressionPlanId planId);
    error InvalidCompressionPlanState(CompressionPlanId planId);
    error CompressionDeadlinePassed(uint64 deadline, uint256 currentTimestamp);
    error ZeroReference();

    function authorizeCompression(
        CompressionPlanDefinition calldata definition,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral,
        CompressionConsent[] calldata consents,
        bytes[] calldata signatures
    ) external returns (CompressionPlanId planId);
    function executeCompression(
        CompressionPlanDefinition calldata definition,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral
    ) external returns (bytes32 outcomeHash);
    function cancelCompression(CompressionPlanId planId, bytes32 reason) external;
    function expireCompression(CompressionPlanDefinition calldata definition) external;
    function getCompressionPlan(CompressionPlanId planId) external view returns (CompressionPlanRecord memory record);
}
