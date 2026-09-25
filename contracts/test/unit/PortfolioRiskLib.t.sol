// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {PortfolioRiskLib} from "../../src/libraries/PortfolioRiskLib.sol";
import {AccountId, CollateralId, PositionId, RiskDomainId, SeriesId} from "../../src/types/Identifiers.sol";
import {
    PortfolioPositionWitness,
    PortfolioRiskMetrics,
    PortfolioRiskResult,
    RiskEvaluationContext,
    RiskObservation
} from "../../src/types/RiskTypes.sol";
import {PriceTicks} from "../../src/types/Units.sol";
import {PortfolioRiskAdapterMock} from "../mocks/RiskEngineMocks.sol";
import {PortfolioRiskHarness} from "./harness/PortfolioRiskHarness.sol";

contract PortfolioRiskLibTest is Test {
    PortfolioRiskHarness internal harness;
    PortfolioRiskAdapterMock internal adapter;

    function setUp() public {
        harness = new PortfolioRiskHarness();
        adapter = new PortfolioRiskAdapterMock();
    }

    function test_CanonicalWitnessAndBoundedAdapterResult() public {
        PortfolioPositionWitness[] memory positions = _positions();
        RiskObservation[] memory observations = _observations();
        bytes32 witnessHash = harness.hashPositions(positions);
        bytes32 observationsHash = harness.hashObservations(observations, 60, 1_000);
        PortfolioRiskResult memory expected = PortfolioRiskResult({
            configurationHash: keccak256("configuration"),
            witnessHash: witnessHash,
            observationsHash: observationsHash,
            metrics: PortfolioRiskMetrics({
                initialMarginBaseUnits: 10,
                maintenanceMarginBaseUnits: 8,
                stressLossBaseUnits: 7,
                concentrationBaseUnits: 6,
                openInterestBaseUnits: 5,
                accountTerminalLiabilityBaseUnits: 4,
                aggregateTerminalLiabilityBaseUnits: 3,
                liquidationDistanceBaseUnits: 2,
                availableHeadroomBaseUnits: 1
            })
        });
        adapter.setResult(expected);

        PortfolioRiskResult memory actual =
            harness.boundedEvaluate(address(adapter), 500_000, _context(), positions, observations);
        assertEq(keccak256(abi.encode(actual)), keccak256(abi.encode(expected)));
    }

    function test_UnsortedPositionWitnessFailsClosed() public {
        PortfolioPositionWitness[] memory positions = _positions();
        (positions[0], positions[1]) = (positions[1], positions[0]);
        vm.expectRevert(PortfolioRiskLib.InvalidPortfolioWitness.selector);
        harness.hashPositions(positions);
    }

    function test_StaleObservationFailsClosed() public {
        RiskObservation[] memory observations = _observations();
        vm.expectRevert(PortfolioRiskLib.InvalidObservations.selector);
        harness.hashObservations(observations, 5, 1_000);
    }

    function _positions() internal pure returns (PortfolioPositionWitness[] memory positions) {
        positions = new PortfolioPositionWitness[](2);
        positions[0] = _position(1);
        positions[1] = _position(2);
    }

    function _position(uint256 value) internal pure returns (PortfolioPositionWitness memory) {
        return PortfolioPositionWitness({
            positionId: PositionId.wrap(bytes32(value)),
            seriesId: SeriesId.wrap(bytes32(uint256(10))),
            seriesVersion: 1,
            signedLots: int128(int256(value)),
            entryPriceTicks: PriceTicks.wrap(100),
            maximumTerminalLiabilityBaseUnits: uint128(value),
            economicsHash: keccak256("economics")
        });
    }

    function _observations() internal pure returns (RiskObservation[] memory observations) {
        observations = new RiskObservation[](2);
        observations[0] =
            RiskObservation({observationKey: bytes32(uint256(1)), valueHash: keccak256("one"), observedAt: 990});
        observations[1] =
            RiskObservation({observationKey: bytes32(uint256(2)), valueHash: keccak256("two"), observedAt: 995});
    }

    function _context() internal pure returns (RiskEvaluationContext memory) {
        return RiskEvaluationContext({
            accountId: AccountId.wrap(bytes32(uint256(1))),
            riskDomainId: RiskDomainId.wrap(bytes32(uint256(2))),
            riskDomainVersion: 1,
            collateralId: CollateralId.wrap(bytes32(uint256(3))),
            domainDefinitionHash: keccak256("domain"),
            riskModelId: keccak256("model"),
            marginRulesHash: keccak256("margin"),
            scenarioSetHash: keccak256("scenario"),
            concentrationRulesHash: keccak256("concentration"),
            collateralTotalBaseUnits: 100,
            collateralLockedBaseUnits: 10,
            collateralAvailableBaseUnits: 90,
            currentOpenInterestBaseUnits: 1,
            requestedOpenInterestBaseUnits: 2,
            currentAccountTerminalLiabilityBaseUnits: 3,
            requestedAccountTerminalLiabilityBaseUnits: 4,
            currentAggregateTerminalLiabilityBaseUnits: 5,
            requestedAggregateTerminalLiabilityBaseUnits: 4
        });
    }
}
