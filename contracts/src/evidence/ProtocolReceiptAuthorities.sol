// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {ICashSettlementCoordinator} from "../interfaces/ICashSettlementCoordinator.sol";
import {ICollateralAwareRouteEngine} from "../interfaces/ICollateralAwareRouteEngine.sol";
import {IDefaultProcessEngine} from "../interfaces/IDefaultProcessEngine.sol";
import {IFundedFeeEngine} from "../interfaces/IFundedFeeEngine.sol";
import {IOperationalAdapterExecutor} from "../interfaces/IOperationalAdapterExecutor.sol";
import {IOrderState} from "../interfaces/IOrderState.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPrivacyCommitmentRegistry} from "../interfaces/IPrivacyCommitmentRegistry.sol";
import {IPrivateRfqBook} from "../interfaces/IPrivateRfqBook.sol";
import {IPublicOrderBook} from "../interfaces/IPublicOrderBook.sol";
import {IReceiptSubjectAuthority} from "../interfaces/IReceiptSubjectAuthority.sol";
import {ISignedLifecycleEngine} from "../interfaces/ISignedLifecycleEngine.sol";
import {DefaultProcessId, DefaultProcess, DefaultProcessStatus} from "../types/DefaultTypes.sol";
import {ReceiptSubjectTerminalState} from "../types/EvidenceTypes.sol";
import {FillId, PositionId, SettlementId} from "../types/Identifiers.sol";
import {LifecycleActionId, LifecycleActionRecord, LifecycleActionStatus} from "../types/LifecycleTypes.sol";
import {OperationalActionState, ExternalActionRecord} from "../types/OperationalAdapterTypes.sol";
import {OrderRecord, OrderStatus} from "../types/OrderTypes.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../types/PositionTypes.sol";
import {PrivacyEnvelopeCommitment, PrivacyEnvelopeId, PrivacyEnvelopeStatus} from "../types/PrivacyTypes.sol";
import {RfqId, RfqRecord, RfqStatus} from "../types/RfqTypes.sol";
import {RiskAdmissionId, RiskAdmission, RiskAdmissionStatus} from "../types/RiskTypes.sol";
import {RouteId, RouteReservation, RouteStatus} from "../types/RoutingTypes.sol";
import {SettlementRecord} from "../types/SettlementTypes.sol";
import {BookOrder, BookOrderStatus} from "../types/BookTypes.sol";
import {FillRecord} from "../types/ClearingTypes.sol";

abstract contract ReceiptAuthorityBase is IReceiptSubjectAuthority {
    bytes32 public immutable subjectKindId;

    error ZeroDependency();
    error DependencyHasNoCode();
    error UnsupportedSubjectKind(bytes32 supplied);

    constructor(bytes32 subjectKindId_, address source) {
        if (subjectKindId_ == bytes32(0) || source == address(0)) revert ZeroDependency();
        if (source.code.length == 0) revert DependencyHasNoCode();
        subjectKindId = subjectKindId_;
    }

    function _requireKind(bytes32 supplied) internal view {
        if (supplied != subjectKindId) revert UnsupportedSubjectKind(supplied);
    }

    function _state(bytes32 stateHash, bytes32 outcomeHash, bool terminal, bool valid)
        internal
        pure
        returns (ReceiptSubjectTerminalState memory)
    {
        return ReceiptSubjectTerminalState({
            stateHash: stateHash, outcomeHash: outcomeHash, terminal: terminal, transitionValid: valid
        });
    }
}

contract OrderReceiptAuthority is ReceiptAuthorityBase {
    IOrderState public immutable source;

    constructor(bytes32 kind, IOrderState source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        OrderRecord memory record = source.getOrder(subjectId);
        bytes32 stateHash = keccak256(abi.encode(record));
        bool terminal = record.status == OrderStatus.Filled || record.status == OrderStatus.Cancelled
            || record.status == OrderStatus.Expired || record.status == OrderStatus.Rejected;
        return _state(stateHash, stateHash, terminal, record.status != OrderStatus.Unspecified);
    }
}

contract BookOrderReceiptAuthority is ReceiptAuthorityBase {
    IPublicOrderBook public immutable source;

    constructor(bytes32 kind, IPublicOrderBook source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        BookOrder memory record = source.getBookOrder(subjectId);
        bytes32 stateHash = keccak256(abi.encode(record));
        return _state(
            stateHash,
            stateHash,
            record.status == BookOrderStatus.Removed,
            record.status != BookOrderStatus.Unspecified && record.orderHash == subjectId
        );
    }
}

contract RfqReceiptAuthority is ReceiptAuthorityBase {
    IPrivateRfqBook public immutable source;

    constructor(bytes32 kind, IPrivateRfqBook source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        RfqRecord memory record = source.getRfq(RfqId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(record));
        bool terminal = record.status == RfqStatus.Settled || record.status == RfqStatus.Cancelled
            || record.status == RfqStatus.Expired || record.status == RfqStatus.Rejected;
        return _state(stateHash, stateHash, terminal, record.status != RfqStatus.Unspecified);
    }
}

contract FillReceiptAuthority is ReceiptAuthorityBase {
    IAtomicClearingEngine public immutable source;

    constructor(bytes32 kind, IAtomicClearingEngine source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        FillRecord memory record = source.getFill(FillId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(record));
        bool valid = FillId.unwrap(record.fillId) == subjectId && record.clearedAt != 0;
        return _state(stateHash, stateHash, valid, valid);
    }
}

contract PositionReceiptAuthority is ReceiptAuthorityBase {
    IPositionEngine public immutable source;

    constructor(bytes32 kind, IPositionEngine source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        (PositionEconomics memory economics, PositionLifecycle memory lifecycle) =
            source.getPosition(PositionId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(economics, lifecycle));
        bool terminal = uint8(lifecycle.status) >= uint8(PositionStatus.Settled);
        bytes32 outcome =
            lifecycle.terminalOutcomeReference == bytes32(0) ? stateHash : lifecycle.terminalOutcomeReference;
        return _state(stateHash, outcome, terminal, PositionId.unwrap(economics.positionId) == subjectId);
    }
}

contract SettlementReceiptAuthority is ReceiptAuthorityBase {
    ICashSettlementCoordinator public immutable source;

    constructor(bytes32 kind, ICashSettlementCoordinator source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        SettlementRecord memory record = source.getSettlement(SettlementId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(record));
        bool valid = SettlementId.unwrap(record.settlementId) == subjectId && record.outcomeHash != bytes32(0);
        return _state(stateHash, record.outcomeHash, valid, valid);
    }
}

contract LifecycleReceiptAuthority is ReceiptAuthorityBase {
    ISignedLifecycleEngine public immutable source;

    constructor(bytes32 kind, ISignedLifecycleEngine source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        LifecycleActionRecord memory record = source.getAction(LifecycleActionId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(record));
        bool terminal = record.status == LifecycleActionStatus.Executed
            || record.status == LifecycleActionStatus.Cancelled || record.status == LifecycleActionStatus.Expired;
        bytes32 outcome = record.executionOutcomeHash == bytes32(0) ? stateHash : record.executionOutcomeHash;
        return _state(stateHash, outcome, terminal, record.status != LifecycleActionStatus.Unspecified);
    }
}

contract DefaultReceiptAuthority is ReceiptAuthorityBase {
    IDefaultProcessEngine public immutable source;

    constructor(bytes32 kind, IDefaultProcessEngine source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        DefaultProcess memory record = source.getDefaultProcess(DefaultProcessId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(record));
        bool terminal = record.status == DefaultProcessStatus.Cured || record.status == DefaultProcessStatus.Resolved
            || record.status == DefaultProcessStatus.TerminalResolved;
        bytes32 outcome = record.outcomeHash == bytes32(0) ? stateHash : record.outcomeHash;
        return _state(stateHash, outcome, terminal, record.status != DefaultProcessStatus.Unspecified);
    }
}

contract RiskReceiptAuthority is ReceiptAuthorityBase {
    IPortfolioRiskEngine public immutable source;

    constructor(bytes32 kind, IPortfolioRiskEngine source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        RiskAdmission memory record = source.getAdmission(RiskAdmissionId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(record));
        bool terminal = record.status == RiskAdmissionStatus.Consumed || record.status == RiskAdmissionStatus.Released;
        bytes32 outcome = record.resultHash == bytes32(0) ? stateHash : record.resultHash;
        return _state(stateHash, outcome, terminal, record.status != RiskAdmissionStatus.Unspecified);
    }
}

contract PrivacyReceiptAuthority is ReceiptAuthorityBase {
    IPrivacyCommitmentRegistry public immutable source;

    constructor(bytes32 kind, IPrivacyCommitmentRegistry source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        PrivacyEnvelopeCommitment memory record = source.getEnvelope(PrivacyEnvelopeId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(record));
        bool terminal =
            record.status == PrivacyEnvelopeStatus.Revealed || record.status == PrivacyEnvelopeStatus.Expired;
        bytes32 outcome = record.revealCommitment == bytes32(0) ? stateHash : record.revealCommitment;
        return _state(stateHash, outcome, terminal, record.status != PrivacyEnvelopeStatus.Unspecified);
    }
}

contract AsyncReceiptAuthority is ReceiptAuthorityBase {
    IOperationalAdapterExecutor public immutable source;

    constructor(bytes32 kind, IOperationalAdapterExecutor source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        ExternalActionRecord memory record = source.getExternalAction(subjectId);
        bytes32 stateHash = keccak256(abi.encode(record));
        bool terminal = record.state == OperationalActionState.Complete
            || record.state == OperationalActionState.Recovered || record.state == OperationalActionState.NoEffect;
        bytes32 outcome = record.resultHash == bytes32(0) ? stateHash : record.resultHash;
        return _state(stateHash, outcome, terminal, record.state != OperationalActionState.Unspecified);
    }
}

contract RouteReceiptAuthority is ReceiptAuthorityBase {
    ICollateralAwareRouteEngine public immutable source;

    constructor(bytes32 kind, ICollateralAwareRouteEngine source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        RouteReservation memory record = source.getReservation(RouteId.wrap(subjectId));
        bytes32 stateHash = keccak256(abi.encode(record));
        bool terminal = record.status == RouteStatus.Settled || record.status == RouteStatus.Invalidated
            || record.status == RouteStatus.Expired;
        return _state(stateHash, stateHash, terminal, record.status != RouteStatus.Unspecified);
    }
}

contract FeeReceiptAuthority is ReceiptAuthorityBase {
    IFundedFeeEngine public immutable source;

    constructor(bytes32 kind, IFundedFeeEngine source_) ReceiptAuthorityBase(kind, address(source_)) {
        source = source_;
    }

    function receiptSubjectTerminalState(bytes32 kind, bytes32 subjectId)
        external
        view
        returns (ReceiptSubjectTerminalState memory)
    {
        _requireKind(kind);
        bool consumed = source.feeActionConsumed(subjectId);
        bytes32 stateHash = keccak256(abi.encode(subjectId, consumed));
        return _state(stateHash, stateHash, consumed, consumed);
    }
}
