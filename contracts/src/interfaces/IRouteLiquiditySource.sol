// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RouteComponent, RouteId} from "../types/RoutingTypes.sol";

interface IRouteLiquiditySource {
    function validateComponents(RouteId routeId, RouteComponent[] calldata components)
        external
        view
        returns (bytes32 currentSnapshotHash);

    function reserveComponents(RouteId routeId, RouteComponent[] calldata components)
        external
        returns (bytes32 reservationHash);

    function componentsRemainExecutable(RouteId routeId, bytes32 reservationHash, RouteComponent[] calldata components)
        external
        view
        returns (bool);

    function settleComponents(RouteId routeId, bytes32 reservationHash, bytes32 settlementReference) external;

    function releaseComponents(RouteId routeId, bytes32 reservationHash, bytes32 releaseReference) external;
}
