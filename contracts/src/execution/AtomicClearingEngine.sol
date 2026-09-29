// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAtomicClearingEngine} from "../interfaces/IAtomicClearingEngine.sol";
import {IClearingAdmissionGate} from "../interfaces/IClearingAdmissionGate.sol";
import {IClearingChannelHandoffAdapter} from "../interfaces/IClearingChannelHandoffAdapter.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IFundedFeeEngine} from "../interfaces/IFundedFeeEngine.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOrderState} from "../interfaces/IOrderState.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IPortfolioRiskEngine} from "../interfaces/IPortfolioRiskEngine.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {AtomicClearingFundingLib} from "./AtomicClearingFundingLib.sol";
import {AtomicClearingMatchLib} from "./AtomicClearingMatchLib.sol";
import {AtomicClearingPackageLib} from "./AtomicClearingPackageLib.sol";
import {AtomicClearingSeriesLib} from "./AtomicClearingSeriesLib.sol";
import {
    CLEARING_CONSIDERATION_PURPOSE,
    CLEARING_TERMINAL_LIABILITY_PURPOSE,
    ClearingDependencies
} from "./AtomicClearingTypes.sol";
import {ClearingLib} from "../libraries/ClearingLib.sol";
import {ClearingChannelLib} from "../libraries/ClearingChannelLib.sol";
import {ClearingHandoffClaim} from "../types/ClearingHandoffTypes.sol";
import {
    ClearingChannelKind,
    FillRecord,
    PackageClearingRequest,
    SeriesClearingRequest
} from "../types/ClearingTypes.sol";
import {CollateralLockId, FeeActionId, FillId, PositionId} from "../types/Identifiers.sol";
import {OrderRecord} from "../types/OrderTypes.sol";
import {Lots, PriceTicks} from "../types/Units.sol";

import {IAtomicClearingEngineLinkedErrors} from "./IAtomicClearingEngineLinkedErrors.sol";

contract AtomicClearingEngine is
    IAtomicClearingEngineLinkedErrors,
    IAtomicClearingEngine,
    AccessControlDefaultAdminRules,
    ReentrancyGuard
{
    bytes32 public constant MATCH_EXECUTOR_ROLE = keccak256("SETRYN_MATCH_EXECUTOR_ROLE");

    bytes32 public constant TERMINAL_LIABILITY_PURPOSE = CLEARING_TERMINAL_LIABILITY_PURPOSE;
    bytes32 public constant CONSIDERATION_PURPOSE = CLEARING_CONSIDERATION_PURPOSE;
    IOrderState private immutable _orderState;
    ISeriesRegistry private immutable _seriesRegistry;
    IPackageRegistry private immutable _packageRegistry;
    IPositionEngine private immutable _positionEngine;
    ICollateralVault private immutable _collateralVault;
    IMarketRegistry private immutable _marketRegistry;
    IClearingAdmissionGate private immutable _admissionGate;
    IFundedFeeEngine private immutable _fundedFeeEngine;
    IPortfolioRiskEngine private immutable _riskEngine;

    mapping(FillId fillId => FillRecord record) private _fills;
    mapping(FillId fillId => PositionId[] positionIds) private _fillPositions;
    mapping(ClearingChannelKind channelKind => IClearingChannelHandoffAdapter adapter) private _channelAdapters;
    mapping(ClearingChannelKind channelKind => bytes32 capabilityHash) private _channelCapabilities;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IOrderState orderState_,
        ISeriesRegistry seriesRegistry_,
        IPackageRegistry packageRegistry_,
        IPositionEngine positionEngine_,
        ICollateralVault collateralVault_,
        IClearingAdmissionGate admissionGate_,
        IFundedFeeEngine fundedFeeEngine_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(orderState_));
        _requireDependency(address(seriesRegistry_));
        _requireDependency(address(packageRegistry_));
        _requireDependency(address(positionEngine_));
        _requireDependency(address(collateralVault_));
        _requireDependency(address(admissionGate_));
        _requireDependency(address(fundedFeeEngine_));
        IMarketRegistry marketRegistry_ = seriesRegistry_.marketRegistry();
        _requireDependency(address(marketRegistry_));
        if (address(packageRegistry_.seriesRegistry()) != address(seriesRegistry_)) {
            revert DependencyGraphMismatch(address(seriesRegistry_), address(packageRegistry_.seriesRegistry()));
        }
        if (address(positionEngine_.seriesRegistry()) != address(seriesRegistry_)) {
            revert DependencyGraphMismatch(address(seriesRegistry_), address(positionEngine_.seriesRegistry()));
        }
        if (address(positionEngine_.collateralVault()) != address(collateralVault_)) {
            revert DependencyGraphMismatch(address(collateralVault_), address(positionEngine_.collateralVault()));
        }
        if (address(marketRegistry_.collateralVault()) != address(collateralVault_)) {
            revert DependencyGraphMismatch(address(collateralVault_), address(marketRegistry_.collateralVault()));
        }
        if (address(fundedFeeEngine_.collateralVault()) != address(collateralVault_)) {
            revert DependencyGraphMismatch(address(collateralVault_), address(fundedFeeEngine_.collateralVault()));
        }
        IPortfolioRiskEngine riskEngine_ = admissionGate_.riskEngine();
        _requireDependency(address(riskEngine_));

        _orderState = orderState_;
        _seriesRegistry = seriesRegistry_;
        _packageRegistry = packageRegistry_;
        _positionEngine = positionEngine_;
        _collateralVault = collateralVault_;
        _marketRegistry = marketRegistry_;
        _admissionGate = admissionGate_;
        _fundedFeeEngine = fundedFeeEngine_;
        _riskEngine = riskEngine_;
        _grantRole(MATCH_EXECUTOR_ROLE, initialAdmin);
    }

    function clearSeries(SeriesClearingRequest calldata request)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        ClearingChannelLib.requireDirect(request.channelKind);
        ClearingHandoffClaim memory emptyClaim;
        return AtomicClearingSeriesLib.clearSeries(
            _dependencies(), _fills, _fillPositions, _channelAdapters, request, emptyClaim, address(0)
        );
    }

    function clearSeriesWithHandoff(SeriesClearingRequest calldata request, ClearingHandoffClaim calldata claim)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        (ClearingHandoffClaim memory verifiedClaim, address source) = AtomicClearingMatchLib.consumeChannelHandoff(
            _channelAdapters, _channelCapabilities, request.channelKind, claim
        );
        return AtomicClearingSeriesLib.clearSeries(
            _dependencies(), _fills, _fillPositions, _channelAdapters, request, verifiedClaim, source
        );
    }

    function previewSeriesFillId(
        bytes32 takerOrderHash,
        bytes32 makerOrderHash,
        Lots fillLots,
        PriceTicks executionPriceTicks,
        bytes calldata payoffTerms
    ) external view returns (FillId fillId) {
        OrderRecord memory taker = _orderState.getOrder(takerOrderHash);
        OrderRecord memory maker = _orderState.getOrder(makerOrderHash);
        return ClearingLib.deriveFillId(
            block.chainid,
            address(this),
            takerOrderHash,
            makerOrderHash,
            Lots.wrap(Lots.unwrap(taker.filledLots) + Lots.unwrap(fillLots)),
            Lots.wrap(Lots.unwrap(maker.filledLots) + Lots.unwrap(fillLots)),
            fillLots,
            executionPriceTicks,
            keccak256(payoffTerms)
        );
    }

    function clearPackage(PackageClearingRequest calldata request)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        ClearingChannelLib.requireDirect(request.channelKind);
        ClearingHandoffClaim memory emptyClaim;
        return AtomicClearingPackageLib.clearPackage(
            _dependencies(), _fills, _fillPositions, _channelAdapters, request, emptyClaim, address(0)
        );
    }

    function clearPackageWithHandoff(PackageClearingRequest calldata request, ClearingHandoffClaim calldata claim)
        external
        nonReentrant
        onlyRole(MATCH_EXECUTOR_ROLE)
        returns (FillId fillId)
    {
        (ClearingHandoffClaim memory verifiedClaim, address source) = AtomicClearingMatchLib.consumeChannelHandoff(
            _channelAdapters, _channelCapabilities, request.channelKind, claim
        );
        return AtomicClearingPackageLib.clearPackage(
            _dependencies(), _fills, _fillPositions, _channelAdapters, request, verifiedClaim, source
        );
    }

    function reserveOrderFunding(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose, uint128 amount)
        external
        nonReentrant
        returns (CollateralLockId lockId)
    {
        return AtomicClearingFundingLib.reserveOrderFunding(_dependencies(), orderHash, cumulativeLots, purpose, amount);
    }

    function releaseOrderFunding(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose) external nonReentrant {
        AtomicClearingFundingLib.releaseOrderFunding(_dependencies(), orderHash, cumulativeLots, purpose);
    }

    function reserveOrderFeeFunding(
        bytes32 orderHash,
        bytes32 parentActionId,
        FeeActionId actionId,
        uint32 actionOrdinal,
        uint128 notionalMinor
    ) external nonReentrant returns (bytes32 consumptionId, CollateralLockId lockId, uint128 chargeMinor) {
        return AtomicClearingFundingLib.reserveOrderFeeFunding(
            _dependencies(), orderHash, parentActionId, actionId, actionOrdinal, notionalMinor
        );
    }

    function releaseOrderFeeFunding(bytes32 orderHash, bytes32 consumptionId) external nonReentrant {
        AtomicClearingFundingLib.releaseOrderFeeFunding(_dependencies(), orderHash, consumptionId);
    }

    function getFill(FillId fillId) external view returns (FillRecord memory record) {
        record = _fills[fillId];
        if (FillId.unwrap(record.fillId) == bytes32(0)) revert UnknownFill(fillId);
    }

    function fillPositions(FillId fillId) external view returns (PositionId[] memory positionIds) {
        if (FillId.unwrap(_fills[fillId].fillId) == bytes32(0)) revert UnknownFill(fillId);
        positionIds = _fillPositions[fillId];
    }

    function deriveFundingReference(bytes32 orderHash, uint128 cumulativeLots, bytes32 purpose)
        external
        pure
        returns (bytes32)
    {
        return ClearingLib.deriveFundingReference(orderHash, cumulativeLots, purpose);
    }

    function orderState() external view returns (IOrderState) {
        return _orderState;
    }

    function seriesRegistry() external view returns (ISeriesRegistry) {
        return _seriesRegistry;
    }

    function packageRegistry() external view returns (IPackageRegistry) {
        return _packageRegistry;
    }

    function positionEngine() external view returns (IPositionEngine) {
        return _positionEngine;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function admissionGate() external view returns (IClearingAdmissionGate) {
        return _admissionGate;
    }

    function fundedFeeEngine() external view returns (IFundedFeeEngine) {
        return _fundedFeeEngine;
    }

    function riskEngine() external view returns (IPortfolioRiskEngine) {
        return _riskEngine;
    }

    function activateClearingChannel(
        ClearingChannelKind channelKind,
        IClearingChannelHandoffAdapter adapter,
        bytes32 capabilityHash
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (channelKind != ClearingChannelKind.PrivateRfq && channelKind != ClearingChannelKind.SealedAuction) {
            revert UnsupportedClearingChannel(channelKind);
        }
        if (address(_channelAdapters[channelKind]) != address(0)) revert ClearingChannelAlreadyActivated(channelKind);
        _requireDependency(address(adapter));
        if (adapter.source() != address(adapter)) {
            revert ClearingChannelSourceMismatch(address(adapter), adapter.source());
        }
        if (capabilityHash == bytes32(0)) revert ClearingHandoffMismatch();
        _channelAdapters[channelKind] = adapter;
        _channelCapabilities[channelKind] = capabilityHash;
        emit ClearingChannelActivated(channelKind, address(adapter), capabilityHash);
    }

    function clearingChannelAdapter(ClearingChannelKind channelKind)
        external
        view
        returns (IClearingChannelHandoffAdapter)
    {
        return _channelAdapters[channelKind];
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (ClearingDependencies memory) {
        return ClearingDependencies({
            orderState: _orderState,
            seriesRegistry: _seriesRegistry,
            packageRegistry: _packageRegistry,
            positionEngine: _positionEngine,
            collateralVault: _collateralVault,
            marketRegistry: _marketRegistry,
            admissionGate: _admissionGate,
            fundedFeeEngine: _fundedFeeEngine,
            riskEngine: _riskEngine
        });
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
