// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ILifecycleAccountAuthority} from "../interfaces/ILifecycleAccountAuthority.sol";
import {ILifecycleAtomicExecutor} from "../interfaces/ILifecycleAtomicExecutor.sol";
import {ILifecyclePolicyValidator} from "../interfaces/ILifecyclePolicyValidator.sol";
import {ILifecyclePositionSource} from "../interfaces/ILifecyclePositionSource.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISignedLifecycleEngine} from "../interfaces/ISignedLifecycleEngine.sol";
import {LifecycleHashLib} from "../libraries/LifecycleHashLib.sol";
import {LifecycleMathLib} from "../libraries/LifecycleMathLib.sol";
import {AccountId, FeeScheduleId, PositionId, RiskDomainId} from "../types/Identifiers.sol";
import {
    LifecycleAction,
    LifecycleActionId,
    LifecycleActionKind,
    LifecycleActionRecord,
    LifecycleActionStatus,
    LifecycleCollateralReplacement,
    LifecycleConsent,
    LifecycleInput,
    LifecyclePositionSnapshot,
    LifecycleSuccessor
} from "../types/LifecycleTypes.sol";
import {Lots} from "../types/Units.sol";

contract SignedLifecycleEngine is ISignedLifecycleEngine, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant LIFECYCLE_GUARDIAN_ROLE = keccak256("SETRYN_LIFECYCLE_GUARDIAN_ROLE");

    ILifecyclePositionSource public immutable positionSource;
    ILifecycleAccountAuthority public immutable accountAuthority;
    ILifecyclePolicyValidator public immutable policyValidator;
    ILifecycleAtomicExecutor public immutable atomicExecutor;
    IRiskDomainRegistry public immutable riskDomainRegistry;

    mapping(LifecycleActionId actionId => LifecycleActionRecord record) private _actions;
    mapping(AccountId accountId => mapping(uint256 nonce => bool used)) private _usedActorNonces;
    mapping(AccountId accountId => mapping(uint256 nonce => bool used)) private _usedConsentNonces;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        ILifecyclePositionSource positionSource_,
        ILifecycleAccountAuthority accountAuthority_,
        ILifecyclePolicyValidator policyValidator_,
        ILifecycleAtomicExecutor atomicExecutor_,
        IRiskDomainRegistry riskDomainRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, initialAdmin) {
        _requireDependency(address(positionSource_));
        _requireDependency(address(accountAuthority_));
        _requireDependency(address(policyValidator_));
        _requireDependency(address(atomicExecutor_));
        _requireDependency(address(riskDomainRegistry_));
        positionSource = positionSource_;
        accountAuthority = accountAuthority_;
        policyValidator = policyValidator_;
        atomicExecutor = atomicExecutor_;
        riskDomainRegistry = riskDomainRegistry_;
        _grantRole(LIFECYCLE_GUARDIAN_ROLE, initialAdmin);
    }

    function authorizeAction(
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements,
        LifecycleConsent[] calldata consents,
        bytes[] calldata consentSignatures,
        bytes calldata actorSignature
    ) external nonReentrant returns (LifecycleActionId actionId) {
        LifecycleHashLib.validateAction(action);
        if (action.deadline < block.timestamp) revert LifecycleDeadlinePassed(action.deadline, block.timestamp);
        _validateCommittedPayload(action, inputs, successors, collateralReplacements, consents);
        LifecyclePositionSnapshot[] memory snapshots = _loadSnapshots(action, inputs);
        _validateRiskVersions(action, snapshots, successors);
        bytes32 actionHash = LifecycleHashLib.hashAction(action, block.chainid, address(this));
        actionId = LifecycleHashLib.deriveActionId(actionHash);
        if (_actions[actionId].status != LifecycleActionStatus.Unspecified) revert InvalidLifecycleState(actionId);
        if (action.kind == LifecycleActionKind.Lapse) {
            if (consents.length != 0 || consentSignatures.length != 0 || actorSignature.length != 0) {
                revert InvalidLifecycleAction();
            }
        } else {
            _authorizeActor(action, actorSignature);
            _authorizeConsents(actionId, action.policyContextHash, action.deadline, consents, consentSignatures);
        }
        LifecycleMathLib.validate(
            action, inputs, snapshots, successors, collateralReplacements, consents, block.timestamp
        );
        policyValidator.validateLifecycleAction(action, snapshots, successors, collateralReplacements, consents);
        _actions[actionId] = LifecycleActionRecord({
            actionHash: actionHash, executionOutcomeHash: bytes32(0), status: LifecycleActionStatus.Authorized
        });
        emit LifecycleActionAuthorized(
            actionId,
            actionHash,
            uint8(action.kind),
            action.actor,
            AccountId.unwrap(action.actorAccountId),
            action.permittedExecutor
        );
    }

    function executeAction(
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements,
        LifecycleConsent[] calldata consents
    ) external nonReentrant returns (bytes32 outcomeHash) {
        bytes32 actionHash = LifecycleHashLib.hashAction(action, block.chainid, address(this));
        LifecycleActionId actionId = LifecycleHashLib.deriveActionId(actionHash);
        LifecycleActionRecord storage record = _requireAction(actionId);
        if (record.status != LifecycleActionStatus.Authorized || record.actionHash != actionHash) {
            revert InvalidLifecycleState(actionId);
        }
        if (action.deadline < block.timestamp) revert LifecycleDeadlinePassed(action.deadline, block.timestamp);
        if (action.permittedExecutor != address(0) && msg.sender != action.permittedExecutor) {
            revert UnauthorizedExecutor(action.permittedExecutor, msg.sender);
        }
        _validateCommittedPayload(action, inputs, successors, collateralReplacements, consents);
        LifecyclePositionSnapshot[] memory snapshots = _loadSnapshots(action, inputs);
        _validateRiskVersions(action, snapshots, successors);
        LifecycleMathLib.validate(
            action, inputs, snapshots, successors, collateralReplacements, consents, block.timestamp
        );
        policyValidator.validateLifecycleAction(action, snapshots, successors, collateralReplacements, consents);
        record.status = LifecycleActionStatus.Executing;
        outcomeHash =
            atomicExecutor.executeLifecycleAction(actionId, action, inputs, successors, collateralReplacements);
        if (outcomeHash == bytes32(0)) revert ZeroReference();
        record.executionOutcomeHash = outcomeHash;
        record.status = LifecycleActionStatus.Executed;
        emit LifecycleActionExecuted(actionId, outcomeHash);
    }

    function cancelAction(LifecycleActionId actionId, bytes32 reason)
        external
        onlyRole(LIFECYCLE_GUARDIAN_ROLE)
        nonReentrant
    {
        if (reason == bytes32(0)) revert ZeroReference();
        LifecycleActionRecord storage record = _requireAction(actionId);
        if (record.status != LifecycleActionStatus.Authorized) revert InvalidLifecycleState(actionId);
        record.status = LifecycleActionStatus.Cancelled;
        emit LifecycleActionCancelled(actionId, reason);
    }

    function expireAction(LifecycleAction calldata action) external nonReentrant {
        bytes32 actionHash = LifecycleHashLib.hashAction(action, block.chainid, address(this));
        LifecycleActionId actionId = LifecycleHashLib.deriveActionId(actionHash);
        LifecycleActionRecord storage record = _requireAction(actionId);
        if (record.status != LifecycleActionStatus.Authorized) revert InvalidLifecycleState(actionId);
        if (block.timestamp <= action.deadline) revert LifecycleDeadlinePassed(action.deadline, block.timestamp);
        record.status = LifecycleActionStatus.Expired;
        emit LifecycleActionExpired(actionId);
    }

    function getAction(LifecycleActionId actionId) external view returns (LifecycleActionRecord memory record) {
        return _requireAction(actionId);
    }

    function hashLifecycleInputs(LifecycleInput[] calldata inputs) external pure returns (bytes32) {
        return LifecycleHashLib.hashInputs(inputs);
    }

    function hashLifecycleSuccessors(LifecycleSuccessor[] calldata successors) external pure returns (bytes32) {
        return LifecycleHashLib.hashSuccessors(successors);
    }

    function hashLifecycleCollateralReplacements(LifecycleCollateralReplacement[] calldata collateralReplacements)
        external
        pure
        returns (bytes32)
    {
        return LifecycleHashLib.hashCollateralReplacements(collateralReplacements);
    }

    function hashLifecycleParticipantSet(AccountId actorAccountId, LifecycleConsent[] calldata consents)
        external
        pure
        returns (bytes32)
    {
        return LifecycleHashLib.hashParticipantSet(actorAccountId, consents);
    }

    function hashLifecycleConsentTerms(LifecycleConsent[] calldata consents) external pure returns (bytes32) {
        return LifecycleHashLib.hashConsentTerms(consents);
    }

    function hashLifecycleAction(LifecycleAction calldata action)
        external
        view
        returns (bytes32 actionHash, LifecycleActionId actionId, bytes32 digest)
    {
        actionHash = LifecycleHashLib.hashAction(action, block.chainid, address(this));
        actionId = LifecycleHashLib.deriveActionId(actionHash);
        digest = LifecycleHashLib.actionDigest(action, block.chainid, address(this));
    }

    function hashLifecycleConsent(LifecycleConsent calldata consent) external view returns (bytes32 digest) {
        return LifecycleHashLib.consentDigest(consent, block.chainid, address(this));
    }

    function _validateCommittedPayload(
        LifecycleAction calldata action,
        LifecycleInput[] calldata inputs,
        LifecycleSuccessor[] calldata successors,
        LifecycleCollateralReplacement[] calldata collateralReplacements,
        LifecycleConsent[] calldata consents
    ) private pure {
        bytes32 participantSetHash = action.kind == LifecycleActionKind.Lapse
            ? keccak256("SetrynPermissionlessLapseV1")
            : LifecycleHashLib.hashParticipantSet(action.actorAccountId, consents);
        if (
            action.inputCount != inputs.length || action.successorCount != successors.length
                || action.participantCount != (action.kind == LifecycleActionKind.Lapse ? 0 : consents.length + 1)
                || LifecycleHashLib.hashInputs(inputs) != action.inputsHash
                || LifecycleHashLib.hashSuccessors(successors) != action.successorsHash
                || LifecycleHashLib.hashCollateralReplacements(collateralReplacements)
                    != action.collateralReplacementsHash || participantSetHash != action.participantSetHash
                || LifecycleHashLib.hashConsentTerms(consents) != action.consentsHash
        ) revert InvalidLifecyclePayload();
    }

    function _loadSnapshots(LifecycleAction calldata action, LifecycleInput[] calldata inputs)
        private
        view
        returns (LifecyclePositionSnapshot[] memory snapshots)
    {
        snapshots = new LifecyclePositionSnapshot[](inputs.length);
        for (uint256 i; i < inputs.length; ++i) {
            if (!positionSource.isLifecycleActionEligible(inputs[i].positionId, action.kind)) {
                revert PositionActionIneligible(PositionId.unwrap(inputs[i].positionId), uint8(action.kind));
            }
            LifecyclePositionSnapshot memory snapshot = positionSource.getLifecyclePosition(inputs[i].positionId);
            if (
                PositionId.unwrap(snapshot.positionId) != PositionId.unwrap(inputs[i].positionId)
                    || snapshot.immutableHash != inputs[i].expectedImmutableHash
                    || snapshot.lifecycleHash != inputs[i].expectedLifecycleHash
                    || Lots.unwrap(snapshot.positionLots) != Lots.unwrap(inputs[i].expectedPositionLots)
            ) revert PositionSnapshotMismatch(PositionId.unwrap(inputs[i].positionId));
            snapshots[i] = snapshot;
        }
    }

    function _validateRiskVersions(
        LifecycleAction calldata action,
        LifecyclePositionSnapshot[] memory inputs,
        LifecycleSuccessor[] calldata successors
    ) private view {
        bool transition = action.kind == LifecycleActionKind.Amendment || action.kind == LifecycleActionKind.Novation
            || action.kind == LifecycleActionKind.Roll || action.kind == LifecycleActionKind.CollateralPolicyChange;
        for (uint256 i; i < inputs.length; ++i) {
            if (!riskDomainRegistry.isLifecycleEnabled(inputs[i].riskDomainId, inputs[i].riskDomainVersion)) {
                revert RiskDomainUnavailable(RiskDomainId.unwrap(inputs[i].riskDomainId), inputs[i].riskDomainVersion);
            }
            if (!transition) {
                if (
                    RiskDomainId.unwrap(inputs[i].riskDomainId) != RiskDomainId.unwrap(action.riskDomainId)
                        || inputs[i].riskDomainVersion != action.riskDomainVersion
                        || FeeScheduleId.unwrap(inputs[i].feeScheduleId) != FeeScheduleId.unwrap(action.feeScheduleId)
                        || inputs[i].feeScheduleVersion != action.feeScheduleVersion
                ) revert InvalidLifecyclePayload();
            }
        }
        bool requiresOpen =
            action.kind == LifecycleActionKind.Transfer || action.kind == LifecycleActionKind.Assignment || transition;
        for (uint256 i; i < successors.length; ++i) {
            if (
                RiskDomainId.unwrap(successors[i].riskDomainId) != RiskDomainId.unwrap(action.riskDomainId)
                    || successors[i].riskDomainVersion != action.riskDomainVersion
            ) revert InvalidLifecyclePayload();
            bool available = requiresOpen
                ? riskDomainRegistry.isOpenForNewRisk(successors[i].riskDomainId, successors[i].riskDomainVersion)
                : riskDomainRegistry.isLifecycleEnabled(successors[i].riskDomainId, successors[i].riskDomainVersion);
            if (!available) {
                revert RiskDomainUnavailable(
                    RiskDomainId.unwrap(successors[i].riskDomainId), successors[i].riskDomainVersion
                );
            }
        }
    }

    function _authorizeActor(LifecycleAction calldata action, bytes calldata signature) private {
        if (_usedActorNonces[action.actorAccountId][action.nonce]) {
            revert NonceAlreadyUsed(AccountId.unwrap(action.actorAccountId), action.nonce);
        }
        if (!accountAuthority.isAuthorizedSignerForPolicy(
                action.actorAccountId, action.actor, action.policyContextHash
            )) {
            revert InvalidActorSignature(action.actor);
        }
        bytes32 digest = LifecycleHashLib.actionDigest(action, block.chainid, address(this));
        if (!SignatureChecker.isValidSignatureNowCalldata(action.actor, digest, signature)) {
            revert InvalidActorSignature(action.actor);
        }
        _usedActorNonces[action.actorAccountId][action.nonce] = true;
    }

    function _authorizeConsents(
        LifecycleActionId actionId,
        bytes32 policyContextHash,
        uint64 actionDeadline,
        LifecycleConsent[] calldata consents,
        bytes[] calldata signatures
    ) private {
        if (consents.length != signatures.length) {
            revert InvalidLifecyclePayload();
        }
        for (uint256 i; i < consents.length; ++i) {
            LifecycleConsent calldata consent = consents[i];
            if (
                LifecycleActionId.unwrap(consent.actionId) != LifecycleActionId.unwrap(actionId)
                    || consent.deadline < block.timestamp || consent.deadline > actionDeadline
            ) revert InvalidConsentSignature(AccountId.unwrap(consent.accountId), consent.signer);
            if (_usedConsentNonces[consent.accountId][consent.nonce]) {
                revert NonceAlreadyUsed(AccountId.unwrap(consent.accountId), consent.nonce);
            }
            if (!accountAuthority.isAuthorizedSignerForPolicy(consent.accountId, consent.signer, policyContextHash)) {
                revert InvalidConsentSignature(AccountId.unwrap(consent.accountId), consent.signer);
            }
            bytes32 digest = LifecycleHashLib.consentDigest(consent, block.chainid, address(this));
            if (!SignatureChecker.isValidSignatureNowCalldata(consent.signer, digest, signatures[i])) {
                revert InvalidConsentSignature(AccountId.unwrap(consent.accountId), consent.signer);
            }
            _usedConsentNonces[consent.accountId][consent.nonce] = true;
        }
    }

    function _requireAction(LifecycleActionId actionId) private view returns (LifecycleActionRecord storage record) {
        record = _actions[actionId];
        if (record.status == LifecycleActionStatus.Unspecified) revert UnknownLifecycleAction(actionId);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
