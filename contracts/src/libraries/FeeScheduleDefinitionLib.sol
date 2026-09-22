// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {FeeScheduleDefinition} from "../types/FeeScheduleDefinition.sol";
import {AssetId, FeeActionId, FeeModelId, FeeScheduleId} from "../types/Identifiers.sol";
import {FeeRatePpm, FeeRatePpmLib} from "../types/Units.sol";
import {IdLib} from "./IdLib.sol";

error ZeroFeeScheduleNamespaceId();

error ZeroFeeScheduleKey();

error ZeroFeeModelId();

error ZeroFeeScheduleSettlementAssetId();

error ZeroFeeScheduleSettlementAssetVersion();

error ZeroFeeRulesHash();

error ZeroFeeRecipientsHash();

error ZeroFeeScheduleEvidenceHash();

error FeeChargeRateOutOfRange(FeeRatePpm maxChargeRatePpm);

error FeeRebateRateOutOfRange(FeeRatePpm maxRebateRatePpm);

/// @dev Every lever is zero, so the schedule can neither charge nor pay anything under any rule set
/// the commitment later resolves to. An inert schedule is a qualification mistake, not a policy.
error IneffectiveFeeSchedule();

library FeeScheduleDefinitionLib {
    using FeeRatePpmLib for FeeRatePpm;

    /// @dev Published tags for the fee models V1 consumers are expected to meet first. They are
    /// convenience constants only. Registration and hashing accept any nonzero FeeModelId, so a
    /// model invented after this deployment needs no change here, and a fee model contract must
    /// still require the exact model it implements instead of assuming this list is exhaustive.
    FeeModelId internal constant FEE_MODEL_FLAT_PER_ACTION =
        FeeModelId.wrap(keccak256("SetrynFeeModelV1:FlatPerAction"));
    FeeModelId internal constant FEE_MODEL_AD_VALOREM = FeeModelId.wrap(keccak256("SetrynFeeModelV1:AdValorem"));
    FeeModelId internal constant FEE_MODEL_MAKER_TAKER = FeeModelId.wrap(keccak256("SetrynFeeModelV1:MakerTaker"));
    FeeModelId internal constant FEE_MODEL_VOLUME_TIERED = FeeModelId.wrap(keccak256("SetrynFeeModelV1:VolumeTiered"));

    /// @dev Published tags for the actions a first fee model is likely to price. No FeeActionId is
    /// ever stored in a definition or read by this registry: the action space lives entirely behind
    /// feeRulesHash, and these constants exist so independent producers converge on one spelling for
    /// the common actions rather than because the set is closed.
    FeeActionId internal constant FEE_ACTION_MAKER_FILL = FeeActionId.wrap(keccak256("SetrynFeeActionV1:MakerFill"));
    FeeActionId internal constant FEE_ACTION_TAKER_FILL = FeeActionId.wrap(keccak256("SetrynFeeActionV1:TakerFill"));
    FeeActionId internal constant FEE_ACTION_SETTLEMENT = FeeActionId.wrap(keccak256("SetrynFeeActionV1:Settlement"));
    FeeActionId internal constant FEE_ACTION_EXERCISE = FeeActionId.wrap(keccak256("SetrynFeeActionV1:Exercise"));
    FeeActionId internal constant FEE_ACTION_LIQUIDATION = FeeActionId.wrap(keccak256("SetrynFeeActionV1:Liquidation"));
    FeeActionId internal constant FEE_ACTION_FUNDING = FeeActionId.wrap(keccak256("SetrynFeeActionV1:Funding"));

    /// @dev The typestring is kept beside the typehash so a test can prove they agree. Solidity
    /// cannot hash a string constant inside another constant initializer, so the literal is repeated
    /// rather than referenced.
    ///
    /// @dev Each literal carries its version. A hashing rule may never be edited in place; it is
    /// replaced by a new V2 literal, so previously derived hashes can never silently re-derive.
    ///
    /// @dev The identity key is deliberately minimal: the namespaced schedule name and nothing else.
    /// Repricing, changing fee model, repointing at a newer settlement binding, or deploying on
    /// another chain all stay the same FeeScheduleId under a new chain-local version, which is what
    /// makes a schedule reference in a signed order or a stored receipt stable across repricings.
    string internal constant FEE_SCHEDULE_KEY_TYPESTRING =
        "SetrynFeeScheduleKeyV1(bytes32 namespaceId,bytes32 scheduleKey)";
    bytes32 internal constant FEE_SCHEDULE_KEY_TYPEHASH =
        keccak256("SetrynFeeScheduleKeyV1(bytes32 namespaceId,bytes32 scheduleKey)");

    /// @dev chainId is hashed in deliberately, the opposite of canonical identity. The settlement
    /// binding version is a chain-local operational dependency and every bound below is denominated
    /// in that chain-local token, so the same rate card qualified on two chains must never share one
    /// commitment.
    string internal constant FEE_SCHEDULE_DEFINITION_TYPESTRING =
        "SetrynFeeScheduleDefinitionV1(bytes32 namespaceId,bytes32 scheduleKey,bytes32 feeModelId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 feeRulesHash,bytes32 recipientsHash,uint32 maxChargeRatePpm,uint32 maxRebateRatePpm,uint128 maxFlatChargeBaseUnits,uint128 maxFlatRebateBaseUnits,bytes32 evidenceHash,uint256 chainId)";
    bytes32 internal constant FEE_SCHEDULE_DEFINITION_TYPEHASH = keccak256(
        "SetrynFeeScheduleDefinitionV1(bytes32 namespaceId,bytes32 scheduleKey,bytes32 feeModelId,bytes32 settlementAssetId,uint32 settlementAssetVersion,bytes32 feeRulesHash,bytes32 recipientsHash,uint32 maxChargeRatePpm,uint32 maxRebateRatePpm,uint128 maxFlatChargeBaseUnits,uint128 maxFlatRebateBaseUnits,bytes32 evidenceHash,uint256 chainId)"
    );

    /// @dev The version commitment binds the lineage identity, the sequence number, and the chain to
    /// the definition, so a stored record can never be replayed as a different version of itself, as
    /// a version of a different schedule, or as the same version on another chain.
    string internal constant FEE_SCHEDULE_VERSION_TYPESTRING =
        "SetrynFeeScheduleVersionV1(bytes32 feeScheduleId,uint32 version,bytes32 definitionHash,uint256 chainId)";
    bytes32 internal constant FEE_SCHEDULE_VERSION_TYPEHASH = keccak256(
        "SetrynFeeScheduleVersionV1(bytes32 feeScheduleId,uint32 version,bytes32 definitionHash,uint256 chainId)"
    );

    /// @dev Checks only what the definition can be judged on by itself. Existence and current status
    /// of the settlement binding belong to the registry, which owns the external reads.
    function validate(FeeScheduleDefinition memory definition) internal pure {
        if (definition.namespaceId == bytes32(0)) {
            revert ZeroFeeScheduleNamespaceId();
        }
        if (definition.scheduleKey == bytes32(0)) {
            revert ZeroFeeScheduleKey();
        }
        if (FeeModelId.unwrap(definition.feeModelId) == bytes32(0)) {
            revert ZeroFeeModelId();
        }
        if (AssetId.unwrap(definition.settlementAssetId) == bytes32(0)) {
            revert ZeroFeeScheduleSettlementAssetId();
        }
        if (definition.settlementAssetVersion == 0) {
            revert ZeroFeeScheduleSettlementAssetVersion();
        }
        if (definition.feeRulesHash == bytes32(0)) {
            revert ZeroFeeRulesHash();
        }
        if (definition.recipientsHash == bytes32(0)) {
            revert ZeroFeeRecipientsHash();
        }
        if (definition.evidenceHash == bytes32(0)) {
            revert ZeroFeeScheduleEvidenceHash();
        }
        _validateBounds(definition);
    }

    /// @dev Hashes the identity key alone, so repricing a schedule, moving it to another fee model,
    /// repointing it at a newer settlement binding, or revising its recipient set can never mint a
    /// second identity for the same namespaced schedule name.
    function hashKey(FeeScheduleDefinition memory definition) internal pure returns (bytes32) {
        return keccak256(abi.encode(FEE_SCHEDULE_KEY_TYPEHASH, definition.namespaceId, definition.scheduleKey));
    }

    /// @dev Hashes every economic field plus the chain, so two qualifications of one lineage that
    /// would have disagreed on the model, the settlement binding, either commitment, any of the four
    /// bounds, or the review evidence are distinct and the duplicate check above is exact.
    function hashDefinition(FeeScheduleDefinition memory definition, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FEE_SCHEDULE_DEFINITION_TYPEHASH,
                definition.namespaceId,
                definition.scheduleKey,
                FeeModelId.unwrap(definition.feeModelId),
                AssetId.unwrap(definition.settlementAssetId),
                definition.settlementAssetVersion,
                definition.feeRulesHash,
                definition.recipientsHash,
                FeeRatePpm.unwrap(definition.maxChargeRatePpm),
                FeeRatePpm.unwrap(definition.maxRebateRatePpm),
                definition.maxFlatChargeBaseUnits,
                definition.maxFlatRebateBaseUnits,
                definition.evidenceHash,
                chainId
            )
        );
    }

    function hashVersion(FeeScheduleId feeScheduleId, uint32 version, bytes32 definitionHash, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                FEE_SCHEDULE_VERSION_TYPEHASH, FeeScheduleId.unwrap(feeScheduleId), version, definitionHash, chainId
            )
        );
    }

    function deriveFeeScheduleId(FeeScheduleDefinition memory definition) internal pure returns (FeeScheduleId) {
        return IdLib.deriveFeeScheduleId(hashKey(definition));
    }

    /// @dev Zero is a legitimate value for any single bound and means that lever is switched off: a
    /// pure ad valorem schedule has no flat bound, and a venue that never pays a rebate has no
    /// rebate bound. Zero across all four is not a policy, it is an inert schedule, so it is refused
    /// rather than registered as a version nobody can charge under.
    ///
    /// @dev The charge and rebate envelopes are independent. A rebate envelope larger than the
    /// charge envelope, and a rebate-only schedule with no charge lever at all, are both legitimate
    /// policies: a maker rebate program or a market incentive program is funded from a separately
    /// reserved protocol or incentive budget, not from the charge side of the same event. Solvency
    /// is not a property of a per-event policy envelope, and this library deliberately asserts none:
    /// it has no event amount, no notional, and no budget balance to judge one against. The
    /// consuming fee engine and vault own reservation, payout, and conservation, and they must
    /// verify rebate funding before settlement. Acceptance here is never evidence of funding.
    function _validateBounds(FeeScheduleDefinition memory definition) private pure {
        if (!definition.maxChargeRatePpm.isAtMostOne()) {
            revert FeeChargeRateOutOfRange(definition.maxChargeRatePpm);
        }
        if (!definition.maxRebateRatePpm.isAtMostOne()) {
            revert FeeRebateRateOutOfRange(definition.maxRebateRatePpm);
        }
        if (
            definition.maxChargeRatePpm.isZero() && definition.maxRebateRatePpm.isZero()
                && definition.maxFlatChargeBaseUnits == 0 && definition.maxFlatRebateBaseUnits == 0
        ) {
            revert IneffectiveFeeSchedule();
        }
    }
}
