// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPortfolioRiskEngine} from "./IPortfolioRiskEngine.sol";
import {RiskDomainId} from "../types/Identifiers.sol";
import {PublicOrder} from "../types/OrderTypes.sol";
import {OrderRiskAuthorization, RiskAdmissionCancellation, RiskAdmissionId} from "../types/RiskTypes.sol";

interface IRiskAdmissionBindingRegistry {
    function bindOrderVerifyingContract(address verifyingContract) external;
    function orderVerifyingContract() external view returns (address);
    function bindOrderRisk(PublicOrder calldata order, RiskAdmissionId admissionId) external returns (bytes32 orderHash);
    function bindOrderRiskWithAuthorization(
        PublicOrder calldata order,
        RiskAdmissionId admissionId,
        OrderRiskAuthorization calldata authorization,
        bytes calldata signature
    ) external returns (bytes32 orderHash);
    function invalidateAuthorizationNonce(uint256 nonce) external;
    function authorizationNonceUsed(address signer, uint256 nonce) external view returns (bool);
    function hashOrderRiskAuthorization(OrderRiskAuthorization calldata authorization)
        external
        view
        returns (bytes32 digest);
    function admissionForOrder(bytes32 orderHash) external view returns (RiskAdmissionId admissionId);
    function admissionBinding(bytes32 orderHash) external view returns (RiskAdmissionId admissionId, bytes32 resultHash);
    function cancelBoundAdmission(RiskAdmissionCancellation calldata cancellation, bytes calldata signature) external;
    function isLiveBinding(bytes32 orderHash, PublicOrder calldata order, RiskDomainId riskDomainId, uint32 riskVersion)
        external
        view
        returns (bool);
    function riskEngine() external view returns (IPortfolioRiskEngine);
}
