// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AdapterId} from "../types/Identifiers.sol";
import {
    AdapterReference,
    CorporateActionResult,
    CurveRateResult,
    ExternalActionRecord,
    ExternalVenueRequest,
    ExternalVenueResult,
    NativeLedgerExecutionResult,
    OperationalBinding,
    SequencerHealthResult,
    TradingSessionResult
} from "../types/OperationalAdapterTypes.sol";

interface IOperationalAdapterExecutor {
    event OperationalRead(
        bytes32 indexed actionId, AdapterId indexed adapterId, uint32 indexed adapterVersion, bytes32 resultHash
    );
    event NativeLedgerExecuted(
        bytes32 indexed actionId, AdapterId indexed adapterId, uint32 indexed adapterVersion, bytes32 resultHash
    );
    event ExternalActionAdvanced(
        bytes32 indexed actionId,
        AdapterId indexed adapterId,
        uint32 indexed adapterVersion,
        uint8 previousState,
        uint8 newState,
        bytes32 resultHash
    );

    function deploymentId() external view returns (bytes32);
    function deliveryEnabled() external pure returns (bool);
    function readSequencer(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (SequencerHealthResult memory);
    function readTradingSession(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (TradingSessionResult memory);
    function readCurveRate(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (CurveRateResult memory);
    function normalizeCorporateAction(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (CorporateActionResult memory);
    function executeNativeLedger(AdapterReference calldata adapter, OperationalBinding calldata binding)
        external
        returns (NativeLedgerExecutionResult memory);
    function submitExternal(AdapterReference calldata adapter, ExternalVenueRequest calldata request)
        external
        returns (bytes32 actionId, ExternalVenueResult memory result);
    function reconcileExternal(bytes32 actionId) external returns (ExternalVenueResult memory result);
    function recoverExternal(bytes32 actionId) external returns (ExternalVenueResult memory result);
    function getExternalAction(bytes32 actionId) external view returns (ExternalActionRecord memory record);
}
