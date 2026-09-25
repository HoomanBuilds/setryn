// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {DefaultProcessId} from "../types/DefaultTypes.sol";
import {AccountId, RiskDomainId} from "../types/Identifiers.sol";

interface IDefaultBidderGate {
    function isQualified(
        DefaultProcessId processId,
        address bidder,
        AccountId bidderAccountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        bytes32 qualificationPolicyHash,
        bytes32 eligibilityEvidenceHash
    ) external view returns (bool);
}
