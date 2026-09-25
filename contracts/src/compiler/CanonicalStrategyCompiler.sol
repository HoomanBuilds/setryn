// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICanonicalStrategyCompiler} from "../interfaces/ICanonicalStrategyCompiler.sol";
import {CanonicalPayoffLib} from "../libraries/CanonicalPayoffLib.sol";
import {
    CanonicalPayoffTerms,
    StrategyCompileInput,
    StrategyCompileResult,
    StrategyInputMode
} from "../types/PayoffTypes.sol";
import {Lots, PriceTicks, TickSizeMinor} from "../types/Units.sol";

contract CanonicalStrategyCompiler is ICanonicalStrategyCompiler {
    error InvalidCashPreview();

    function compileStrategy(StrategyCompileInput calldata input)
        external
        pure
        returns (StrategyCompileResult memory result)
    {
        CanonicalPayoffLib.validateInputMode(input.kind, input.inputMode);
        uint256 longBound = _negativeMagnitude(input.minimumTransferMinorPerLot);
        uint256 shortBound = _positiveMagnitude(input.maximumTransferMinorPerLot);
        if (longBound > type(uint128).max || shortBound > type(uint128).max) {
            revert CanonicalPayoffLib.InvalidTerms();
        }
        (int256 primaryStrike, int256 secondaryStrike) = _canonicalStrikes(input);
        CanonicalPayoffTerms memory terms = CanonicalPayoffTerms({
            schemaVersion: 1,
            kind: input.kind,
            valueDecimals: input.valueDecimals,
            primaryStrike: primaryStrike,
            secondaryStrike: secondaryStrike,
            premiumMinorPerLot: input.premiumMinorPerLot,
            multiplierNumerator: input.multiplierNumerator,
            multiplierDenominator: input.multiplierDenominator,
            minimumTransferMinorPerLot: input.minimumTransferMinorPerLot,
            maximumTransferMinorPerLot: input.maximumTransferMinorPerLot,
            maxLongDebitMinorPerLot: uint128(longBound),
            maxShortDebitMinorPerLot: uint128(shortBound),
            disruptionTransferMinorPerLot: input.disruptionTransferMinorPerLot,
            fixingRequirements: input.fixingRequirements
        });
        CanonicalPayoffLib.validateTerms(terms);
        result.canonicalTerms = abi.encode(terms);
        result.termsHash = keccak256(result.canonicalTerms);
        result.fixingRequirementsHash = keccak256(abi.encode(input.fixingRequirements));
        result.maxLongDebitMinorPerLot = terms.maxLongDebitMinorPerLot;
        result.maxShortDebitMinorPerLot = terms.maxShortDebitMinorPerLot;
        if (Lots.unwrap(input.previewLots) != 0) {
            result.previewTransferMinor =
                CanonicalPayoffLib.evaluate(terms, input.previewFixings, Lots.unwrap(input.previewLots));
        } else if (input.previewFixings.length != 0) {
            revert CanonicalPayoffLib.InvalidFixings();
        }
        result.cashConsiderationMinor = _cashPreview(input.cashPriceTicks, input.cashTickSizeMinor);
    }

    function _cashPreview(PriceTicks priceTicks, TickSizeMinor tickSizeMinor) private pure returns (int256) {
        int256 ticks = PriceTicks.unwrap(priceTicks);
        uint256 tickSize = TickSizeMinor.unwrap(tickSizeMinor);
        if (tickSize == 0) {
            if (ticks != 0) revert InvalidCashPreview();
            return 0;
        }
        if (ticks == 0) return 0;
        if (tickSize > uint256(type(int256).max)) revert InvalidCashPreview();
        int256 signedTickSize = int256(tickSize);
        if (ticks == type(int256).min || signedTickSize > type(int256).max / _abs(ticks)) {
            revert InvalidCashPreview();
        }
        return ticks * signedTickSize;
    }

    function _canonicalStrikes(StrategyCompileInput calldata input)
        private
        pure
        returns (int256 primary, int256 secondary)
    {
        primary = input.primaryInput;
        secondary = input.secondaryInput;
        if (input.inputMode == StrategyInputMode.ForwardPoints) {
            unchecked {
                primary = input.primaryInput + input.secondaryInput;
            }
            if (
                (input.secondaryInput > 0 && primary < input.primaryInput)
                    || (input.secondaryInput < 0 && primary > input.primaryInput)
            ) revert CanonicalPayoffLib.ArithmeticOverflow();
            secondary = 0;
        }
    }

    function _negativeMagnitude(int256 value) private pure returns (uint256) {
        if (value > 0 || value == type(int256).min) revert CanonicalPayoffLib.InvalidTerms();
        return uint256(-value);
    }

    function _positiveMagnitude(int256 value) private pure returns (uint256) {
        if (value < 0) revert CanonicalPayoffLib.InvalidTerms();
        return uint256(value);
    }

    function _abs(int256 value) private pure returns (int256) {
        return value < 0 ? -value : value;
    }
}
