// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IDefaultBidderGate} from "../interfaces/IDefaultBidderGate.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {DefaultProcessId} from "../types/DefaultTypes.sol";
import {AccountId, CollateralId, RiskDomainId} from "../types/Identifiers.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";

contract DefaultBidderGate is IDefaultBidderGate {
    bytes32 public constant ELIGIBILITY_TYPEHASH = keccak256(
        "SetrynDefaultBidderEligibilityV1(bytes32 processId,address bidder,bytes32 bidderAccountId,bytes32 riskDomainId,uint32 riskDomainVersion,bytes32 riskDomainVersionHash,bytes32 collateralId,uint64 operatorEpoch,bytes32 qualificationPolicyHash)"
    );

    IRiskDomainRegistry public immutable riskDomainRegistry;
    ICollateralVault public immutable collateralVault;

    error ZeroDependency();
    error DependencyHasNoCode();

    constructor(IRiskDomainRegistry riskDomainRegistry_, ICollateralVault collateralVault_) {
        if (address(riskDomainRegistry_) == address(0) || address(collateralVault_) == address(0)) {
            revert ZeroDependency();
        }
        if (address(riskDomainRegistry_).code.length == 0 || address(collateralVault_).code.length == 0) {
            revert DependencyHasNoCode();
        }
        riskDomainRegistry = riskDomainRegistry_;
        collateralVault = collateralVault_;
    }

    function isQualified(
        DefaultProcessId processId,
        address bidder,
        AccountId bidderAccountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        bytes32 qualificationPolicyHash,
        bytes32 eligibilityEvidenceHash
    ) external view returns (bool) {
        if (
            DefaultProcessId.unwrap(processId) == bytes32(0) || bidder == address(0)
                || AccountId.unwrap(bidderAccountId) == bytes32(0) || qualificationPolicyHash == bytes32(0)
                || !riskDomainRegistry.isLifecycleEnabled(riskDomainId, riskDomainVersion)
        ) return false;
        (address controller,) = collateralVault.getAccount(bidderAccountId);
        if (controller != bidder) return false;
        RiskDomainVersion memory domain = riskDomainRegistry.getRiskDomain(riskDomainId, riskDomainVersion);
        CollateralId collateralId = collateralVault.deriveCollateralId(
            domain.definition.collateralAssetId, domain.definition.collateralAssetVersion
        );
        (uint128 total,,) = collateralVault.balanceOf(bidderAccountId, collateralId);
        if (total == 0) return false;
        bytes32 expected = keccak256(
            abi.encode(
                ELIGIBILITY_TYPEHASH,
                processId,
                bidder,
                bidderAccountId,
                riskDomainId,
                riskDomainVersion,
                domain.versionHash,
                collateralId,
                collateralVault.lockOperatorEpoch(bidderAccountId),
                qualificationPolicyHash
            )
        );
        return expected == eligibilityEvidenceHash;
    }

    function deriveEligibilityEvidenceHash(
        DefaultProcessId processId,
        address bidder,
        AccountId bidderAccountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion,
        bytes32 qualificationPolicyHash
    ) external view returns (bytes32) {
        RiskDomainVersion memory domain = riskDomainRegistry.getRiskDomain(riskDomainId, riskDomainVersion);
        CollateralId collateralId = collateralVault.deriveCollateralId(
            domain.definition.collateralAssetId, domain.definition.collateralAssetVersion
        );
        return keccak256(
            abi.encode(
                ELIGIBILITY_TYPEHASH,
                processId,
                bidder,
                bidderAccountId,
                riskDomainId,
                riskDomainVersion,
                domain.versionHash,
                collateralId,
                collateralVault.lockOperatorEpoch(bidderAccountId),
                qualificationPolicyHash
            )
        );
    }
}
