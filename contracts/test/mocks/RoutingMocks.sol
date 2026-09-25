// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RouteLib} from "../../src/libraries/RouteLib.sol";
import {
    RiskAdmission,
    RiskAdmissionConsumption,
    RiskAdmissionId,
    RiskAdmissionStatus
} from "../../src/types/RiskTypes.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {CoincidencePlan, ExecutableRoute, RouteComponent, RouteId} from "../../src/types/RoutingTypes.sol";

contract RouteLiquiditySourceMock {
    mapping(RouteId routeId => bool live) public live;
    mapping(RouteId routeId => bytes32 reservationHash) public reservations;

    function validateComponents(
        RouteId,
        ExecutableRoute calldata,
        PackageLeg[] calldata,
        RouteComponent[] calldata components
    ) external pure returns (bytes32) {
        return RouteLib.sourceSnapshotHash(components);
    }

    function reserveComponents(
        RouteId routeId,
        ExecutableRoute calldata,
        PackageLeg[] calldata,
        RouteComponent[] calldata components
    ) external returns (bytes32 reservationHash) {
        reservationHash = keccak256(abi.encode(routeId, components));
        reservations[routeId] = reservationHash;
        live[routeId] = true;
    }

    function componentsRemainExecutable(
        RouteId routeId,
        bytes32 reservationHash,
        ExecutableRoute calldata,
        PackageLeg[] calldata,
        RouteComponent[] calldata
    ) external view returns (bool) {
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

    function reserveCoincidence(RouteId routeId, CoincidencePlan calldata plan)
        external
        returns (bytes32 reservationHash)
    {
        reservationHash = keccak256(abi.encode(routeId, plan));
        reservations[routeId] = reservationHash;
        live[routeId] = true;
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

    function consumeAdmission(RiskAdmissionConsumption calldata consumption) external {
        RiskAdmission storage admission = _admissions[consumption.admissionId];
        require(admission.status == RiskAdmissionStatus.Reserved);
        require(admission.resultHash == consumption.expectedResultHash);
        require(admission.accountId == consumption.expectedAccountId);
        require(admission.riskDomainId == consumption.expectedRiskDomainId);
        require(admission.riskDomainVersion == consumption.expectedRiskDomainVersion);
        require(admission.remainingOpenInterestBaseUnits >= consumption.expectedOpenInterestBaseUnits);
        require(admission.remainingTerminalLiabilityBaseUnits >= consumption.expectedTerminalLiabilityBaseUnits);
        admission.remainingOpenInterestBaseUnits -= consumption.expectedOpenInterestBaseUnits;
        admission.remainingTerminalLiabilityBaseUnits -= consumption.expectedTerminalLiabilityBaseUnits;
        admission.status = RiskAdmissionStatus.Consumed;
    }

    function releaseAdmission(RiskAdmissionId admissionId, bytes32) external {
        require(_admissions[admissionId].status == RiskAdmissionStatus.Reserved);
        _admissions[admissionId].status = RiskAdmissionStatus.Released;
    }
}
