// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICollateralAwareRouteEngine} from "../interfaces/ICollateralAwareRouteEngine.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IRouteLiquiditySource} from "../interfaces/IRouteLiquiditySource.sol";
import {RouteLib} from "../libraries/RouteLib.sol";
import {AccountId, FillId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {RiskAdmission, RiskAdmissionId, RiskAdmissionStatus} from "../types/RiskTypes.sol";
import {
    CoincidencePlan,
    ExecutableRoute,
    RouteCandidate,
    RouteComponent,
    RouteHandoff,
    RouteId,
    RouteReservation,
    RouteRiskBinding,
    RouteSelectionBounds,
    RouteSettlement,
    RouteStatus
} from "../types/RoutingTypes.sol";

contract CollateralAwareRouteEngine is ICollateralAwareRouteEngine, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant ROUTE_CONSUMER_ROLE = keccak256("SETRYN_ROUTE_CONSUMER_ROLE");

    IRouteLiquiditySource private immutable _liquiditySource;
    IPortfolioRiskEngine private immutable _riskEngine;

    mapping(RouteId routeId => RouteReservation reservation) private _reservations;
    mapping(RouteId routeId => ExecutableRoute route) private _routes;
    mapping(RouteId routeId => RouteComponent[] components) private _components;
    mapping(RouteId routeId => PackageLeg[] legs) private _packageLegs;
    mapping(RouteId routeId => RouteRiskBinding[] bindings) private _riskBindings;
    mapping(bytes32 reservationKey => RouteId routeId) private _reservationRoutes;
    mapping(RiskAdmissionId admissionId => RouteId routeId) private _admissionRoutes;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IRouteLiquiditySource liquiditySource_,
        IPortfolioRiskEngine riskEngine_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(liquiditySource_));
        _requireDependency(address(riskEngine_));
        _liquiditySource = liquiditySource_;
        _riskEngine = riskEngine_;
        _grantRole(ROUTE_CONSUMER_ROLE, initialAdmin);
    }

    function selectAndReserve(RouteCandidate[] calldata candidates, RouteSelectionBounds calldata bounds)
        external
        nonReentrant
        returns (RouteId routeId)
    {
        if (candidates.length == 0 || candidates.length > RouteLib.MAXIMUM_CANDIDATES) {
            revert InvalidCandidateCount(candidates.length);
        }
        if (bounds.deadline < block.timestamp) revert RouteOutsideBounds();
        uint256 bestIndex;
        RouteCandidate memory anchor = candidates[0];
        for (uint256 i; i < candidates.length; ++i) {
            RouteCandidate memory candidate = candidates[i];
            RouteLib.validateCandidate(candidate, block.timestamp);
            RouteLib.validateBounds(candidate.route, candidate.riskBindings, bounds);
            _requireComparable(anchor.route, candidate.route);
            _validateRiskAdmissions(candidate);
            RouteId candidateId = RouteLib.deriveRouteId(candidate.route, block.chainid, address(this));
            bytes32 expectedSnapshot = RouteLib.sourceSnapshotHash(candidate.components);
            bytes32 currentSnapshot = _liquiditySource.validateComponents(
                candidateId, candidate.route, candidate.packageLegs, candidate.components
            );
            if (currentSnapshot != expectedSnapshot) revert SourceSnapshotMismatch(expectedSnapshot, currentSnapshot);
            if (i != 0 && RouteLib.isBetter(candidate, candidates[bestIndex])) bestIndex = i;
        }
        RouteCandidate memory selected = candidates[bestIndex];
        routeId = RouteLib.deriveRouteId(selected.route, block.chainid, address(this));
        if (_reservations[routeId].status != RouteStatus.Unspecified) {
            revert InvalidRouteStatus(routeId, _reservations[routeId].status);
        }
        _claimKeys(routeId, selected.components, selected.riskBindings);
        _routes[routeId] = selected.route;
        for (uint256 i; i < selected.components.length; ++i) {
            _components[routeId].push(selected.components[i]);
        }
        for (uint256 i; i < selected.packageLegs.length; ++i) {
            _packageLegs[routeId].push(selected.packageLegs[i]);
        }
        for (uint256 i; i < selected.riskBindings.length; ++i) {
            _riskBindings[routeId].push(selected.riskBindings[i]);
        }
        bytes32 sourceReservationHash =
            _liquiditySource.reserveComponents(routeId, selected.route, selected.packageLegs, selected.components);
        if (sourceReservationHash == bytes32(0)) revert InvalidRoute();
        bytes32 routeHash = RouteLib.hashRoute(selected.route);
        _reservations[routeId] = RouteReservation({
            routeId: routeId,
            routeHash: routeHash,
            sourceReservationHash: sourceReservationHash,
            status: RouteStatus.Reserved,
            reservedAt: uint64(block.timestamp)
        });
        emit RouteReserved(
            routeId,
            routeHash,
            sourceReservationHash,
            uint8(selected.route.provenance),
            selected.route.netPackagePriceTicks,
            selected.route.totalFeeMinor
        );
        for (uint16 i; i < selected.components.length; ++i) {
            emit RouteComponentReserved(routeId, i, selected.components[i]);
        }
        for (uint16 i; i < selected.riskBindings.length; ++i) {
            emit RouteRiskBound(routeId, i, selected.riskBindings[i]);
        }
    }

    function consumeHandoff(RouteId routeId, bytes32 executionReference)
        external
        onlyRole(ROUTE_CONSUMER_ROLE)
        nonReentrant
        returns (RouteHandoff memory handoff)
    {
        if (executionReference == bytes32(0)) revert InvalidRoute();
        RouteReservation storage reservation = _requireStatus(routeId, RouteStatus.Reserved);
        if (!_isExecutable(routeId, reservation)) revert RouteNotExecutable(routeId);
        RouteStatus previous = reservation.status;
        reservation.status = RouteStatus.HandoffConsumed;
        ExecutableRoute storage route = _routes[routeId];
        handoff = RouteHandoff({
            routeId: routeId,
            routeHash: reservation.routeHash,
            sourceReservationHash: reservation.sourceReservationHash,
            packageId: route.packageId,
            packageVersion: route.packageVersion,
            packageWitnessHash: route.packageWitnessHash,
            packageLots: route.packageLots,
            netPackagePriceTicks: route.netPackagePriceTicks,
            totalFeeMinor: route.totalFeeMinor,
            riskDomainId: route.riskDomainId,
            riskDomainVersion: route.riskDomainVersion,
            riskBindingsHash: route.riskBindingsHash,
            guaranteeClassId: route.guaranteeClassId,
            executionReference: executionReference
        });
        emit RouteStatusChanged(routeId, previous, RouteStatus.HandoffConsumed, executionReference);
    }

    function finalizeRoute(RouteSettlement calldata settlement) external onlyRole(ROUTE_CONSUMER_ROLE) nonReentrant {
        if (
            FillId.unwrap(settlement.fillId) == bytes32(0) || settlement.positionsHash == bytes32(0)
                || settlement.settlementReference == bytes32(0)
        ) revert InvalidRoute();
        RouteReservation storage reservation = _requireStatus(settlement.routeId, RouteStatus.HandoffConsumed);
        _liquiditySource.settleComponents(
            settlement.routeId, reservation.sourceReservationHash, settlement.settlementReference
        );
        RouteRiskBinding[] storage bindings = _riskBindings[settlement.routeId];
        for (uint256 i; i < bindings.length; ++i) {
            RiskAdmission memory admission = _riskEngine.getAdmission(bindings[i].admissionId);
            if (admission.status != RiskAdmissionStatus.Consumed) revert InvalidRiskBinding();
        }
        RouteStatus previous = reservation.status;
        reservation.status = RouteStatus.Settled;
        emit RouteStatusChanged(settlement.routeId, previous, RouteStatus.Settled, settlement.settlementReference);
    }

    function invalidateRoute(RouteId routeId, bytes32 invalidationReference) external nonReentrant {
        if (invalidationReference == bytes32(0)) revert InvalidRoute();
        RouteReservation storage reservation = _reservations[routeId];
        if (reservation.status != RouteStatus.Reserved && reservation.status != RouteStatus.HandoffConsumed) {
            revert InvalidRouteStatus(routeId, reservation.status);
        }
        bool expired = block.timestamp > _routes[routeId].expiry;
        if (!expired && _isExecutable(routeId, reservation)) revert RouteStillExecutable(routeId);
        _liquiditySource.releaseComponents(routeId, reservation.sourceReservationHash, invalidationReference);
        RouteRiskBinding[] storage bindings = _riskBindings[routeId];
        for (uint256 i; i < bindings.length; ++i) {
            _riskEngine.releaseAdmission(bindings[i].admissionId, invalidationReference);
        }
        RouteStatus previous = reservation.status;
        reservation.status = expired ? RouteStatus.Expired : RouteStatus.Invalidated;
        emit RouteStatusChanged(routeId, previous, reservation.status, invalidationReference);
    }

    function validateCoincidence(CoincidencePlan calldata plan, PackageLeg[] calldata packageLegs)
        external
        nonReentrant
        returns (bytes32 planHash)
    {
        planHash = RouteLib.validateCoincidence(plan, packageLegs);
        bytes32 reservationHash = _liquiditySource.reserveCoincidence(RouteId.wrap(planHash), plan);
        if (reservationHash == bytes32(0)) revert InvalidRoute();
        emit CoincidenceValidated(planHash, plan.leftOrderHash, plan.rightOrderHash);
    }

    function getReservation(RouteId routeId) external view returns (RouteReservation memory) {
        RouteReservation memory reservation = _reservations[routeId];
        if (reservation.status == RouteStatus.Unspecified) revert UnknownRoute(routeId);
        return reservation;
    }

    function liquiditySource() external view returns (IRouteLiquiditySource) {
        return _liquiditySource;
    }

    function riskEngine() external view returns (IPortfolioRiskEngine) {
        return _riskEngine;
    }

    function _validateRiskAdmissions(RouteCandidate memory candidate) private view {
        for (uint256 i; i < candidate.riskBindings.length; ++i) {
            RouteRiskBinding memory binding = candidate.riskBindings[i];
            RiskAdmission memory admission = _riskEngine.getAdmission(binding.admissionId);
            if (
                admission.status != RiskAdmissionStatus.Reserved || admission.accountId != binding.accountId
                    || admission.riskDomainId != binding.riskDomainId
                    || admission.riskDomainVersion != binding.riskDomainVersion
                    || admission.openInterestBaseUnits != binding.openInterestIncreaseBaseUnits
                    || admission.terminalLiabilityBaseUnits != binding.terminalLiabilityIncreaseBaseUnits
                    || admission.resultHash != RouteLib.riskResultHash(binding)
                    || admission.reservedResultCommitment != admission.resultHash
                    || admission.deadline < candidate.route.expiry
            ) revert InvalidRiskBinding();
        }
    }

    function _requireComparable(ExecutableRoute memory anchor, ExecutableRoute memory candidate) private pure {
        if (
            anchor.packageId != candidate.packageId || anchor.packageVersion != candidate.packageVersion
                || anchor.packageWitnessHash != candidate.packageWitnessHash || anchor.userSide != candidate.userSide
                || anchor.packageLots != candidate.packageLots
                || anchor.packageTickSizeMinor != candidate.packageTickSizeMinor
                || anchor.feeScheduleId != candidate.feeScheduleId
                || anchor.feeScheduleVersion != candidate.feeScheduleVersion
                || anchor.riskDomainId != candidate.riskDomainId
                || anchor.riskDomainVersion != candidate.riskDomainVersion
                || anchor.guaranteeClassId != candidate.guaranteeClassId
        ) revert InvalidRoute();
    }

    function _claimKeys(RouteId routeId, RouteComponent[] memory components, RouteRiskBinding[] memory bindings)
        private
    {
        for (uint256 i; i < components.length; ++i) {
            RouteId existing = _reservationRoutes[components[i].reservationKey];
            if (RouteId.unwrap(existing) != bytes32(0)) {
                revert ReservationKeyAlreadyUsed(components[i].reservationKey, existing);
            }
            _reservationRoutes[components[i].reservationKey] = routeId;
        }
        for (uint256 i; i < bindings.length; ++i) {
            RouteId existing = _admissionRoutes[bindings[i].admissionId];
            if (RouteId.unwrap(existing) != bytes32(0)) revert InvalidRiskBinding();
            _admissionRoutes[bindings[i].admissionId] = routeId;
        }
    }

    function _isExecutable(RouteId routeId, RouteReservation storage reservation) private view returns (bool) {
        if (block.timestamp > _routes[routeId].expiry) return false;
        if (!_liquiditySource.componentsRemainExecutable(
                routeId,
                reservation.sourceReservationHash,
                _routes[routeId],
                _packageLegs[routeId],
                _components[routeId]
            )) return false;
        RouteRiskBinding[] storage bindings = _riskBindings[routeId];
        for (uint256 i; i < bindings.length; ++i) {
            RiskAdmission memory admission = _riskEngine.getAdmission(bindings[i].admissionId);
            if (admission.status != RiskAdmissionStatus.Reserved) return false;
        }
        return true;
    }

    function _requireStatus(RouteId routeId, RouteStatus status)
        private
        view
        returns (RouteReservation storage reservation)
    {
        reservation = _reservations[routeId];
        if (reservation.status == RouteStatus.Unspecified) revert UnknownRoute(routeId);
        if (reservation.status != status) revert InvalidRouteStatus(routeId, reservation.status);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
