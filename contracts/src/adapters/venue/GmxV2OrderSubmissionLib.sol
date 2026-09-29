// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OperationalAdapterLib} from "../../libraries/OperationalAdapterLib.sol";
import {AccountId, MarketId, PackageId, SeriesId} from "../../types/Identifiers.sol";
import {
    ExecutionGuaranteeClass,
    ExternalVenueRequest,
    ExternalVenueResult,
    OperationalActionState,
    OperationalBinding
} from "../../types/OperationalAdapterTypes.sol";
import {GmxV2OrderDependencies} from "./GmxV2OrderTypes.sol";
import {StorageSlot} from "@openzeppelin/contracts/utils/StorageSlot.sol";
import "./GmxV2OrderAdapter.sol";

/// Linked logic for the GMX V2 order adapter: order staging, reservation, bounded submission, and inventory
/// withdrawal. Runs through DELEGATECALL in the adapter's context, so custody, allowances, and native value stay with
/// the adapter.
library GmxV2OrderSubmissionLib {
    using SafeERC20 for IERC20;

    uint8 internal constant LIMIT_DECREASE = 5;
    uint8 internal constant LIMIT_INCREASE = 3;
    uint8 internal constant LIMIT_SWAP = 1;
    uint8 internal constant MARKET_DECREASE = 4;
    uint8 internal constant MARKET_INCREASE = 2;
    uint8 internal constant MARKET_SWAP = 0;
    uint256 internal constant MAX_SWAP_PATH_LENGTH = 5;
    uint8 internal constant NO_SWAP = 0;
    uint8 internal constant STOP_INCREASE = 8;
    uint8 internal constant STOP_LOSS_DECREASE = 6;

    function stageOrder(
        GmxV2OrderDependencies memory deps,
        mapping(bytes32 actionHash => GmxV2OrderAdapter.StagedGmxV2Order staged) storage $staged,
        mapping(address token => uint256 inventoried) storage $inventory,
        mapping(address token => uint256 reserved) storage $reserved,
        bytes32 $nativeInventoriedSlot,
        bytes32 $nativeReservedSlot,
        GmxV2OrderAdapter.GmxV2StageOrderInputs calldata inputs
    ) external returns (bytes32 actionHash) {
        address market = inputs.market;
        address initialCollateralToken = inputs.initialCollateralToken;
        address receiver = inputs.receiver;
        uint256 sizeDeltaUsd = inputs.sizeDeltaUsd;
        uint256 initialCollateralDeltaAmount = inputs.initialCollateralDeltaAmount;
        uint256 triggerPrice = inputs.triggerPrice;
        uint256 executionFee = inputs.executionFee;
        uint8 orderType = inputs.orderType;
        GmxV2OrderAdapter.GmxV2OrderKind kind = inputs.kind;
        if (receiver == address(0)) revert GmxV2OrderAdapter.ZeroReceiver();
        if (initialCollateralToken == address(0)) revert GmxV2OrderAdapter.ZeroCollateralToken();
        if (initialCollateralToken.code.length == 0) {
            revert GmxV2OrderAdapter.CollateralWithoutCode(initialCollateralToken);
        }
        if (executionFee == 0) revert GmxV2OrderAdapter.ZeroExecutionFee();
        if (inputs.recoveryPolicyHash == bytes32(0)) revert GmxV2OrderAdapter.ZeroRecoveryPolicyHash();
        if (inputs.deadline <= block.timestamp) {
            revert GmxV2OrderAdapter.ActionExpired(inputs.deadline, block.timestamp);
        }
        if (inputs.swapPath.length > MAX_SWAP_PATH_LENGTH) {
            revert GmxV2OrderAdapter.SwapPathTooLong(inputs.swapPath.length);
        }
        for (uint256 i = 0; i < inputs.swapPath.length; i++) {
            if (inputs.swapPath[i] == address(0) || inputs.swapPath[i].code.length == 0) {
                revert GmxV2OrderAdapter.SwapPathTokenWithoutCode(inputs.swapPath[i]);
            }
        }
        _validateKindAndType(kind, orderType, sizeDeltaUsd, initialCollateralDeltaAmount, triggerPrice, inputs.swapPath);

        if (kind == GmxV2OrderAdapter.GmxV2OrderKind.Swap) {
            // Production swaps carry no market; the swap path is a bounded list of market
            // addresses (never collateral tokens), so no first-hop token check applies.
            if (market != address(0)) revert GmxV2OrderAdapter.UnexpectedMarketForSwap(market);
            if (inputs.swapPath.length == 0) revert GmxV2OrderAdapter.EmptySwapPath();
        } else {
            if (market == address(0)) revert GmxV2OrderAdapter.ZeroMarket();
            if (market.code.length == 0) revert GmxV2OrderAdapter.MarketWithoutCode(market);
            _validateMarketMembership(deps, market, initialCollateralToken);
        }

        bytes32 swapPathHash = hashSwapPath(inputs.swapPath);
        GmxV2OrderAdapter.GmxV2ActionHashInputs memory hashInputs = GmxV2OrderAdapter.GmxV2ActionHashInputs({
            kind: uint8(kind),
            market: market,
            initialCollateralToken: initialCollateralToken,
            swapPathHash: swapPathHash,
            receiver: receiver,
            uiFeeReceiver: inputs.uiFeeReceiver,
            sizeDeltaUsd: sizeDeltaUsd,
            initialCollateralDeltaAmount: initialCollateralDeltaAmount,
            triggerPrice: triggerPrice,
            acceptablePrice: inputs.acceptablePrice,
            executionFee: executionFee,
            orderType: orderType,
            isLong: inputs.isLong,
            shouldUnwrapNativeToken: inputs.shouldUnwrapNativeToken,
            referralCode: inputs.referralCode,
            deadline: inputs.deadline,
            recoveryPolicyHash: inputs.recoveryPolicyHash
        });
        actionHash = hashStagedAction(hashInputs);
        if ($staged[actionHash].initialCollateralToken != address(0)) {
            revert GmxV2OrderAdapter.DuplicateAction(actionHash);
        }

        _reserve(
            $inventory,
            $reserved,
            $nativeInventoriedSlot,
            $nativeReservedSlot,
            kind,
            initialCollateralToken,
            initialCollateralDeltaAmount,
            executionFee
        );

        GmxV2OrderAdapter.StagedGmxV2Order storage staged = $staged[actionHash];
        staged.kind = kind;
        staged.market = market;
        staged.initialCollateralToken = initialCollateralToken;
        staged.swapPathHash = swapPathHash;
        staged.receiver = receiver;
        staged.uiFeeReceiver = inputs.uiFeeReceiver;
        staged.sizeDeltaUsd = sizeDeltaUsd;
        staged.initialCollateralDeltaAmount = initialCollateralDeltaAmount;
        staged.triggerPrice = triggerPrice;
        staged.acceptablePrice = inputs.acceptablePrice;
        staged.executionFee = executionFee;
        staged.orderType = orderType;
        staged.isLong = inputs.isLong;
        staged.shouldUnwrapNativeToken = inputs.shouldUnwrapNativeToken;
        staged.referralCode = inputs.referralCode;
        staged.deadline = inputs.deadline;
        staged.recoveryPolicyHash = inputs.recoveryPolicyHash;
        for (uint256 i = 0; i < inputs.swapPath.length; i++) {
            staged.swapPath.push(inputs.swapPath[i]);
        }

        emit GmxV2OrderAdapter.GmxV2OrderStaged(actionHash, market, initialCollateralToken);
    }

    function submitExternalAction(
        GmxV2OrderDependencies memory deps,
        mapping(bytes32 actionHash => GmxV2OrderAdapter.StagedGmxV2Order staged) storage $staged,
        mapping(address token => uint256 inventoried) storage $inventory,
        bytes32 $nativeInventoriedSlot,
        mapping(bytes32 requestHash => GmxV2OrderAdapter.StoredGmxV2Request stored) storage $requests,
        mapping(bytes32 requestHash => ExternalVenueResult result) storage $results,
        mapping(bytes32 requestHash => bool storedResult) storage $resultStored,
        mapping(bytes32 orderKey => bytes32 requestHash) storage $orderToRequest,
        ExternalVenueRequest calldata request
    ) external returns (ExternalVenueResult memory result) {
        if (msg.sender != deps.executor) {
            revert GmxV2OrderAdapter.OnlyExecutor(msg.sender, deps.executor);
        }
        if (request.guaranteeClass != ExecutionGuaranteeClass.BoundedAsync) {
            revert GmxV2OrderAdapter.UnsupportedGuaranteeClass();
        }
        _validateAsyncBounds(request);

        OperationalBinding calldata binding = request.binding;
        if (binding.chainId != block.chainid || binding.chainId != deps.expectedChainId) {
            revert GmxV2OrderAdapter.BindingChainMismatch(binding.chainId, block.chainid);
        }
        if (block.timestamp > binding.deadline) {
            revert GmxV2OrderAdapter.BindingExpired(binding.deadline, block.timestamp);
        }
        if (
            binding.deploymentId == bytes32(0) || AccountId.unwrap(binding.accountId) == bytes32(0)
                || MarketId.unwrap(binding.marketId) == bytes32(0) || SeriesId.unwrap(binding.seriesId) == bytes32(0)
                || binding.seriesVersion == 0 || PackageId.unwrap(binding.packageId) == bytes32(0)
                || binding.packageVersion == 0 || binding.actionHash == bytes32(0) || binding.nonce == 0
                || binding.minValue > binding.maxValue || binding.recipientPolicyHash == bytes32(0)
                || binding.expectedPostconditionsHash == bytes32(0)
        ) revert GmxV2OrderAdapter.InvalidBinding();

        GmxV2OrderAdapter.StagedGmxV2Order storage staged = $staged[binding.actionHash];
        if (staged.initialCollateralToken == address(0)) {
            revert GmxV2OrderAdapter.UnknownStagedAction(binding.actionHash);
        }
        if (staged.cancelled) revert GmxV2OrderAdapter.ActionCancelled(binding.actionHash);
        if (staged.consumed) revert GmxV2OrderAdapter.ActionAlreadyConsumed(binding.actionHash);
        if (block.timestamp > staged.deadline) {
            revert GmxV2OrderAdapter.ActionExpired(staged.deadline, block.timestamp);
        }
        if (staged.recoveryPolicyHash != binding.recipientPolicyHash) {
            revert GmxV2OrderAdapter.RecoveryPolicyMismatch(staged.recoveryPolicyHash, binding.recipientPolicyHash);
        }
        if (staged.recoveryPolicyHash != request.recoveryPolicyHash) {
            revert GmxV2OrderAdapter.RecoveryPolicyMismatch(staged.recoveryPolicyHash, request.recoveryPolicyHash);
        }
        bytes32 derived = hashStagedAction(
            GmxV2OrderAdapter.GmxV2ActionHashInputs({
                kind: uint8(staged.kind),
                market: staged.market,
                initialCollateralToken: staged.initialCollateralToken,
                swapPathHash: staged.swapPathHash,
                receiver: staged.receiver,
                uiFeeReceiver: staged.uiFeeReceiver,
                sizeDeltaUsd: staged.sizeDeltaUsd,
                initialCollateralDeltaAmount: staged.initialCollateralDeltaAmount,
                triggerPrice: staged.triggerPrice,
                acceptablePrice: staged.acceptablePrice,
                executionFee: staged.executionFee,
                orderType: staged.orderType,
                isLong: staged.isLong,
                shouldUnwrapNativeToken: staged.shouldUnwrapNativeToken,
                referralCode: staged.referralCode,
                deadline: staged.deadline,
                recoveryPolicyHash: staged.recoveryPolicyHash
            })
        );
        if (derived != binding.actionHash) revert GmxV2OrderAdapter.ActionHashMismatch(binding.actionHash, derived);
        if (binding.deadline != staged.deadline) {
            revert GmxV2OrderAdapter.BindingDeadlineMismatch(binding.deadline, staged.deadline);
        }
        bytes32 expectedPostconditions = hashExpectedPostconditions(
            deps,
            GmxV2OrderAdapter.GmxV2PostconditionsInputs({
                actionHash: binding.actionHash,
                market: staged.market,
                initialCollateralToken: staged.initialCollateralToken,
                swapPathHash: staged.swapPathHash,
                receiver: staged.receiver,
                sizeDeltaUsd: staged.sizeDeltaUsd,
                initialCollateralDeltaAmount: staged.initialCollateralDeltaAmount,
                triggerPrice: staged.triggerPrice,
                acceptablePrice: staged.acceptablePrice,
                executionFee: staged.executionFee,
                orderType: staged.orderType,
                isLong: staged.isLong,
                shouldUnwrapNativeToken: staged.shouldUnwrapNativeToken,
                deadline: staged.deadline,
                recoveryPolicyHash: staged.recoveryPolicyHash
            })
        );
        if (binding.expectedPostconditionsHash != expectedPostconditions) {
            revert GmxV2OrderAdapter.ExpectedPostconditionsMismatch(
                expectedPostconditions, binding.expectedPostconditionsHash
            );
        }
        _validateTerminalFallback(request, binding);

        ExternalVenueRequest memory requestCopy = request;
        bytes32 requestHash = OperationalAdapterLib.hashExternalRequest(requestCopy);
        if ($resultStored[requestHash]) revert GmxV2OrderAdapter.RequestAlreadySubmitted(requestHash);

        staged.consumed = true;

        bool isDecrease = staged.kind == GmxV2OrderAdapter.GmxV2OrderKind.Decrease;
        address collateral = staged.initialCollateralToken;
        // Decrease orders never move collateral: initialCollateralDeltaAmount is withdrawal intent.
        uint256 collateralAmount = isDecrease ? 0 : staged.initialCollateralDeltaAmount;
        uint256 executionFee = staged.executionFee;

        uint256 nativeBefore = address(this).balance;
        if (nativeBefore < executionFee) revert GmxV2OrderAdapter.InsufficientNativeFee(nativeBefore, executionFee);
        uint256 collateralBefore;
        if (!isDecrease) {
            collateralBefore = IERC20(collateral).balanceOf(address(this));
            if (collateralBefore < collateralAmount) {
                revert GmxV2OrderAdapter.InsufficientInventory(collateral, collateralBefore, collateralAmount);
            }
            IERC20(collateral).forceApprove(deps.tokenTransferRouter, collateralAmount);
        }

        bytes32[] memory emptyDataList = new bytes32[](0);
        GmxV2CreateOrderParams memory params = GmxV2CreateOrderParams({
            addresses: GmxV2CreateOrderParamsAddresses({
                receiver: staged.receiver,
                cancellationReceiver: address(this),
                callbackContract: address(this),
                uiFeeReceiver: staged.uiFeeReceiver,
                market: staged.market,
                initialCollateralToken: staged.initialCollateralToken,
                swapPath: staged.swapPath
            }),
            numbers: GmxV2CreateOrderParamsNumbers({
                sizeDeltaUsd: staged.sizeDeltaUsd,
                initialCollateralDeltaAmount: staged.initialCollateralDeltaAmount,
                triggerPrice: staged.triggerPrice,
                acceptablePrice: staged.acceptablePrice,
                executionFee: staged.executionFee,
                callbackGasLimit: deps.callbackGasLimit,
                minOutputAmount: 0,
                validFromTime: 0
            }),
            orderType: staged.orderType,
            decreasePositionSwapType: NO_SWAP,
            isLong: staged.isLong,
            shouldUnwrapNativeToken: staged.shouldUnwrapNativeToken,
            autoCancel: false,
            referralCode: staged.referralCode,
            dataList: emptyDataList
        });

        bytes[] memory calls;
        if (isDecrease) {
            calls = new bytes[](2);
            calls[0] = abi.encodeCall(IGmxV2ExchangeRouter.sendWnt, (deps.orderVault, executionFee));
            calls[1] = abi.encodeCall(IGmxV2ExchangeRouter.createOrder, (params));
        } else {
            calls = new bytes[](3);
            calls[0] = abi.encodeCall(IGmxV2ExchangeRouter.sendWnt, (deps.orderVault, executionFee));
            calls[1] = abi.encodeCall(IGmxV2ExchangeRouter.sendTokens, (collateral, deps.orderVault, collateralAmount));
            calls[2] = abi.encodeCall(IGmxV2ExchangeRouter.createOrder, (params));
        }

        bytes[] memory multicallResults = deps.exchangeRouter.multicall{value: executionFee}(calls);
        if (!isDecrease) {
            IERC20(collateral).forceApprove(deps.tokenTransferRouter, 0);
            if (IERC20(collateral).allowance(address(this), deps.tokenTransferRouter) != 0) {
                revert GmxV2OrderAdapter.AllowanceNotCleared(
                    collateral, IERC20(collateral).allowance(address(this), deps.tokenTransferRouter)
                );
            }
        }
        if (multicallResults.length != calls.length) {
            revert GmxV2OrderAdapter.MulticallArityMismatch(calls.length, multicallResults.length);
        }
        bytes32 orderKey = abi.decode(multicallResults[multicallResults.length - 1], (bytes32));
        if (orderKey == bytes32(0)) revert GmxV2OrderAdapter.ZeroOrderKey();

        uint256 nativeAfter = address(this).balance;
        if (nativeBefore - nativeAfter != executionFee) {
            revert GmxV2OrderAdapter.InexactNativeDelta(executionFee, nativeBefore - nativeAfter);
        }
        StorageSlot.getUint256Slot($nativeInventoriedSlot).value -= executionFee;
        if (!isDecrease) {
            uint256 collateralAfter = IERC20(collateral).balanceOf(address(this));
            if (collateralBefore - collateralAfter != collateralAmount) {
                revert GmxV2OrderAdapter.InexactTokenDelta(
                    collateral, collateralAmount, collateralBefore - collateralAfter
                );
            }
            $inventory[collateral] -= collateralAmount;
        }

        $requests[requestHash] = GmxV2OrderAdapter.StoredGmxV2Request({
            actionHash: binding.actionHash,
            kind: staged.kind,
            orderKey: orderKey,
            market: staged.market,
            initialCollateralToken: collateral,
            collateralAmount: collateralAmount,
            executionFee: executionFee,
            sizeDeltaUsd: staged.sizeDeltaUsd,
            timeoutAt: request.timeoutAt,
            recoveryDeadline: request.recoveryDeadline,
            expectedPostconditionsHash: binding.expectedPostconditionsHash,
            minValue: binding.minValue,
            maxValue: binding.maxValue,
            maximumResidual: request.maximumResidual,
            recoveryPolicyHash: request.recoveryPolicyHash,
            reservationReleased: false,
            terminalState: request.terminalFallback.state,
            terminalRealized: request.terminalFallback.realizedValue,
            terminalResidual: request.terminalFallback.residualValue,
            terminalPostconditions: request.terminalFallback.postconditionsHash,
            terminalOutcome: request.terminalFallback.outcomeHash
        });
        $orderToRequest[orderKey] = requestHash;

        bytes32 evidenceHash = keccak256(
            abi.encode(
                "SetrynGmxV2SubmissionV1",
                deps.expectedChainId,
                address(this),
                address(deps.exchangeRouter),
                deps.tokenTransferRouter,
                deps.orderVault,
                deps.orderHandler,
                requestHash,
                binding.actionHash,
                orderKey,
                collateral,
                collateralAmount,
                executionFee
            )
        );
        if (evidenceHash == bytes32(0)) revert GmxV2OrderAdapter.ZeroEvidenceCommitment();

        result = ExternalVenueResult({
            state: OperationalActionState.Submitted,
            realizedValue: 0,
            residualValue: 0,
            postconditionsHash: bytes32(0),
            venueActionReference: orderKey,
            evidenceHash: evidenceHash,
            recoveryOutcomeHash: bytes32(0)
        });
        $results[requestHash] = result;
        $resultStored[requestHash] = true;

        emit GmxV2OrderAdapter.GmxV2OrderSubmitted(requestHash, binding.actionHash, orderKey);
    }

    function _validateKindAndType(
        GmxV2OrderAdapter.GmxV2OrderKind kind,
        uint8 orderType,
        uint256 sizeDeltaUsd,
        uint256 collateralDelta,
        uint256 triggerPrice,
        address[] calldata swapPath
    ) internal pure {
        if (
            orderType != MARKET_SWAP && orderType != LIMIT_SWAP && orderType != MARKET_INCREASE
                && orderType != LIMIT_INCREASE && orderType != MARKET_DECREASE && orderType != LIMIT_DECREASE
                && orderType != STOP_LOSS_DECREASE && orderType != STOP_INCREASE
        ) revert GmxV2OrderAdapter.UnknownOrderType(orderType);
        if (kind == GmxV2OrderAdapter.GmxV2OrderKind.Increase) {
            if (orderType != MARKET_INCREASE && orderType != LIMIT_INCREASE && orderType != STOP_INCREASE) {
                revert GmxV2OrderAdapter.InvalidOrderTypeForKind(orderType, uint8(kind));
            }
            if (sizeDeltaUsd == 0) revert GmxV2OrderAdapter.ZeroSizeDelta();
            if (collateralDelta == 0) revert GmxV2OrderAdapter.ZeroCollateralAmount();
        } else if (kind == GmxV2OrderAdapter.GmxV2OrderKind.Decrease) {
            if (orderType != MARKET_DECREASE && orderType != LIMIT_DECREASE && orderType != STOP_LOSS_DECREASE) {
                revert GmxV2OrderAdapter.InvalidOrderTypeForKind(orderType, uint8(kind));
            }
            if (sizeDeltaUsd == 0) revert GmxV2OrderAdapter.ZeroSizeDelta();
        } else {
            if (orderType != MARKET_SWAP && orderType != LIMIT_SWAP) {
                revert GmxV2OrderAdapter.InvalidOrderTypeForKind(orderType, uint8(kind));
            }
            if (sizeDeltaUsd != 0) revert GmxV2OrderAdapter.NonzeroSizeForSwap();
            if (collateralDelta == 0) revert GmxV2OrderAdapter.ZeroCollateralAmount();
        }
        if (
            (orderType == LIMIT_SWAP
                    || orderType == LIMIT_INCREASE
                    || orderType == LIMIT_DECREASE
                    || orderType == STOP_LOSS_DECREASE
                    || orderType == STOP_INCREASE) && triggerPrice == 0
        ) {
            revert GmxV2OrderAdapter.LimitOrderMissingTrigger(orderType);
        }
        if (swapPath.length > MAX_SWAP_PATH_LENGTH) revert GmxV2OrderAdapter.SwapPathTooLong(swapPath.length);
    }

    function _validateMarketMembership(GmxV2OrderDependencies memory deps, address market, address collateral)
        internal
        view
    {
        GmxV2MarketProps memory props = deps.reader.getMarket(address(deps.dataStore), market);
        if (props.marketToken == address(0)) revert GmxV2OrderAdapter.MarketMissing(market);
        if (collateral != props.longToken && collateral != props.shortToken) {
            revert GmxV2OrderAdapter.MarketMembershipMismatch(market, collateral);
        }
    }

    function _reserve(
        mapping(address token => uint256 inventoried) storage $inventory,
        mapping(address token => uint256 reserved) storage $reserved,
        bytes32 $nativeInventoriedSlot,
        bytes32 $nativeReservedSlot,
        GmxV2OrderAdapter.GmxV2OrderKind kind,
        address collateral,
        uint256 collateralAmount,
        uint256 executionFee
    ) internal {
        uint256 nativeInventoriedBefore = StorageSlot.getUint256Slot($nativeInventoriedSlot).value;
        uint256 nativeReservedBefore = StorageSlot.getUint256Slot($nativeReservedSlot).value;
        if (nativeReservedBefore + executionFee > nativeInventoriedBefore) {
            revert GmxV2OrderAdapter.NativeOverReserved(executionFee, nativeInventoriedBefore, nativeReservedBefore);
        }
        StorageSlot.getUint256Slot($nativeReservedSlot).value = nativeReservedBefore + executionFee;
        // Decrease orders never reserve collateral: initialCollateralDeltaAmount is withdrawal intent.
        if (kind == GmxV2OrderAdapter.GmxV2OrderKind.Decrease) return;
        uint256 inventoriedCollateral = $inventory[collateral];
        uint256 reservedCollateral = $reserved[collateral];
        if (reservedCollateral + collateralAmount > inventoriedCollateral) {
            revert GmxV2OrderAdapter.OverReserved(
                collateral, collateralAmount, inventoriedCollateral, reservedCollateral
            );
        }
        $reserved[collateral] = reservedCollateral + collateralAmount;
    }

    function _validateAsyncBounds(ExternalVenueRequest calldata request) internal view {
        if (
            request.timeoutAt <= request.binding.deadline || request.recoveryDeadline <= request.timeoutAt
                || AccountId.unwrap(request.interimExposureOwner) == bytes32(0)
                || request.recoveryPolicyHash == bytes32(0) || request.reservationHash == bytes32(0)
        ) revert GmxV2OrderAdapter.InvalidAsyncBounds();
        uint256 absMin = _absolute(request.binding.minValue);
        uint256 absMax = _absolute(request.binding.maxValue);
        uint256 bound = absMin > absMax ? absMin : absMax;
        if (request.maximumResidual > bound) revert GmxV2OrderAdapter.InvalidAsyncBounds();
    }

    function _validateTerminalFallback(ExternalVenueRequest calldata request, OperationalBinding calldata binding)
        internal
        pure
    {
        if (
            request.terminalFallback.state != OperationalActionState.Recovered
                && request.terminalFallback.state != OperationalActionState.NoEffect
        ) revert GmxV2OrderAdapter.InvalidTerminalFallback();
        if (request.terminalFallback.postconditionsHash != binding.expectedPostconditionsHash) {
            revert GmxV2OrderAdapter.InvalidTerminalFallback();
        }
        if (request.terminalFallback.outcomeHash == bytes32(0)) revert GmxV2OrderAdapter.InvalidTerminalFallback();
        if (
            request.terminalFallback.realizedValue < binding.minValue
                || request.terminalFallback.realizedValue > binding.maxValue
        ) revert GmxV2OrderAdapter.InvalidTerminalFallback();
        if (_absolute(request.terminalFallback.residualValue) > request.maximumResidual) {
            revert GmxV2OrderAdapter.MaximumResidualExceeded(
                _absolute(request.terminalFallback.residualValue), request.maximumResidual
            );
        }
        if (
            request.terminalFallback.state == OperationalActionState.NoEffect
                && (request.terminalFallback.realizedValue != 0 || request.terminalFallback.residualValue != 0)
        ) revert GmxV2OrderAdapter.InvalidTerminalFallback();
    }

    function withdrawInventory(
        mapping(address token => uint256 inventoried) storage $inventory,
        mapping(address token => uint256 reserved) storage $reserved,
        address token,
        uint256 amount,
        address recipient
    ) external {
        if (token == address(0)) revert GmxV2OrderAdapter.ZeroCollateralToken();
        if (recipient == address(0)) revert GmxV2OrderAdapter.ZeroReceiver();
        if (amount == 0) revert GmxV2OrderAdapter.ZeroCollateralAmount();
        uint256 inventoried = $inventory[token];
        uint256 reservedAmount = $reserved[token];
        if (reservedAmount > inventoried) revert GmxV2OrderAdapter.InsufficientUnreserved(token, amount, 0);
        uint256 unreserved = inventoried - reservedAmount;
        if (amount > unreserved) revert GmxV2OrderAdapter.InsufficientUnreserved(token, amount, unreserved);
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        if (amount > balanceBefore) revert GmxV2OrderAdapter.InsufficientBalance(token, balanceBefore, amount);
        $inventory[token] = inventoried - amount;
        IERC20(token).safeTransfer(recipient, amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        if (balanceBefore - balanceAfter != amount) {
            revert GmxV2OrderAdapter.InexactTokenDelta(token, amount, balanceBefore - balanceAfter);
        }
        emit GmxV2OrderAdapter.GmxV2InventoryWithdrawn(token, recipient, amount);
    }

    function withdrawNativeInventory(
        bytes32 $nativeInventoriedSlot,
        bytes32 $nativeReservedSlot,
        uint256 amount,
        address recipient
    ) external {
        if (recipient == address(0)) revert GmxV2OrderAdapter.ZeroReceiver();
        if (amount == 0) revert GmxV2OrderAdapter.ZeroNativeAmount();
        uint256 inventoried = StorageSlot.getUint256Slot($nativeInventoriedSlot).value;
        uint256 reservedAmount = StorageSlot.getUint256Slot($nativeReservedSlot).value;
        if (reservedAmount > inventoried) revert GmxV2OrderAdapter.InsufficientNativeUnreserved(amount, 0);
        uint256 unreserved = inventoried - reservedAmount;
        if (amount > unreserved) revert GmxV2OrderAdapter.InsufficientNativeUnreserved(amount, unreserved);
        uint256 balanceBefore = address(this).balance;
        if (amount > balanceBefore) revert GmxV2OrderAdapter.InsufficientNativeBalance(balanceBefore, amount);
        StorageSlot.getUint256Slot($nativeInventoriedSlot).value = inventoried - amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert GmxV2OrderAdapter.NativeTransferFailed(recipient, amount);
        uint256 balanceAfter = address(this).balance;
        if (balanceBefore - balanceAfter != amount) {
            revert GmxV2OrderAdapter.InexactNativeDelta(amount, balanceBefore - balanceAfter);
        }
        emit GmxV2OrderAdapter.GmxV2NativeInventoryWithdrawn(recipient, amount);
    }

    function hashSwapPath(address[] memory swapPath) internal pure returns (bytes32) {
        return keccak256(abi.encode("SetrynGmxV2SwapPathV1", swapPath));
    }

    function hashStagedAction(GmxV2OrderAdapter.GmxV2ActionHashInputs memory inputs) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "SetrynGmxV2OrderV1",
                inputs.kind,
                inputs.market,
                inputs.initialCollateralToken,
                inputs.swapPathHash,
                inputs.receiver,
                inputs.uiFeeReceiver,
                inputs.sizeDeltaUsd,
                inputs.initialCollateralDeltaAmount,
                inputs.triggerPrice,
                inputs.acceptablePrice,
                inputs.executionFee,
                inputs.orderType,
                inputs.isLong,
                inputs.shouldUnwrapNativeToken,
                inputs.referralCode,
                inputs.deadline,
                inputs.recoveryPolicyHash
            )
        );
    }

    /// @notice Canonical executor-precommittable expected postconditions for a staged GMX V2 order.
    /// @dev Pure and precomputable before submission; commits to the staged market, collateral,
    ///      size, prices, execution fee, route hash, order type, direction, and policy, never to
    ///      the keeper-returned order key or realized fill, which live only in evidenceHash.
    function hashExpectedPostconditions(
        GmxV2OrderDependencies memory deps,
        GmxV2OrderAdapter.GmxV2PostconditionsInputs memory inputs
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "SetrynGmxV2PostconditionsV1",
                inputs.actionHash,
                inputs.market,
                inputs.initialCollateralToken,
                inputs.swapPathHash,
                inputs.receiver,
                inputs.sizeDeltaUsd,
                inputs.initialCollateralDeltaAmount,
                inputs.triggerPrice,
                inputs.acceptablePrice,
                inputs.executionFee,
                inputs.orderType,
                inputs.isLong,
                inputs.shouldUnwrapNativeToken,
                inputs.deadline,
                inputs.recoveryPolicyHash
            )
        );
    }

    function _absolute(int256 value) internal pure returns (uint256) {
        if (value >= 0) return uint256(value);
        if (value == type(int256).min) return uint256(type(int256).max) + 1;
        return uint256(-value);
    }
}
