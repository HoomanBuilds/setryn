// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {AssetId, FeeModelId} from "./Identifiers.sol";
import {FeeRatePpm} from "./Units.sol";

/// @dev A fee schedule definition is one immutable economic policy, qualified against the exact
/// settlement asset binding version it charges in. Identity is namespaceId and scheduleKey alone, so
/// repricing a schedule, moving it to a different fee model, repointing it at a newer settlement
/// binding, or deploying it on another chain never mints a second lineage. Everything else in this
/// struct is policy, and policy belongs to a version rather than to an identity.
///
/// @dev feeModelId is an open namespaced identifier rather than an enum, so a flat per-action
/// charge, an ad valorem rate, a maker-taker split, a volume-tiered ladder, and a model invented
/// after this deployment all encode identically. This registry never branches on it; a fee model
/// contract must require the exact model it implements and fail closed on every other one.
///
/// @dev settlementAssetId and settlementAssetVersion name an exact immutable binding rather than a
/// lineage, so a schedule can never be silently repointed at a replacement token. Every flat bound
/// below is denominated in the base units of that exact binding, which is why the pair is qualified
/// and not merely recorded.
///
/// @dev feeRulesHash and recipientsHash are commitments, never computation inputs. feeRulesHash
/// commits the whole per-action, per-tier rule set: which FeeActionId values are priced at all, the
/// tier ladder, the rounding convention, and any minimum or maximum per action. recipientsHash
/// commits the recipient set and its split weights. A fee model proves concrete action, tier, and
/// recipient data against these two hashes at charge time, which is how a new action, a new tier, or
/// a new recipient enters the system without this registry ever learning their shapes. No named
/// recipient and no action list is stored here.
///
/// @dev The four maxima are the outer envelope this registry enforces on whatever the rules hash
/// later resolves to. They are stored as two nonnegative rate bounds and two nonnegative flat
/// bounds, never as one signed number, so no arithmetic sign flip can convert a charge into a
/// payout. maxChargeRatePpm and maxRebateRatePpm are shares of notional against PPM_DENOMINATOR;
/// maxFlatChargeBaseUnits and maxFlatRebateBaseUnits are absolute amounts in the base units of the
/// referenced settlement binding. Each may be zero, which means that lever is disabled, but a
/// definition with all four at zero can never charge or pay anything and is refused.
///
/// @dev The charge envelope and the rebate envelope are independent ceilings, not a netting pair. A
/// rebate envelope wider than the charge envelope, and a rebate-only schedule with no charge lever
/// at all, are both legitimate: a maker rebate program or a market incentive program is funded from
/// a separately reserved protocol or incentive budget rather than from the charge side of the same
/// event. This struct is a per-event policy envelope and nothing here is a solvency proof. A
/// consuming fee engine must reserve and verify rebate funding before settlement, and must never pay
/// merely because this envelope was accepted.
///
/// @dev evidenceHash commits the offchain qualification record behind the schedule: the fee
/// committee approval, the rate card it was derived from, and the review of the recipient set.
struct FeeScheduleDefinition {
    bytes32 namespaceId;
    bytes32 scheduleKey;
    FeeModelId feeModelId;
    AssetId settlementAssetId;
    uint32 settlementAssetVersion;
    bytes32 feeRulesHash;
    bytes32 recipientsHash;
    FeeRatePpm maxChargeRatePpm;
    FeeRatePpm maxRebateRatePpm;
    uint128 maxFlatChargeBaseUnits;
    uint128 maxFlatRebateBaseUnits;
    bytes32 evidenceHash;
}

/// @dev One immutable chain-local version of a fee schedule lineage. Status is the only mutable
/// field and it gates future qualification only; a version is never edited and never deleted, so a
/// signed order, a receipt, and an accounting entry priced under a retired schedule stay resolvable
/// forever.
struct FeeScheduleVersion {
    FeeScheduleDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}
