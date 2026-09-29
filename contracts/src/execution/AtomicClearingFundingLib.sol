// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {ClearingLib} from "../libraries/ClearingLib.sol";
import {ClearingFeeLib} from "../libraries/ClearingFeeLib.sol";
import {FeeScheduleDefinitionLib} from "../libraries/FeeScheduleDefinitionLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {CapacityReservationDisposition, ClearingHandoffClaim} from "../types/ClearingHandoffTypes.sol";
import {BilateralMatch, ClearingChannelKind, ClearingEntryKind, ClearingFeeFunding} from "../types/ClearingTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {FeeActionRequest, FeeActionResult, FeeComputation} from "../types/FeeEngineTypes.sol";
import {FeeScheduleVersion} from "../types/FeeScheduleDefinition.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId, FeeActionId, FillId} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {OrderRecord, OrderStatus, OrderTargetKind} from "../types/OrderTypes.sol";
import {PackageVersion} from "../types/PackageDefinition.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots} from "../types/Units.sol";

import {
    CLEARING_CONSIDERATION_PURPOSE,
    CLEARING_TERMINAL_LIABILITY_PURPOSE,
    ClearingDependencies,
    FeeContext,
    MatchContext,
    SettlementContext
} from "./AtomicClearingTypes.sol";

/// Linked logic for the atomic clearing engine: collateral funding, fee consumption, and order funding locks.
/// Runs through DELEGATECALL in the engine's context, so `address(this)` and `msg.sender` are the engine's.
library AtomicClearingFundingLib {
    function applyFunding(
        ClearingDependencies memory deps,
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory channelClaim
    ) external {
        _applyLiabilityFunding(
            deps,
            context,
            matchData,
            settlement.assetId,
            settlement.bindingVersion,
            settlement.longLiabilityMinor,
            settlement.shortLiabilityMinor,
            channelKind,
            channelClaim
        );
        _applyConsiderationFunding(deps, context, matchData, settlement, context.fillId, channelKind);
    }

    function consumeFees(
        ClearingDependencies memory deps,
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        ClearingChannelKind channelKind
    ) external returns (FeeContext memory fees) {
        FeeScheduleVersion memory schedule = deps.fundedFeeEngine.feeScheduleRegistry()
            .getFeeSchedule(context.taker.order.feeScheduleId, context.taker.order.feeScheduleVersion);
        if (
            !deps.fundedFeeEngine.feeScheduleRegistry()
                    .isOpenForNewRisk(context.taker.order.feeScheduleId, context.taker.order.feeScheduleVersion)
                || schedule.version != context.taker.order.feeScheduleVersion
                || AssetId.unwrap(schedule.definition.settlementAssetId) != AssetId.unwrap(settlement.assetId)
                || schedule.definition.settlementAssetVersion != settlement.bindingVersion
        ) revert IAtomicClearingEngine.FeeScheduleMismatch();
        uint128 notionalMinor = _absoluteMinor(settlement.considerationMinor);
        fees.maker = _consumeFeeAction(
            deps,
            context,
            context.maker.order.accountId,
            context.maker.order.maxFeeMinor,
            matchData.makerFeeFunding,
            FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            notionalMinor,
            0,
            channelKind
        );
        fees.taker = _consumeFeeAction(
            deps,
            context,
            context.taker.order.accountId,
            context.taker.order.maxFeeMinor,
            matchData.takerFeeFunding,
            FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL,
            notionalMinor,
            1,
            channelKind
        );
    }

    function reserveOrderFunding(
        ClearingDependencies memory deps,
        bytes32 orderHash,
        uint128 cumulativeLots,
        bytes32 purpose,
        uint128 amount
    ) external returns (CollateralLockId lockId) {
        OrderRecord memory record = deps.orderState.getOrder(orderHash);
        if (msg.sender != record.order.signer) {
            revert IAtomicClearingEngine.UnauthorizedFundingCaller(orderHash, msg.sender);
        }
        if (record.status != OrderStatus.Open && record.status != OrderStatus.PartiallyFilled) {
            revert IAtomicClearingEngine.OrderTargetMismatch();
        }
        uint128 filled = Lots.unwrap(record.filledLots);
        uint128 total = Lots.unwrap(record.order.lots);
        if (cumulativeLots <= filled || cumulativeLots > total) {
            revert IAtomicClearingEngine.InvalidFundingCumulativeLots(filled, cumulativeLots, total);
        }
        _requireFundingPurpose(purpose);

        (AssetId assetId, uint32 bindingVersion) = _settlementBinding(deps, record);
        bytes32 fundingReference = ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
        address settlementOperator =
            purpose == CLEARING_TERMINAL_LIABILITY_PURPOSE ? address(deps.positionEngine) : address(this);
        lockId = deps.collateralVault
            .createLock(
                fundingReference,
                record.order.accountId,
                assetId,
                bindingVersion,
                amount,
                record.order.deadline,
                settlementOperator
            );
        emit IAtomicClearingEngine.OrderFundingReserved(
            orderHash, purpose, lockId, cumulativeLots, amount, record.order.deadline, msg.sender
        );
    }

    function releaseOrderFunding(
        ClearingDependencies memory deps,
        bytes32 orderHash,
        uint128 cumulativeLots,
        bytes32 purpose
    ) external {
        OrderRecord memory record = deps.orderState.getOrder(orderHash);
        if (msg.sender != record.order.signer) {
            revert IAtomicClearingEngine.UnauthorizedFundingCaller(orderHash, msg.sender);
        }
        _requireFundingPurpose(purpose);
        bytes32 fundingReference = ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
        CollateralLockId lockId = deps.collateralVault.deriveLockId(address(this), fundingReference);
        deps.collateralVault.releaseLock(lockId);
        emit IAtomicClearingEngine.OrderFundingReleased(orderHash, purpose, lockId, cumulativeLots, msg.sender);
    }

    function reserveOrderFeeFunding(
        ClearingDependencies memory deps,
        bytes32 orderHash,
        bytes32 parentActionId,
        FeeActionId actionId,
        uint32 actionOrdinal,
        uint128 notionalMinor
    ) external returns (bytes32 consumptionId, CollateralLockId lockId, uint128 chargeMinor) {
        OrderRecord memory record = deps.orderState.getOrder(orderHash);
        if (msg.sender != record.order.signer) {
            revert IAtomicClearingEngine.UnauthorizedFundingCaller(orderHash, msg.sender);
        }
        if (record.status != OrderStatus.Open && record.status != OrderStatus.PartiallyFilled) {
            revert IAtomicClearingEngine.OrderTargetMismatch();
        }
        if (
            FeeActionId.unwrap(actionId) != FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL)
                && FeeActionId.unwrap(actionId) != FeeActionId.unwrap(FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL)
        ) revert IAtomicClearingEngine.InvalidFeeFundingAction(actionId);

        FeeComputation memory computation = deps.fundedFeeEngine
            .previewFeeAction(record.order.feeScheduleId, record.order.feeScheduleVersion, actionId, notionalMinor, 0);
        if (computation.chargeMinor > record.order.maxFeeMinor) {
            revert IAtomicClearingEngine.FeeFundingAboveOrderMaximum(record.order.maxFeeMinor, computation.chargeMinor);
        }
        if (computation.rebateMinor != 0) {
            revert IAtomicClearingEngine.FeeRebateFundingUnsupported(computation.rebateMinor);
        }

        consumptionId = deps.fundedFeeEngine
            .deriveConsumptionId(
                parentActionId,
                record.order.feeScheduleId,
                record.order.feeScheduleVersion,
                actionId,
                record.order.accountId,
                record.order.accountId,
                actionOrdinal
            );
        chargeMinor = computation.chargeMinor;
        if (chargeMinor == 0) return (consumptionId, CollateralLockId.wrap(bytes32(0)), 0);

        (AssetId assetId, uint32 bindingVersion) = _settlementBinding(deps, record);
        bytes32 fundingReference =
            deps.fundedFeeEngine.deriveFundingReference(consumptionId, deps.fundedFeeEngine.CHARGE_FUNDING_PURPOSE());
        lockId = deps.collateralVault
            .createLock(
                fundingReference,
                record.order.accountId,
                assetId,
                bindingVersion,
                chargeMinor,
                record.order.deadline,
                address(deps.fundedFeeEngine)
            );
        emit IAtomicClearingEngine.OrderFeeFundingReserved(
            orderHash, consumptionId, actionId, lockId, chargeMinor, record.order.deadline, msg.sender
        );
    }

    function releaseOrderFeeFunding(ClearingDependencies memory deps, bytes32 orderHash, bytes32 consumptionId)
        external
    {
        OrderRecord memory record = deps.orderState.getOrder(orderHash);
        if (msg.sender != record.order.signer) {
            revert IAtomicClearingEngine.UnauthorizedFundingCaller(orderHash, msg.sender);
        }
        bytes32 fundingReference =
            deps.fundedFeeEngine.deriveFundingReference(consumptionId, deps.fundedFeeEngine.CHARGE_FUNDING_PURPOSE());
        CollateralLockId lockId = deps.collateralVault.deriveLockId(address(this), fundingReference);
        deps.collateralVault.releaseLock(lockId);
        emit IAtomicClearingEngine.OrderFeeFundingReleased(orderHash, consumptionId, lockId, msg.sender);
    }

    function _consumeFeeAction(
        ClearingDependencies memory deps,
        MatchContext memory context,
        AccountId payerAccountId,
        uint128 signedMaximum,
        ClearingFeeFunding calldata suppliedFunding,
        FeeActionId actionId,
        uint128 notionalMinor,
        uint32 ordinal,
        ClearingChannelKind channelKind
    ) internal returns (FeeActionResult memory result) {
        ClearingFeeFunding memory funding = suppliedFunding;
        if (
            funding.consumptionId == bytes32(0) && CollateralLockId.unwrap(funding.chargeLockId) == bytes32(0)
                && CollateralLockId.unwrap(funding.budgetLockId) == bytes32(0)
        ) {
            funding = _reserveDirectFeeFunding(deps, context, payerAccountId, actionId, notionalMinor, ordinal);
        }
        FeeActionRequest memory request = ClearingFeeLib.buildRequest(
            FillId.unwrap(context.fillId),
            context.taker.order.feeScheduleId,
            context.taker.order.feeScheduleVersion,
            actionId,
            payerAccountId,
            notionalMinor,
            signedMaximum,
            funding,
            ordinal
        );
        result = deps.fundedFeeEngine.consumeFeeAction(request);
        ClearingFeeLib.validateResult(
            result, funding, context.taker.order.feeScheduleId, context.taker.order.feeScheduleVersion, signedMaximum
        );
    }

    function _reserveDirectFeeFunding(
        ClearingDependencies memory deps,
        MatchContext memory context,
        AccountId payerAccountId,
        FeeActionId actionId,
        uint128 notionalMinor,
        uint32 ordinal
    ) internal returns (ClearingFeeFunding memory funding) {
        FeeComputation memory computation = deps.fundedFeeEngine
            .previewFeeAction(
                context.taker.order.feeScheduleId, context.taker.order.feeScheduleVersion, actionId, notionalMinor, 0
            );
        if (computation.rebateMinor != 0) {
            revert IAtomicClearingEngine.FeeRebateFundingUnsupported(computation.rebateMinor);
        }
        funding.consumptionId = deps.fundedFeeEngine
            .deriveConsumptionId(
                FillId.unwrap(context.fillId),
                context.taker.order.feeScheduleId,
                context.taker.order.feeScheduleVersion,
                actionId,
                payerAccountId,
                payerAccountId,
                ordinal
            );
        if (computation.chargeMinor == 0) return funding;

        (AssetId assetId, uint32 bindingVersion) = _settlementBinding(deps, context.taker);
        bytes32 fundingReference = deps.fundedFeeEngine
            .deriveFundingReference(funding.consumptionId, deps.fundedFeeEngine.CHARGE_FUNDING_PURPOSE());
        funding.chargeLockId = deps.collateralVault
            .createLock(
                fundingReference,
                payerAccountId,
                assetId,
                bindingVersion,
                computation.chargeMinor,
                context.taker.order.deadline,
                address(deps.fundedFeeEngine)
            );
    }

    function _applyLiabilityFunding(
        ClearingDependencies memory deps,
        MatchContext memory context,
        BilateralMatch calldata matchData,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 longAmount,
        uint128 shortAmount,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory channelClaim
    ) internal {
        bool takerLong = context.takerIsBuyer;
        _applyPartyLiabilityFunding(
            deps,
            matchData.takerOrderHash,
            context.takerCumulativeLots,
            context.taker.order.accountId,
            assetId,
            bindingVersion,
            takerLong ? longAmount : shortAmount,
            matchData.takerFunding.terminalLiabilityLockId,
            channelKind,
            channelClaim
        );
        _applyPartyLiabilityFunding(
            deps,
            matchData.makerOrderHash,
            context.makerCumulativeLots,
            context.maker.order.accountId,
            assetId,
            bindingVersion,
            takerLong ? shortAmount : longAmount,
            matchData.makerFunding.terminalLiabilityLockId,
            channelKind,
            channelClaim
        );
    }

    function _applyPartyLiabilityFunding(
        ClearingDependencies memory deps,
        bytes32 orderHash,
        Lots cumulativeLots,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        CollateralLockId directLockId,
        ClearingChannelKind channelKind,
        ClearingHandoffClaim memory channelClaim
    ) internal {
        uint128 adopted = channelKind == ClearingChannelKind.Direct
            ? 0
            : _adoptedAmountForAccount(channelClaim, accountId);
        if (adopted != 0) {
            if (adopted != amount) revert IAtomicClearingEngine.ClearingHandoffMismatch();
            _requireNoFundingLock(orderHash, CLEARING_TERMINAL_LIABILITY_PURPOSE, directLockId);
            return;
        }
        if (CollateralLockId.unwrap(directLockId) == bytes32(0) && amount != 0) {
            directLockId = _createDirectFundingLock(
                deps,
                orderHash,
                Lots.unwrap(cumulativeLots),
                accountId,
                assetId,
                bindingVersion,
                amount,
                CLEARING_TERMINAL_LIABILITY_PURPOSE,
                address(deps.positionEngine),
                deps.orderState.getOrder(orderHash).order.deadline
            );
        }
        _releaseLiabilityLock(deps, orderHash, cumulativeLots, accountId, assetId, bindingVersion, amount, directLockId);
    }

    function _applyConsiderationFunding(
        ClearingDependencies memory deps,
        MatchContext memory context,
        BilateralMatch calldata matchData,
        SettlementContext memory settlement,
        FillId fillId,
        ClearingChannelKind channelKind
    ) internal {
        int256 signedAmount = settlement.considerationMinor;
        uint256 magnitude = signedAmount < 0 ? uint256(-(signedAmount + 1)) + 1 : uint256(signedAmount);
        if (magnitude > type(uint128).max) revert IAtomicClearingEngine.ConsiderationOverflow(magnitude);
        bool buyerPays = signedAmount >= 0;
        bool takerPays = buyerPays == context.takerIsBuyer;
        CollateralLockId payerLock =
            takerPays ? matchData.takerFunding.considerationLockId : matchData.makerFunding.considerationLockId;
        CollateralLockId otherLock =
            takerPays ? matchData.makerFunding.considerationLockId : matchData.takerFunding.considerationLockId;
        bytes32 payerHash = takerPays ? matchData.takerOrderHash : matchData.makerOrderHash;
        bytes32 otherHash = takerPays ? matchData.makerOrderHash : matchData.takerOrderHash;
        Lots payerCumulative = takerPays ? context.takerCumulativeLots : context.makerCumulativeLots;
        AccountId payer = buyerPays ? context.buyerAccountId : context.sellerAccountId;
        AccountId receiver = buyerPays ? context.sellerAccountId : context.buyerAccountId;
        if (CollateralLockId.unwrap(payerLock) == bytes32(0) && magnitude != 0) {
            payerLock = _createDirectFundingLock(
                deps,
                payerHash,
                Lots.unwrap(payerCumulative),
                payer,
                settlement.assetId,
                settlement.bindingVersion,
                uint128(magnitude),
                CLEARING_CONSIDERATION_PURPOSE,
                address(this),
                takerPays ? context.taker.order.deadline : context.maker.order.deadline
            );
        }
        _requireNoFundingLock(otherHash, CLEARING_CONSIDERATION_PURPOSE, otherLock);
        _consumeFundingLock(
            deps,
            payerHash,
            payerCumulative,
            payer,
            settlement.assetId,
            settlement.bindingVersion,
            uint128(magnitude),
            payerLock,
            receiver,
            CLEARING_CONSIDERATION_PURPOSE,
            ClearingEntryKind.Consideration,
            fillId
        );
    }

    function _releaseLiabilityLock(
        ClearingDependencies memory deps,
        bytes32 orderHash,
        Lots cumulativeLots,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        CollateralLockId lockId
    ) internal {
        if (amount == 0) {
            _requireNoFundingLock(orderHash, CLEARING_TERMINAL_LIABILITY_PURPOSE, lockId);
            return;
        }
        bytes32 fundingReference = ClearingLib.deriveFundingReference(
            orderHash, Lots.unwrap(cumulativeLots), CLEARING_TERMINAL_LIABILITY_PURPOSE
        );
        _requireFundingLock(
            deps,
            orderHash,
            CLEARING_TERMINAL_LIABILITY_PURPOSE,
            fundingReference,
            lockId,
            accountId,
            assetId,
            bindingVersion,
            amount,
            address(deps.positionEngine)
        );
        deps.collateralVault.releaseLock(lockId);
    }

    function _createDirectFundingLock(
        ClearingDependencies memory deps,
        bytes32 orderHash,
        uint128 cumulativeLots,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        bytes32 purpose,
        address settlementOperator,
        uint64 expiry
    ) internal returns (CollateralLockId lockId) {
        bytes32 fundingReference = ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
        return deps.collateralVault
            .createLock(fundingReference, accountId, assetId, bindingVersion, amount, expiry, settlementOperator);
    }

    function _consumeFundingLock(
        ClearingDependencies memory deps,
        bytes32 orderHash,
        Lots cumulativeLots,
        AccountId payer,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        CollateralLockId lockId,
        AccountId receiver,
        bytes32 purpose,
        ClearingEntryKind kind,
        FillId fillId
    ) internal {
        if (amount == 0) {
            _requireNoFundingLock(orderHash, purpose, lockId);
            return;
        }
        bytes32 fundingReference = ClearingLib.deriveFundingReference(orderHash, Lots.unwrap(cumulativeLots), purpose);
        _requireFundingLock(
            deps, orderHash, purpose, fundingReference, lockId, payer, assetId, bindingVersion, amount, address(this)
        );
        deps.collateralVault.consumeLock(lockId, receiver, amount);
        emit IAtomicClearingEngine.FillLedgerEntry(fillId, kind, payer, receiver, amount, fundingReference);
    }

    function _requireFundingLock(
        ClearingDependencies memory deps,
        bytes32 orderHash,
        bytes32 purpose,
        bytes32 fundingReference,
        CollateralLockId lockId,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        address settlementOperator
    ) internal view {
        if (CollateralLockId.unwrap(lockId) == bytes32(0)) {
            revert IAtomicClearingEngine.FundingLockRequired(orderHash, purpose);
        }
        CollateralLockId expected = deps.collateralVault.deriveLockId(address(this), fundingReference);
        if (CollateralLockId.unwrap(expected) != CollateralLockId.unwrap(lockId)) {
            revert IAtomicClearingEngine.FundingLockMismatch(orderHash, purpose);
        }
        CollateralLock memory lock = deps.collateralVault.getLock(lockId);
        CollateralId expectedCollateral = deps.collateralVault.deriveCollateralId(assetId, bindingVersion);
        if (
            lock.status != LockStatus.Active || lock.operator != address(this)
                || lock.settlementOperator != settlementOperator || lock.lockReference != fundingReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(accountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(assetId) || lock.bindingVersion != bindingVersion
                || lock.remainingAmount != amount || block.timestamp >= lock.expiry
        ) revert IAtomicClearingEngine.FundingLockMismatch(orderHash, purpose);
    }

    function _requireNoFundingLock(bytes32 orderHash, bytes32 purpose, CollateralLockId lockId) internal pure {
        if (CollateralLockId.unwrap(lockId) != bytes32(0)) {
            revert IAtomicClearingEngine.FundingLockUnexpected(orderHash, purpose);
        }
    }

    function _settlementBinding(ClearingDependencies memory deps, OrderRecord memory record)
        internal
        view
        returns (AssetId assetId, uint32 bindingVersion)
    {
        if (record.order.targetKind == OrderTargetKind.Series) {
            SeriesVersion memory series =
                deps.seriesRegistry.getSeries(record.order.seriesId, record.order.targetVersion);
            MarketVersion memory market =
                deps.marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
            return (market.definition.settlementAssetId, market.definition.settlementAssetVersion);
        }
        if (record.order.targetKind == OrderTargetKind.Package) {
            PackageVersion memory packageRecord =
                deps.packageRegistry.getPackage(record.order.packageId, record.order.targetVersion);
            return (packageRecord.definition.settlementAssetId, packageRecord.definition.settlementAssetVersion);
        }
        revert IAtomicClearingEngine.OrderTargetMismatch();
    }

    function _absoluteMinor(int256 signedAmount) internal pure returns (uint128 amount) {
        uint256 magnitude = signedAmount < 0 ? uint256(-(signedAmount + 1)) + 1 : uint256(signedAmount);
        if (magnitude > type(uint128).max) revert IAtomicClearingEngine.ConsiderationOverflow(magnitude);
        return uint128(magnitude);
    }

    function _adoptedAmountForAccount(ClearingHandoffClaim memory claim, AccountId accountId)
        internal
        pure
        returns (uint128 total)
    {
        uint256 sum;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition memory disposition = claim.capacityDispositions[i];
            if (AccountId.unwrap(disposition.accountId) == AccountId.unwrap(accountId)) {
                sum += disposition.reservationAmount;
            }
        }
        if (sum > type(uint128).max) revert IAtomicClearingEngine.ClearingHandoffMismatch();
        return uint128(sum);
    }

    function _requireFundingPurpose(bytes32 purpose) internal pure {
        if (purpose != CLEARING_TERMINAL_LIABILITY_PURPOSE && purpose != CLEARING_CONSIDERATION_PURPOSE) {
            revert IAtomicClearingEngine.InvalidFundingPurpose(purpose);
        }
    }
}
