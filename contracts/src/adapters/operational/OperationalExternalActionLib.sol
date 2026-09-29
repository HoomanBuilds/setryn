// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IOperationalAdapterExecutor} from "../../interfaces/IOperationalAdapterExecutor.sol";
import {
    IExternalVenueExecutionAdapterV1,
    IOperationalAdapterMetadataV1
} from "../../interfaces/IOperationalAdapters.sol";
import {AdapterDefinitionLib} from "../../libraries/AdapterDefinitionLib.sol";
import {OperationalAdapterLib} from "../../libraries/OperationalAdapterLib.sol";
import {AdapterVersion} from "../../types/AdapterDefinition.sol";
import {AccountId, AdapterId, AdapterKindId, MarketId, PackageId, SeriesId} from "../../types/Identifiers.sol";
import {
    AdapterReference,
    AdapterRuntimeDescriptor,
    ExecutionGuaranteeClass,
    ExternalActionRecord,
    ExternalTerminalFallback,
    ExternalVenueRequest,
    ExternalVenueResult,
    OperationalActionState,
    OperationalBinding
} from "../../types/OperationalAdapterTypes.sol";
import {OperationalExecutorDependencies} from "./OperationalExecutorTypes.sol";
import "./OperationalAdapterExecutor.sol";

/// Linked logic for the operational adapter executor: external venue submission, reconciliation, recovery, and
/// terminalization under precommitted guarantees. Runs through DELEGATECALL in the executor's context.
library OperationalExternalActionLib {
    uint256 internal constant DESCRIPTOR_RETURN_BYTES = 192;
    uint256 internal constant EXECUTION_RETURN_BYTES = 224;
    uint256 internal constant MAX_TYPED_INPUT_BYTES = 2_048;

    function submitExternal(
        OperationalExecutorDependencies memory deps,
        mapping(bytes32 actionId => bool consumed) storage $actionConsumed,
        mapping(
            bytes32 actionId => ExternalActionRecord record
        ) storage $externalActions,
        AdapterReference calldata adapter,
        ExternalVenueRequest calldata request
    ) external returns (bytes32 actionId, ExternalVenueResult memory result) {
        _validateBinding(deps, request.binding);
        bytes32 capability = OperationalAdapterLib.capabilityFor(request.guaranteeClass);
        if (capability == bytes32(0)) revert OperationalAdapterExecutor.UnsupportedGuaranteeClass();
        _validateGuarantee(request);
        actionId = _actionId(adapter, request.binding);
        _consume($actionConsumed, actionId);
        AdapterVersion memory version = _resolve(
            deps,
            adapter,
            OperationalAdapterLib.KIND_VENUE,
            OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capability,
            true,
            true
        );
        bytes memory output = _boundedCall(
            deps,
            version.definition.implementation,
            abi.encodeCall(IExternalVenueExecutionAdapterV1.submitExternalAction, (request)),
            EXECUTION_RETURN_BYTES
        );
        result = abi.decode(output, (ExternalVenueResult));
        _validateExternalResult(request.binding, request.guaranteeClass, result, true);
        bytes32 resultHash = keccak256(output);
        $externalActions[actionId] = ExternalActionRecord({
            requestHash: OperationalAdapterLib.hashExternalRequest(request),
            adapterId: adapter.adapterId,
            adapterVersion: adapter.adapterVersion,
            guaranteeClass: request.guaranteeClass,
            state: result.state,
            timeoutAt: request.timeoutAt,
            recoveryDeadline: request.recoveryDeadline,
            interimExposureOwner: request.interimExposureOwner,
            recoveryPolicyHash: request.recoveryPolicyHash,
            minValue: request.binding.minValue,
            maxValue: request.binding.maxValue,
            maximumResidual: request.maximumResidual,
            expectedPostconditionsHash: request.binding.expectedPostconditionsHash,
            terminalFallback: request.terminalFallback,
            resultHash: resultHash
        });
        emit IOperationalAdapterExecutor.ExternalActionAdvanced(
            actionId,
            adapter.adapterId,
            adapter.adapterVersion,
            uint8(OperationalActionState.Unspecified),
            uint8(result.state),
            resultHash
        );
    }

    function reconcileExternal(
        OperationalExecutorDependencies memory deps,
        mapping(bytes32 actionId => ExternalActionRecord record) storage $externalActions,
        bytes32 actionId
    ) external returns (ExternalVenueResult memory result) {
        ExternalActionRecord storage record = _requireExternalAction($externalActions, actionId);
        if (OperationalAdapterLib.terminal(record.state)) revert OperationalAdapterExecutor.TerminalAction(actionId);
        if (record.guaranteeClass == ExecutionGuaranteeClass.BoundedAsync && block.timestamp > record.recoveryDeadline)
        {
            revert OperationalAdapterExecutor.RecoveryDeadlineElapsed(record.recoveryDeadline, block.timestamp);
        }
        AdapterReference memory adapterRef = AdapterReference(record.adapterId, record.adapterVersion);
        bytes32 capability = OperationalAdapterLib.capabilityFor(record.guaranteeClass);
        AdapterVersion memory version = _resolve(
            deps,
            adapterRef,
            OperationalAdapterLib.KIND_VENUE,
            OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capability,
            true,
            false
        );
        bytes memory output = _boundedStaticCall(
            deps,
            version.definition.implementation,
            abi.encodeCall(IExternalVenueExecutionAdapterV1.reconcileExternalAction, (record.requestHash)),
            EXECUTION_RETURN_BYTES
        );
        result = abi.decode(output, (ExternalVenueResult));
        _advance(actionId, record, result, output);
    }

    function recoverExternal(
        OperationalExecutorDependencies memory deps,
        mapping(bytes32 actionId => ExternalActionRecord record) storage $externalActions,
        bytes32 actionId
    ) external returns (ExternalVenueResult memory result) {
        ExternalActionRecord storage record = _requireExternalAction($externalActions, actionId);
        if (OperationalAdapterLib.terminal(record.state)) revert OperationalAdapterExecutor.TerminalAction(actionId);
        if (block.timestamp < record.timeoutAt || block.timestamp > record.recoveryDeadline) {
            revert OperationalAdapterExecutor.RecoveryNotAvailable(
                record.timeoutAt, record.recoveryDeadline, block.timestamp
            );
        }
        AdapterReference memory adapterRef = AdapterReference(record.adapterId, record.adapterVersion);
        AdapterVersion memory version = _resolve(
            deps,
            adapterRef,
            OperationalAdapterLib.KIND_VENUE,
            OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC,
            true,
            false
        );
        bytes memory output = _boundedCall(
            deps,
            version.definition.implementation,
            abi.encodeCall(IExternalVenueExecutionAdapterV1.recoverExternalAction, (record.requestHash)),
            EXECUTION_RETURN_BYTES
        );
        result = abi.decode(output, (ExternalVenueResult));
        _advance(actionId, record, result, output);
    }

    function terminalizeExternal(
        mapping(bytes32 actionId => ExternalActionRecord record) storage $externalActions,
        bytes32 actionId
    ) external returns (ExternalVenueResult memory result) {
        ExternalActionRecord storage record = _requireExternalAction($externalActions, actionId);
        if (OperationalAdapterLib.terminal(record.state)) revert OperationalAdapterExecutor.TerminalAction(actionId);
        if (record.guaranteeClass != ExecutionGuaranteeClass.BoundedAsync || block.timestamp <= record.recoveryDeadline)
        {
            revert OperationalAdapterExecutor.RecoveryDeadlineNotReached(record.recoveryDeadline, block.timestamp);
        }
        ExternalTerminalFallback memory fallbackResult = record.terminalFallback;
        result = ExternalVenueResult({
            state: fallbackResult.state,
            realizedValue: fallbackResult.realizedValue,
            residualValue: fallbackResult.residualValue,
            postconditionsHash: fallbackResult.postconditionsHash,
            venueActionReference: record.requestHash,
            evidenceHash: record.recoveryPolicyHash,
            recoveryOutcomeHash: fallbackResult.outcomeHash
        });
        _advance(actionId, record, result, abi.encode(result));
    }

    function _validateGuarantee(ExternalVenueRequest calldata request) internal view {
        if (request.guaranteeClass == ExecutionGuaranteeClass.AtomicSameDomain) {
            if (
                request.timeoutAt != 0 || request.recoveryDeadline != 0
                    || AccountId.unwrap(request.interimExposureOwner) != bytes32(0)
                    || request.recoveryPolicyHash != bytes32(0) || request.maximumResidual != 0
                    || request.terminalFallback.state != OperationalActionState.Unspecified
                    || request.terminalFallback.realizedValue != 0 || request.terminalFallback.residualValue != 0
                    || request.terminalFallback.postconditionsHash != bytes32(0)
                    || request.terminalFallback.outcomeHash != bytes32(0)
            ) revert OperationalAdapterExecutor.InvalidAsyncBounds();
            return;
        }
        if (
            request.timeoutAt <= request.binding.deadline || request.recoveryDeadline <= request.timeoutAt
                || AccountId.unwrap(request.interimExposureOwner) == bytes32(0)
                || request.recoveryPolicyHash == bytes32(0) || request.reservationHash == bytes32(0)
                || request.maximumResidual > _maximumAbsoluteBound(request.binding.minValue, request.binding.maxValue)
        ) revert OperationalAdapterExecutor.InvalidAsyncBounds();
        _validateTerminalResult(
            request.binding.minValue,
            request.binding.maxValue,
            request.binding.expectedPostconditionsHash,
            request.maximumResidual,
            request.guaranteeClass,
            ExternalVenueResult({
                state: request.terminalFallback.state,
                realizedValue: request.terminalFallback.realizedValue,
                residualValue: request.terminalFallback.residualValue,
                postconditionsHash: request.terminalFallback.postconditionsHash,
                venueActionReference: request.recoveryPolicyHash,
                evidenceHash: request.recoveryPolicyHash,
                recoveryOutcomeHash: request.terminalFallback.outcomeHash
            })
        );
    }

    function _validateExternalResult(
        OperationalBinding calldata binding,
        ExecutionGuaranteeClass guaranteeClass,
        ExternalVenueResult memory result,
        bool initial
    ) internal pure {
        if (result.venueActionReference == bytes32(0) || result.evidenceHash == bytes32(0)) revert OperationalAdapterExecutor.InvalidResult();
        if (guaranteeClass == ExecutionGuaranteeClass.AtomicSameDomain) {
            _validateTerminalResult(
                binding.minValue, binding.maxValue, binding.expectedPostconditionsHash, 0, guaranteeClass, result
            );
            return;
        }
        if (
            initial && result.state != OperationalActionState.Submitted
                && result.state != OperationalActionState.Included && result.state != OperationalActionState.Unknown
        ) revert OperationalAdapterExecutor.InvalidResult();
        if (
            initial
                && (result.residualValue != 0
                    || result.postconditionsHash != bytes32(0)
                    || result.recoveryOutcomeHash != bytes32(0))
        ) revert OperationalAdapterExecutor.InvalidResult();
    }

    function _advance(
        bytes32 actionId,
        ExternalActionRecord storage record,
        ExternalVenueResult memory result,
        bytes memory output
    ) internal {
        OperationalActionState previous = record.state;
        if (!OperationalAdapterLib.isAsyncProgression(previous, result.state)) {
            revert OperationalAdapterExecutor.InvalidStateTransition(previous, result.state);
        }
        if (result.venueActionReference == bytes32(0) || result.evidenceHash == bytes32(0)) {
            revert OperationalAdapterExecutor.InvalidResult();
        }
        if (OperationalAdapterLib.terminal(result.state)) {
            _validateTerminalResult(
                record.minValue,
                record.maxValue,
                record.expectedPostconditionsHash,
                record.maximumResidual,
                record.guaranteeClass,
                result
            );
        } else if (
            result.residualValue != 0 || result.postconditionsHash != bytes32(0)
                || result.recoveryOutcomeHash != bytes32(0)
        ) {
            revert OperationalAdapterExecutor.InvalidResult();
        }
        bytes32 resultHash = keccak256(output);
        record.state = result.state;
        record.resultHash = resultHash;
        emit IOperationalAdapterExecutor.ExternalActionAdvanced(
            actionId, record.adapterId, record.adapterVersion, uint8(previous), uint8(result.state), resultHash
        );
    }

    function _validateTerminalResult(
        int256 minValue,
        int256 maxValue,
        bytes32 expectedPostconditionsHash,
        uint256 maximumResidual,
        ExecutionGuaranteeClass guaranteeClass,
        ExternalVenueResult memory result
    ) internal pure {
        if (
            !OperationalAdapterLib.terminal(result.state) || result.realizedValue < minValue
                || result.realizedValue > maxValue || result.postconditionsHash != expectedPostconditionsHash
                || _absolute(result.residualValue) > maximumResidual
        ) revert OperationalAdapterExecutor.InvalidResult();
        if (result.state == OperationalActionState.Complete) {
            if (result.residualValue != 0 || result.recoveryOutcomeHash != bytes32(0)) {
                revert OperationalAdapterExecutor.InvalidResult();
            }
            return;
        }
        if (guaranteeClass != ExecutionGuaranteeClass.BoundedAsync || result.recoveryOutcomeHash == bytes32(0)) {
            revert OperationalAdapterExecutor.InvalidResult();
        }
        if (result.state == OperationalActionState.NoEffect && (result.realizedValue != 0 || result.residualValue != 0))
        {
            revert OperationalAdapterExecutor.InvalidResult();
        }
    }

    function _absolute(int256 value) internal pure returns (uint256) {
        if (value >= 0) return uint256(value);
        if (value == type(int256).min) return uint256(type(int256).max) + 1;
        return uint256(-value);
    }

    function _maximumAbsoluteBound(int256 minimum, int256 maximum) internal pure returns (uint256) {
        uint256 minimumAbsolute = _absolute(minimum);
        uint256 maximumAbsolute = _absolute(maximum);
        return minimumAbsolute > maximumAbsolute ? minimumAbsolute : maximumAbsolute;
    }

    function _resolve(
        OperationalExecutorDependencies memory deps,
        AdapterReference memory adapterRef,
        AdapterKindId expectedKind,
        bytes32 expectedInterface,
        bytes32 expectedCapability,
        bool valueMoving,
        bool newRisk
    ) internal view returns (AdapterVersion memory version) {
        bool available = newRisk
            ? deps.adapterRegistry.isOpenForNewRisk(adapterRef.adapterId, adapterRef.adapterVersion)
            : deps.adapterRegistry.isLifecycleEnabled(adapterRef.adapterId, adapterRef.adapterVersion);
        if (!available) {
            revert OperationalAdapterExecutor.AdapterUnavailable(adapterRef.adapterId, adapterRef.adapterVersion);
        }
        version = deps.adapterRegistry.getAdapter(adapterRef.adapterId, adapterRef.adapterVersion);
        if (
            version.version != adapterRef.adapterVersion
                || AdapterId.unwrap(AdapterDefinitionLib.deriveAdapterId(version.definition))
                    != AdapterId.unwrap(adapterRef.adapterId)
                || version.definitionHash != AdapterDefinitionLib.hashDefinition(version.definition, block.chainid)
                || version.versionHash
                    != AdapterDefinitionLib.hashVersion(
                        adapterRef.adapterId, adapterRef.adapterVersion, version.definitionHash, block.chainid
                    )
        ) revert OperationalAdapterExecutor.AdapterRecordMismatch(adapterRef.adapterId, adapterRef.adapterVersion);
        if (
            AdapterKindId.unwrap(version.definition.kindId) != AdapterKindId.unwrap(expectedKind)
                || version.definition.interfaceHash != expectedInterface
                || version.definition.capabilityHash != expectedCapability
        ) revert OperationalAdapterExecutor.AdapterDefinitionMismatch();
        if (!deps.adapterRegistry.runtimeMatches(adapterRef.adapterId, adapterRef.adapterVersion)) {
            revert OperationalAdapterExecutor.AdapterRuntimeMismatch();
        }
        bytes memory output = _boundedStaticCallRaw(
            version.definition.implementation,
            abi.encodeCall(IOperationalAdapterMetadataV1.operationalAdapterDescriptor, ()),
            DESCRIPTOR_RETURN_BYTES,
            deps.readGasLimit
        );
        AdapterRuntimeDescriptor memory descriptor = abi.decode(output, (AdapterRuntimeDescriptor));
        if (
            descriptor.self != version.definition.implementation || descriptor.chainId != block.chainid
                || descriptor.interfaceHash != expectedInterface || descriptor.capabilityHash != expectedCapability
        ) revert OperationalAdapterExecutor.AdapterDescriptorMismatch();
        if (!descriptor.proxyFree) revert OperationalAdapterExecutor.ProxyAdapterForbidden();
        if (descriptor.valueMoving != valueMoving) {
            revert OperationalAdapterExecutor.ValueMovementMismatch(valueMoving, descriptor.valueMoving);
        }
    }

    function _validateBinding(OperationalExecutorDependencies memory deps, OperationalBinding calldata binding)
        internal
        view
    {
        if (
            binding.chainId != block.chainid || binding.deploymentId != deps.deploymentId
                || AccountId.unwrap(binding.accountId) == bytes32(0) || MarketId.unwrap(binding.marketId) == bytes32(0)
                || SeriesId.unwrap(binding.seriesId) == bytes32(0) || binding.seriesVersion == 0
                || PackageId.unwrap(binding.packageId) == bytes32(0) || binding.packageVersion == 0
                || binding.actionHash == bytes32(0) || binding.nonce == 0 || binding.minValue > binding.maxValue
                || binding.recipientPolicyHash == bytes32(0) || binding.expectedPostconditionsHash == bytes32(0)
        ) revert OperationalAdapterExecutor.InvalidBinding();
        if (block.timestamp > binding.deadline) {
            revert OperationalAdapterExecutor.BindingExpired(binding.deadline, block.timestamp);
        }
    }

    function _boundedStaticCall(
        OperationalExecutorDependencies memory deps,
        address implementation,
        bytes memory input,
        uint256 expectedLength
    ) internal view returns (bytes memory) {
        return _boundedStaticCallRaw(implementation, input, expectedLength, deps.readGasLimit);
    }

    function _boundedStaticCallRaw(address implementation, bytes memory input, uint256 expectedLength, uint256 gasLimit)
        internal
        view
        returns (bytes memory output)
    {
        if (input.length > MAX_TYPED_INPUT_BYTES) {
            revert OperationalAdapterExecutor.AdapterInputTooLarge(input.length, MAX_TYPED_INPUT_BYTES);
        }
        bool success;
        uint256 returnLength;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, implementation, add(input, 0x20), mload(input), 0, 0)
            returnLength := returndatasize()
        }
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(input, 0x20))
        }
        if (!success) revert OperationalAdapterExecutor.AdapterCallFailed(selector);
        if (returnLength != expectedLength) {
            revert OperationalAdapterExecutor.InvalidAdapterReturn(selector, returnLength, expectedLength);
        }
        output = new bytes(returnLength);
        assembly ("memory-safe") {
            returndatacopy(add(output, 0x20), 0, returnLength)
        }
    }

    function _boundedCall(
        OperationalExecutorDependencies memory deps,
        address implementation,
        bytes memory input,
        uint256 expectedLength
    ) internal returns (bytes memory output) {
        if (input.length > MAX_TYPED_INPUT_BYTES) {
            revert OperationalAdapterExecutor.AdapterInputTooLarge(input.length, MAX_TYPED_INPUT_BYTES);
        }
        bool success;
        uint256 returnLength;
        uint256 gasLimit = deps.executionGasLimit;
        assembly ("memory-safe") {
            success := call(gasLimit, implementation, 0, add(input, 0x20), mload(input), 0, 0)
            returnLength := returndatasize()
        }
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(input, 0x20))
        }
        if (!success) revert OperationalAdapterExecutor.AdapterCallFailed(selector);
        if (returnLength != expectedLength) {
            revert OperationalAdapterExecutor.InvalidAdapterReturn(selector, returnLength, expectedLength);
        }
        output = new bytes(returnLength);
        assembly ("memory-safe") {
            returndatacopy(add(output, 0x20), 0, returnLength)
        }
    }

    function _actionId(AdapterReference memory adapter, OperationalBinding calldata binding)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                adapter.adapterId,
                adapter.adapterVersion,
                OperationalAdapterLib.hashBinding(binding)
            )
        );
    }

    function _consume(mapping(bytes32 actionId => bool consumed) storage $actionConsumed, bytes32 actionId) internal {
        if ($actionConsumed[actionId]) revert OperationalAdapterExecutor.ActionAlreadyConsumed(actionId);
        $actionConsumed[actionId] = true;
    }

    function _requireExternalAction(
        mapping(bytes32 actionId => ExternalActionRecord record) storage $externalActions,
        bytes32 actionId
    ) internal view returns (ExternalActionRecord storage record) {
        record = $externalActions[actionId];
        if (record.requestHash == bytes32(0)) revert OperationalAdapterExecutor.UnknownExternalAction(actionId);
    }
}
