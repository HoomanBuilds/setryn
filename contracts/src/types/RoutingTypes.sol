// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "./Enums.sol";
import {
    AccountId,
    CollateralLockId,
    FeeScheduleId,
    FillId,
    PackageId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "./Identifiers.sol";
import {PackageLeg} from "./PackageDefinition.sol";
import {PortfolioRiskResult, RiskAdmissionId} from "./RiskTypes.sol";
import {Lots, PriceTicks, TickSizeMinor} from "./Units.sol";

type RouteId is bytes32;

enum LiquidityProvenance {
    Unspecified,
    Direct,
    ImpliedIn,
    ImpliedOut,
    SolverFirm,
    RfqFirm,
    StreamFirm
}

enum RouteSourceKind {
    Unspecified,
    DirectPackageOrder,
    SeriesBookHead,
    RfqQuote,
    StreamQuote,
    SolverRoute
}

enum RouteStatus {
    Unspecified,
    Reserved,
    HandoffConsumed,
    Settled,
    Invalidated,
    Expired
}

struct RouteComponent {
    RouteSourceKind sourceKind;
    bytes32 sourceId;
    bytes32 sourceSnapshotHash;
    bytes32 reservationKey;
    bytes32 orderHash;
    SeriesId seriesId;
    uint32 seriesVersion;
    Side side;
    int32 packageRatio;
    Lots componentLots;
    PriceTicks priceTicks;
    TickSizeMinor tickSizeMinor;
    uint128 feeMinor;
    CollateralLockId capacityLockId;
    CollateralLockId fundingLockId;
    uint64 expiry;
    uint64 sourceBlock;
    uint16 dependencyMask;
    SessionId sessionId;
    uint32 sessionVersion;
    bytes32 guaranteeClassId;
    bool executable;
}

struct RouteRiskBinding {
    AccountId accountId;
    RiskAdmissionId admissionId;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    uint128 openInterestIncreaseBaseUnits;
    uint128 openInterestReductionBaseUnits;
    uint128 terminalLiabilityIncreaseBaseUnits;
    PortfolioRiskResult result;
}

struct ExecutableRoute {
    PackageId packageId;
    uint32 packageVersion;
    bytes32 packageWitnessHash;
    Side userSide;
    LiquidityProvenance provenance;
    Lots packageLots;
    PriceTicks netPackagePriceTicks;
    TickSizeMinor packageTickSizeMinor;
    uint128 totalFeeMinor;
    FeeScheduleId feeScheduleId;
    uint32 feeScheduleVersion;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    bytes32 guaranteeClassId;
    uint64 expiry;
    uint64 sourceBlock;
    bytes32 componentsHash;
    bytes32 riskBindingsHash;
    bytes32 salt;
}

struct RouteCandidate {
    ExecutableRoute route;
    PackageLeg[] packageLegs;
    RouteComponent[] components;
    RouteRiskBinding[] riskBindings;
}

struct RouteSelectionBounds {
    Side userSide;
    PriceTicks limitPriceTicks;
    uint128 maximumFeeMinor;
    uint128 minimumAvailableHeadroomBaseUnits;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    bytes32 guaranteeClassId;
    uint64 deadline;
}

struct RouteReservation {
    RouteId routeId;
    bytes32 routeHash;
    bytes32 sourceReservationHash;
    RouteStatus status;
    uint64 reservedAt;
}

struct RouteHandoff {
    RouteId routeId;
    bytes32 routeHash;
    bytes32 sourceReservationHash;
    PackageId packageId;
    uint32 packageVersion;
    bytes32 packageWitnessHash;
    Lots packageLots;
    PriceTicks netPackagePriceTicks;
    uint128 totalFeeMinor;
    RiskDomainId riskDomainId;
    uint32 riskDomainVersion;
    bytes32 guaranteeClassId;
    bytes32 executionReference;
}

struct CoincidencePlan {
    bytes32 leftOrderHash;
    bytes32 rightOrderHash;
    PackageId packageId;
    uint32 packageVersion;
    bytes32 packageWitnessHash;
    Side leftSide;
    Side rightSide;
    Lots leftLots;
    Lots rightLots;
    Lots matchedLots;
    Lots leftResidualLots;
    Lots rightResidualLots;
    PriceTicks leftPriceTicks;
    PriceTicks rightPriceTicks;
    bytes32 economicsHash;
}

struct RouteSettlement {
    RouteId routeId;
    FillId fillId;
    bytes32 positionsHash;
    bytes32 settlementReference;
}
