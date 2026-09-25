// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Eip712Lib} from "./Eip712Lib.sol";
import {Side} from "../types/Enums.sol";
import {AccountId, FeeScheduleId, PackageId, SeriesId} from "../types/Identifiers.sol";
import {OrderActionId, OrderTargetKind, PublicOrder, RemainderPolicy, TimeInForce} from "../types/OrderTypes.sol";
import {Lots} from "../types/Units.sol";

library OrderHashLib {
    string internal constant ORDER_TYPESTRING =
        "PublicOrder(address signer,bytes32 accountId,bytes32 policyId,bytes32 policyContextHash,bytes32 actionId,uint8 targetKind,bytes32 seriesId,bytes32 packageId,uint32 targetVersion,uint8 side,uint128 lots,int128 priceTicks,uint8 timeInForce,uint64 deadline,bytes32 executionModeId,bytes32 feeScheduleId,uint32 feeScheduleVersion,uint128 maxFeeMinor,address recipient,address permittedExecutor,uint256 nonce,bytes32 salt,bool allowPartialFills,uint128 minimumFillLots,uint8 remainderPolicy,bool postOnly,bool reduceOnly)";
    bytes32 internal constant ORDER_TYPEHASH = keccak256(
        "PublicOrder(address signer,bytes32 accountId,bytes32 policyId,bytes32 policyContextHash,bytes32 actionId,uint8 targetKind,bytes32 seriesId,bytes32 packageId,uint32 targetVersion,uint8 side,uint128 lots,int128 priceTicks,uint8 timeInForce,uint64 deadline,bytes32 executionModeId,bytes32 feeScheduleId,uint32 feeScheduleVersion,uint128 maxFeeMinor,address recipient,address permittedExecutor,uint256 nonce,bytes32 salt,bool allowPartialFills,uint128 minimumFillLots,uint8 remainderPolicy,bool postOnly,bool reduceOnly)"
    );

    error ZeroOrderSigner();
    error ZeroOrderAccount();
    error ZeroOrderPolicy();
    error ZeroOrderPolicyContext();
    error ZeroOrderAction();
    error InvalidOrderTarget();
    error ZeroTargetVersion();
    error InvalidOrderSide();
    error ZeroOrderLots();
    error InvalidTimeInForce();
    error InvalidOrderDeadline(uint64 deadline, uint256 currentTimestamp);
    error GtcLifetimeExceeded(uint64 deadline, uint256 maximumDeadline);
    error ZeroExecutionMode();
    error ZeroFeeSchedule();
    error ZeroFeeScheduleVersion();
    error ZeroOrderRecipient();
    error ZeroOrderSalt();
    error InvalidMinimumFill(uint256 minimumFillLots, uint256 orderLots);
    error InvalidRemainderPolicy();
    error NonCanonicalPartialFillPolicy();
    error NonCanonicalTimeInForcePolicy();

    function hash(PublicOrder memory order) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.signer,
                AccountId.unwrap(order.accountId),
                order.policyId,
                order.policyContextHash,
                OrderActionId.unwrap(order.actionId),
                order.targetKind,
                SeriesId.unwrap(order.seriesId),
                PackageId.unwrap(order.packageId),
                order.targetVersion,
                order.side,
                Lots.unwrap(order.lots),
                order.priceTicks,
                order.timeInForce,
                order.deadline,
                order.executionModeId,
                FeeScheduleId.unwrap(order.feeScheduleId),
                order.feeScheduleVersion,
                order.maxFeeMinor,
                order.recipient,
                order.permittedExecutor,
                order.nonce,
                order.salt,
                order.allowPartialFills,
                Lots.unwrap(order.minimumFillLots),
                order.remainderPolicy,
                order.postOnly,
                order.reduceOnly
            )
        );
    }

    function digest(PublicOrder memory order, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return Eip712Lib.toTypedDataDigest(Eip712Lib.domainSeparator(chainId, verifyingContract), hash(order));
    }

    function validate(PublicOrder memory order, uint256 currentTimestamp, uint64 maximumOrderLifetime) internal pure {
        if (order.signer == address(0)) revert ZeroOrderSigner();
        if (AccountId.unwrap(order.accountId) == bytes32(0)) revert ZeroOrderAccount();
        if (order.policyId == bytes32(0)) revert ZeroOrderPolicy();
        if (order.policyContextHash == bytes32(0)) revert ZeroOrderPolicyContext();
        if (OrderActionId.unwrap(order.actionId) == bytes32(0)) revert ZeroOrderAction();
        _validateTarget(order);
        if (order.targetVersion == 0) revert ZeroTargetVersion();
        if (order.side != Side.Buy && order.side != Side.Sell) revert InvalidOrderSide();

        uint256 orderLots = Lots.unwrap(order.lots);
        if (orderLots == 0) revert ZeroOrderLots();
        if (order.timeInForce == TimeInForce.Unspecified) revert InvalidTimeInForce();
        if (order.deadline < currentTimestamp) revert InvalidOrderDeadline(order.deadline, currentTimestamp);
        if (order.timeInForce == TimeInForce.GTC) {
            uint256 maximumDeadline = currentTimestamp + maximumOrderLifetime;
            if (order.deadline > maximumDeadline) revert GtcLifetimeExceeded(order.deadline, maximumDeadline);
        }
        if (order.executionModeId == bytes32(0)) revert ZeroExecutionMode();
        if (FeeScheduleId.unwrap(order.feeScheduleId) == bytes32(0)) revert ZeroFeeSchedule();
        if (order.feeScheduleVersion == 0) revert ZeroFeeScheduleVersion();
        if (order.recipient == address(0)) revert ZeroOrderRecipient();
        if (order.salt == bytes32(0)) revert ZeroOrderSalt();

        uint256 minimumFillLots = Lots.unwrap(order.minimumFillLots);
        if (minimumFillLots == 0 || minimumFillLots > orderLots) {
            revert InvalidMinimumFill(minimumFillLots, orderLots);
        }
        if (order.remainderPolicy == RemainderPolicy.Unspecified) revert InvalidRemainderPolicy();
        if (!order.allowPartialFills && minimumFillLots != orderLots) revert NonCanonicalPartialFillPolicy();
        _validateTimeInForcePolicy(order, orderLots, minimumFillLots);
    }

    function _validateTarget(PublicOrder memory order) private pure {
        bool hasSeries = SeriesId.unwrap(order.seriesId) != bytes32(0);
        bool hasPackage = PackageId.unwrap(order.packageId) != bytes32(0);
        if (order.targetKind == OrderTargetKind.Series) {
            if (!hasSeries || hasPackage) revert InvalidOrderTarget();
        } else if (order.targetKind == OrderTargetKind.Package) {
            if (!hasPackage || hasSeries) revert InvalidOrderTarget();
        } else {
            revert InvalidOrderTarget();
        }
    }

    function _validateTimeInForcePolicy(PublicOrder memory order, uint256 orderLots, uint256 minimumFillLots)
        private
        pure
    {
        if (order.timeInForce == TimeInForce.FOK) {
            if (
                order.allowPartialFills || minimumFillLots != orderLots
                    || order.remainderPolicy != RemainderPolicy.CancelRemainder
            ) revert NonCanonicalTimeInForcePolicy();
            return;
        }
        if (order.timeInForce == TimeInForce.IOC) {
            if (order.remainderPolicy != RemainderPolicy.CancelRemainder) revert NonCanonicalTimeInForcePolicy();
            return;
        }
        if (order.timeInForce != TimeInForce.GTC && order.timeInForce != TimeInForce.GTD) {
            revert InvalidTimeInForce();
        }
        if (!order.allowPartialFills && order.remainderPolicy != RemainderPolicy.KeepOpen) {
            revert NonCanonicalTimeInForcePolicy();
        }
    }
}
