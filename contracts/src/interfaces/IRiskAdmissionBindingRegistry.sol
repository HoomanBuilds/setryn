// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPortfolioRiskEngine} from "./IPortfolioRiskEngine.sol";
import {RiskDomainId} from "../types/Identifiers.sol";
import {PublicOrder} from "../types/OrderTypes.sol";
import {RiskAdmissionCancellation, RiskAdmissionId} from "../types/RiskTypes.sol";

interface IRiskAdmissionBindingRegistry {
    function bindOrderRisk(PublicOrder calldata order, RiskAdmissionId admissionId) external returns (bytes32 orderHash);
    function admissionForOrder(bytes32 orderHash) external view returns (RiskAdmissionId admissionId);
    function admissionBinding(bytes32 orderHash) external view returns (RiskAdmissionId admissionId, bytes32 resultHash);
    function cancelBoundAdmission(RiskAdmissionCancellation calldata cancellation, bytes calldata signature) external;
    function isLiveBinding(bytes32 orderHash, PublicOrder calldata order, RiskDomainId riskDomainId, uint32 riskVersion)
        external
        view
        returns (bool);
    function riskEngine() external view returns (IPortfolioRiskEngine);
}
