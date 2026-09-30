// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IExecutionPolicyRegistry} from "../interfaces/IExecutionPolicyRegistry.sol";
import {IOrderState} from "../interfaces/IOrderState.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPackageWitnessRegistry} from "../interfaces/IPackageWitnessRegistry.sol";
import {IPublicBookEligibilityGate} from "../interfaces/IPublicBookEligibilityGate.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {ITradingSessionPolicy} from "../interfaces/ITradingSessionPolicy.sol";
import {PolicyGateBase} from "./PolicyGateBase.sol";
import {ExecutionPolicyLib} from "../libraries/ExecutionPolicyLib.sol";
import {PublicBookLib} from "../libraries/PublicBookLib.sol";
import {BookEligibility} from "../types/BookTypes.sol";
import {BookId, PackageId, SeriesId} from "../types/Identifiers.sol";
import {OrderTargetKind, PublicOrder} from "../types/OrderTypes.sol";

contract PublicBookEligibilityGate is IPublicBookEligibilityGate, PolicyGateBase {
    bytes32 private constant INELIGIBLE_POLICY = keccak256("SETRYN_BOOK_POLICY_INELIGIBLE");

    IOrderState public immutable orderState;

    constructor(
        IOrderState orderState_,
        ISeriesRegistry seriesRegistry_,
        IPackageRegistry packageRegistry_,
        IExecutionPolicyRegistry policyRegistry_,
        ITradingSessionPolicy sessionPolicy_,
        IPackageWitnessRegistry packageWitnessRegistry_
    ) PolicyGateBase(seriesRegistry_, packageRegistry_, policyRegistry_, sessionPolicy_, packageWitnessRegistry_) {
        if (address(orderState_) == address(0) || address(orderState_).code.length == 0) {
            revert ZeroPolicyDependency(address(orderState_));
        }
        orderState = orderState_;
    }

    function checkOrder(PublicOrder calldata order, bytes32 orderHash, BookId bookId)
        external
        view
        returns (BookEligibility memory eligibility)
    {
        // Time in force and remainder policy are the book's concern: resting orders must be GTC or GTD and keep their
        // remainder open, while IOC and FOK takers are valid and OrderState enforces their fill semantics.
        if (orderHash == bytes32(0) || order.reduceOnly) {
            return BookEligibility({eligible: false, reason: INELIGIBLE_POLICY});
        }
        try this.validateBookOrder(order, bookId, msg.sender) {
            return BookEligibility({eligible: true, reason: bytes32(0)});
        } catch {
            return BookEligibility({eligible: false, reason: INELIGIBLE_POLICY});
        }
    }

    function validateBookOrder(PublicOrder calldata order, BookId bookId, address book) external view {
        if (msg.sender != address(this) || book == address(0)) revert ZeroPolicyDependency(book);
        ExecutionPolicyLib.ResolvedTarget memory resolved = _validateOrder(order);
        bytes32 targetId = order.targetKind == OrderTargetKind.Package
            ? PackageId.unwrap(order.packageId)
            : SeriesId.unwrap(order.seriesId);
        BookId expected = PublicBookLib.deriveBookId(
            block.chainid,
            book,
            address(orderState),
            order.targetKind,
            targetId,
            order.targetVersion,
            order.executionModeId,
            resolved.settlementAssetId,
            resolved.settlementAssetVersion,
            order.feeScheduleId,
            order.feeScheduleVersion,
            resolved.packageWitnessHash
        );
        if (BookId.unwrap(expected) != BookId.unwrap(bookId)) revert ZeroPolicyDependency(book);
    }
}
