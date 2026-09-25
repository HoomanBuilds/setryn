// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPortfolioRiskEngine} from "./IPortfolioRiskEngine.sol";
import {IRouteLiquiditySource} from "./IRouteLiquiditySource.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    CoincidencePlan,
    RouteCandidate,
    RouteHandoff,
    RouteId,
    RouteComponent,
    RouteReservation,
    RouteRiskBinding,
    RouteSelectionBounds,
    RouteSettlement,
    RouteStatus
} from "../types/RoutingTypes.sol";

interface ICollateralAwareRouteEngine {
    event RouteReserved(
        RouteId indexed routeId,
        bytes32 indexed routeHash,
        bytes32 indexed sourceReservationHash,
        uint8 provenance,
        int128 netPackagePriceTicks,
        uint128 totalFeeMinor
    );
    event RouteComponentReserved(RouteId indexed routeId, uint16 indexed ordinal, RouteComponent component);
    event RouteRiskBound(RouteId indexed routeId, uint16 indexed ordinal, RouteRiskBinding binding);
    event RouteStatusChanged(
        RouteId indexed routeId, RouteStatus previousStatus, RouteStatus newStatus, bytes32 statusReference
    );
    event CoincidenceValidated(bytes32 indexed planHash, bytes32 indexed leftOrderHash, bytes32 indexed rightOrderHash);

    error ZeroInitialAdmin();
    error ZeroDependency(address dependency);
    error InvalidCandidateCount(uint256 count);
    error InvalidRoute();
    error InvalidRouteGraph();
    error InvalidRouteMath();
    error InvalidRiskBinding();
    error RouteOutsideBounds();
    error SourceSnapshotMismatch(bytes32 expected, bytes32 actual);
    error ReservationKeyAlreadyUsed(bytes32 reservationKey, RouteId routeId);
    error UnknownRoute(RouteId routeId);
    error InvalidRouteStatus(RouteId routeId, RouteStatus status);
    error RouteStillExecutable(RouteId routeId);
    error RouteNotExecutable(RouteId routeId);
    error UnauthorizedConsumer();

    function ROUTE_CONSUMER_ROLE() external view returns (bytes32);
    function selectAndReserve(RouteCandidate[] calldata candidates, RouteSelectionBounds calldata bounds)
        external
        returns (RouteId routeId);
    function consumeHandoff(RouteId routeId, bytes32 executionReference) external returns (RouteHandoff memory handoff);
    function finalizeRoute(RouteSettlement calldata settlement) external;
    function invalidateRoute(RouteId routeId, bytes32 invalidationReference) external;
    function validateCoincidence(CoincidencePlan calldata plan, PackageLeg[] calldata packageLegs)
        external
        returns (bytes32 planHash);
    function getReservation(RouteId routeId) external view returns (RouteReservation memory);
    function liquiditySource() external view returns (IRouteLiquiditySource);
    function riskEngine() external view returns (IPortfolioRiskEngine);
}
