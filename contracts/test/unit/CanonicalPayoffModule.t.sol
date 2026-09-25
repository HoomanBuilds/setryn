// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {CanonicalStrategyCompiler} from "../../src/compiler/CanonicalStrategyCompiler.sol";
import {CanonicalPayoffLib} from "../../src/libraries/CanonicalPayoffLib.sol";
import {CappedForwardPayoffModule} from "../../src/payoff/ProductionPayoffModules.sol";
import {BenchmarkId, WindowKindId} from "../../src/types/Identifiers.sol";
import {
    CanonicalFixing,
    CanonicalPayoffTerms,
    PayoffFixingRequirement,
    PayoffKind,
    StrategyCompileInput,
    StrategyCompileResult,
    StrategyInputMode
} from "../../src/types/PayoffTypes.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../../src/types/Units.sol";
import {CanonicalPayoffHarness} from "./harness/CanonicalPayoffHarness.sol";

contract CanonicalPayoffModuleTest is Test {
    BenchmarkId private constant BENCHMARK = BenchmarkId.wrap(keccak256("BTC_USD"));
    WindowKindId private constant WINDOW = WindowKindId.wrap(keccak256("FINAL"));

    CanonicalPayoffHarness private harness;
    CanonicalStrategyCompiler private compiler;
    CappedForwardPayoffModule private forwardModule;

    function setUp() public {
        harness = new CanonicalPayoffHarness();
        compiler = new CanonicalStrategyCompiler();
        forwardModule = new CappedForwardPayoffModule();
    }

    function test_GoldenCappedForwardMultipliesLotsBeforeSingleDivision() public view {
        CanonicalPayoffTerms memory terms = _terms(PayoffKind.CappedForward, 100, 0, 10, 3, -1_000, 1_000, 1);
        CanonicalFixing[] memory fixings = _fixings(160);

        assertEq(harness.evaluate(terms, fixings, 2), 400);
        assertEq(forwardModule.evaluatePosition(abi.encode(terms), abi.encode(fixings)), 200);
        assertEq(forwardModule.evaluatePositionLots(abi.encode(terms), abi.encode(fixings), 2), 400);
        assertEq(forwardModule.exactLotsCapability(), forwardModule.EXACT_LOTS_CAPABILITY());
    }

    function test_GoldenEuropeanCallPremiumIsNotTerminalPayoff() public view {
        CanonicalPayoffTerms memory terms = _terms(PayoffKind.EuropeanCall, 100, 0, 10, 1, -50, 1_000, 7);
        CanonicalFixing[] memory fixings = _fixings(130);

        assertEq(harness.evaluate(terms, fixings, 1), 300);
    }

    function test_GoldenCollarIsLongUpperCallMinusShortLowerPut() public view {
        CanonicalPayoffTerms memory terms = _terms(PayoffKind.Collar, 90, 110, 1, 1, -100, 100, 0);

        assertEq(harness.evaluate(terms, _fixings(80), 1), -10);
        assertEq(harness.evaluate(terms, _fixings(100), 1), 0);
        assertEq(harness.evaluate(terms, _fixings(120), 1), 10);
    }

    function test_ExactLotsSelectorPreservesCrossLotFraction() public view {
        CanonicalPayoffTerms memory terms = _terms(PayoffKind.CappedForward, 100, 0, 1, 2, -100, 100, 0);
        CanonicalFixing[] memory fixings = _fixings(101);

        assertEq(forwardModule.evaluatePosition(abi.encode(terms), abi.encode(fixings)), 0);
        assertEq(forwardModule.evaluatePositionLots(abi.encode(terms), abi.encode(fixings), 3), 1);
    }

    function test_GoldenWindowAverageConsumesOneQualifiedAggregate() public view {
        CanonicalPayoffTerms memory terms = _terms(PayoffKind.WindowAverageScalar, 10, 0, 100, 3, -1_000, 1_000, 0);
        CanonicalFixing[] memory fixings = _fixings(11);

        assertEq(harness.evaluate(terms, fixings, 1), 33);
    }

    function test_CompilerRejectsUnrecognizedInputMode() public {
        StrategyCompileInput memory input = _compileInput();
        input.kind = PayoffKind.EuropeanCall;
        input.inputMode = StrategyInputMode.Spread;

        vm.expectRevert(CanonicalPayoffLib.InvalidInputMode.selector);
        compiler.compileStrategy(input);
    }

    function test_CompilerReturnsCanonicalTermsAndCashTicks() public view {
        StrategyCompileInput memory input = _compileInput();
        StrategyCompileResult memory result = compiler.compileStrategy(input);

        assertEq(result.termsHash, keccak256(result.canonicalTerms));
        assertEq(result.previewTransferMinor, 400);
        assertEq(result.cashConsiderationMinor, -35);
        assertEq(harness.roundTripTerms(result.canonicalTerms), result.termsHash);
    }

    function testFuzz_ResultNeverEscapesDeclaredDebitBounds(int64 rawValue, uint8 rawLots) public view {
        uint128 lots = uint128(bound(rawLots, 1, 100));
        CanonicalPayoffTerms memory terms = _terms(PayoffKind.Ndf, 0, 0, 1_000, 7, -500, 700, 0);
        CanonicalFixing[] memory fixings = _fixings(rawValue);

        int256 result = harness.evaluate(terms, fixings, lots);
        assertGe(result, -int256(uint256(500 * lots)));
        assertLe(result, int256(uint256(700 * lots)));
    }

    function _compileInput() private view returns (StrategyCompileInput memory input) {
        input.kind = PayoffKind.CappedForward;
        input.inputMode = StrategyInputMode.Outright;
        input.primaryInput = 100;
        input.multiplierNumerator = 10;
        input.multiplierDenominator = 3;
        input.minimumTransferMinorPerLot = -1_000;
        input.maximumTransferMinorPerLot = 1_000;
        input.fixingRequirements = new PayoffFixingRequirement[](1);
        input.fixingRequirements[0] = _requirement(0);
        input.previewFixings = _fixings(160);
        input.previewLots = Lots.wrap(2);
        input.cashPriceTicks = PriceTicks.wrap(-7);
        input.cashTickSizeMinor = TickSizeMinor.wrap(5);
    }

    function _terms(
        PayoffKind kind,
        int256 primary,
        int256 secondary,
        uint256 multiplierNumerator,
        uint256 multiplierDenominator,
        int256 minimum,
        int256 maximum,
        int256 premium
    ) private view returns (CanonicalPayoffTerms memory terms) {
        PayoffFixingRequirement[] memory requirements = new PayoffFixingRequirement[](1);
        requirements[0] = _requirement(0);
        terms = CanonicalPayoffTerms({
            schemaVersion: 1,
            kind: kind,
            valueDecimals: 0,
            primaryStrike: primary,
            secondaryStrike: secondary,
            premiumMinorPerLot: premium,
            multiplierNumerator: multiplierNumerator,
            multiplierDenominator: multiplierDenominator,
            minimumTransferMinorPerLot: minimum,
            maximumTransferMinorPerLot: maximum,
            maxLongDebitMinorPerLot: uint128(uint256(-minimum)),
            maxShortDebitMinorPerLot: uint128(uint256(maximum)),
            disruptionTransferMinorPerLot: 0,
            fixingRequirements: requirements
        });
    }

    function _requirement(uint8 slot) private view returns (PayoffFixingRequirement memory) {
        return PayoffFixingRequirement({
            slot: slot, benchmarkId: BENCHMARK, benchmarkVersion: 1, windowKindId: WINDOW, decimals: 0
        });
    }

    function _fixings(int256 value) private view returns (CanonicalFixing[] memory fixings) {
        fixings = new CanonicalFixing[](1);
        fixings[0] = CanonicalFixing({slot: 0, benchmarkId: BENCHMARK, benchmarkVersion: 1, decimals: 0, value: value});
    }
}
