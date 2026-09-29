// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IFirmCapacityRiskRegistry} from "../interfaces/IFirmCapacityVault.sol";
import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPrivateRfqBook} from "../interfaces/IPrivateRfqBook.sol";
import {RfqHashLib} from "../libraries/RfqHashLib.sol";
import {CollateralLock} from "../types/CollateralTypes.sol";
import {LockStatus} from "../types/Enums.sol";
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
import {RemainderPolicy} from "../types/OrderTypes.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {
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

import {PrivateRfqDependencies} from "./PrivateRfqTypes.sol";

/// Linked logic for the private RFQ book: request registration, maker quotes, firm capacity, and selection.
/// Runs through DELEGATECALL in the book's context against its storage.
library PrivateRfqQuoteLib {
    bytes32 internal constant CAPACITY_COMMITMENT_TYPEHASH = keccak256(
        "SetrynFirmCapacityV1(bytes32 quoteId,address maker,bytes32 makerAccountId,bytes32 collateralId,bytes32 riskDomainId,uint32 riskDomainVersion,uint128 maximumLiability,uint64 expiry)"
    );
    bytes32 internal constant CAPACITY_LOCK_REFERENCE_TYPEHASH = keccak256("SetrynFirmCapacityLockV1(bytes32 quoteId)");
    bytes32 internal constant TARGET_COMMITMENT_TYPEHASH = keccak256(
        "SetrynRfqTargetV1(uint8 targetKind,bytes32 seriesId,bytes32 packageId,uint32 targetVersion,bytes32 packageLegsHash)"
    );

    function registerRequest(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(
            address signer => mapping(uint256 nonce => bool used)
        ) storage $usedNonces,
        PrivateRfqRequest calldata request,
        PackageLeg[] calldata packageLegs,
        bytes calldata signature
    ) external returns (RfqId rfqId) {
        RfqHashLib.validateRequest(request, packageLegs, block.timestamp);
        rfqId = hashRequest(request);
        if ($rfqs[rfqId].status != RfqStatus.Unspecified) revert IPrivateRfqBook.DuplicateRfq(rfqId);
        _requireUnusedNonce($usedNonces, request.taker, request.nonce);
        bytes32 digest = RfqId.unwrap(rfqId);
        _requireSignature(request.taker, digest, signature);
        deps.validationGate.validateRequest(request, packageLegs);

        _useNonce($usedNonces, request.taker, request.nonce);
        uint64 registeredAt = uint64(block.timestamp);
        $rfqs[rfqId] = RfqRecord({
            request: request,
            selectedQuoteId: MakerQuoteId.wrap(bytes32(0)),
            status: RfqStatus.Inviting,
            cumulativeFilledLots: Lots.wrap(0),
            registeredAt: registeredAt
        });
        emit IPrivateRfqBook.PrivateRfqCommitted(
            rfqId,
            digest,
            _targetCommitment(request),
            request.packageLegsHash,
            request.privacyModeId,
            request.executionModeId,
            request.deadline
        );
    }

    function submitQuote(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(
            MakerQuoteId quoteId => MakerQuoteRecord record
        ) storage $quotes,
        mapping(address signer => mapping(uint256 nonce => bool used)) storage $usedNonces,
        MakerQuote calldata quote,
        bytes32[] calldata eligibleMakerProof,
        bytes calldata signature
    ) external returns (MakerQuoteId quoteId) {
        RfqHashLib.validateQuote(quote, block.timestamp);
        RfqRecord storage rfq = _requireRfq($rfqs, quote.rfqId);
        if (rfq.status != RfqStatus.Collecting) revert IPrivateRfqBook.InvalidRfqState(quote.rfqId, rfq.status);
        _requireRfqLive(quote.rfqId, rfq.request.deadline);
        _validateQuoteAgainstRequest(rfq.request, quote);

        quoteId = hashQuote(quote);
        if ($quotes[quoteId].status != MakerQuoteStatus.Unspecified) revert IPrivateRfqBook.DuplicateQuote(quoteId);
        _requireUnusedNonce($usedNonces, quote.maker, quote.nonce);
        bytes32 digest = MakerQuoteId.unwrap(quoteId);
        _requireSignature(quote.maker, digest, signature);
        deps.validationGate.validateQuote(rfq.request, quote, eligibleMakerProof);

        _useNonce($usedNonces, quote.maker, quote.nonce);
        $quotes[quoteId] = MakerQuoteRecord({
            quote: quote,
            status: MakerQuoteStatus.Offered,
            cumulativeFilledLots: Lots.wrap(0),
            offeredAt: uint64(block.timestamp)
        });
        emit IPrivateRfqBook.MakerQuoteCommitted(quoteId, quote.rfqId, digest, quote.deadline, quote.capacityExpiry);
    }

    function reserveQuoteCapacity(
        PrivateRfqDependencies memory deps,
        mapping(MakerQuoteId quoteId => MakerQuoteRecord record) storage $quotes,
        mapping(
            MakerQuoteId quoteId => FirmCapacityRecord record
        ) storage $capacities,
        mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        MakerQuoteId quoteId
    ) external returns (bytes32 lockIdRaw) {
        MakerQuoteRecord storage quoteRecord = _requireQuote($quotes, quoteId);
        if (quoteRecord.status != MakerQuoteStatus.Offered) {
            revert IPrivateRfqBook.InvalidQuoteState(quoteId, quoteRecord.status);
        }
        MakerQuote storage quote = quoteRecord.quote;
        _requireQuoteLive(quoteId, quote.deadline);
        if (quote.capacityExpiry - quote.deadline > deps.maximumCapacityTail) {
            revert IPrivateRfqBook.InvalidCapacityTail(quote.deadline, quote.capacityExpiry, deps.maximumCapacityTail);
        }
        if ($capacities[quoteId].status != FirmCapacityStatus.Unspecified) {
            revert IPrivateRfqBook.CapacityAlreadyExists(quoteId);
        }

        IFirmCapacityRiskRegistry risks = deps.collateralVault.riskDomainRegistry();
        if (!risks.isOpenForNewRisk(quote.riskDomainId, quote.riskDomainVersion)) {
            revert IPrivateRfqBook.RiskDomainClosed();
        }
        RiskDomainVersion memory risk = risks.getRiskDomain(quote.riskDomainId, quote.riskDomainVersion);
        if (
            AssetId.unwrap(risk.definition.collateralAssetId) != AssetId.unwrap(quote.collateralAssetId)
                || risk.definition.collateralAssetVersion != quote.collateralBindingVersion
        ) revert IPrivateRfqBook.RiskDomainCollateralMismatch();
        _increaseCapacityCounters($domainReserved, $accountReserved, quote, risk);

        bytes32 lockReference = keccak256(abi.encode(CAPACITY_LOCK_REFERENCE_TYPEHASH, MakerQuoteId.unwrap(quoteId)));
        IPositionEngine positionEngine = IAtomicClearingEngine(deps.clearingEngine).positionEngine();
        CollateralLockId lockId = positionEngine.createPositionFundingLock(
            lockReference,
            quote.makerAccountId,
            quote.collateralAssetId,
            quote.collateralBindingVersion,
            quote.maximumLiability,
            quote.capacityExpiry
        );
        CollateralId collateralId =
            deps.collateralVault.deriveCollateralId(quote.collateralAssetId, quote.collateralBindingVersion);
        _requireLockMatches(deps, quoteId, quote, lockId, collateralId, lockReference, quote.maximumLiability);

        $capacities[quoteId] = FirmCapacityRecord({
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
        emit IPrivateRfqBook.FirmCapacityReserved(
            quoteId, lockIdRaw, _capacityCommitment(quoteId, quote, collateralId), quote.capacityExpiry
        );
    }

    function lockSelection(
        PrivateRfqDependencies memory deps,
        mapping(RfqId rfqId => RfqRecord record) storage $rfqs,
        mapping(
            MakerQuoteId quoteId => MakerQuoteRecord record
        ) storage $quotes,
        mapping(address signer => mapping(uint256 nonce => bool used)) storage $usedNonces,
        RfqSelectionAuthorization calldata selection,
        bytes calldata signature
    ) external {
        RfqRecord storage rfq = _requireRfq($rfqs, selection.rfqId);
        if (rfq.status != RfqStatus.Collecting) revert IPrivateRfqBook.InvalidRfqState(selection.rfqId, rfq.status);
        if (MakerQuoteId.unwrap(rfq.selectedQuoteId) != bytes32(0)) {
            revert IPrivateRfqBook.SelectionAlreadyExists(selection.rfqId);
        }
        MakerQuoteRecord storage quote = _requireQuote($quotes, selection.quoteId);
        if (quote.status != MakerQuoteStatus.Reserved) {
            revert IPrivateRfqBook.InvalidQuoteState(selection.quoteId, quote.status);
        }
        _requireRfqLive(selection.rfqId, rfq.request.deadline);
        _requireQuoteLive(selection.quoteId, quote.quote.deadline);
        if (
            RfqId.unwrap(quote.quote.rfqId) != RfqId.unwrap(selection.rfqId) || selection.taker != rfq.request.taker
                || selection.executor != _effectiveExecutor(rfq.request) || selection.deadline < block.timestamp
                || selection.deadline > rfq.request.deadline || selection.salt == bytes32(0)
        ) revert IPrivateRfqBook.SelectionMismatch();

        _requireUnusedNonce($usedNonces, selection.taker, selection.nonce);
        bytes32 digest = RfqHashLib.selectionDigest(selection, block.chainid, address(this));
        _requireSignature(selection.taker, digest, signature);
        deps.validationGate.validateSelection(rfq.request, quote.quote, selection);
        _useNonce($usedNonces, selection.taker, selection.nonce);

        rfq.selectedQuoteId = selection.quoteId;
        _setQuoteStatus(selection.quoteId, quote, MakerQuoteStatus.Selected);
        _setRfqStatus(selection.rfqId, rfq, RfqStatus.SelectionLocked);
        emit IPrivateRfqBook.RfqSelectionCommitted(selection.rfqId, selection.quoteId, digest, selection.executor);
    }

    function _validateQuoteAgainstRequest(PrivateRfqRequest storage request, MakerQuote calldata quote) internal view {
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
        ) revert IPrivateRfqBook.QuoteRequestMismatch();
        uint128 quoteLots = Lots.unwrap(quote.lots);
        uint128 requestLots = Lots.unwrap(request.lots);
        if (quoteLots > requestLots) revert IPrivateRfqBook.QuoteRequestMismatch();
        if (
            quoteLots < requestLots
                && (!request.allowPartialFills || request.remainderPolicy != RemainderPolicy.CancelRemainder)
        ) revert IPrivateRfqBook.QuoteRequestMismatch();
    }

    function _increaseCapacityCounters(
        mapping(RiskDomainId riskDomainId => mapping(uint32 version => uint256 amount)) storage $domainReserved,
        mapping(
            RiskDomainId riskDomainId => mapping(uint32 version => mapping(AccountId accountId => uint256 amount))
        ) storage $accountReserved,
        MakerQuote storage quote,
        RiskDomainVersion memory risk
    ) internal {
        uint128 accountCap = risk.definition.maxAccountReservationBaseUnits;
        uint128 aggregateCap = risk.definition.maxAggregateReservationBaseUnits;
        if (accountCap == 0 || aggregateCap == 0) revert IPrivateRfqBook.RiskDomainReservationDisabled();
        uint256 newDomain = $domainReserved[quote.riskDomainId][quote.riskDomainVersion] + quote.maximumLiability;
        uint256 newAccount = $accountReserved[quote.riskDomainId][quote.riskDomainVersion][quote.makerAccountId]
            + quote.maximumLiability;
        if (newDomain > aggregateCap) revert IPrivateRfqBook.AggregateReservationCapExceeded(aggregateCap, newDomain);
        if (newAccount > accountCap) revert IPrivateRfqBook.AccountReservationCapExceeded(accountCap, newAccount);
        $domainReserved[quote.riskDomainId][quote.riskDomainVersion] = newDomain;
        $accountReserved[quote.riskDomainId][quote.riskDomainVersion][quote.makerAccountId] = newAccount;
    }

    function _capacityCommitment(MakerQuoteId quoteId, MakerQuote storage quote, CollateralId collateralId)
        internal
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

    function _targetCommitment(PrivateRfqRequest calldata request) internal pure returns (bytes32) {
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

    function _effectiveExecutor(PrivateRfqRequest storage request) internal view returns (address) {
        return request.permittedExecutor == address(0) ? request.taker : request.permittedExecutor;
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

    function hashRequest(PrivateRfqRequest calldata request) internal view returns (RfqId) {
        return RfqId.wrap(RfqHashLib.requestDigest(request, block.chainid, address(this)));
    }

    function hashQuote(MakerQuote calldata quote) internal view returns (MakerQuoteId) {
        return MakerQuoteId.wrap(RfqHashLib.quoteDigest(quote, block.chainid, address(this)));
    }
}
