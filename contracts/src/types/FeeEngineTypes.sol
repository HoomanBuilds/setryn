// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, CollateralLockId, FeeActionId, FeeRemainderPolicyId, FeeScheduleId} from "./Identifiers.sol";
import {FeeRatePpm} from "./Units.sol";

enum FeeLedgerEntryKind {
    Unspecified,
    ChargeDebit,
    ChargeCredit,
    BudgetDebit,
    RebateCredit
}

struct FeeTier {
    uint128 minimumVolumeMinor;
    FeeRatePpm chargeRatePpm;
    FeeRatePpm rebateRatePpm;
    uint128 flatChargeMinor;
    uint128 flatRebateMinor;
}

struct FeeRule {
    FeeActionId actionId;
    bool requiresOpenSchedule;
    FeeRatePpm chargeRatePpm;
    FeeRatePpm rebateRatePpm;
    uint128 flatChargeMinor;
    uint128 flatRebateMinor;
    FeeTier[] tiers;
}

struct FeeRecipient {
    AccountId accountId;
    uint32 sharePpm;
}

struct FeeRecipientSet {
    FeeRemainderPolicyId remainderPolicyId;
    uint8 remainderRecipientIndex;
    FeeRecipient[] recipients;
}

struct FeeActionRequest {
    bytes32 parentActionId;
    bytes32 consumptionId;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    FeeActionId actionId;
    AccountId chargePayerAccountId;
    AccountId rebateRecipientAccountId;
    uint128 notionalMinor;
    uint128 qualifyingVolumeMinor;
    uint128 maxFeeMinor;
    CollateralLockId chargeLockId;
    CollateralLockId budgetLockId;
    uint32 actionOrdinal;
}

struct FeeComputation {
    uint128 chargeMinor;
    uint128 rebateMinor;
    FeeRatePpm chargeRatePpm;
    FeeRatePpm rebateRatePpm;
    uint128 flatChargeMinor;
    uint128 flatRebateMinor;
    uint16 tierIndex;
}

struct FeeLedgerEntry {
    FeeLedgerEntryKind kind;
    FeeActionId actionId;
    AccountId accountId;
    int256 amountMinor;
}

struct FeeActionResult {
    bytes32 consumptionId;
    bytes32 resultHash;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    uint128 chargeMinor;
    uint128 rebateMinor;
    FeeComputation computation;
    FeeLedgerEntry[] entries;
}
