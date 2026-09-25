// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAdapterRegistry} from "../../interfaces/IAdapterRegistry.sol";
import {IOperationalAdapterExecutor} from "../../interfaces/IOperationalAdapterExecutor.sol";
import {
    ICorporateActionAdapterV1,
    ICurveRateSnapshotAdapterV1,
    IExternalVenueExecutionAdapterV1,
    INativeLedgerExecutionAdapterV1,
    IOperationalAdapterMetadataV1,
    ISequencerHealthAdapterV1,
    ITradingSessionProofAdapterV1
} from "../../interfaces/IOperationalAdapters.sol";
import {AdapterDefinitionLib} from "../../libraries/AdapterDefinitionLib.sol";
import {OperationalAdapterLib} from "../../libraries/OperationalAdapterLib.sol";
import {AdapterVersion} from "../../types/AdapterDefinition.sol";
import {AccountId, AdapterId, AdapterKindId, MarketId, PackageId, SeriesId} from "../../types/Identifiers.sol";
import {
    AdapterReference,
    AdapterRuntimeDescriptor,
    CorporateActionResult,
    CurveRateResult,
    ExecutionGuaranteeClass,
    ExternalActionRecord,
    ExternalTerminalFallback,
    ExternalVenueRequest,
    ExternalVenueResult,
    NativeLedgerExecutionResult,
    OperationalActionState,
    OperationalBinding,
    SequencerHealthResult,
    TradingSessionResult
} from "../../types/OperationalAdapterTypes.sol";

contract OperationalAdapterExecutor is IOperationalAdapterExecutor, ReentrancyGuard {
    uint256 private constant MAX_TYPED_INPUT_BYTES = 2_048;
    uint256 private constant DESCRIPTOR_RETURN_BYTES = 192;
    uint256 private constant SEQUENCER_RETURN_BYTES = 192;
    uint256 private constant SESSION_RETURN_BYTES = 160;
    uint256 private constant CURVE_RETURN_BYTES = 192;
    uint256 private constant CORPORATE_ACTION_RETURN_BYTES = 160;
    uint256 private constant EXECUTION_RETURN_BYTES = 224;
    uint256 private constant NATIVE_EXECUTION_RETURN_BYTES = 128;

    IAdapterRegistry public immutable adapterRegistry;
    bytes32 public immutable deploymentId;
    uint64 public immutable readGasLimit;
    uint64 public immutable executionGasLimit;

    mapping(bytes32 actionId => bool consumed) public actionConsumed;
    mapping(bytes32 actionId => ExternalActionRecord record) private _externalActions;

    error ZeroAdapterRegistry();
    error InvalidDeploymentId();
    error InvalidGasLimit();
    error InvalidBinding();
    error BindingExpired(uint64 deadline, uint256 timestamp);
    error AdapterUnavailable(AdapterId adapterId, uint32 version);
    error AdapterRecordMismatch(AdapterId adapterId, uint32 version);
    error AdapterDefinitionMismatch();
    error AdapterRuntimeMismatch();
    error AdapterDescriptorMismatch();
    error ProxyAdapterForbidden();
    error ValueMovementMismatch(bool expected, bool actual);
    error AdapterInputTooLarge(uint256 actual, uint256 maximum);
    error AdapterCallFailed(bytes4 selector);
    error InvalidAdapterReturn(bytes4 selector, uint256 actual, uint256 expected);
    error ActionAlreadyConsumed(bytes32 actionId);
    error InvalidResult();
    error UnsupportedGuaranteeClass();
    error InvalidAsyncBounds();
    error UnknownExternalAction(bytes32 actionId);
    error InvalidStateTransition(OperationalActionState previous, OperationalActionState next);
    error RecoveryNotAvailable(uint64 timeoutAt, uint64 recoveryDeadline, uint256 timestamp);
    error RecoveryDeadlineNotReached(uint64 recoveryDeadline, uint256 timestamp);
    error RecoveryDeadlineElapsed(uint64 recoveryDeadline, uint256 timestamp);
    error TerminalAction(bytes32 actionId);

    constructor(
        IAdapterRegistry adapterRegistry_,
        bytes32 deploymentId_,
        uint64 readGasLimit_,
        uint64 executionGasLimit_
    ) {
        if (address(adapterRegistry_) == address(0)) revert ZeroAdapterRegistry();
        if (deploymentId_ == bytes32(0)) revert InvalidDeploymentId();
        if (readGasLimit_ < 25_000 || executionGasLimit_ < 50_000) revert InvalidGasLimit();
        adapterRegistry = adapterRegistry_;
        deploymentId = deploymentId_;
        readGasLimit = readGasLimit_;
        executionGasLimit = executionGasLimit_;
    }

    function deliveryEnabled() external pure returns (bool) {
        return false;
    }

    function readSequencer(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (SequencerHealthResult memory result)
    {
        _validateBinding(binding);
        AdapterVersion memory version = _resolve(
            adapter,
            OperationalAdapterLib.KIND_SEQUENCER,
            OperationalAdapterLib.INTERFACE_SEQUENCER,
            OperationalAdapterLib.CAPABILITY_SEQUENCER,
            false,
            true
        );
        bytes memory output = _boundedStaticCall(
            version.definition.implementation,
            abi.encodeCall(ISequencerHealthAdapterV1.readSequencerHealth, (binding)),
            SEQUENCER_RETURN_BYTES
        );
        result = abi.decode(output, (SequencerHealthResult));
        if (
            result.observedAt > block.timestamp || result.publishedAt > block.timestamp
                || result.evidenceHash == bytes32(0)
        ) {
            revert InvalidResult();
        }
        _emitRead(adapter, binding, keccak256(output));
    }

    function readTradingSession(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (TradingSessionResult memory result)
    {
        _validateBinding(binding);
        AdapterVersion memory version = _resolve(
            adapter,
            OperationalAdapterLib.KIND_SESSION,
            OperationalAdapterLib.INTERFACE_SESSION,
            OperationalAdapterLib.CAPABILITY_SESSION,
            false,
            true
        );
        bytes memory output = _boundedStaticCall(
            version.definition.implementation,
            abi.encodeCall(ITradingSessionProofAdapterV1.readTradingSession, (binding)),
            SESSION_RETURN_BYTES
        );
        result = abi.decode(output, (TradingSessionResult));
        if (result.observedAt > block.timestamp || result.proofHash == bytes32(0)) revert InvalidResult();
        _emitRead(adapter, binding, keccak256(output));
    }

    function readCurveRate(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (CurveRateResult memory result)
    {
        _validateBinding(binding);
        AdapterVersion memory version = _resolve(
            adapter,
            OperationalAdapterLib.KIND_CURVE,
            OperationalAdapterLib.INTERFACE_CURVE,
            OperationalAdapterLib.CAPABILITY_CURVE,
            false,
            true
        );
        bytes memory output = _boundedStaticCall(
            version.definition.implementation,
            abi.encodeCall(ICurveRateSnapshotAdapterV1.readCurveRate, (binding)),
            CURVE_RETURN_BYTES
        );
        result = abi.decode(output, (CurveRateResult));
        if (
            result.value < binding.minValue || result.value > binding.maxValue || result.observedAt > block.timestamp
                || result.publishedAt > block.timestamp || result.evidenceHash == bytes32(0)
        ) revert InvalidResult();
        _emitRead(adapter, binding, keccak256(output));
    }

    function normalizeCorporateAction(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (CorporateActionResult memory result)
    {
        _validateBinding(binding);
        AdapterVersion memory version = _resolve(
            adapter,
            OperationalAdapterLib.KIND_CORPORATE_ACTION,
            OperationalAdapterLib.INTERFACE_CORPORATE_ACTION,
            OperationalAdapterLib.CAPABILITY_CORPORATE_ACTION,
            false,
            true
        );
        bytes memory output = _boundedStaticCall(
            version.definition.implementation,
            abi.encodeCall(ICorporateActionAdapterV1.normalizeCorporateAction, (binding)),
            CORPORATE_ACTION_RETURN_BYTES
        );
        result = abi.decode(output, (CorporateActionResult));
        if (
            result.normalizedValue < binding.minValue || result.normalizedValue > binding.maxValue
                || result.actionReference == bytes32(0) || result.evidenceHash == bytes32(0)
        ) revert InvalidResult();
        _emitRead(adapter, binding, keccak256(output));
    }

    function executeNativeLedger(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        nonReentrant
        returns (NativeLedgerExecutionResult memory result)
    {
        _validateBinding(binding);
        bytes32 actionId = _actionId(adapter, binding);
        _consume(actionId);
        AdapterVersion memory version = _resolve(
            adapter,
            OperationalAdapterLib.KIND_NATIVE_LEDGER,
            OperationalAdapterLib.INTERFACE_NATIVE_LEDGER,
            OperationalAdapterLib.CAPABILITY_NATIVE_LEDGER,
            true,
            true
        );
        bytes memory output = _boundedCall(
            version.definition.implementation,
            abi.encodeCall(INativeLedgerExecutionAdapterV1.executeNativeLedger, (binding)),
            NATIVE_EXECUTION_RETURN_BYTES
        );
        result = abi.decode(output, (NativeLedgerExecutionResult));
        if (
            result.state != OperationalActionState.Complete || result.realizedValue < binding.minValue
                || result.realizedValue > binding.maxValue
                || result.postconditionsHash != binding.expectedPostconditionsHash || result.executionHash == bytes32(0)
        ) revert InvalidResult();
        emit NativeLedgerExecuted(actionId, adapter.adapterId, adapter.adapterVersion, keccak256(output));
    }

    function submitExternal(AdapterReference calldata adapter, ExternalVenueRequest calldata request)
        external
        nonReentrant
        returns (bytes32 actionId, ExternalVenueResult memory result)
    {
        _validateBinding(request.binding);
        bytes32 capability = OperationalAdapterLib.capabilityFor(request.guaranteeClass);
        if (capability == bytes32(0)) revert UnsupportedGuaranteeClass();
        _validateGuarantee(request);
        actionId = _actionId(adapter, request.binding);
        _consume(actionId);
        AdapterVersion memory version = _resolve(
            adapter,
            OperationalAdapterLib.KIND_VENUE,
            OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capability,
            true,
            true
        );
        bytes memory output = _boundedCall(
            version.definition.implementation,
            abi.encodeCall(IExternalVenueExecutionAdapterV1.submitExternalAction, (request)),
            EXECUTION_RETURN_BYTES
        );
        result = abi.decode(output, (ExternalVenueResult));
        _validateExternalResult(request.binding, request.guaranteeClass, result, true);
        bytes32 resultHash = keccak256(output);
        _externalActions[actionId] = ExternalActionRecord({
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
        emit ExternalActionAdvanced(
            actionId,
            adapter.adapterId,
            adapter.adapterVersion,
            uint8(OperationalActionState.Unspecified),
            uint8(result.state),
            resultHash
        );
    }

    function reconcileExternal(bytes32 actionId) external nonReentrant returns (ExternalVenueResult memory result) {
        ExternalActionRecord storage record = _requireExternalAction(actionId);
        if (OperationalAdapterLib.terminal(record.state)) revert TerminalAction(actionId);
        if (record.guaranteeClass == ExecutionGuaranteeClass.BoundedAsync && block.timestamp > record.recoveryDeadline)
        {
            revert RecoveryDeadlineElapsed(record.recoveryDeadline, block.timestamp);
        }
        AdapterReference memory adapterRef = AdapterReference(record.adapterId, record.adapterVersion);
        bytes32 capability = OperationalAdapterLib.capabilityFor(record.guaranteeClass);
        AdapterVersion memory version = _resolve(
            adapterRef,
            OperationalAdapterLib.KIND_VENUE,
            OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            capability,
            true,
            false
        );
        bytes memory output = _boundedStaticCall(
            version.definition.implementation,
            abi.encodeCall(IExternalVenueExecutionAdapterV1.reconcileExternalAction, (record.requestHash)),
            EXECUTION_RETURN_BYTES
        );
        result = abi.decode(output, (ExternalVenueResult));
        _advance(actionId, record, result, output);
    }

    function recoverExternal(bytes32 actionId) external nonReentrant returns (ExternalVenueResult memory result) {
        ExternalActionRecord storage record = _requireExternalAction(actionId);
        if (OperationalAdapterLib.terminal(record.state)) revert TerminalAction(actionId);
        if (block.timestamp < record.timeoutAt || block.timestamp > record.recoveryDeadline) {
            revert RecoveryNotAvailable(record.timeoutAt, record.recoveryDeadline, block.timestamp);
        }
        AdapterReference memory adapterRef = AdapterReference(record.adapterId, record.adapterVersion);
        AdapterVersion memory version = _resolve(
            adapterRef,
            OperationalAdapterLib.KIND_VENUE,
            OperationalAdapterLib.INTERFACE_EXTERNAL_VENUE,
            OperationalAdapterLib.CAPABILITY_EXTERNAL_ASYNC,
            true,
            false
        );
        bytes memory output = _boundedCall(
            version.definition.implementation,
            abi.encodeCall(IExternalVenueExecutionAdapterV1.recoverExternalAction, (record.requestHash)),
            EXECUTION_RETURN_BYTES
        );
        result = abi.decode(output, (ExternalVenueResult));
        _advance(actionId, record, result, output);
    }

    function terminalizeExternal(bytes32 actionId) external nonReentrant returns (ExternalVenueResult memory result) {
        ExternalActionRecord storage record = _requireExternalAction(actionId);
        if (OperationalAdapterLib.terminal(record.state)) revert TerminalAction(actionId);
        if (record.guaranteeClass != ExecutionGuaranteeClass.BoundedAsync || block.timestamp <= record.recoveryDeadline)
        {
            revert RecoveryDeadlineNotReached(record.recoveryDeadline, block.timestamp);
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

    function getExternalAction(bytes32 actionId) external view returns (ExternalActionRecord memory record) {
        record = _externalActions[actionId];
        if (record.requestHash == bytes32(0)) revert UnknownExternalAction(actionId);
    }

    function _resolve(
        AdapterReference memory adapterRef,
        AdapterKindId expectedKind,
        bytes32 expectedInterface,
        bytes32 expectedCapability,
        bool valueMoving,
        bool newRisk
    ) private view returns (AdapterVersion memory version) {
        bool available = newRisk
            ? adapterRegistry.isOpenForNewRisk(adapterRef.adapterId, adapterRef.adapterVersion)
            : adapterRegistry.isLifecycleEnabled(adapterRef.adapterId, adapterRef.adapterVersion);
        if (!available) revert AdapterUnavailable(adapterRef.adapterId, adapterRef.adapterVersion);
        version = adapterRegistry.getAdapter(adapterRef.adapterId, adapterRef.adapterVersion);
        if (
            version.version != adapterRef.adapterVersion
                || AdapterId.unwrap(AdapterDefinitionLib.deriveAdapterId(version.definition))
                    != AdapterId.unwrap(adapterRef.adapterId)
                || version.definitionHash != AdapterDefinitionLib.hashDefinition(version.definition, block.chainid)
                || version.versionHash
                    != AdapterDefinitionLib.hashVersion(
                        adapterRef.adapterId, adapterRef.adapterVersion, version.definitionHash, block.chainid
                    )
        ) revert AdapterRecordMismatch(adapterRef.adapterId, adapterRef.adapterVersion);
        if (
            AdapterKindId.unwrap(version.definition.kindId) != AdapterKindId.unwrap(expectedKind)
                || version.definition.interfaceHash != expectedInterface
                || version.definition.capabilityHash != expectedCapability
        ) revert AdapterDefinitionMismatch();
        if (!adapterRegistry.runtimeMatches(adapterRef.adapterId, adapterRef.adapterVersion)) {
            revert AdapterRuntimeMismatch();
        }
        bytes memory output = _boundedStaticCallRaw(
            version.definition.implementation,
            abi.encodeCall(IOperationalAdapterMetadataV1.operationalAdapterDescriptor, ()),
            DESCRIPTOR_RETURN_BYTES,
            readGasLimit
        );
        AdapterRuntimeDescriptor memory descriptor = abi.decode(output, (AdapterRuntimeDescriptor));
        if (
            descriptor.self != version.definition.implementation || descriptor.chainId != block.chainid
                || descriptor.interfaceHash != expectedInterface || descriptor.capabilityHash != expectedCapability
        ) revert AdapterDescriptorMismatch();
        if (!descriptor.proxyFree) revert ProxyAdapterForbidden();
        if (descriptor.valueMoving != valueMoving) revert ValueMovementMismatch(valueMoving, descriptor.valueMoving);
    }

    function _validateBinding(OperationalBinding calldata binding) private view {
        if (
            binding.chainId != block.chainid || binding.deploymentId != deploymentId
                || AccountId.unwrap(binding.accountId) == bytes32(0) || MarketId.unwrap(binding.marketId) == bytes32(0)
                || SeriesId.unwrap(binding.seriesId) == bytes32(0) || binding.seriesVersion == 0
                || PackageId.unwrap(binding.packageId) == bytes32(0) || binding.packageVersion == 0
                || binding.actionHash == bytes32(0) || binding.nonce == 0 || binding.minValue > binding.maxValue
                || binding.recipientPolicyHash == bytes32(0) || binding.expectedPostconditionsHash == bytes32(0)
        ) revert InvalidBinding();
        if (block.timestamp > binding.deadline) revert BindingExpired(binding.deadline, block.timestamp);
    }

    function _validateGuarantee(ExternalVenueRequest calldata request) private view {
        if (request.guaranteeClass == ExecutionGuaranteeClass.AtomicSameDomain) {
            if (
                request.timeoutAt != 0 || request.recoveryDeadline != 0
                    || AccountId.unwrap(request.interimExposureOwner) != bytes32(0)
                    || request.recoveryPolicyHash != bytes32(0) || request.maximumResidual != 0
                    || request.terminalFallback.state != OperationalActionState.Unspecified
                    || request.terminalFallback.realizedValue != 0 || request.terminalFallback.residualValue != 0
                    || request.terminalFallback.postconditionsHash != bytes32(0)
                    || request.terminalFallback.outcomeHash != bytes32(0)
            ) revert InvalidAsyncBounds();
            return;
        }
        if (
            request.timeoutAt <= request.binding.deadline || request.recoveryDeadline <= request.timeoutAt
                || AccountId.unwrap(request.interimExposureOwner) == bytes32(0)
                || request.recoveryPolicyHash == bytes32(0) || request.reservationHash == bytes32(0)
                || request.maximumResidual > _maximumAbsoluteBound(request.binding.minValue, request.binding.maxValue)
        ) revert InvalidAsyncBounds();
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
    ) private pure {
        if (result.venueActionReference == bytes32(0) || result.evidenceHash == bytes32(0)) revert InvalidResult();
        if (guaranteeClass == ExecutionGuaranteeClass.AtomicSameDomain) {
            _validateTerminalResult(
                binding.minValue, binding.maxValue, binding.expectedPostconditionsHash, 0, guaranteeClass, result
            );
            return;
        }
        if (
            initial && result.state != OperationalActionState.Submitted
                && result.state != OperationalActionState.Included && result.state != OperationalActionState.Unknown
        ) revert InvalidResult();
        if (
            initial
                && (result.residualValue != 0
                    || result.postconditionsHash != bytes32(0)
                    || result.recoveryOutcomeHash != bytes32(0))
        ) revert InvalidResult();
    }

    function _advance(
        bytes32 actionId,
        ExternalActionRecord storage record,
        ExternalVenueResult memory result,
        bytes memory output
    ) private {
        OperationalActionState previous = record.state;
        if (!OperationalAdapterLib.isAsyncProgression(previous, result.state)) {
            revert InvalidStateTransition(previous, result.state);
        }
        if (result.venueActionReference == bytes32(0) || result.evidenceHash == bytes32(0)) revert InvalidResult();
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
            revert InvalidResult();
        }
        bytes32 resultHash = keccak256(output);
        record.state = result.state;
        record.resultHash = resultHash;
        emit ExternalActionAdvanced(
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
    ) private pure {
        if (
            !OperationalAdapterLib.terminal(result.state) || result.realizedValue < minValue
                || result.realizedValue > maxValue || result.postconditionsHash != expectedPostconditionsHash
                || _absolute(result.residualValue) > maximumResidual
        ) revert InvalidResult();
        if (result.state == OperationalActionState.Complete) {
            if (result.residualValue != 0 || result.recoveryOutcomeHash != bytes32(0)) revert InvalidResult();
            return;
        }
        if (guaranteeClass != ExecutionGuaranteeClass.BoundedAsync || result.recoveryOutcomeHash == bytes32(0)) {
            revert InvalidResult();
        }
        if (result.state == OperationalActionState.NoEffect && (result.realizedValue != 0 || result.residualValue != 0))
        {
            revert InvalidResult();
        }
    }

    function _absolute(int256 value) private pure returns (uint256) {
        if (value >= 0) return uint256(value);
        if (value == type(int256).min) return uint256(type(int256).max) + 1;
        return uint256(-value);
    }

    function _maximumAbsoluteBound(int256 minimum, int256 maximum) private pure returns (uint256) {
        uint256 minimumAbsolute = _absolute(minimum);
        uint256 maximumAbsolute = _absolute(maximum);
        return minimumAbsolute > maximumAbsolute ? minimumAbsolute : maximumAbsolute;
    }

    function _boundedStaticCall(address implementation, bytes memory input, uint256 expectedLength)
        private
        view
        returns (bytes memory)
    {
        return _boundedStaticCallRaw(implementation, input, expectedLength, readGasLimit);
    }

    function _boundedStaticCallRaw(address implementation, bytes memory input, uint256 expectedLength, uint256 gasLimit)
        private
        view
        returns (bytes memory output)
    {
        if (input.length > MAX_TYPED_INPUT_BYTES) revert AdapterInputTooLarge(input.length, MAX_TYPED_INPUT_BYTES);
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
        if (!success) revert AdapterCallFailed(selector);
        if (returnLength != expectedLength) revert InvalidAdapterReturn(selector, returnLength, expectedLength);
        output = new bytes(returnLength);
        assembly ("memory-safe") {
            returndatacopy(add(output, 0x20), 0, returnLength)
        }
    }

    function _boundedCall(address implementation, bytes memory input, uint256 expectedLength)
        private
        returns (bytes memory output)
    {
        if (input.length > MAX_TYPED_INPUT_BYTES) {
            revert AdapterInputTooLarge(input.length, MAX_TYPED_INPUT_BYTES);
        }
        bool success;
        uint256 returnLength;
        uint256 gasLimit = executionGasLimit;
        assembly ("memory-safe") {
            success := call(gasLimit, implementation, 0, add(input, 0x20), mload(input), 0, 0)
            returnLength := returndatasize()
        }
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(input, 0x20))
        }
        if (!success) revert AdapterCallFailed(selector);
        if (returnLength != expectedLength) revert InvalidAdapterReturn(selector, returnLength, expectedLength);
        output = new bytes(returnLength);
        assembly ("memory-safe") {
            returndatacopy(add(output, 0x20), 0, returnLength)
        }
    }

    function _actionId(AdapterReference memory adapter, OperationalBinding calldata binding)
        private
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

    function _consume(bytes32 actionId) private {
        if (actionConsumed[actionId]) revert ActionAlreadyConsumed(actionId);
        actionConsumed[actionId] = true;
    }

    function _emitRead(AdapterReference calldata adapter, OperationalBinding calldata binding, bytes32 resultHash)
        private
    {
        emit OperationalRead(_actionId(adapter, binding), adapter.adapterId, adapter.adapterVersion, resultHash);
    }

    function _requireExternalAction(bytes32 actionId) private view returns (ExternalActionRecord storage record) {
        record = _externalActions[actionId];
        if (record.requestHash == bytes32(0)) revert UnknownExternalAction(actionId);
    }
}
