// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {SeriesDefinitionLib} from "./SeriesDefinitionLib.sol";
import {AccountId, CollateralId, ExercisePolicyId, PositionId, SeriesId} from "../types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionKind,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecycleInput,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

library LifecycleMathLib {
    error InvalidLifecycleShape();
    error QuantityNotConserved();
    error MissingConsent(bytes32 accountId);
    error LiabilityToleranceExceeded(bytes32 accountId, uint256 beforeAmount, uint256 afterAmount, uint256 tolerance);
    error CollateralReplacementMismatch(bytes32 accountId);
    error PackageBreakNotAuthorized(bytes32 accountId);
    error ExerciseWindowClosed(bytes32 positionId, uint64 opensAt, uint64 closesAt, uint256 currentTimestamp);
    error ExerciseQuantityExceeded(bytes32 positionId, uint128 remaining, uint128 requested);
    error LapseNotAvailable(bytes32 positionId, uint64 lapseEligibleAt, uint256 currentTimestamp);

    function validate(
        LifecycleAction memory action,
        LifecycleInput[] memory requestedInputs,
        LifecyclePositionSnapshot[] memory inputs,
        LifecycleSuccessor[] memory successors,
        LifecycleCollateralReplacement[] memory replacements,
        LifecycleConsent[] memory consents,
        uint256 currentTimestamp
    ) internal pure {
        _validateShape(action.kind, inputs.length, successors.length);
        _validateSpecialWindows(action.kind, requestedInputs, inputs, currentTimestamp);
        _validateQuantities(action.kind, requestedInputs, inputs, successors);
        _validateAccounts(action, inputs, successors, replacements, consents);
        _validatePackageProvenance(action, requestedInputs, inputs, consents);
    }

    function _validateShape(LifecycleActionKind kind, uint256 inputCount, uint256 successorCount) private pure {
        if (kind == LifecycleActionKind.Transfer || kind == LifecycleActionKind.Assignment) {
            if (inputCount != 1 || successorCount == 0 || successorCount > 2) revert InvalidLifecycleShape();
            return;
        }
        if (kind == LifecycleActionKind.PartialUnwind || kind == LifecycleActionKind.Exercise) {
            if (successorCount == 0) revert InvalidLifecycleShape();
            return;
        }
        if (kind == LifecycleActionKind.FullUnwind || kind == LifecycleActionKind.Lapse) {
            if (successorCount != 0) revert InvalidLifecycleShape();
            return;
        }
        if (kind == LifecycleActionKind.Split) {
            if (inputCount != 1 || successorCount < 2) revert InvalidLifecycleShape();
            return;
        }
        if (kind == LifecycleActionKind.Merge) {
            if (inputCount < 2 || successorCount != 1) revert InvalidLifecycleShape();
            return;
        }
        if (
            kind == LifecycleActionKind.Amendment || kind == LifecycleActionKind.Novation
                || kind == LifecycleActionKind.Roll || kind == LifecycleActionKind.CollateralPolicyChange
        ) {
            if (successorCount == 0) revert InvalidLifecycleShape();
            return;
        }
        if (kind != LifecycleActionKind.CompressionHandoff) revert InvalidLifecycleShape();
    }

    function _validateSpecialWindows(
        LifecycleActionKind kind,
        LifecycleInput[] memory requestedInputs,
        LifecyclePositionSnapshot[] memory inputs,
        uint256 currentTimestamp
    ) private pure {
        if (kind == LifecycleActionKind.Exercise) {
            for (uint256 i; i < inputs.length; ++i) {
                bytes32 policy = ExercisePolicyId.unwrap(inputs[i].exercisePolicyId);
                if (
                    policy != ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)
                        && policy
                            != ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
                ) {
                    revert ExerciseWindowClosed(
                        PositionId.unwrap(inputs[i].positionId),
                        inputs[i].exerciseOpensAt,
                        inputs[i].exerciseCutoffAt,
                        currentTimestamp
                    );
                }
                if (currentTimestamp < inputs[i].exerciseOpensAt || currentTimestamp > inputs[i].exerciseCutoffAt) {
                    revert ExerciseWindowClosed(
                        PositionId.unwrap(inputs[i].positionId),
                        inputs[i].exerciseOpensAt,
                        inputs[i].exerciseCutoffAt,
                        currentTimestamp
                    );
                }
                uint128 requested = Lots.unwrap(requestedInputs[i].actionLots);
                uint128 remaining = Lots.unwrap(inputs[i].remainingExerciseLots);
                if (requested > remaining) {
                    revert ExerciseQuantityExceeded(PositionId.unwrap(inputs[i].positionId), remaining, requested);
                }
            }
        }
        if (kind == LifecycleActionKind.Lapse) {
            for (uint256 i; i < inputs.length; ++i) {
                if (currentTimestamp < inputs[i].lapseEligibleAt) {
                    revert LapseNotAvailable(
                        PositionId.unwrap(inputs[i].positionId), inputs[i].lapseEligibleAt, currentTimestamp
                    );
                }
                if (Lots.unwrap(requestedInputs[i].actionLots) != Lots.unwrap(inputs[i].positionLots)) {
                    revert QuantityNotConserved();
                }
            }
        }
    }

    function _validateQuantities(
        LifecycleActionKind kind,
        LifecycleInput[] memory requestedInputs,
        LifecyclePositionSnapshot[] memory inputs,
        LifecycleSuccessor[] memory successors
    ) private pure {
        uint256 inputLots;
        uint256 actionLots;
        uint256 successorLots;
        for (uint256 i; i < inputs.length; ++i) {
            inputLots += Lots.unwrap(inputs[i].positionLots);
            actionLots += Lots.unwrap(requestedInputs[i].actionLots);
        }
        for (uint256 i; i < successors.length; ++i) {
            successorLots += Lots.unwrap(successors[i].lots);
        }
        if (kind == LifecycleActionKind.FullUnwind || kind == LifecycleActionKind.Lapse) {
            if (actionLots != inputLots || successorLots != 0) revert QuantityNotConserved();
            return;
        }
        if (kind == LifecycleActionKind.PartialUnwind || kind == LifecycleActionKind.Exercise) {
            if (actionLots >= inputLots || successorLots + actionLots != inputLots) revert QuantityNotConserved();
            _requireEconomicConservation(inputs, successors, requestedInputs, true);
            return;
        }
        if (kind == LifecycleActionKind.CompressionHandoff) return;
        if (successorLots != inputLots) revert QuantityNotConserved();
        if (
            kind != LifecycleActionKind.Amendment && kind != LifecycleActionKind.Novation
                && kind != LifecycleActionKind.Roll
        ) _requireEconomicConservation(inputs, successors, requestedInputs, false);
    }

    function _requireEconomicConservation(
        LifecyclePositionSnapshot[] memory inputs,
        LifecycleSuccessor[] memory successors,
        LifecycleInput[] memory requestedInputs,
        bool subtractActionLots
    ) private pure {
        for (uint256 i; i < inputs.length; ++i) {
            uint256 beforeLots;
            uint256 afterLots;
            for (uint256 j; j < inputs.length; ++j) {
                if (_sameEconomics(inputs[i], inputs[j])) {
                    beforeLots += Lots.unwrap(inputs[j].positionLots);
                    if (subtractActionLots) beforeLots -= Lots.unwrap(requestedInputs[j].actionLots);
                }
            }
            for (uint256 j; j < successors.length; ++j) {
                if (_sameSuccessorEconomics(inputs[i], successors[j])) afterLots += Lots.unwrap(successors[j].lots);
            }
            if (beforeLots != afterLots) revert QuantityNotConserved();
        }
        for (uint256 i; i < successors.length; ++i) {
            bool found;
            for (uint256 j; j < inputs.length; ++j) {
                if (_sameSuccessorEconomics(inputs[j], successors[i])) found = true;
            }
            if (!found) revert QuantityNotConserved();
        }
    }

    function _validateAccounts(
        LifecycleAction memory action,
        LifecyclePositionSnapshot[] memory inputs,
        LifecycleSuccessor[] memory successors,
        LifecycleCollateralReplacement[] memory replacements,
        LifecycleConsent[] memory consents
    ) private pure {
        for (uint256 i; i < replacements.length; ++i) {
            AccountId accountId = replacements[i].accountId;
            uint256 beforeLiability = _inputLiability(accountId, inputs);
            uint256 afterLiability = _successorLiability(accountId, successors);
            if (afterLiability != replacements[i].terminalLiabilityBaseUnits) {
                revert CollateralReplacementMismatch(AccountId.unwrap(accountId));
            }
            uint128 tolerance = _liabilityTolerance(action, accountId, consents);
            if (afterLiability > beforeLiability + tolerance) {
                revert LiabilityToleranceExceeded(
                    AccountId.unwrap(accountId), beforeLiability, afterLiability, tolerance
                );
            }
            uint128 collateralTolerance = _collateralTolerance(action, accountId, consents);
            if (afterLiability > beforeLiability + collateralTolerance) {
                revert CollateralReplacementMismatch(AccountId.unwrap(accountId));
            }
        }
        _requireAllAccounts(action, inputs, successors, replacements, consents);
    }

    function _requireAllAccounts(
        LifecycleAction memory action,
        LifecyclePositionSnapshot[] memory inputs,
        LifecycleSuccessor[] memory successors,
        LifecycleCollateralReplacement[] memory replacements,
        LifecycleConsent[] memory consents
    ) private pure {
        for (uint256 i; i < inputs.length; ++i) {
            _requireAccount(action, inputs[i].longAccountId, replacements, consents);
            _requireAccount(action, inputs[i].shortAccountId, replacements, consents);
        }
        for (uint256 i; i < successors.length; ++i) {
            _requireAccount(action, successors[i].longAccountId, replacements, consents);
            _requireAccount(action, successors[i].shortAccountId, replacements, consents);
        }
    }

    function _requireAccount(
        LifecycleAction memory action,
        AccountId accountId,
        LifecycleCollateralReplacement[] memory replacements,
        LifecycleConsent[] memory consents
    ) private pure {
        bool replacementFound;
        for (uint256 i; i < replacements.length; ++i) {
            if (AccountId.unwrap(replacements[i].accountId) == AccountId.unwrap(accountId)) replacementFound = true;
        }
        if (!replacementFound) revert CollateralReplacementMismatch(AccountId.unwrap(accountId));
        if (action.kind == LifecycleActionKind.Lapse) return;
        if (AccountId.unwrap(accountId) == AccountId.unwrap(action.actorAccountId)) return;
        for (uint256 i; i < consents.length; ++i) {
            if (AccountId.unwrap(consents[i].accountId) == AccountId.unwrap(accountId)) return;
        }
        revert MissingConsent(AccountId.unwrap(accountId));
    }

    function _validatePackageProvenance(
        LifecycleAction memory action,
        LifecycleInput[] memory requestedInputs,
        LifecyclePositionSnapshot[] memory inputs,
        LifecycleConsent[] memory consents
    ) private pure {
        bool packageAffected;
        for (uint256 i; i < inputs.length; ++i) {
            if (inputs[i].packageProvenanceHash != bytes32(0) && Lots.unwrap(requestedInputs[i].actionLots) != 0) {
                packageAffected = true;
            }
        }
        if (!packageAffected || action.kind == LifecycleActionKind.Lapse) return;
        if (!action.breaksPackageProvenance) {
            if (action.kind != LifecycleActionKind.CompressionHandoff) revert PackageBreakNotAuthorized(bytes32(0));
            return;
        }
        for (uint256 i; i < consents.length; ++i) {
            if (!consents[i].allowsPackageBreak) {
                revert PackageBreakNotAuthorized(AccountId.unwrap(consents[i].accountId));
            }
        }
    }

    function _liabilityTolerance(LifecycleAction memory action, AccountId accountId, LifecycleConsent[] memory consents)
        private
        pure
        returns (uint128)
    {
        if (action.kind == LifecycleActionKind.Lapse) return 0;
        if (AccountId.unwrap(accountId) == AccountId.unwrap(action.actorAccountId)) {
            return action.actorMaximumLiabilityIncreaseBaseUnits;
        }
        for (uint256 i; i < consents.length; ++i) {
            if (AccountId.unwrap(consents[i].accountId) == AccountId.unwrap(accountId)) {
                return consents[i].maximumLiabilityIncreaseBaseUnits;
            }
        }
        revert MissingConsent(AccountId.unwrap(accountId));
    }

    function _collateralTolerance(
        LifecycleAction memory action,
        AccountId accountId,
        LifecycleConsent[] memory consents
    ) private pure returns (uint128) {
        if (action.kind == LifecycleActionKind.Lapse) return 0;
        if (AccountId.unwrap(accountId) == AccountId.unwrap(action.actorAccountId)) {
            return action.actorMaximumCollateralIncreaseBaseUnits;
        }
        for (uint256 i; i < consents.length; ++i) {
            if (AccountId.unwrap(consents[i].accountId) == AccountId.unwrap(accountId)) {
                return consents[i].maximumCollateralIncreaseBaseUnits;
            }
        }
        revert MissingConsent(AccountId.unwrap(accountId));
    }

    function _inputLiability(AccountId accountId, LifecyclePositionSnapshot[] memory inputs)
        private
        pure
        returns (uint256 liability)
    {
        for (uint256 i; i < inputs.length; ++i) {
            if (AccountId.unwrap(inputs[i].longAccountId) == AccountId.unwrap(accountId)) {
                liability += inputs[i].longTerminalLiabilityBaseUnits;
            }
            if (AccountId.unwrap(inputs[i].shortAccountId) == AccountId.unwrap(accountId)) {
                liability += inputs[i].shortTerminalLiabilityBaseUnits;
            }
        }
    }

    function _successorLiability(AccountId accountId, LifecycleSuccessor[] memory successors)
        private
        pure
        returns (uint256 liability)
    {
        for (uint256 i; i < successors.length; ++i) {
            if (AccountId.unwrap(successors[i].longAccountId) == AccountId.unwrap(accountId)) {
                liability += successors[i].longTerminalLiabilityBaseUnits;
            }
            if (AccountId.unwrap(successors[i].shortAccountId) == AccountId.unwrap(accountId)) {
                liability += successors[i].shortTerminalLiabilityBaseUnits;
            }
        }
    }

    function _sameEconomics(LifecyclePositionSnapshot memory left, LifecyclePositionSnapshot memory right)
        private
        pure
        returns (bool)
    {
        return SeriesId.unwrap(left.seriesId) == SeriesId.unwrap(right.seriesId)
            && left.seriesVersion == right.seriesVersion
            && PriceTicks.unwrap(left.entryPriceTicks) == PriceTicks.unwrap(right.entryPriceTicks)
            && left.economicsHash == right.economicsHash;
    }

    function _sameSuccessorEconomics(LifecyclePositionSnapshot memory input, LifecycleSuccessor memory successor)
        private
        pure
        returns (bool)
    {
        return SeriesId.unwrap(input.seriesId) == SeriesId.unwrap(successor.seriesId)
            && input.seriesVersion == successor.seriesVersion
            && PriceTicks.unwrap(input.entryPriceTicks) == PriceTicks.unwrap(successor.entryPriceTicks)
            && input.economicsHash == successor.economicsHash;
    }
}
