// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPortfolioRiskAdapterV1} from "../interfaces/IPortfolioRiskAdapterV1.sol";
import {PositionId, SeriesId} from "../types/Identifiers.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskResult,
    RiskAdmissionId,
    RiskAdmissionRequest,
    RiskEvaluationContext,
    RiskObservation
} from "../types/RiskTypes.sol";
import {PriceTicks} from "../types/Units.sol";

library PortfolioRiskLib {
    uint256 internal constant MAXIMUM_POSITIONS = 32;
    uint256 internal constant MAXIMUM_OBSERVATIONS = 64;
    uint256 internal constant RISK_RESULT_BYTES = 384;

    bytes32 internal constant POSITION_TYPEHASH = keccak256(
        "SetrynPortfolioPositionWitnessV1(bytes32 positionId,bytes32 seriesId,uint32 seriesVersion,int128 signedLots,int128 entryPriceTicks,uint128 maximumTerminalLiabilityBaseUnits,bytes32 economicsHash)"
    );
    bytes32 internal constant OBSERVATION_TYPEHASH =
        keccak256("SetrynRiskObservationV1(bytes32 observationKey,bytes32 valueHash,uint64 observedAt)");
    bytes32 internal constant REQUEST_TYPEHASH = keccak256(
        "SetrynRiskAdmissionRequestV1(bytes32 accountId,bytes32 riskDomainId,uint32 riskDomainVersion,uint128 openInterestIncreaseBaseUnits,uint128 terminalLiabilityIncreaseBaseUnits,uint64 deadline,uint256 nonce,bytes32 salt,uint256 chainId,address engine)"
    );

    error InvalidPortfolioWitness();
    error InvalidObservations();
    error RiskAdapterCallFailed();
    error InvalidRiskAdapterReturn(uint256 length);

    function hashPositions(PortfolioPositionWitness[] memory positions) internal pure returns (bytes32 result) {
        if (positions.length == 0 || positions.length > MAXIMUM_POSITIONS) revert InvalidPortfolioWitness();
        bytes32 previous;
        bytes32[] memory hashes = new bytes32[](positions.length);
        for (uint256 i; i < positions.length; ++i) {
            PortfolioPositionWitness memory position = positions[i];
            bytes32 positionId = PositionId.unwrap(position.positionId);
            if (
                positionId == bytes32(0) || positionId <= previous || SeriesId.unwrap(position.seriesId) == bytes32(0)
                    || position.seriesVersion == 0 || position.signedLots == 0 || position.economicsHash == bytes32(0)
            ) revert InvalidPortfolioWitness();
            previous = positionId;
            hashes[i] = keccak256(
                abi.encode(
                    POSITION_TYPEHASH,
                    positionId,
                    SeriesId.unwrap(position.seriesId),
                    position.seriesVersion,
                    position.signedLots,
                    PriceTicks.unwrap(position.entryPriceTicks),
                    position.maximumTerminalLiabilityBaseUnits,
                    position.economicsHash
                )
            );
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashObservations(RiskObservation[] memory observations, uint64 maximumAge, uint256 currentTimestamp)
        internal
        pure
        returns (bytes32 result)
    {
        if (observations.length == 0 || observations.length > MAXIMUM_OBSERVATIONS) revert InvalidObservations();
        bytes32 previous;
        bytes32[] memory hashes = new bytes32[](observations.length);
        for (uint256 i; i < observations.length; ++i) {
            RiskObservation memory observation = observations[i];
            if (
                observation.observationKey == bytes32(0) || observation.observationKey <= previous
                    || observation.valueHash == bytes32(0) || observation.observedAt > currentTimestamp
                    || currentTimestamp - observation.observedAt > maximumAge
            ) revert InvalidObservations();
            previous = observation.observationKey;
            hashes[i] = keccak256(
                abi.encode(
                    OBSERVATION_TYPEHASH, observation.observationKey, observation.valueHash, observation.observedAt
                )
            );
        }
        result = keccak256(abi.encodePacked(hashes));
    }

    function hashRequest(RiskAdmissionRequest memory request, uint256 chainId, address engine)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(REQUEST_TYPEHASH, request, chainId, engine));
    }

    function deriveAdmissionId(bytes32 requestHash) internal pure returns (RiskAdmissionId) {
        return RiskAdmissionId.wrap(keccak256(abi.encode(keccak256("SetrynRiskAdmissionIdV1"), requestHash)));
    }

    function hashResult(PortfolioRiskResult memory result) internal pure returns (bytes32) {
        return keccak256(abi.encode(result));
    }

    function boundedEvaluate(
        address adapter,
        uint64 maximumGas,
        RiskEvaluationContext memory context,
        PortfolioPositionWitness[] memory positions,
        RiskObservation[] memory observations
    ) internal view returns (PortfolioRiskResult memory result) {
        bytes memory input = abi.encodeCall(
            IPortfolioRiskAdapterV1.evaluatePortfolio, (context, positions, observations)
        );
        bytes memory output = new bytes(RISK_RESULT_BYTES);
        bool success;
        uint256 returnSize;
        assembly ("memory-safe") {
            success := staticcall(
                maximumGas,
                adapter,
                add(input, 0x20),
                mload(input),
                add(output, 0x20),
                RISK_RESULT_BYTES
            )
            returnSize := returndatasize()
        }
        if (!success) revert RiskAdapterCallFailed();
        if (returnSize != RISK_RESULT_BYTES) revert InvalidRiskAdapterReturn(returnSize);
        result = abi.decode(output, (PortfolioRiskResult));
    }
}
