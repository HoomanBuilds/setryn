// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICompressionAuthority} from "../interfaces/ICompressionAuthority.sol";
import {ICompressionCoordinator} from "../interfaces/ICompressionCoordinator.sol";
import {ICompressionLifecycleExecutor} from "../interfaces/ICompressionLifecycleExecutor.sol";
import {ICompressionPositionSource} from "../interfaces/ICompressionPositionSource.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {CompressionLib} from "../libraries/CompressionLib.sol";
import {AccountId, PositionId, RiskDomainId} from "../types/Identifiers.sol";
import {
    CompressionConsent,
    CompressionPlanDefinition,
    CompressionPlanId,
    CompressionPlanRecord,
    CompressionPlanStatus,
    CompressionPosition,
    CompressionSuccessor,
    ReplacementCollateral
} from "../types/CompressionTypes.sol";

contract CompressionCoordinator is ICompressionCoordinator, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant COMPRESSION_GUARDIAN_ROLE = keccak256("SETRYN_COMPRESSION_GUARDIAN_ROLE");

    ICompressionPositionSource public immutable positionSource;
    ICompressionAuthority public immutable accountAuthority;
    ICompressionLifecycleExecutor public immutable lifecycleExecutor;
    IRiskDomainRegistry public immutable riskDomainRegistry;

    mapping(CompressionPlanId planId => CompressionPlanRecord record) private _plans;
    mapping(bytes32 planNonce => bool used) private _usedPlanNonces;
    mapping(AccountId accountId => mapping(uint256 nonce => bool used)) private _usedConsentNonces;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        ICompressionPositionSource positionSource_,
        ICompressionAuthority accountAuthority_,
        ICompressionLifecycleExecutor lifecycleExecutor_,
        IRiskDomainRegistry riskDomainRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, initialAdmin) {
        _requireDependency(address(positionSource_));
        _requireDependency(address(accountAuthority_));
        _requireDependency(address(lifecycleExecutor_));
        _requireDependency(address(riskDomainRegistry_));
        positionSource = positionSource_;
        accountAuthority = accountAuthority_;
        lifecycleExecutor = lifecycleExecutor_;
        riskDomainRegistry = riskDomainRegistry_;
        _grantRole(COMPRESSION_GUARDIAN_ROLE, initialAdmin);
    }

    function authorizeCompression(
        CompressionPlanDefinition calldata definition,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral,
        CompressionConsent[] calldata consents,
        bytes[] calldata signatures
    ) external nonReentrant returns (CompressionPlanId planId) {
        if (_usedPlanNonces[definition.planNonce]) {
            revert PlanNonceAlreadyUsed(definition.planNonce);
        }
        bytes32 definitionHash = _validateDefinition(definition, inputs, successors, replacementCollateral, consents);
        planId = CompressionLib.derivePlanId(definitionHash);
        if (_plans[planId].status != CompressionPlanStatus.Unspecified) revert InvalidCompressionPlanState(planId);
        _validateConsents(
            planId, definition.qualificationHash, definition.deadline, inputs, successors, consents, signatures
        );
        _usedPlanNonces[definition.planNonce] = true;
        _plans[planId] = CompressionPlanRecord({
            definitionHash: definitionHash, executionOutcomeHash: bytes32(0), status: CompressionPlanStatus.Authorized
        });
        emit CompressionAuthorized(
            planId,
            definitionHash,
            definition.planNonce,
            definition.inputCount,
            definition.successorCount,
            definition.accountCount
        );
    }

    function executeCompression(
        CompressionPlanDefinition calldata definition,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral
    ) external nonReentrant returns (bytes32 outcomeHash) {
        bytes32 definitionHash = CompressionLib.hashDefinition(definition, block.chainid, address(this));
        CompressionPlanId planId = CompressionLib.derivePlanId(definitionHash);
        CompressionPlanRecord storage plan = _requirePlan(planId);
        if (plan.status != CompressionPlanStatus.Authorized || plan.definitionHash != definitionHash) {
            revert InvalidCompressionPlanState(planId);
        }
        if (block.timestamp > definition.deadline) {
            revert CompressionDeadlinePassed(definition.deadline, block.timestamp);
        }
        _validateCommittedPayload(definition, inputs, successors, replacementCollateral);
        _validatePositionRecords(inputs);
        if (!riskDomainRegistry.isLifecycleEnabled(definition.riskDomainId, definition.riskDomainVersion)) {
            revert CrossRiskDomainCompression();
        }
        plan.status = CompressionPlanStatus.Executing;
        outcomeHash = lifecycleExecutor.executeCompression(planId, inputs, successors, replacementCollateral);
        if (outcomeHash == bytes32(0)) revert ZeroReference();
        plan.executionOutcomeHash = outcomeHash;
        plan.status = CompressionPlanStatus.Executed;
        emit CompressionExecuted(planId, outcomeHash);
    }

    function cancelCompression(CompressionPlanId planId, bytes32 reason)
        external
        onlyRole(COMPRESSION_GUARDIAN_ROLE)
        nonReentrant
    {
        if (reason == bytes32(0)) revert ZeroReference();
        CompressionPlanRecord storage plan = _requirePlan(planId);
        if (plan.status != CompressionPlanStatus.Authorized) revert InvalidCompressionPlanState(planId);
        plan.status = CompressionPlanStatus.Cancelled;
        emit CompressionCancelled(planId, reason);
    }

    function expireCompression(CompressionPlanDefinition calldata definition) external nonReentrant {
        bytes32 definitionHash = CompressionLib.hashDefinition(definition, block.chainid, address(this));
        CompressionPlanId planId = CompressionLib.derivePlanId(definitionHash);
        CompressionPlanRecord storage plan = _requirePlan(planId);
        if (plan.status != CompressionPlanStatus.Authorized) revert InvalidCompressionPlanState(planId);
        if (block.timestamp <= definition.deadline) {
            revert CompressionDeadlinePassed(definition.deadline, block.timestamp);
        }
        plan.status = CompressionPlanStatus.Expired;
        emit CompressionExpired(planId);
    }

    function getCompressionPlan(CompressionPlanId planId) external view returns (CompressionPlanRecord memory record) {
        return _requirePlan(planId);
    }

    function _validateDefinition(
        CompressionPlanDefinition calldata definition,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral,
        CompressionConsent[] calldata consents
    ) private view returns (bytes32 definitionHash) {
        if (
            definition.namespaceId == bytes32(0) || definition.planNonce == bytes32(0)
                || RiskDomainId.unwrap(definition.riskDomainId) == bytes32(0) || definition.riskDomainVersion == 0
                || definition.deadline < block.timestamp || definition.qualificationHash == bytes32(0)
                || definition.inputCount != inputs.length || definition.successorCount != successors.length
                || definition.accountCount != consents.length
        ) revert InvalidCompressionDefinition();
        if (!riskDomainRegistry.isLifecycleEnabled(definition.riskDomainId, definition.riskDomainVersion)) {
            revert CrossRiskDomainCompression();
        }
        _validateCommittedPayload(definition, inputs, successors, replacementCollateral);
        _validatePositionRecords(inputs);
        CompressionLib.validateConservation(definition, inputs, successors, replacementCollateral, consents);
        definitionHash = CompressionLib.hashDefinition(definition, block.chainid, address(this));
    }

    function _validateCommittedPayload(
        CompressionPlanDefinition calldata definition,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        ReplacementCollateral[] calldata replacementCollateral
    ) private pure {
        if (
            CompressionLib.hashInputs(inputs) != definition.inputsHash
                || CompressionLib.hashSuccessors(successors) != definition.successorsHash
                || CompressionLib.hashReplacementCollateral(replacementCollateral)
                    != definition.replacementCollateralHash || definition.inputCount != inputs.length
                || definition.successorCount != successors.length
                || definition.accountCount != replacementCollateral.length
        ) revert InvalidCompressionDefinition();
    }

    function _validatePositionRecords(CompressionPosition[] calldata inputs) private view {
        for (uint256 i; i < inputs.length; ++i) {
            if (!positionSource.isCompressionEligible(inputs[i].positionId)) {
                revert PositionNotCompressionEligible(PositionId.unwrap(inputs[i].positionId));
            }
            CompressionPosition memory authoritative = positionSource.getCompressionPosition(inputs[i].positionId);
            if (CompressionLib.hashPosition(authoritative) != CompressionLib.hashPosition(inputs[i])) {
                revert PositionRecordMismatch(PositionId.unwrap(inputs[i].positionId));
            }
        }
    }

    function _validateConsents(
        CompressionPlanId planId,
        bytes32 qualificationHash,
        uint64 planDeadline,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors,
        CompressionConsent[] calldata consents,
        bytes[] calldata signatures
    ) private {
        if (consents.length == 0 || consents.length != signatures.length) {
            revert InvalidCompressionDefinition();
        }
        bytes32 previous;
        for (uint256 i; i < consents.length; ++i) {
            CompressionConsent calldata consent = consents[i];
            bytes32 accountId = AccountId.unwrap(consent.accountId);
            if (
                accountId == bytes32(0) || accountId <= previous
                    || CompressionPlanId.unwrap(consent.planId) != CompressionPlanId.unwrap(planId)
                    || consent.signer == address(0) || consent.salt == bytes32(0) || consent.deadline < block.timestamp
                    || consent.deadline > planDeadline || !_accountParticipates(consent.accountId, inputs, successors)
            ) revert MissingAccountConsent(accountId);
            if (_usedConsentNonces[consent.accountId][consent.nonce]) {
                revert ConsentNonceAlreadyUsed(accountId, consent.nonce);
            }
            if (!accountAuthority.consumeAuthorizedSigner(
                    consent.accountId, consent.signer, qualificationHash, consent.nonce
                )) {
                revert InvalidConsentSignature(accountId, consent.signer);
            }
            bytes32 digest = CompressionLib.consentDigest(consent, block.chainid, address(this));
            if (!SignatureChecker.isValidSignatureNowCalldata(consent.signer, digest, signatures[i])) {
                revert InvalidConsentSignature(accountId, consent.signer);
            }
            _usedConsentNonces[consent.accountId][consent.nonce] = true;
            previous = accountId;
        }
        for (uint256 i; i < inputs.length; ++i) {
            _requireConsent(inputs[i].longAccountId, consents);
            _requireConsent(inputs[i].shortAccountId, consents);
        }
        for (uint256 i; i < successors.length; ++i) {
            _requireConsent(successors[i].longAccountId, consents);
            _requireConsent(successors[i].shortAccountId, consents);
        }
    }

    function _requireConsent(AccountId accountId, CompressionConsent[] calldata consents) private pure {
        for (uint256 i; i < consents.length; ++i) {
            if (AccountId.unwrap(consents[i].accountId) == AccountId.unwrap(accountId)) return;
        }
        revert MissingAccountConsent(AccountId.unwrap(accountId));
    }

    function _accountParticipates(
        AccountId accountId,
        CompressionPosition[] calldata inputs,
        CompressionSuccessor[] calldata successors
    ) private pure returns (bool) {
        for (uint256 i; i < inputs.length; ++i) {
            if (
                AccountId.unwrap(inputs[i].longAccountId) == AccountId.unwrap(accountId)
                    || AccountId.unwrap(inputs[i].shortAccountId) == AccountId.unwrap(accountId)
            ) return true;
        }
        for (uint256 i; i < successors.length; ++i) {
            if (
                AccountId.unwrap(successors[i].longAccountId) == AccountId.unwrap(accountId)
                    || AccountId.unwrap(successors[i].shortAccountId) == AccountId.unwrap(accountId)
            ) return true;
        }
        return false;
    }

    function _requirePlan(CompressionPlanId planId) private view returns (CompressionPlanRecord storage plan) {
        plan = _plans[planId];
        if (plan.status == CompressionPlanStatus.Unspecified) revert UnknownCompressionPlan(planId);
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
