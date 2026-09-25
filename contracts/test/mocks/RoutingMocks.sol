// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RouteLib} from "../../src/libraries/RouteLib.sol";
import {RiskAdmission, RiskAdmissionId, RiskAdmissionStatus} from "../../src/types/RiskTypes.sol";
import {RouteComponent, RouteId} from "../../src/types/RoutingTypes.sol";

contract RouteLiquiditySourceMock {
    mapping(RouteId routeId => bool live) public live;
    mapping(RouteId routeId => bytes32 reservationHash) public reservations;

    function validateComponents(RouteId, RouteComponent[] calldata components) external pure returns (bytes32) {
        return RouteLib.sourceSnapshotHash(components);
    }

    function reserveComponents(RouteId routeId, RouteComponent[] calldata components)
        external
        returns (bytes32 reservationHash)
    {
        reservationHash = keccak256(abi.encode(routeId, components));
        reservations[routeId] = reservationHash;
        live[routeId] = true;
    }

    function componentsRemainExecutable(RouteId routeId, bytes32 reservationHash, RouteComponent[] calldata)
        external
        view
        returns (bool)
    {
        return live[routeId] && reservations[routeId] == reservationHash;
    }

    function settleComponents(RouteId routeId, bytes32 reservationHash, bytes32) external {
        require(reservations[routeId] == reservationHash && live[routeId]);
        live[routeId] = false;
    }

    function releaseComponents(RouteId routeId, bytes32 reservationHash, bytes32) external {
        require(reservations[routeId] == reservationHash);
        live[routeId] = false;
    }

    function invalidate(RouteId routeId) external {
        live[routeId] = false;
    }
}

contract RouteRiskEngineMock {
    mapping(RiskAdmissionId admissionId => RiskAdmission admission) private _admissions;

    function setAdmission(RiskAdmissionId admissionId, RiskAdmission calldata admission) external {
        _admissions[admissionId] = admission;
    }

    function getAdmission(RiskAdmissionId admissionId) external view returns (RiskAdmission memory) {
        return _admissions[admissionId];
    }

    function consumeAdmission(RiskAdmissionId admissionId, bytes32) external {
        require(_admissions[admissionId].status == RiskAdmissionStatus.Reserved);
        _admissions[admissionId].status = RiskAdmissionStatus.Consumed;
    }

    function releaseAdmission(RiskAdmissionId admissionId, bytes32) external {
        require(_admissions[admissionId].status == RiskAdmissionStatus.Reserved);
        _admissions[admissionId].status = RiskAdmissionStatus.Released;
    }
}
