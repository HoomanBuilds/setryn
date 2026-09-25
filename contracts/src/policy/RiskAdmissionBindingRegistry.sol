// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IRiskAdmissionBindingRegistry} from "../interfaces/IRiskAdmissionBindingRegistry.sol";
import {OrderHashLib} from "../libraries/OrderHashLib.sol";
import {AccountId, RiskDomainId} from "../types/Identifiers.sol";
import {PublicOrder} from "../types/OrderTypes.sol";
import {RiskAdmission, RiskAdmissionId, RiskAdmissionStatus} from "../types/RiskTypes.sol";

contract RiskAdmissionBindingRegistry is IRiskAdmissionBindingRegistry {
    IPortfolioRiskEngine public immutable riskEngine;
    address public immutable orderVerifyingContract;

    mapping(bytes32 orderHash => RiskAdmissionId admissionId) private _orderAdmissions;
    mapping(RiskAdmissionId admissionId => bytes32 orderHash) private _admissionOrders;

    error ZeroDependency();
    error InvalidRiskBinding();
    error DuplicateRiskBinding();

    event OrderRiskBound(
        bytes32 indexed orderHash, RiskAdmissionId indexed admissionId, bytes32 indexed accountId, address signer
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
        if (admission.status != RiskAdmissionStatus.Reserved || admission.accountId != order.accountId) {
            revert InvalidRiskBinding();
        }
        _orderAdmissions[orderHash] = admissionId;
        _admissionOrders[admissionId] = orderHash;
        emit OrderRiskBound(orderHash, admissionId, AccountId.unwrap(order.accountId), order.signer);
    }

    function admissionForOrder(bytes32 orderHash) external view returns (RiskAdmissionId admissionId) {
        return _orderAdmissions[orderHash];
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
            && admission.openInterestBaseUnits != 0 && admission.terminalLiabilityBaseUnits != 0;
    }
}
