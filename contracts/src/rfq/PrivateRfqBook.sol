// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IFirmCapacityRiskRegistry, IFirmCapacityVault} from "../interfaces/IFirmCapacityVault.sol";
import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPrivateRfqBook} from "../interfaces/IPrivateRfqBook.sol";
import {IPrivateRfqValidationGate} from "../interfaces/IPrivateRfqValidationGate.sol";
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
import {PackageLeg} from "../types/PackageDefinition.sol";
import {OrderTargetKind, RemainderPolicy} from "../types/OrderTypes.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {RiskAdmissionId} from "../types/RiskTypes.sol";
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
import {Lots, PriceTicks} from "../types/Units.sol";
import {RouteId, SourceReservationStatus, SourceRouteReservation} from "../types/RoutingTypes.sol";

contract PrivateRfqBook is
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
        RfqHashLib.validateRequest(request, packageLegs, block.timestamp);
        rfqId = hashRequest(request);
        if (_rfqs[rfqId].status != RfqStatus.Unspecified) revert DuplicateRfq(rfqId);
        _requireUnusedNonce(request.taker, request.nonce);
        bytes32 digest = RfqId.unwrap(rfqId);
        _requireSignature(request.taker, digest, signature);
        _validationGate.validateRequest(request, packageLegs);

        _useNonce(request.taker, request.nonce);
        uint64 registeredAt = uint64(block.timestamp);
        _rfqs[rfqId] = RfqRecord({
            request: request,
            selectedQuoteId: MakerQuoteId.wrap(bytes32(0)),
            status: RfqStatus.Inviting,
            cumulativeFilledLots: Lots.wrap(0),
            registeredAt: registeredAt
        });
        emit PrivateRfqCommitted(
            rfqId,
            digest,
            _targetCommitment(request),
            request.packageLegsHash,
            request.privacyModeId,
            request.executionModeId,
            request.deadline
        );
    }

    function openCollection(RfqId rfqId) external nonReentrant {
        RfqRecord storage record = _requireRfq(rfqId);
        if (record.status != RfqStatus.Inviting) revert InvalidRfqState(rfqId, record.status);
        _requireTaker(record, rfqId);
        _requireRfqLive(rfqId, record.request.deadline);
        _setRfqStatus(rfqId, record, RfqStatus.Collecting);
    }

    function submitQuote(MakerQuote calldata quote, bytes32[] calldata eligibleMakerProof, bytes calldata signature)
        external
        nonReentrant
        returns (MakerQuoteId quoteId)
    {
        RfqHashLib.validateQuote(quote, block.timestamp);
        RfqRecord storage rfq = _requireRfq(quote.rfqId);
        if (rfq.status != RfqStatus.Collecting) revert InvalidRfqState(quote.rfqId, rfq.status);
        _requireRfqLive(quote.rfqId, rfq.request.deadline);
        _validateQuoteAgainstRequest(rfq.request, quote);

        quoteId = hashQuote(quote);
        if (_quotes[quoteId].status != MakerQuoteStatus.Unspecified) revert DuplicateQuote(quoteId);
        _requireUnusedNonce(quote.maker, quote.nonce);
        bytes32 digest = MakerQuoteId.unwrap(quoteId);
        _requireSignature(quote.maker, digest, signature);
        _validationGate.validateQuote(rfq.request, quote, eligibleMakerProof);

        _useNonce(quote.maker, quote.nonce);
        _quotes[quoteId] = MakerQuoteRecord({
            quote: quote,
            status: MakerQuoteStatus.Offered,
            cumulativeFilledLots: Lots.wrap(0),
            offeredAt: uint64(block.timestamp)
        });
        emit MakerQuoteCommitted(quoteId, quote.rfqId, digest, quote.deadline, quote.capacityExpiry);
    }

    function reserveQuoteCapacity(MakerQuoteId quoteId) external nonReentrant returns (bytes32 lockIdRaw) {
        MakerQuoteRecord storage quoteRecord = _requireQuote(quoteId);
        if (quoteRecord.status != MakerQuoteStatus.Offered) revert InvalidQuoteState(quoteId, quoteRecord.status);
        MakerQuote storage quote = quoteRecord.quote;
        _requireQuoteLive(quoteId, quote.deadline);
        if (quote.capacityExpiry - quote.deadline > maximumCapacityTail) {
            revert InvalidCapacityTail(quote.deadline, quote.capacityExpiry, maximumCapacityTail);
        }
        if (_capacities[quoteId].status != FirmCapacityStatus.Unspecified) revert CapacityAlreadyExists(quoteId);

        IFirmCapacityRiskRegistry risks = _collateralVault.riskDomainRegistry();
        if (!risks.isOpenForNewRisk(quote.riskDomainId, quote.riskDomainVersion)) revert RiskDomainClosed();
        RiskDomainVersion memory risk = risks.getRiskDomain(quote.riskDomainId, quote.riskDomainVersion);
        if (
            AssetId.unwrap(risk.definition.collateralAssetId) != AssetId.unwrap(quote.collateralAssetId)
                || risk.definition.collateralAssetVersion != quote.collateralBindingVersion
        ) revert RiskDomainCollateralMismatch();
        _increaseCapacityCounters(quote, risk);

        bytes32 lockReference = keccak256(abi.encode(CAPACITY_LOCK_REFERENCE_TYPEHASH, MakerQuoteId.unwrap(quoteId)));
        IPositionEngine positionEngine = IAtomicClearingEngine(_clearingEngine).positionEngine();
        CollateralLockId lockId = positionEngine.createPositionFundingLock(
            lockReference,
            quote.makerAccountId,
            quote.collateralAssetId,
            quote.collateralBindingVersion,
            quote.maximumLiability,
            quote.capacityExpiry
        );
        CollateralId collateralId =
            _collateralVault.deriveCollateralId(quote.collateralAssetId, quote.collateralBindingVersion);
        _requireLockMatches(quoteId, quote, lockId, collateralId, lockReference, quote.maximumLiability);

        _capacities[quoteId] = FirmCapacityRecord({
            quoteId: quoteId,
            maker: quote.maker,
            makerAccountId: quote.makerAccountId,
            collateralId: collateralId,
            lockId: lockId,
            riskDomainId: quote.riskDomainId,
            riskDomainVersion: quote.riskDomainVersion,
            expiry: quote.capacityExpiry,
            status: FirmCapacityStatus.Active,
            initialLiability: quote.maximumLiability,
            remainingLiability: quote.maximumLiability
        });
        _setQuoteStatus(quoteId, quoteRecord, MakerQuoteStatus.Reserved);
        lockIdRaw = CollateralLockId.unwrap(lockId);
        emit FirmCapacityReserved(
            quoteId, lockIdRaw, _capacityCommitment(quoteId, quote, collateralId), quote.capacityExpiry
        );
    }

    function lockSelection(RfqSelectionAuthorization calldata selection, bytes calldata signature)
        external
        nonReentrant
    {
        RfqRecord storage rfq = _requireRfq(selection.rfqId);
        if (rfq.status != RfqStatus.Collecting) revert InvalidRfqState(selection.rfqId, rfq.status);
        if (MakerQuoteId.unwrap(rfq.selectedQuoteId) != bytes32(0)) revert SelectionAlreadyExists(selection.rfqId);
        MakerQuoteRecord storage quote = _requireQuote(selection.quoteId);
        if (quote.status != MakerQuoteStatus.Reserved) revert InvalidQuoteState(selection.quoteId, quote.status);
        _requireRfqLive(selection.rfqId, rfq.request.deadline);
        _requireQuoteLive(selection.quoteId, quote.quote.deadline);
        if (
            RfqId.unwrap(quote.quote.rfqId) != RfqId.unwrap(selection.rfqId) || selection.taker != rfq.request.taker
                || selection.executor != _effectiveExecutor(rfq.request) || selection.deadline < block.timestamp
                || selection.deadline > rfq.request.deadline || selection.salt == bytes32(0)
        ) revert SelectionMismatch();

        _requireUnusedNonce(selection.taker, selection.nonce);
        bytes32 digest = RfqHashLib.selectionDigest(selection, block.chainid, address(this));
        _requireSignature(selection.taker, digest, signature);
        _validationGate.validateSelection(rfq.request, quote.quote, selection);
        _useNonce(selection.taker, selection.nonce);

        rfq.selectedQuoteId = selection.quoteId;
        _setQuoteStatus(selection.quoteId, quote, MakerQuoteStatus.Selected);
        _setRfqStatus(selection.rfqId, rfq, RfqStatus.SelectionLocked);
        emit RfqSelectionCommitted(selection.rfqId, selection.quoteId, digest, selection.executor);
    }

    function confirmSelectedCapacity(RfqId rfqId) external nonReentrant {
        RfqRecord storage rfq = _requireRfq(rfqId);
        if (rfq.status != RfqStatus.SelectionLocked) revert InvalidRfqState(rfqId, rfq.status);
        MakerQuoteId quoteId = rfq.selectedQuoteId;
        MakerQuoteRecord storage quote = _requireQuote(quoteId);
        FirmCapacityRecord storage capacity = _requireActiveCapacity(quoteId);
        _requireCapacityLockLive(quoteId, capacity, quote.quote);
        _setRfqStatus(rfqId, rfq, RfqStatus.CapacityReserved);
    }

    function authorizeSubmission(RfqId rfqId) external nonReentrant {
        RfqRecord storage rfq = _requireRfq(rfqId);
        if (rfq.status != RfqStatus.CapacityReserved) revert InvalidRfqState(rfqId, rfq.status);
        _requireExecutor(rfq, rfqId);
        _requireRfqLive(rfqId, rfq.request.deadline);
        _setRfqStatus(rfqId, rfq, RfqStatus.Authorized);
    }

    function submitSelectedRfq(RfqId rfqId, bytes32 submissionReference) external nonReentrant {
        if (submissionReference == bytes32(0)) revert ZeroReference();
        RfqRecord storage rfq = _requireRfq(rfqId);
        if (rfq.status != RfqStatus.Authorized) revert InvalidRfqState(rfqId, rfq.status);
        _requireExecutor(rfq, rfqId);
        _requireRfqLive(rfqId, rfq.request.deadline);
        _setRfqStatus(rfqId, rfq, RfqStatus.Submitted);
        emit RfqSubmitted(rfqId, rfq.selectedQuoteId, submissionReference);
    }

    function consumeClearingHandoff(RfqId rfqId, Lots fillLots, uint128 liabilityAmount, bytes32 executionReference)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
        returns (ClearingHandoff memory handoff)
    {
        return _consumeClearingHandoff(rfqId, fillLots, liabilityAmount, executionReference);
    }

    function _consumeClearingHandoff(RfqId rfqId, Lots fillLots, uint128 liabilityAmount, bytes32 executionReference)
        private
        returns (ClearingHandoff memory handoff)
    {
        if (executionReference == bytes32(0)) revert ZeroReference();
        if (_consumedHandoffs[executionReference]) revert HandoffAlreadyConsumed(executionReference);
        uint128 fill = Lots.unwrap(fillLots);
        if (fill == 0) revert ZeroFillLots();

        RfqRecord storage rfq = _requireRfq(rfqId);
        if (rfq.status != RfqStatus.Submitted && rfq.status != RfqStatus.Clearing) {
            revert InvalidRfqState(rfqId, rfq.status);
        }
        _requireRfqLive(rfqId, rfq.request.deadline);
        MakerQuoteId quoteId = rfq.selectedQuoteId;
        MakerQuoteRecord storage quote = _requireQuote(quoteId);
        if (quote.status != MakerQuoteStatus.Selected) revert InvalidQuoteState(quoteId, quote.status);
        _requireQuoteLive(quoteId, quote.quote.deadline);
        FirmCapacityRecord storage capacity = _requireActiveCapacity(quoteId);
        _requireCapacityLockLive(quoteId, capacity, quote.quote);

        uint128 alreadyFilled = Lots.unwrap(quote.cumulativeFilledLots);
        uint128 remainingLots = Lots.unwrap(quote.quote.lots) - alreadyFilled;
        uint128 minimum = Lots.unwrap(quote.quote.minimumFillLots);
        if (
            fill > remainingLots || (!quote.quote.allowPartialFills && fill != remainingLots)
                || (fill < minimum && fill != remainingLots)
        ) revert InvalidFillLots(fill, remainingLots, minimum);
        if (liabilityAmount == 0 || liabilityAmount > capacity.remainingLiability) {
            revert CapacityAmountExceeded(quoteId, capacity.remainingLiability, liabilityAmount);
        }
        bool terminalFill = fill == remainingLots || quote.quote.remainderPolicy == RemainderPolicy.CancelRemainder;
        if (liabilityAmount == capacity.remainingLiability && !terminalFill) {
            revert CapacityExhaustedBeforeTerminalFill(quoteId);
        }
        bytes32 reservationKey = _quoteReservationKeys[quoteId];
        if (reservationKey != bytes32(0)) {
            SourceRouteReservation storage routeReservation = _routeReservations[reservationKey];
            if (
                routeReservation.status != SourceReservationStatus.Active
                    || routeReservation.clearingConsumer != msg.sender || block.timestamp > routeReservation.expiry
                    || Lots.unwrap(routeReservation.quantity) != fill
            ) revert InvalidRouteReservation();
        }
        _validationGate.validateHandoff(rfq.request, quote.quote, msg.sender, fillLots, liabilityAmount);

        if (reservationKey != bytes32(0)) {
            _closeRouteReservation(
                reservationKey,
                SourceReservationStatus.Consumed,
                keccak256(abi.encode("RFQ_ROUTE_CONSUMED", executionReference))
            );
        }
        _consumedHandoffs[executionReference] = true;
        uint128 cumulative = alreadyFilled + fill;
        quote.cumulativeFilledLots = Lots.wrap(cumulative);
        rfq.cumulativeFilledLots = Lots.wrap(Lots.unwrap(rfq.cumulativeFilledLots) + fill);
        capacity.remainingLiability -= liabilityAmount;
        _decreaseCapacityCounters(capacity, liabilityAmount);
        if (capacity.remainingLiability == 0) {
            FirmCapacityStatus previousCapacityStatus = capacity.status;
            capacity.status = FirmCapacityStatus.Consumed;
            emit FirmCapacityChanged(quoteId, previousCapacityStatus, FirmCapacityStatus.Consumed, 0, msg.sender);
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
        emit ClearingHandoffConsumed(
            rfqId,
            quoteId,
            executionReference,
            CollateralLockId.unwrap(capacity.lockId),
            fillLots,
            liabilityAmount,
            capacity.remainingLiability
        );
    }

    function consumeTypedHandoff(ClearingHandoffClaim calldata claim)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
        returns (VerifiedClearingHandoff memory handoff)
    {
        if (claim.kind != ClearingHandoffKind.PrivateRfq || claim.sourceVersion != 1) {
            revert HandoffClaimMismatch();
        }
        RfqId rfqId = RfqId.wrap(claim.sourceId);
        RfqRecord storage rfq = _requireRfq(rfqId);
        MakerQuoteId quoteId = rfq.selectedQuoteId;
        MakerQuoteRecord storage quote = _requireQuote(quoteId);
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
                || claim.longAdmissionId == claim.shortAdmissionId || claim.longAdmissionResultHash == bytes32(0)
                || claim.shortAdmissionResultHash == bytes32(0) || claim.takerOrderHash != rfq.request.takerOrderHash
                || claim.makerOrderHash != quote.quote.makerOrderHash
                || AccountId.unwrap(claim.takerAccountId) != AccountId.unwrap(rfq.request.takerAccountId)
                || AccountId.unwrap(claim.makerAccountId) != AccountId.unwrap(quote.quote.makerAccountId)
                || claim.targetVersion != rfq.request.targetVersion || claim.deadline != deadline
                || PriceTicks.unwrap(claim.executionPriceTicks) != PriceTicks.unwrap(expectedPrice)
                || FeeScheduleId.unwrap(claim.feeScheduleId) != FeeScheduleId.unwrap(rfq.request.feeScheduleId)
                || claim.feeScheduleVersion != rfq.request.feeScheduleVersion
                || claim.takerMaximumFeeMinor != rfq.request.maxFeeMinor
                || claim.makerMaximumFeeMinor != quote.quote.maxFeeMinor
                || claim.riskDomainId != rfq.request.riskDomainId
                || claim.riskDomainVersion != rfq.request.riskDomainVersion
                || claim.executionModeId != rfq.request.executionModeId
                || !_sideAllowed(rfq.request.sidePolicy, claim.takerSide)
        ) revert HandoffClaimMismatch();
        if (packageTarget) {
            if (
                claim.targetKind != OrderTargetKind.Package
                    || PackageId.unwrap(claim.packageId) != PackageId.unwrap(rfq.request.packageId)
                    || claim.packageWitnessHash != rfq.request.packageLegsHash
                    || PackageDefinitionLib.hashLegs(claim.packageLegs) != rfq.request.packageLegsHash
            ) revert HandoffClaimMismatch();
        } else if (
            claim.targetKind != OrderTargetKind.Series
                || SeriesId.unwrap(claim.seriesId) != SeriesId.unwrap(rfq.request.seriesId)
                || claim.packageLegs.length != 0 || claim.packageWitnessHash != bytes32(0)
        ) {
            revert HandoffClaimMismatch();
        }

        FirmCapacityRecord storage capacity = _requireActiveCapacity(quoteId);
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
            ) revert HandoffClaimMismatch();
            liabilityAmount += disposition.reservationAmount;
            if (liabilityAmount > type(uint128).max || disposition.reservationAmount > expectedRemaining) {
                revert HandoffClaimMismatch();
            }
            expectedRemaining -= disposition.reservationAmount;
        }
        if (liabilityAmount == 0) revert HandoffClaimMismatch();
        _consumeClearingHandoff(rfqId, claim.fillLots, uint128(liabilityAmount), claim.consumptionId);
        _handoffRfqs[claim.consumptionId] = rfqId;
        handoff = VerifiedClearingHandoff({
            claim: claim,
            provenanceHash: keccak256(abi.encode(block.chainid, address(this), expectedCommitment, claim.consumptionId))
        });
    }

    function finalizeTypedHandoff(bytes32 consumptionId, bytes32 fillId, bytes32 positionsHash)
        external
        onlyRole(CLEARING_ENGINE_ROLE)
        nonReentrant
    {
        if (!_consumedHandoffs[consumptionId] || fillId == bytes32(0) || positionsHash == bytes32(0)) {
            revert HandoffClaimMismatch();
        }
        RfqId rfqId = _handoffRfqs[consumptionId];
        RfqRecord storage rfq = _requireRfq(rfqId);
        MakerQuoteRecord storage quote = _requireQuote(rfq.selectedQuoteId);
        if (quote.status == MakerQuoteStatus.Consumed) {
            FirmCapacityRecord storage capacity = _capacities[rfq.selectedQuoteId];
            if (capacity.status == FirmCapacityStatus.Active) {
                uint128 remaining = capacity.remainingLiability;
                if (remaining != 0) _decreaseCapacityCounters(capacity, remaining);
                capacity.remainingLiability = 0;
                capacity.status = FirmCapacityStatus.Released;
                IAtomicClearingEngine(_clearingEngine).positionEngine().releasePositionFundingLock(capacity.lockId);
                CollateralLock memory released = _collateralVault.getLock(capacity.lockId);
                if (released.status != LockStatus.Released || released.remainingAmount != 0) {
                    revert CapacityLockMismatch(rfq.selectedQuoteId);
                }
                emit FirmCapacityChanged(
                    rfq.selectedQuoteId, FirmCapacityStatus.Active, FirmCapacityStatus.Released, 0, msg.sender
                );
            } else {
                _requireCapacityLockSynchronized(rfq.selectedQuoteId, quote.quote);
            }
            _setRfqStatus(rfqId, rfq, RfqStatus.Settled);
            emit RfqSettled(rfqId, rfq.selectedQuoteId, fillId);
        }
    }

    function source() external view returns (address) {
        return address(this);
    }

    function handoffConsumed(bytes32 consumptionId) external view returns (bool) {
        return _consumedHandoffs[consumptionId];
    }

    function settleRfq(RfqId rfqId, bytes32 settlementReference) external onlyRole(CLEARING_ENGINE_ROLE) nonReentrant {
        if (settlementReference == bytes32(0)) revert ZeroReference();
        RfqRecord storage rfq = _requireRfq(rfqId);
        if (rfq.status != RfqStatus.Clearing) revert InvalidRfqState(rfqId, rfq.status);
        MakerQuoteRecord storage quote = _requireQuote(rfq.selectedQuoteId);
        if (quote.status != MakerQuoteStatus.Consumed) revert InvalidQuoteState(rfq.selectedQuoteId, quote.status);
        _requireCapacityLockSynchronized(rfq.selectedQuoteId, quote.quote);
        _setRfqStatus(rfqId, rfq, RfqStatus.Settled);
        emit RfqSettled(rfqId, rfq.selectedQuoteId, settlementReference);
    }

    function rejectRfq(RfqId rfqId, bytes32 reason) external onlyRole(CLEARING_ENGINE_ROLE) nonReentrant {
        if (reason == bytes32(0)) revert ZeroReference();
        RfqRecord storage rfq = _requireRfq(rfqId);
        if (rfq.status == RfqStatus.Settled || _isTerminal(rfq.status)) revert InvalidRfqState(rfqId, rfq.status);
        bytes32 reservationKey = _quoteReservationKeys[rfq.selectedQuoteId];
        if (reservationKey != bytes32(0)) {
            _closeRouteReservation(reservationKey, SourceReservationStatus.Released, reason);
        }
        _setRfqStatus(rfqId, rfq, RfqStatus.Rejected);
        emit RfqRejected(rfqId, reason);
    }

    function cancelRfq(RfqId rfqId) external nonReentrant {
        RfqRecord storage rfq = _requireRfq(rfqId);
        if (rfq.status != RfqStatus.Inviting && rfq.status != RfqStatus.Collecting) {
            revert InvalidRfqState(rfqId, rfq.status);
        }
        _requireTaker(rfq, rfqId);
        _setRfqStatus(rfqId, rfq, RfqStatus.Cancelled);
    }

    function expireRfq(RfqId rfqId) external nonReentrant {
        RfqRecord storage rfq = _requireRfq(rfqId);
        if (_isTerminal(rfq.status) || rfq.status == RfqStatus.Settled) revert InvalidRfqState(rfqId, rfq.status);
        if (block.timestamp <= rfq.request.deadline) revert RfqStillLive(rfqId, rfq.request.deadline);
        _setRfqStatus(rfqId, rfq, RfqStatus.Expired);
    }

    function cancelQuoteCapacity(CapacityCancelAuthorization calldata cancellation, bytes calldata signature)
        external
        nonReentrant
    {
        MakerQuoteRecord storage quote = _requireQuote(cancellation.quoteId);
        if (quote.status == MakerQuoteStatus.Selected) revert InvalidQuoteState(cancellation.quoteId, quote.status);
        if (
            cancellation.maker != quote.quote.maker || cancellation.deadline < block.timestamp
                || cancellation.salt == bytes32(0)
        ) revert SelectionMismatch();
        _requireUnusedNonce(cancellation.maker, cancellation.nonce);
        bytes32 digest = RfqHashLib.capacityCancelDigest(cancellation, block.chainid, address(this));
        _requireSignature(cancellation.maker, digest, signature);
        _useNonce(cancellation.maker, cancellation.nonce);
        _releaseCapacity(cancellation.quoteId, FirmCapacityStatus.Released);
        if (quote.status != MakerQuoteStatus.Consumed) {
            _setQuoteStatus(cancellation.quoteId, quote, MakerQuoteStatus.Cancelled);
        }
    }

    function expireQuoteCapacity(MakerQuoteId quoteId) external nonReentrant {
        MakerQuoteRecord storage quote = _requireQuote(quoteId);
        FirmCapacityRecord storage capacity = _capacities[quoteId];
        if (capacity.status == FirmCapacityStatus.Unspecified) {
            if (block.timestamp <= quote.quote.deadline) revert QuoteStillLive(quoteId, quote.quote.deadline);
        } else {
            if (block.timestamp < capacity.expiry) revert CapacityNotExpired(quoteId, capacity.expiry);
            bytes32 reservationKey = _quoteReservationKeys[quoteId];
            if (reservationKey != bytes32(0)) {
                _closeRouteReservation(
                    reservationKey,
                    SourceReservationStatus.Expired,
                    keccak256(abi.encode("RFQ_CAPACITY_EXPIRED", MakerQuoteId.unwrap(quoteId)))
                );
            }
            _releaseCapacity(quoteId, FirmCapacityStatus.Expired);
        }
        if (quote.status != MakerQuoteStatus.Consumed) {
            _setQuoteStatus(quoteId, quote, MakerQuoteStatus.Expired);
        }
        RfqRecord storage rfq = _rfqs[quote.quote.rfqId];
        if (
            MakerQuoteId.unwrap(rfq.selectedQuoteId) == MakerQuoteId.unwrap(quoteId) && !_isTerminal(rfq.status)
                && rfq.status != RfqStatus.Settled
        ) _setRfqStatus(quote.quote.rfqId, rfq, RfqStatus.Expired);
    }

    function reserveForRoute(
        RouteId routeId,
        MakerQuoteId quoteId,
        Lots quantity,
        uint64 expiry,
        bytes32 reservationKey,
        address clearingConsumer
    ) external onlyRole(ROUTE_RESERVER_ROLE) nonReentrant {
        uint128 requested = Lots.unwrap(quantity);
        if (
            RouteId.unwrap(routeId) == bytes32(0) || reservationKey == bytes32(0) || clearingConsumer != _clearingEngine
                || requested == 0 || expiry <= block.timestamp
        ) revert InvalidRouteReservation();
        if (
            _routeReservations[reservationKey].status != SourceReservationStatus.Unspecified
                || _quoteReservationKeys[quoteId] != bytes32(0)
        ) revert RouteReservationAlreadyExists(quoteId, reservationKey);
        MakerQuoteRecord storage quote = _requireQuote(quoteId);
        RfqRecord storage rfq = _requireRfq(quote.quote.rfqId);
        if (
            quote.status != MakerQuoteStatus.Selected
                || (rfq.status != RfqStatus.CapacityReserved
                    && rfq.status != RfqStatus.Authorized
                    && rfq.status != RfqStatus.Submitted
                    && rfq.status != RfqStatus.Clearing)
                || MakerQuoteId.unwrap(rfq.selectedQuoteId) != MakerQuoteId.unwrap(quoteId)
                || expiry > quote.quote.deadline || expiry > rfq.request.deadline
        ) revert InvalidRouteReservation();
        uint128 remaining = Lots.unwrap(quote.quote.lots) - Lots.unwrap(quote.cumulativeFilledLots);
        uint128 minimum = Lots.unwrap(quote.quote.minimumFillLots);
        if (
            requested > remaining || (!quote.quote.allowPartialFills && requested != remaining)
                || (requested < minimum && requested != remaining)
        ) revert InvalidFillLots(requested, remaining, minimum);
        _requireCapacityLockLive(quoteId, _requireActiveCapacity(quoteId), quote.quote);
        _quoteReservationKeys[quoteId] = reservationKey;
        _routeReservations[reservationKey] = SourceRouteReservation({
            routeId: routeId,
            sourceId: MakerQuoteId.unwrap(quoteId),
            reservationKey: reservationKey,
            clearingConsumer: clearingConsumer,
            quantity: quantity,
            expiry: expiry,
            status: SourceReservationStatus.Active
        });
        emit RfqRouteReserved(quoteId, routeId, reservationKey, quantity, expiry, clearingConsumer);
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

    function _validateQuoteAgainstRequest(PrivateRfqRequest storage request, MakerQuote calldata quote) private view {
        if (
            AccountId.unwrap(quote.takerAccountId) != AccountId.unwrap(request.takerAccountId)
                || quote.targetKind != request.targetKind
                || SeriesId.unwrap(quote.seriesId) != SeriesId.unwrap(request.seriesId)
                || PackageId.unwrap(quote.packageId) != PackageId.unwrap(request.packageId)
                || quote.targetVersion != request.targetVersion
                || quote.hasPackageLegCommitment != request.hasPackageLegCommitment
                || quote.packageLegsHash != request.packageLegsHash || quote.sidePolicy != request.sidePolicy
                || FeeScheduleId.unwrap(quote.feeScheduleId) != FeeScheduleId.unwrap(request.feeScheduleId)
                || quote.feeScheduleVersion != request.feeScheduleVersion || quote.maxFeeMinor > request.maxFeeMinor
                || RiskDomainId.unwrap(quote.riskDomainId) != RiskDomainId.unwrap(request.riskDomainId)
                || quote.riskDomainVersion != request.riskDomainVersion || quote.privacyModeId != request.privacyModeId
                || quote.executionModeId != request.executionModeId
                || quote.disclosurePolicyHash != request.disclosurePolicyHash
                || quote.eligibleMakerSetHash != request.eligibleMakerSetHash
                || quote.permittedExecutor != request.permittedExecutor || quote.deadline > request.deadline
        ) revert QuoteRequestMismatch();
        uint128 quoteLots = Lots.unwrap(quote.lots);
        uint128 requestLots = Lots.unwrap(request.lots);
        if (quoteLots > requestLots) revert QuoteRequestMismatch();
        if (
            quoteLots < requestLots
                && (!request.allowPartialFills || request.remainderPolicy != RemainderPolicy.CancelRemainder)
        ) revert QuoteRequestMismatch();
    }

    function _increaseCapacityCounters(MakerQuote storage quote, RiskDomainVersion memory risk) private {
        uint128 accountCap = risk.definition.maxAccountReservationBaseUnits;
        uint128 aggregateCap = risk.definition.maxAggregateReservationBaseUnits;
        if (accountCap == 0 || aggregateCap == 0) revert RiskDomainReservationDisabled();
        uint256 newDomain = _domainReserved[quote.riskDomainId][quote.riskDomainVersion] + quote.maximumLiability;
        uint256 newAccount = _accountReserved[quote.riskDomainId][quote.riskDomainVersion][quote.makerAccountId]
            + quote.maximumLiability;
        if (newDomain > aggregateCap) revert AggregateReservationCapExceeded(aggregateCap, newDomain);
        if (newAccount > accountCap) revert AccountReservationCapExceeded(accountCap, newAccount);
        _domainReserved[quote.riskDomainId][quote.riskDomainVersion] = newDomain;
        _accountReserved[quote.riskDomainId][quote.riskDomainVersion][quote.makerAccountId] = newAccount;
    }

    function _decreaseCapacityCounters(FirmCapacityRecord storage capacity, uint128 amount) private {
        _domainReserved[capacity.riskDomainId][capacity.riskDomainVersion] -= amount;
        _accountReserved[capacity.riskDomainId][capacity.riskDomainVersion][capacity.makerAccountId] -= amount;
    }

    function _releaseCapacity(MakerQuoteId quoteId, FirmCapacityStatus terminalStatus) private {
        FirmCapacityRecord storage capacity = _capacities[quoteId];
        if (capacity.status != FirmCapacityStatus.Active) revert CapacityNotActive(quoteId, capacity.status);
        uint128 remaining = capacity.remainingLiability;
        if (remaining != 0) _decreaseCapacityCounters(capacity, remaining);
        FirmCapacityStatus previousStatus = capacity.status;
        capacity.status = terminalStatus;
        capacity.remainingLiability = 0;
        if (terminalStatus == FirmCapacityStatus.Expired) {
            _collateralVault.releaseExpiredLock(capacity.lockId);
        } else {
            IAtomicClearingEngine(_clearingEngine).positionEngine().releasePositionFundingLock(capacity.lockId);
        }
        emit FirmCapacityChanged(quoteId, previousStatus, terminalStatus, 0, msg.sender);
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

    function _capacityCommitment(MakerQuoteId quoteId, MakerQuote storage quote, CollateralId collateralId)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                CAPACITY_COMMITMENT_TYPEHASH,
                MakerQuoteId.unwrap(quoteId),
                quote.maker,
                AccountId.unwrap(quote.makerAccountId),
                CollateralId.unwrap(collateralId),
                RiskDomainId.unwrap(quote.riskDomainId),
                quote.riskDomainVersion,
                quote.maximumLiability,
                quote.capacityExpiry
            )
        );
    }

    function _targetCommitment(PrivateRfqRequest calldata request) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TARGET_COMMITMENT_TYPEHASH,
                request.targetKind,
                SeriesId.unwrap(request.seriesId),
                PackageId.unwrap(request.packageId),
                request.targetVersion,
                request.packageLegsHash
            )
        );
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

    function _sideAllowed(RfqSidePolicy policy, Side side) private pure returns (bool) {
        if (side == Side.Buy) return policy == RfqSidePolicy.BuyOnly || policy == RfqSidePolicy.TwoWay;
        if (side == Side.Sell) return policy == RfqSidePolicy.SellOnly || policy == RfqSidePolicy.TwoWay;
        return false;
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency();
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
