// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {TerminalLiabilityReservationStatus} from "./Enums.sol";
import {FixingResolutionKind} from "./FixingTypes.sol";
import {
    AccountId,
    FeeActionId,
    PositionId,
    SettlementId,
    TerminalClaimId,
    TerminalLiabilityReservationId
} from "./Identifiers.sol";

enum SettlementMode {
    Unspecified,
    Normal,
    TerminalDisruption,
    Lapsed
}

struct CanonicalSettlementFixing {
    bytes32 fixingKey;
    bytes32 resultHash;
    FixingResolutionKind resolutionKind;
    int256 value;
    int256 terminalDisruptionTransferMinorPerLot;
    uint64 effectiveAt;
    uint8 slot;
    uint8 decimals;
}

struct SettlementFeeReceipt {
    FeeActionId actionId;
    bytes32 consumptionId;
    bytes32 resultHash;
    uint128 chargeMinor;
    uint128 rebateMinor;
}

struct SettlementCollateralDelta {
    TerminalLiabilityReservationId reservationId;
    TerminalClaimId claimId;
    TerminalLiabilityReservationStatus status;
    AccountId payerAccountId;
    AccountId receiverAccountId;
    uint128 reservedBefore;
    uint128 claimAmount;
    uint128 releasedAmount;
}

struct SettlementRecord {
    SettlementId settlementId;
    PositionId positionId;
    SettlementMode mode;
    bytes32 seriesVersionHash;
    bytes32 payoffTermsHash;
    bytes32 fixingSlotsHash;
    bytes32 fixingsHash;
    bytes32 positionOutcomeReference;
    bytes32 outcomeHash;
    AccountId payerAccountId;
    AccountId receiverAccountId;
    int256 terminalTransferMinor;
    uint128 terminalAmount;
    uint64 finalizedAt;
    SettlementCollateralDelta longCollateral;
    SettlementCollateralDelta shortCollateral;
    SettlementFeeReceipt[] feeReceipts;
}
