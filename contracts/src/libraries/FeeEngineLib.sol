// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {FeeScheduleDefinitionLib} from "./FeeScheduleDefinitionLib.sol";
import {FeeComputation, FeeRecipient, FeeRecipientSet, FeeRule, FeeTier} from "../types/FeeEngineTypes.sol";
import {AccountId, FeeActionId, FeeModelId, FeeRemainderPolicyId} from "../types/Identifiers.sol";
import {FeeScheduleDefinition} from "../types/FeeScheduleDefinition.sol";
import {FeeRatePpm, PPM_DENOMINATOR} from "../types/Units.sol";

error EmptyFeeRules();
error TooManyFeeRules(uint256 actual, uint256 maximum);
error FeeRulesNotStrictlySorted(uint256 index);
error ZeroFeeAction(uint256 index);
error UnsupportedFeeModel(FeeModelId feeModelId);
error InvalidRuleForModel(uint256 index, FeeModelId feeModelId);
error EmptyFeeTiers(uint256 ruleIndex);
error TooManyFeeTiers(uint256 ruleIndex, uint256 actual, uint256 maximum);
error FeeTiersNotStrictlySorted(uint256 ruleIndex, uint256 tierIndex);
error FeeTierMustStartAtZero(uint256 ruleIndex);
error FeeRateExceedsSchedule(uint256 ruleIndex, uint256 tierIndex, uint32 actual, uint32 maximum, bool rebate);
error FlatFeeExceedsSchedule(uint256 ruleIndex, uint256 tierIndex, uint128 actual, uint128 maximum, bool rebate);
error EmptyFeeRecipients();
error TooManyFeeRecipients(uint256 actual, uint256 maximum);
error FeeRecipientsNotStrictlySorted(uint256 index);
error ZeroFeeRecipient(uint256 index);
error InvalidRecipientShare(uint256 index, uint32 sharePpm);
error RecipientSharesDoNotConserve(uint256 actual, uint256 expected);
error UnsupportedRemainderPolicy(FeeRemainderPolicyId policyId);
error InvalidRemainderRecipientIndex(uint8 index, uint256 recipientCount);
error UnknownFeeAction(FeeActionId actionId);
error FeeAmountOverflow(uint256 amount);

library FeeEngineLib {
    uint256 internal constant MAX_RULES = 16;
    uint256 internal constant MAX_TIERS = 16;
    uint256 internal constant MAX_RECIPIENTS = 8;

    FeeRemainderPolicyId internal constant REMAINDER_TO_DESIGNATED_RECIPIENT =
        FeeRemainderPolicyId.wrap(keccak256("SetrynFeeRemainderPolicyV1:DesignatedRecipient"));
    FeeActionId internal constant FEE_ACTION_SOLVER_REWARD =
        FeeActionId.wrap(keccak256("SetrynFeeActionV1:SolverReward"));
    FeeActionId internal constant FEE_ACTION_KEEPER_REWARD =
        FeeActionId.wrap(keccak256("SetrynFeeActionV1:KeeperReward"));
    FeeActionId internal constant FEE_ACTION_LIQUIDITY_INCENTIVE =
        FeeActionId.wrap(keccak256("SetrynFeeActionV1:LiquidityIncentive"));

    bytes32 internal constant FEE_TIER_TYPEHASH = keccak256(
        "SetrynFeeTierV1(uint128 minimumVolumeMinor,uint32 chargeRatePpm,uint32 rebateRatePpm,uint128 flatChargeMinor,uint128 flatRebateMinor)"
    );
    bytes32 internal constant FEE_RULE_TYPEHASH = keccak256(
        "SetrynFeeRuleV1(bytes32 actionId,bool requiresOpenSchedule,uint32 chargeRatePpm,uint32 rebateRatePpm,uint128 flatChargeMinor,uint128 flatRebateMinor,bytes32 tiersHash)"
    );
    bytes32 internal constant FEE_RULES_TYPEHASH = keccak256("SetrynFeeRulesV1(bytes32 ruleHashesHash)");
    bytes32 internal constant FEE_RECIPIENT_TYPEHASH =
        keccak256("SetrynFeeRecipientV1(bytes32 accountId,uint32 sharePpm)");
    bytes32 internal constant FEE_RECIPIENTS_TYPEHASH = keccak256(
        "SetrynFeeRecipientsV1(bytes32 remainderPolicyId,uint8 remainderRecipientIndex,bytes32 recipientHashesHash)"
    );

    function validateRules(FeeScheduleDefinition memory definition, FeeRule[] memory rules) internal pure {
        uint256 count = rules.length;
        if (count == 0) revert EmptyFeeRules();
        if (count > MAX_RULES) revert TooManyFeeRules(count, MAX_RULES);

        bytes32 previousAction;
        bool effective;
        for (uint256 i; i < count; ++i) {
            FeeRule memory rule = rules[i];
            bytes32 action = FeeActionId.unwrap(rule.actionId);
            if (action == bytes32(0)) revert ZeroFeeAction(i);
            if (i != 0 && action <= previousAction) revert FeeRulesNotStrictlySorted(i);
            _validateRule(definition, rule, i);
            effective = effective || _isEffective(rule);
            previousAction = action;
        }
        // A maker-taker rule may price one side at zero, because every fill consumes both fill actions and an omitted
        // rule would revert it. A rule set that prices nothing at all is still an inert policy and is refused; the
        // index one past the last rule names the set rather than any single rule.
        if (
            FeeModelId.unwrap(definition.feeModelId)
                    == FeeModelId.unwrap(FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER) && !effective
        ) revert InvalidRuleForModel(count, definition.feeModelId);
    }

    function validateRecipients(FeeRecipientSet memory set) internal pure {
        uint256 count = set.recipients.length;
        if (count == 0) revert EmptyFeeRecipients();
        if (count > MAX_RECIPIENTS) revert TooManyFeeRecipients(count, MAX_RECIPIENTS);
        if (
            FeeRemainderPolicyId.unwrap(set.remainderPolicyId)
                != FeeRemainderPolicyId.unwrap(REMAINDER_TO_DESIGNATED_RECIPIENT)
        ) revert UnsupportedRemainderPolicy(set.remainderPolicyId);
        if (set.remainderRecipientIndex >= count) {
            revert InvalidRemainderRecipientIndex(set.remainderRecipientIndex, count);
        }

        bytes32 previousAccount;
        uint256 totalShares;
        for (uint256 i; i < count; ++i) {
            FeeRecipient memory recipient = set.recipients[i];
            bytes32 account = AccountId.unwrap(recipient.accountId);
            if (account == bytes32(0)) revert ZeroFeeRecipient(i);
            if (i != 0 && account <= previousAccount) revert FeeRecipientsNotStrictlySorted(i);
            if (recipient.sharePpm == 0 || recipient.sharePpm > PPM_DENOMINATOR) {
                revert InvalidRecipientShare(i, recipient.sharePpm);
            }
            totalShares += recipient.sharePpm;
            previousAccount = account;
        }
        if (totalShares != PPM_DENOMINATOR) {
            revert RecipientSharesDoNotConserve(totalShares, PPM_DENOMINATOR);
        }
    }

    function hashRules(FeeRule[] memory rules) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](rules.length);
        for (uint256 i; i < rules.length; ++i) {
            hashes[i] = hashRule(rules[i]);
        }
        return keccak256(abi.encode(FEE_RULES_TYPEHASH, keccak256(abi.encodePacked(hashes))));
    }

    function hashRule(FeeRule memory rule) internal pure returns (bytes32) {
        bytes32[] memory tierHashes = new bytes32[](rule.tiers.length);
        for (uint256 i; i < rule.tiers.length; ++i) {
            FeeTier memory tier = rule.tiers[i];
            tierHashes[i] = keccak256(
                abi.encode(
                    FEE_TIER_TYPEHASH,
                    tier.minimumVolumeMinor,
                    FeeRatePpm.unwrap(tier.chargeRatePpm),
                    FeeRatePpm.unwrap(tier.rebateRatePpm),
                    tier.flatChargeMinor,
                    tier.flatRebateMinor
                )
            );
        }
        return keccak256(
            abi.encode(
                FEE_RULE_TYPEHASH,
                FeeActionId.unwrap(rule.actionId),
                rule.requiresOpenSchedule,
                FeeRatePpm.unwrap(rule.chargeRatePpm),
                FeeRatePpm.unwrap(rule.rebateRatePpm),
                rule.flatChargeMinor,
                rule.flatRebateMinor,
                keccak256(abi.encodePacked(tierHashes))
            )
        );
    }

    function hashRecipients(FeeRecipientSet memory set) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](set.recipients.length);
        for (uint256 i; i < set.recipients.length; ++i) {
            hashes[i] = keccak256(
                abi.encode(
                    FEE_RECIPIENT_TYPEHASH, AccountId.unwrap(set.recipients[i].accountId), set.recipients[i].sharePpm
                )
            );
        }
        return keccak256(
            abi.encode(
                FEE_RECIPIENTS_TYPEHASH,
                FeeRemainderPolicyId.unwrap(set.remainderPolicyId),
                set.remainderRecipientIndex,
                keccak256(abi.encodePacked(hashes))
            )
        );
    }

    function findRule(FeeRule[] memory rules, FeeActionId actionId) internal pure returns (FeeRule memory rule) {
        bytes32 target = FeeActionId.unwrap(actionId);
        for (uint256 i; i < rules.length; ++i) {
            bytes32 current = FeeActionId.unwrap(rules[i].actionId);
            if (current == target) return rules[i];
            if (current > target) break;
        }
        revert UnknownFeeAction(actionId);
    }

    function compute(
        FeeScheduleDefinition memory definition,
        FeeRule memory rule,
        uint128 notionalMinor,
        uint128 volume
    ) internal pure returns (FeeComputation memory result) {
        FeeRatePpm chargeRate = rule.chargeRatePpm;
        FeeRatePpm rebateRate = rule.rebateRatePpm;
        uint128 flatCharge = rule.flatChargeMinor;
        uint128 flatRebate = rule.flatRebateMinor;
        uint16 tierIndex = type(uint16).max;
        if (
            FeeModelId.unwrap(definition.feeModelId)
                == FeeModelId.unwrap(FeeScheduleDefinitionLib.FEE_MODEL_VOLUME_TIERED)
        ) {
            tierIndex = 0;
            for (uint16 i = 1; i < rule.tiers.length; ++i) {
                if (rule.tiers[i].minimumVolumeMinor > volume) break;
                tierIndex = i;
            }
            FeeTier memory tier = rule.tiers[tierIndex];
            chargeRate = tier.chargeRatePpm;
            rebateRate = tier.rebateRatePpm;
            flatCharge = tier.flatChargeMinor;
            flatRebate = tier.flatRebateMinor;
        }

        uint256 charge = uint256(flatCharge) + _mulDivUp(notionalMinor, FeeRatePpm.unwrap(chargeRate));
        uint256 rebate = uint256(flatRebate) + _mulDivDown(notionalMinor, FeeRatePpm.unwrap(rebateRate));
        if (charge > type(uint128).max) revert FeeAmountOverflow(charge);
        if (rebate > type(uint128).max) revert FeeAmountOverflow(rebate);
        return FeeComputation({
            chargeMinor: uint128(charge),
            rebateMinor: uint128(rebate),
            chargeRatePpm: chargeRate,
            rebateRatePpm: rebateRate,
            flatChargeMinor: flatCharge,
            flatRebateMinor: flatRebate,
            tierIndex: tierIndex
        });
    }

    function splitCharge(uint128 chargeMinor, FeeRecipientSet memory set)
        internal
        pure
        returns (uint128[] memory amounts)
    {
        amounts = new uint128[](set.recipients.length);
        uint256 allocated;
        for (uint256 i; i < set.recipients.length; ++i) {
            uint256 amount = _mulDivDown(chargeMinor, set.recipients[i].sharePpm);
            amounts[i] = uint128(amount);
            allocated += amount;
        }
        amounts[set.remainderRecipientIndex] += uint128(uint256(chargeMinor) - allocated);
    }

    function _validateRule(FeeScheduleDefinition memory definition, FeeRule memory rule, uint256 ruleIndex)
        private
        pure
    {
        bytes32 action = FeeActionId.unwrap(rule.actionId);
        if (
            (action == FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL)
                    || action == FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL))
                && !rule.requiresOpenSchedule
        ) revert InvalidRuleForModel(ruleIndex, definition.feeModelId);
        bytes32 model = FeeModelId.unwrap(definition.feeModelId);
        if (model == FeeModelId.unwrap(FeeScheduleDefinitionLib.FEE_MODEL_FLAT_PER_ACTION)) {
            if (
                rule.tiers.length != 0 || FeeRatePpm.unwrap(rule.chargeRatePpm) != 0
                    || FeeRatePpm.unwrap(rule.rebateRatePpm) != 0
                    || (rule.flatChargeMinor == 0 && rule.flatRebateMinor == 0)
            ) revert InvalidRuleForModel(ruleIndex, definition.feeModelId);
            _requireBounds(definition, ruleIndex, type(uint256).max, 0, 0, rule.flatChargeMinor, rule.flatRebateMinor);
            return;
        }
        if (model == FeeModelId.unwrap(FeeScheduleDefinitionLib.FEE_MODEL_AD_VALOREM)) {
            if (
                rule.tiers.length != 0 || rule.flatChargeMinor != 0 || rule.flatRebateMinor != 0
                    || (FeeRatePpm.unwrap(rule.chargeRatePpm) == 0 && FeeRatePpm.unwrap(rule.rebateRatePpm) == 0)
            ) revert InvalidRuleForModel(ruleIndex, definition.feeModelId);
            _requireBounds(
                definition,
                ruleIndex,
                type(uint256).max,
                FeeRatePpm.unwrap(rule.chargeRatePpm),
                FeeRatePpm.unwrap(rule.rebateRatePpm),
                0,
                0
            );
            return;
        }
        if (model == FeeModelId.unwrap(FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER)) {
            // An all-zero maker or taker rule is an explicit zero fee on that side; validateRules still requires the set
            // to price something.
            if (
                rule.tiers.length != 0
                    || (action != FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL)
                        && action != FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL))
                    || !rule.requiresOpenSchedule
            ) revert InvalidRuleForModel(ruleIndex, definition.feeModelId);
            _requireBounds(
                definition,
                ruleIndex,
                type(uint256).max,
                FeeRatePpm.unwrap(rule.chargeRatePpm),
                FeeRatePpm.unwrap(rule.rebateRatePpm),
                rule.flatChargeMinor,
                rule.flatRebateMinor
            );
            return;
        }
        if (model == FeeModelId.unwrap(FeeScheduleDefinitionLib.FEE_MODEL_VOLUME_TIERED)) {
            if (
                rule.flatChargeMinor != 0 || rule.flatRebateMinor != 0 || FeeRatePpm.unwrap(rule.chargeRatePpm) != 0
                    || FeeRatePpm.unwrap(rule.rebateRatePpm) != 0
            ) revert InvalidRuleForModel(ruleIndex, definition.feeModelId);
            _validateTiers(definition, rule, ruleIndex);
            return;
        }
        revert UnsupportedFeeModel(definition.feeModelId);
    }

    function _isEffective(FeeRule memory rule) private pure returns (bool) {
        if (
            FeeRatePpm.unwrap(rule.chargeRatePpm) != 0 || FeeRatePpm.unwrap(rule.rebateRatePpm) != 0
                || rule.flatChargeMinor != 0 || rule.flatRebateMinor != 0
        ) return true;
        for (uint256 i; i < rule.tiers.length; ++i) {
            FeeTier memory tier = rule.tiers[i];
            if (
                FeeRatePpm.unwrap(tier.chargeRatePpm) != 0 || FeeRatePpm.unwrap(tier.rebateRatePpm) != 0
                    || tier.flatChargeMinor != 0 || tier.flatRebateMinor != 0
            ) return true;
        }
        return false;
    }

    function _validateTiers(FeeScheduleDefinition memory definition, FeeRule memory rule, uint256 ruleIndex)
        private
        pure
    {
        uint256 count = rule.tiers.length;
        if (count == 0) revert EmptyFeeTiers(ruleIndex);
        if (count > MAX_TIERS) revert TooManyFeeTiers(ruleIndex, count, MAX_TIERS);
        if (rule.tiers[0].minimumVolumeMinor != 0) revert FeeTierMustStartAtZero(ruleIndex);
        uint128 previous;
        for (uint256 i; i < count; ++i) {
            FeeTier memory tier = rule.tiers[i];
            if (i != 0 && tier.minimumVolumeMinor <= previous) revert FeeTiersNotStrictlySorted(ruleIndex, i);
            if (
                FeeRatePpm.unwrap(tier.chargeRatePpm) == 0 && FeeRatePpm.unwrap(tier.rebateRatePpm) == 0
                    && tier.flatChargeMinor == 0 && tier.flatRebateMinor == 0
            ) revert InvalidRuleForModel(ruleIndex, definition.feeModelId);
            _requireBounds(
                definition,
                ruleIndex,
                i,
                FeeRatePpm.unwrap(tier.chargeRatePpm),
                FeeRatePpm.unwrap(tier.rebateRatePpm),
                tier.flatChargeMinor,
                tier.flatRebateMinor
            );
            previous = tier.minimumVolumeMinor;
        }
    }

    function _requireBounds(
        FeeScheduleDefinition memory definition,
        uint256 ruleIndex,
        uint256 tierIndex,
        uint32 chargeRate,
        uint32 rebateRate,
        uint128 flatCharge,
        uint128 flatRebate
    ) private pure {
        uint32 maxChargeRate = FeeRatePpm.unwrap(definition.maxChargeRatePpm);
        uint32 maxRebateRate = FeeRatePpm.unwrap(definition.maxRebateRatePpm);
        if (chargeRate > maxChargeRate) {
            revert FeeRateExceedsSchedule(ruleIndex, tierIndex, chargeRate, maxChargeRate, false);
        }
        if (rebateRate > maxRebateRate) {
            revert FeeRateExceedsSchedule(ruleIndex, tierIndex, rebateRate, maxRebateRate, true);
        }
        if (flatCharge > definition.maxFlatChargeBaseUnits) {
            revert FlatFeeExceedsSchedule(ruleIndex, tierIndex, flatCharge, definition.maxFlatChargeBaseUnits, false);
        }
        if (flatRebate > definition.maxFlatRebateBaseUnits) {
            revert FlatFeeExceedsSchedule(ruleIndex, tierIndex, flatRebate, definition.maxFlatRebateBaseUnits, true);
        }
    }

    function _mulDivUp(uint128 amount, uint32 rate) private pure returns (uint256) {
        if (amount == 0 || rate == 0) return 0;
        uint256 product = uint256(amount) * rate;
        return (product - 1) / PPM_DENOMINATOR + 1;
    }

    function _mulDivDown(uint128 amount, uint32 rate) private pure returns (uint256) {
        return uint256(amount) * rate / PPM_DENOMINATOR;
    }
}
