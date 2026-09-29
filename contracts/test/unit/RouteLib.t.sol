// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ICollateralAwareRouteEngine} from "../../src/interfaces/ICollateralAwareRouteEngine.sol";

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
    RiskAdmissionConsumption,
    RiskAdmissionId,
    RiskAdmissionStatus
} from "../../src/types/RiskTypes.sol";
import {
    CoincidencePlan,
    ExecutableRoute,
    LiquidityFirmness,
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

    function test_IndicativeSnapshotCannotBecomeExecutableRoute() public {
        RouteCandidate memory candidate = _candidate();
        candidate.components[0].firmness = LiquidityFirmness.Indicative;
        candidate.route.componentsHash = harness.hashComponents(candidate.components);
        vm.expectRevert(RouteLib.InvalidRouteGraph.selector);
        harness.validate(candidate, block.timestamp);
    }

    function test_RouteReservationConsumesExactRiskAndSourceOnce() public {
        RouteCandidate memory candidate = _candidate();
        _setAdmission(candidate.riskBindings[0]);
        _setAdmission(candidate.riskBindings[1]);
        RouteCandidate[] memory candidates = new RouteCandidate[](1);
        candidates[0] = candidate;
        RouteSelectionBounds memory bounds = _bounds(candidate.route);
        RouteId routeId = engine.selectAndReserve(candidates, bounds);
        assertEq(uint8(engine.getReservation(routeId).status), uint8(RouteStatus.Reserved));

        engine.consumeHandoff(routeId, keccak256("execution"));
        _consumeAdmission(candidate.riskBindings[0], keccak256("fill"));
        _consumeAdmission(candidate.riskBindings[1], keccak256("fill"));
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

    function test_ThirdPartyCannotBindAnotherAccountsRiskAdmission() public {
        RouteCandidate memory candidate = _candidate();
        _setAdmission(candidate.riskBindings[0]);
        _setAdmission(candidate.riskBindings[1]);
        RouteCandidate[] memory candidates = new RouteCandidate[](1);
        candidates[0] = candidate;
        RouteSelectionBounds memory bounds = _bounds(candidate.route);
        vm.prank(makeAddr("griefer"));
        vm.expectRevert(ICollateralAwareRouteEngine.UnauthorizedConsumer.selector);
        engine.selectAndReserve(candidates, bounds);
    }

    function test_AccountControllerSelectsRouteOverOwnAdmissions() public {
        RouteCandidate memory candidate = _candidate();
        _setAdmission(candidate.riskBindings[0]);
        _setAdmission(candidate.riskBindings[1]);
        address controller = makeAddr("controller");
        risk.setAccountController(candidate.riskBindings[0].accountId, controller);
        risk.setAccountController(candidate.riskBindings[1].accountId, controller);
        RouteCandidate[] memory candidates = new RouteCandidate[](1);
        candidates[0] = candidate;
        RouteSelectionBounds memory bounds = _bounds(candidate.route);
        vm.prank(controller);
        RouteId routeId = engine.selectAndReserve(candidates, bounds);
        assertEq(uint8(engine.getReservation(routeId).status), uint8(RouteStatus.Reserved));
    }

    function test_ControllerMustControlEveryBoundAccount() public {
        RouteCandidate memory candidate = _candidate();
        _setAdmission(candidate.riskBindings[0]);
        _setAdmission(candidate.riskBindings[1]);
        address controller = makeAddr("controller");
        risk.setAccountController(candidate.riskBindings[0].accountId, controller);
        risk.setAccountController(candidate.riskBindings[1].accountId, makeAddr("other controller"));
        RouteCandidate[] memory candidates = new RouteCandidate[](1);
        candidates[0] = candidate;
        RouteSelectionBounds memory bounds = _bounds(candidate.route);
        vm.prank(controller);
        vm.expectRevert(ICollateralAwareRouteEngine.UnauthorizedConsumer.selector);
        engine.selectAndReserve(candidates, bounds);
    }

    function test_CoincidenceReservationRequiresRouteConsumer() public {
        (CoincidencePlan memory plan, PackageLeg[] memory legs) = _coincidence(10, 10);
        address griefer = makeAddr("griefer");
        bytes32 consumerRole = engine.ROUTE_CONSUMER_ROLE();
        vm.prank(griefer);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, griefer, consumerRole)
        );
        engine.validateCoincidence(plan, legs);
    }

    function testFuzz_CoincidenceConservesEveryPackageLot(uint128 left, uint128 right) public view {
        left = uint128(bound(left, 1, type(uint128).max));
        right = uint128(bound(right, 1, type(uint128).max));
        (CoincidencePlan memory plan, PackageLeg[] memory legs) = _coincidence(left, right);
        assertTrue(harness.validateCoincidence(plan, legs) != bytes32(0));
        assertEq(uint256(Lots.unwrap(plan.matchedLots)) + Lots.unwrap(plan.leftResidualLots), left);
        assertEq(uint256(Lots.unwrap(plan.matchedLots)) + Lots.unwrap(plan.rightResidualLots), right);
    }

    function _coincidence(uint128 left, uint128 right)
        private
        view
        returns (CoincidencePlan memory plan, PackageLeg[] memory legs)
    {
        uint128 matched = left < right ? left : right;
        legs = new PackageLeg[](2);
        legs[0] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(1))), seriesVersion: 1, ratio: 1});
        legs[1] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(2))), seriesVersion: 1, ratio: -1});
        plan = CoincidencePlan({
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
            economicsHash: keccak256("economics"),
            leftReservationKey: keccak256("left reservation"),
            rightReservationKey: keccak256("right reservation"),
            intendedClearingConsumer: address(this),
            reservationExpiry: uint64(block.timestamp + 1 hours)
        });
    }

    function _candidate() internal view returns (RouteCandidate memory candidate) {
        PackageLeg[] memory legs = new PackageLeg[](2);
        legs[0] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(1))), seriesVersion: 1, ratio: 1});
        legs[1] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(2))), seriesVersion: 1, ratio: -1});
        RouteComponent[] memory components = new RouteComponent[](2);
        components[0] = _component(legs[0], Side.Buy, 100, 0);
        components[1] = _component(legs[1], Side.Sell, 50, 1);
        RouteRiskBinding[] memory bindings = new RouteRiskBinding[](2);
        bindings[0] = _riskBinding(1, 11);
        bindings[1] = _riskBinding(2, 12);
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
                reservedResultCommitment: PortfolioRiskLib.hashResult(binding.result),
                accountId: binding.accountId,
                riskDomainId: binding.riskDomainId,
                riskDomainVersion: binding.riskDomainVersion,
                openInterestBaseUnits: binding.openInterestIncreaseBaseUnits,
                terminalLiabilityBaseUnits: binding.terminalLiabilityIncreaseBaseUnits,
                remainingOpenInterestBaseUnits: binding.openInterestIncreaseBaseUnits,
                remainingTerminalLiabilityBaseUnits: binding.terminalLiabilityIncreaseBaseUnits,
                deadline: uint64(block.timestamp + 1 days),
                status: RiskAdmissionStatus.Reserved
            })
        );
    }

    function _consumeAdmission(RouteRiskBinding memory binding, bytes32 executionReference) private {
        risk.consumeAdmission(
            RiskAdmissionConsumption({
                admissionId: binding.admissionId,
                expectedResultHash: PortfolioRiskLib.hashResult(binding.result),
                expectedAccountId: binding.accountId,
                expectedRiskDomainId: binding.riskDomainId,
                expectedRiskDomainVersion: binding.riskDomainVersion,
                expectedOpenInterestBaseUnits: binding.openInterestIncreaseBaseUnits,
                expectedTerminalLiabilityBaseUnits: binding.terminalLiabilityIncreaseBaseUnits,
                expectedPositionCount: 1,
                executionReference: executionReference
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
            firmness: LiquidityFirmness.Firm,
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
            capacityLockReference: keccak256(abi.encode("capacity reference", leg.seriesId)),
            fundingLockId: CollateralLockId.wrap(keccak256(abi.encode("funding", leg.seriesId))),
            fundingLockReference: keccak256(abi.encode("funding reference", leg.seriesId)),
            expiry: uint64(block.timestamp + 1 days),
            sourceBlock: 100,
            dependencyMask: dependencyMask,
            sessionId: SessionId.wrap(keccak256("session")),
            sessionVersion: 1,
            guaranteeClassId: keccak256("atomic"),
            intendedClearingConsumer: address(this),
            executable: true
        });
    }

    function _riskBinding(uint256 accountKey, uint256 admissionKey) private pure returns (RouteRiskBinding memory) {
        return RouteRiskBinding({
            accountId: AccountId.wrap(bytes32(accountKey)),
            admissionId: RiskAdmissionId.wrap(bytes32(admissionKey)),
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
