// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Lots, PriceTicks} from "../types/Units.sol";

/// Errors raised by internal library code that now executes inside linked libraries. Declaring them here keeps
/// them in AtomicClearingEngine's ABI exactly as before the modular split, so clients decode every revert unchanged.
interface IAtomicClearingEngineLinkedErrors {
    error ClearingFeeResultMismatch();
    error InvalidPackageOrderLots(Lots lots, Lots lotStep, Lots minimum, Lots maximum);
    error InvalidPackageOrderPrice(PriceTicks priceTicks, PriceTicks minimum, PriceTicks maximum);
    error NotionalOverflow(uint256 lots, uint256 priceTicksMagnitude, uint256 tickSizeMinor);
    error PackageLegLotsOverflow(uint128 packageLots, int32 ratio);
    error PositionAmountOverflow(uint256 perLot, uint256 lots);
    error SignedCastOverflow(uint256 magnitude, bool negative);
    error ZeroFillLots();
    error ZeroTickSize();
}
