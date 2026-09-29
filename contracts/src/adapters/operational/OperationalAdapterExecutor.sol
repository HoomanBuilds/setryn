// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAdapterRegistry} from "../../interfaces/IAdapterRegistry.sol";
import {IOperationalAdapterExecutor} from "../../interfaces/IOperationalAdapterExecutor.sol";
import {
    ICorporateActionAdapterV1,
    ICurveRateSnapshotAdapterV1,
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
    ExternalActionRecord,
    ExternalVenueRequest,
    ExternalVenueResult,
    NativeLedgerExecutionResult,
    OperationalActionState,
    OperationalBinding,
    SequencerHealthResult,
    TradingSessionResult
} from "../../types/OperationalAdapterTypes.sol";

import {OperationalExternalActionLib} from "./OperationalExternalActionLib.sol";
import {OperationalExecutorDependencies} from "./OperationalExecutorTypes.sol";

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
        return OperationalExternalActionLib.submitExternal(
            _dependencies(), actionConsumed, _externalActions, adapter, request
        );
    }

    function reconcileExternal(bytes32 actionId) external nonReentrant returns (ExternalVenueResult memory result) {
        return OperationalExternalActionLib.reconcileExternal(_dependencies(), _externalActions, actionId);
    }

    function recoverExternal(bytes32 actionId) external nonReentrant returns (ExternalVenueResult memory result) {
        return OperationalExternalActionLib.recoverExternal(_dependencies(), _externalActions, actionId);
    }

    function terminalizeExternal(bytes32 actionId) external nonReentrant returns (ExternalVenueResult memory result) {
        return OperationalExternalActionLib.terminalizeExternal(_externalActions, actionId);
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

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (OperationalExecutorDependencies memory) {
        return OperationalExecutorDependencies({
            adapterRegistry: adapterRegistry,
            deploymentId: deploymentId,
            readGasLimit: readGasLimit,
            executionGasLimit: executionGasLimit
        });
    }

    function _requireExternalAction(bytes32 actionId) private view returns (ExternalActionRecord storage record) {
        record = _externalActions[actionId];
        if (record.requestHash == bytes32(0)) revert UnknownExternalAction(actionId);
    }
}
