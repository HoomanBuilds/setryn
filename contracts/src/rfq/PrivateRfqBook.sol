// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IFirmCapacityVault} from "../interfaces/IFirmCapacityVault.sol";
import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {IPrivateRfqBook} from "../interfaces/IPrivateRfqBook.sol";
import {IPrivateRfqValidationGate} from "../interfaces/IPrivateRfqValidationGate.sol";
import {RfqHashLib} from "../libraries/RfqHashLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {ClearingHandoffClaim, VerifiedClearingHandoff} from "../types/ClearingHandoffTypes.sol";
import {LockStatus} from "../types/Enums.sol";
import {AccountId, AssetId, CollateralId, CollateralLockId, RiskDomainId} from "../types/Identifiers.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    CapacityCancelAuthorization,
    ClearingHandoff,
    FirmCapacityRecord,
    FirmCapacityStatus,
    MakerQuote,
    MakerQuoteId,
    MakerQuoteRecord,
    MakerQuoteStatus,
    PrivateRfqRequest,
    RfqId,
    RfqRecord,
    RfqSelectionAuthorization,
    RfqStatus
} from "../types/RfqTypes.sol";
import {Lots} from "../types/Units.sol";
import {RouteId, SourceReservationStatus, SourceRouteReservation} from "../types/RoutingTypes.sol";

import {PrivateRfqQuoteLib} from "./PrivateRfqQuoteLib.sol";
import {PrivateRfqHandoffLib} from "./PrivateRfqHandoffLib.sol";
import {PrivateRfqLifecycleLib} from "./PrivateRfqLifecycleLib.sol";
import {PrivateRfqDependencies} from "./PrivateRfqTypes.sol";

import {IPrivateRfqBookLinkedErrors} from "./IPrivateRfqBookLinkedErrors.sol";

contract PrivateRfqBook is
    IPrivateRfqBookLinkedErrors,
    IPrivateRfqBook,
    IClearingChannelHandoffAdapter,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    bytes32 public constant CLEARING_ENGINE_ROLE = keccak256("SETRYN_RFQ_CLEARING_ENGINE_ROLE");
    bytes32 public constant ROUTE_RESERVER_ROLE = keccak256("SETRYN_RFQ_ROUTE_RESERVER_ROLE");
    bytes32 private constant CAPACITY_LOCK_REFERENCE_TYPEHASH = keccak256("SetrynFirmCapacityLockV1(bytes32 quoteId)");
    bytes32 private constant CAPACITY_COMMITMENT_TYPEHASH = keccak256(
        "SetrynFirmCapacityV1(bytes32 quoteId,address maker,bytes32 makerAccountId,bytes32 collateralId,bytes32 riskDomainId,uint32 riskDomainVersion,uint128 maximumLiability,uint64 expiry)"
    );
    bytes32 private constant TARGET_COMMITMENT_TYPEHASH = keccak256(
        "SetrynRfqTargetV1(uint8 targetKind,bytes32 seriesId,bytes32 packageId,uint32 targetVersion,bytes32 packageLegsHash)"
    );

    IFirmCapacityVault private immutable _collateralVault;
    IPrivateRfqValidationGate private immutable _validationGate;
    address private immutable _clearingEngine;
    uint64 public immutable maximumCapacityTail;

    mapping(RfqId rfqId => RfqRecord record) private _rfqs;
    mapping(MakerQuoteId quoteId => MakerQuoteRecord record) private _quotes;
    mapping(MakerQuoteId quoteId => FirmCapacityRecord record) private _capacities;
    mapping(address signer => mapping(uint256 nonce => bool used)) private _usedNonces;
    mapping(bytes32 executionReference => bool consumed) private _consumedHandoffs;
    mapping(bytes32 executionReference => RfqId rfqId) private _handoffRfqs;
    mapping(bytes32 reservationKey => SourceRouteReservation reservation) private _routeReservations;
    mapping(MakerQuoteId quoteId => bytes32 reservationKey) private _quoteReservationKeys;
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) private _domainReserved;
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount)))
        private _accountReserved;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IFirmCapacityVault collateralVault_,
        IPrivateRfqValidationGate validationGate_,
        address clearingEngine_,
        uint64 maximumCapacityTail_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(collateralVault_));
        _requireDependency(address(validationGate_));
        if (clearingEngine_ == address(0)) revert ZeroClearingEngine();
        if (maximumCapacityTail_ == 0) revert ZeroMaximumCapacityTail();
        _collateralVault = collateralVault_;
        _validationGate = validationGate_;
        _clearingEngine = clearingEngine_;
        maximumCapacityTail = maximumCapacityTail_;
        _grantRole(CLEARING_ENGINE_ROLE, clearingEngine_);
        _grantRole(ROUTE_RESERVER_ROLE, initialAdmin);
    }

    function collateralVault() external view returns (IFirmCapacityVault) {
        return _collateralVault;
    }

    function validationGate() external view returns (IPrivateRfqValidationGate) {
        return _validationGate;
    }

    function clearingEngine() external view returns (address) {
        return _clearingEngine;
    }

    function hashRequest(PrivateRfqRequest calldata request) public view returns (RfqId) {
        return RfqId.wrap(RfqHashLib.requestDigest(request, block.chainid, address(this)));
    }

    function hashQuote(MakerQuote calldata quote) public view returns (MakerQuoteId) {
        return MakerQuoteId.wrap(RfqHashLib.quoteDigest(quote, block.chainid, address(this)));
    }

    function registerRequest(
        PrivateRfqRequest calldata request,
        PackageLeg[] calldata packageLegs,
        bytes calldata signature
    ) external nonReentrant returns (RfqId rfqId) {
        return PrivateRfqQuoteLib.registerRequest(_dependencies(), _rfqs, _usedNonces, request, packageLegs, signature);
    }

    function openCollection(RfqId rfqId) external nonReentrant {
        PrivateRfqLifecycleLib.openCollection(_rfqs, rfqId);
    }

    function submitQuote(MakerQuote calldata quote, bytes32[] calldata eligibleMakerProof, bytes calldata signature)
        external
        nonReentrant
        returns (MakerQuoteId quoteId)
    {
        return PrivateRfqQuoteLib.submitQuote(
            _dependencies(), _rfqs, _quotes, _usedNonces, quote, eligibleMakerProof, signature
        );
    }

    function reserveQuoteCapacity(MakerQuoteId quoteId) external nonReentrant returns (bytes32 lockIdRaw) {
        return PrivateRfqQuoteLib.reserveQuoteCapacity(
            _dependencies(), _quotes, _capacities, _domainReserved, _accountReserved, quoteId
        );
    }

    function lockSelection(RfqSelectionAuthorization calldata selection, bytes calldata signature)
        external
        nonReentrant
    {
        PrivateRfqQuoteLib.lockSelection(_dependencies(), _rfqs, _quotes, _usedNonces, selection, signature);
    }

    function confirmSelectedCapacity(RfqId rfqId) external nonReentrant {
        PrivateRfqLifecycleLib.confirmSelectedCapacity(_dependencies(), _rfqs, _quotes, _capacities, rfqId);
    }

    function authorizeSubmission(RfqId rfqId) external nonReentrant {
        PrivateRfqLifecycleLib.authorizeSubmission(_rfqs, rfqId);
    }

    function submitSelectedRfq(RfqId rfqId, bytes32 submissionReference) external nonReentrant {
        PrivateRfqLifecycleLib.submitSelectedRfq(_rfqs, rfqId, submissionReference);
    }

    function consumeClearingHandoff(RfqId rfqId, Lots fillLots, uint128 liabilityAmount, bytes32 executionReference)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
        returns (ClearingHandoff memory handoff)
    {
        return PrivateRfqHandoffLib._consumeClearingHandoff(
            _dependencies(),
            _rfqs,
            _quotes,
            _capacities,
            _consumedHandoffs,
            _routeReservations,
            _quoteReservationKeys,
            _domainReserved,
            _accountReserved,
            rfqId,
            fillLots,
            liabilityAmount,
            executionReference
        );
    }

    function consumeTypedHandoff(ClearingHandoffClaim calldata claim)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
        returns (VerifiedClearingHandoff memory handoff)
    {
        return PrivateRfqHandoffLib.consumeTypedHandoff(
            _dependencies(),
            _rfqs,
            _quotes,
            _capacities,
            _consumedHandoffs,
            _handoffRfqs,
            _routeReservations,
            _quoteReservationKeys,
            _domainReserved,
            _accountReserved,
            claim
        );
    }

    function finalizeTypedHandoff(bytes32 consumptionId, bytes32 fillId, bytes32 positionsHash)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
    {
        PrivateRfqHandoffLib.finalizeTypedHandoff(
            _dependencies(),
            _rfqs,
            _quotes,
            _capacities,
            _consumedHandoffs,
            _handoffRfqs,
            _domainReserved,
            _accountReserved,
            consumptionId,
            fillId,
            positionsHash
        );
    }

    function source() external view returns (address) {
        return address(this);
    }

    function handoffConsumed(bytes32 consumptionId) external view returns (bool) {
        return _consumedHandoffs[consumptionId];
    }

    function settleRfq(RfqId rfqId, bytes32 settlementReference) external onlyRole(CLEARING_ENGINE_ROLE) nonReentrant {
        PrivateRfqLifecycleLib.settleRfq(_dependencies(), _rfqs, _quotes, _capacities, rfqId, settlementReference);
    }

    function rejectRfq(RfqId rfqId, bytes32 reason) external onlyRole(CLEARING_ENGINE_ROLE) nonReentrant {
        PrivateRfqLifecycleLib.rejectRfq(_rfqs, _routeReservations, _quoteReservationKeys, rfqId, reason);
    }

    function cancelRfq(RfqId rfqId) external nonReentrant {
        PrivateRfqLifecycleLib.cancelRfq(_rfqs, rfqId);
    }

    function expireRfq(RfqId rfqId) external nonReentrant {
        PrivateRfqLifecycleLib.expireRfq(_rfqs, rfqId);
    }

    function cancelQuoteCapacity(CapacityCancelAuthorization calldata cancellation, bytes calldata signature)
        external
        nonReentrant
    {
        PrivateRfqLifecycleLib.cancelQuoteCapacity(
            _dependencies(),
            _quotes,
            _capacities,
            _usedNonces,
            _domainReserved,
            _accountReserved,
            cancellation,
            signature
        );
    }

    function expireQuoteCapacity(MakerQuoteId quoteId) external nonReentrant {
        PrivateRfqLifecycleLib.expireQuoteCapacity(
            _dependencies(),
            _rfqs,
            _quotes,
            _capacities,
            _routeReservations,
            _quoteReservationKeys,
            _domainReserved,
            _accountReserved,
            quoteId
        );
    }

    function reserveForRoute(
        RouteId routeId,
        MakerQuoteId quoteId,
        Lots quantity,
        uint64 expiry,
        bytes32 reservationKey,
        address clearingConsumer
    ) external onlyRole(ROUTE_RESERVER_ROLE) nonReentrant {
        PrivateRfqHandoffLib.reserveForRoute(
            _dependencies(),
            _rfqs,
            _quotes,
            _capacities,
            _routeReservations,
            _quoteReservationKeys,
            routeId,
            quoteId,
            quantity,
            expiry,
            reservationKey,
            clearingConsumer
        );
    }

    function releaseRouteReservation(bytes32 reservationKey, bytes32 releaseReference)
        external
        onlyRole(ROUTE_RESERVER_ROLE)
        nonReentrant
    {
        if (releaseReference == bytes32(0)) revert InvalidRouteReservation();
        _closeRouteReservation(reservationKey, SourceReservationStatus.Released, releaseReference);
    }

    function expireRouteReservation(bytes32 reservationKey) external nonReentrant {
        SourceRouteReservation storage reservation = _routeReservations[reservationKey];
        if (reservation.status != SourceReservationStatus.Active || block.timestamp <= reservation.expiry) {
            revert InvalidRouteReservation();
        }
        _closeRouteReservation(
            reservationKey, SourceReservationStatus.Expired, keccak256(abi.encode("RFQ_ROUTE_EXPIRED", reservationKey))
        );
    }

    function getRouteReservation(bytes32 reservationKey)
        external
        view
        returns (SourceRouteReservation memory reservation)
    {
        reservation = _routeReservations[reservationKey];
        if (reservation.status == SourceReservationStatus.Unspecified) revert InvalidRouteReservation();
    }

    function getRfq(RfqId rfqId) external view returns (RfqRecord memory) {
        return _requireRfq(rfqId);
    }

    function getQuote(MakerQuoteId quoteId) external view returns (MakerQuoteRecord memory) {
        return _requireQuote(quoteId);
    }

    function getCapacity(MakerQuoteId quoteId) external view returns (FirmCapacityRecord memory) {
        FirmCapacityRecord storage capacity = _capacities[quoteId];
        if (capacity.status == FirmCapacityStatus.Unspecified) revert CapacityNotActive(quoteId, capacity.status);
        return capacity;
    }

    function selectedHandoffCommitment(RfqId rfqId) external view returns (bytes32 commitment) {
        return PrivateRfqLifecycleLib.selectedHandoffCommitment(_rfqs, _quotes, rfqId);
    }

    function domainReserved(RiskDomainId riskDomainId, uint32 version) external view returns (uint256) {
        return _domainReserved[riskDomainId][version];
    }

    function accountReserved(RiskDomainId riskDomainId, uint32 version, AccountId accountId)
        external
        view
        returns (uint256)
    {
        return _accountReserved[riskDomainId][version][accountId];
    }

    function isNonceUsed(address signer, uint256 nonce) external view returns (bool) {
        return _usedNonces[signer][nonce];
    }

    function _decreaseCapacityCounters(FirmCapacityRecord storage capacity, uint128 amount) private {
        _domainReserved[capacity.riskDomainId][capacity.riskDomainVersion] -= amount;
        _accountReserved[capacity.riskDomainId][capacity.riskDomainVersion][capacity.makerAccountId] -= amount;
    }

    function _closeRouteReservation(bytes32 reservationKey, SourceReservationStatus status, bytes32 closeReference)
        private
    {
        SourceRouteReservation storage reservation = _routeReservations[reservationKey];
        if (reservation.status != SourceReservationStatus.Active || closeReference == bytes32(0)) {
            revert InvalidRouteReservation();
        }
        MakerQuoteId quoteId = MakerQuoteId.wrap(reservation.sourceId);
        _quoteReservationKeys[quoteId] = bytes32(0);
        reservation.status = status;
        emit RfqRouteReservationClosed(quoteId, reservation.routeId, reservationKey, uint8(status), closeReference);
    }

    function _requireLockMatches(
        MakerQuoteId quoteId,
        MakerQuote storage quote,
        CollateralLockId lockId,
        CollateralId collateralId,
        bytes32 lockReference,
        uint128 expectedRemaining
    ) private view {
        CollateralLock memory lock = _collateralVault.getLock(lockId);
        if (
            lock.status != LockStatus.Active || lock.lockReference != lockReference
                || lock.operator != address(IAtomicClearingEngine(_clearingEngine).positionEngine())
                || lock.settlementOperator != address(IAtomicClearingEngine(_clearingEngine).positionEngine())
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(quote.makerAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(collateralId)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(quote.collateralAssetId)
                || lock.bindingVersion != quote.collateralBindingVersion || lock.expiry != quote.capacityExpiry
                || lock.initialAmount != quote.maximumLiability || lock.remainingAmount != expectedRemaining
        ) revert CapacityLockMismatch(quoteId);
    }

    function _requireCapacityLockLive(
        MakerQuoteId quoteId,
        FirmCapacityRecord storage capacity,
        MakerQuote storage quote
    ) private view {
        if (block.timestamp >= capacity.expiry) {
            revert QuoteExpired(quoteId, capacity.expiry);
        }
        bytes32 lockReference = keccak256(abi.encode(CAPACITY_LOCK_REFERENCE_TYPEHASH, MakerQuoteId.unwrap(quoteId)));
        _requireLockMatches(
            quoteId, quote, capacity.lockId, capacity.collateralId, lockReference, capacity.remainingLiability
        );
    }

    function _requireCapacityLockSynchronized(MakerQuoteId quoteId, MakerQuote storage quote) private view {
        FirmCapacityRecord storage capacity = _capacities[quoteId];
        if (capacity.status == FirmCapacityStatus.Active) {
            _requireCapacityLockLive(quoteId, capacity, quote);
            return;
        }
        if (capacity.status != FirmCapacityStatus.Consumed) revert CapacityNotActive(quoteId, capacity.status);
        CollateralLock memory lock = _collateralVault.getLock(capacity.lockId);
        if (lock.status != LockStatus.Consumed || lock.remainingAmount != 0 || capacity.remainingLiability != 0) {
            revert CapacityLockMismatch(quoteId);
        }
    }

    function _requireRfq(RfqId rfqId) private view returns (RfqRecord storage record) {
        record = _rfqs[rfqId];
        if (record.status == RfqStatus.Unspecified) revert UnknownRfq(rfqId);
    }

    function _requireQuote(MakerQuoteId quoteId) private view returns (MakerQuoteRecord storage record) {
        record = _quotes[quoteId];
        if (record.status == MakerQuoteStatus.Unspecified) revert UnknownQuote(quoteId);
    }

    function _requireActiveCapacity(MakerQuoteId quoteId) private view returns (FirmCapacityRecord storage capacity) {
        capacity = _capacities[quoteId];
        if (capacity.status != FirmCapacityStatus.Active) revert CapacityNotActive(quoteId, capacity.status);
    }

    function _requireTaker(RfqRecord storage record, RfqId rfqId) private view {
        if (msg.sender != record.request.taker) revert UnauthorizedRfqActor(rfqId, record.request.taker, msg.sender);
    }

    function _requireExecutor(RfqRecord storage record, RfqId rfqId) private view {
        address expected = _effectiveExecutor(record.request);
        if (msg.sender != expected) revert UnauthorizedRfqActor(rfqId, expected, msg.sender);
    }

    function _requireTakerOrExecutor(RfqRecord storage record, RfqId rfqId) private view {
        address expected = _effectiveExecutor(record.request);
        if (msg.sender != record.request.taker && msg.sender != expected) {
            revert UnauthorizedRfqActor(rfqId, expected, msg.sender);
        }
    }

    function _effectiveExecutor(PrivateRfqRequest storage request) private view returns (address) {
        return request.permittedExecutor == address(0) ? request.taker : request.permittedExecutor;
    }

    function _requireRfqLive(RfqId rfqId, uint64 deadline) private view {
        if (block.timestamp > deadline) revert RfqExpired(rfqId, deadline);
    }

    function _requireQuoteLive(MakerQuoteId quoteId, uint64 deadline) private view {
        if (block.timestamp > deadline) revert QuoteExpired(quoteId, deadline);
    }

    function _setRfqStatus(RfqId rfqId, RfqRecord storage record, RfqStatus newStatus) private {
        RfqStatus previousStatus = record.status;
        record.status = newStatus;
        emit RfqStatusChanged(rfqId, previousStatus, newStatus, msg.sender);
    }

    function _setQuoteStatus(MakerQuoteId quoteId, MakerQuoteRecord storage record, MakerQuoteStatus newStatus)
        private
    {
        MakerQuoteStatus previousStatus = record.status;
        record.status = newStatus;
        emit MakerQuoteStatusChanged(quoteId, previousStatus, newStatus, msg.sender);
    }

    function _requireSignature(address signer, bytes32 digest, bytes calldata signature) private view {
        if (!SignatureChecker.isValidSignatureNowCalldata(signer, digest, signature)) {
            revert InvalidSignature(signer, digest);
        }
    }

    function _requireUnusedNonce(address signer, uint256 nonce) private view {
        if (_usedNonces[signer][nonce]) revert NonceAlreadyUsed(signer, nonce);
    }

    function _useNonce(address signer, uint256 nonce) private {
        _requireUnusedNonce(signer, nonce);
        _usedNonces[signer][nonce] = true;
    }

    function _isTerminal(RfqStatus status) private pure returns (bool) {
        return status == RfqStatus.Cancelled || status == RfqStatus.Expired || status == RfqStatus.Rejected;
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency();
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (PrivateRfqDependencies memory) {
        return PrivateRfqDependencies({
            collateralVault: _collateralVault,
            validationGate: _validationGate,
            clearingEngine: _clearingEngine,
            maximumCapacityTail: maximumCapacityTail
        });
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
