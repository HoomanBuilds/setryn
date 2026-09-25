// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {LockStatus, TerminalClaimStatus, TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "./Enums.sol";
import {AccountId, AssetId, CollateralId, RiskDomainId, TerminalLiabilityReservationId} from "./Identifiers.sol";

/// @dev Control of one segregated custody account. A zero controller is the never-created sentinel,
/// so a stored record can never be confused with an uncreated one, and a controller may therefore
/// never be set to zero. pendingController carries the second step of a handover and is cleared on
/// both accept and cancel.
///
/// @dev lockOperatorEpoch is the generation counter that makes a handover revoke every approval the
/// outgoing controller granted, without the vault ever enumerating operators. An approval stores the
/// epoch it was granted under and is live only while that stored number still equals this one, so a
/// single increment on acceptance invalidates all of them at once. It starts at 1 because zero is
/// reserved as the never-approved sentinel for a stored operator entry, which also makes an unknown
/// account read as approving nobody.
struct CollateralAccount {
    address controller;
    address pendingController;
    uint64 lockOperatorEpoch;
}

/// @dev total is everything the account owns under one exact CollateralId and locked is the part
/// already pledged to live locks. Available is derived as total - locked and is never stored, so
/// three numbers can never disagree. locked is an invariant of the ledger: it is only ever raised by
/// createLock and only ever lowered by release, expiry, or consumption, and it never exceeds total.
struct CollateralBalance {
    uint128 total;
    uint128 locked;
}

/// @dev One lock pins the exact binding it was created against rather than just the asset, so a
/// later requalification of the same physical token can never move an existing pledge onto a
/// different binding version. operator is the address that created the lock and is the only address
/// allowed to give it back early, which keeps bounded authority attached to the lock itself rather
/// than to whoever happens to hold the global role later.
///
/// @dev lockReference is the operator's own correlation key, kept so a manager can map a lock back
/// to its offchain position without an index. It is namespaced by operator inside the derived
/// CollateralLockId, so it is only unique per operator and must never be read as a global handle.
///
/// @dev settlementOperator is the single settlement engine allowed to consume this lock, chosen by
/// the operator at creation and pinned for the life of the lock. Holding the global settler role is
/// never enough on its own: a settler that was not pinned to this lock can never touch it.
struct CollateralLock {
    AccountId accountId;
    CollateralId collateralId;
    AssetId assetId;
    bytes32 lockReference;
    address operator;
    uint32 bindingVersion;
    uint64 expiry;
    address settlementOperator;
    LockStatus status;
    uint128 initialAmount;
    uint128 remainingAmount;
}

struct TerminalLiabilityReservation {
    bytes32 positionId;
    bytes32 positionEngineId;
    bytes32 positionEngineCodeHash;
    AccountId payerAccountId;
    CollateralId collateralId;
    AssetId assetId;
    RiskDomainId riskDomainId;
    address creator;
    address positionEngine;
    bytes32 terminalOutcomeReference;
    AccountId terminalAccountId;
    uint32 bindingVersion;
    uint32 riskDomainVersion;
    uint64 settlementDeadline;
    uint64 finalResolutionAt;
    TerminalLiabilityReservationStatus status;
    TerminalOutcomeKind terminalOutcome;
    uint128 initialAmount;
    uint128 remainingAmount;
    uint128 terminalAmount;
}

struct TerminalClaim {
    TerminalLiabilityReservationId reservationId;
    bytes32 positionId;
    AccountId payerAccountId;
    AccountId receiverAccountId;
    CollateralId collateralId;
    RiskDomainId riskDomainId;
    bytes32 terminalOutcomeReference;
    TerminalClaimStatus status;
    uint32 riskDomainVersion;
    uint128 amount;
}
