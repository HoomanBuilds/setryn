// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Side} from "../types/Enums.sol";
import {BidCommitmentId, SealedBid, SolverRoute} from "../types/AuctionTypes.sol";
import {PriceTicks} from "../types/Units.sol";

library AuctionRankingLib {
    function isBetterBid(
        SealedBid memory candidate,
        BidCommitmentId candidateId,
        SealedBid memory incumbent,
        BidCommitmentId incumbentId,
        Side auctionSide
    ) internal pure returns (bool) {
        int128 candidatePrice = PriceTicks.unwrap(candidate.priceTicks);
        int128 incumbentPrice = PriceTicks.unwrap(incumbent.priceTicks);
        if (candidatePrice != incumbentPrice) {
            return auctionSide == Side.Buy ? candidatePrice < incumbentPrice : candidatePrice > incumbentPrice;
        }
        if (candidate.maximumFeeMinor != incumbent.maximumFeeMinor) {
            return candidate.maximumFeeMinor < incumbent.maximumFeeMinor;
        }
        return BidCommitmentId.unwrap(candidateId) < BidCommitmentId.unwrap(incumbentId);
    }

    function isBetterRoute(
        SolverRoute memory candidate,
        BidCommitmentId candidateBidId,
        SolverRoute memory incumbent,
        BidCommitmentId incumbentBidId,
        Side auctionSide
    ) internal pure returns (bool) {
        int128 candidateOutcome = PriceTicks.unwrap(candidate.packageOutcomeTicks);
        int128 incumbentOutcome = PriceTicks.unwrap(incumbent.packageOutcomeTicks);
        if (candidateOutcome != incumbentOutcome) {
            return auctionSide == Side.Buy ? candidateOutcome < incumbentOutcome : candidateOutcome > incumbentOutcome;
        }
        if (candidate.maximumFeeMinor != incumbent.maximumFeeMinor) {
            return candidate.maximumFeeMinor < incumbent.maximumFeeMinor;
        }
        if (candidate.capacityAmount != incumbent.capacityAmount) {
            return candidate.capacityAmount > incumbent.capacityAmount;
        }
        return BidCommitmentId.unwrap(candidateBidId) < BidCommitmentId.unwrap(incumbentBidId);
    }
}
