// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {IPortfolioRiskEngine} from "../../src/interfaces/IPortfolioRiskEngine.sol";
import {IRouteLiquiditySource} from "../../src/interfaces/IRouteLiquiditySource.sol";
import {PackageDefinitionLib} from "../../src/libraries/PackageDefinitionLib.sol";
import {RouteLib} from "../../src/libraries/RouteLib.sol";
import {PortfolioRiskLib} from "../../src/libraries/PortfolioRiskLib.sol";
import {CollateralAwareRouteEngine} from "../../src/routing/CollateralAwareRouteEngine.sol";
import {Side} from "../../src/types/Enums.sol";
import {
    AccountId,
    CollateralLockId,
    FeeScheduleId,
    FillId,
    PackageId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../../src/types/Identifiers.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {
    PortfolioRiskMetrics,
    PortfolioRiskResult,
    RiskAdmission,
    RiskAdmissionId,
    RiskAdmissionStatus
} from "../../src/types/RiskTypes.sol";
import {
    CoincidencePlan,
    ExecutableRoute,
    LiquidityProvenance,
    RouteCandidate,
    RouteComponent,
    RouteId,
    RouteRiskBinding,
    RouteSelectionBounds,
    RouteSettlement,
    RouteStatus,
    RouteSourceKind
} from "../../src/types/RoutingTypes.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {RouteLiquiditySourceMock, RouteRiskEngineMock} from "../mocks/RoutingMocks.sol";
import {RouteHarness} from "./harness/RouteHarness.sol";

contract RouteLibTest is Test {
    RouteHarness internal harness;
    RouteLiquiditySourceMock internal source;
    RouteRiskEngineMock internal risk;
    CollateralAwareRouteEngine internal engine;

    function setUp() public {
        harness = new RouteHarness();
        source = new RouteLiquiditySourceMock();
        risk = new RouteRiskEngineMock();
        engine = new CollateralAwareRouteEngine(
            0, address(this), IRouteLiquiditySource(address(source)), IPortfolioRiskEngine(address(risk))
        );
    }

    function test_ExactImpliedPriceAndGraphValidate() public view {
        harness.validate(_candidate(), block.timestamp);
    }

    function test_InexactPackageTickRoundingFailsClosed() public {
        RouteCandidate memory candidate = _candidate();
        candidate.route.packageTickSizeMinor = TickSizeMinor.wrap(3);
        vm.expectRevert(RouteLib.InvalidRouteMath.selector);
        harness.validate(candidate, block.timestamp);
    }

    function test_RouteReservationConsumesExactRiskAndSourceOnce() public {
        RouteCandidate memory candidate = _candidate();
        _setAdmission(candidate.riskBindings[0]);
        RouteCandidate[] memory candidates = new RouteCandidate[](1);
        candidates[0] = candidate;
        RouteSelectionBounds memory bounds = _bounds(candidate.route);
        RouteId routeId = engine.selectAndReserve(candidates, bounds);
        assertEq(uint8(engine.getReservation(routeId).status), uint8(RouteStatus.Reserved));

        engine.consumeHandoff(routeId, keccak256("execution"));
        engine.finalizeRoute(
            RouteSettlement({
                routeId: routeId,
                fillId: FillId.wrap(keccak256("fill")),
                positionsHash: keccak256("positions"),
                settlementReference: keccak256("settlement")
            })
        );
        assertEq(uint8(engine.getReservation(routeId).status), uint8(RouteStatus.Settled));
    }

    function testFuzz_CoincidenceConservesEveryPackageLot(uint128 left, uint128 right) public view {
        left = uint128(bound(left, 1, type(uint128).max));
        right = uint128(bound(right, 1, type(uint128).max));
        uint128 matched = left < right ? left : right;
        PackageLeg[] memory legs = new PackageLeg[](2);
        legs[0] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(1))), seriesVersion: 1, ratio: 1});
        legs[1] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(2))), seriesVersion: 1, ratio: -1});
        CoincidencePlan memory plan = CoincidencePlan({
            leftOrderHash: keccak256("left"),
            rightOrderHash: keccak256("right"),
            packageId: PackageId.wrap(keccak256("package")),
            packageVersion: 1,
            packageWitnessHash: PackageDefinitionLib.hashLegs(legs),
            leftSide: Side.Buy,
            rightSide: Side.Sell,
            leftLots: Lots.wrap(left),
            rightLots: Lots.wrap(right),
            matchedLots: Lots.wrap(matched),
            leftResidualLots: Lots.wrap(left - matched),
            rightResidualLots: Lots.wrap(right - matched),
            leftPriceTicks: PriceTicks.wrap(50),
            rightPriceTicks: PriceTicks.wrap(50),
            economicsHash: keccak256("economics")
        });
        assertTrue(harness.validateCoincidence(plan, legs) != bytes32(0));
        assertEq(uint256(Lots.unwrap(plan.matchedLots)) + Lots.unwrap(plan.leftResidualLots), left);
        assertEq(uint256(Lots.unwrap(plan.matchedLots)) + Lots.unwrap(plan.rightResidualLots), right);
    }

    function _candidate() internal view returns (RouteCandidate memory candidate) {
        PackageLeg[] memory legs = new PackageLeg[](2);
        legs[0] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(1))), seriesVersion: 1, ratio: 1});
        legs[1] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(2))), seriesVersion: 1, ratio: -1});
        RouteComponent[] memory components = new RouteComponent[](2);
        components[0] = _component(legs[0], Side.Buy, 100, 0);
        components[1] = _component(legs[1], Side.Sell, 50, 1);
        RouteRiskBinding[] memory bindings = new RouteRiskBinding[](1);
        bindings[0] = _riskBinding();
        candidate = RouteCandidate({
            route: ExecutableRoute({
                packageId: PackageId.wrap(keccak256("package")),
                packageVersion: 1,
                packageWitnessHash: PackageDefinitionLib.hashLegs(legs),
                userSide: Side.Buy,
                provenance: LiquidityProvenance.ImpliedIn,
                packageLots: Lots.wrap(10),
                netPackagePriceTicks: PriceTicks.wrap(50),
                packageTickSizeMinor: TickSizeMinor.wrap(1),
                totalFeeMinor: 2,
                feeScheduleId: FeeScheduleId.wrap(keccak256("fee")),
                feeScheduleVersion: 1,
                riskDomainId: RiskDomainId.wrap(keccak256("risk")),
                riskDomainVersion: 1,
                guaranteeClassId: keccak256("atomic"),
                expiry: uint64(block.timestamp + 1 days),
                sourceBlock: 100,
                componentsHash: harness.hashComponents(components),
                riskBindingsHash: harness.hashRiskBindings(bindings),
                salt: keccak256("route")
            }),
            packageLegs: legs,
            components: components,
            riskBindings: bindings
        });
    }

    function _setAdmission(RouteRiskBinding memory binding) private {
        risk.setAdmission(
            binding.admissionId,
            RiskAdmission({
                requestHash: keccak256("request"),
                resultHash: PortfolioRiskLib.hashResult(binding.result),
                accountId: binding.accountId,
                riskDomainId: binding.riskDomainId,
                riskDomainVersion: binding.riskDomainVersion,
                openInterestBaseUnits: binding.openInterestIncreaseBaseUnits,
                terminalLiabilityBaseUnits: binding.terminalLiabilityIncreaseBaseUnits,
                status: RiskAdmissionStatus.Reserved
            })
        );
    }

    function _bounds(ExecutableRoute memory route) private view returns (RouteSelectionBounds memory) {
        return RouteSelectionBounds({
            userSide: route.userSide,
            limitPriceTicks: route.netPackagePriceTicks,
            maximumFeeMinor: route.totalFeeMinor,
            minimumAvailableHeadroomBaseUnits: 100,
            riskDomainId: route.riskDomainId,
            riskDomainVersion: route.riskDomainVersion,
            guaranteeClassId: route.guaranteeClassId,
            deadline: uint64(block.timestamp + 1 hours)
        });
    }

    function _component(PackageLeg memory leg, Side side, int128 price, uint16 dependencyMask)
        private
        view
        returns (RouteComponent memory)
    {
        return RouteComponent({
            sourceKind: RouteSourceKind.SeriesBookHead,
            sourceId: keccak256(abi.encode("source", leg.seriesId)),
            sourceSnapshotHash: keccak256(abi.encode("snapshot", leg.seriesId)),
            reservationKey: keccak256(abi.encode("reservation", leg.seriesId)),
            orderHash: keccak256(abi.encode("order", leg.seriesId)),
            seriesId: leg.seriesId,
            seriesVersion: leg.seriesVersion,
            side: side,
            packageRatio: leg.ratio,
            componentLots: Lots.wrap(10),
            priceTicks: PriceTicks.wrap(price),
            tickSizeMinor: TickSizeMinor.wrap(1),
            feeMinor: 1,
            capacityLockId: CollateralLockId.wrap(keccak256(abi.encode("capacity", leg.seriesId))),
            fundingLockId: CollateralLockId.wrap(keccak256(abi.encode("funding", leg.seriesId))),
            expiry: uint64(block.timestamp + 1 days),
            sourceBlock: 100,
            dependencyMask: dependencyMask,
            sessionId: SessionId.wrap(keccak256("session")),
            sessionVersion: 1,
            guaranteeClassId: keccak256("atomic"),
            executable: true
        });
    }

    function _riskBinding() private pure returns (RouteRiskBinding memory) {
        return RouteRiskBinding({
            accountId: AccountId.wrap(keccak256("account")),
            admissionId: RiskAdmissionId.wrap(keccak256("admission")),
            riskDomainId: RiskDomainId.wrap(keccak256("risk")),
            riskDomainVersion: 1,
            openInterestIncreaseBaseUnits: 10,
            openInterestReductionBaseUnits: 0,
            terminalLiabilityIncreaseBaseUnits: 5,
            result: PortfolioRiskResult({
                configurationHash: keccak256("configuration"),
                witnessHash: keccak256("witness"),
                observationsHash: keccak256("observations"),
                metrics: PortfolioRiskMetrics({
                    initialMarginBaseUnits: 1,
                    maintenanceMarginBaseUnits: 1,
                    stressLossBaseUnits: 1,
                    concentrationBaseUnits: 1,
                    openInterestBaseUnits: 10,
                    accountTerminalLiabilityBaseUnits: 5,
                    aggregateTerminalLiabilityBaseUnits: 5,
                    liquidationDistanceBaseUnits: 10,
                    availableHeadroomBaseUnits: 100
                })
            })
        });
    }
}
