// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {ClearingLib} from "../libraries/ClearingLib.sol";
import {
    CapacityDispositionKind,
    CapacityReservationDisposition,
    ClearingHandoffClaim,
    ClearingHandoffKind,
    UnusedCapacityPolicy,
    VerifiedClearingHandoff
} from "../types/ClearingHandoffTypes.sol";
import {BilateralMatch, ClearingAdmission, ClearingChannelKind, FillRecord} from "../types/ClearingTypes.sol";
import {
    AccountId,
    CollateralLockId,
    FeeScheduleId,
    FillId,
    PackageId,
    PositionId,
    RiskDomainId,
    SeriesId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {OrderRecord, OrderTargetKind} from "../types/OrderTypes.sol";
import {PositionLiabilitySide} from "../types/PositionTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {RiskAdmission, RiskAdmissionConsumption, RiskAdmissionId, RiskAdmissionStatus} from "../types/RiskTypes.sol";

import {
    CLEARING_DIRECT_CHANNEL_TYPEHASH,
    CLEARING_ROUTE_COMMITMENT_TYPEHASH,
    ClearingDependencies,
    FeeContext,
    MatchContext,
    SettlementContext
} from "./AtomicClearingTypes.sol";

/// Linked logic for the atomic clearing engine: match preparation, admission consumption, channel handoffs,
/// and fill records. Runs through DELEGATECALL in the engine's context against the engine's storage.
library AtomicClearingMatchLib {
    function consumeChannelHandoff(
        mapping(ClearingChannelKind channelKind => IClearingChannelHandoffAdapter adapter) storage channelAdapters,
        mapping(ClearingChannelKind channelKind => bytes32 capabilityHash) storage channelCapabilities,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim calldata claim
    ) external returns (ClearingHandoffClaim memory verifiedClaim, address source) {
        ClearingHandoffKind expectedKind;
        if (channelKind == ClearingChannelKind.PrivateRfq) expectedKind = ClearingHandoffKind.PrivateRfq;
        else if (channelKind == ClearingChannelKind.SealedAuction) expectedKind = ClearingHandoffKind.SealedAuction;
        else revert IAtomicClearingEngine.UnsupportedClearingChannel(channelKind);
        if (claim.kind != expectedKind || claim.consumptionId == bytes32(0) || claim.sourceCommitment == bytes32(0)) {
            revert IAtomicClearingEngine.ClearingHandoffMismatch();
        }
        if (claim.deadline < block.timestamp) revert IAtomicClearingEngine.ClearingHandoffMismatch();
        IClearingChannelHandoffAdapter adapter = channelAdapters[channelKind];
        if (address(adapter) == address(0) || channelCapabilities[channelKind] == bytes32(0)) {
            revert IAtomicClearingEngine.UnsupportedClearingChannel(channelKind);
        }
        source = adapter.source();
        if (source != address(adapter)) {
            revert IAtomicClearingEngine.ClearingChannelSourceMismatch(address(adapter), source);
        }
        VerifiedClearingHandoff memory handoff = adapter.consumeTypedHandoff(claim);
        if (
            handoff.provenanceHash == bytes32(0) || keccak256(abi.encode(handoff.claim)) != keccak256(abi.encode(claim))
        ) {
            revert IAtomicClearingEngine.ClearingHandoffMismatch();
        }
        verifiedClaim = handoff.claim;
    }

    function prepareMatch(
        ClearingDependencies memory deps,
        mapping(FillId fillId => FillRecord record) storage fills,
        BilateralMatch calldata matchData,
        OrderRecord memory taker,
        OrderRecord memory maker,
        bytes32 witnessHash,
        bool isPackage
    ) external view returns (MatchContext memory context) {
        bool takerIsBuyer = ClearingLib.validateMatch(
            matchData.takerOrderHash,
            taker,
            matchData.makerOrderHash,
            maker,
            matchData.fillLots,
            matchData.executionPriceTicks
        );
        Lots takerCumulative = Lots.wrap(Lots.unwrap(taker.filledLots) + Lots.unwrap(matchData.fillLots));
        Lots makerCumulative = Lots.wrap(Lots.unwrap(maker.filledLots) + Lots.unwrap(matchData.fillLots));
        FillId fillId = ClearingLib.deriveFillId(
            block.chainid,
            address(this),
            matchData.takerOrderHash,
            matchData.makerOrderHash,
            takerCumulative,
            makerCumulative,
            matchData.fillLots,
            matchData.executionPriceTicks,
            witnessHash
        );
        if (FillId.unwrap(fills[fillId].fillId) != bytes32(0)) revert IAtomicClearingEngine.FillAlreadyExists(fillId);

        bytes32 targetId = isPackage ? PackageId.unwrap(taker.order.packageId) : SeriesId.unwrap(taker.order.seriesId);
        deps.admissionGate
            .validateMatch(
                taker.order,
                maker.order,
                ClearingAdmission({
                    takerOrderHash: matchData.takerOrderHash,
                    makerOrderHash: matchData.makerOrderHash,
                    targetId: targetId,
                    witnessHash: witnessHash,
                    executionModeId: taker.order.executionModeId,
                    submitter: msg.sender,
                    targetVersion: taker.order.targetVersion,
                    fillLots: matchData.fillLots,
                    executionPriceTicks: matchData.executionPriceTicks,
                    longAdmissionId: matchData.longAdmissionId,
                    longAdmissionResultHash: matchData.longAdmissionResultHash,
                    shortAdmissionId: matchData.shortAdmissionId,
                    shortAdmissionResultHash: matchData.shortAdmissionResultHash,
                    isPackage: isPackage
                })
            );
        context = MatchContext({
            taker: taker,
            maker: maker,
            takerOrderHash: matchData.takerOrderHash,
            makerOrderHash: matchData.makerOrderHash,
            fillId: fillId,
            takerCumulativeLots: takerCumulative,
            makerCumulativeLots: makerCumulative,
            fillLots: matchData.fillLots,
            executionPriceTicks: matchData.executionPriceTicks,
            buyerAccountId: takerIsBuyer ? taker.order.accountId : maker.order.accountId,
            sellerAccountId: takerIsBuyer ? maker.order.accountId : taker.order.accountId,
            takerIsBuyer: takerIsBuyer
        });
    }

    function consumeMatch(
        ClearingDependencies memory deps,
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        uint16 expectedPositionCount
    ) external {
        _consumeOrders(deps, context, matchData.fillLots);
        _consumeRiskAdmissions(deps, context, matchData, settlement, expectedPositionCount);
    }

    function _consumeOrders(ClearingDependencies memory deps, MatchContext memory context, Lots fillLots) internal {
        bytes32 executionReference = FillId.unwrap(context.fillId);
        deps.orderState.consumeOrderFill(context.takerOrderHash, fillLots, executionReference);
        deps.orderState.consumeOrderFill(context.makerOrderHash, fillLots, executionReference);
    }

    function _consumeRiskAdmissions(
        ClearingDependencies memory deps,
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        uint16 expectedPositionCount
    ) internal {
        if (
            RiskAdmissionId.unwrap(matchData.longAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(matchData.shortAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(matchData.longAdmissionId)
                    == RiskAdmissionId.unwrap(matchData.shortAdmissionId)
                || matchData.longAdmissionResultHash == bytes32(0) || matchData.shortAdmissionResultHash == bytes32(0)
        ) revert IAtomicClearingEngine.ClearingHandoffMismatch();
        RiskAdmission memory longAdmission = deps.riskEngine.getAdmission(matchData.longAdmissionId);
        RiskAdmission memory shortAdmission = deps.riskEngine.getAdmission(matchData.shortAdmissionId);
        if (
            longAdmission.status != RiskAdmissionStatus.Reserved
                || shortAdmission.status != RiskAdmissionStatus.Reserved
                || RiskDomainId.unwrap(longAdmission.riskDomainId) != RiskDomainId.unwrap(shortAdmission.riskDomainId)
                || longAdmission.riskDomainVersion != shortAdmission.riskDomainVersion
        ) revert IAtomicClearingEngine.ClearingHandoffMismatch();
        uint128 openInterest = Lots.unwrap(matchData.fillLots);
        bytes32 executionReference = FillId.unwrap(context.fillId);
        deps.riskEngine
            .consumeAdmission(
                RiskAdmissionConsumption({
                    admissionId: matchData.longAdmissionId,
                    expectedResultHash: matchData.longAdmissionResultHash,
                    expectedAccountId: context.buyerAccountId,
                    expectedRiskDomainId: longAdmission.riskDomainId,
                    expectedRiskDomainVersion: longAdmission.riskDomainVersion,
                    expectedOpenInterestBaseUnits: openInterest,
                    expectedTerminalLiabilityBaseUnits: settlement.longLiabilityMinor,
                    expectedPositionCount: expectedPositionCount,
                    executionReference: executionReference
                })
            );
        deps.riskEngine
            .consumeAdmission(
                RiskAdmissionConsumption({
                    admissionId: matchData.shortAdmissionId,
                    expectedResultHash: matchData.shortAdmissionResultHash,
                    expectedAccountId: context.sellerAccountId,
                    expectedRiskDomainId: shortAdmission.riskDomainId,
                    expectedRiskDomainVersion: shortAdmission.riskDomainVersion,
                    expectedOpenInterestBaseUnits: openInterest,
                    expectedTerminalLiabilityBaseUnits: settlement.shortLiabilityMinor,
                    expectedPositionCount: expectedPositionCount,
                    executionReference: executionReference
                })
            );
    }

    function validateChannelMatch(
        ClearingDependencies memory deps,
        MatchContext memory context,
        BilateralMatch calldata matchData,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory claim,
        bytes32 packageLegsHash
    ) external view {
        if (channelKind == ClearingChannelKind.Direct) {
            if (claim.consumptionId != bytes32(0)) revert IAtomicClearingEngine.ClearingHandoffMismatch();
            return;
        }
        bool packageTarget = context.taker.order.targetKind == OrderTargetKind.Package;
        if (
            claim.takerOrderHash != context.takerOrderHash || claim.makerOrderHash != context.makerOrderHash
                || AccountId.unwrap(claim.takerAccountId) != AccountId.unwrap(context.taker.order.accountId)
                || AccountId.unwrap(claim.makerAccountId) != AccountId.unwrap(context.maker.order.accountId)
                || claim.takerSide != context.taker.order.side || claim.targetKind != context.taker.order.targetKind
                || claim.targetVersion != context.taker.order.targetVersion || Lots.unwrap(claim.fillLots) == 0
                || FeeScheduleId.unwrap(claim.feeScheduleId) != FeeScheduleId.unwrap(context.taker.order.feeScheduleId)
                || claim.feeScheduleVersion != context.taker.order.feeScheduleVersion
                || claim.takerMaximumFeeMinor != context.taker.order.maxFeeMinor
                || claim.makerMaximumFeeMinor != context.maker.order.maxFeeMinor
                || claim.executionModeId != context.taker.order.executionModeId
                || RiskAdmissionId.unwrap(claim.longAdmissionId) != RiskAdmissionId.unwrap(matchData.longAdmissionId)
                || claim.longAdmissionResultHash != matchData.longAdmissionResultHash
                || RiskAdmissionId.unwrap(claim.shortAdmissionId) != RiskAdmissionId.unwrap(matchData.shortAdmissionId)
                || claim.shortAdmissionResultHash != matchData.shortAdmissionResultHash
                || claim.deadline > context.taker.order.deadline || claim.deadline > context.maker.order.deadline
        ) revert IAtomicClearingEngine.ClearingHandoffMismatch();
        if (
            Lots.unwrap(claim.fillLots) != Lots.unwrap(context.fillLots)
                || PriceTicks.unwrap(claim.executionPriceTicks) != PriceTicks.unwrap(context.executionPriceTicks)
        ) revert IAtomicClearingEngine.ClearingHandoffMismatch();
        if (packageTarget) {
            if (
                PackageId.unwrap(claim.packageId) != PackageId.unwrap(context.taker.order.packageId)
                    || SeriesId.unwrap(claim.seriesId) != bytes32(0) || claim.packageWitnessHash != packageLegsHash
                    || deps.packageRegistry.hashLegs(claim.packageLegs) != packageLegsHash
            ) revert IAtomicClearingEngine.ClearingHandoffMismatch();
        } else if (
            SeriesId.unwrap(claim.seriesId) != SeriesId.unwrap(context.taker.order.seriesId)
                || PackageId.unwrap(claim.packageId) != bytes32(0) || claim.packageWitnessHash != bytes32(0)
                || claim.packageLegs.length != 0
        ) {
            revert IAtomicClearingEngine.ClearingHandoffMismatch();
        }

        uint256 previousKey;
        uint256 positionCount = packageTarget ? claim.packageLegs.length : 1;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition memory disposition = claim.capacityDispositions[i];
            uint256 key = uint256(disposition.positionOrdinal) * 3 + uint8(disposition.side);
            if (
                disposition.capacityDisposition != CapacityDispositionKind.ConvertedToTerminalLiability
                    || disposition.side == PositionLiabilitySide.Unspecified
                    || disposition.positionOrdinal >= positionCount
                    || AccountId.unwrap(disposition.accountId) == bytes32(0) || disposition.reservationAmount == 0
                    || TerminalLiabilityReservationId.unwrap(disposition.reservationId) == bytes32(0)
                    || disposition.unusedCapacityPolicy == UnusedCapacityPolicy.Unspecified
                    || CollateralLockId.unwrap(disposition.funding.lockId) == bytes32(0)
                    || disposition.funding.lockReference == bytes32(0)
                    || disposition.funding.expectedRemainingAmount < disposition.reservationAmount
                    || disposition.funding.expectedExpiry <= block.timestamp || (i != 0 && key <= previousKey)
            ) revert IAtomicClearingEngine.ClearingHandoffMismatch();
            previousKey = key;
        }
    }

    function bindRiskExposures(
        ClearingDependencies memory deps,
        BilateralMatch calldata matchData,
        bytes32 executionReference,
        PositionId[] memory exposurePositions
    ) external {
        deps.riskEngine.bindConsumedExposure(matchData.longAdmissionId, executionReference, exposurePositions);
        deps.riskEngine.bindConsumedExposure(matchData.shortAdmissionId, executionReference, exposurePositions);
    }

    function recordFill(
        mapping(FillId fillId => FillRecord record) storage fills,
        mapping(FillId fillId => PositionId[] positionIds) storage fillPositions,
        mapping(ClearingChannelKind channelKind => IClearingChannelHandoffAdapter adapter) storage channelAdapters,
        MatchContext memory context,
        BilateralMatch calldata matchData,
        bytes32 witnessHash,
        SettlementContext memory settlement,
        FeeContext memory fees,
        uint16 positionCount,
        bool isPackage,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory channelClaim,
        address channelSource
    ) external {
        bytes32 targetId = isPackage
            ? PackageId.unwrap(context.taker.order.packageId)
            : SeriesId.unwrap(context.taker.order.seriesId);
        FillRecord memory record = FillRecord({
            fillId: context.fillId,
            takerOrderHash: matchData.takerOrderHash,
            makerOrderHash: matchData.makerOrderHash,
            targetId: targetId,
            witnessHash: witnessHash,
            executionModeId: context.taker.order.executionModeId,
            channelConsumptionId: channelKind == ClearingChannelKind.Direct
                ? keccak256(
                    abi.encode(CLEARING_DIRECT_CHANNEL_TYPEHASH, FillId.unwrap(context.fillId), msg.sender, witnessHash)
                )
                : channelClaim.consumptionId,
            routeCommitment: channelKind == ClearingChannelKind.Direct
                ? keccak256(
                    abi.encode(
                        CLEARING_ROUTE_COMMITMENT_TYPEHASH,
                        FillId.unwrap(context.fillId),
                        matchData.takerOrderHash,
                        matchData.makerOrderHash,
                        context.taker.order.executionModeId,
                        witnessHash
                    )
                )
                : channelClaim.sourceCommitment,
            channelSource: channelKind == ClearingChannelKind.Direct ? msg.sender : channelSource,
            channelKind: channelKind,
            settlementAssetId: settlement.assetId,
            buyerAccountId: context.buyerAccountId,
            sellerAccountId: context.sellerAccountId,
            makerFeeResultHash: fees.maker.resultHash,
            takerFeeResultHash: fees.taker.resultHash,
            targetVersion: context.taker.order.targetVersion,
            settlementAssetVersion: settlement.bindingVersion,
            clearedAt: uint64(block.timestamp),
            fillLots: matchData.fillLots,
            takerCumulativeLots: context.takerCumulativeLots,
            makerCumulativeLots: context.makerCumulativeLots,
            executionPriceTicks: matchData.executionPriceTicks,
            considerationMinor: settlement.considerationMinor,
            makerFeeChargeMinor: fees.maker.chargeMinor,
            makerFeeRebateMinor: fees.maker.rebateMinor,
            takerFeeChargeMinor: fees.taker.chargeMinor,
            takerFeeRebateMinor: fees.taker.rebateMinor,
            positionCount: positionCount,
            isPackage: isPackage
        });
        fills[context.fillId] = record;
        emit IAtomicClearingEngine.FillCleared(context.fillId, record, msg.sender);
        if (channelKind != ClearingChannelKind.Direct) {
            PositionId[] memory positions = fillPositions[context.fillId];
            channelAdapters[channelKind].finalizeTypedHandoff(
                channelClaim.consumptionId, FillId.unwrap(context.fillId), keccak256(abi.encode(positions))
            );
        }
    }
}
