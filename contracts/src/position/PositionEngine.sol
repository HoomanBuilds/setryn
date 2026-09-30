// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {ICollateralVault} from "../interfaces/ICollateralVault.sol";
import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {PositionTerminalState} from "../interfaces/IPositionEngineTerminalState.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {CollateralLock, TerminalLiabilityReplacement} from "../types/CollateralTypes.sol";
import {TerminalOutcomeKind} from "../types/Enums.sol";
import {
    AccountId,
    AssetId,
    CollateralLockId,
    ExercisePolicyId,
    PositionId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {
    PositionCreation,
    PositionEconomics,
    PositionLiabilitySide,
    PositionLifecycle,
    PositionProvenance,
    PositionStatus
} from "../types/PositionTypes.sol";
import {CompressionPosition} from "../types/CompressionTypes.sol";
import {LifecycleActionKind, LifecyclePositionSnapshot} from "../types/LifecycleTypes.sol";
import {Lots} from "../types/Units.sol";
import {PositionRiskSnapshot} from "../types/RiskTypes.sol";

import {PositionCreationLib} from "./PositionCreationLib.sol";
import {PositionTerminalLib} from "./PositionTerminalLib.sol";
import {PositionViewLib} from "./PositionViewLib.sol";
import {PositionEngineDependencies, LiabilityState} from "./PositionEngineTypes.sol";

contract PositionEngine is IPositionEngine, AccessControlDefaultAdminRules, ReentrancyGuard {
    bytes32 public constant CLEARING_ENGINE_ROLE = keccak256("SETRYN_CLEARING_ENGINE_ROLE");
    bytes32 public constant FUNDING_REQUESTER_ROLE = keccak256("SETRYN_POSITION_FUNDING_REQUESTER_ROLE");
    bytes32 public constant FIXING_ENGINE_ROLE = keccak256("SETRYN_FIXING_ENGINE_ROLE");
    bytes32 public constant LIFECYCLE_ENGINE_ROLE = keccak256("SETRYN_LIFECYCLE_ENGINE_ROLE");
    bytes32 public constant DEFAULT_ENGINE_ROLE = keccak256("SETRYN_DEFAULT_ENGINE_ROLE");

    uint32 public constant TERMINAL_STATE_INTERFACE_VERSION = 1;

    bytes32 private constant POSITION_ID_TYPEHASH = keccak256(
        "SetrynPositionIdV1(bytes32 positionEngineId,uint256 chainId,address positionEngine,bytes32 fillIdentity,bytes32 seriesId,uint32 seriesVersion,bytes32 longAccountId,bytes32 shortAccountId,uint32 ordinal)"
    );
    bytes32 private constant LIABILITY_KEY_TYPEHASH =
        keccak256("SetrynPositionLiabilityV1(bytes32 positionId,uint8 side)");
    bytes32 private constant SETTLEMENT_OUTCOME_TYPEHASH = keccak256(
        "SetrynPositionSettlementV1(bytes32 positionId,bytes32 fixingReference,bytes32 finalFixingsHash,int256 terminalTransferMinor)"
    );
    bytes32 private constant FALLBACK_OUTCOME_TYPEHASH = keccak256(
        "SetrynPositionTerminalFallbackV1(bytes32 positionId,uint64 finalResolutionAt,int256 terminalTransferMinor)"
    );
    bytes32 private constant ALTERNATIVE_OUTCOME_TYPEHASH =
        keccak256("SetrynPositionAlternativeV1(bytes32 positionId,uint8 status,bytes32 reference)");
    bytes32 private constant POSITION_ECONOMICS_HASH_TYPEHASH = keccak256("SetrynPositionEconomicsHashV1");
    bytes32 private constant POSITION_IMMUTABLE_HASH_TYPEHASH = keccak256("SetrynPositionImmutableHashV1");
    bytes32 private constant POSITION_LIFECYCLE_HASH_TYPEHASH = keccak256("SetrynPositionLifecycleHashV1");
    bytes32 private constant EXACT_LOTS_CAPABILITY = keccak256("SETRYN_EXACT_LOTS_PAYOFF_V1");
    bytes32 private constant PACKAGE_PROVENANCE_TYPEHASH =
        keccak256("SetrynPositionPackageProvenanceV1(bytes32 packageId,uint32 packageVersion,uint32 packageOrdinal)");
    bytes32 private constant RISK_SNAPSHOT_TYPEHASH = keccak256("SetrynPositionRiskSnapshotV1");

    bytes32 public immutable positionEngineId;

    ISeriesRegistry private immutable _seriesRegistry;
    IMarketRegistry private immutable _marketRegistry;
    IInstrumentRegistry private immutable _instrumentRegistry;
    IAdapterRegistry private immutable _adapterRegistry;
    ICollateralVault private immutable _collateralVault;

    mapping(PositionId positionId => PositionEconomics economics) private _economics;
    mapping(PositionId positionId => PositionLifecycle lifecycle) private _lifecycles;
    mapping(PositionId positionId => bytes terms) private _payoffTerms;
    mapping(bytes32 liabilityKey => LiabilityState state) private _liabilityStates;
    mapping(CollateralLockId lockId => address requester) private _positionFundingRequesters;
    uint256 private _positionCount;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        ISeriesRegistry seriesRegistry_,
        ICollateralVault collateralVault_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireDependency(address(seriesRegistry_));
        _requireDependency(address(collateralVault_));

        IMarketRegistry marketRegistry_ = seriesRegistry_.marketRegistry();
        IInstrumentRegistry instrumentRegistry_ = seriesRegistry_.instrumentRegistry();
        _requireDependency(address(marketRegistry_));
        _requireDependency(address(instrumentRegistry_));
        IAdapterRegistry adapterRegistry_ = instrumentRegistry_.adapterRegistry();
        _requireDependency(address(adapterRegistry_));

        _seriesRegistry = seriesRegistry_;
        _marketRegistry = marketRegistry_;
        _instrumentRegistry = instrumentRegistry_;
        _adapterRegistry = adapterRegistry_;
        _collateralVault = collateralVault_;
        positionEngineId = keccak256(
            abi.encode(
                keccak256("SetrynPositionEngineV1"),
                block.chainid,
                address(this),
                address(seriesRegistry_),
                address(collateralVault_)
            )
        );

        _grantRole(CLEARING_ENGINE_ROLE, initialAdmin);
        _grantRole(FUNDING_REQUESTER_ROLE, initialAdmin);
        _grantRole(FIXING_ENGINE_ROLE, initialAdmin);
        _grantRole(LIFECYCLE_ENGINE_ROLE, initialAdmin);
        _grantRole(DEFAULT_ENGINE_ROLE, initialAdmin);
    }

    function createPosition(PositionCreation calldata creation)
        external
        nonReentrant
        onlyRole(CLEARING_ENGINE_ROLE)
        returns (PositionId positionId)
    {
        return _createPosition(creation, true, _emptyProvenance());
    }

    function createLifecycleSuccessor(PositionCreation calldata creation)
        external
        nonReentrant
        onlyRole(LIFECYCLE_ENGINE_ROLE)
        returns (PositionId positionId)
    {
        return _createPosition(creation, false, _emptyProvenance());
    }

    function createLifecycleSuccessorWithProvenance(
        PositionCreation calldata creation,
        PositionProvenance calldata provenance
    ) external nonReentrant onlyRole(LIFECYCLE_ENGINE_ROLE) returns (PositionId positionId) {
        return _createPosition(creation, false, provenance);
    }

    function replaceLifecycleReservations(
        TerminalLiabilityReservationId[] calldata sourceReservationIds,
        TerminalLiabilityReplacement[] calldata replacements
    )
        external
        onlyRole(LIFECYCLE_ENGINE_ROLE)
        returns (TerminalLiabilityReservationId[] memory replacementReservationIds)
    {
        return _collateralVault.replaceTerminalLiabilityReservations(sourceReservationIds, replacements);
    }

    function _createPosition(
        PositionCreation calldata creation,
        bool requireOpenForNewRisk,
        PositionProvenance memory provenance
    ) private returns (PositionId positionId) {
        positionId = PositionCreationLib.initializePosition(
            _dependencies(),
            _economics,
            _lifecycles,
            _payoffTerms,
            _liabilityStates,
            _positionFundingRequesters,
            creation,
            requireOpenForNewRisk,
            provenance
        );
        _positionCount += 1;
    }

    function createPositionFundingLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry
    ) external nonReentrant onlyRole(FUNDING_REQUESTER_ROLE) returns (CollateralLockId lockId) {
        return PositionCreationLib.createPositionFundingLock(
            _dependencies(),
            _positionFundingRequesters,
            lockReference,
            accountId,
            assetId,
            bindingVersion,
            amount,
            expiry
        );
    }

    function releasePositionFundingLock(CollateralLockId lockId) external nonReentrant {
        address requester = _positionFundingRequesters[lockId];
        if (requester == address(0) || requester != msg.sender) {
            revert UnauthorizedPositionFundingRequester(lockId, requester, msg.sender);
        }
        CollateralLock memory lock = _collateralVault.getLock(lockId);
        if (lock.operator != address(this)) revert PositionFundingMismatch(bytes32(0), lockId);
        delete _positionFundingRequesters[lockId];
        _collateralVault.releaseLock(lockId);
        emit PositionFundingLockReleased(lockId, lock.lockReference, msg.sender);
    }

    function positionFundingRequester(CollateralLockId lockId) external view returns (address) {
        return _positionFundingRequesters[lockId];
    }

    function beginFixing(PositionId positionId) external {
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        // A holder-election position returns to Live once its final fixing is accepted; it must not re-enter Fixing,
        // or anyone could block the holder's election by toggling it away from Live.
        if (lifecycle.status != PositionStatus.Live || lifecycle.finalFixingReference != bytes32(0)) {
            revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Fixing);
        }
        PositionEconomics storage economics = _economics[positionId];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < economics.fixingWindowOpen) {
            revert FixingWindowNotOpen(positionId, economics.fixingWindowOpen, nowTs);
        }
        if (nowTs >= economics.finalResolutionAt) {
            revert FinalResolutionReached(positionId, economics.finalResolutionAt, nowTs);
        }
        _setStatus(positionId, lifecycle, PositionStatus.Fixing, bytes32(0));
    }

    function acceptFinalFixing(PositionId positionId, bytes32 fixingReference, bytes calldata finalFixings)
        external
        onlyRole(FIXING_ENGINE_ROLE)
    {
        PositionTerminalLib.acceptFinalFixing(
            _economics, _lifecycles, _payoffTerms, _liabilityStates, positionId, fixingReference, finalFixings
        );
    }

    function exercisePositionQuantity(
        PositionId positionId,
        Lots exerciseLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        bytes32 fixingReference,
        bytes calldata finalFixings
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        PositionTerminalLib.exercisePositionQuantity(
            _economics,
            _lifecycles,
            _payoffTerms,
            _liabilityStates,
            positionId,
            exerciseLots,
            actorAccountId,
            expectedLifecycleNonce,
            fixingReference,
            finalFixings
        );
    }

    function abandonPositionQuantity(
        PositionId positionId,
        Lots abandonLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        bytes32 transitionReference
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        PositionTerminalLib.abandonPositionQuantity(
            _economics,
            _lifecycles,
            _liabilityStates,
            positionId,
            abandonLots,
            actorAccountId,
            expectedLifecycleNonce,
            transitionReference
        );
    }

    function closePositionQuantity(
        PositionId positionId,
        Lots closeLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        PositionStatus terminalStatus,
        bytes32 transitionReference
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        PositionTerminalLib.closePositionQuantity(
            _economics,
            _lifecycles,
            _liabilityStates,
            positionId,
            closeLots,
            actorAccountId,
            expectedLifecycleNonce,
            terminalStatus,
            transitionReference
        );
    }

    function transferLifecycleOwner(
        PositionId positionId,
        AccountId currentOwnerAccountId,
        AccountId newOwnerAccountId,
        uint64 expectedOwnerNonce,
        bytes32 transitionReference
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        PositionTerminalLib.transferLifecycleOwner(
            _lifecycles, positionId, currentOwnerAccountId, newOwnerAccountId, expectedOwnerNonce, transitionReference
        );
    }

    function settle(PositionId positionId) external {
        PositionTerminalLib.settle(_economics, _lifecycles, _liabilityStates, positionId);
    }

    function applyTerminalFallback(PositionId positionId) external {
        PositionTerminalLib.applyTerminalFallback(_economics, _lifecycles, _liabilityStates, positionId);
    }

    function lapseUnelectedLots(PositionId positionId) external {
        PositionTerminalLib.lapseUnelectedLots(_economics, _lifecycles, _liabilityStates, positionId);
    }

    function markDefaulted(PositionId positionId, bytes32 defaultReference) external onlyRole(DEFAULT_ENGINE_ROLE) {
        if (defaultReference == bytes32(0)) revert ZeroReference();
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (
            lifecycle.status != PositionStatus.Live && lifecycle.status != PositionStatus.Fixing
                && lifecycle.status != PositionStatus.SettlementReady
        ) revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Defaulted);
        _setStatus(positionId, lifecycle, PositionStatus.Defaulted, defaultReference);
    }

    function recordZeroLiabilityAlternative(
        PositionId positionId,
        PositionStatus terminalStatus,
        bytes32 transitionReference
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        PositionTerminalLib.recordZeroLiabilityAlternative(
            _economics, _lifecycles, _liabilityStates, positionId, terminalStatus, transitionReference
        );
    }

    function terminalStateInterfaceVersion() external pure returns (uint32) {
        return TERMINAL_STATE_INTERFACE_VERSION;
    }

    function terminalState(bytes32 liabilityKey) external view returns (PositionTerminalState memory state) {
        LiabilityState storage liability = _liabilityStates[liabilityKey];
        state.positionId = liabilityKey;
        if (!liability.exists) return state;
        state.terminalOutcomeReference = liability.terminalOutcomeReference;
        state.receiverAccountId = liability.receiverAccountId;
        state.amount = liability.amount;
        state.outcome = liability.outcome;
        state.settlementDeadline = liability.settlementDeadline;
        state.finalResolutionAt = liability.finalResolutionAt;
    }

    function derivePositionId(PositionCreation calldata creation) external view returns (PositionId) {
        return _derivePositionId(creation);
    }

    function deriveLiabilityKey(PositionId positionId, uint8 side) external pure returns (bytes32) {
        if (side != uint8(PositionLiabilitySide.Long) && side != uint8(PositionLiabilitySide.Short)) {
            return bytes32(0);
        }
        return _deriveLiabilityKey(positionId, PositionLiabilitySide(side));
    }

    function getPosition(PositionId positionId)
        external
        view
        returns (PositionEconomics memory economics, PositionLifecycle memory lifecycle)
    {
        _requirePositionView(positionId);
        economics = _economics[positionId];
        lifecycle = _lifecycles[positionId];
    }

    function positionRiskSnapshot(PositionId positionId, AccountId accountId)
        external
        view
        returns (PositionRiskSnapshot memory snapshot)
    {
        return PositionViewLib.positionRiskSnapshot(_economics, _lifecycles, positionId, accountId);
    }

    function payoffTerms(PositionId positionId) external view returns (bytes memory) {
        _requirePositionView(positionId);
        return _payoffTerms[positionId];
    }

    function positionStatus(PositionId positionId) external view returns (PositionStatus) {
        return _lifecycles[positionId].status;
    }

    function positionCount() external view returns (uint256) {
        return _positionCount;
    }

    function getLifecyclePosition(PositionId positionId)
        external
        view
        returns (LifecyclePositionSnapshot memory snapshot)
    {
        return PositionViewLib.lifecycleSnapshot(_dependencies(), _economics, _lifecycles, _payoffTerms, positionId);
    }

    function isLifecycleActionEligible(PositionId positionId, LifecycleActionKind kind) external view returns (bool) {
        return PositionViewLib.isLifecycleActionEligible(_dependencies(), _economics, _lifecycles, positionId, kind);
    }

    function getCompressionPosition(PositionId positionId) external view returns (CompressionPosition memory position) {
        LifecyclePositionSnapshot memory snapshot =
            PositionViewLib.lifecycleSnapshot(_dependencies(), _economics, _lifecycles, _payoffTerms, positionId);
        position = CompressionPosition({
            positionId: positionId,
            seriesId: snapshot.seriesId,
            seriesVersion: snapshot.seriesVersion,
            longAccountId: snapshot.longAccountId,
            shortAccountId: snapshot.shortAccountId,
            riskDomainId: snapshot.riskDomainId,
            riskDomainVersion: snapshot.riskDomainVersion,
            collateralId: snapshot.collateralId,
            lots: snapshot.positionLots,
            entryPriceTicks: snapshot.entryPriceTicks,
            economicsHash: snapshot.economicsHash,
            longTerminalLiabilityBaseUnits: snapshot.longTerminalLiabilityBaseUnits,
            shortTerminalLiabilityBaseUnits: snapshot.shortTerminalLiabilityBaseUnits,
            lifecycleHash: snapshot.lifecycleHash
        });
    }

    function isCompressionEligible(PositionId positionId) external view returns (bool) {
        return _lifecycles[positionId].status == PositionStatus.Live;
    }

    function seriesRegistry() external view returns (ISeriesRegistry) {
        return _seriesRegistry;
    }

    function collateralVault() external view returns (ICollateralVault) {
        return _collateralVault;
    }

    function _writeTerminalLiabilities(
        PositionEconomics storage economics,
        int256 terminalTransferMinor,
        bytes32 outcomeReference,
        bool asClaim
    ) private {
        if (terminalTransferMinor == 0) {
            _setFlatLiability(economics.longLiabilityKey, outcomeReference);
            _setFlatLiability(economics.shortLiabilityKey, outcomeReference);
            return;
        }

        bool longPays = terminalTransferMinor < 0;
        uint256 magnitude = longPays ? uint256(-terminalTransferMinor) : uint256(terminalTransferMinor);
        if (magnitude > type(uint128).max) revert TerminalAmountOverflow(magnitude);
        bytes32 payerKey = longPays ? economics.longLiabilityKey : economics.shortLiabilityKey;
        bytes32 otherKey = longPays ? economics.shortLiabilityKey : economics.longLiabilityKey;
        AccountId receiver = longPays ? economics.shortAccountId : economics.longAccountId;
        LiabilityState storage payer = _liabilityStates[payerKey];
        payer.receiverAccountId = receiver;
        payer.amount = uint128(magnitude);
        payer.outcome = asClaim ? TerminalOutcomeKind.Claim : TerminalOutcomeKind.Payout;
        payer.terminalOutcomeReference = outcomeReference;
        _setFlatLiability(otherKey, outcomeReference);
    }

    function _setFlatLiability(bytes32 liabilityKey, bytes32 outcomeReference) private {
        LiabilityState storage liability = _liabilityStates[liabilityKey];
        liability.receiverAccountId = AccountId.wrap(bytes32(0));
        liability.amount = 0;
        liability.outcome = TerminalOutcomeKind.Flat;
        liability.terminalOutcomeReference = outcomeReference;
    }

    function _setStatus(
        PositionId positionId,
        PositionLifecycle storage lifecycle,
        PositionStatus newStatus,
        bytes32 transitionReference
    ) private {
        PositionStatus previous = lifecycle.status;
        lifecycle.status = newStatus;
        emit PositionStatusChanged(positionId, previous, newStatus, transitionReference, msg.sender);
    }

    function _derivePositionId(PositionCreation calldata creation) private view returns (PositionId) {
        return PositionId.wrap(
            keccak256(
                abi.encode(
                    POSITION_ID_TYPEHASH,
                    positionEngineId,
                    block.chainid,
                    address(this),
                    creation.fillIdentity,
                    creation.seriesId,
                    creation.seriesVersion,
                    creation.longAccountId,
                    creation.shortAccountId,
                    creation.ordinal
                )
            )
        );
    }

    function _deriveLiabilityKey(PositionId positionId, PositionLiabilitySide side) private pure returns (bytes32) {
        return keccak256(abi.encode(LIABILITY_KEY_TYPEHASH, PositionId.unwrap(positionId), uint8(side)));
    }

    function _requirePosition(PositionId positionId) private view returns (PositionLifecycle storage lifecycle) {
        lifecycle = _lifecycles[positionId];
        if (lifecycle.status == PositionStatus.Unspecified) revert UnknownPosition(positionId);
    }

    function _requirePositionView(PositionId positionId) private view {
        if (_lifecycles[positionId].status == PositionStatus.Unspecified) revert UnknownPosition(positionId);
    }

    function _isZeroLiabilityAlternative(PositionStatus status) private pure returns (bool) {
        return status == PositionStatus.ClosedByUnwind || status == PositionStatus.Replaced
            || status == PositionStatus.Lapsed || status == PositionStatus.CancelledByDisruption
            || status == PositionStatus.Abandoned;
    }

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }

    function _emptyProvenance() private pure returns (PositionProvenance memory provenance) {}

    function _requireLifecycleAuthority(
        PositionId positionId,
        PositionLifecycle storage lifecycle,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce
    ) private view {
        if (AccountId.unwrap(actorAccountId) != AccountId.unwrap(lifecycle.lifecycleOwnerAccountId)) {
            revert LifecycleOwnerMismatch(positionId, lifecycle.lifecycleOwnerAccountId, actorAccountId);
        }
        if (lifecycle.lifecycleNonce != expectedLifecycleNonce) {
            revert LifecycleNonceMismatch(positionId, lifecycle.lifecycleNonce, expectedLifecycleNonce);
        }
    }

    function _requireQuantity(PositionId positionId, PositionLifecycle storage lifecycle, Lots requested)
        private
        view
        returns (uint128 quantity)
    {
        quantity = Lots.unwrap(requested);
        uint128 remaining = Lots.unwrap(lifecycle.remainingLots);
        if (quantity == 0 || quantity > remaining) revert InvalidPositionQuantity(positionId, remaining, quantity);
    }

    function _requireLapseOpen(PositionId positionId) private view {
        PositionEconomics storage economics = _economics[positionId];
        if (
            ExercisePolicyId.unwrap(economics.exercisePolicyId)
                    != ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)
                || block.timestamp <= economics.exerciseCutoffAt
        ) {
            revert FixingWindowNotOpen(positionId, economics.exerciseCutoffAt + 1, uint64(block.timestamp));
        }
    }

    function _absoluteTransfer(int256 value) private pure returns (uint256) {
        if (value >= 0) return uint256(value);
        if (value == type(int256).min) revert TerminalAmountOverflow(type(uint256).max);
        return uint256(-value);
    }

    function _checkedAddTransfer(int256 left, int256 right) private pure returns (int256 result) {
        unchecked {
            result = left + right;
            if ((right > 0 && result < left) || (right < 0 && result > left)) {
                revert TerminalAmountOverflow(type(uint256).max);
            }
        }
    }

    function _emitQuantity(PositionId positionId, PositionLifecycle storage lifecycle, bytes32 transitionReference)
        private
    {
        emit PositionQuantityChanged(
            positionId,
            Lots.unwrap(lifecycle.remainingLots),
            Lots.unwrap(lifecycle.exercisedLots),
            Lots.unwrap(lifecycle.closedLots),
            lifecycle.lifecycleNonce,
            transitionReference
        );
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (PositionEngineDependencies memory) {
        return PositionEngineDependencies({
            positionEngineId: positionEngineId,
            seriesRegistry: _seriesRegistry,
            marketRegistry: _marketRegistry,
            instrumentRegistry: _instrumentRegistry,
            adapterRegistry: _adapterRegistry,
            collateralVault: _collateralVault
        });
    }

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
