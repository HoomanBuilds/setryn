// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    IBenchmarkObservationBridgeV1,
    ICorporateActionAdapterV1,
    ICurveRateSnapshotAdapterV1,
    IExternalVenueExecutionAdapterV1,
    INativeLedgerExecutionAdapterV1,
    ISequencerHealthAdapterV1,
    ITradingSessionProofAdapterV1
} from "../../src/interfaces/IOperationalAdapters.sol";
import {ObservationBatchValidation, ObservationValidationContext} from "../../src/types/FixingTypes.sol";
import {
    AdapterRuntimeDescriptor,
    CorporateActionResult,
    CurveRateResult,
    ExternalVenueRequest,
    ExternalVenueResult,
    NativeLedgerExecutionResult,
    OperationalActionState,
    OperationalBinding,
    SequencerHealthResult,
    TradingSessionResult
} from "../../src/types/OperationalAdapterTypes.sol";

contract MockOperationalAdapter is
    ISequencerHealthAdapterV1,
    ITradingSessionProofAdapterV1,
    ICurveRateSnapshotAdapterV1,
    ICorporateActionAdapterV1,
    IBenchmarkObservationBridgeV1,
    INativeLedgerExecutionAdapterV1,
    IExternalVenueExecutionAdapterV1
{
    bytes32 public interfaceHash;
    bytes32 public capabilityHash;
    bool public proxyFree = true;
    bool public valueMoving;
    OperationalActionState public externalState = OperationalActionState.Submitted;
    int256 public resultValue;
    bytes32 public postconditionsHash;
    uint256 public executions;

    constructor(bytes32 interfaceHash_, bytes32 capabilityHash_, bool valueMoving_) {
        interfaceHash = interfaceHash_;
        capabilityHash = capabilityHash_;
        valueMoving = valueMoving_;
    }

    function configure(
        OperationalActionState externalState_,
        int256 resultValue_,
        bytes32 postconditionsHash_,
        bool proxyFree_
    ) external {
        externalState = externalState_;
        resultValue = resultValue_;
        postconditionsHash = postconditionsHash_;
        proxyFree = proxyFree_;
    }

    function operationalAdapterDescriptor() external view returns (AdapterRuntimeDescriptor memory) {
        return
            AdapterRuntimeDescriptor(
                address(this), block.chainid, interfaceHash, capabilityHash, proxyFree, valueMoving
            );
    }

    function readSequencerHealth(OperationalBinding calldata) external view returns (SequencerHealthResult memory) {
        return
            SequencerHealthResult(true, false, uint64(block.timestamp), uint64(block.timestamp), 0, keccak256("health"));
    }

    function readTradingSession(OperationalBinding calldata) external view returns (TradingSessionResult memory) {
        return TradingSessionResult(
            true,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp),
            keccak256("session")
        );
    }

    function readCurveRate(OperationalBinding calldata) external view returns (CurveRateResult memory) {
        return CurveRateResult(
            resultValue, 8, uint64(block.timestamp), uint64(block.timestamp), keccak256("point"), keccak256("curve")
        );
    }

    function normalizeCorporateAction(OperationalBinding calldata)
        external
        view
        returns (CorporateActionResult memory)
    {
        return CorporateActionResult(
            resultValue, 8, uint64(block.timestamp), keccak256("action"), keccak256("corporate")
        );
    }

    function validateObservationBatch(ObservationValidationContext calldata context, bytes calldata)
        external
        view
        returns (ObservationBatchValidation memory validation)
    {
        validation.observationsHash = context.observationsHash;
        validation.feedKey = context.feedKey;
        validation.capabilityHash = context.requiredCapabilityHash;
        validation.completenessHash = keccak256("complete");
        validation.evidenceHash = keccak256("evidence");
        validation.batchSequence = 1;
        validation.complete = true;
    }

    function executeNativeLedger(OperationalBinding calldata) external returns (NativeLedgerExecutionResult memory) {
        executions += 1;
        return NativeLedgerExecutionResult(
            OperationalActionState.Complete, resultValue, postconditionsHash, keccak256(abi.encode(executions))
        );
    }

    function submitExternalAction(ExternalVenueRequest calldata) external returns (ExternalVenueResult memory) {
        executions += 1;
        return _externalResult();
    }

    function reconcileExternalAction(bytes32) external view returns (ExternalVenueResult memory) {
        return _externalResult();
    }

    function recoverExternalAction(bytes32) external returns (ExternalVenueResult memory) {
        executions += 1;
        return _externalResult();
    }

    function _externalResult() private view returns (ExternalVenueResult memory) {
        return ExternalVenueResult(
            externalState,
            resultValue,
            0,
            postconditionsHash,
            keccak256("venue-action"),
            keccak256("venue-evidence"),
            keccak256("recovery-outcome")
        );
    }
}
