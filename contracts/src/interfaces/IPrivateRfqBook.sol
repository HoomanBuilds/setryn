// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IFirmCapacityVault} from "./IFirmCapacityVault.sol";
import {IPrivateRfqValidationGate} from "./IPrivateRfqValidationGate.sol";
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
import {RouteId, SourceRouteReservation} from "../types/RoutingTypes.sol";

interface IPrivateRfqBook {
    event RfqRouteReserved(
        MakerQuoteId indexed quoteId,
        RouteId indexed routeId,
        bytes32 indexed reservationKey,
        Lots quantity,
        uint64 expiry,
        address clearingConsumer
    );
    event RfqRouteReservationClosed(
        MakerQuoteId indexed quoteId,
        RouteId indexed routeId,
        bytes32 indexed reservationKey,
        uint8 status,
        bytes32 closeReference
    );
    event PrivateRfqCommitted(
        RfqId indexed rfqId,
        bytes32 indexed requestCommitment,
        bytes32 indexed targetCommitment,
        bytes32 packageLegsHash,
        bytes32 privacyModeId,
        bytes32 executionModeId,
        uint64 deadline
    );
    event RfqStatusChanged(RfqId indexed rfqId, RfqStatus previousStatus, RfqStatus newStatus, address operator);
    event MakerQuoteCommitted(
        MakerQuoteId indexed quoteId,
        RfqId indexed rfqId,
        bytes32 indexed quoteCommitment,
        uint64 deadline,
        uint64 capacityExpiry
    );
    event MakerQuoteStatusChanged(
        MakerQuoteId indexed quoteId, MakerQuoteStatus previousStatus, MakerQuoteStatus newStatus, address operator
    );
    event FirmCapacityReserved(
        MakerQuoteId indexed quoteId, bytes32 indexed lockId, bytes32 indexed capacityCommitment, uint64 expiry
    );
    event FirmCapacityChanged(
        MakerQuoteId indexed quoteId,
        FirmCapacityStatus previousStatus,
        FirmCapacityStatus newStatus,
        uint128 remainingLiability,
        address operator
    );
    event RfqSelectionCommitted(
        RfqId indexed rfqId, MakerQuoteId indexed quoteId, bytes32 indexed selectionCommitment, address executor
    );
    event RfqSubmitted(RfqId indexed rfqId, MakerQuoteId indexed quoteId, bytes32 indexed submissionReference);
    event ClearingHandoffConsumed(
        RfqId indexed rfqId,
        MakerQuoteId indexed quoteId,
        bytes32 indexed executionReference,
        bytes32 lockId,
        Lots fillLots,
        uint128 liabilityAmount,
        uint128 remainingLiability
    );
    event RfqSettled(RfqId indexed rfqId, MakerQuoteId indexed quoteId, bytes32 indexed settlementReference);
    event RfqRejected(RfqId indexed rfqId, bytes32 indexed reason);

    error ZeroInitialAdmin();
    error ZeroDependency();
    error DependencyHasNoCode(address dependency);
    error ZeroClearingEngine();
    error ZeroMaximumCapacityTail();
    error InvalidSignature(address signer, bytes32 digest);
    error NonceAlreadyUsed(address signer, uint256 nonce);
    error UnknownRfq(RfqId rfqId);
    error UnknownQuote(MakerQuoteId quoteId);
    error DuplicateRfq(RfqId rfqId);
    error DuplicateQuote(MakerQuoteId quoteId);
    error InvalidRfqState(RfqId rfqId, RfqStatus status);
    error InvalidQuoteState(MakerQuoteId quoteId, MakerQuoteStatus status);
    error UnauthorizedRfqActor(RfqId rfqId, address expected, address actual);
    error RfqExpired(RfqId rfqId, uint64 deadline);
    error QuoteExpired(MakerQuoteId quoteId, uint64 deadline);
    error RfqStillLive(RfqId rfqId, uint64 deadline);
    error QuoteStillLive(MakerQuoteId quoteId, uint64 deadline);
    error QuoteRequestMismatch();
    error SelectionMismatch();
    error InvalidCapacityTail(uint64 deadline, uint64 capacityExpiry, uint64 maximumTail);
    error RiskDomainClosed();
    error RiskDomainCollateralMismatch();
    error RiskDomainReservationDisabled();
    error AggregateReservationCapExceeded(uint256 cap, uint256 requested);
    error AccountReservationCapExceeded(uint256 cap, uint256 requested);
    error CapacityAlreadyExists(MakerQuoteId quoteId);
    error CapacityLockMismatch(MakerQuoteId quoteId);
    error CapacityNotActive(MakerQuoteId quoteId, FirmCapacityStatus status);
    error CapacityNotExpired(MakerQuoteId quoteId, uint64 expiry);
    error CapacityAmountExceeded(MakerQuoteId quoteId, uint128 remaining, uint128 requested);
    error CapacityExhaustedBeforeTerminalFill(MakerQuoteId quoteId);
    error ZeroFillLots();
    error InvalidFillLots(uint128 requested, uint128 remaining, uint128 minimum);
    error ZeroReference();
    error SelectionAlreadyExists(RfqId rfqId);
    error InvalidRouteReservation();
    error RouteReservationAlreadyExists(MakerQuoteId quoteId, bytes32 reservationKey);
    error UnauthorizedRouteReserver(address caller);

    function CLEARING_ENGINE_ROLE() external view returns (bytes32);
    function ROUTE_RESERVER_ROLE() external view returns (bytes32);
    function collateralVault() external view returns (IFirmCapacityVault);
    function validationGate() external view returns (IPrivateRfqValidationGate);
    function clearingEngine() external view returns (address);
    function hashRequest(PrivateRfqRequest calldata request) external view returns (RfqId);
    function hashQuote(MakerQuote calldata quote) external view returns (MakerQuoteId);
    function registerRequest(
        PrivateRfqRequest calldata request,
        PackageLeg[] calldata packageLegs,
        bytes calldata signature
    ) external returns (RfqId rfqId);
    function openCollection(RfqId rfqId) external;
    function submitQuote(MakerQuote calldata quote, bytes32[] calldata eligibleMakerProof, bytes calldata signature)
        external
        returns (MakerQuoteId quoteId);
    function reserveQuoteCapacity(MakerQuoteId quoteId) external returns (bytes32 lockId);
    function lockSelection(RfqSelectionAuthorization calldata selection, bytes calldata signature) external;
    function confirmSelectedCapacity(RfqId rfqId) external;
    function authorizeSubmission(RfqId rfqId) external;
    function submitSelectedRfq(RfqId rfqId, bytes32 submissionReference) external;
    function consumeClearingHandoff(RfqId rfqId, Lots fillLots, uint128 liabilityAmount, bytes32 executionReference)
        external
        returns (ClearingHandoff memory handoff);
    function settleRfq(RfqId rfqId, bytes32 settlementReference) external;
    function rejectRfq(RfqId rfqId, bytes32 reason) external;
    function cancelRfq(RfqId rfqId) external;
    function expireRfq(RfqId rfqId) external;
    function cancelQuoteCapacity(CapacityCancelAuthorization calldata cancellation, bytes calldata signature) external;
    function expireQuoteCapacity(MakerQuoteId quoteId) external;
    function reserveForRoute(
        RouteId routeId,
        MakerQuoteId quoteId,
        Lots quantity,
        uint64 expiry,
        bytes32 reservationKey,
        address clearingConsumer
    ) external;
    function releaseRouteReservation(bytes32 reservationKey, bytes32 releaseReference) external;
    function expireRouteReservation(bytes32 reservationKey) external;
    function getRouteReservation(bytes32 reservationKey) external view returns (SourceRouteReservation memory);
    function getRfq(RfqId rfqId) external view returns (RfqRecord memory);
    function getQuote(MakerQuoteId quoteId) external view returns (MakerQuoteRecord memory);
    function getCapacity(MakerQuoteId quoteId) external view returns (FirmCapacityRecord memory);
    function selectedHandoffCommitment(RfqId rfqId) external view returns (bytes32 commitment);
}
