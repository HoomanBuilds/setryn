// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {BenchmarkId, WindowKindId} from "./Identifiers.sol";
import {Lots, PriceTicks, TickSizeMinor} from "./Units.sol";

enum PayoffKind {
    Unspecified,
    CappedForward,
    Ndf,
    EuropeanCall,
    EuropeanPut,
    Collar,
    RateForward,
    RateCap,
    RateFloor,
    RateCollar,
    BasisSpread,
    CalendarSpread,
    WindowAverageScalar,
    CorrelationDispersionScalar
}

enum StrategyInputMode {
    Unspecified,
    Outright,
    ForwardPoints,
    StrikePremium,
    FixedRate,
    Spread,
    CommittedMetric
}

struct PayoffFixingRequirement {
    uint8 slot;
    BenchmarkId benchmarkId;
    uint32 benchmarkVersion;
    WindowKindId windowKindId;
    uint8 decimals;
}

struct CanonicalFixing {
    uint8 slot;
    BenchmarkId benchmarkId;
    uint32 benchmarkVersion;
    uint8 decimals;
    int256 value;
}

struct CanonicalPayoffTerms {
    uint8 schemaVersion;
    PayoffKind kind;
    uint8 valueDecimals;
    int256 primaryStrike;
    int256 secondaryStrike;
    int256 premiumMinorPerLot;
    uint256 multiplierNumerator;
    uint256 multiplierDenominator;
    int256 minimumTransferMinorPerLot;
    int256 maximumTransferMinorPerLot;
    uint128 maxLongDebitMinorPerLot;
    uint128 maxShortDebitMinorPerLot;
    int256 disruptionTransferMinorPerLot;
    PayoffFixingRequirement[] fixingRequirements;
}

struct StrategyCompileInput {
    PayoffKind kind;
    StrategyInputMode inputMode;
    uint8 valueDecimals;
    int256 primaryInput;
    int256 secondaryInput;
    int256 premiumMinorPerLot;
    uint256 multiplierNumerator;
    uint256 multiplierDenominator;
    int256 minimumTransferMinorPerLot;
    int256 maximumTransferMinorPerLot;
    int256 disruptionTransferMinorPerLot;
    PayoffFixingRequirement[] fixingRequirements;
    CanonicalFixing[] previewFixings;
    Lots previewLots;
    PriceTicks cashPriceTicks;
    TickSizeMinor cashTickSizeMinor;
}

struct StrategyCompileResult {
    bytes canonicalTerms;
    bytes32 termsHash;
    bytes32 fixingRequirementsHash;
    uint128 maxLongDebitMinorPerLot;
    uint128 maxShortDebitMinorPerLot;
    int256 previewTransferMinor;
    int256 cashConsiderationMinor;
}
