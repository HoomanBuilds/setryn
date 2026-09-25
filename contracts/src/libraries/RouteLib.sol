// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {PackageDefinitionLib} from "./PackageDefinitionLib.sol";
import {PortfolioRiskLib} from "./PortfolioRiskLib.sol";
import {Side} from "../types/Enums.sol";
import {AccountId, PackageId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    CoincidencePlan,
    ExecutableRoute,
    LiquidityProvenance,
    RouteCandidate,
    RouteComponent,
    RouteId,
    RouteRiskBinding,
    RouteSelectionBounds,
    RouteSourceKind
} from "../types/RoutingTypes.sol";
import {RiskAdmissionId} from "../types/RiskTypes.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../types/Units.sol";

library RouteLib {
    uint8 internal constant MAXIMUM_CANDIDATES = 8;
    uint8 internal constant MAXIMUM_COMPONENTS = 16;
    uint8 internal constant MAXIMUM_RISK_BINDINGS = 2;

    error InvalidRoute();
    error InvalidRouteGraph();
    error InvalidRouteMath();
    error InvalidRiskBinding();
    error RouteOutsideBounds();
    error InvalidCoincidence();

    function hashComponents(RouteComponent[] memory components) internal pure returns (bytes32) {
        return keccak256(abi.encode(components));
    }

    function hashRiskBindings(RouteRiskBinding[] memory bindings) internal pure returns (bytes32) {
        return keccak256(abi.encode(bindings));
    }

    function hashRoute(ExecutableRoute memory route) internal pure returns (bytes32) {
        return keccak256(abi.encode(route));
    }

    function deriveRouteId(ExecutableRoute memory route, uint256 chainId, address engine)
        internal
        pure
        returns (RouteId)
    {
        return RouteId.wrap(keccak256(abi.encode(chainId, engine, hashRoute(route))));
    }

    function sourceSnapshotHash(RouteComponent[] memory components) internal pure returns (bytes32 hash) {
        for (uint256 i; i < components.length; ++i) {
            hash = keccak256(
                abi.encode(
                    hash,
                    components[i].sourceKind,
                    components[i].sourceId,
                    components[i].sourceSnapshotHash,
                    components[i].sourceBlock,
                    components[i].sessionId,
                    components[i].sessionVersion
                )
            );
        }
    }

    function validateCandidate(RouteCandidate memory candidate, uint256 currentTimestamp) internal pure {
        ExecutableRoute memory route = candidate.route;
        if (
            PackageId.unwrap(route.packageId) == bytes32(0) || route.packageVersion == 0
                || route.packageWitnessHash == bytes32(0) || route.packageLots == Lots.wrap(0)
                || TickSizeMinor.unwrap(route.packageTickSizeMinor) == 0 || route.feeScheduleVersion == 0
                || route.riskDomainVersion == 0 || route.guaranteeClassId == bytes32(0) || route.salt == bytes32(0)
                || route.expiry < currentTimestamp || (route.userSide != Side.Buy && route.userSide != Side.Sell)
                || route.provenance == LiquidityProvenance.Unspecified
        ) revert InvalidRoute();
        if (PackageDefinitionLib.hashLegs(candidate.packageLegs) != route.packageWitnessHash) revert InvalidRoute();
        if (
            candidate.components.length == 0 || candidate.components.length > MAXIMUM_COMPONENTS
                || hashComponents(candidate.components) != route.componentsHash
        ) revert InvalidRouteGraph();
        _validateComponents(route, candidate.packageLegs, candidate.components);
        if (
            candidate.riskBindings.length == 0 || candidate.riskBindings.length > MAXIMUM_RISK_BINDINGS
                || hashRiskBindings(candidate.riskBindings) != route.riskBindingsHash
        ) revert InvalidRiskBinding();
        _validateRiskBindings(route, candidate.riskBindings);
    }

    function validateBounds(
        ExecutableRoute memory route,
        RouteRiskBinding[] memory bindings,
        RouteSelectionBounds memory bounds
    ) internal pure {
        if (
            bounds.deadline == 0 || route.userSide != bounds.userSide || route.riskDomainId != bounds.riskDomainId
                || route.riskDomainVersion != bounds.riskDomainVersion
                || route.guaranteeClassId != bounds.guaranteeClassId || route.totalFeeMinor > bounds.maximumFeeMinor
        ) revert RouteOutsideBounds();
        int128 price = PriceTicks.unwrap(route.netPackagePriceTicks);
        int128 limit = PriceTicks.unwrap(bounds.limitPriceTicks);
        if ((route.userSide == Side.Buy && price > limit) || (route.userSide == Side.Sell && price < limit)) {
            revert RouteOutsideBounds();
        }
        for (uint256 i; i < bindings.length; ++i) {
            if (bindings[i].result.metrics.availableHeadroomBaseUnits < bounds.minimumAvailableHeadroomBaseUnits) {
                revert RouteOutsideBounds();
            }
        }
    }

    function isBetter(RouteCandidate memory candidate, RouteCandidate memory incumbent) internal pure returns (bool) {
        int128 candidatePrice = PriceTicks.unwrap(candidate.route.netPackagePriceTicks);
        int128 incumbentPrice = PriceTicks.unwrap(incumbent.route.netPackagePriceTicks);
        if (candidatePrice != incumbentPrice) {
            return
                candidate.route.userSide == Side.Buy ? candidatePrice < incumbentPrice : candidatePrice > incumbentPrice;
        }
        if (candidate.route.totalFeeMinor != incumbent.route.totalFeeMinor) {
            return candidate.route.totalFeeMinor < incumbent.route.totalFeeMinor;
        }
        uint128 candidateHeadroom = minimumHeadroom(candidate.riskBindings);
        uint128 incumbentHeadroom = minimumHeadroom(incumbent.riskBindings);
        if (candidateHeadroom != incumbentHeadroom) return candidateHeadroom > incumbentHeadroom;
        return hashRoute(candidate.route) < hashRoute(incumbent.route);
    }

    function minimumHeadroom(RouteRiskBinding[] memory bindings) internal pure returns (uint128 headroom) {
        headroom = type(uint128).max;
        for (uint256 i; i < bindings.length; ++i) {
            uint128 available = bindings[i].result.metrics.availableHeadroomBaseUnits;
            if (available < headroom) headroom = available;
        }
    }

    function validateCoincidence(CoincidencePlan memory plan, PackageLeg[] memory packageLegs)
        internal
        pure
        returns (bytes32 planHash)
    {
        uint128 left = Lots.unwrap(plan.leftLots);
        uint128 right = Lots.unwrap(plan.rightLots);
        uint128 matched = left < right ? left : right;
        if (
            plan.leftOrderHash == bytes32(0) || plan.rightOrderHash == bytes32(0)
                || plan.leftOrderHash == plan.rightOrderHash || PackageId.unwrap(plan.packageId) == bytes32(0)
                || plan.packageVersion == 0 || plan.packageWitnessHash == bytes32(0)
                || PackageDefinitionLib.hashLegs(packageLegs) != plan.packageWitnessHash
                || !((plan.leftSide == Side.Buy && plan.rightSide == Side.Sell)
                    || (plan.leftSide == Side.Sell && plan.rightSide == Side.Buy)) || left == 0 || right == 0
                || Lots.unwrap(plan.matchedLots) != matched || Lots.unwrap(plan.leftResidualLots) != left - matched
                || Lots.unwrap(plan.rightResidualLots) != right - matched
                || PriceTicks.unwrap(plan.leftPriceTicks) != PriceTicks.unwrap(plan.rightPriceTicks)
                || plan.economicsHash == bytes32(0)
        ) revert InvalidCoincidence();
        planHash = keccak256(abi.encode(plan));
    }

    function riskResultHash(RouteRiskBinding memory binding) internal pure returns (bytes32) {
        return PortfolioRiskLib.hashResult(binding.result);
    }

    function _validateComponents(
        ExecutableRoute memory route,
        PackageLeg[] memory legs,
        RouteComponent[] memory components
    ) private pure {
        bool implied = route.provenance == LiquidityProvenance.ImpliedIn
            || route.provenance == LiquidityProvenance.ImpliedOut;
        if (implied && components.length != legs.length) revert InvalidRouteGraph();
        if (!implied && components.length != 1) revert InvalidRouteGraph();
        int256 netMinor;
        uint256 totalFee;
        for (uint256 i; i < components.length; ++i) {
            RouteComponent memory component = components[i];
            if (
                component.sourceKind == RouteSourceKind.Unspecified || component.sourceId == bytes32(0)
                    || component.sourceSnapshotHash == bytes32(0) || component.reservationKey == bytes32(0)
                    || component.orderHash == bytes32(0) || !component.executable || component.expiry < route.expiry
                    || component.sourceBlock != route.sourceBlock
                    || component.guaranteeClassId != route.guaranteeClassId || (component.dependencyMask >> i) != 0
            ) revert InvalidRouteGraph();
            for (uint256 j; j < i; ++j) {
                if (component.reservationKey == components[j].reservationKey) revert InvalidRouteGraph();
            }
            totalFee += component.feeMinor;
            if (totalFee > type(uint128).max) revert InvalidRouteMath();
            if (implied) {
                _validateImpliedComponent(route, legs[i], component);
                netMinor += _componentMinor(component.priceTicks, component.tickSizeMinor, component.packageRatio);
            } else {
                _validateDirectComponent(route, component);
            }
        }
        if (uint128(totalFee) != route.totalFeeMinor) revert InvalidRouteMath();
        if (implied) {
            int256 packageTick = int256(uint256(TickSizeMinor.unwrap(route.packageTickSizeMinor)));
            if (netMinor % packageTick != 0) revert InvalidRouteMath();
            int256 netTicks = netMinor / packageTick;
            if (netTicks < type(int128).min || netTicks > type(int128).max) revert InvalidRouteMath();
            if (PriceTicks.unwrap(route.netPackagePriceTicks) != int128(netTicks)) revert InvalidRouteMath();
        }
    }

    function _validateImpliedComponent(
        ExecutableRoute memory route,
        PackageLeg memory leg,
        RouteComponent memory component
    ) private pure {
        if (
            component.sourceKind != RouteSourceKind.SeriesBookHead || component.seriesId != leg.seriesId
                || component.seriesVersion != leg.seriesVersion || component.packageRatio != leg.ratio
                || TickSizeMinor.unwrap(component.tickSizeMinor) == 0
        ) revert InvalidRouteGraph();
        int256 signedRatio = int256(leg.ratio);
        uint256 ratio = signedRatio < 0 ? uint256(-signedRatio) : uint256(signedRatio);
        uint256 componentLots = uint256(Lots.unwrap(route.packageLots)) * ratio;
        if (componentLots > type(uint128).max || Lots.unwrap(component.componentLots) != componentLots) {
            revert InvalidRouteMath();
        }
        Side expected = route.userSide == Side.Buy
            ? (leg.ratio > 0 ? Side.Buy : Side.Sell)
            : (leg.ratio > 0 ? Side.Sell : Side.Buy);
        if (component.side != expected) revert InvalidRouteGraph();
    }

    function _validateDirectComponent(ExecutableRoute memory route, RouteComponent memory component) private pure {
        bool sourceMatches =
            (route.provenance == LiquidityProvenance.Direct
                    && component.sourceKind == RouteSourceKind.DirectPackageOrder)
                || (route.provenance == LiquidityProvenance.RfqFirm && component.sourceKind == RouteSourceKind.RfqQuote)
                || (route.provenance == LiquidityProvenance.StreamFirm
                    && component.sourceKind == RouteSourceKind.StreamQuote)
                || (route.provenance == LiquidityProvenance.SolverFirm
                    && component.sourceKind == RouteSourceKind.SolverRoute);
        if (
            !sourceMatches || component.packageRatio != 1
                || Lots.unwrap(component.componentLots) != Lots.unwrap(route.packageLots)
                || PriceTicks.unwrap(component.priceTicks) != PriceTicks.unwrap(route.netPackagePriceTicks)
                || TickSizeMinor.unwrap(component.tickSizeMinor) != TickSizeMinor.unwrap(route.packageTickSizeMinor)
        ) revert InvalidRouteGraph();
    }

    function _validateRiskBindings(ExecutableRoute memory route, RouteRiskBinding[] memory bindings) private pure {
        bytes32 previous;
        for (uint256 i; i < bindings.length; ++i) {
            RouteRiskBinding memory binding = bindings[i];
            bytes32 account = AccountId.unwrap(binding.accountId);
            if (
                account == bytes32(0) || (i != 0 && account <= previous)
                    || RiskAdmissionId.unwrap(binding.admissionId) == bytes32(0)
                    || binding.riskDomainId != route.riskDomainId
                    || binding.riskDomainVersion != route.riskDomainVersion
                    || binding.openInterestIncreaseBaseUnits == 0
                    || binding.result.metrics.availableHeadroomBaseUnits == 0
            ) revert InvalidRiskBinding();
            previous = account;
        }
    }

    function _componentMinor(PriceTicks price, TickSizeMinor tickSize, int32 ratio) private pure returns (int256) {
        int256 ticks = int256(PriceTicks.unwrap(price));
        int256 tick = int256(uint256(TickSizeMinor.unwrap(tickSize)));
        int256 signedRatio = int256(ratio);
        uint256 magnitude = ticks < 0 ? uint256(-ticks) : uint256(ticks);
        uint256 ratioMagnitude = signedRatio < 0 ? uint256(-signedRatio) : uint256(signedRatio);
        if (magnitude != 0 && uint256(tick) > type(uint256).max / magnitude) revert InvalidRouteMath();
        uint256 product = magnitude * uint256(tick);
        if (ratioMagnitude != 0 && product > uint256(type(int256).max) / ratioMagnitude) {
            revert InvalidRouteMath();
        }
        return ticks * tick * signedRatio;
    }
}
