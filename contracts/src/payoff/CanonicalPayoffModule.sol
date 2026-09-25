// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPositionPayoffModuleV1} from "../interfaces/IPositionPayoffModuleV1.sol";
import {IExactLotsPayoffModuleV1} from "../interfaces/IExactLotsPayoffModuleV1.sol";
import {ISeriesPayoffModuleV1} from "../interfaces/ISeriesPayoffModuleV1.sol";
import {CanonicalPayoffLib} from "../libraries/CanonicalPayoffLib.sol";
import {BenchmarkId, PayoffFamilyId, WindowKindId} from "../types/Identifiers.sol";
import {CanonicalFixing, CanonicalPayoffTerms, PayoffKind} from "../types/PayoffTypes.sol";
import {FixingSlot, SeriesPayoffValidation, SeriesValidationContext} from "../types/SeriesQualification.sol";

abstract contract CanonicalPayoffModule is ISeriesPayoffModuleV1, IPositionPayoffModuleV1, IExactLotsPayoffModuleV1 {
    bytes32 public constant EXACT_LOTS_CAPABILITY = keccak256("SETRYN_EXACT_LOTS_PAYOFF_V1");
    PayoffFamilyId private immutable _payoffFamilyId;
    PayoffKind public immutable payoffKind;

    error InvalidPayoffFamily();
    error InvalidQualificationContext();
    error FixingSlotMismatch(uint256 index);

    constructor(PayoffFamilyId payoffFamilyId_, PayoffKind payoffKind_) {
        if (PayoffFamilyId.unwrap(payoffFamilyId_) == bytes32(0) || payoffKind_ == PayoffKind.Unspecified) {
            revert InvalidPayoffFamily();
        }
        _payoffFamilyId = payoffFamilyId_;
        payoffKind = payoffKind_;
    }

    function payoffFamilyId() external view returns (PayoffFamilyId) {
        return _payoffFamilyId;
    }

    function validateSeries(SeriesValidationContext calldata context, bytes calldata terms, FixingSlot[] calldata slots)
        external
        view
        returns (SeriesPayoffValidation memory validation)
    {
        CanonicalPayoffTerms memory decoded = CanonicalPayoffLib.decodeTerms(terms);
        if (
            decoded.kind != payoffKind
                || PayoffFamilyId.unwrap(context.payoffFamilyId) != PayoffFamilyId.unwrap(_payoffFamilyId)
                || context.chainId != block.chainid || context.payoffTermsHash == bytes32(0)
                || context.fixingSlotsHash == bytes32(0) || slots.length != decoded.fixingRequirements.length
        ) revert InvalidQualificationContext();
        for (uint256 i; i < slots.length; ++i) {
            if (slots[i].slot != i || slots[i].candidates.length != 1) revert FixingSlotMismatch(i);
            if (
                BenchmarkId.unwrap(slots[i].candidates[0].benchmarkId)
                        != BenchmarkId.unwrap(decoded.fixingRequirements[i].benchmarkId)
                    || slots[i].candidates[0].benchmarkVersion != decoded.fixingRequirements[i].benchmarkVersion
                    || WindowKindId.unwrap(slots[i].candidates[0].requiredWindowKindId)
                        != WindowKindId.unwrap(decoded.fixingRequirements[i].windowKindId)
            ) revert FixingSlotMismatch(i);
        }
        validation = SeriesPayoffValidation({
            maxLongDebitMinorPerLot: decoded.maxLongDebitMinorPerLot,
            maxShortDebitMinorPerLot: decoded.maxShortDebitMinorPerLot,
            terminalDisruptionTransferMinorPerLot: decoded.disruptionTransferMinorPerLot
        });
    }

    function evaluatePosition(bytes calldata payoffTerms, bytes calldata finalFixings)
        external
        view
        returns (int256 transferMinorPerLot)
    {
        CanonicalPayoffTerms memory terms = CanonicalPayoffLib.decodeTerms(payoffTerms);
        if (terms.kind != payoffKind) revert InvalidPayoffFamily();
        CanonicalFixing[] memory fixings = CanonicalPayoffLib.decodeFixings(finalFixings);
        return CanonicalPayoffLib.evaluate(terms, fixings, 1);
    }

    function exactLotsCapability() external pure returns (bytes32 capabilityHash) {
        return EXACT_LOTS_CAPABILITY;
    }

    function evaluatePositionLots(bytes calldata payoffTerms, bytes calldata finalFixings, uint128 lots)
        external
        view
        returns (int256 transferMinor)
    {
        CanonicalPayoffTerms memory terms = CanonicalPayoffLib.decodeTerms(payoffTerms);
        if (terms.kind != payoffKind) revert InvalidPayoffFamily();
        return CanonicalPayoffLib.evaluate(terms, CanonicalPayoffLib.decodeFixings(finalFixings), lots);
    }
}
