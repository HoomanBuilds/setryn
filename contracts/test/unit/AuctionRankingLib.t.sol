// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {AuctionRankingLib} from "../../src/libraries/AuctionRankingLib.sol";
import {Side} from "../../src/types/Enums.sol";
import {AccountId, CollateralId, CollateralLockId} from "../../src/types/Identifiers.sol";
import {AuctionId, BidCommitmentId, SealedBid, SolverRoute, SolverRouteId} from "../../src/types/AuctionTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";

contract AuctionRankingLibTest is Test {
    function testFuzz_TieBreakIsIndependentOfSubmissionOrder(bytes32 firstRaw, bytes32 secondRaw) public {
        vm.assume(firstRaw != secondRaw);
        BidCommitmentId firstId = BidCommitmentId.wrap(firstRaw);
        BidCommitmentId secondId = BidCommitmentId.wrap(secondRaw);
        SealedBid memory first = _bid();
        SealedBid memory second = _bid();

        bool firstBetter = AuctionRankingLib.isBetterBid(first, firstId, second, secondId, Side.Buy);
        bool secondBetter = AuctionRankingLib.isBetterBid(second, secondId, first, firstId, Side.Buy);
        assertTrue(firstBetter != secondBetter);
        assertEq(firstBetter, uint256(firstRaw) < uint256(secondRaw));
    }

    function test_RouteRankingUsesOutcomeFeeCapacityThenCommitment() public pure {
        BidCommitmentId firstId = BidCommitmentId.wrap(bytes32(uint256(1)));
        BidCommitmentId secondId = BidCommitmentId.wrap(bytes32(uint256(2)));
        SolverRoute memory first = _route();
        SolverRoute memory second = _route();

        second.packageOutcomeTicks = PriceTicks.wrap(101);
        assertTrue(AuctionRankingLib.isBetterRoute(second, secondId, first, firstId, Side.Sell));
        second.packageOutcomeTicks = first.packageOutcomeTicks;
        second.maximumFeeMinor = 9;
        assertTrue(AuctionRankingLib.isBetterRoute(second, secondId, first, firstId, Side.Sell));
        second.maximumFeeMinor = first.maximumFeeMinor;
        second.capacityAmount = 101;
        assertTrue(AuctionRankingLib.isBetterRoute(second, secondId, first, firstId, Side.Sell));
        second.capacityAmount = first.capacityAmount;
        assertTrue(AuctionRankingLib.isBetterRoute(first, firstId, second, secondId, Side.Sell));
    }

    function _bid() internal pure returns (SealedBid memory) {
        return SealedBid({
            auctionId: AuctionId.wrap(bytes32(uint256(1))),
            auctionVersion: 1,
            bidder: address(1),
            bidderAccountId: AccountId.wrap(bytes32(uint256(2))),
            bidderOrderHash: keccak256("bidder order"),
            nonce: 1,
            side: Side.Buy,
            lots: Lots.wrap(1),
            allowPartialAllocation: false,
            minimumFillLots: Lots.wrap(1),
            priceTicks: PriceTicks.wrap(100),
            maximumFeeMinor: 10,
            solverRouteId: SolverRouteId.wrap(bytes32(0)),
            capacityEvidenceHash: keccak256("capacity"),
            revealSalt: keccak256("salt")
        });
    }

    function _route() internal pure returns (SolverRoute memory) {
        return SolverRoute({
            auctionId: AuctionId.wrap(bytes32(uint256(1))),
            auctionVersion: 1,
            solver: address(1),
            solverAccountId: AccountId.wrap(bytes32(uint256(2))),
            routeId: SolverRouteId.wrap(bytes32(uint256(3))),
            packageLegsHash: keccak256("legs"),
            actionGraphHash: keccak256("actions"),
            legCount: 2,
            actionCount: 1,
            packageOutcomeTicks: PriceTicks.wrap(100),
            maximumFeeMinor: 10,
            capacityLockId: CollateralLockId.wrap(bytes32(uint256(4))),
            capacityCollateralId: CollateralId.wrap(bytes32(uint256(5))),
            capacityAmount: 100,
            capacityEvidenceHash: keccak256("capacity"),
            expiry: 1,
            guaranteeClassId: keccak256("guarantee"),
            salt: keccak256("salt")
        });
    }
}
