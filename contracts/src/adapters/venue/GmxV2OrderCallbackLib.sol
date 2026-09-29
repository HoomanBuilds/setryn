// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ExternalVenueResult, OperationalActionState} from "../../types/OperationalAdapterTypes.sol";
import {GmxV2OrderDependencies} from "./GmxV2OrderTypes.sol";
import {StorageSlot} from "@openzeppelin/contracts/utils/StorageSlot.sol";
import "./GmxV2OrderAdapter.sol";

/// Linked logic for the GMX V2 order adapter: authenticated callbacks, bounded event evidence, and recovery.
/// Runs through DELEGATECALL in the adapter's context against its storage.
library GmxV2OrderCallbackLib {
    using SafeERC20 for IERC20;

    uint256 internal constant MAX_EVENT_ARRAY_ELEMENTS = 128;
    uint256 internal constant MAX_EVENT_ARRAY_ITEMS = 16;
    uint256 internal constant MAX_EVENT_BYTES = 2_048;
    uint256 internal constant MAX_EVENT_ITEMS = 64;
    uint256 internal constant MAX_SWAP_PATH_LENGTH = 5;
    uint8 internal constant NO_SWAP = 0;
    bytes32 internal constant ORDER_LIST = keccak256(abi.encode("ORDER_LIST"));

    function afterOrderExecution(
        GmxV2OrderDependencies memory deps,
        mapping(bytes32 actionHash => GmxV2OrderAdapter.StagedGmxV2Order staged) storage $staged,
        mapping(address token => uint256 inventoried) storage $inventory,
        mapping(address token => uint256 reserved) storage $reserved,
        bytes32 $nativeInventoriedSlot,
        bytes32 $nativeReservedSlot,
        mapping(bytes32 requestHash => GmxV2OrderAdapter.StoredGmxV2Request stored) storage $requests,
        mapping(bytes32 requestHash => ExternalVenueResult result) storage $results,
        mapping(bytes32 requestHash => bool storedResult) storage $resultStored,
        mapping(bytes32 orderKey => bytes32 requestHash) storage $orderToRequest,
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2EventTypes.EventLogData memory eventData
    ) external {
        if (msg.sender != deps.orderHandler) {
            revert GmxV2OrderAdapter.UnauthorizedCallback(msg.sender, deps.orderHandler);
        }
        bytes32 requestHash = $orderToRequest[key];
        if (requestHash == bytes32(0)) revert GmxV2OrderAdapter.UnknownOrder(key);
        GmxV2OrderAdapter.StoredGmxV2Request storage storedReq = $requests[requestHash];
        ExternalVenueResult storage current = $results[requestHash];
        if (!$resultStored[requestHash]) revert GmxV2OrderAdapter.UnknownRequest(requestHash);
        if (current.state != OperationalActionState.Submitted) revert GmxV2OrderAdapter.OrderAlreadyResolved(key);
        GmxV2OrderAdapter.StagedGmxV2Order storage staged = $staged[storedReq.actionHash];
        (bytes32 orderCommitment, uint256 sizeDeltaUsd, uint256 collateralDelta) =
            _validateAndCommitOrderData(deps, key, orderData, staged);
        if (staged.market != storedReq.market) revert GmxV2OrderAdapter.OrderFieldMismatch(key);

        // Realized is the authenticated staged delta (position notional or swap input),
        // never a keeper-reported fill price: GMX callbacks carry no execution price.
        int256 realized = _realizedForKind(staged.kind, sizeDeltaUsd, collateralDelta);
        if (realized < storedReq.minValue || realized > storedReq.maxValue) {
            revert GmxV2OrderAdapter.RealizedValueOutOfRange(realized, storedReq.minValue, storedReq.maxValue);
        }
        bytes32 eventCommitment = _hashBoundedEventData(eventData);

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2ExecutionV1",
                deps.expectedChainId,
                address(this),
                deps.orderHandler,
                requestHash,
                key,
                orderCommitment,
                eventCommitment,
                realized
            )
        );
        if (evidenceHash == bytes32(0)) revert GmxV2OrderAdapter.ZeroEvidenceCommitment();

        _releaseOnce($inventory, $reserved, $nativeInventoriedSlot, $nativeReservedSlot, requestHash, storedReq);

        current.state = OperationalActionState.Complete;
        current.realizedValue = realized;
        current.residualValue = 0;
        current.postconditionsHash = storedReq.expectedPostconditionsHash;
        current.venueActionReference = key;
        current.evidenceHash = evidenceHash;
        current.recoveryOutcomeHash = bytes32(0);

        emit GmxV2OrderAdapter.GmxV2OrderExecuted(requestHash, key, realized);
    }

    function afterOrderCancellation(
        GmxV2OrderDependencies memory deps,
        mapping(bytes32 actionHash => GmxV2OrderAdapter.StagedGmxV2Order staged) storage $staged,
        mapping(bytes32 requestHash => GmxV2OrderAdapter.StoredGmxV2Request stored) storage $requests,
        mapping(bytes32 requestHash => ExternalVenueResult result) storage $results,
        mapping(bytes32 requestHash => bool storedResult) storage $resultStored,
        mapping(bytes32 orderKey => bytes32 requestHash) storage $orderToRequest,
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2EventTypes.EventLogData memory eventData
    ) external {
        if (msg.sender != deps.orderHandler) {
            revert GmxV2OrderAdapter.UnauthorizedCallback(msg.sender, deps.orderHandler);
        }
        bytes32 requestHash = $orderToRequest[key];
        if (requestHash == bytes32(0)) revert GmxV2OrderAdapter.UnknownOrder(key);
        if (!$resultStored[requestHash]) revert GmxV2OrderAdapter.UnknownRequest(requestHash);
        ExternalVenueResult storage current = $results[requestHash];
        if (current.state != OperationalActionState.Submitted) revert GmxV2OrderAdapter.OrderAlreadyResolved(key);
        GmxV2OrderAdapter.StoredGmxV2Request storage storedReq = $requests[requestHash];
        GmxV2OrderAdapter.StagedGmxV2Order storage staged = $staged[storedReq.actionHash];
        (bytes32 orderCommitment,,) = _validateAndCommitOrderData(deps, key, orderData, staged);
        bytes32 eventCommitment = _hashBoundedEventData(eventData);

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2CancellationV1",
                deps.expectedChainId,
                address(this),
                deps.orderHandler,
                requestHash,
                key,
                orderCommitment,
                eventCommitment
            )
        );
        if (evidenceHash == bytes32(0)) revert GmxV2OrderAdapter.ZeroEvidenceCommitment();

        current.state = OperationalActionState.Recovering;
        current.realizedValue = 0;
        current.residualValue = 0;
        current.postconditionsHash = bytes32(0);
        current.venueActionReference = key;
        current.evidenceHash = evidenceHash;
        current.recoveryOutcomeHash = bytes32(0);

        emit GmxV2OrderAdapter.GmxV2OrderCancelled(requestHash, key);
    }

    function afterOrderFrozen(
        GmxV2OrderDependencies memory deps,
        mapping(bytes32 actionHash => GmxV2OrderAdapter.StagedGmxV2Order staged) storage $staged,
        mapping(bytes32 requestHash => GmxV2OrderAdapter.StoredGmxV2Request stored) storage $requests,
        mapping(bytes32 requestHash => ExternalVenueResult result) storage $results,
        mapping(bytes32 requestHash => bool storedResult) storage $resultStored,
        mapping(bytes32 orderKey => bytes32 requestHash) storage $orderToRequest,
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2EventTypes.EventLogData memory eventData
    ) external {
        if (msg.sender != deps.orderHandler) {
            revert GmxV2OrderAdapter.UnauthorizedCallback(msg.sender, deps.orderHandler);
        }
        bytes32 requestHash = $orderToRequest[key];
        if (requestHash == bytes32(0)) revert GmxV2OrderAdapter.UnknownOrder(key);
        if (!$resultStored[requestHash]) revert GmxV2OrderAdapter.UnknownRequest(requestHash);
        ExternalVenueResult storage current = $results[requestHash];
        if (current.state != OperationalActionState.Submitted) revert GmxV2OrderAdapter.OrderAlreadyResolved(key);
        GmxV2OrderAdapter.StoredGmxV2Request storage storedReq = $requests[requestHash];
        GmxV2OrderAdapter.StagedGmxV2Order storage staged = $staged[storedReq.actionHash];
        (bytes32 orderCommitment,,) = _validateAndCommitOrderData(deps, key, orderData, staged);
        bytes32 eventCommitment = _hashBoundedEventData(eventData);

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2FrozenV1",
                deps.expectedChainId,
                address(this),
                deps.orderHandler,
                requestHash,
                key,
                orderCommitment,
                eventCommitment
            )
        );
        if (evidenceHash == bytes32(0)) revert GmxV2OrderAdapter.ZeroEvidenceCommitment();

        current.state = OperationalActionState.Recovering;
        current.realizedValue = 0;
        current.residualValue = 0;
        current.postconditionsHash = bytes32(0);
        current.venueActionReference = key;
        current.evidenceHash = evidenceHash;
        current.recoveryOutcomeHash = bytes32(0);

        emit GmxV2OrderAdapter.GmxV2OrderFrozen(requestHash, key);
    }

    function recoverExternalAction(
        GmxV2OrderDependencies memory deps,
        mapping(address token => uint256 inventoried) storage $inventory,
        mapping(address token => uint256 reserved) storage $reserved,
        bytes32 $nativeInventoriedSlot,
        bytes32 $nativeReservedSlot,
        mapping(bytes32 requestHash => GmxV2OrderAdapter.StoredGmxV2Request stored) storage $requests,
        mapping(bytes32 requestHash => ExternalVenueResult result) storage $results,
        mapping(bytes32 requestHash => bool storedResult) storage $resultStored,
        bytes32 requestHash
    ) external returns (ExternalVenueResult memory result) {
        if (!$resultStored[requestHash]) revert GmxV2OrderAdapter.UnknownRequest(requestHash);
        GmxV2OrderAdapter.StoredGmxV2Request storage storedReq = $requests[requestHash];
        ExternalVenueResult storage current = $results[requestHash];
        if (
            current.state == OperationalActionState.Complete || current.state == OperationalActionState.Recovered
                || current.state == OperationalActionState.NoEffect
        ) revert GmxV2OrderAdapter.NoRecoveryForTerminal(requestHash);
        if (block.timestamp < storedReq.timeoutAt || block.timestamp > storedReq.recoveryDeadline) {
            revert GmxV2OrderAdapter.RecoveryNotAvailable(
                storedReq.timeoutAt, storedReq.recoveryDeadline, block.timestamp
            );
        }

        bool wasSubmitted = current.state == OperationalActionState.Submitted;
        if (wasSubmitted) {
            // Best effort: the order may already be gone (executed, cancelled, or frozen
            // callbacks fire under try/catch), in which case cancellation reverts and the
            // absence check below carries the decision.
            try deps.exchangeRouter.cancelOrder(storedReq.orderKey) {} catch {}
        }

        bool absent = !deps.dataStore.containsBytes32(ORDER_LIST, storedReq.orderKey);
        if (!absent) {
            if (!wasSubmitted) revert GmxV2OrderAdapter.OrderStillPending(storedReq.orderKey);
            current.state = OperationalActionState.Recovering;
            current.realizedValue = 0;
            current.residualValue = 0;
            current.postconditionsHash = bytes32(0);
            current.venueActionReference = storedReq.orderKey;
            bytes32 pendingEvidence = keccak256(
                abi.encode(
                    "SetrynGmxV2RecoveryPendingV1",
                    deps.expectedChainId,
                    address(this),
                    deps.orderHandler,
                    requestHash,
                    storedReq.orderKey
                )
            );
            if (pendingEvidence == bytes32(0)) revert GmxV2OrderAdapter.ZeroEvidenceCommitment();
            current.evidenceHash = pendingEvidence;
            current.recoveryOutcomeHash = bytes32(0);
            result = current;
            emit GmxV2OrderAdapter.GmxV2OrderCancelled(requestHash, storedReq.orderKey);
            return result;
        }

        // Order absent: reconcile returned collateral plus refunded native fee first.
        address collateral = storedReq.initialCollateralToken;
        uint256 collateralLive = IERC20(collateral).balanceOf(address(this));
        uint256 nativeLive = address(this).balance;
        $inventory[collateral] = collateralLive;
        StorageSlot.getUint256Slot($nativeInventoriedSlot).value = nativeLive;
        _releaseOnce($inventory, $reserved, $nativeInventoriedSlot, $nativeReservedSlot, requestHash, storedReq);

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2RecoveryV1",
                deps.expectedChainId,
                address(this),
                deps.orderHandler,
                requestHash,
                storedReq.orderKey,
                collateralLive,
                nativeLive,
                storedReq.terminalOutcome
            )
        );
        if (evidenceHash == bytes32(0)) revert GmxV2OrderAdapter.ZeroEvidenceCommitment();

        current.state = storedReq.terminalState;
        current.realizedValue = storedReq.terminalRealized;
        current.residualValue = storedReq.terminalResidual;
        current.postconditionsHash = storedReq.terminalPostconditions;
        current.venueActionReference = storedReq.orderKey;
        current.evidenceHash = evidenceHash;
        current.recoveryOutcomeHash = storedReq.terminalOutcome;
        result = current;

        emit GmxV2OrderAdapter.GmxV2OrderRecovered(requestHash, storedReq.orderKey, uint8(current.state));
    }

    /// @notice Validates the canonical OrderEventUtils.createEventData shape, keys, and values.
    /// @dev Returns a commitment over the bounded order data plus the authenticated deltas used
    ///      for realized accounting. Every nested array is length-checked before hashing.
    function _validateAndCommitOrderData(
        GmxV2OrderDependencies memory deps,
        bytes32 key,
        GmxV2EventTypes.EventLogData memory orderData,
        GmxV2OrderAdapter.StagedGmxV2Order storage staged
    ) internal view returns (bytes32 commitment, uint256 sizeDeltaUsd, uint256 collateralDelta) {
        if (orderData.addressItems.items.length != 7) revert GmxV2OrderAdapter.InvalidOrderData(key);
        if (orderData.addressItems.arrayItems.length != 1) revert GmxV2OrderAdapter.InvalidOrderData(key);
        if (orderData.uintItems.items.length != 12) revert GmxV2OrderAdapter.InvalidOrderData(key);
        if (orderData.uintItems.arrayItems.length != 0) revert GmxV2OrderAdapter.InvalidOrderData(key);
        if (orderData.intItems.items.length != 0 || orderData.intItems.arrayItems.length != 0) {
            revert GmxV2OrderAdapter.InvalidOrderData(key);
        }
        if (orderData.boolItems.items.length != 3) revert GmxV2OrderAdapter.InvalidOrderData(key);
        if (orderData.boolItems.arrayItems.length != 0) revert GmxV2OrderAdapter.InvalidOrderData(key);
        if (orderData.bytes32Items.items.length != 0) revert GmxV2OrderAdapter.InvalidOrderData(key);
        if (orderData.bytes32Items.arrayItems.length != 1) revert GmxV2OrderAdapter.InvalidOrderData(key);
        if (orderData.bytesItems.items.length != 0 || orderData.bytesItems.arrayItems.length != 0) {
            revert GmxV2OrderAdapter.InvalidOrderData(key);
        }
        if (orderData.stringItems.items.length != 0 || orderData.stringItems.arrayItems.length != 0) {
            revert GmxV2OrderAdapter.InvalidOrderData(key);
        }

        _requireItemKey(orderData.addressItems.items[0].key, "account", key);
        _requireItemKey(orderData.addressItems.items[1].key, "receiver", key);
        _requireItemKey(orderData.addressItems.items[2].key, "callbackContract", key);
        _requireItemKey(orderData.addressItems.items[3].key, "uiFeeReceiver", key);
        _requireItemKey(orderData.addressItems.items[4].key, "market", key);
        _requireItemKey(orderData.addressItems.items[5].key, "initialCollateralToken", key);
        _requireItemKey(orderData.addressItems.items[6].key, "cancellationReceiver", key);
        _requireItemKey(orderData.addressItems.arrayItems[0].key, "swapPath", key);

        _requireItemKey(orderData.uintItems.items[0].key, "orderType", key);
        _requireItemKey(orderData.uintItems.items[1].key, "decreasePositionSwapType", key);
        _requireItemKey(orderData.uintItems.items[2].key, "sizeDeltaUsd", key);
        _requireItemKey(orderData.uintItems.items[3].key, "initialCollateralDeltaAmount", key);
        _requireItemKey(orderData.uintItems.items[4].key, "triggerPrice", key);
        _requireItemKey(orderData.uintItems.items[5].key, "acceptablePrice", key);
        _requireItemKey(orderData.uintItems.items[6].key, "executionFee", key);
        _requireItemKey(orderData.uintItems.items[7].key, "callbackGasLimit", key);
        _requireItemKey(orderData.uintItems.items[8].key, "minOutputAmount", key);
        _requireItemKey(orderData.uintItems.items[9].key, "updatedAtTime", key);
        _requireItemKey(orderData.uintItems.items[10].key, "validFromTime", key);
        _requireItemKey(orderData.uintItems.items[11].key, "srcChainId", key);

        _requireItemKey(orderData.boolItems.items[0].key, "isLong", key);
        _requireItemKey(orderData.boolItems.items[1].key, "shouldUnwrapNativeToken", key);
        _requireItemKey(orderData.boolItems.items[2].key, "autoCancel", key);

        _requireItemKey(orderData.bytes32Items.arrayItems[0].key, "dataList", key);

        if (orderData.addressItems.items[0].value != address(this)) {
            revert GmxV2OrderAdapter.AccountMismatch(address(this), orderData.addressItems.items[0].value);
        }
        if (orderData.addressItems.items[1].value != staged.receiver) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }
        if (orderData.addressItems.items[2].value != address(this)) {
            revert GmxV2OrderAdapter.CallbackContractMismatch(address(this), orderData.addressItems.items[2].value);
        }
        if (orderData.addressItems.items[3].value != staged.uiFeeReceiver) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }
        if (orderData.addressItems.items[4].value != staged.market) revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        if (orderData.addressItems.items[5].value != staged.initialCollateralToken) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }
        if (orderData.addressItems.items[6].value != address(this)) {
            revert GmxV2OrderAdapter.CancellationReceiverMismatch(address(this), orderData.addressItems.items[6].value);
        }

        if (orderData.addressItems.arrayItems[0].value.length > MAX_SWAP_PATH_LENGTH) {
            revert GmxV2OrderAdapter.InvalidOrderData(key);
        }
        if (hashSwapPath(orderData.addressItems.arrayItems[0].value) != staged.swapPathHash) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }

        if (orderData.uintItems.items[0].value != staged.orderType) revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        if (orderData.uintItems.items[1].value != NO_SWAP) revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        sizeDeltaUsd = orderData.uintItems.items[2].value;
        collateralDelta = orderData.uintItems.items[3].value;
        if (sizeDeltaUsd != staged.sizeDeltaUsd) revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        if (collateralDelta != staged.initialCollateralDeltaAmount) revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        if (orderData.uintItems.items[4].value != staged.triggerPrice) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }
        if (orderData.uintItems.items[5].value != staged.acceptablePrice) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }
        if (orderData.uintItems.items[6].value != staged.executionFee) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }
        if (orderData.uintItems.items[7].value != deps.callbackGasLimit) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }
        // Adapter policy: no slippage floor, no delayed validity, same-chain only, no auto-cancel,
        // no auxiliary data. Each is bound here so keepers cannot substitute values.
        if (orderData.uintItems.items[8].value != 0) revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        if (orderData.uintItems.items[10].value != 0) revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        if (orderData.uintItems.items[11].value != 0) revert GmxV2OrderAdapter.OrderFieldMismatch(key);

        if (orderData.boolItems.items[0].value != staged.isLong) revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        if (orderData.boolItems.items[1].value != staged.shouldUnwrapNativeToken) {
            revert GmxV2OrderAdapter.OrderFieldMismatch(key);
        }
        if (orderData.boolItems.items[2].value) revert GmxV2OrderAdapter.OrderFieldMismatch(key);

        if (orderData.bytes32Items.arrayItems[0].value.length != 0) revert GmxV2OrderAdapter.OrderFieldMismatch(key);

        commitment = keccak256(abi.encode(orderData));
    }

    function _requireItemKey(string memory actual, string memory expected, bytes32 key) internal pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) revert GmxV2OrderAdapter.InvalidOrderData(key);
    }

    /// @notice Bounds every nested array and dynamic element before hashing event data.
    function _hashBoundedEventData(GmxV2EventTypes.EventLogData memory eventData) internal pure returns (bytes32) {
        _boundEventItems(eventData.addressItems.items.length, eventData.addressItems.arrayItems.length);
        _boundEventItems(eventData.uintItems.items.length, eventData.uintItems.arrayItems.length);
        _boundEventItems(eventData.intItems.items.length, eventData.intItems.arrayItems.length);
        _boundEventItems(eventData.boolItems.items.length, eventData.boolItems.arrayItems.length);
        _boundEventItems(eventData.bytes32Items.items.length, eventData.bytes32Items.arrayItems.length);
        _boundEventItems(eventData.bytesItems.items.length, eventData.bytesItems.arrayItems.length);
        _boundEventItems(eventData.stringItems.items.length, eventData.stringItems.arrayItems.length);
        _boundNestedAddresses(eventData.addressItems.arrayItems);
        _boundNestedUints(eventData.uintItems.arrayItems);
        _boundNestedInts(eventData.intItems.arrayItems);
        _boundNestedBools(eventData.boolItems.arrayItems);
        _boundNestedBytes32(eventData.bytes32Items.arrayItems);
        _boundBytesElements(eventData.bytesItems.items);
        _boundNestedBytesElements(eventData.bytesItems.arrayItems);
        _boundStringElements(eventData.stringItems.items);
        _boundNestedStringElements(eventData.stringItems.arrayItems);
        for (uint256 i = 0; i < eventData.addressItems.items.length; i++) {
            _boundStringLength(bytes(eventData.addressItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.uintItems.items.length; i++) {
            _boundStringLength(bytes(eventData.uintItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.intItems.items.length; i++) {
            _boundStringLength(bytes(eventData.intItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.boolItems.items.length; i++) {
            _boundStringLength(bytes(eventData.boolItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.bytes32Items.items.length; i++) {
            _boundStringLength(bytes(eventData.bytes32Items.items[i].key));
        }
        for (uint256 i = 0; i < eventData.bytesItems.items.length; i++) {
            _boundStringLength(bytes(eventData.bytesItems.items[i].key));
        }
        for (uint256 i = 0; i < eventData.stringItems.items.length; i++) {
            _boundStringLength(bytes(eventData.stringItems.items[i].key));
            _boundStringLength(bytes(eventData.stringItems.items[i].value));
        }
        return keccak256(abi.encode(eventData));
    }

    function _boundEventItems(uint256 items, uint256 arrayItems) internal pure {
        if (items > MAX_EVENT_ITEMS || arrayItems > MAX_EVENT_ARRAY_ITEMS) {
            revert GmxV2OrderAdapter.EventDataOutOfBounds();
        }
    }

    function _boundStringLength(bytes memory raw) internal pure {
        if (raw.length > MAX_EVENT_BYTES) revert GmxV2OrderAdapter.EventDataOutOfBounds();
    }

    function _boundNestedAddresses(GmxV2EventTypes.AddressArrayKeyValue[] memory arrayItems) internal pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert GmxV2OrderAdapter.EventDataOutOfBounds();
        }
    }

    function _boundNestedUints(GmxV2EventTypes.UintArrayKeyValue[] memory arrayItems) internal pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert GmxV2OrderAdapter.EventDataOutOfBounds();
        }
    }

    function _boundNestedInts(GmxV2EventTypes.IntArrayKeyValue[] memory arrayItems) internal pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert GmxV2OrderAdapter.EventDataOutOfBounds();
        }
    }

    function _boundNestedBools(GmxV2EventTypes.BoolArrayKeyValue[] memory arrayItems) internal pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert GmxV2OrderAdapter.EventDataOutOfBounds();
        }
    }

    function _boundNestedBytes32(GmxV2EventTypes.Bytes32ArrayKeyValue[] memory arrayItems) internal pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert GmxV2OrderAdapter.EventDataOutOfBounds();
        }
    }

    function _boundBytesElements(GmxV2EventTypes.BytesKeyValue[] memory items) internal pure {
        for (uint256 i = 0; i < items.length; i++) {
            _boundStringLength(bytes(items[i].key));
            _boundStringLength(items[i].value);
        }
    }

    function _boundNestedBytesElements(GmxV2EventTypes.BytesArrayKeyValue[] memory arrayItems) internal pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert GmxV2OrderAdapter.EventDataOutOfBounds();
            for (uint256 j = 0; j < arrayItems[i].value.length; j++) {
                _boundStringLength(arrayItems[i].value[j]);
            }
        }
    }

    function _boundStringElements(GmxV2EventTypes.StringKeyValue[] memory items) internal pure {
        for (uint256 i = 0; i < items.length; i++) {
            _boundStringLength(bytes(items[i].key));
            _boundStringLength(bytes(items[i].value));
        }
    }

    function _boundNestedStringElements(GmxV2EventTypes.StringArrayKeyValue[] memory arrayItems) internal pure {
        for (uint256 i = 0; i < arrayItems.length; i++) {
            _boundStringLength(bytes(arrayItems[i].key));
            if (arrayItems[i].value.length > MAX_EVENT_ARRAY_ELEMENTS) revert GmxV2OrderAdapter.EventDataOutOfBounds();
            for (uint256 j = 0; j < arrayItems[i].value.length; j++) {
                _boundStringLength(bytes(arrayItems[i].value[j]));
            }
        }
    }

    function _realizedForKind(GmxV2OrderAdapter.GmxV2OrderKind kind, uint256 sizeDeltaUsd, uint256 collateralDelta)
        internal
        pure
        returns (int256)
    {
        uint256 value = kind == GmxV2OrderAdapter.GmxV2OrderKind.Swap ? collateralDelta : sizeDeltaUsd;
        if (value > uint256(uint256(type(int256).max))) revert GmxV2OrderAdapter.RealizedOverflow(value);
        return int256(value);
    }

    function hashSwapPath(address[] memory swapPath) internal pure returns (bytes32) {
        return keccak256(abi.encode("SetrynGmxV2SwapPathV1", swapPath));
    }

    /// @notice Releases a stored request reservation exactly once; loud on double release.
    function _releaseOnce(
        mapping(address token => uint256 inventoried) storage $inventory,
        mapping(address token => uint256 reserved) storage $reserved,
        bytes32 $nativeInventoriedSlot,
        bytes32 $nativeReservedSlot,
        bytes32 requestHash,
        GmxV2OrderAdapter.StoredGmxV2Request storage storedReq
    ) internal {
        if (storedReq.reservationReleased) {
            revert GmxV2OrderAdapter.ReservationAlreadyReleased(requestHash);
        }
        storedReq.reservationReleased = true;
        uint256 executionFee = storedReq.executionFee;
        if (StorageSlot.getUint256Slot($nativeReservedSlot).value < executionFee) {
            revert GmxV2OrderAdapter.NativeOverReserved(
                executionFee,
                StorageSlot.getUint256Slot($nativeInventoriedSlot).value,
                StorageSlot.getUint256Slot($nativeReservedSlot).value
            );
        }
        StorageSlot.getUint256Slot($nativeReservedSlot).value -= executionFee;
        if (storedReq.kind == GmxV2OrderAdapter.GmxV2OrderKind.Decrease) return;
        address collateral = storedReq.initialCollateralToken;
        uint256 collateralAmount = storedReq.collateralAmount;
        if ($reserved[collateral] < collateralAmount) {
            revert GmxV2OrderAdapter.OverReserved(
                collateral, collateralAmount, $inventory[collateral], $reserved[collateral]
            );
        }
        $reserved[collateral] -= collateralAmount;
    }
}
