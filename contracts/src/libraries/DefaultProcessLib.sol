// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    DefaultExecutionResult,
    DefaultProcessId,
    DefaultProcessRules,
    InsuranceDepositId,
    InsurancePolicy,
    InsuranceReservationId,
    LiquidationBidId,
    LiquidationBidReveal,
    ObjectiveDefaultState
} from "../types/DefaultTypes.sol";
import {AccountId, CollateralId, PositionId, RiskDomainId} from "../types/Identifiers.sol";

library DefaultProcessLib {
    bytes32 internal constant SCORING_RULE = keccak256("SetrynDefaultScoringV1:ContributionDiscountCommitment");
    bytes32 internal constant INSURANCE_ALLOCATION_RULE = keccak256("SetrynInsuranceAllocationV1:WitnessOrder");
    bytes32 internal constant PROCESS_RULES_TYPEHASH = keccak256(
        "SetrynDefaultProcessRulesV1(uint32 maximumProofAgeSeconds,uint32 cureWindowSeconds,uint32 commitWindowSeconds,uint32 revealWindowSeconds,uint32 executionWindowSeconds,uint16 maximumBids,uint128 requiredBondMinor,uint128 minimumCapacityMinor,bytes32 recoveryAccountId,bytes32 bidderQualificationHash,bytes32 scoringRuleId,bytes32 terminalRuleId)"
    );
    bytes32 internal constant INSURANCE_POLICY_TYPEHASH = keccak256(
        "SetrynInsurancePolicyV1(uint128 maximumDrawPerDefaultMinor,uint8 maximumDepositsPerDraw,bytes32 insuranceAccountId,bytes32 allocationRuleId)"
    );
    bytes32 internal constant DEFAULT_STATE_TYPEHASH = keccak256(
        "SetrynObjectiveDefaultStateV1(bytes32 positionId,bytes32 accountId,bytes32 riskDomainId,bytes32 collateralId,uint32 riskDomainVersion,uint64 evaluatedAt,uint64 finalResolutionAt,uint64 settlementDeadline,uint64 sequence,uint128 maintenanceRequirementMinor,uint128 collateralValueMinor,uint128 deficiencyMinor,uint128 availableCollateralMinor,bytes32 configurationHash,bytes32 witnessHash,bytes32 observationsHash)"
    );
    bytes32 internal constant PROCESS_ID_TYPEHASH = keccak256(
        "SetrynDefaultProcessIdV1(uint256 chainId,address engine,bytes32 positionId,bytes32 accountId,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 openingProofHash)"
    );
    bytes32 internal constant BID_REVEAL_TYPEHASH = keccak256(
        "SetrynLiquidationBidRevealV1(bytes32 processId,address bidder,bytes32 bidderAccountId,uint128 takeoverContributionMinor,uint128 discountMinor,uint128 maximumInsuranceDrawMinor,bytes32 eligibilityEvidenceHash,bytes32 revealSalt)"
    );
    bytes32 internal constant BID_ID_TYPEHASH = keccak256(
        "SetrynLiquidationBidIdV1(bytes32 processId,address bidder,bytes32 bidderAccountId,bytes32 sealedBidHash)"
    );
    bytes32 internal constant INSURANCE_DEPOSIT_ID_TYPEHASH = keccak256(
        "SetrynInsuranceDepositIdV1(uint256 chainId,address engine,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 funderAccountId,bytes32 salt)"
    );
    bytes32 internal constant INSURANCE_RESERVATION_ID_TYPEHASH =
        keccak256("SetrynInsuranceReservationIdV1(bytes32 processId,uint128 amountMinor)");
    bytes32 internal constant OUTCOME_TYPEHASH = keccak256(
        "SetrynDefaultOutcomeV1(bytes32 processId,bytes32 winningBidId,bytes32 insuranceReservationId,bytes32 executionHash,bytes32 positionOutcomeReference,bytes32 successorAccountId,uint128 defaulterCollateralAppliedMinor,uint128 takeoverContributionAppliedMinor,uint128 insuranceAppliedMinor,uint128 fullyBackedClaimMinor,uint128 terminalResidualMinor)"
    );

    function hashRules(DefaultProcessRules memory rules) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PROCESS_RULES_TYPEHASH,
                rules.maximumProofAgeSeconds,
                rules.cureWindowSeconds,
                rules.commitWindowSeconds,
                rules.revealWindowSeconds,
                rules.executionWindowSeconds,
                rules.maximumBids,
                rules.requiredBondMinor,
                rules.minimumCapacityMinor,
                AccountId.unwrap(rules.recoveryAccountId),
                rules.bidderQualificationHash,
                rules.scoringRuleId,
                rules.terminalRuleId
            )
        );
    }

    function hashInsurancePolicy(InsurancePolicy memory policy) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INSURANCE_POLICY_TYPEHASH,
                policy.maximumDrawPerDefaultMinor,
                policy.maximumDepositsPerDraw,
                AccountId.unwrap(policy.insuranceAccountId),
                policy.allocationRuleId
            )
        );
    }

    function hashObjectiveState(ObjectiveDefaultState memory state) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DEFAULT_STATE_TYPEHASH,
                PositionId.unwrap(state.positionId),
                AccountId.unwrap(state.accountId),
                RiskDomainId.unwrap(state.riskDomainId),
                CollateralId.unwrap(state.collateralId),
                state.riskDomainVersion,
                state.evaluatedAt,
                state.finalResolutionAt,
                state.settlementDeadline,
                state.sequence,
                state.maintenanceRequirementMinor,
                state.collateralValueMinor,
                state.deficiencyMinor,
                state.availableCollateralMinor,
                state.configurationHash,
                state.witnessHash,
                state.observationsHash
            )
        );
    }

    function deriveProcessId(
        uint256 chainId,
        address engine,
        ObjectiveDefaultState memory state,
        bytes32 openingProofHash
    ) internal pure returns (DefaultProcessId) {
        return DefaultProcessId.wrap(
            keccak256(
                abi.encode(
                    PROCESS_ID_TYPEHASH,
                    chainId,
                    engine,
                    PositionId.unwrap(state.positionId),
                    AccountId.unwrap(state.accountId),
                    RiskDomainId.unwrap(state.riskDomainId),
                    state.riskDomainVersion,
                    openingProofHash
                )
            )
        );
    }

    function hashBidReveal(LiquidationBidReveal memory bid) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BID_REVEAL_TYPEHASH,
                DefaultProcessId.unwrap(bid.processId),
                bid.bidder,
                AccountId.unwrap(bid.bidderAccountId),
                bid.takeoverContributionMinor,
                bid.discountMinor,
                bid.maximumInsuranceDrawMinor,
                bid.eligibilityEvidenceHash,
                bid.revealSalt
            )
        );
    }

    function deriveBidId(DefaultProcessId processId, address bidder, AccountId bidderAccountId, bytes32 sealedBidHash)
        internal
        pure
        returns (LiquidationBidId)
    {
        return LiquidationBidId.wrap(
            keccak256(
                abi.encode(
                    BID_ID_TYPEHASH,
                    DefaultProcessId.unwrap(processId),
                    bidder,
                    AccountId.unwrap(bidderAccountId),
                    sealedBidHash
                )
            )
        );
    }

    function deriveInsuranceDepositId(
        uint256 chainId,
        address engine,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        AccountId funderAccountId,
        bytes32 salt
    ) internal pure returns (InsuranceDepositId) {
        return InsuranceDepositId.wrap(
            keccak256(
                abi.encode(
                    INSURANCE_DEPOSIT_ID_TYPEHASH,
                    chainId,
                    engine,
                    RiskDomainId.unwrap(riskDomainId),
                    riskDomainVersion,
                    AccountId.unwrap(funderAccountId),
                    salt
                )
            )
        );
    }

    function deriveInsuranceReservationId(DefaultProcessId processId, uint128 amountMinor)
        internal
        pure
        returns (InsuranceReservationId)
    {
        return InsuranceReservationId.wrap(
            keccak256(abi.encode(INSURANCE_RESERVATION_ID_TYPEHASH, DefaultProcessId.unwrap(processId), amountMinor))
        );
    }

    function isBetterBid(
        uint128 candidateContribution,
        uint128 candidateDiscount,
        LiquidationBidId candidateId,
        uint128 incumbentContribution,
        uint128 incumbentDiscount,
        LiquidationBidId incumbentId
    ) internal pure returns (bool) {
        if (candidateContribution != incumbentContribution) {
            return candidateContribution > incumbentContribution;
        }
        if (candidateDiscount != incumbentDiscount) return candidateDiscount < incumbentDiscount;
        return LiquidationBidId.unwrap(candidateId) < LiquidationBidId.unwrap(incumbentId);
    }

    function hashOutcome(
        DefaultProcessId processId,
        LiquidationBidId winningBidId,
        InsuranceReservationId reservationId,
        DefaultExecutionResult memory result,
        uint128 terminalResidualMinor
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                OUTCOME_TYPEHASH,
                DefaultProcessId.unwrap(processId),
                LiquidationBidId.unwrap(winningBidId),
                InsuranceReservationId.unwrap(reservationId),
                result.executionHash,
                result.positionOutcomeReference,
                AccountId.unwrap(result.successorAccountId),
                result.defaulterCollateralAppliedMinor,
                result.takeoverContributionAppliedMinor,
                result.insuranceAppliedMinor,
                result.fullyBackedClaimMinor,
                terminalResidualMinor
            )
        );
    }
}
