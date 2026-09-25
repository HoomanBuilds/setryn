// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {BenchmarkId, WindowKindId} from "../types/Identifiers.sol";
import {
    CanonicalFixing,
    CanonicalPayoffTerms,
    PayoffFixingRequirement,
    PayoffKind,
    StrategyInputMode
} from "../types/PayoffTypes.sol";

library CanonicalPayoffLib {
    uint8 internal constant SCHEMA_VERSION = 1;
    uint256 internal constant MAXIMUM_FIXINGS = 32;
    uint8 internal constant MAXIMUM_DECIMALS = 36;

    error InvalidTerms();
    error InvalidFixings();
    error InvalidInputMode(PayoffKind kind, StrategyInputMode mode);
    error ArithmeticOverflow();
    error DebitBoundExceeded(int256 transferMinor, uint128 longBound, uint128 shortBound);

    function decodeTerms(bytes memory encoded) internal pure returns (CanonicalPayoffTerms memory terms) {
        terms = abi.decode(encoded, (CanonicalPayoffTerms));
        if (keccak256(encoded) != keccak256(abi.encode(terms))) revert InvalidTerms();
        validateTerms(terms);
    }

    function decodeFixings(bytes memory encoded) internal pure returns (CanonicalFixing[] memory fixings) {
        fixings = abi.decode(encoded, (CanonicalFixing[]));
        if (keccak256(encoded) != keccak256(abi.encode(fixings))) revert InvalidFixings();
    }

    function validateTerms(CanonicalPayoffTerms memory terms) internal pure {
        uint256 count = terms.fixingRequirements.length;
        if (
            terms.schemaVersion != SCHEMA_VERSION || terms.kind == PayoffKind.Unspecified
                || terms.valueDecimals > MAXIMUM_DECIMALS || count == 0 || count > MAXIMUM_FIXINGS
                || terms.multiplierNumerator == 0 || terms.multiplierDenominator == 0
                || terms.minimumTransferMinorPerLot > terms.maximumTransferMinorPerLot
                || terms.minimumTransferMinorPerLot != -int256(uint256(terms.maxLongDebitMinorPerLot))
                || terms.maximumTransferMinorPerLot != int256(uint256(terms.maxShortDebitMinorPerLot))
                || terms.disruptionTransferMinorPerLot < terms.minimumTransferMinorPerLot
                || terms.disruptionTransferMinorPerLot > terms.maximumTransferMinorPerLot
        ) revert InvalidTerms();
        uint256 expected = expectedFixingCount(terms.kind);
        if (expected != 0 && count != expected) revert InvalidTerms();
        if (
            (terms.kind == PayoffKind.Collar || terms.kind == PayoffKind.RateCollar)
                && terms.primaryStrike > terms.secondaryStrike
        ) revert InvalidTerms();
        for (uint256 i; i < count; ++i) {
            PayoffFixingRequirement memory requirement = terms.fixingRequirements[i];
            if (
                requirement.slot != i || BenchmarkId.unwrap(requirement.benchmarkId) == bytes32(0)
                    || requirement.benchmarkVersion == 0 || WindowKindId.unwrap(requirement.windowKindId) == bytes32(0)
                    || requirement.decimals > terms.valueDecimals
            ) revert InvalidTerms();
        }
    }

    function evaluate(CanonicalPayoffTerms memory terms, CanonicalFixing[] memory fixings, uint128 lots)
        internal
        pure
        returns (int256 transferMinor)
    {
        validateTerms(terms);
        if (lots == 0 || fixings.length != terms.fixingRequirements.length) revert InvalidFixings();
        int256[] memory values = new int256[](fixings.length);
        for (uint256 i; i < fixings.length; ++i) {
            PayoffFixingRequirement memory requirement = terms.fixingRequirements[i];
            CanonicalFixing memory fixing = fixings[i];
            if (
                fixing.slot != requirement.slot
                    || BenchmarkId.unwrap(fixing.benchmarkId) != BenchmarkId.unwrap(requirement.benchmarkId)
                    || fixing.benchmarkVersion != requirement.benchmarkVersion
                    || fixing.decimals != requirement.decimals
            ) revert InvalidFixings();
            values[i] = _rescale(fixing.value, fixing.decimals, terms.valueDecimals);
        }
        (int256 scalar, uint256 scalarDenominator) = _scalar(terms, values);
        uint256 denominator = _checkedMulUnsigned(terms.multiplierDenominator, scalarDenominator);
        int256 numerator = _checkedMul(scalar, terms.multiplierNumerator);
        numerator = _checkedMul(numerator, lots);
        int256 minimumNumerator = _checkedMul(_checkedMul(terms.minimumTransferMinorPerLot, denominator), lots);
        int256 maximumNumerator = _checkedMul(_checkedMul(terms.maximumTransferMinorPerLot, denominator), lots);
        if (numerator < minimumNumerator) numerator = minimumNumerator;
        if (numerator > maximumNumerator) numerator = maximumNumerator;
        if (denominator > uint256(type(int256).max)) revert ArithmeticOverflow();
        transferMinor = numerator / int256(denominator);
        uint256 longBound = uint256(terms.maxLongDebitMinorPerLot) * lots;
        uint256 shortBound = uint256(terms.maxShortDebitMinorPerLot) * lots;
        if (longBound > uint256(type(int256).max) || shortBound > uint256(type(int256).max)) {
            revert ArithmeticOverflow();
        }
        if (transferMinor < -int256(longBound) || transferMinor > int256(shortBound)) {
            revert DebitBoundExceeded(transferMinor, terms.maxLongDebitMinorPerLot, terms.maxShortDebitMinorPerLot);
        }
    }

    function validateInputMode(PayoffKind kind, StrategyInputMode mode) internal pure {
        bool valid;
        if (kind == PayoffKind.CappedForward || kind == PayoffKind.Ndf) {
            valid = mode == StrategyInputMode.Outright || mode == StrategyInputMode.ForwardPoints;
        } else if (kind == PayoffKind.EuropeanCall || kind == PayoffKind.EuropeanPut || kind == PayoffKind.Collar) {
            valid = mode == StrategyInputMode.StrikePremium;
        } else if (
            kind == PayoffKind.RateForward || kind == PayoffKind.RateCap || kind == PayoffKind.RateFloor
                || kind == PayoffKind.RateCollar
        ) {
            valid = mode == StrategyInputMode.FixedRate;
        } else if (kind == PayoffKind.BasisSpread || kind == PayoffKind.CalendarSpread) {
            valid = mode == StrategyInputMode.Spread;
        } else if (kind == PayoffKind.WindowAverageScalar || kind == PayoffKind.CorrelationDispersionScalar) {
            valid = mode == StrategyInputMode.CommittedMetric;
        }
        if (!valid) revert InvalidInputMode(kind, mode);
    }

    function expectedFixingCount(PayoffKind kind) internal pure returns (uint256) {
        if (kind == PayoffKind.BasisSpread || kind == PayoffKind.CalendarSpread) return 2;
        return 1;
    }

    function _scalar(CanonicalPayoffTerms memory terms, int256[] memory values)
        private
        pure
        returns (int256 scalar, uint256 denominator)
    {
        PayoffKind kind = terms.kind;
        if (kind == PayoffKind.CappedForward || kind == PayoffKind.Ndf || kind == PayoffKind.RateForward) {
            return (_checkedSub(values[0], terms.primaryStrike), 1);
        }
        if (kind == PayoffKind.EuropeanCall || kind == PayoffKind.RateCap) {
            return (_positive(_checkedSub(values[0], terms.primaryStrike)), 1);
        }
        if (kind == PayoffKind.EuropeanPut || kind == PayoffKind.RateFloor) {
            return (_positive(_checkedSub(terms.primaryStrike, values[0])), 1);
        }
        if (kind == PayoffKind.Collar || kind == PayoffKind.RateCollar) {
            return (
                _checkedSub(
                    _positive(_checkedSub(values[0], terms.secondaryStrike)),
                    _positive(_checkedSub(terms.primaryStrike, values[0]))
                ),
                1
            );
        }
        if (kind == PayoffKind.BasisSpread) {
            return (_checkedSub(_checkedSub(values[0], values[1]), terms.primaryStrike), 1);
        }
        if (kind == PayoffKind.CalendarSpread) {
            return (_checkedSub(_checkedSub(values[1], values[0]), terms.primaryStrike), 1);
        }
        if (kind == PayoffKind.WindowAverageScalar) {
            return (_checkedSub(values[0], terms.primaryStrike), 1);
        }
        if (kind == PayoffKind.CorrelationDispersionScalar) {
            return (_checkedSub(values[0], terms.primaryStrike), 1);
        }
        revert InvalidTerms();
    }

    function _rescale(int256 value, uint8 fromDecimals, uint8 toDecimals) private pure returns (int256) {
        if (fromDecimals == toDecimals) return value;
        if (fromDecimals < toDecimals) return _checkedMul(value, 10 ** (toDecimals - fromDecimals));
        revert InvalidFixings();
    }

    function _positive(int256 value) private pure returns (int256) {
        return value > 0 ? value : int256(0);
    }

    function _checkedAdd(int256 left, int256 right) private pure returns (int256 result) {
        unchecked {
            result = left + right;
            if ((right > 0 && result < left) || (right < 0 && result > left)) revert ArithmeticOverflow();
        }
    }

    function _checkedSub(int256 left, int256 right) private pure returns (int256 result) {
        if (right == type(int256).min) revert ArithmeticOverflow();
        return _checkedAdd(left, -right);
    }

    function _checkedMul(int256 value, uint256 multiplier) private pure returns (int256 result) {
        if (multiplier > uint256(type(int256).max)) revert ArithmeticOverflow();
        int256 signedMultiplier = int256(multiplier);
        if (value == 0) return 0;
        if (value == type(int256).min || signedMultiplier > type(int256).max / _abs(value)) {
            revert ArithmeticOverflow();
        }
        result = value * signedMultiplier;
    }

    function _checkedMulUnsigned(uint256 left, uint256 right) private pure returns (uint256 result) {
        if (left == 0 || right == 0) return 0;
        result = left * right;
        if (result / left != right) revert ArithmeticOverflow();
    }

    function _abs(int256 value) private pure returns (int256) {
        return value < 0 ? -value : value;
    }
}
