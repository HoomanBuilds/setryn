// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {DisruptionOutcomeId, ExercisePolicyId, InstrumentId, MarketId} from "./Identifiers.sol";

struct SeriesDefinition {
    bytes32 namespaceId;
    bytes32 seriesKey;
    MarketId marketId;
    uint32 marketVersion;
    InstrumentId instrumentId;
    uint32 instrumentVersion;
    uint64 tradingStartsAt;
    uint64 lastTradingAt;
    uint64 expiryAt;
    uint64 exerciseOpensAt;
    uint64 exerciseCutoffAt;
    uint64 fixingWindowOpen;
    uint64 fixingWindowClose;
    uint64 primaryEvidenceDeadline;
    uint64 correctionCutoffAt;
    uint64 finalResolutionAt;
    uint64 settlementDeadline;
    ExercisePolicyId exercisePolicyId;
    uint128 automaticExerciseThresholdMinor;
    DisruptionOutcomeId disruptionOutcomeId;
    int256 terminalDisruptionTransferMinorPerLot;
    bytes32 payoffTermsHash;
    bytes32 fixingSlotsHash;
    bytes32 dateAdjustmentEvidenceHash;
    uint128 maxLongDebitMinorPerLot;
    uint128 maxShortDebitMinorPerLot;
    bytes32 qualificationEvidenceHash;
}

struct SeriesVersion {
    SeriesDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}
