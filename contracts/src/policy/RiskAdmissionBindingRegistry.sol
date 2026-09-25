// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IRiskAdmissionBindingRegistry} from "../interfaces/IRiskAdmissionBindingRegistry.sol";
import {OrderHashLib} from "../libraries/OrderHashLib.sol";
import {AccountId, RiskDomainId} from "../types/Identifiers.sol";
import {PublicOrder} from "../types/OrderTypes.sol";
import {RiskAdmission, RiskAdmissionCancellation, RiskAdmissionId, RiskAdmissionStatus} from "../types/RiskTypes.sol";

contract RiskAdmissionBindingRegistry is IRiskAdmissionBindingRegistry {
    IPortfolioRiskEngine public immutable riskEngine;
    address public immutable orderVerifyingContract;

    mapping(bytes32 orderHash => RiskAdmissionId admissionId) private _orderAdmissions;
    mapping(RiskAdmissionId admissionId => bytes32 orderHash) private _admissionOrders;
    mapping(RiskAdmissionId admissionId => address signer) private _admissionSigners;
    mapping(address signer => mapping(uint256 nonce => bool used)) private _usedCancellationNonces;

    error ZeroDependency();
    error InvalidRiskBinding();
    error DuplicateRiskBinding();
    error InvalidCancellation();

    event OrderRiskBound(
        bytes32 indexed orderHash, RiskAdmissionId indexed admissionId, bytes32 indexed accountId, address signer
    );
    event BoundRiskCancelled(
        bytes32 indexed orderHash,
        RiskAdmissionId indexed admissionId,
        address indexed signer,
        bytes32 cancellationReference
    );

    constructor(IPortfolioRiskEngine riskEngine_, address orderVerifyingContract_) {
        if (
            address(riskEngine_) == address(0) || address(riskEngine_).code.length == 0
                || orderVerifyingContract_ == address(0)
        ) revert ZeroDependency();
        riskEngine = riskEngine_;
        orderVerifyingContract = orderVerifyingContract_;
    }

    function bindOrderRisk(PublicOrder calldata order, RiskAdmissionId admissionId)
        external
        returns (bytes32 orderHash)
    {
        if (msg.sender != order.signer || RiskAdmissionId.unwrap(admissionId) == bytes32(0)) {
            revert InvalidRiskBinding();
        }
        orderHash = OrderHashLib.digest(order, block.chainid, orderVerifyingContract);
        if (
            RiskAdmissionId.unwrap(_orderAdmissions[orderHash]) != bytes32(0)
                || _admissionOrders[admissionId] != bytes32(0)
        ) revert DuplicateRiskBinding();
        RiskAdmission memory admission = riskEngine.getAdmission(admissionId);
        if (
            admission.status != RiskAdmissionStatus.Reserved || admission.accountId != order.accountId
                || admission.deadline < block.timestamp || admission.reservedResultCommitment == bytes32(0)
        ) {
            revert InvalidRiskBinding();
        }
        _orderAdmissions[orderHash] = admissionId;
        _admissionOrders[admissionId] = orderHash;
        _admissionSigners[admissionId] = order.signer;
        emit OrderRiskBound(orderHash, admissionId, AccountId.unwrap(order.accountId), order.signer);
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
                || _orderAdmissions[cancellation.orderHash] != admissionId
                || _admissionSigners[admissionId] != cancellation.signer
                || _usedCancellationNonces[cancellation.signer][cancellation.nonce]
        ) revert InvalidCancellation();
        RiskAdmission memory admission = riskEngine.getAdmission(admissionId);
        if (admission.status != RiskAdmissionStatus.Reserved || admission.accountId != cancellation.accountId) {
            revert InvalidCancellation();
        }
        bytes32 digest = keccak256(
            abi.encode(
                keccak256(
                    "SetrynRiskAdmissionCancellationV1(bytes32 admissionId,bytes32 orderHash,bytes32 accountId,address signer,uint256 nonce,uint64 deadline,bytes32 cancellationReference,uint256 chainId,address registry)"
                ),
                RiskAdmissionId.unwrap(admissionId),
                cancellation.orderHash,
                AccountId.unwrap(cancellation.accountId),
                cancellation.signer,
                cancellation.nonce,
                cancellation.deadline,
                cancellation.cancellationReference,
                block.chainid,
                address(this)
            )
        );
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
        return admission.status == RiskAdmissionStatus.Reserved && admission.accountId == order.accountId
            && admission.riskDomainId == riskDomainId && admission.riskDomainVersion == riskVersion
            && admission.openInterestBaseUnits != 0 && admission.deadline >= block.timestamp
            && admission.reservedResultCommitment != bytes32(0);
    }
}
