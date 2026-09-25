// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IFixingObservationAdapterV1} from "./IFixingObservationAdapterV1.sol";
import {
    AdapterRuntimeDescriptor,
    CorporateActionResult,
    CurveRateResult,
    ExternalVenueRequest,
    ExternalVenueResult,
    NativeLedgerExecutionResult,
    OperationalBinding,
    SequencerHealthResult,
    TradingSessionResult
} from "../types/OperationalAdapterTypes.sol";

interface IOperationalAdapterMetadataV1 {
    function operationalAdapterDescriptor() external view returns (AdapterRuntimeDescriptor memory descriptor);
}

interface ISequencerHealthAdapterV1 is IOperationalAdapterMetadataV1 {
    function readSequencerHealth(OperationalBinding calldata binding)
        external
        view
        returns (SequencerHealthResult memory result);
}

interface ITradingSessionProofAdapterV1 is IOperationalAdapterMetadataV1 {
    function readTradingSession(OperationalBinding calldata binding)
        external
        view
        returns (TradingSessionResult memory result);
}

interface ICurveRateSnapshotAdapterV1 is IOperationalAdapterMetadataV1 {
    function readCurveRate(OperationalBinding calldata binding) external view returns (CurveRateResult memory result);
}

interface ICorporateActionAdapterV1 is IOperationalAdapterMetadataV1 {
    function normalizeCorporateAction(OperationalBinding calldata binding)
        external
        view
        returns (CorporateActionResult memory result);
}

interface IBenchmarkObservationBridgeV1 is IFixingObservationAdapterV1, IOperationalAdapterMetadataV1 {}

interface INativeLedgerExecutionAdapterV1 is IOperationalAdapterMetadataV1 {
    function executeNativeLedger(OperationalBinding calldata binding)
        external
        returns (NativeLedgerExecutionResult memory result);
}

interface IExternalVenueExecutionAdapterV1 is IOperationalAdapterMetadataV1 {
    function submitExternalAction(ExternalVenueRequest calldata request)
        external
        returns (ExternalVenueResult memory result);

    function reconcileExternalAction(bytes32 requestHash) external view returns (ExternalVenueResult memory result);

    function recoverExternalAction(bytes32 requestHash) external returns (ExternalVenueResult memory result);
}
