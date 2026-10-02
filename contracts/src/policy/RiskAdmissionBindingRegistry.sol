// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IRiskAdmissionBindingRegistry} from "../interfaces/IRiskAdmissionBindingRegistry.sol";
import {Eip712Lib} from "../libraries/Eip712Lib.sol";
import {OrderHashLib} from "../libraries/OrderHashLib.sol";
import {AccountId, RiskDomainId} from "../types/Identifiers.sol";
import {PublicOrder} from "../types/OrderTypes.sol";
import {
    OrderRiskAuthorization,
    RiskAdmission,
    RiskAdmissionCancellation,
    RiskAdmissionId,
    RiskAdmissionStatus
} from "../types/RiskTypes.sol";

contract RiskAdmissionBindingRegistry is IRiskAdmissionBindingRegistry {
    bytes32 private constant CANCELLATION_TYPEHASH = keccak256(
        "SetrynRiskAdmissionCancellationV1(bytes32 admissionId,bytes32 orderHash,bytes32 accountId,address signer,uint256 nonce,uint64 deadline,bytes32 cancellationReference)"
    );

    /// @dev The typestring is the canonical EIP-712 encoding of OrderRiskAuthorization; clients sign exactly this.
    bytes32 private constant ORDER_RISK_AUTHORIZATION_TYPEHASH = keccak256(
        "SetrynOrderRiskAuthorizationV1(bytes32 orderHash,bytes32 accountId,bytes32 riskDomainId,uint32 riskDomainVersion,uint128 maxOpenInterestBaseUnits,uint128 maxTerminalLiabilityBaseUnits,uint64 maxAdmissionDeadline,address binder,bytes32 binderTerms,uint256 nonce,uint64 deadline)"
    );

    IPortfolioRiskEngine public immutable riskEngine;
    address public immutable bindingAuthority;
    address public orderVerifyingContract;

    mapping(bytes32 orderHash => RiskAdmissionId admissionId) private _orderAdmissions;
    mapping(RiskAdmissionId admissionId => bytes32 orderHash) private _admissionOrders;
    mapping(RiskAdmissionId admissionId => address signer) private _admissionSigners;
    mapping(address signer => mapping(uint256 nonce => bool used)) private _usedCancellationNonces;
    mapping(address signer => mapping(uint256 nonce => bool used)) private _usedAuthorizationNonces;

    error ZeroDependency();
    error InvalidRiskBinding();
    error DuplicateRiskBinding();
    error InvalidCancellation();
    error UnauthorizedBindingAuthority();
    error OrderVerifyingContractAlreadyBound();
    error InvalidRiskAuthorization();
    error RiskAuthorizationNonceUsed(address signer, uint256 nonce);

    event OrderRiskBound(
        bytes32 indexed orderHash, RiskAdmissionId indexed admissionId, bytes32 indexed accountId, address signer
    );
    event BoundRiskCancelled(
        bytes32 indexed orderHash,
        RiskAdmissionId indexed admissionId,
        address indexed signer,
        bytes32 cancellationReference
    );
    event OrderVerifyingContractBound(address indexed verifyingContract);
    event OrderRiskAuthorizationUsed(
        bytes32 indexed orderHash,
        address indexed signer,
        uint256 indexed nonce,
        RiskAdmissionId admissionId,
        address binder,
        bytes32 binderTerms
    );
    event RiskAuthorizationNonceInvalidated(address indexed signer, uint256 indexed nonce);

    constructor(IPortfolioRiskEngine riskEngine_, address orderVerifyingContract_) {
        if (address(riskEngine_) == address(0) || address(riskEngine_).code.length == 0) revert ZeroDependency();
        riskEngine = riskEngine_;
        bindingAuthority = msg.sender;
        orderVerifyingContract = orderVerifyingContract_;
    }

    function bindOrderVerifyingContract(address verifyingContract) external {
        if (msg.sender != bindingAuthority) revert UnauthorizedBindingAuthority();
        if (orderVerifyingContract != address(0)) revert OrderVerifyingContractAlreadyBound();
        if (verifyingContract == address(0) || verifyingContract.code.length == 0) revert ZeroDependency();
        orderVerifyingContract = verifyingContract;
        emit OrderVerifyingContractBound(verifyingContract);
    }

    function bindOrderRisk(PublicOrder calldata order, RiskAdmissionId admissionId)
        external
        returns (bytes32 orderHash)
    {
        if (orderVerifyingContract == address(0)) revert ZeroDependency();
        if (msg.sender != order.signer || RiskAdmissionId.unwrap(admissionId) == bytes32(0)) {
            revert InvalidRiskBinding();
        }
        orderHash = OrderHashLib.digest(order, block.chainid, orderVerifyingContract);
        _requireUnbound(orderHash, admissionId);
        RiskAdmission memory admission = riskEngine.getAdmission(admissionId);
        if (
            admission.status != RiskAdmissionStatus.Reserved
                || AccountId.unwrap(admission.accountId) != AccountId.unwrap(order.accountId)
                || admission.deadline < block.timestamp || admission.reservedResultCommitment == bytes32(0)
        ) {
            revert InvalidRiskBinding();
        }
        _bind(orderHash, admissionId, order);
    }

    /// @notice Binds a reserved admission to an order on the strength of the order signer's EIP-712 authorization
    /// instead of a transaction from the signer. Every check of `bindOrderRisk` still applies, and the admission must
    /// also match the authorization exactly in account and risk domain and stay within its open-interest, liability and
    /// deadline bounds. The authorization is single use per signer nonce, expires at its deadline, names one exact
    /// order hash, and is valid only under this registry's domain on this chain; `binder`, when set, is the only
    /// address that may submit it.
    function bindOrderRiskWithAuthorization(
        PublicOrder calldata order,
        RiskAdmissionId admissionId,
        OrderRiskAuthorization calldata authorization,
        bytes calldata signature
    ) external returns (bytes32 orderHash) {
        if (orderVerifyingContract == address(0)) revert ZeroDependency();
        if (RiskAdmissionId.unwrap(admissionId) == bytes32(0)) revert InvalidRiskBinding();
        orderHash = OrderHashLib.digest(order, block.chainid, orderVerifyingContract);
        if (
            authorization.orderHash != orderHash
                || AccountId.unwrap(authorization.accountId) != AccountId.unwrap(order.accountId)
                || (authorization.binder != address(0) && authorization.binder != msg.sender)
                || authorization.deadline < block.timestamp
        ) revert InvalidRiskAuthorization();
        if (_usedAuthorizationNonces[order.signer][authorization.nonce]) {
            revert RiskAuthorizationNonceUsed(order.signer, authorization.nonce);
        }
        _requireUnbound(orderHash, admissionId);
        RiskAdmission memory admission = riskEngine.getAdmission(admissionId);
        if (
            admission.status != RiskAdmissionStatus.Reserved
                || AccountId.unwrap(admission.accountId) != AccountId.unwrap(order.accountId)
                || admission.deadline < block.timestamp || admission.reservedResultCommitment == bytes32(0)
                || RiskDomainId.unwrap(admission.riskDomainId) != RiskDomainId.unwrap(authorization.riskDomainId)
                || admission.riskDomainVersion != authorization.riskDomainVersion
                || admission.openInterestBaseUnits == 0
                || admission.openInterestBaseUnits > authorization.maxOpenInterestBaseUnits
                || admission.terminalLiabilityBaseUnits > authorization.maxTerminalLiabilityBaseUnits
                || admission.deadline > authorization.maxAdmissionDeadline
        ) revert InvalidRiskAuthorization();
        if (!SignatureChecker.isValidSignatureNowCalldata(order.signer, _authorizationDigest(authorization), signature))
        {
            revert InvalidRiskAuthorization();
        }
        _usedAuthorizationNonces[order.signer][authorization.nonce] = true;
        _bind(orderHash, admissionId, order);
        emit OrderRiskAuthorizationUsed(
            orderHash, order.signer, authorization.nonce, admissionId, authorization.binder, authorization.binderTerms
        );
    }

    /// @notice Retires one of the caller's authorization nonces, so an authorization it signed but no longer wants used
    /// can never bind.
    function invalidateAuthorizationNonce(uint256 nonce) external {
        if (_usedAuthorizationNonces[msg.sender][nonce]) revert RiskAuthorizationNonceUsed(msg.sender, nonce);
        _usedAuthorizationNonces[msg.sender][nonce] = true;
        emit RiskAuthorizationNonceInvalidated(msg.sender, nonce);
    }

    function authorizationNonceUsed(address signer, uint256 nonce) external view returns (bool) {
        return _usedAuthorizationNonces[signer][nonce];
    }

    /// @notice The EIP-712 digest a signer signs for `authorization` under this registry's domain.
    function hashOrderRiskAuthorization(OrderRiskAuthorization calldata authorization)
        external
        view
        returns (bytes32 digest)
    {
        return _authorizationDigest(authorization);
    }

    function admissionForOrder(bytes32 orderHash) external view returns (RiskAdmissionId admissionId) {
        return _orderAdmissions[orderHash];
    }

    function admissionBinding(bytes32 orderHash)
        external
        view
        returns (RiskAdmissionId admissionId, bytes32 resultHash)
    {
        admissionId = _orderAdmissions[orderHash];
        if (RiskAdmissionId.unwrap(admissionId) == bytes32(0)) return (admissionId, bytes32(0));
        resultHash = riskEngine.getAdmission(admissionId).reservedResultCommitment;
    }

    function cancelBoundAdmission(RiskAdmissionCancellation calldata cancellation, bytes calldata signature) external {
        RiskAdmissionId admissionId = cancellation.admissionId;
        if (
            RiskAdmissionId.unwrap(admissionId) == bytes32(0) || cancellation.cancellationReference == bytes32(0)
                || cancellation.deadline < block.timestamp || cancellation.signer == address(0)
                || _admissionOrders[admissionId] != cancellation.orderHash
                || RiskAdmissionId.unwrap(_orderAdmissions[cancellation.orderHash])
                    != RiskAdmissionId.unwrap(admissionId) || _admissionSigners[admissionId] != cancellation.signer
                || _usedCancellationNonces[cancellation.signer][cancellation.nonce]
        ) revert InvalidCancellation();
        RiskAdmission memory admission = riskEngine.getAdmission(admissionId);
        if (
            admission.status != RiskAdmissionStatus.Reserved
                || AccountId.unwrap(admission.accountId) != AccountId.unwrap(cancellation.accountId)
        ) {
            revert InvalidCancellation();
        }
        bytes32 structHash = keccak256(
            abi.encode(
                CANCELLATION_TYPEHASH,
                RiskAdmissionId.unwrap(admissionId),
                cancellation.orderHash,
                AccountId.unwrap(cancellation.accountId),
                cancellation.signer,
                cancellation.nonce,
                cancellation.deadline,
                cancellation.cancellationReference
            )
        );
        bytes32 digest =
            Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(block.chainid, address(this)), structHash);
        if (!SignatureChecker.isValidSignatureNowCalldata(cancellation.signer, digest, signature)) {
            revert InvalidCancellation();
        }
        _usedCancellationNonces[cancellation.signer][cancellation.nonce] = true;
        riskEngine.releaseAdmission(admissionId, cancellation.cancellationReference);
        emit BoundRiskCancelled(
            cancellation.orderHash, admissionId, cancellation.signer, cancellation.cancellationReference
        );
    }

    function isLiveBinding(bytes32 orderHash, PublicOrder calldata order, RiskDomainId riskDomainId, uint32 riskVersion)
        external
        view
        returns (bool)
    {
        RiskAdmissionId admissionId = _orderAdmissions[orderHash];
        if (RiskAdmissionId.unwrap(admissionId) == bytes32(0)) return false;
        RiskAdmission memory admission = riskEngine.getAdmission(admissionId);
        return admission.status == RiskAdmissionStatus.Reserved
            && AccountId.unwrap(admission.accountId) == AccountId.unwrap(order.accountId)
            && RiskDomainId.unwrap(admission.riskDomainId) == RiskDomainId.unwrap(riskDomainId)
            && admission.riskDomainVersion == riskVersion && admission.openInterestBaseUnits != 0
            && admission.deadline >= block.timestamp && admission.reservedResultCommitment != bytes32(0);
    }

    function _requireUnbound(bytes32 orderHash, RiskAdmissionId admissionId) private view {
        if (
            RiskAdmissionId.unwrap(_orderAdmissions[orderHash]) != bytes32(0)
                || _admissionOrders[admissionId] != bytes32(0)
        ) revert DuplicateRiskBinding();
    }

    function _bind(bytes32 orderHash, RiskAdmissionId admissionId, PublicOrder calldata order) private {
        _orderAdmissions[orderHash] = admissionId;
        _admissionOrders[admissionId] = orderHash;
        _admissionSigners[admissionId] = order.signer;
        emit OrderRiskBound(orderHash, admissionId, AccountId.unwrap(order.accountId), order.signer);
    }

    function _authorizationDigest(OrderRiskAuthorization calldata authorization) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_RISK_AUTHORIZATION_TYPEHASH,
                authorization.orderHash,
                AccountId.unwrap(authorization.accountId),
                RiskDomainId.unwrap(authorization.riskDomainId),
                authorization.riskDomainVersion,
                authorization.maxOpenInterestBaseUnits,
                authorization.maxTerminalLiabilityBaseUnits,
                authorization.maxAdmissionDeadline,
                authorization.binder,
                authorization.binderTerms,
                authorization.nonce,
                authorization.deadline
            )
        );
        return Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(block.chainid, address(this)), structHash);
    }
}
