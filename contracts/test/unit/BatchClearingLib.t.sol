// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {BatchClearingLib} from "../../src/libraries/BatchClearingLib.sol";
import {AuctionId, AuctionPriceRule, BidCommitmentId} from "../../src/types/AuctionTypes.sol";
import {
    BatchAllocation,
    BatchCapacityDisposition,
    BatchExecutionHeader,
    BatchRemainderDisposition
} from "../../src/types/BatchTypes.sol";
import {
    AccountId,
    AssetId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId
} from "../../src/types/Identifiers.sol";
import {OrderTargetKind} from "../../src/types/OrderTypes.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {BatchStreamHarness} from "./harness/BatchStreamHarness.sol";

contract BatchClearingLibTest is Test {
    BatchStreamHarness internal harness;

    function setUp() public {
        harness = new BatchStreamHarness();
    }

    function test_RejectsMoreThanSixteenWinners() public {
        BatchExecutionHeader memory header = _header(17, 17);
        vm.expectRevert(abi.encodeWithSelector(BatchClearingLib.InvalidWinnerCount.selector, 17));
        harness.validateBatch(header, new PackageLeg[](0), new BatchAllocation[](17));
    }

    function test_RejectsDuplicateWinner() public {
        BatchExecutionHeader memory header = _header(2, 2);
        BatchAllocation[] memory allocations = new BatchAllocation[](2);
        allocations[0] = _allocation(1);
        allocations[1] = _allocation(1);
        vm.expectRevert(abi.encodeWithSelector(BatchClearingLib.DuplicateBid.selector, bytes32(uint256(1))));
        harness.validateBatch(header, new PackageLeg[](0), allocations);
    }

    function testFuzz_AllocationHashBindsQuantity(uint128 lots) public view {
        lots = uint128(bound(lots, 1, type(uint128).max));
        BatchAllocation[] memory allocations = new BatchAllocation[](1);
        allocations[0] = _allocation(lots);
        bytes32 baseline = harness.allocationHash(allocations);
        if (lots != type(uint128).max) {
            allocations[0].allocatedLots = Lots.wrap(lots + 1);
            assertTrue(harness.allocationHash(allocations) != baseline);
        }
    }

    function _header(uint16 winners, uint128 totalLots) private view returns (BatchExecutionHeader memory) {
        return BatchExecutionHeader({
            auctionId: AuctionId.wrap(keccak256("auction")),
            auctionVersion: 1,
            auctionResultHash: keccak256("result"),
            targetKind: OrderTargetKind.Series,
            seriesId: SeriesId.wrap(keccak256("series")),
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: 1,
            packageWitnessHash: bytes32(0),
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee")),
            feeScheduleVersion: 1,
            riskDomainId: RiskDomainId.wrap(keccak256("risk")),
            riskDomainVersion: 1,
            priceRule: AuctionPriceRule.PayAsBid,
            totalAllocatedLots: Lots.wrap(totalLots),
            winnerCount: winners,
            allocationsHash: keccak256("allocations"),
            settlementDeadline: uint64(block.timestamp + 1 days)
        });
    }

    function _allocation(uint128 lots) private pure returns (BatchAllocation memory) {
        return BatchAllocation({
            bidId: BidCommitmentId.wrap(bytes32(uint256(1))),
            takerOrderHash: keccak256("taker"),
            makerOrderHash: keccak256("maker"),
            allocatedLots: Lots.wrap(lots),
            executionPriceTicks: PriceTicks.wrap(100),
            fundingHash: keccak256("funding"),
            capacity: BatchCapacityDisposition({
                reservationId: keccak256("reservation"),
                capacityPolicyHash: keccak256("capacity policy"),
                capacityEvidenceHash: keccak256("capacity evidence"),
                accountId: AccountId.wrap(keccak256("account")),
                collateralAssetId: AssetId.wrap(keccak256("collateral")),
                collateralBindingVersion: 1,
                riskDomainId: RiskDomainId.wrap(keccak256("risk")),
                riskDomainVersion: 1,
                lockId: CollateralLockId.wrap(keccak256("lock")),
                lockReference: keccak256("lock reference"),
                expiry: 1,
                reservedLiability: 2,
                consumedLiability: 1,
                expectedRemainingLiability: 1,
                remainderDisposition: BatchRemainderDisposition.KeepReserved
            })
        });
    }
}
