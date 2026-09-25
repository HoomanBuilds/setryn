// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {EvidenceOriginId, SeriesId} from "../types/Identifiers.sol";
import {
    FixingProposal,
    FixingResolutionKind,
    FixingResult,
    HistoricalObservation,
    SequencerEvidence
} from "../types/FixingTypes.sol";

library FixingEvidenceLib {
    bytes32 internal constant SEQUENCER_EVIDENCE_TYPEHASH = keccak256(
        "SetrynSequencerEvidenceV1(bool sequencerUp,bool inRecoveryGrace,uint64 recoveryGraceEndsAt,bytes32 proofHash)"
    );
    bytes32 internal constant OBSERVATION_TYPEHASH = keccak256(
        "SetrynHistoricalObservationV1(int256 value,uint128 weight,uint64 observedAt,uint64 publishedAt,uint64 providerSequence,uint16 confidenceBps,uint8 decimals,bytes32 finalityReference,bytes32 itemEvidenceHash,bytes32 sequencerEvidenceHash)"
    );
    bytes32 internal constant OBSERVATIONS_TYPEHASH =
        keccak256("SetrynHistoricalObservationsV1(bytes32 observationHashesHash)");
    bytes32 internal constant FIXING_KEY_TYPEHASH = keccak256(
        "SetrynFixingKeyV1(uint256 chainId,address fixingEngine,bytes32 seriesId,uint32 seriesVersion,uint8 slot)"
    );
    bytes32 internal constant PROPOSAL_TYPEHASH = keccak256(
        "SetrynFixingProposalV1(bytes32 fixingKey,bytes32 observationsHash,bytes32 evidenceHash,bytes32 completenessHash,bytes32 evidenceOriginId,uint64 batchSequence,uint8 candidateIndex,uint8 decimals,int256 value)"
    );
    bytes32 internal constant RESULT_TYPEHASH = keccak256(
        "SetrynFixingResultV1(bytes32 fixingKey,bytes32 proposalHash,uint8 resolutionKind,uint64 effectiveAt,uint8 candidateIndex,uint8 decimals,int256 value,int256 terminalDisruptionTransferMinorPerLot)"
    );

    function hashSequencerEvidence(SequencerEvidence memory evidence) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SEQUENCER_EVIDENCE_TYPEHASH,
                evidence.sequencerUp,
                evidence.inRecoveryGrace,
                evidence.recoveryGraceEndsAt,
                evidence.proofHash
            )
        );
    }

    function hashObservation(HistoricalObservation memory observation) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                OBSERVATION_TYPEHASH,
                observation.value,
                observation.weight,
                observation.observedAt,
                observation.publishedAt,
                observation.providerSequence,
                observation.confidenceBps,
                observation.decimals,
                observation.finalityReference,
                observation.itemEvidenceHash,
                hashSequencerEvidence(observation.sequencer)
            )
        );
    }

    function hashObservations(HistoricalObservation[] calldata observations) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](observations.length);
        for (uint256 i; i < observations.length; ++i) {
            hashes[i] = hashObservation(observations[i]);
        }
        return keccak256(abi.encode(OBSERVATIONS_TYPEHASH, keccak256(abi.encodePacked(hashes))));
    }

    function deriveFixingKey(uint256 chainId, address fixingEngine, SeriesId seriesId, uint32 seriesVersion, uint8 slot)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(FIXING_KEY_TYPEHASH, chainId, fixingEngine, SeriesId.unwrap(seriesId), seriesVersion, slot)
        );
    }

    function hashProposal(bytes32 fixingKey, FixingProposal memory proposal) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PROPOSAL_TYPEHASH,
                fixingKey,
                proposal.observationsHash,
                proposal.evidenceHash,
                proposal.completenessHash,
                EvidenceOriginId.unwrap(proposal.evidenceOriginId),
                proposal.batchSequence,
                proposal.candidateIndex,
                proposal.decimals,
                proposal.value
            )
        );
    }

    function hashResult(bytes32 fixingKey, FixingResult memory result) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RESULT_TYPEHASH,
                fixingKey,
                result.proposalHash,
                uint8(result.resolutionKind),
                result.effectiveAt,
                result.candidateIndex,
                result.decimals,
                result.value,
                result.terminalDisruptionTransferMinorPerLot
            )
        );
    }
}

