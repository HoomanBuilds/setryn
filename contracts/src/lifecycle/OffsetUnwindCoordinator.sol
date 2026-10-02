// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ILifecycleAtomicExecutor} from "../interfaces/ILifecycleAtomicExecutor.sol";
import {ILifecyclePolicyValidator} from "../interfaces/ILifecyclePolicyValidator.sol";
import {ILifecyclePositionSource} from "../interfaces/ILifecyclePositionSource.sol";
import {IOffsetUnwindCoordinator} from "../interfaces/IOffsetUnwindCoordinator.sol";
import {LifecycleHashLib} from "../libraries/LifecycleHashLib.sol";
import {AccountId, CollateralId, FeeScheduleId, PositionId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleActionKind,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecycleInput,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";
import {PositionExerciseState} from "../types/PositionTypes.sol";
import {Lots} from "../types/Units.sol";

/// @dev The signed lifecycle engine's dependency graph, read once so both paths execute through the same executor,
/// policy validator and position source.
interface ILifecycleEngineGraph {
    function positionSource() external view returns (ILifecyclePositionSource);
    function policyValidator() external view returns (ILifecyclePolicyValidator);
    function atomicExecutor() external view returns (ILifecycleAtomicExecutor);
}

/// @notice Closes two exactly mirrored positions between the same two accounts in one full unwind.
///
/// @dev A trader exits a position by trading the opposite side with the same counterparty: the fill opens a mirror
/// position, and the pair together has no exposure left. This contract closes such a pair as a `FullUnwind` through the
/// same atomic lifecycle executor, position source and lifecycle policy validator as the signed lifecycle engine. It
/// replaces the engine's actor and consent signatures with its caller's authority, so it only accepts a pair that is an
/// exact mirror: same series and version, same collateral, same lots, the long of one the short of the other, both
/// live, untouched by exercise (still awaiting their fixing or with no election made) and outside any package. Closing such a pair releases both sides' collateral and leaves
/// each account's terminal flows unchanged. Callers hold `OFFSET_UNWINDER_ROLE`; the quote settlement router uses it to
/// close a position in the same transaction as the fill that offsets it, with both parties' signed consent.
contract OffsetUnwindCoordinator is IOffsetUnwindCoordinator, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant OFFSET_UNWINDER_ROLE = keccak256("SETRYN_OFFSET_UNWINDER_ROLE");
    bytes32 private constant PARTICIPANTS_TAG = keccak256("SetrynOffsetUnwindParticipantsV1");
    bytes32 private constant CONSENTS_TAG = keccak256("SetrynOffsetUnwindCallerConsentV1");

    ILifecyclePositionSource public immutable positionSource;
    ILifecyclePolicyValidator public immutable policyValidator;
    ILifecycleAtomicExecutor public immutable atomicExecutor;

    constructor(uint48 defaultAdminDelay, address initialAdmin, address signedLifecycleEngine)
        AccessControlDefaultAdminRules(defaultAdminDelay, initialAdmin)
    {
        _requireDependency(signedLifecycleEngine);
        ILifecycleEngineGraph graph = ILifecycleEngineGraph(signedLifecycleEngine);
        positionSource = graph.positionSource();
        policyValidator = graph.policyValidator();
        atomicExecutor = graph.atomicExecutor();
        _requireDependency(address(positionSource));
        _requireDependency(address(policyValidator));
        _requireDependency(address(atomicExecutor));
    }

    /// @notice Closes `firstPositionId` and `secondPositionId`, an exact mirror pair, in one full unwind.
    /// @param initiatorAccountId The party the caller acts for; it must hold one side of the pair.
    /// @param unwindReference The caller's reference, committed into the action id (the router passes the fill id).
    function unwindOffset(
        PositionId firstPositionId,
        PositionId secondPositionId,
        AccountId initiatorAccountId,
        bytes32 unwindReference
    ) external onlyRole(OFFSET_UNWINDER_ROLE) nonReentrant returns (LifecycleActionId actionId, bytes32 outcomeHash) {
        if (unwindReference == bytes32(0)) revert ZeroReference();
        // Inputs are committed in ascending position id order.
        (PositionId low, PositionId high) = PositionId.unwrap(firstPositionId) < PositionId.unwrap(secondPositionId)
            ? (firstPositionId, secondPositionId)
            : (secondPositionId, firstPositionId);
        LifecyclePositionSnapshot[] memory snapshots = new LifecyclePositionSnapshot[](2);
        snapshots[0] = _eligibleSnapshot(low);
        snapshots[1] = _eligibleSnapshot(high);
        _requireMirror(snapshots[0], snapshots[1]);
        AccountId counterpartyAccountId = _counterparty(snapshots[0], initiatorAccountId);

        LifecycleInput[] memory inputs = new LifecycleInput[](2);
        for (uint256 i; i < 2; ++i) {
            inputs[i] = LifecycleInput({
                positionId: snapshots[i].positionId,
                expectedImmutableHash: snapshots[i].immutableHash,
                expectedLifecycleHash: snapshots[i].lifecycleHash,
                expectedPositionLots: snapshots[i].positionLots,
                actionLots: snapshots[i].positionLots
            });
        }
        // Nothing survives the unwind, so each party's replacement backing is zero.
        LifecycleCollateralReplacement[] memory replacements = _replacements(snapshots[0]);
        LifecycleSuccessor[] memory successors = new LifecycleSuccessor[](0);
        LifecycleConsent[] memory consents = new LifecycleConsent[](0);

        LifecycleAction memory action = _action(snapshots[0], inputs, replacements, initiatorAccountId, unwindReference);
        action.participantSetHash =
            keccak256(abi.encode(PARTICIPANTS_TAG, initiatorAccountId, counterpartyAccountId, msg.sender));
        (action.policyContextHash,) = policyValidator.derivePolicyContext(action, snapshots, successors);
        policyValidator.validateLifecycleAction(action, snapshots, successors, replacements, consents);

        actionId = LifecycleHashLib.deriveActionId(LifecycleHashLib.hashAction(action, block.chainid, address(this)));
        outcomeHash = atomicExecutor.executeLifecycleAction(actionId, action, inputs, successors, replacements);
        if (outcomeHash == bytes32(0)) revert ZeroReference();
        emit OffsetUnwound(
            actionId,
            low,
            high,
            initiatorAccountId,
            counterpartyAccountId,
            Lots.unwrap(snapshots[0].positionLots),
            unwindReference,
            outcomeHash,
            msg.sender
        );
    }

    function _eligibleSnapshot(PositionId positionId) private view returns (LifecyclePositionSnapshot memory snapshot) {
        if (!positionSource.isLifecycleActionEligible(positionId, LifecycleActionKind.FullUnwind)) {
            revert PositionIneligible(positionId);
        }
        snapshot = positionSource.getLifecyclePosition(positionId);
        if (
            PositionId.unwrap(snapshot.positionId) != PositionId.unwrap(positionId)
                || Lots.unwrap(snapshot.positionLots) == 0
                || Lots.unwrap(snapshot.remainingExerciseLots) != Lots.unwrap(snapshot.positionLots)
                || (snapshot.exerciseState != PositionExerciseState.AwaitingFixing
                    && snapshot.exerciseState != PositionExerciseState.ElectionOpen)
                || snapshot.packageProvenanceHash != bytes32(0)
        ) revert PositionIneligible(positionId);
    }

    function _requireMirror(LifecyclePositionSnapshot memory a, LifecyclePositionSnapshot memory b) private pure {
        if (
            PositionId.unwrap(a.positionId) == PositionId.unwrap(b.positionId)
                || SeriesId.unwrap(a.seriesId) != SeriesId.unwrap(b.seriesId) || a.seriesVersion != b.seriesVersion
                || AccountId.unwrap(a.longAccountId) != AccountId.unwrap(b.shortAccountId)
                || AccountId.unwrap(a.shortAccountId) != AccountId.unwrap(b.longAccountId)
                || AccountId.unwrap(a.longAccountId) == AccountId.unwrap(a.shortAccountId)
                || CollateralId.unwrap(a.collateralId) != CollateralId.unwrap(b.collateralId)
                || RiskDomainId.unwrap(a.riskDomainId) != RiskDomainId.unwrap(b.riskDomainId)
                || a.riskDomainVersion != b.riskDomainVersion
                || FeeScheduleId.unwrap(a.feeScheduleId) != FeeScheduleId.unwrap(b.feeScheduleId)
                || a.feeScheduleVersion != b.feeScheduleVersion
                || Lots.unwrap(a.positionLots) != Lots.unwrap(b.positionLots)
        ) revert NotAnOffset(a.positionId, b.positionId);
    }

    function _counterparty(LifecyclePositionSnapshot memory a, AccountId initiator) private pure returns (AccountId) {
        if (AccountId.unwrap(initiator) == AccountId.unwrap(a.longAccountId)) return a.shortAccountId;
        if (AccountId.unwrap(initiator) == AccountId.unwrap(a.shortAccountId)) return a.longAccountId;
        revert InitiatorNotParty(initiator);
    }

    function _replacements(LifecyclePositionSnapshot memory a)
        private
        pure
        returns (LifecycleCollateralReplacement[] memory replacements)
    {
        (AccountId first, AccountId second) = AccountId.unwrap(a.longAccountId) < AccountId.unwrap(a.shortAccountId)
            ? (a.longAccountId, a.shortAccountId)
            : (a.shortAccountId, a.longAccountId);
        replacements = new LifecycleCollateralReplacement[](2);
        replacements[0] = LifecycleCollateralReplacement(first, a.collateralId, 0);
        replacements[1] = LifecycleCollateralReplacement(second, a.collateralId, 0);
    }

    function _action(
        LifecyclePositionSnapshot memory a,
        LifecycleInput[] memory inputs,
        LifecycleCollateralReplacement[] memory replacements,
        AccountId initiatorAccountId,
        bytes32 unwindReference
    ) private view returns (LifecycleAction memory action) {
        action.kind = LifecycleActionKind.FullUnwind;
        action.actor = msg.sender;
        action.actorAccountId = initiatorAccountId;
        action.inputsHash = LifecycleHashLib.hashInputs(inputs);
        action.successorsHash = keccak256(bytes(""));
        action.collateralReplacementsHash = LifecycleHashLib.hashCollateralReplacements(replacements);
        action.consentsHash = keccak256(abi.encode(CONSENTS_TAG, msg.sender, unwindReference));
        action.riskDomainId = a.riskDomainId;
        action.riskDomainVersion = a.riskDomainVersion;
        action.feeScheduleId = a.feeScheduleId;
        action.feeScheduleVersion = a.feeScheduleVersion;
        action.inputCount = 2;
        action.participantCount = 2;
        action.deadline = uint64(block.timestamp);
        action.nonce = uint256(unwindReference);
        action.permittedExecutor = address(this);
        action.salt = unwindReference;
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert ZeroDependency(dependency);
    }
}
