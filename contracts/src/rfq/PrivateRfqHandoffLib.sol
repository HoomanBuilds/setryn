// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {IPrivateRfqBook} from "../interfaces/IPrivateRfqBook.sol";
import {RfqHashLib} from "../libraries/RfqHashLib.sol";
import {PackageDefinitionLib} from "../libraries/PackageDefinitionLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {
    CapacityDispositionKind,
    CapacityReservationDisposition,
    ClearingHandoffClaim,
    ClearingHandoffKind,
    UnusedCapacityPolicy,
    VerifiedClearingHandoff
} from "../types/ClearingHandoffTypes.sol";
import {LockStatus, Side} from "../types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralId,
    CollateralLockId,
    FeeScheduleId,
    PackageId,
    RiskDomainId,
    SeriesId
} from "../types/Identifiers.sol";
import {OrderTargetKind, RemainderPolicy} from "../types/OrderTypes.sol";
import {RiskAdmissionId} from "../types/RiskTypes.sol";
import {
    ClearingHandoff,
    FirmCapacityRecord,
    FirmCapacityStatus,
    MakerQuote,
    MakerQuoteId,
    MakerQuoteRecord,
    MakerQuoteStatus,
    RfqId,
    RfqRecord,
    RfqSidePolicy,
    RfqStatus,
    RfqTargetKind
} from "../types/RfqTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {RouteId, SourceReservationStatus, SourceRouteReservation} from "../types/RoutingTypes.sol";

import {PrivateRfqDependencies} from "./PrivateRfqTypes.sol";

/// Linked logic for the private RFQ book: clearing handoffs, finalization, and route reservations.
/// Runs through DELEGATECALL in the book's context against its storage.
library PrivateRfqHandoffLib {
    bytes32 internal constant CAPACITY_LOCK_REFERENCE_TYPEHASH = keccak256("SetrynFirmCapacityLockV1(bytes32 quoteId)");

    function consumeTypedHandoff(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        mapping(bytes32 executionReference => bool consumed) storage $consumedHandoffs,
        mapping(bytes32 executionReference => RfqId rfqId) storage $handoffRfqs,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(MakerQuoteId quoteId => bytes32 reservationKey) storage $quoteReservationKeys,
        mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        ClearingHandoffClaim calldata claim
    ) external returns (VerifiedClearingHandoff memory handoff) {
        if (claim.kind != ClearingHandoffKind.PrivateRfq || claim.sourceVersion != 1) {
            revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        }
        RfqId rfqId = RfqId.wrap(claim.sourceId);
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        MakerQuoteId quoteId = rfq.selectedQuoteId;
        MakerQuoteRecord storage quote = _requireQuote($quotes, quoteId);
        bytes32 expectedCommitment = keccak256(
            abi.encode(
                RfqId.unwrap(rfqId),
                MakerQuoteId.unwrap(quoteId),
                RfqHashLib.hashRequest(rfq.request),
                RfqHashLib.hashQuote(quote.quote)
            )
        );
        uint64 deadline = rfq.request.deadline < quote.quote.deadline ? rfq.request.deadline : quote.quote.deadline;
        bool packageTarget = rfq.request.targetKind == RfqTargetKind.Package;
        PriceTicks expectedPrice = claim.takerSide == Side.Buy ? quote.quote.askPriceTicks : quote.quote.bidPriceTicks;
        if (
            claim.sourceCommitment != expectedCommitment || claim.selectedQuoteOrRouteId != MakerQuoteId.unwrap(quoteId)
                || RiskAdmissionId.unwrap(claim.longAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(claim.shortAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(claim.longAdmissionId) == RiskAdmissionId.unwrap(claim.shortAdmissionId)
                || claim.longAdmissionResultHash == bytes32(0) || claim.shortAdmissionResultHash == bytes32(0)
                || claim.takerOrderHash != rfq.request.takerOrderHash
                || claim.makerOrderHash != quote.quote.makerOrderHash
                || AccountId.unwrap(claim.takerAccountId) != AccountId.unwrap(rfq.request.takerAccountId)
                || AccountId.unwrap(claim.makerAccountId) != AccountId.unwrap(quote.quote.makerAccountId)
                || claim.targetVersion != rfq.request.targetVersion || claim.deadline != deadline
                || PriceTicks.unwrap(claim.executionPriceTicks) != PriceTicks.unwrap(expectedPrice)
                || FeeScheduleId.unwrap(claim.feeScheduleId) != FeeScheduleId.unwrap(rfq.request.feeScheduleId)
                || claim.feeScheduleVersion != rfq.request.feeScheduleVersion
                || claim.takerMaximumFeeMinor != rfq.request.maxFeeMinor
                || claim.makerMaximumFeeMinor != quote.quote.maxFeeMinor
                || RiskDomainId.unwrap(claim.riskDomainId) != RiskDomainId.unwrap(rfq.request.riskDomainId)
                || claim.riskDomainVersion != rfq.request.riskDomainVersion
                || claim.executionModeId != rfq.request.executionModeId
                || !_sideAllowed(rfq.request.sidePolicy, claim.takerSide)
        ) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        if (packageTarget) {
            if (
                claim.targetKind != OrderTargetKind.Package
                    || PackageId.unwrap(claim.packageId) != PackageId.unwrap(rfq.request.packageId)
                    || claim.packageWitnessHash != rfq.request.packageLegsHash
                    || PackageDefinitionLib.hashLegs(claim.packageLegs) != rfq.request.packageLegsHash
            ) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        } else if (
            claim.targetKind != OrderTargetKind.Series
                || SeriesId.unwrap(claim.seriesId) != SeriesId.unwrap(rfq.request.seriesId)
                || claim.packageLegs.length != 0 || claim.packageWitnessHash != bytes32(0)
        ) {
            revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        }

        FirmCapacityRecord storage capacity = _requireActiveCapacity($capacities, quoteId);
        uint128 expectedRemaining = capacity.remainingLiability;
        uint128 remainingLots = Lots.unwrap(quote.quote.lots) - Lots.unwrap(quote.cumulativeFilledLots);
        bool terminalFill = Lots.unwrap(claim.fillLots) == remainingLots
            || quote.quote.remainderPolicy == RemainderPolicy.CancelRemainder;
        uint256 liabilityAmount;
        for (uint256 i; i < claim.capacityDispositions.length; ++i) {
            CapacityReservationDisposition calldata disposition = claim.capacityDispositions[i];
            if (
                disposition.capacityDisposition != CapacityDispositionKind.ConvertedToTerminalLiability
                    || CollateralLockId.unwrap(disposition.funding.lockId) != CollateralLockId.unwrap(capacity.lockId)
                    || AccountId.unwrap(disposition.accountId) != AccountId.unwrap(capacity.makerAccountId)
                    || disposition.funding.expectedRemainingAmount != expectedRemaining
                    || disposition.funding.expectedExpiry != capacity.expiry
                    || disposition.unusedCapacityPolicy
                        != (terminalFill ? UnusedCapacityPolicy.ReleaseOnTerminalFill : UnusedCapacityPolicy.KeepLocked)
            ) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
            liabilityAmount += disposition.reservationAmount;
            if (liabilityAmount > type(uint128).max || disposition.reservationAmount > expectedRemaining) {
                revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
            }
            expectedRemaining -= disposition.reservationAmount;
        }
        if (liabilityAmount == 0) revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        _consumeClearingHandoff(
            deps,
            $rfqs,
            $quotes,
            $capacities,
            $consumedHandoffs,
            $routeReservations,
            $quoteReservationKeys,
            $domainReserved,
            $accountReserved,
            rfqId,
            claim.fillLots,
            uint128(liabilityAmount),
            claim.consumptionId
        );
        $handoffRfqs[claim.consumptionId] = rfqId;
        handoff = VerifiedClearingHandoff({
            claim: claim,
            provenanceHash: keccak256(abi.encode(block.chainid, address(this), expectedCommitment, claim.consumptionId))
        });
    }

    function finalizeTypedHandoff(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        mapping(bytes32 executionReference => bool consumed) storage $consumedHandoffs,
        mapping(bytes32 executionReference => RfqId rfqId) storage $handoffRfqs,
        mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        bytes32 consumptionId,
        bytes32 fillId,
        bytes32 positionsHash
    ) external {
        if (!$consumedHandoffs[consumptionId] || fillId == bytes32(0) || positionsHash == bytes32(0)) {
            revert IClearingChannelHandoffAdapter.HandoffClaimMismatch();
        }
        RfqId rfqId = $handoffRfqs[consumptionId];
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        MakerQuoteRecord storage quote = _requireQuote($quotes, rfq.selectedQuoteId);
        if (quote.status == MakerQuoteStatus.Consumed) {
            FirmCapacityRecord storage capacity = $capacities[rfq.selectedQuoteId];
            if (capacity.status == FirmCapacityStatus.Active) {
                uint128 remaining = capacity.remainingLiability;
                if (remaining != 0) _decreaseCapacityCounters($domainReserved, $accountReserved, capacity, remaining);
                capacity.remainingLiability = 0;
                capacity.status = FirmCapacityStatus.Released;
                IAtomicClearingEngine(deps.clearingEngine).positionEngine().releasePositionFundingLock(capacity.lockId);
                CollateralLock memory released = deps.collateralVault.getLock(capacity.lockId);
                if (released.status != LockStatus.Released || released.remainingAmount != 0) {
                    revert IPrivateRfqBook.CapacityLockMismatch(rfq.selectedQuoteId);
                }
                emit IPrivateRfqBook.FirmCapacityChanged(
                    rfq.selectedQuoteId, FirmCapacityStatus.Active, FirmCapacityStatus.Released, 0, msg.sender
                );
            } else {
                _requireCapacityLockSynchronized(deps, $capacities, rfq.selectedQuoteId, quote.quote);
            }
            _setRfqStatus(rfqId, rfq, RfqStatus.Settled);
            emit IPrivateRfqBook.RfqSettled(rfqId, rfq.selectedQuoteId, fillId);
        }
    }

    function reserveForRoute(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(
            MakerQuoteId quoteId => MakerQuoteRecord record
        ) storage $quotes,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(MakerQuoteId quoteId => bytes32 reservationKey) storage $quoteReservationKeys,
        RouteId routeId,
        MakerQuoteId quoteId,
        Lots quantity,
        uint64 expiry,
        bytes32 reservationKey,
        address clearingConsumer
    ) external {
        uint128 requested = Lots.unwrap(quantity);
        if (
            RouteId.unwrap(routeId) == bytes32(0) || reservationKey == bytes32(0)
                || clearingConsumer != deps.clearingEngine || requested == 0 || expiry <= block.timestamp
        ) revert IPrivateRfqBook.InvalidRouteReservation();
        if (
            $routeReservations[reservationKey].status != SourceReservationStatus.Unspecified
                || $quoteReservationKeys[quoteId] != bytes32(0)
        ) revert IPrivateRfqBook.RouteReservationAlreadyExists(quoteId, reservationKey);
        MakerQuoteRecord storage quote = _requireQuote($quotes, quoteId);
        RfqRecord storage rfq = _requireRfq($rfqs, quote.quote.rfqId);
        if (
            quote.status != MakerQuoteStatus.Selected
                || (rfq.status != RfqStatus.CapacityReserved
                    && rfq.status != RfqStatus.Authorized
                    && rfq.status != RfqStatus.Submitted
                    && rfq.status != RfqStatus.Clearing)
                || MakerQuoteId.unwrap(rfq.selectedQuoteId) != MakerQuoteId.unwrap(quoteId)
                || expiry > quote.quote.deadline || expiry > rfq.request.deadline
        ) revert IPrivateRfqBook.InvalidRouteReservation();
        uint128 remaining = Lots.unwrap(quote.quote.lots) - Lots.unwrap(quote.cumulativeFilledLots);
        uint128 minimum = Lots.unwrap(quote.quote.minimumFillLots);
        if (
            requested > remaining || (!quote.quote.allowPartialFills && requested != remaining)
                || (requested < minimum && requested != remaining)
        ) revert IPrivateRfqBook.InvalidFillLots(requested, remaining, minimum);
        _requireCapacityLockLive(deps, quoteId, _requireActiveCapacity($capacities, quoteId), quote.quote);
        $quoteReservationKeys[quoteId] = reservationKey;
        $routeReservations[reservationKey] = SourceRouteReservation({
            routeId: routeId,
            sourceId: MakerQuoteId.unwrap(quoteId),
            reservationKey: reservationKey,
            clearingConsumer: clearingConsumer,
            quantity: quantity,
            expiry: expiry,
            status: SourceReservationStatus.Active
        });
        emit IPrivateRfqBook.RfqRouteReserved(quoteId, routeId, reservationKey, quantity, expiry, clearingConsumer);
    }

    function _consumeClearingHandoff(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        mapping(bytes32 executionReference => bool consumed) storage $consumedHandoffs,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(MakerQuoteId quoteId => bytes32 reservationKey) storage $quoteReservationKeys,
        mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        RfqId rfqId,
        Lots fillLots,
        uint128 liabilityAmount,
        bytes32 executionReference
    ) public returns (ClearingHandoff memory handoff) {
        if (executionReference == bytes32(0)) revert IPrivateRfqBook.ZeroReference();
        if ($consumedHandoffs[executionReference]) {
            revert IClearingChannelHandoffAdapter.HandoffAlreadyConsumed(executionReference);
        }
        uint128 fill = Lots.unwrap(fillLots);
        if (fill == 0) revert IPrivateRfqBook.ZeroFillLots();

        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        if (rfq.status != RfqStatus.Submitted && rfq.status != RfqStatus.Clearing) {
            revert IPrivateRfqBook.InvalidRfqState(rfqId, rfq.status);
        }
        _requireRfqLive(rfqId, rfq.request.deadline);
        MakerQuoteId quoteId = rfq.selectedQuoteId;
        MakerQuoteRecord storage quote = _requireQuote($quotes, quoteId);
        if (quote.status != MakerQuoteStatus.Selected) revert IPrivateRfqBook.InvalidQuoteState(quoteId, quote.status);
        _requireQuoteLive(quoteId, quote.quote.deadline);
        FirmCapacityRecord storage capacity = _requireActiveCapacity($capacities, quoteId);
        _requireCapacityLockLive(deps, quoteId, capacity, quote.quote);

        uint128 alreadyFilled = Lots.unwrap(quote.cumulativeFilledLots);
        uint128 remainingLots = Lots.unwrap(quote.quote.lots) - alreadyFilled;
        uint128 minimum = Lots.unwrap(quote.quote.minimumFillLots);
        if (
            fill > remainingLots || (!quote.quote.allowPartialFills && fill != remainingLots)
                || (fill < minimum && fill != remainingLots)
        ) revert IPrivateRfqBook.InvalidFillLots(fill, remainingLots, minimum);
        if (liabilityAmount == 0 || liabilityAmount > capacity.remainingLiability) {
            revert IPrivateRfqBook.CapacityAmountExceeded(quoteId, capacity.remainingLiability, liabilityAmount);
        }
        bool terminalFill = fill == remainingLots || quote.quote.remainderPolicy == RemainderPolicy.CancelRemainder;
        if (liabilityAmount == capacity.remainingLiability && !terminalFill) {
            revert IPrivateRfqBook.CapacityExhaustedBeforeTerminalFill(quoteId);
        }
        bytes32 reservationKey = $quoteReservationKeys[quoteId];
        if (reservationKey != bytes32(0)) {
            SourceRouteReservation storage routeReservation = $routeReservations[reservationKey];
            if (
                routeReservation.status != SourceReservationStatus.Active
                    || routeReservation.clearingConsumer != msg.sender || block.timestamp > routeReservation.expiry
                    || Lots.unwrap(routeReservation.quantity) != fill
            ) revert IPrivateRfqBook.InvalidRouteReservation();
        }
        deps.validationGate.validateHandoff(rfq.request, quote.quote, msg.sender, fillLots, liabilityAmount);

        if (reservationKey != bytes32(0)) {
            _closeRouteReservation(
                $routeReservations,
                $quoteReservationKeys,
                reservationKey,
                SourceReservationStatus.Consumed,
                keccak256(abi.encode("RFQ_ROUTE_CONSUMED", executionReference))
            );
        }
        $consumedHandoffs[executionReference] = true;
        uint128 cumulative = alreadyFilled + fill;
        quote.cumulativeFilledLots = Lots.wrap(cumulative);
        rfq.cumulativeFilledLots = Lots.wrap(Lots.unwrap(rfq.cumulativeFilledLots) + fill);
        capacity.remainingLiability -= liabilityAmount;
        _decreaseCapacityCounters($domainReserved, $accountReserved, capacity, liabilityAmount);
        if (capacity.remainingLiability == 0) {
            FirmCapacityStatus previousCapacityStatus = capacity.status;
            capacity.status = FirmCapacityStatus.Consumed;
            emit IPrivateRfqBook.FirmCapacityChanged(
                quoteId, previousCapacityStatus, FirmCapacityStatus.Consumed, 0, msg.sender
            );
        }

        uint128 quoteRemainder = Lots.unwrap(quote.quote.lots) - cumulative;
        if (quoteRemainder == 0 || quote.quote.remainderPolicy == RemainderPolicy.CancelRemainder) {
            _setQuoteStatus(quoteId, quote, MakerQuoteStatus.Consumed);
        }
        if (rfq.status == RfqStatus.Submitted) _setRfqStatus(rfqId, rfq, RfqStatus.Clearing);

        handoff = ClearingHandoff({
            rfqId: rfqId,
            quoteId: quoteId,
            makerLockId: capacity.lockId,
            makerAccountId: quote.quote.makerAccountId,
            takerAccountId: quote.quote.takerAccountId,
            fillLots: fillLots,
            liabilityAmount: liabilityAmount,
            bidPriceTicks: quote.quote.bidPriceTicks,
            askPriceTicks: quote.quote.askPriceTicks,
            executionReference: executionReference
        });
        emit IPrivateRfqBook.ClearingHandoffConsumed(
            rfqId,
            quoteId,
            executionReference,
            CollateralLockId.unwrap(capacity.lockId),
            fillLots,
            liabilityAmount,
            capacity.remainingLiability
        );
    }

    function _sideAllowed(RfqSidePolicy policy, Side side) internal pure returns (bool) {
        if (side == Side.Buy) return policy == RfqSidePolicy.BuyOnly || policy == RfqSidePolicy.TwoWay;
        if (side == Side.Sell) return policy == RfqSidePolicy.SellOnly || policy == RfqSidePolicy.TwoWay;
        return false;
    }

    function _requireRfq(mapping(RfqId rfqId => RfqRecord record) storage $rfqs, RfqId rfqId)
        internal
        view
        returns (RfqRecord storage record)
    {
        record = $rfqs[rfqId];
        if (record.status == RfqStatus.Unspecified) revert IPrivateRfqBook.UnknownRfq(rfqId);
    }

    function _requireQuote(
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        MakerQuoteId quoteId
    ) internal view returns (MakerQuoteRecord storage record) {
        record = $quotes[quoteId];
        if (record.status == MakerQuoteStatus.Unspecified) revert IPrivateRfqBook.UnknownQuote(quoteId);
    }

    function _requireActiveCapacity(
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        MakerQuoteId quoteId
    ) internal view returns (FirmCapacityRecord storage capacity) {
        capacity = $capacities[quoteId];
        if (capacity.status != FirmCapacityStatus.Active) {
            revert IPrivateRfqBook.CapacityNotActive(quoteId, capacity.status);
        }
    }

    function _requireRfqLive(RfqId rfqId, uint64 deadline) internal view {
        if (block.timestamp > deadline) revert IPrivateRfqBook.RfqExpired(rfqId, deadline);
    }

    function _requireQuoteLive(MakerQuoteId quoteId, uint64 deadline) internal view {
        if (block.timestamp > deadline) revert IPrivateRfqBook.QuoteExpired(quoteId, deadline);
    }

    function _setRfqStatus(RfqId rfqId, RfqRecord storage record, RfqStatus newStatus) internal {
        RfqStatus previousStatus = record.status;
        record.status = newStatus;
        emit IPrivateRfqBook.RfqStatusChanged(rfqId, previousStatus, newStatus, msg.sender);
    }

    function _setQuoteStatus(MakerQuoteId quoteId, MakerQuoteRecord storage record, MakerQuoteStatus newStatus)
        internal
    {
        MakerQuoteStatus previousStatus = record.status;
        record.status = newStatus;
        emit IPrivateRfqBook.MakerQuoteStatusChanged(quoteId, previousStatus, newStatus, msg.sender);
    }

    function _decreaseCapacityCounters(
        mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        FirmCapacityRecord storage capacity,
        uint128 amount
    ) internal {
        $domainReserved[capacity.riskDomainId][capacity.riskDomainVersion] -= amount;
        $accountReserved[capacity.riskDomainId][capacity.riskDomainVersion][capacity.makerAccountId] -= amount;
    }

    function _closeRouteReservation(
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(MakerQuoteId quoteId => bytes32 reservationKey) storage $quoteReservationKeys,
        bytes32 reservationKey,
        SourceReservationStatus status,
        bytes32 closeReference
    ) internal {
        SourceRouteReservation storage reservation = $routeReservations[reservationKey];
        if (reservation.status != SourceReservationStatus.Active || closeReference == bytes32(0)) {
            revert IPrivateRfqBook.InvalidRouteReservation();
        }
        MakerQuoteId quoteId = MakerQuoteId.wrap(reservation.sourceId);
        $quoteReservationKeys[quoteId] = bytes32(0);
        reservation.status = status;
        emit IPrivateRfqBook.RfqRouteReservationClosed(
            quoteId, reservation.routeId, reservationKey, uint8(status), closeReference
        );
    }

    function _requireCapacityLockLive(
        PrivateRfqDependencies memory deps,
        MakerQuoteId quoteId,
        FirmCapacityRecord storage capacity,
        MakerQuote storage quote
    ) internal view {
        if (block.timestamp >= capacity.expiry) {
            revert IPrivateRfqBook.QuoteExpired(quoteId, capacity.expiry);
        }
        bytes32 lockReference = keccak256(abi.encode(CAPACITY_LOCK_REFERENCE_TYPEHASH, MakerQuoteId.unwrap(quoteId)));
        _requireLockMatches(
            deps, quoteId, quote, capacity.lockId, capacity.collateralId, lockReference, capacity.remainingLiability
        );
    }

    function _requireCapacityLockSynchronized(
        PrivateRfqDependencies memory deps,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        MakerQuoteId quoteId,
        MakerQuote storage quote
    ) internal view {
        FirmCapacityRecord storage capacity = $capacities[quoteId];
        if (capacity.status == FirmCapacityStatus.Active) {
            _requireCapacityLockLive(deps, quoteId, capacity, quote);
            return;
        }
        if (capacity.status != FirmCapacityStatus.Consumed) {
            revert IPrivateRfqBook.CapacityNotActive(quoteId, capacity.status);
        }
        CollateralLock memory lock = deps.collateralVault.getLock(capacity.lockId);
        if (lock.status != LockStatus.Consumed || lock.remainingAmount != 0 || capacity.remainingLiability != 0) {
            revert IPrivateRfqBook.CapacityLockMismatch(quoteId);
        }
    }

    function _requireLockMatches(
        PrivateRfqDependencies memory deps,
        MakerQuoteId quoteId,
        MakerQuote storage quote,
        CollateralLockId lockId,
        CollateralId collateralId,
        bytes32 lockReference,
        uint128 expectedRemaining
    ) internal view {
        CollateralLock memory lock = deps.collateralVault.getLock(lockId);
        if (
            lock.status != LockStatus.Active || lock.lockReference != lockReference
                || lock.operator != address(IAtomicClearingEngine(deps.clearingEngine).positionEngine())
                || lock.settlementOperator != address(IAtomicClearingEngine(deps.clearingEngine).positionEngine())
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(quote.makerAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(collateralId)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(quote.collateralAssetId)
                || lock.bindingVersion != quote.collateralBindingVersion || lock.expiry != quote.capacityExpiry
                || lock.initialAmount != quote.maximumLiability || lock.remainingAmount != expectedRemaining
        ) revert IPrivateRfqBook.CapacityLockMismatch(quoteId);
    }
}
