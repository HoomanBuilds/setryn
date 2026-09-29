// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {CapacityReservationDisposition, ClearingHandoffClaim} from "../types/ClearingHandoffTypes.sol";
import {AccountId, FillId, PositionId, SeriesId, TerminalLiabilityReservationId} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {PositionEconomics, PositionFunding, PositionLiabilitySide} from "../types/PositionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

import {ClearingDependencies} from "./AtomicClearingTypes.sol";

/// Internal position helpers shared by the series and package clearing libraries.
library AtomicClearingPositionLib {
    function validateMarketOrder(MarketVersion memory market, Lots lots, PriceTicks priceTicks) internal pure {
        uint128 rawLots = Lots.unwrap(lots);
        uint128 step = Lots.unwrap(market.definition.lotStep);
        int128 rawPrice = PriceTicks.unwrap(priceTicks);
        if (
            step == 0 || rawLots < Lots.unwrap(market.definition.minOrderLots)
                || rawLots > Lots.unwrap(market.definition.maxOrderLots) || rawLots % step != 0
                || rawPrice < PriceTicks.unwrap(market.definition.minPriceTicks)
                || rawPrice > PriceTicks.unwrap(market.definition.maxPriceTicks)
        ) revert IAtomicClearingEngine.OrderTargetMismatch();
    }

    function verifyPosition(ClearingDependencies memory deps, PositionId positionId, FillId fillId, uint32 ordinal)
        internal
        view
        returns (PositionEconomics memory economics)
    {
        (economics,) = deps.positionEngine.getPosition(positionId);
        if (economics.fillIdentity != FillId.unwrap(fillId) || economics.ordinal != ordinal) {
            revert IAtomicClearingEngine.PositionCreationMismatch(ordinal, economics.ordinal);
        }
    }

    function recordPosition(
        mapping(FillId fillId => PositionId[] positionIds) storage fillPositions,
        FillId fillId,
        PositionId positionId,
        SeriesId seriesId,
        uint32 seriesVersion,
        uint16 ordinal,
        int32 ratio,
        Lots lots,
        PriceTicks entryPriceTicks,
        TerminalLiabilityReservationId longReservationId,
        TerminalLiabilityReservationId shortReservationId
    ) internal {
        fillPositions[fillId].push(positionId);
        emit IAtomicClearingEngine.FillPositionCreated(
            fillId,
            positionId,
            SeriesId.unwrap(seriesId),
            seriesVersion,
            ordinal,
            ratio,
            Lots.unwrap(lots),
            PriceTicks.unwrap(entryPriceTicks),
            TerminalLiabilityReservationId.unwrap(longReservationId),
            TerminalLiabilityReservationId.unwrap(shortReservationId)
        );
    }

    function positionFunding(
        ClearingHandoffClaim memory claim,
        uint32 ordinal,
        bool longSide,
        AccountId accountId,
        uint128 reservationAmount
    ) internal pure returns (PositionFunding memory funding) {
        PositionLiabilitySide side = longSide ? PositionLiabilitySide.Long : PositionLiabilitySide.Short;
        bool found;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition memory disposition = claim.capacityDispositions[i];
            if (disposition.positionOrdinal != ordinal || disposition.side != side) continue;
            if (
                found || AccountId.unwrap(disposition.accountId) != AccountId.unwrap(accountId)
                    || disposition.reservationAmount != reservationAmount
            ) revert IAtomicClearingEngine.ClearingHandoffMismatch();
            found = true;
            funding = disposition.funding;
        }
    }

    function verifyAdoptedReservation(
        ClearingHandoffClaim memory claim,
        uint32 ordinal,
        bool longSide,
        TerminalLiabilityReservationId actualReservationId
    ) internal pure {
        PositionLiabilitySide side = longSide ? PositionLiabilitySide.Long : PositionLiabilitySide.Short;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition memory disposition = claim.capacityDispositions[i];
            if (disposition.positionOrdinal != ordinal || disposition.side != side) continue;
            if (
                TerminalLiabilityReservationId.unwrap(disposition.reservationId)
                    != TerminalLiabilityReservationId.unwrap(actualReservationId)
            ) revert IAtomicClearingEngine.ClearingHandoffMismatch();
            return;
        }
    }

    function currentDay() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }
}
