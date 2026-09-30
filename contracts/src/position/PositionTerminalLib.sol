// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IExactLotsPayoffModuleV1} from "../interfaces/IExactLotsPayoffModuleV1.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {TerminalOutcomeKind} from "../types/Enums.sol";
import {AccountId, ExercisePolicyId, PositionId} from "../types/Identifiers.sol";
import {PositionEconomics, PositionExerciseState, PositionLifecycle, PositionStatus} from "../types/PositionTypes.sol";
import {Lots} from "../types/Units.sol";

import {LiabilityState} from "./PositionEngineTypes.sol";

/// Linked logic for the position engine: final fixing, exercise, quantity reductions, terminal fallback,
/// zero-liability alternatives, owner transfer, and settlement. Runs through DELEGATECALL in the position engine's
/// context against its storage.
library PositionTerminalLib {
    bytes32 internal constant ALTERNATIVE_OUTCOME_TYPEHASH =
        keccak256("SetrynPositionAlternativeV1(bytes32 positionId,uint8 status,bytes32 reference)");
    bytes32 internal constant FALLBACK_OUTCOME_TYPEHASH = keccak256(
        "SetrynPositionTerminalFallbackV1(bytes32 positionId,uint64 finalResolutionAt,int256 terminalTransferMinor)"
    );
    bytes32 internal constant SETTLEMENT_OUTCOME_TYPEHASH = keccak256(
        "SetrynPositionSettlementV1(bytes32 positionId,bytes32 fixingReference,bytes32 finalFixingsHash,int256 terminalTransferMinor)"
    );
    bytes32 internal constant ELECTION_LAPSE_TYPEHASH = keccak256(
        "SetrynPositionElectionLapseV1(bytes32 positionId,uint64 exerciseCutoffAt,bytes32 finalFixingReference)"
    );

    function acceptFinalFixing(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(
            PositionId positionId => PositionLifecycle lifecycle
        ) storage $lifecycles,
        mapping(PositionId positionId => bytes terms) storage $payoffTerms,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionId positionId,
        bytes32 fixingReference,
        bytes calldata finalFixings
    ) external {
        if (fixingReference == bytes32(0) || finalFixings.length == 0) {
            revert IPositionEngine.ZeroReference();
        }
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (lifecycle.status != PositionStatus.Fixing) {
            revert IPositionEngine.InvalidPositionTransition(
                positionId, lifecycle.status, PositionStatus.SettlementReady
            );
        }
        PositionEconomics storage economics = $economics[positionId];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs >= economics.finalResolutionAt) {
            revert IPositionEngine.FinalResolutionReached(positionId, economics.finalResolutionAt, nowTs);
        }

        lifecycle.finalFixingReference = fixingReference;
        lifecycle.finalFixingsHash = keccak256(finalFixings);
        bytes32 policy = ExercisePolicyId.unwrap(economics.exercisePolicyId);
        if (policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)) {
            _setStatus(positionId, lifecycle, PositionStatus.Live, fixingReference);
            return;
        }
        if (
            policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
                && block.timestamp <= economics.exerciseCutoffAt
        ) revert IPositionEngine.FixingWindowNotOpen(positionId, economics.exerciseCutoffAt + 1, nowTs);

        uint128 evaluatedLots = Lots.unwrap(lifecycle.remainingLots);
        int256 total = _evaluatePayoff($payoffTerms, positionId, economics, finalFixings, evaluatedLots);
        if (
            policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
                && _absoluteTransfer(total) < economics.automaticExerciseThresholdMinor
        ) {
            lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + evaluatedLots);
            lifecycle.remainingLots = Lots.wrap(0);
            lifecycle.exerciseState = PositionExerciseState.Lapsed;
            lifecycle.terminalTransferMinor = 0;
            bytes32 lapseReference = keccak256(
                abi.encode(
                    ALTERNATIVE_OUTCOME_TYPEHASH,
                    PositionId.unwrap(positionId),
                    uint8(PositionStatus.Lapsed),
                    fixingReference
                )
            );
            lifecycle.terminalOutcomeReference = lapseReference;
            _writeTerminalLiabilities($liabilityStates, economics, 0, lapseReference, false);
            _setStatus(positionId, lifecycle, PositionStatus.Lapsed, lapseReference);
            _emitQuantity(positionId, lifecycle, lapseReference);
            return;
        }
        lifecycle.exercisedLots = Lots.wrap(Lots.unwrap(lifecycle.exercisedLots) + evaluatedLots);
        lifecycle.remainingLots = Lots.wrap(0);
        lifecycle.exerciseState = PositionExerciseState.FullyExercised;
        lifecycle.terminalTransferMinor = _checkedAddTransfer(lifecycle.terminalTransferMinor, total);
        _setStatus(positionId, lifecycle, PositionStatus.SettlementReady, fixingReference);

        emit IPositionEngine.PositionExactPayoffComputed(
            positionId, fixingReference, lifecycle.finalFixingsHash, evaluatedLots, lifecycle.terminalTransferMinor
        );
        _emitQuantity(positionId, lifecycle, fixingReference);
    }

    function exercisePositionQuantity(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(
            PositionId positionId => PositionLifecycle lifecycle
        ) storage $lifecycles,
        mapping(PositionId positionId => bytes terms) storage $payoffTerms,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionId positionId,
        Lots exerciseLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        bytes32 fixingReference,
        bytes calldata finalFixings
    ) external {
        if (fixingReference == bytes32(0) || finalFixings.length == 0) {
            revert IPositionEngine.ZeroReference();
        }
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert IPositionEngine.InvalidPositionTransition(
                positionId, lifecycle.status, PositionStatus.SettlementReady
            );
        }
        _requireLifecycleAuthority(positionId, lifecycle, actorAccountId, expectedLifecycleNonce);
        PositionEconomics storage economics = $economics[positionId];
        if (
            ExercisePolicyId.unwrap(economics.exercisePolicyId)
                != ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)
        ) revert IPositionEngine.UnsupportedTerminalAlternative(PositionStatus.SettlementReady);
        if (block.timestamp < economics.exerciseOpensAt || block.timestamp > economics.exerciseCutoffAt) {
            revert IPositionEngine.FixingWindowNotOpen(positionId, economics.exerciseOpensAt, uint64(block.timestamp));
        }
        uint128 quantity = _requireQuantity(positionId, lifecycle, exerciseLots);
        bytes32 suppliedFixingsHash = keccak256(finalFixings);
        if (
            lifecycle.finalFixingReference == bytes32(0) || lifecycle.finalFixingsHash == bytes32(0)
                || lifecycle.finalFixingReference != fixingReference
                || lifecycle.finalFixingsHash != suppliedFixingsHash
        ) {
            revert IPositionEngine.ZeroReference();
        }
        int256 transfer = _evaluatePayoff($payoffTerms, positionId, economics, finalFixings, quantity);
        lifecycle.terminalTransferMinor = _checkedAddTransfer(lifecycle.terminalTransferMinor, transfer);
        lifecycle.remainingLots = Lots.wrap(Lots.unwrap(lifecycle.remainingLots) - quantity);
        lifecycle.exercisedLots = Lots.wrap(Lots.unwrap(lifecycle.exercisedLots) + quantity);
        lifecycle.exerciseState = Lots.unwrap(lifecycle.remainingLots) == 0
            ? PositionExerciseState.FullyExercised
            : PositionExerciseState.PartiallyExercised;
        lifecycle.lifecycleNonce += 1;
        emit IPositionEngine.PositionExactPayoffComputed(
            positionId, fixingReference, suppliedFixingsHash, quantity, transfer
        );
        if (Lots.unwrap(lifecycle.remainingLots) == 0) {
            bytes32 outcomeReference = keccak256(
                abi.encode(
                    SETTLEMENT_OUTCOME_TYPEHASH,
                    PositionId.unwrap(positionId),
                    lifecycle.finalFixingReference,
                    lifecycle.finalFixingsHash,
                    lifecycle.terminalTransferMinor
                )
            );
            lifecycle.terminalOutcomeReference = outcomeReference;
            _writeTerminalLiabilities(
                $liabilityStates, economics, lifecycle.terminalTransferMinor, outcomeReference, false
            );
            _setStatus(positionId, lifecycle, PositionStatus.Settled, outcomeReference);
        }
        _emitQuantity(positionId, lifecycle, fixingReference);
    }

    function applyTerminalFallback(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(
            PositionId positionId => PositionLifecycle lifecycle
        ) storage $lifecycles,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionId positionId
    ) external {
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (!_isFallbackSource(lifecycle.status)) {
            revert IPositionEngine.InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.TerminalClaim);
        }
        PositionEconomics storage economics = $economics[positionId];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < economics.finalResolutionAt) {
            revert IPositionEngine.FinalResolutionNotReached(positionId, economics.finalResolutionAt, nowTs);
        }

        uint128 unresolvedLots = Lots.unwrap(lifecycle.remainingLots);
        int256 disruption;
        bytes32 policy = ExercisePolicyId.unwrap(economics.exercisePolicyId);
        bool applies = policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC);
        if (policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)) {
            int256 candidate =
                PositionMathLib.scaleTransfer(economics.terminalDisruptionTransferMinorPerLot, lifecycle.remainingLots);
            applies = _absoluteTransfer(candidate) >= economics.automaticExerciseThresholdMinor;
            if (applies) disruption = candidate;
        }
        if (applies && disruption == 0) {
            disruption =
                PositionMathLib.scaleTransfer(economics.terminalDisruptionTransferMinorPerLot, lifecycle.remainingLots);
        }
        int256 total = _checkedAddTransfer(lifecycle.terminalTransferMinor, disruption);
        bytes32 outcomeReference = keccak256(
            abi.encode(FALLBACK_OUTCOME_TYPEHASH, PositionId.unwrap(positionId), economics.finalResolutionAt, total)
        );
        lifecycle.terminalTransferMinor = total;
        lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + unresolvedLots);
        lifecycle.remainingLots = Lots.wrap(0);
        lifecycle.exerciseState = applies ? PositionExerciseState.FullyExercised : PositionExerciseState.Lapsed;
        lifecycle.terminalOutcomeReference = outcomeReference;
        _writeTerminalLiabilities($liabilityStates, economics, total, outcomeReference, true);
        PositionStatus terminalStatus = total == 0 ? PositionStatus.Settled : PositionStatus.TerminalClaim;
        _setStatus(positionId, lifecycle, terminalStatus, outcomeReference);
        _emitQuantity(positionId, lifecycle, outcomeReference);
    }

    function settle(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionId positionId
    ) external {
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (lifecycle.status != PositionStatus.SettlementReady) {
            revert IPositionEngine.InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Settled);
        }
        if (lifecycle.exerciseState != PositionExerciseState.FullyExercised) {
            revert IPositionEngine.InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Settled);
        }
        PositionEconomics storage economics = $economics[positionId];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs >= economics.finalResolutionAt) {
            revert IPositionEngine.FinalResolutionReached(positionId, economics.finalResolutionAt, nowTs);
        }

        bytes32 outcomeReference = keccak256(
            abi.encode(
                SETTLEMENT_OUTCOME_TYPEHASH,
                PositionId.unwrap(positionId),
                lifecycle.finalFixingReference,
                lifecycle.finalFixingsHash,
                lifecycle.terminalTransferMinor
            )
        );
        lifecycle.terminalOutcomeReference = outcomeReference;
        _writeTerminalLiabilities($liabilityStates, economics, lifecycle.terminalTransferMinor, outcomeReference, false);
        _setStatus(positionId, lifecycle, PositionStatus.Settled, outcomeReference);
    }

    function _evaluatePayoff(
        mapping(PositionId positionId => bytes terms) storage $payoffTerms,
        PositionId positionId,
        PositionEconomics storage economics,
        bytes calldata finalFixings,
        uint128 lots
    ) internal view returns (int256 terminalTransferMinor) {
        bytes32 actualCodeHash = economics.payoffModule.codehash;
        if (actualCodeHash != economics.payoffModuleCodeHash) {
            revert IPositionEngine.PayoffModuleRuntimeMismatch(
                economics.payoffModule, economics.payoffModuleCodeHash, actualCodeHash
            );
        }

        bytes memory payload = abi.encodeCall(
            IExactLotsPayoffModuleV1.evaluatePositionLots, ($payoffTerms[positionId], finalFixings, lots)
        );
        bytes4 selector = IExactLotsPayoffModuleV1.evaluatePositionLots.selector;
        bool success;
        uint256 returnLength;
        uint64 gasLimit = economics.maxEvaluationGas;
        address implementation = economics.payoffModule;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, implementation, add(payload, 0x20), mload(payload), 0, 0)
            returnLength := returndatasize()
        }
        if (!success) revert IPositionEngine.PayoffModuleCallFailed(selector);
        if (returnLength != 32) revert IPositionEngine.InvalidPayoffModuleReturn(selector, returnLength);
        bytes memory returnData = new bytes(32);
        assembly ("memory-safe") {
            returndatacopy(add(returnData, 0x20), 0, 32)
        }
        terminalTransferMinor = abi.decode(returnData, (int256));
        uint256 longMaximum = uint256(economics.maxLongDebitMinorPerLot) * lots;
        uint256 shortMaximum = uint256(economics.maxShortDebitMinorPerLot) * lots;
        if (
            longMaximum > uint256(type(int256).max) || shortMaximum > uint256(type(int256).max)
                || terminalTransferMinor < -int256(longMaximum) || terminalTransferMinor > int256(shortMaximum)
        ) {
            revert IPositionEngine.PayoffOutsideDebitBounds(
                terminalTransferMinor, economics.maxLongDebitMinorPerLot, economics.maxShortDebitMinorPerLot
            );
        }
    }

    function _isFallbackSource(PositionStatus status) internal pure returns (bool) {
        return status == PositionStatus.Live || status == PositionStatus.Fixing
            || status == PositionStatus.SettlementReady || status == PositionStatus.Defaulted;
    }

    function abandonPositionQuantity(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(
            PositionId positionId => PositionLifecycle lifecycle
        ) storage $lifecycles,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionId positionId,
        Lots abandonLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        bytes32 transitionReference
    ) external {
        if (transitionReference == bytes32(0)) revert IPositionEngine.ZeroReference();
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert IPositionEngine.InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Abandoned);
        }
        _requireLifecycleAuthority(positionId, lifecycle, actorAccountId, expectedLifecycleNonce);
        PositionEconomics storage economics = $economics[positionId];
        if (
            ExercisePolicyId.unwrap(economics.exercisePolicyId)
                    != ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
                || block.timestamp < economics.exerciseOpensAt || block.timestamp > economics.exerciseCutoffAt
        ) revert IPositionEngine.FixingWindowNotOpen(positionId, economics.exerciseOpensAt, uint64(block.timestamp));
        uint128 quantity = _requireQuantity(positionId, lifecycle, abandonLots);
        lifecycle.remainingLots = Lots.wrap(Lots.unwrap(lifecycle.remainingLots) - quantity);
        lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + quantity);
        lifecycle.lifecycleNonce += 1;
        lifecycle.exerciseState = Lots.unwrap(lifecycle.remainingLots) == 0
            ? PositionExerciseState.Abandoned
            : PositionExerciseState.ElectionOpen;
        if (Lots.unwrap(lifecycle.remainingLots) == 0) {
            bytes32 outcomeReference = keccak256(
                abi.encode(
                    ALTERNATIVE_OUTCOME_TYPEHASH,
                    PositionId.unwrap(positionId),
                    uint8(PositionStatus.Abandoned),
                    transitionReference
                )
            );
            lifecycle.terminalOutcomeReference = outcomeReference;
            _writeTerminalLiabilities($liabilityStates, economics, 0, outcomeReference, false);
            _setStatus(positionId, lifecycle, PositionStatus.Abandoned, outcomeReference);
        }
        _emitQuantity(positionId, lifecycle, transitionReference);
    }

    function closePositionQuantity(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(
            PositionId positionId => PositionLifecycle lifecycle
        ) storage $lifecycles,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionId positionId,
        Lots closeLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        PositionStatus terminalStatus,
        bytes32 transitionReference
    ) external {
        if (transitionReference == bytes32(0)) revert IPositionEngine.ZeroReference();
        if (!_isZeroLiabilityAlternative(terminalStatus)) {
            revert IPositionEngine.UnsupportedTerminalAlternative(terminalStatus);
        }
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert IPositionEngine.InvalidPositionTransition(positionId, lifecycle.status, terminalStatus);
        }
        if (terminalStatus == PositionStatus.Lapsed) _requireLapseOpen($economics, positionId);
        _requireLifecycleAuthority(positionId, lifecycle, actorAccountId, expectedLifecycleNonce);
        uint128 quantity = _requireQuantity(positionId, lifecycle, closeLots);
        lifecycle.remainingLots = Lots.wrap(Lots.unwrap(lifecycle.remainingLots) - quantity);
        lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + quantity);
        lifecycle.lifecycleNonce += 1;
        if (terminalStatus == PositionStatus.Lapsed) lifecycle.exerciseState = PositionExerciseState.Lapsed;
        if (terminalStatus == PositionStatus.Abandoned) lifecycle.exerciseState = PositionExerciseState.Abandoned;
        if (Lots.unwrap(lifecycle.remainingLots) == 0) {
            bytes32 outcomeReference = keccak256(
                abi.encode(
                    ALTERNATIVE_OUTCOME_TYPEHASH,
                    PositionId.unwrap(positionId),
                    uint8(terminalStatus),
                    transitionReference,
                    lifecycle.terminalTransferMinor
                )
            );
            lifecycle.terminalOutcomeReference = outcomeReference;
            PositionEconomics storage economics = $economics[positionId];
            _writeTerminalLiabilities(
                $liabilityStates, economics, lifecycle.terminalTransferMinor, outcomeReference, false
            );
            PositionStatus resolved = lifecycle.terminalTransferMinor == 0 ? terminalStatus : PositionStatus.Settled;
            _setStatus(positionId, lifecycle, resolved, outcomeReference);
        }
        _emitQuantity(positionId, lifecycle, transitionReference);
    }

    function recordZeroLiabilityAlternative(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionId positionId,
        PositionStatus terminalStatus,
        bytes32 transitionReference
    ) external {
        if (transitionReference == bytes32(0)) revert IPositionEngine.ZeroReference();
        if (!_isZeroLiabilityAlternative(terminalStatus)) {
            revert IPositionEngine.UnsupportedTerminalAlternative(terminalStatus);
        }
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (lifecycle.status != PositionStatus.Live && lifecycle.status != PositionStatus.Fixing) {
            revert IPositionEngine.InvalidPositionTransition(positionId, lifecycle.status, terminalStatus);
        }
        if (terminalStatus == PositionStatus.Lapsed) _requireLapseOpen($economics, positionId);
        _closeRemainingLots($economics, $liabilityStates, lifecycle, positionId, terminalStatus, transitionReference);
    }

    /// Permissionless series lapse rule for holder election: once the exercise cutoff has passed without an election,
    /// every unelected lot lapses with zero transfer. Lots already exercised keep their accumulated transfer. At and
    /// after final resolution the terminal fallback governs instead, so this path closes there.
    function lapseUnelectedLots(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(
            PositionId positionId => PositionLifecycle lifecycle
        ) storage $lifecycles,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionId positionId
    ) external {
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (lifecycle.status != PositionStatus.Live && lifecycle.status != PositionStatus.Fixing) {
            revert IPositionEngine.InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Lapsed);
        }
        _requireLapseOpen($economics, positionId);
        PositionEconomics storage economics = $economics[positionId];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs >= economics.finalResolutionAt) {
            revert IPositionEngine.FinalResolutionReached(positionId, economics.finalResolutionAt, nowTs);
        }
        bytes32 transitionReference = keccak256(
            abi.encode(
                ELECTION_LAPSE_TYPEHASH,
                PositionId.unwrap(positionId),
                economics.exerciseCutoffAt,
                lifecycle.finalFixingReference
            )
        );
        _closeRemainingLots(
            $economics, $liabilityStates, lifecycle, positionId, PositionStatus.Lapsed, transitionReference
        );
    }

    function _closeRemainingLots(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(
            bytes32 liabilityKey => LiabilityState state
        ) storage $liabilityStates,
        PositionLifecycle storage lifecycle,
        PositionId positionId,
        PositionStatus terminalStatus,
        bytes32 transitionReference
    ) internal {
        uint128 remaining = Lots.unwrap(lifecycle.remainingLots);
        lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + remaining);
        lifecycle.remainingLots = Lots.wrap(0);
        lifecycle.lifecycleNonce += 1;
        if (terminalStatus == PositionStatus.Lapsed) lifecycle.exerciseState = PositionExerciseState.Lapsed;
        if (terminalStatus == PositionStatus.Abandoned) lifecycle.exerciseState = PositionExerciseState.Abandoned;
        bytes32 outcomeReference = keccak256(
            abi.encode(
                ALTERNATIVE_OUTCOME_TYPEHASH,
                PositionId.unwrap(positionId),
                uint8(terminalStatus),
                transitionReference,
                lifecycle.terminalTransferMinor
            )
        );
        lifecycle.terminalOutcomeReference = outcomeReference;
        PositionEconomics storage economics = $economics[positionId];
        _writeTerminalLiabilities($liabilityStates, economics, lifecycle.terminalTransferMinor, outcomeReference, false);
        PositionStatus resolved = lifecycle.terminalTransferMinor == 0 ? terminalStatus : PositionStatus.Settled;
        _setStatus(positionId, lifecycle, resolved, outcomeReference);
        _emitQuantity(positionId, lifecycle, transitionReference);
    }

    function transferLifecycleOwner(
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        PositionId positionId,
        AccountId currentOwnerAccountId,
        AccountId newOwnerAccountId,
        uint64 expectedOwnerNonce,
        bytes32 transitionReference
    ) external {
        if (AccountId.unwrap(newOwnerAccountId) == bytes32(0) || transitionReference == bytes32(0)) {
            revert IPositionEngine.ZeroReference();
        }
        PositionLifecycle storage lifecycle = _requirePosition($lifecycles, positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert IPositionEngine.InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Live);
        }
        if (AccountId.unwrap(lifecycle.lifecycleOwnerAccountId) != AccountId.unwrap(currentOwnerAccountId)) {
            revert IPositionEngine.LifecycleOwnerMismatch(
                positionId, lifecycle.lifecycleOwnerAccountId, currentOwnerAccountId
            );
        }
        if (lifecycle.ownerNonce != expectedOwnerNonce) {
            revert IPositionEngine.LifecycleNonceMismatch(positionId, lifecycle.ownerNonce, expectedOwnerNonce);
        }
        lifecycle.lifecycleOwnerAccountId = newOwnerAccountId;
        lifecycle.ownerNonce += 1;
        lifecycle.lifecycleNonce += 1;
        _emitQuantity(positionId, lifecycle, transitionReference);
    }

    function _setStatus(
        PositionId positionId,
        PositionLifecycle storage lifecycle,
        PositionStatus newStatus,
        bytes32 transitionReference
    ) internal {
        PositionStatus previous = lifecycle.status;
        lifecycle.status = newStatus;
        emit IPositionEngine.PositionStatusChanged(positionId, previous, newStatus, transitionReference, msg.sender);
    }

    function _requirePosition(
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        PositionId positionId
    ) internal view returns (PositionLifecycle storage lifecycle) {
        lifecycle = $lifecycles[positionId];
        if (lifecycle.status == PositionStatus.Unspecified) revert IPositionEngine.UnknownPosition(positionId);
    }

    function _emitQuantity(PositionId positionId, PositionLifecycle storage lifecycle, bytes32 transitionReference)
        internal
    {
        emit IPositionEngine.PositionQuantityChanged(
            positionId,
            Lots.unwrap(lifecycle.remainingLots),
            Lots.unwrap(lifecycle.exercisedLots),
            Lots.unwrap(lifecycle.closedLots),
            lifecycle.lifecycleNonce,
            transitionReference
        );
    }

    function _writeTerminalLiabilities(
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionEconomics storage economics,
        int256 terminalTransferMinor,
        bytes32 outcomeReference,
        bool asClaim
    ) internal {
        if (terminalTransferMinor == 0) {
            _setFlatLiability($liabilityStates, economics.longLiabilityKey, outcomeReference);
            _setFlatLiability($liabilityStates, economics.shortLiabilityKey, outcomeReference);
            return;
        }

        bool longPays = terminalTransferMinor < 0;
        uint256 magnitude = longPays ? uint256(-terminalTransferMinor) : uint256(terminalTransferMinor);
        if (magnitude > type(uint128).max) revert IPositionEngine.TerminalAmountOverflow(magnitude);
        bytes32 payerKey = longPays ? economics.longLiabilityKey : economics.shortLiabilityKey;
        bytes32 otherKey = longPays ? economics.shortLiabilityKey : economics.longLiabilityKey;
        AccountId receiver = longPays ? economics.shortAccountId : economics.longAccountId;
        LiabilityState storage payer = $liabilityStates[payerKey];
        payer.receiverAccountId = receiver;
        payer.amount = uint128(magnitude);
        payer.outcome = asClaim ? TerminalOutcomeKind.Claim : TerminalOutcomeKind.Payout;
        payer.terminalOutcomeReference = outcomeReference;
        _setFlatLiability($liabilityStates, otherKey, outcomeReference);
    }

    function _setFlatLiability(
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        bytes32 liabilityKey,
        bytes32 outcomeReference
    ) internal {
        LiabilityState storage liability = $liabilityStates[liabilityKey];
        liability.receiverAccountId = AccountId.wrap(bytes32(0));
        liability.amount = 0;
        liability.outcome = TerminalOutcomeKind.Flat;
        liability.terminalOutcomeReference = outcomeReference;
    }

    function _absoluteTransfer(int256 value) internal pure returns (uint256) {
        if (value >= 0) return uint256(value);
        if (value == type(int256).min) revert IPositionEngine.TerminalAmountOverflow(type(uint256).max);
        return uint256(-value);
    }

    function _checkedAddTransfer(int256 left, int256 right) internal pure returns (int256 result) {
        unchecked {
            result = left + right;
            if ((right > 0 && result < left) || (right < 0 && result > left)) {
                revert IPositionEngine.TerminalAmountOverflow(type(uint256).max);
            }
        }
    }

    function _requireLifecycleAuthority(
        PositionId positionId,
        PositionLifecycle storage lifecycle,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce
    ) internal view {
        if (AccountId.unwrap(actorAccountId) != AccountId.unwrap(lifecycle.lifecycleOwnerAccountId)) {
            revert IPositionEngine.LifecycleOwnerMismatch(positionId, lifecycle.lifecycleOwnerAccountId, actorAccountId);
        }
        if (lifecycle.lifecycleNonce != expectedLifecycleNonce) {
            revert IPositionEngine.LifecycleNonceMismatch(positionId, lifecycle.lifecycleNonce, expectedLifecycleNonce);
        }
    }

    function _requireQuantity(PositionId positionId, PositionLifecycle storage lifecycle, Lots requested)
        internal
        view
        returns (uint128 quantity)
    {
        quantity = Lots.unwrap(requested);
        uint128 remaining = Lots.unwrap(lifecycle.remainingLots);
        if (quantity == 0 || quantity > remaining) {
            revert IPositionEngine.InvalidPositionQuantity(positionId, remaining, quantity);
        }
    }

    function _requireLapseOpen(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        PositionId positionId
    ) internal view {
        PositionEconomics storage economics = $economics[positionId];
        if (
            ExercisePolicyId.unwrap(economics.exercisePolicyId)
                    != ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)
                || block.timestamp <= economics.exerciseCutoffAt
        ) {
            revert IPositionEngine.FixingWindowNotOpen(
                positionId, economics.exerciseCutoffAt + 1, uint64(block.timestamp)
            );
        }
    }

    function _isZeroLiabilityAlternative(PositionStatus status) internal pure returns (bool) {
        return status == PositionStatus.ClosedByUnwind || status == PositionStatus.Replaced
            || status == PositionStatus.Lapsed || status == PositionStatus.CancelledByDisruption
            || status == PositionStatus.Abandoned;
    }
}
