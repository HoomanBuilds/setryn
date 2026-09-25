// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";

import {ISealedAuctionHouse} from "../../src/interfaces/ISealedAuctionHouse.sol";
import {AuctionHashLib} from "../../src/libraries/AuctionHashLib.sol";
import {PackageDefinitionLib} from "../../src/libraries/PackageDefinitionLib.sol";
import {SealedAuctionHouse} from "../../src/auction/SealedAuctionHouse.sol";
import {LockStatus, Side} from "../../src/types/Enums.sol";
import {
    AccountId,
    AdapterId,
    AssetId,
    CollateralId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId
} from "../../src/types/Identifiers.sol";
import {PackageLeg} from "../../src/types/PackageDefinition.sol";
import {
    AuctionClearingHandoff,
    AuctionClearingResult,
    AuctionDefinition,
    AuctionId,
    AuctionKind,
    AuctionPriceRule,
    AuctionStatus,
    AuctionTargetKind,
    AuctionTieBreakRule,
    BidCommitAuthorization,
    BidCommitmentId,
    BidStatus,
    BondOutcome,
    NoBidTreatment,
    SealedBid,
    SolverAction,
    SolverRoute,
    SolverRouteId
} from "../../src/types/AuctionTypes.sol";
import {Lots, PriceTicks} from "../../src/types/Units.sol";
import {AuctionValidationGateMock, AuctionVaultMock} from "../mocks/AuctionMocks.sol";

contract SealedAuctionHouseTest is Test {
    uint256 internal constant NOW = 1_800_000_000;
    bytes32 internal constant GUARANTEE = keccak256("atomic same domain");
    bytes32 internal constant CAPACITY_POLICY = keccak256("firm capacity v1");
    AssetId internal constant SETTLEMENT_ASSET = AssetId.wrap(keccak256("usdc"));

    address internal admin = makeAddr("admin");
    address internal clearing = makeAddr("clearing");
    address internal firstBidder;
    uint256 internal firstKey;
    address internal secondBidder;
    uint256 internal secondKey;

    AuctionVaultMock internal vault;
    AuctionValidationGateMock internal gate;
    SealedAuctionHouse internal house;

    function setUp() public {
        vm.warp(NOW);
        (firstBidder, firstKey) = makeAddrAndKey("first bidder");
        (secondBidder, secondKey) = makeAddrAndKey("second bidder");
        vault = new AuctionVaultMock();
        gate = new AuctionValidationGateMock();
        gate.setGuarantee(GUARANTEE, true);
        gate.setCapacityPolicy(CAPACITY_POLICY, true);
        house = new SealedAuctionHouse(3 days, admin, vault, gate, clearing);
    }

    function test_UniformAuctionClearsDeterministicallyAndHandsOffOnce() public {
        (AuctionId auctionId, uint32 version) = _schedule(_definition(AuctionPriceRule.UniformPrice));
        vm.warp(NOW + 10);
        house.advanceAuction(auctionId, version);

        SealedBid memory first = _bid(auctionId, version, firstBidder, 1, 60, 100);
        SealedBid memory second = _bid(auctionId, version, secondBidder, 2, 60, 120);
        BidCommitmentId firstId = _commit(first, firstKey);
        BidCommitmentId secondId = _commit(second, secondKey);

        vm.warp(NOW + 100);
        house.advanceAuction(auctionId, version);
        house.revealBid(secondId, second);
        house.revealBid(firstId, first);

        vm.warp(NOW + 200);
        house.advanceAuction(auctionId, version);
        house.clearAuction(auctionId, version);

        assertTrue(house.verifyClearingResult(auctionId, version));
        assertEq(uint8(house.getBid(secondId).status), uint8(BidStatus.Winner));
        assertEq(Lots.unwrap(house.getBid(secondId).allocatedLots), 60);
        assertEq(Lots.unwrap(house.getBid(firstId).allocatedLots), 40);
        assertEq(PriceTicks.unwrap(house.getBid(secondId).allocationPriceTicks), 100);
        AuctionClearingResult memory result = house.getClearingResult(auctionId, version);
        assertEq(result.winnerCount, 2);
        assertEq(Lots.unwrap(result.totalAllocatedLots), 100);

        vm.prank(clearing);
        AuctionClearingHandoff memory handoff = house.consumeClearingHandoff(auctionId, version, keccak256("execution"));
        assertEq(handoff.maximumKeeperRewardMinor, 50);
        vm.expectRevert(ISealedAuctionHouse.ClearingHandoffAlreadyConsumed.selector);
        vm.prank(clearing);
        house.consumeClearingHandoff(auctionId, version, keccak256("second execution"));

        vm.prank(clearing);
        house.settleAuction(auctionId, version, keccak256("settlement"));
        assertEq(uint8(house.getAuction(auctionId, version).status), uint8(AuctionStatus.Settled));
    }

    function test_UnrevealedBondIsSlashedObjectively() public {
        (AuctionId auctionId, uint32 version) = _schedule(_definition(AuctionPriceRule.PayAsBid));
        vm.warp(NOW + 10);
        house.advanceAuction(auctionId, version);
        SealedBid memory bid = _bid(auctionId, version, firstBidder, 3, 100, 100);
        BidCommitmentId bidId = _commit(bid, firstKey);
        vm.warp(NOW + 100);
        house.advanceAuction(auctionId, version);
        vm.warp(NOW + 200);
        house.advanceAuction(auctionId, version);

        assertEq(uint8(house.getBid(bidId).status), uint8(BidStatus.BondSlashed));
        assertEq(uint8(vault.getLock(house.getBid(bidId).bondLockId).status), uint8(LockStatus.Consumed));
    }

    function test_RevealAtDeadlineIsRejected() public {
        (AuctionId auctionId, uint32 version) = _schedule(_definition(AuctionPriceRule.PayAsBid));
        vm.warp(NOW + 10);
        house.advanceAuction(auctionId, version);
        SealedBid memory bid = _bid(auctionId, version, firstBidder, 4, 100, 100);
        BidCommitmentId bidId = _commit(bid, firstKey);
        vm.warp(NOW + 100);
        house.advanceAuction(auctionId, version);
        vm.warp(NOW + 200);
        vm.expectRevert(ISealedAuctionHouse.AuctionPhaseClosed.selector);
        house.revealBid(bidId, bid);
    }

    function test_ChangedRevealPreimageCannotMatchCommitment() public {
        (AuctionId auctionId, uint32 version) = _schedule(_definition(AuctionPriceRule.PayAsBid));
        vm.warp(NOW + 10);
        house.advanceAuction(auctionId, version);
        SealedBid memory bid = _bid(auctionId, version, firstBidder, 5, 100, 100);
        BidCommitmentId bidId = _commit(bid, firstKey);
        vm.warp(NOW + 100);
        house.advanceAuction(auctionId, version);
        bid.priceTicks = PriceTicks.wrap(101);
        vm.expectRevert(ISealedAuctionHouse.BidCommitmentMismatch.selector);
        house.revealBid(bidId, bid);
    }

    function test_SolverRouteClearsToExactCapacityBackedHandoff() public {
        PackageLeg[] memory legs = _routeLegs();
        AuctionDefinition memory definition = _solverDefinition(PackageDefinitionLib.hashLegs(legs));
        (AuctionId auctionId, uint32 version) = _schedule(definition, legs);
        vm.warp(NOW + 10);
        house.advanceAuction(auctionId, version);

        AccountId solverAccountId = AccountId.wrap(keccak256(abi.encode("account", firstBidder)));
        uint64 capacityExpiry = uint64(NOW + 450);
        vm.prank(firstBidder);
        CollateralLockId capacityLockId = vault.createLock(
            keccak256("solver capacity"), solverAccountId, SETTLEMENT_ASSET, 1, 1_000, capacityExpiry, clearing
        );
        CollateralId capacityCollateralId = vault.deriveCollateralId(SETTLEMENT_ASSET, 1);
        AdapterId adapterId = AdapterId.wrap(keccak256("venue adapter"));
        bytes32 capabilityHash = keccak256("exact fill capability");
        gate.setAdapter(adapterId, capabilityHash, true);
        SolverAction[] memory actions = new SolverAction[](1);
        actions[0] = SolverAction({
            actionTypeId: keccak256("swap exact input"),
            adapterId: adapterId,
            adapterVersion: 1,
            adapterCapabilityHash: capabilityHash,
            inputAssetId: SETTLEMENT_ASSET,
            outputAssetId: AssetId.wrap(keccak256("btc")),
            maximumInput: 1_000,
            minimumOutput: 900,
            dependencyMask: 0
        });
        bytes32 capacityEvidenceHash = keccak256("capacity evidence");
        SolverRoute memory route = SolverRoute({
            auctionId: auctionId,
            auctionVersion: version,
            solver: firstBidder,
            solverAccountId: solverAccountId,
            routeId: SolverRouteId.wrap(bytes32(0)),
            packageLegsHash: PackageDefinitionLib.hashLegs(legs),
            actionGraphHash: AuctionHashLib.hashActionGraph(actions),
            legCount: uint16(legs.length),
            actionCount: uint16(actions.length),
            packageOutcomeTicks: PriceTicks.wrap(125),
            maximumFeeMinor: 10,
            capacityLockId: capacityLockId,
            capacityCollateralId: capacityCollateralId,
            capacityAmount: 1_000,
            capacityEvidenceHash: capacityEvidenceHash,
            expiry: capacityExpiry,
            guaranteeClassId: GUARANTEE,
            salt: keccak256("route salt")
        });
        route.routeId = AuctionHashLib.deriveSolverRouteId(route);
        SealedBid memory bid = _bid(auctionId, version, firstBidder, 6, 100, 125);
        bid.minimumFillLots = Lots.wrap(100);
        bid.solverRouteId = route.routeId;
        bid.capacityEvidenceHash = capacityEvidenceHash;
        BidCommitmentId bidId = _commit(bid, firstKey);

        vm.warp(NOW + 100);
        house.advanceAuction(auctionId, version);
        house.revealSolverBid(bidId, bid, route, legs, actions);
        vm.warp(NOW + 200);
        house.advanceAuction(auctionId, version);
        house.clearAuction(auctionId, version);

        assertTrue(house.verifyClearingResult(auctionId, version));
        assertEq(
            BidCommitmentId.unwrap(house.getClearingResult(auctionId, version).winningRouteBidId),
            BidCommitmentId.unwrap(bidId)
        );
        vm.prank(clearing);
        AuctionClearingHandoff memory handoff =
            house.consumeClearingHandoff(auctionId, version, keccak256("solver execution"));
        assertEq(CollateralLockId.unwrap(handoff.capacityLockId), CollateralLockId.unwrap(capacityLockId));
        assertEq(handoff.capacityAmount, 1_000);
    }

    function _schedule(AuctionDefinition memory definition) internal returns (AuctionId auctionId, uint32 version) {
        PackageLeg[] memory noLegs = new PackageLeg[](0);
        return _schedule(definition, noLegs);
    }

    function _schedule(AuctionDefinition memory definition, PackageLeg[] memory legs)
        internal
        returns (AuctionId auctionId, uint32 version)
    {
        vm.prank(admin);
        return house.scheduleAuction(definition, legs);
    }

    function _commit(SealedBid memory bid, uint256 privateKey) internal returns (BidCommitmentId bidId) {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256(abi.encode(bid.bidder));
        BidCommitAuthorization memory authorization = BidCommitAuthorization({
            auctionId: bid.auctionId,
            auctionVersion: bid.auctionVersion,
            bidder: bid.bidder,
            bidderAccountId: bid.bidderAccountId,
            nonce: bid.nonce,
            sealedBidHash: AuctionHashLib.hashBid(bid),
            eligibilityProofHash: keccak256(abi.encodePacked(proof)),
            deadline: uint64(NOW + 90),
            salt: keccak256(abi.encode("commit", bid.nonce))
        });
        bytes32 digest = AuctionHashLib.bidCommitDigest(authorization, block.chainid, address(house));
        bidId = house.commitBid(authorization, proof, _sign(privateKey, digest));
    }

    function _bid(AuctionId auctionId, uint32 version, address bidder, uint256 nonce, uint128 lots, int128 price)
        internal
        pure
        returns (SealedBid memory)
    {
        return SealedBid({
            auctionId: auctionId,
            auctionVersion: version,
            bidder: bidder,
            bidderAccountId: AccountId.wrap(keccak256(abi.encode("account", bidder))),
            bidderOrderHash: keccak256(abi.encode("bidder order", bidder, nonce)),
            nonce: nonce,
            side: Side.Sell,
            lots: Lots.wrap(lots),
            allowPartialAllocation: true,
            minimumFillLots: Lots.wrap(10),
            priceTicks: PriceTicks.wrap(price),
            maximumFeeMinor: 10,
            solverRouteId: SolverRouteId.wrap(bytes32(0)),
            capacityEvidenceHash: keccak256("capacity evidence"),
            revealSalt: keccak256(abi.encode("reveal", nonce))
        });
    }

    function _definition(AuctionPriceRule priceRule) internal pure returns (AuctionDefinition memory) {
        return AuctionDefinition({
            namespaceId: keccak256("namespace"),
            auctionKey: keccak256(abi.encode("auction", priceRule)),
            initiatorOrderHash: keccak256("initiator order"),
            initiatorAccountId: AccountId.wrap(keccak256("initiator account")),
            initiatorMaximumFeeMinor: 10,
            executionModeId: keccak256("execution mode"),
            kind: AuctionKind.BatchOrder,
            targetKind: AuctionTargetKind.Series,
            seriesId: SeriesId.wrap(keccak256("series")),
            packageId: PackageId.wrap(bytes32(0)),
            targetVersion: 1,
            hasPackageLegCommitment: false,
            packageLegsHash: bytes32(0),
            auctionSide: Side.Sell,
            settlementAssetId: SETTLEMENT_ASSET,
            settlementAssetVersion: 1,
            riskDomainId: RiskDomainId.wrap(keccak256("risk")),
            riskDomainVersion: 1,
            feeScheduleId: FeeScheduleId.wrap(keccak256("fee")),
            feeScheduleVersion: 1,
            eligibilityPolicyHash: keccak256("eligibility"),
            capacityPolicyHash: CAPACITY_POLICY,
            bondPolicyHash: keccak256("bond policy"),
            allocationPolicyHash: keccak256("allocation policy"),
            guaranteeClassId: GUARANTEE,
            priceRule: priceRule,
            tieBreakRule: AuctionTieBreakRule.CommitmentHashAscending,
            noBidTreatment: NoBidTreatment.Fail,
            unrevealedBondOutcome: BondOutcome.Slash,
            losingBondOutcome: BondOutcome.Release,
            settlementFailureBondOutcome: BondOutcome.Slash,
            totalLots: Lots.wrap(100),
            lotStep: Lots.wrap(10),
            maximumBids: 8,
            commitOpensAt: uint64(NOW + 10),
            commitClosesAt: uint64(NOW + 100),
            revealClosesAt: uint64(NOW + 200),
            clearDeadline: uint64(NOW + 300),
            settlementDeadline: uint64(NOW + 400),
            bondExpiry: uint64(NOW + 500),
            bondAssetId: SETTLEMENT_ASSET,
            bondBindingVersion: 1,
            requiredBondAmount: 50,
            slashRecipientAccountId: AccountId.wrap(keccak256("slash recipient")),
            maximumKeeperRewardMinor: 50,
            qualificationEvidenceHash: keccak256("qualification")
        });
    }

    function _solverDefinition(bytes32 packageLegsHash) internal pure returns (AuctionDefinition memory definition) {
        definition = _definition(AuctionPriceRule.PayAsBid);
        definition.auctionKey = keccak256("solver auction");
        definition.kind = AuctionKind.SolverRoute;
        definition.targetKind = AuctionTargetKind.Package;
        definition.seriesId = SeriesId.wrap(bytes32(0));
        definition.packageId = PackageId.wrap(keccak256("package"));
        definition.hasPackageLegCommitment = true;
        definition.packageLegsHash = packageLegsHash;
        definition.priceRule = AuctionPriceRule.BestPackage;
    }

    function _routeLegs() internal pure returns (PackageLeg[] memory legs) {
        legs = new PackageLeg[](2);
        legs[0] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(1))), seriesVersion: 1, ratio: 1});
        legs[1] = PackageLeg({seriesId: SeriesId.wrap(bytes32(uint256(2))), seriesVersion: 1, ratio: -1});
    }

    function _sign(uint256 privateKey, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
