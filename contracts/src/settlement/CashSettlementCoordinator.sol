// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICashSettlementCoordinator} from "../interfaces/ICashSettlementCoordinator.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IFixingEngine} from "../interfaces/IFixingEngine.sol";
import {IFundedFeeEngine} from "../interfaces/IFundedFeeEngine.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {SettlementLib} from "../libraries/SettlementLib.sol";
import {TerminalClaim} from "../types/CollateralTypes.sol";
import {TerminalClaimStatus} from "../types/Enums.sol";
import {FeeActionRequest} from "../types/FeeEngineTypes.sol";
import {PositionId, SettlementId, TerminalClaimId} from "../types/Identifiers.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../types/PositionTypes.sol";
import {
    CanonicalSettlementFixing,
    SettlementCollateralDelta,
    SettlementFeeReceipt,
    SettlementMode,
    SettlementRecord
} from "../types/SettlementTypes.sol";
import {FixingSlot} from "../types/SeriesQualification.sol";

import {CashSettlementContextLib} from "./CashSettlementContextLib.sol";
import {CashSettlementRecordLib} from "./CashSettlementRecordLib.sol";
import {CashSettlementDependencies, PositionContext} from "./CashSettlementTypes.sol";

import {ICashSettlementCoordinatorLinkedErrors} from "./ICashSettlementCoordinatorLinkedErrors.sol";

contract CashSettlementCoordinator is
    ICashSettlementCoordinatorLinkedErrors,
    ICashSettlementCoordinator,
    ReentrancyGuard
{
    uint256 internal constant MAX_FEE_ACTIONS = 2;

    IPositionEngine private immutable _positionEngine;
    IFixingEngine private immutable _fixingEngine;
    IFundedFeeEngine private immutable _fundedFeeEngine;
    ICollateralVault private immutable _collateralVault;
    ISeriesRegistry private immutable _seriesRegistry;
    IPortfolioRiskEngine private immutable _portfolioRiskEngine;

    mapping(SettlementId settlementId => SettlementRecord record) private _settlements;
    mapping(PositionId positionId => SettlementId settlementId) private _positionSettlement;
    mapping(TerminalClaimId claimId => SettlementId settlementId) private _claimSettlement;

    constructor(
        IPositionEngine positionEngine_,
        IFixingEngine fixingEngine_,
        IFundedFeeEngine fundedFeeEngine_,
        IPortfolioRiskEngine portfolioRiskEngine_
    ) {
        _requireDependency(address(positionEngine_));
        _requireDependency(address(fixingEngine_));
        _requireDependency(address(fundedFeeEngine_));
        _requireDependency(address(portfolioRiskEngine_));
        if (address(portfolioRiskEngine_.positionEngine()) != address(positionEngine_)) {
            revert DependencyGraphMismatch(address(positionEngine_), address(portfolioRiskEngine_.positionEngine()));
        }
        ISeriesRegistry seriesRegistry_ = positionEngine_.seriesRegistry();
        ICollateralVault collateralVault_ = positionEngine_.collateralVault();
        _requireDependency(address(seriesRegistry_));
        _requireDependency(address(collateralVault_));
        if (address(fixingEngine_.seriesRegistry()) != address(seriesRegistry_)) {
            revert DependencyGraphMismatch(address(seriesRegistry_), address(fixingEngine_.seriesRegistry()));
        }
        if (address(fundedFeeEngine_.collateralVault()) != address(collateralVault_)) {
            revert DependencyGraphMismatch(address(collateralVault_), address(fundedFeeEngine_.collateralVault()));
        }
        _positionEngine = positionEngine_;
        _fixingEngine = fixingEngine_;
        _fundedFeeEngine = fundedFeeEngine_;
        _collateralVault = collateralVault_;
        _seriesRegistry = seriesRegistry_;
        _portfolioRiskEngine = portfolioRiskEngine_;
    }

    function finalizeNormalSettlement(
        PositionId positionId,
        FixingSlot[] calldata fixingSlots,
        FeeActionRequest[] calldata feeActions
    ) external nonReentrant returns (SettlementId settlementId) {
        SettlementId existing = _positionSettlement[positionId];
        if (SettlementId.unwrap(existing) != bytes32(0)) return existing;
        PositionContext memory context =
            CashSettlementContextLib.loadContext(_dependencies(), positionId, fixingSlots, true);
        if (block.timestamp >= context.economics.finalResolutionAt) {
            revert NormalSettlementClosed(context.economics.finalResolutionAt, block.timestamp);
        }

        CanonicalSettlementFixing[] memory fixings =
            CashSettlementContextLib.collectNormalFixings(_dependencies(), context.economics, fixingSlots);
        bytes32 fixingsHash = SettlementLib.hashFixings(fixings);
        settlementId = SettlementLib.deriveSettlementId(
            block.chainid, address(this), positionId, SettlementMode.Normal, fixingsHash
        );
        bytes memory encodedFixings =
            CashSettlementContextLib.encodePayoffFixings(_dependencies(), context.economics, fixingSlots);
        CashSettlementContextLib.advanceNormalPosition(
            _dependencies(), positionId, context.lifecycle, fixingsHash, encodedFixings
        );
        (, PositionLifecycle memory terminalLifecycle) = _positionEngine.getPosition(positionId);
        if (terminalLifecycle.status != PositionStatus.Settled) revert SettlementOutcomeMismatch();
        CashSettlementRecordLib.reducePositionExposure(_dependencies(), positionId, context.economics);

        SettlementFeeReceipt[] memory feeReceipts =
            CashSettlementRecordLib.consumeFees(_dependencies(), settlementId, context.economics, feeActions);
        (SettlementCollateralDelta memory longDelta, SettlementCollateralDelta memory shortDelta) = CashSettlementRecordLib.terminalizeReservations(
            _dependencies(), context.economics, terminalLifecycle, false
        );
        CashSettlementRecordLib.storeSettlement(
            _settlements,
            _positionSettlement,
            _claimSettlement,
            settlementId,
            positionId,
            SettlementMode.Normal,
            context,
            fixingsHash,
            terminalLifecycle,
            feeReceipts,
            longDelta,
            shortDelta
        );
    }

    function finalizeTerminalDisruption(
        PositionId positionId,
        FixingSlot[] calldata fixingSlots,
        FeeActionRequest[] calldata feeActions
    ) external nonReentrant returns (SettlementId settlementId) {
        SettlementId existing = _positionSettlement[positionId];
        if (SettlementId.unwrap(existing) != bytes32(0)) return existing;
        PositionContext memory context =
            CashSettlementContextLib.loadContext(_dependencies(), positionId, fixingSlots, true);
        if (block.timestamp < context.economics.finalResolutionAt) {
            revert TerminalFallbackNotOpen(context.economics.finalResolutionAt, block.timestamp);
        }

        CanonicalSettlementFixing[] memory fixings =
            CashSettlementContextLib.collectDisruptionFixings(_dependencies(), context.economics, fixingSlots);
        bytes32 fixingsHash = SettlementLib.hashFixings(fixings);
        settlementId = SettlementLib.deriveSettlementId(
            block.chainid, address(this), positionId, SettlementMode.TerminalDisruption, fixingsHash
        );
        if (!_isPositionTerminal(context.lifecycle.status)) {
            _positionEngine.applyTerminalFallback(positionId);
        }
        (, PositionLifecycle memory terminalLifecycle) = _positionEngine.getPosition(positionId);
        int256 expectedTransfer = _scaleDisruptionTransfer(context.economics, context.lifecycle);
        if (
            terminalLifecycle.terminalTransferMinor != expectedTransfer
                || terminalLifecycle.terminalOutcomeReference == bytes32(0)
                || (terminalLifecycle.status != PositionStatus.Settled
                    && terminalLifecycle.status != PositionStatus.TerminalClaim)
        ) revert SettlementOutcomeMismatch();
        CashSettlementRecordLib.reducePositionExposure(_dependencies(), positionId, context.economics);

        SettlementFeeReceipt[] memory feeReceipts =
            CashSettlementRecordLib.consumeFees(_dependencies(), settlementId, context.economics, feeActions);
        (SettlementCollateralDelta memory longDelta, SettlementCollateralDelta memory shortDelta) =
            CashSettlementRecordLib.terminalizeReservations(_dependencies(), context.economics, terminalLifecycle, true);
        CashSettlementRecordLib.storeSettlement(
            _settlements,
            _positionSettlement,
            _claimSettlement,
            settlementId,
            positionId,
            SettlementMode.TerminalDisruption,
            context,
            fixingsHash,
            terminalLifecycle,
            feeReceipts,
            longDelta,
            shortDelta
        );
    }

    function finalizeLapsedPosition(PositionId positionId, FeeActionRequest[] calldata feeActions)
        external
        nonReentrant
        returns (SettlementId settlementId)
    {
        SettlementId existing = _positionSettlement[positionId];
        if (SettlementId.unwrap(existing) != bytes32(0)) return existing;
        PositionContext memory context =
            CashSettlementContextLib.loadContext(_dependencies(), positionId, new FixingSlot[](0), false);
        if (context.lifecycle.status != PositionStatus.Lapsed || context.lifecycle.terminalTransferMinor != 0) {
            revert InvalidPositionStatus(context.lifecycle.status);
        }
        CashSettlementRecordLib.reducePositionExposure(_dependencies(), positionId, context.economics);
        bytes32 fixingsHash = SettlementLib.hashFixings(new CanonicalSettlementFixing[](0));
        settlementId = SettlementLib.deriveSettlementId(
            block.chainid, address(this), positionId, SettlementMode.Lapsed, fixingsHash
        );
        SettlementFeeReceipt[] memory feeReceipts =
            CashSettlementRecordLib.consumeFees(_dependencies(), settlementId, context.economics, feeActions);
        (SettlementCollateralDelta memory longDelta, SettlementCollateralDelta memory shortDelta) = CashSettlementRecordLib.terminalizeReservations(
            _dependencies(),
            context.economics,
            context.lifecycle,
            block.timestamp >= context.economics.finalResolutionAt
        );
        CashSettlementRecordLib.storeSettlement(
            _settlements,
            _positionSettlement,
            _claimSettlement,
            settlementId,
            positionId,
            SettlementMode.Lapsed,
            context,
            fixingsHash,
            context.lifecycle,
            feeReceipts,
            longDelta,
            shortDelta
        );
    }

    function fulfillClaim(TerminalClaimId claimId) external nonReentrant {
        SettlementId settlementId = _claimSettlement[claimId];
        if (SettlementId.unwrap(settlementId) == bytes32(0)) revert UnknownClaim(claimId);
        TerminalClaimStatus status = _collateralVault.terminalClaimStatusOf(claimId);
        if (status == TerminalClaimStatus.Active) {
            _collateralVault.fulfillTerminalClaim(claimId);
        } else if (status != TerminalClaimStatus.Fulfilled) {
            revert UnknownClaim(claimId);
        }
        emit SettlementClaimFulfilled(claimId, _settlements[settlementId].positionId, settlementId, msg.sender);
    }

    function positionEngine() external view returns (IPositionEngine) {
        return _positionEngine;
    }

    function fixingEngine() external view returns (IFixingEngine) {
        return _fixingEngine;
    }

    function fundedFeeEngine() external view returns (IFundedFeeEngine) {
        return _fundedFeeEngine;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function getSettlement(SettlementId settlementId) external view returns (SettlementRecord memory record) {
        record = _settlements[settlementId];
        if (SettlementId.unwrap(record.settlementId) == bytes32(0)) {
            revert UnknownSettlement(settlementId);
        }
    }

    function settlementOf(PositionId positionId) external view returns (SettlementId settlementId) {
        return _positionSettlement[positionId];
    }

    function _scaleDisruptionTransfer(PositionEconomics memory economics, PositionLifecycle memory lifecycle)
        private
        pure
        returns (int256)
    {
        int256 unresolved = PositionMathLib.scaleTransfer(
            economics.terminalDisruptionTransferMinorPerLot, lifecycle.remainingLots
        );
        int256 total = lifecycle.terminalTransferMinor + unresolved;
        if (
            (unresolved > 0 && total < lifecycle.terminalTransferMinor)
                || (unresolved < 0 && total > lifecycle.terminalTransferMinor)
        ) {
            revert SettlementOutcomeMismatch();
        }
        return total;
    }

    function _isPositionTerminal(PositionStatus status) private pure returns (bool) {
        return status == PositionStatus.Settled || status == PositionStatus.TerminalClaim;
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (CashSettlementDependencies memory) {
        return CashSettlementDependencies({
            positionEngine: _positionEngine,
            fixingEngine: _fixingEngine,
            fundedFeeEngine: _fundedFeeEngine,
            collateralVault: _collateralVault,
            seriesRegistry: _seriesRegistry,
            portfolioRiskEngine: _portfolioRiskEngine
        });
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
