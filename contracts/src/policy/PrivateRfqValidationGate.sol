// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IExecutionPolicyRegistry} from "../interfaces/IExecutionPolicyRegistry.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPackageWitnessRegistry} from "../interfaces/IPackageWitnessRegistry.sol";
import {IPrivateRfqValidationGate} from "../interfaces/IPrivateRfqValidationGate.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ITradingSessionPolicy} from "../interfaces/ITradingSessionPolicy.sol";
import {ExecutionPolicyLib} from "../libraries/ExecutionPolicyLib.sol";
import {PolicyGateBase} from "./PolicyGateBase.sol";
import {AccountId, AssetId, FeeScheduleId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {OrderTargetKind, RemainderPolicy} from "../types/OrderTypes.sol";
import {PackageLeg} from "../types/PackageDefinition.sol";
import {
    MakerQuote,
    PrivateRfqRequest,
    RfqSelectionAuthorization,
    RfqSidePolicy,
    RfqTargetKind
} from "../types/RfqTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

contract PrivateRfqValidationGate is IPrivateRfqValidationGate, PolicyGateBase {
    bytes32 public constant PRIVACY_MODE_POLICY = keccak256("SETRYN_POLICY_PRIVACY_MODE");
    bytes32 public constant DISCLOSURE_POLICY = keccak256("SETRYN_POLICY_DISCLOSURE");

    error InvalidRfqPolicy();

    constructor(
        ISeriesRegistry seriesRegistry_,
        IPackageRegistry packageRegistry_,
        IExecutionPolicyRegistry policyRegistry_,
        ITradingSessionPolicy sessionPolicy_,
        IPackageWitnessRegistry packageWitnessRegistry_
    ) PolicyGateBase(seriesRegistry_, packageRegistry_, policyRegistry_, sessionPolicy_, packageWitnessRegistry_) {}

    function validateRequest(PrivateRfqRequest calldata request, PackageLeg[] calldata packageLegs) external view {
        _validateRequest(request, packageLegs);
    }

    function validateQuote(
        PrivateRfqRequest calldata request,
        MakerQuote calldata quote,
        bytes32[] calldata eligibleMakerProof
    ) external view {
        if (
            quote.maker == address(0) || quote.deadline > request.deadline || quote.capacityExpiry < quote.deadline
                || quote.maximumLiability == 0 || quote.maxFeeMinor > request.maxFeeMinor
                || quote.privacyModeId != request.privacyModeId
                || quote.disclosurePolicyHash != request.disclosurePolicyHash
                || quote.eligibleMakerSetHash != request.eligibleMakerSetHash
                || quote.executionModeId != request.executionModeId || quote.targetKind != request.targetKind
                || SeriesId.unwrap(quote.seriesId) != SeriesId.unwrap(request.seriesId)
                || PackageId.unwrap(quote.packageId) != PackageId.unwrap(request.packageId)
                || quote.targetVersion != request.targetVersion || quote.packageLegsHash != request.packageLegsHash
                || FeeScheduleId.unwrap(quote.feeScheduleId) != FeeScheduleId.unwrap(request.feeScheduleId)
                || quote.feeScheduleVersion != request.feeScheduleVersion
                || RiskDomainId.unwrap(quote.riskDomainId) != RiskDomainId.unwrap(request.riskDomainId)
                || quote.riskDomainVersion != request.riskDomainVersion
                || AccountId.unwrap(quote.takerAccountId) != AccountId.unwrap(request.takerAccountId)
                || block.timestamp > quote.deadline
                || !policyRegistry.eligible(request.eligibleMakerSetHash, quote.maker, eligibleMakerProof)
        ) revert InvalidRfqPolicy();
        PackageLeg[] memory legs = _legs(request, new PackageLeg[](0));
        ExecutionPolicyLib.ResolvedTarget memory resolved = _validateTarget(
            request, legs, quote.sidePolicy == RfqSidePolicy.BuyOnly ? quote.bidPriceTicks : quote.askPriceTicks, true
        );
        if (
            RiskDomainId.unwrap(resolved.riskDomainId) != RiskDomainId.unwrap(quote.riskDomainId)
                || resolved.riskDomainVersion != quote.riskDomainVersion
                || AssetId.unwrap(quote.collateralAssetId)
                    != AssetId.unwrap(
                        marketRegistry.riskDomainRegistry().getRiskDomain(quote.riskDomainId, quote.riskDomainVersion)
                            .definition.collateralAssetId
                    )
                || quote.collateralBindingVersion
                    != marketRegistry.riskDomainRegistry().getRiskDomain(quote.riskDomainId, quote.riskDomainVersion)
                        .definition.collateralAssetVersion
        ) revert InvalidRfqPolicy();
    }

    function validateSelection(
        PrivateRfqRequest calldata request,
        MakerQuote calldata quote,
        RfqSelectionAuthorization calldata selection
    ) external view {
        if (
            selection.taker != request.taker || selection.executor != request.permittedExecutor
                || selection.deadline > request.deadline || block.timestamp > selection.deadline
                || quote.deadline < selection.deadline
                || AccountId.unwrap(quote.takerAccountId) != AccountId.unwrap(request.takerAccountId)
        ) revert InvalidRfqPolicy();
        _validatePolicyTags(request);
    }

    function validateHandoff(
        PrivateRfqRequest calldata request,
        MakerQuote calldata quote,
        address clearingEngine,
        Lots fillLots,
        uint128 liabilityAmount
    ) external view {
        if (
            clearingEngine == address(0) || request.permittedExecutor != clearingEngine
                || block.timestamp > quote.deadline || Lots.unwrap(fillLots) == 0
                || Lots.unwrap(fillLots) > Lots.unwrap(quote.lots) || liabilityAmount == 0
                || liabilityAmount > quote.maximumLiability
                || RiskDomainId.unwrap(quote.riskDomainId) != RiskDomainId.unwrap(request.riskDomainId)
                || quote.riskDomainVersion != request.riskDomainVersion
        ) revert InvalidRfqPolicy();
        PackageLeg[] memory legs = _legs(request, new PackageLeg[](0));
        _validateTarget(
            request, legs, quote.sidePolicy == RfqSidePolicy.BuyOnly ? quote.bidPriceTicks : quote.askPriceTicks, true
        );
    }

    function _validateRequest(PrivateRfqRequest calldata request, PackageLeg[] calldata suppliedLegs) private view {
        if (
            block.timestamp > request.deadline || request.maxFeeMinor == 0 || request.permittedExecutor == address(0)
                || request.sidePolicy == RfqSidePolicy.Unspecified
                || request.remainderPolicy == RemainderPolicy.Unspecified
        ) revert InvalidRfqPolicy();
        _validatePolicyTags(request);
        PackageLeg[] memory legs = _legs(request, suppliedLegs);
        ExecutionPolicyLib.ResolvedTarget memory resolved = _validateTarget(request, legs, PriceTicks.wrap(0), false);
        if (
            RiskDomainId.unwrap(resolved.riskDomainId) != RiskDomainId.unwrap(request.riskDomainId)
                || resolved.riskDomainVersion != request.riskDomainVersion
        ) {
            revert InvalidRfqPolicy();
        }
    }

    function _validateTarget(
        PrivateRfqRequest calldata request,
        PackageLeg[] memory legs,
        PriceTicks price,
        bool validatePrice
    ) private view returns (ExecutionPolicyLib.ResolvedTarget memory) {
        return ExecutionPolicyLib.validateTarget(
            _dependencies(),
            _targetKind(request.targetKind),
            request.seriesId,
            request.packageId,
            request.targetVersion,
            legs,
            request.feeScheduleId,
            request.feeScheduleVersion,
            request.executionModeId,
            request.lots,
            price,
            validatePrice
        );
    }

    function _legs(PrivateRfqRequest calldata request, PackageLeg[] memory supplied)
        private
        view
        returns (PackageLeg[] memory legs)
    {
        if (request.targetKind == RfqTargetKind.Series) {
            if (supplied.length != 0 || request.hasPackageLegCommitment || request.packageLegsHash != bytes32(0)) {
                revert InvalidRfqPolicy();
            }
            return supplied;
        }
        if (request.targetKind != RfqTargetKind.Package || !request.hasPackageLegCommitment) {
            revert InvalidRfqPolicy();
        }
        legs =
            supplied.length == 0 ? packageWitnessRegistry.getLegs(request.packageId, request.targetVersion) : supplied;
        if (packageRegistry.hashLegs(legs) != request.packageLegsHash) revert InvalidRfqPolicy();
    }

    function _validatePolicyTags(PrivateRfqRequest calldata request) private view {
        if (
            !policyRegistry.policyTagAllowed(PRIVACY_MODE_POLICY, request.privacyModeId)
                || !policyRegistry.policyTagAllowed(DISCLOSURE_POLICY, request.disclosurePolicyHash)
        ) revert InvalidRfqPolicy();
    }

    function _targetKind(RfqTargetKind kind) private pure returns (OrderTargetKind) {
        if (kind == RfqTargetKind.Series) return OrderTargetKind.Series;
        if (kind == RfqTargetKind.Package) return OrderTargetKind.Package;
        revert InvalidRfqPolicy();
    }
}
