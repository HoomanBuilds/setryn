// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IClearingAdmissionGate} from "../interfaces/IClearingAdmissionGate.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {IExecutionPolicyRegistry} from "../interfaces/IExecutionPolicyRegistry.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPackageWitnessRegistry} from "../interfaces/IPackageWitnessRegistry.sol";
import {IRiskAdmissionBindingRegistry} from "../interfaces/IRiskAdmissionBindingRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ITradingSessionPolicy} from "../interfaces/ITradingSessionPolicy.sol";
import {PolicyGateBase} from "./PolicyGateBase.sol";
import {ExecutionPolicyLib} from "../libraries/ExecutionPolicyLib.sol";
import {ClearingAdmission} from "../types/ClearingTypes.sol";
import {Side} from "../types/Enums.sol";
import {AccountId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {OrderTargetKind, PublicOrder} from "../types/OrderTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";
import {RiskAdmission, RiskAdmissionId, RiskAdmissionStatus} from "../types/RiskTypes.sol";

contract ClearingAdmissionGate is IClearingAdmissionGate, PolicyGateBase {
    IRiskAdmissionBindingRegistry public immutable riskBindings;

    error InvalidClearingAdmission();

    constructor(
        ISeriesRegistry seriesRegistry_,
        IPackageRegistry packageRegistry_,
        IExecutionPolicyRegistry policyRegistry_,
        ITradingSessionPolicy sessionPolicy_,
        IPackageWitnessRegistry packageWitnessRegistry_,
        IRiskAdmissionBindingRegistry riskBindings_
    ) PolicyGateBase(seriesRegistry_, packageRegistry_, policyRegistry_, sessionPolicy_, packageWitnessRegistry_) {
        if (address(riskBindings_) == address(0) || address(riskBindings_).code.length == 0) {
            revert ZeroPolicyDependency(address(riskBindings_));
        }
        riskBindings = riskBindings_;
    }

    function validateMatch(
        PublicOrder calldata takerOrder,
        PublicOrder calldata makerOrder,
        ClearingAdmission calldata admission
    ) external view {
        bool opposite = (takerOrder.side == Side.Buy && makerOrder.side == Side.Sell)
            || (takerOrder.side == Side.Sell && makerOrder.side == Side.Buy);
        if (
            admission.takerOrderHash == bytes32(0) || admission.makerOrderHash == bytes32(0)
                || admission.witnessHash == bytes32(0) || admission.submitter == address(0)
                || admission.executionModeId == bytes32(0) || !opposite
                || takerOrder.targetKind != makerOrder.targetKind
                || takerOrder.targetVersion != makerOrder.targetVersion
                || takerOrder.executionModeId != makerOrder.executionModeId
                || takerOrder.executionModeId != admission.executionModeId
                || takerOrder.feeScheduleId != makerOrder.feeScheduleId
                || takerOrder.feeScheduleVersion != makerOrder.feeScheduleVersion
                || Lots.unwrap(admission.fillLots) == 0 || block.timestamp > takerOrder.deadline
                || block.timestamp > makerOrder.deadline || takerOrder.reduceOnly || makerOrder.reduceOnly
        ) revert InvalidClearingAdmission();
        if (
            takerOrder.side == Side.Buy
                && (PriceTicks.unwrap(admission.executionPriceTicks) > PriceTicks.unwrap(takerOrder.priceTicks)
                    || PriceTicks.unwrap(admission.executionPriceTicks) < PriceTicks.unwrap(makerOrder.priceTicks))
        ) revert InvalidClearingAdmission();
        if (
            takerOrder.side == Side.Sell
                && (PriceTicks.unwrap(admission.executionPriceTicks) < PriceTicks.unwrap(takerOrder.priceTicks)
                    || PriceTicks.unwrap(admission.executionPriceTicks) > PriceTicks.unwrap(makerOrder.priceTicks))
        ) revert InvalidClearingAdmission();
        if (admission.isPackage) {
            if (
                takerOrder.targetKind != OrderTargetKind.Package || takerOrder.packageId != makerOrder.packageId
                    || admission.targetId != PackageId.unwrap(takerOrder.packageId)
            ) revert InvalidClearingAdmission();
        } else if (
            takerOrder.targetKind != OrderTargetKind.Series || takerOrder.seriesId != makerOrder.seriesId
                || admission.targetId != SeriesId.unwrap(takerOrder.seriesId)
        ) {
            revert InvalidClearingAdmission();
        }
        if (admission.targetVersion != takerOrder.targetVersion) revert InvalidClearingAdmission();
        ExecutionPolicyLib.ResolvedTarget memory resolved = _validateOrder(takerOrder);
        _validateOrder(makerOrder);
        bool takerLong = takerOrder.side == Side.Buy;
        RiskAdmissionId takerAdmissionId = takerLong ? admission.longAdmissionId : admission.shortAdmissionId;
        RiskAdmissionId makerAdmissionId = takerLong ? admission.shortAdmissionId : admission.longAdmissionId;
        bytes32 takerResultHash = takerLong ? admission.longAdmissionResultHash : admission.shortAdmissionResultHash;
        bytes32 makerResultHash = takerLong ? admission.shortAdmissionResultHash : admission.longAdmissionResultHash;
        (RiskAdmissionId boundTaker, bytes32 boundTakerResult) = riskBindings.admissionBinding(admission.takerOrderHash);
        (RiskAdmissionId boundMaker, bytes32 boundMakerResult) = riskBindings.admissionBinding(admission.makerOrderHash);
        if (
            RiskAdmissionId.unwrap(takerAdmissionId) == bytes32(0)
                || RiskAdmissionId.unwrap(makerAdmissionId) == bytes32(0) || takerResultHash == bytes32(0)
                || makerResultHash == bytes32(0) || boundTaker != takerAdmissionId || boundMaker != makerAdmissionId
                || boundTakerResult != takerResultHash || boundMakerResult != makerResultHash
                || !riskBindings.isLiveBinding(
                    admission.takerOrderHash, takerOrder, resolved.riskDomainId, resolved.riskDomainVersion
                )
                || !riskBindings.isLiveBinding(
                    admission.makerOrderHash, makerOrder, resolved.riskDomainId, resolved.riskDomainVersion
                )
        ) revert InvalidClearingAdmission();
        _requireAdmission(
            admission.longAdmissionId,
            admission.longAdmissionResultHash,
            takerLong ? takerOrder.accountId : makerOrder.accountId,
            resolved.riskDomainId,
            resolved.riskDomainVersion
        );
        _requireAdmission(
            admission.shortAdmissionId,
            admission.shortAdmissionResultHash,
            takerLong ? makerOrder.accountId : takerOrder.accountId,
            resolved.riskDomainId,
            resolved.riskDomainVersion
        );
    }

    function riskEngine() external view returns (IPortfolioRiskEngine) {
        return riskBindings.riskEngine();
    }

    function _requireAdmission(
        RiskAdmissionId admissionId,
        bytes32 resultHash,
        AccountId accountId,
        RiskDomainId riskDomainId,
        uint32 riskDomainVersion
    ) private view {
        RiskAdmission memory admission = riskBindings.riskEngine().getAdmission(admissionId);
        if (
            admission.status != RiskAdmissionStatus.Reserved || admission.accountId != accountId
                || admission.riskDomainId != riskDomainId || admission.riskDomainVersion != riskDomainVersion
                || admission.resultHash != resultHash || admission.reservedResultCommitment != resultHash
                || admission.deadline < block.timestamp
        ) revert InvalidClearingAdmission();
    }
}
