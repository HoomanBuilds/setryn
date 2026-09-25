// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Eip712Lib} from "./Eip712Lib.sol";
import {PackageDefinitionLib} from "./PackageDefinitionLib.sol";
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
} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {Side} from "../types/Enums.sol";
import {
    AuctionDefinition,
    AuctionId,
    AuctionKind,
    AuctionPriceRule,
    AuctionTargetKind,
    AuctionTieBreakRule,
    BidCommitAuthorization,
    BidCommitmentId,
    BondOutcome,
    NoBidTreatment,
    SealedBid,
    SolverAction,
    SolverRoute,
    SolverRouteId
} from "../types/AuctionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

library AuctionHashLib {
    uint16 internal constant MAXIMUM_ACTIONS = 32;
    uint16 internal constant MAXIMUM_LEGS = 16;
    uint16 internal constant MAXIMUM_BIDS = 64;

    bytes32 internal constant AUCTION_KEY_TYPEHASH =
        keccak256("SetrynAuctionKeyV1(bytes32 namespaceId,bytes32 auctionKey)");
    bytes32 internal constant AUCTION_DEFINITION_TYPEHASH = keccak256("SetrynAuctionDefinitionV1");
    bytes32 internal constant AUCTION_VERSION_TYPEHASH = keccak256(
        "SetrynAuctionVersionV1(bytes32 auctionId,uint32 version,bytes32 definitionHash,uint256 chainId,address auctionHouse)"
    );
    bytes32 internal constant BID_COMMIT_TYPEHASH = keccak256(
        "BidCommitAuthorization(bytes32 auctionId,uint32 auctionVersion,address bidder,bytes32 bidderAccountId,uint256 nonce,bytes32 sealedBidHash,bytes32 eligibilityProofHash,uint64 deadline,bytes32 salt)"
    );
    bytes32 internal constant SEALED_BID_TYPEHASH = keccak256(
        "SealedBid(bytes32 auctionId,uint32 auctionVersion,address bidder,bytes32 bidderAccountId,bytes32 bidderOrderHash,uint256 nonce,uint8 side,uint128 lots,bool allowPartialAllocation,uint128 minimumFillLots,int128 priceTicks,uint128 maximumFeeMinor,bytes32 solverRouteId,bytes32 capacityEvidenceHash,bytes32 revealSalt)"
    );
    bytes32 internal constant SOLVER_ACTION_TYPEHASH = keccak256(
        "SolverAction(bytes32 actionTypeId,bytes32 adapterId,uint32 adapterVersion,bytes32 adapterCapabilityHash,bytes32 inputAssetId,bytes32 outputAssetId,uint128 maximumInput,uint128 minimumOutput,uint32 dependencyMask)"
    );
    bytes32 internal constant ACTION_GRAPH_TYPEHASH = keccak256("SetrynSolverActionGraphV1(bytes32 actionHashesHash)");
    bytes32 internal constant SOLVER_ROUTE_TYPEHASH = keccak256(
        "SolverRoute(bytes32 auctionId,uint32 auctionVersion,address solver,bytes32 solverAccountId,bytes32 routeId,bytes32 packageLegsHash,bytes32 actionGraphHash,uint16 legCount,uint16 actionCount,int128 packageOutcomeTicks,uint128 maximumFeeMinor,bytes32 capacityLockId,bytes32 capacityCollateralId,uint128 capacityAmount,bytes32 capacityEvidenceHash,uint64 expiry,bytes32 guaranteeClassId,bytes32 salt)"
    );
    bytes32 internal constant RESULT_TYPEHASH = keccak256(
        "SetrynAuctionResultV1(bytes32 auctionId,uint32 auctionVersion,bytes32 winningRouteBidId,int128 uniformPriceTicks,uint128 totalAllocatedLots,uint16 winnerCount,bytes32 allocationsHash)"
    );

    error InvalidAuctionField();
    error InvalidAuctionTarget();
    error InvalidAuctionRules();
    error InvalidAuctionDeadlines();
    error InvalidAuctionLots();
    error InvalidPackageLegCommitment();
    error InvalidBidField();
    error InvalidBidLots();
    error InvalidRouteField();
    error InvalidRouteGraph();

    function deriveAuctionId(AuctionDefinition memory definition) internal pure returns (AuctionId) {
        return
            AuctionId.wrap(keccak256(abi.encode(AUCTION_KEY_TYPEHASH, definition.namespaceId, definition.auctionKey)));
    }

    function hashDefinition(AuctionDefinition memory definition, uint256 chainId, address auctionHouse)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(AUCTION_DEFINITION_TYPEHASH, definition, chainId, auctionHouse));
    }

    function hashVersion(
        AuctionId auctionId,
        uint32 version,
        bytes32 definitionHash,
        uint256 chainId,
        address auctionHouse
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                AUCTION_VERSION_TYPEHASH, AuctionId.unwrap(auctionId), version, definitionHash, chainId, auctionHouse
            )
        );
    }

    function hashBidCommit(BidCommitAuthorization memory authorization) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BID_COMMIT_TYPEHASH,
                AuctionId.unwrap(authorization.auctionId),
                authorization.auctionVersion,
                authorization.bidder,
                AccountId.unwrap(authorization.bidderAccountId),
                authorization.nonce,
                authorization.sealedBidHash,
                authorization.eligibilityProofHash,
                authorization.deadline,
                authorization.salt
            )
        );
    }

    function bidCommitDigest(BidCommitAuthorization memory authorization, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return Eip712Lib.toTypedDataDigest(
            Eip712Lib.domainSeparator(chainId, verifyingContract), hashBidCommit(authorization)
        );
    }

    function deriveBidCommitmentId(BidCommitAuthorization memory authorization)
        internal
        pure
        returns (BidCommitmentId)
    {
        return BidCommitmentId.wrap(
            keccak256(
                abi.encode(
                    keccak256("SetrynBidCommitmentIdV1(bytes32 auctionId,uint32 version,address bidder,uint256 nonce)"),
                    AuctionId.unwrap(authorization.auctionId),
                    authorization.auctionVersion,
                    authorization.bidder,
                    authorization.nonce
                )
            )
        );
    }

    function hashBid(SealedBid memory bid) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SEALED_BID_TYPEHASH,
                AuctionId.unwrap(bid.auctionId),
                bid.auctionVersion,
                bid.bidder,
                AccountId.unwrap(bid.bidderAccountId),
                bid.bidderOrderHash,
                bid.nonce,
                bid.side,
                Lots.unwrap(bid.lots),
                bid.allowPartialAllocation,
                Lots.unwrap(bid.minimumFillLots),
                PriceTicks.unwrap(bid.priceTicks),
                bid.maximumFeeMinor,
                SolverRouteId.unwrap(bid.solverRouteId),
                bid.capacityEvidenceHash,
                bid.revealSalt
            )
        );
    }

    function hashAction(SolverAction memory action) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SOLVER_ACTION_TYPEHASH,
                action.actionTypeId,
                AdapterId.unwrap(action.adapterId),
                action.adapterVersion,
                action.adapterCapabilityHash,
                AssetId.unwrap(action.inputAssetId),
                AssetId.unwrap(action.outputAssetId),
                action.maximumInput,
                action.minimumOutput,
                action.dependencyMask
            )
        );
    }

    function hashActionGraph(SolverAction[] memory actions) internal pure returns (bytes32) {
        if (actions.length == 0 || actions.length > MAXIMUM_ACTIONS) revert InvalidRouteGraph();
        bytes32[] memory hashes = new bytes32[](actions.length);
        for (uint256 i; i < actions.length; ++i) {
            SolverAction memory action = actions[i];
            if (
                action.actionTypeId == bytes32(0) || AdapterId.unwrap(action.adapterId) == bytes32(0)
                    || action.adapterVersion == 0 || action.adapterCapabilityHash == bytes32(0)
                    || AssetId.unwrap(action.inputAssetId) == bytes32(0)
                    || AssetId.unwrap(action.outputAssetId) == bytes32(0)
            ) revert InvalidRouteField();
            hashes[i] = hashAction(action);
        }
        return keccak256(abi.encode(ACTION_GRAPH_TYPEHASH, keccak256(abi.encodePacked(hashes))));
    }

    function hashRoute(SolverRoute memory route) internal pure returns (bytes32) {
        return _hashRoute(route, route.routeId);
    }

    function deriveSolverRouteId(SolverRoute memory route) internal pure returns (SolverRouteId) {
        return SolverRouteId.wrap(_hashRoute(route, SolverRouteId.wrap(bytes32(0))));
    }

    function _hashRoute(SolverRoute memory route, SolverRouteId routeId) private pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    SOLVER_ROUTE_TYPEHASH,
                    AuctionId.unwrap(route.auctionId),
                    route.auctionVersion,
                    route.solver,
                    AccountId.unwrap(route.solverAccountId),
                    SolverRouteId.unwrap(routeId),
                    route.packageLegsHash,
                    route.actionGraphHash,
                    route.legCount,
                    route.actionCount,
                    PriceTicks.unwrap(route.packageOutcomeTicks)
                ),
                abi.encode(
                    route.maximumFeeMinor,
                    CollateralLockId.unwrap(route.capacityLockId),
                    CollateralId.unwrap(route.capacityCollateralId),
                    route.capacityAmount,
                    route.capacityEvidenceHash,
                    route.expiry,
                    route.guaranteeClassId,
                    route.salt
                )
            )
        );
    }

    function hashResult(
        AuctionId auctionId,
        uint32 version,
        BidCommitmentId winningRouteBidId,
        PriceTicks uniformPriceTicks,
        Lots totalAllocatedLots,
        uint16 winnerCount,
        bytes32 allocationsHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RESULT_TYPEHASH,
                AuctionId.unwrap(auctionId),
                version,
                BidCommitmentId.unwrap(winningRouteBidId),
                PriceTicks.unwrap(uniformPriceTicks),
                Lots.unwrap(totalAllocatedLots),
                winnerCount,
                allocationsHash
            )
        );
    }

    function validateDefinition(AuctionDefinition memory definition, PackageLeg[] memory packageLegs) internal pure {
        if (
            definition.namespaceId == bytes32(0) || definition.auctionKey == bytes32(0)
                || definition.initiatorOrderHash == bytes32(0)
                || AccountId.unwrap(definition.initiatorAccountId) == bytes32(0)
                || definition.executionModeId == bytes32(0) || definition.targetVersion == 0
                || AssetId.unwrap(definition.settlementAssetId) == bytes32(0) || definition.settlementAssetVersion == 0
                || RiskDomainId.unwrap(definition.riskDomainId) == bytes32(0) || definition.riskDomainVersion == 0
                || FeeScheduleId.unwrap(definition.feeScheduleId) == bytes32(0) || definition.feeScheduleVersion == 0
                || definition.eligibilityPolicyHash == bytes32(0) || definition.capacityPolicyHash == bytes32(0)
                || definition.bondPolicyHash == bytes32(0) || definition.allocationPolicyHash == bytes32(0)
                || definition.guaranteeClassId == bytes32(0) || definition.qualificationEvidenceHash == bytes32(0)
                || AssetId.unwrap(definition.bondAssetId) == bytes32(0) || definition.bondBindingVersion == 0
                || definition.requiredBondAmount == 0
                || AccountId.unwrap(definition.slashRecipientAccountId) == bytes32(0)
        ) revert InvalidAuctionField();
        _validateTarget(definition, packageLegs);
        if (definition.kind == AuctionKind.Unspecified || definition.auctionSide == Side.Unspecified) {
            revert InvalidAuctionRules();
        }
        if (
            definition.tieBreakRule != AuctionTieBreakRule.CommitmentHashAscending
                || definition.noBidTreatment == NoBidTreatment.Unspecified
                || definition.unrevealedBondOutcome == BondOutcome.Unspecified
                || definition.losingBondOutcome == BondOutcome.Unspecified
                || definition.settlementFailureBondOutcome == BondOutcome.Unspecified
        ) revert InvalidAuctionRules();
        if (definition.kind == AuctionKind.SolverRoute) {
            if (definition.priceRule != AuctionPriceRule.BestPackage) revert InvalidAuctionRules();
        } else if (
            definition.priceRule != AuctionPriceRule.UniformPrice && definition.priceRule != AuctionPriceRule.PayAsBid
        ) {
            revert InvalidAuctionRules();
        }
        uint128 total = Lots.unwrap(definition.totalLots);
        uint128 step = Lots.unwrap(definition.lotStep);
        if (total == 0 || step == 0 || total % step != 0) revert InvalidAuctionLots();
        if (definition.maximumBids == 0 || definition.maximumBids > MAXIMUM_BIDS) revert InvalidAuctionRules();
        if (
            definition.commitOpensAt >= definition.commitClosesAt
                || definition.commitClosesAt >= definition.revealClosesAt
                || definition.revealClosesAt >= definition.clearDeadline
                || definition.clearDeadline >= definition.settlementDeadline
                || definition.settlementDeadline >= definition.bondExpiry
        ) revert InvalidAuctionDeadlines();
    }

    function validateBid(SealedBid memory bid, AuctionDefinition memory definition) internal pure {
        if (
            AuctionId.unwrap(bid.auctionId) == bytes32(0) || bid.auctionVersion == 0 || bid.bidder == address(0)
                || AccountId.unwrap(bid.bidderAccountId) == bytes32(0) || bid.bidderOrderHash == bytes32(0)
                || bid.side != definition.auctionSide || bid.revealSalt == bytes32(0)
                || bid.capacityEvidenceHash == bytes32(0)
        ) revert InvalidBidField();
        uint128 lots = Lots.unwrap(bid.lots);
        uint128 minimum = Lots.unwrap(bid.minimumFillLots);
        uint128 step = Lots.unwrap(definition.lotStep);
        if (
            lots == 0 || lots > Lots.unwrap(definition.totalLots) || lots % step != 0 || minimum == 0 || minimum > lots
                || minimum % step != 0 || (!bid.allowPartialAllocation && minimum != lots)
        ) revert InvalidBidLots();
        bool hasRoute = SolverRouteId.unwrap(bid.solverRouteId) != bytes32(0);
        if ((definition.kind == AuctionKind.SolverRoute) != hasRoute) revert InvalidBidField();
        if (definition.kind == AuctionKind.SolverRoute && lots != Lots.unwrap(definition.totalLots)) {
            revert InvalidBidLots();
        }
    }

    function validateRoute(
        SolverRoute memory route,
        AuctionDefinition memory definition,
        PackageLeg[] memory routeLegs,
        SolverAction[] memory actions
    ) internal pure {
        if (
            route.solver == address(0) || AccountId.unwrap(route.solverAccountId) == bytes32(0)
                || SolverRouteId.unwrap(route.routeId) == bytes32(0) || route.capacityAmount == 0
                || CollateralLockId.unwrap(route.capacityLockId) == bytes32(0)
                || CollateralId.unwrap(route.capacityCollateralId) == bytes32(0)
                || route.capacityEvidenceHash == bytes32(0) || route.salt == bytes32(0)
                || route.guaranteeClassId != definition.guaranteeClassId
        ) revert InvalidRouteField();
        if (SolverRouteId.unwrap(route.routeId) != SolverRouteId.unwrap(deriveSolverRouteId(route))) {
            revert InvalidRouteField();
        }
        if (route.expiry <= definition.settlementDeadline || route.legCount != routeLegs.length) {
            revert InvalidRouteField();
        }
        if (routeLegs.length == 0 || routeLegs.length > MAXIMUM_LEGS) revert InvalidRouteGraph();
        if (route.packageLegsHash != PackageDefinitionLib.hashLegs(routeLegs)) revert InvalidRouteGraph();
        if (route.actionCount != actions.length || route.actionGraphHash != hashActionGraph(actions)) {
            revert InvalidRouteGraph();
        }
    }

    function _validateTarget(AuctionDefinition memory definition, PackageLeg[] memory packageLegs) private pure {
        bool hasSeries = SeriesId.unwrap(definition.seriesId) != bytes32(0);
        bool hasPackage = PackageId.unwrap(definition.packageId) != bytes32(0);
        if (definition.targetKind == AuctionTargetKind.Series) {
            if (
                !hasSeries || hasPackage || definition.hasPackageLegCommitment
                    || definition.packageLegsHash != bytes32(0) || packageLegs.length != 0
            ) revert InvalidAuctionTarget();
        } else if (definition.targetKind == AuctionTargetKind.Package) {
            if (!hasPackage || hasSeries) revert InvalidAuctionTarget();
            if (definition.hasPackageLegCommitment) {
                if (PackageDefinitionLib.hashLegs(packageLegs) != definition.packageLegsHash) {
                    revert InvalidPackageLegCommitment();
                }
            } else if (definition.packageLegsHash != bytes32(0) || packageLegs.length != 0) {
                revert InvalidPackageLegCommitment();
            }
        } else {
            revert InvalidAuctionTarget();
        }
    }
}
