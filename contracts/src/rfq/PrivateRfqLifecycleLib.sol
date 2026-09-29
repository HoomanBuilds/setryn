// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IPrivateRfqBook} from "../interfaces/IPrivateRfqBook.sol";
import {RfqHashLib} from "../libraries/RfqHashLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId, RiskDomainId} from "../types/Identifiers.sol";
import {
    CapacityCancelAuthorization,
    FirmCapacityRecord,
    FirmCapacityStatus,
    MakerQuote,
    MakerQuoteId,
    MakerQuoteRecord,
    MakerQuoteStatus,
    PrivateRfqRequest,
    RfqId,
    RfqRecord,
    RfqStatus
} from "../types/RfqTypes.sol";
import {SourceReservationStatus, SourceRouteReservation} from "../types/RoutingTypes.sol";

import {PrivateRfqDependencies} from "./PrivateRfqTypes.sol";

/// Linked logic for the private RFQ book: collection, submission authorization, capacity confirmation,
/// cancellation, expiry, settlement, and rejection. Runs through DELEGATECALL in the book's context against its storage.
library PrivateRfqLifecycleLib {
    bytes32 internal constant CAPACITY_LOCK_REFERENCE_TYPEHASH = keccak256("SetrynFirmCapacityLockV1(bytes32 quoteId)");

    function cancelQuoteCapacity(
        PrivateRfqDependencies memory deps,
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        mapping(
            MakerQuoteId quoteId => FirmCapacityRecord record
        ) storage $capacities,
        mapping(address signer => mapping(uint256 nonce => bool used)) storage $usedNonces,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)
        ) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        CapacityCancelAuthorization calldata cancellation,
        bytes calldata signature
    ) external {
        MakerQuoteRecord storage quote = _requireQuote($quotes, cancellation.quoteId);
        if (quote.status == MakerQuoteStatus.Selected) {
            revert IPrivateRfqBook.InvalidQuoteState(cancellation.quoteId, quote.status);
        }
        if (
            cancellation.maker != quote.quote.maker || cancellation.deadline < block.timestamp
                || cancellation.salt == bytes32(0)
        ) revert IPrivateRfqBook.SelectionMismatch();
        _requireUnusedNonce($usedNonces, cancellation.maker, cancellation.nonce);
        bytes32 digest = RfqHashLib.capacityCancelDigest(cancellation, block.chainid, address(this));
        _requireSignature(cancellation.maker, digest, signature);
        _useNonce($usedNonces, cancellation.maker, cancellation.nonce);
        _releaseCapacity(
            deps, $capacities, $domainReserved, $accountReserved, cancellation.quoteId, FirmCapacityStatus.Released
        );
        if (quote.status != MakerQuoteStatus.Consumed) {
            _setQuoteStatus(cancellation.quoteId, quote, MakerQuoteStatus.Cancelled);
        }
    }

    function expireQuoteCapacity(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(MakerQuoteId quoteId => bytes32 reservationKey) storage $quoteReservationKeys,
        mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        MakerQuoteId quoteId
    ) external {
        MakerQuoteRecord storage quote = _requireQuote($quotes, quoteId);
        FirmCapacityRecord storage capacity = $capacities[quoteId];
        if (capacity.status == FirmCapacityStatus.Unspecified) {
            if (block.timestamp <= quote.quote.deadline) {
                revert IPrivateRfqBook.QuoteStillLive(quoteId, quote.quote.deadline);
            }
        } else {
            if (block.timestamp < capacity.expiry) revert IPrivateRfqBook.CapacityNotExpired(quoteId, capacity.expiry);
            bytes32 reservationKey = $quoteReservationKeys[quoteId];
            if (reservationKey != bytes32(0)) {
                _closeRouteReservation(
                    $routeReservations,
                    $quoteReservationKeys,
                    reservationKey,
                    SourceReservationStatus.Expired,
                    keccak256(abi.encode("RFQ_CAPACITY_EXPIRED", MakerQuoteId.unwrap(quoteId)))
                );
            }
            _releaseCapacity(deps, $capacities, $domainReserved, $accountReserved, quoteId, FirmCapacityStatus.Expired);
        }
        if (quote.status != MakerQuoteStatus.Consumed) {
            _setQuoteStatus(quoteId, quote, MakerQuoteStatus.Expired);
        }
        RfqRecord storage rfq = $rfqs[quote.quote.rfqId];
        if (
            MakerQuoteId.unwrap(rfq.selectedQuoteId) == MakerQuoteId.unwrap(quoteId) && !_isTerminal(rfq.status)
                && rfq.status != RfqStatus.Settled
        ) _setRfqStatus(quote.quote.rfqId, rfq, RfqStatus.Expired);
    }

    function confirmSelectedCapacity(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        RfqId rfqId
    ) external {
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        if (rfq.status != RfqStatus.SelectionLocked) revert IPrivateRfqBook.InvalidRfqState(rfqId, rfq.status);
        MakerQuoteId quoteId = rfq.selectedQuoteId;
        MakerQuoteRecord storage quote = _requireQuote($quotes, quoteId);
        FirmCapacityRecord storage capacity = _requireActiveCapacity($capacities, quoteId);
        _requireCapacityLockLive(deps, quoteId, capacity, quote.quote);
        _setRfqStatus(rfqId, rfq, RfqStatus.CapacityReserved);
    }

    function settleRfq(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(
            MakerQuoteId quoteId => MakerQuoteRecord record
        ) storage $quotes,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        RfqId rfqId,
        bytes32 settlementReference
    ) external {
        if (settlementReference == bytes32(0)) revert IPrivateRfqBook.ZeroReference();
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        if (rfq.status != RfqStatus.Clearing) revert IPrivateRfqBook.InvalidRfqState(rfqId, rfq.status);
        MakerQuoteRecord storage quote = _requireQuote($quotes, rfq.selectedQuoteId);
        if (quote.status != MakerQuoteStatus.Consumed) {
            revert IPrivateRfqBook.InvalidQuoteState(rfq.selectedQuoteId, quote.status);
        }
        _requireCapacityLockSynchronized(deps, $capacities, rfq.selectedQuoteId, quote.quote);
        _setRfqStatus(rfqId, rfq, RfqStatus.Settled);
        emit IPrivateRfqBook.RfqSettled(rfqId, rfq.selectedQuoteId, settlementReference);
    }

    function rejectRfq(
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(bytes32 reservationKey => SourceRouteReservation reservation) storage $routeReservations,
        mapping(MakerQuoteId quoteId => bytes32 reservationKey) storage $quoteReservationKeys,
        RfqId rfqId,
        bytes32 reason
    ) external {
        if (reason == bytes32(0)) revert IPrivateRfqBook.ZeroReference();
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        if (rfq.status == RfqStatus.Settled || _isTerminal(rfq.status)) {
            revert IPrivateRfqBook.InvalidRfqState(rfqId, rfq.status);
        }
        bytes32 reservationKey = $quoteReservationKeys[rfq.selectedQuoteId];
        if (reservationKey != bytes32(0)) {
            _closeRouteReservation(
                $routeReservations, $quoteReservationKeys, reservationKey, SourceReservationStatus.Released, reason
            );
        }
        _setRfqStatus(rfqId, rfq, RfqStatus.Rejected);
        emit IPrivateRfqBook.RfqRejected(rfqId, reason);
    }

    function _releaseCapacity(
        PrivateRfqDependencies memory deps,
        mapping(MakerQuoteId quoteId => FirmCapacityRecord record) storage $capacities,
        mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        MakerQuoteId quoteId,
        FirmCapacityStatus terminalStatus
    ) internal {
        FirmCapacityRecord storage capacity = $capacities[quoteId];
        if (capacity.status != FirmCapacityStatus.Active) {
            revert IPrivateRfqBook.CapacityNotActive(quoteId, capacity.status);
        }
        uint128 remaining = capacity.remainingLiability;
        if (remaining != 0) _decreaseCapacityCounters($domainReserved, $accountReserved, capacity, remaining);
        FirmCapacityStatus previousStatus = capacity.status;
        capacity.status = terminalStatus;
        capacity.remainingLiability = 0;
        if (terminalStatus == FirmCapacityStatus.Expired) {
            deps.collateralVault.releaseExpiredLock(capacity.lockId);
        } else {
            IAtomicClearingEngine(deps.clearingEngine).positionEngine().releasePositionFundingLock(capacity.lockId);
        }
        emit IPrivateRfqBook.FirmCapacityChanged(quoteId, previousStatus, terminalStatus, 0, msg.sender);
    }

    function openCollection(mapping(RfqId rfqId => RfqRecord record) storage $rfqs, RfqId rfqId) external {
        RfqRecord storage record = _requireRfq($rfqs, rfqId);
        if (record.status != RfqStatus.Inviting) revert IPrivateRfqBook.InvalidRfqState(rfqId, record.status);
        _requireTaker(record, rfqId);
        _requireRfqLive(rfqId, record.request.deadline);
        _setRfqStatus(rfqId, record, RfqStatus.Collecting);
    }

    function authorizeSubmission(mapping(RfqId rfqId => RfqRecord record) storage $rfqs, RfqId rfqId) external {
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        if (rfq.status != RfqStatus.CapacityReserved) revert IPrivateRfqBook.InvalidRfqState(rfqId, rfq.status);
        _requireTakerOrExecutor(rfq, rfqId);
        _requireRfqLive(rfqId, rfq.request.deadline);
        _setRfqStatus(rfqId, rfq, RfqStatus.Authorized);
    }

    function submitSelectedRfq(
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        RfqId rfqId,
        bytes32 submissionReference
    ) external {
        if (submissionReference == bytes32(0)) revert IPrivateRfqBook.ZeroReference();
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        if (rfq.status != RfqStatus.Authorized) revert IPrivateRfqBook.InvalidRfqState(rfqId, rfq.status);
        _requireTakerOrExecutor(rfq, rfqId);
        _requireRfqLive(rfqId, rfq.request.deadline);
        _setRfqStatus(rfqId, rfq, RfqStatus.Submitted);
        emit IPrivateRfqBook.RfqSubmitted(rfqId, rfq.selectedQuoteId, submissionReference);
    }

    function cancelRfq(mapping(RfqId rfqId => RfqRecord record) storage $rfqs, RfqId rfqId) external {
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        if (rfq.status != RfqStatus.Inviting && rfq.status != RfqStatus.Collecting) {
            revert IPrivateRfqBook.InvalidRfqState(rfqId, rfq.status);
        }
        _requireTaker(rfq, rfqId);
        _setRfqStatus(rfqId, rfq, RfqStatus.Cancelled);
    }

    function expireRfq(mapping(RfqId rfqId => RfqRecord record) storage $rfqs, RfqId rfqId) external {
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        if (_isTerminal(rfq.status) || rfq.status == RfqStatus.Settled) {
            revert IPrivateRfqBook.InvalidRfqState(rfqId, rfq.status);
        }
        if (block.timestamp <= rfq.request.deadline) revert IPrivateRfqBook.RfqStillLive(rfqId, rfq.request.deadline);
        _setRfqStatus(rfqId, rfq, RfqStatus.Expired);
    }

    function selectedHandoffCommitment(
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        RfqId rfqId
    ) external view returns (bytes32 commitment) {
        RfqRecord storage rfq = _requireRfq($rfqs, rfqId);
        MakerQuoteId quoteId = rfq.selectedQuoteId;
        if (MakerQuoteId.unwrap(quoteId) == bytes32(0)) revert IPrivateRfqBook.SelectionMismatch();
        MakerQuoteRecord storage quote = _requireQuote($quotes, quoteId);
        return keccak256(
            abi.encode(
                RfqId.unwrap(rfqId),
                MakerQuoteId.unwrap(quoteId),
                RfqHashLib.hashRequest(rfq.request),
                RfqHashLib.hashQuote(quote.quote)
            )
        );
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

    function _requireTaker(RfqRecord storage record, RfqId rfqId) internal view {
        if (msg.sender != record.request.taker) {
            revert IPrivateRfqBook.UnauthorizedRfqActor(rfqId, record.request.taker, msg.sender);
        }
    }

    function _requireTakerOrExecutor(RfqRecord storage record, RfqId rfqId) internal view {
        address expected = _effectiveExecutor(record.request);
        if (msg.sender != record.request.taker && msg.sender != expected) {
            revert IPrivateRfqBook.UnauthorizedRfqActor(rfqId, expected, msg.sender);
        }
    }

    function _effectiveExecutor(PrivateRfqRequest storage request) internal view returns (address) {
        return request.permittedExecutor == address(0) ? request.taker : request.permittedExecutor;
    }

    function _requireRfqLive(RfqId rfqId, uint64 deadline) internal view {
        if (block.timestamp > deadline) revert IPrivateRfqBook.RfqExpired(rfqId, deadline);
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

    function _requireSignature(address signer, bytes32 digest, bytes calldata signature) internal view {
        if (!SignatureChecker.isValidSignatureNowCalldata(signer, digest, signature)) {
            revert IPrivateRfqBook.InvalidSignature(signer, digest);
        }
    }

    function _requireUnusedNonce(
        mapping(address signer => mapping(uint256 nonce => bool used)) storage $usedNonces,
        address signer,
        uint256 nonce
    ) internal view {
        if ($usedNonces[signer][nonce]) revert IPrivateRfqBook.NonceAlreadyUsed(signer, nonce);
    }

    function _useNonce(
        mapping(address signer => mapping(uint256 nonce => bool used)) storage $usedNonces,
        address signer,
        uint256 nonce
    ) internal {
        _requireUnusedNonce($usedNonces, signer, nonce);
        $usedNonces[signer][nonce] = true;
    }

    function _isTerminal(RfqStatus status) internal pure returns (bool) {
        return status == RfqStatus.Cancelled || status == RfqStatus.Expired || status == RfqStatus.Rejected;
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
