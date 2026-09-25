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
import {IPositionPayoffModuleV1} from "../interfaces/IPositionPayoffModuleV1.sol";
import {PositionTerminalState} from "../interfaces/IPositionEngineTerminalState.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {CollateralLock, TerminalLiabilityReservation} from "../types/CollateralTypes.sol";
import {LockStatus, TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "../types/Enums.sol";
import {
    AccountId,
    AdapterId,
    AssetId,
    CollateralId,
    CollateralLockId,
    PositionId,
    SeriesId,
    TerminalLiabilityReservationId
} from "../types/Identifiers.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {
    PositionCreation,
    PositionEconomics,
    PositionFunding,
    PositionLiabilitySide,
    PositionLifecycle,
    PositionStatus
} from "../types/PositionTypes.sol";
import {CompressionPosition} from "../types/CompressionTypes.sol";
import {LifecycleActionKind, LifecyclePositionSnapshot} from "../types/LifecycleTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots, LotsLib} from "../types/Units.sol";

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

    bytes32 public immutable positionEngineId;

    ISeriesRegistry private immutable _seriesRegistry;
    IMarketRegistry private immutable _marketRegistry;
    IInstrumentRegistry private immutable _instrumentRegistry;
    IAdapterRegistry private immutable _adapterRegistry;
    ICollateralVault private immutable _collateralVault;

    struct LiabilityState {
        PositionId positionId;
        PositionLiabilitySide side;
        AccountId payerAccountId;
        AccountId receiverAccountId;
        bytes32 terminalOutcomeReference;
        uint64 settlementDeadline;
        uint64 finalResolutionAt;
        TerminalOutcomeKind outcome;
        uint128 amount;
        bool exists;
    }

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
        return _createPosition(creation, true);
    }

    function createLifecycleSuccessor(PositionCreation calldata creation)
        external
        nonReentrant
        onlyRole(LIFECYCLE_ENGINE_ROLE)
        returns (PositionId positionId)
    {
        return _createPosition(creation, false);
    }

    function _createPosition(PositionCreation calldata creation, bool requireOpenForNewRisk)
        private
        returns (PositionId positionId)
    {
        _validateCreation(creation);
        positionId = _derivePositionId(creation);
        if (_lifecycles[positionId].status != PositionStatus.Unspecified) revert PositionAlreadyExists(positionId);
        if (
            requireOpenForNewRisk
                && !_seriesRegistry.isOpenForNewRisk(creation.seriesId, creation.seriesVersion, _currentDay())
        ) {
            revert SeriesClosedForNewRisk(bytes32(SeriesId.unwrap(creation.seriesId)), creation.seriesVersion);
        }
        if (!requireOpenForNewRisk && !_seriesRegistry.isLifecycleEnabled(creation.seriesId, creation.seriesVersion)) {
            revert SeriesClosedForNewRisk(bytes32(SeriesId.unwrap(creation.seriesId)), creation.seriesVersion);
        }

        SeriesVersion memory series = _seriesRegistry.getSeries(creation.seriesId, creation.seriesVersion);
        MarketVersion memory market =
            _marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
        InstrumentVersion memory instrument =
            _instrumentRegistry.getInstrument(series.definition.instrumentId, series.definition.instrumentVersion);
        bytes32 termsHash = _seriesRegistry.hashPayoffTerms(instrument.definition.termsSchemaHash, creation.payoffTerms);
        if (termsHash != series.definition.payoffTermsHash) {
            revert PayoffTermsHashMismatch(series.definition.payoffTermsHash, termsHash);
        }

        AdapterVersion memory adapter = _adapterRegistry.getAdapter(
            instrument.definition.payoffModuleId, instrument.definition.payoffModuleVersion
        );
        address payoffModule = adapter.definition.implementation;
        bytes32 actualCodeHash = payoffModule.codehash;
        if (
            !_adapterRegistry.runtimeMatches(
                    instrument.definition.payoffModuleId, instrument.definition.payoffModuleVersion
                ) || actualCodeHash != adapter.definition.expectedRuntimeCodeHash
        ) {
            revert PayoffModuleRuntimeMismatch(payoffModule, adapter.definition.expectedRuntimeCodeHash, actualCodeHash);
        }

        uint128 longMaximum = PositionMathLib.checkedAmount(series.definition.maxLongDebitMinorPerLot, creation.lots);
        uint128 shortMaximum = PositionMathLib.checkedAmount(series.definition.maxShortDebitMinorPerLot, creation.lots);
        bytes32 longLiabilityKey = _deriveLiabilityKey(positionId, PositionLiabilitySide.Long);
        bytes32 shortLiabilityKey = _deriveLiabilityKey(positionId, PositionLiabilitySide.Short);

        _stageLiability(
            longLiabilityKey,
            positionId,
            PositionLiabilitySide.Long,
            creation.longAccountId,
            series.definition.settlementDeadline,
            series.definition.finalResolutionAt
        );
        _stageLiability(
            shortLiabilityKey,
            positionId,
            PositionLiabilitySide.Short,
            creation.shortAccountId,
            series.definition.settlementDeadline,
            series.definition.finalResolutionAt
        );

        TerminalLiabilityReservationId longReservationId =
            _createReservation(longLiabilityKey, creation.longAccountId, market, longMaximum, creation.longFunding);
        TerminalLiabilityReservationId shortReservationId =
            _createReservation(shortLiabilityKey, creation.shortAccountId, market, shortMaximum, creation.shortFunding);

        PositionEconomics storage economics = _economics[positionId];
        economics.positionId = positionId;
        economics.fillIdentity = creation.fillIdentity;
        economics.seriesId = creation.seriesId;
        economics.seriesVersionHash = series.versionHash;
        economics.marketId = series.definition.marketId;
        economics.instrumentId = series.definition.instrumentId;
        economics.longAccountId = creation.longAccountId;
        economics.shortAccountId = creation.shortAccountId;
        economics.payoffModuleId = instrument.definition.payoffModuleId;
        economics.payoffModule = payoffModule;
        economics.payoffModuleCodeHash = actualCodeHash;
        economics.settlementAssetId = market.definition.settlementAssetId;
        economics.riskDomainId = market.definition.riskDomainId;
        economics.feeScheduleId = market.definition.feeScheduleId;
        economics.payoffTermsHash = termsHash;
        economics.fixingSlotsHash = series.definition.fixingSlotsHash;
        economics.seriesVersion = creation.seriesVersion;
        economics.marketVersion = series.definition.marketVersion;
        economics.instrumentVersion = series.definition.instrumentVersion;
        economics.payoffModuleVersion = instrument.definition.payoffModuleVersion;
        economics.settlementAssetVersion = market.definition.settlementAssetVersion;
        economics.riskDomainVersion = market.definition.riskDomainVersion;
        economics.feeScheduleVersion = market.definition.feeScheduleVersion;
        economics.ordinal = creation.ordinal;
        economics.fixingWindowOpen = series.definition.fixingWindowOpen;
        economics.finalResolutionAt = series.definition.finalResolutionAt;
        economics.settlementDeadline = series.definition.settlementDeadline;
        economics.maxEvaluationGas = instrument.definition.maxEvaluationGas;
        economics.lots = creation.lots;
        economics.entryPriceTicks = creation.entryPriceTicks;
        economics.maxLongDebitMinorPerLot = series.definition.maxLongDebitMinorPerLot;
        economics.maxShortDebitMinorPerLot = series.definition.maxShortDebitMinorPerLot;
        economics.maxLongDebitMinor = longMaximum;
        economics.maxShortDebitMinor = shortMaximum;
        economics.terminalDisruptionTransferMinorPerLot = series.definition.terminalDisruptionTransferMinorPerLot;
        economics.longLiabilityKey = longLiabilityKey;
        economics.shortLiabilityKey = shortLiabilityKey;
        economics.longReservationId = longReservationId;
        economics.shortReservationId = shortReservationId;

        _payoffTerms[positionId] = creation.payoffTerms;
        _lifecycles[positionId].status = PositionStatus.Live;
        _positionCount += 1;

        emit PositionCreated(
            positionId,
            creation.fillIdentity,
            SeriesId.unwrap(creation.seriesId),
            creation.seriesVersion,
            AccountId.unwrap(creation.longAccountId),
            AccountId.unwrap(creation.shortAccountId),
            Lots.unwrap(creation.lots),
            TerminalLiabilityReservationId.unwrap(longReservationId),
            TerminalLiabilityReservationId.unwrap(shortReservationId),
            msg.sender
        );
    }

    function createPositionFundingLock(
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry
    ) external nonReentrant onlyRole(FUNDING_REQUESTER_ROLE) returns (CollateralLockId lockId) {
        if (lockReference == bytes32(0) || AccountId.unwrap(accountId) == bytes32(0) || amount == 0) {
            revert PositionFundingMismatch(bytes32(0), CollateralLockId.wrap(bytes32(0)));
        }
        lockId = _collateralVault.createLock(
            lockReference, accountId, assetId, bindingVersion, amount, expiry, address(this)
        );
        CollateralLock memory lock = _collateralVault.getLock(lockId);
        CollateralId expectedCollateral = _collateralVault.deriveCollateralId(assetId, bindingVersion);
        if (
            CollateralLockId.unwrap(lockId)
                    != CollateralLockId.unwrap(_collateralVault.deriveLockId(address(this), lockReference))
                || lock.status != LockStatus.Active || lock.operator != address(this)
                || lock.settlementOperator != address(this) || lock.lockReference != lockReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(accountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(assetId) || lock.bindingVersion != bindingVersion
                || lock.initialAmount != amount || lock.remainingAmount != amount || lock.expiry != expiry
        ) revert PositionFundingMismatch(bytes32(0), lockId);
        _positionFundingRequesters[lockId] = msg.sender;
        emit PositionFundingLockCreated(
            lockId, lockReference, accountId, assetId, bindingVersion, amount, expiry, msg.sender
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
        if (lifecycle.status != PositionStatus.Live) {
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
        if (fixingReference == bytes32(0) || finalFixings.length == 0) revert ZeroReference();
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (lifecycle.status != PositionStatus.Fixing) {
            revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.SettlementReady);
        }
        PositionEconomics storage economics = _economics[positionId];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs >= economics.finalResolutionAt) {
            revert FinalResolutionReached(positionId, economics.finalResolutionAt, nowTs);
        }

        int256 perLot = _evaluatePayoff(positionId, economics, finalFixings);
        int256 total = PositionMathLib.scaleTransfer(perLot, economics.lots);
        lifecycle.finalFixingReference = fixingReference;
        lifecycle.finalFixingsHash = keccak256(finalFixings);
        lifecycle.terminalTransferMinor = total;
        _setStatus(positionId, lifecycle, PositionStatus.SettlementReady, fixingReference);

        emit PositionPayoffComputed(positionId, fixingReference, lifecycle.finalFixingsHash, perLot, total);
    }

    function settle(PositionId positionId) external {
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (lifecycle.status != PositionStatus.SettlementReady) {
            revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Settled);
        }
        PositionEconomics storage economics = _economics[positionId];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs >= economics.finalResolutionAt) {
            revert FinalResolutionReached(positionId, economics.finalResolutionAt, nowTs);
        }

        bytes32 outcomeReference = keccak256(
            abi.encode(
                SETTLEMENT_OUTCOME_TYPEHASH,
                PositionId.unwrap(positionId),
                lifecycle.finalFixingReference,
                lifecycle.finalFixingsHash,
                lifecycle.terminalTransferMinor
            )
        );
        lifecycle.terminalOutcomeReference = outcomeReference;
        _writeTerminalLiabilities(economics, lifecycle.terminalTransferMinor, outcomeReference, false);
        _setStatus(positionId, lifecycle, PositionStatus.Settled, outcomeReference);
    }

    function applyTerminalFallback(PositionId positionId) external {
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (!_isFallbackSource(lifecycle.status)) {
            revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.TerminalClaim);
        }
        PositionEconomics storage economics = _economics[positionId];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < economics.finalResolutionAt) {
            revert FinalResolutionNotReached(positionId, economics.finalResolutionAt, nowTs);
        }

        int256 total = PositionMathLib.scaleTransfer(economics.terminalDisruptionTransferMinorPerLot, economics.lots);
        bytes32 outcomeReference = keccak256(
            abi.encode(FALLBACK_OUTCOME_TYPEHASH, PositionId.unwrap(positionId), economics.finalResolutionAt, total)
        );
        lifecycle.terminalTransferMinor = total;
        lifecycle.terminalOutcomeReference = outcomeReference;
        _writeTerminalLiabilities(economics, total, outcomeReference, true);
        PositionStatus terminalStatus = total == 0 ? PositionStatus.Settled : PositionStatus.TerminalClaim;
        _setStatus(positionId, lifecycle, terminalStatus, outcomeReference);
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
        if (transitionReference == bytes32(0)) revert ZeroReference();
        if (!_isZeroLiabilityAlternative(terminalStatus)) revert UnsupportedTerminalAlternative(terminalStatus);
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (lifecycle.status != PositionStatus.Live && lifecycle.status != PositionStatus.Fixing) {
            revert InvalidPositionTransition(positionId, lifecycle.status, terminalStatus);
        }

        bytes32 outcomeReference = keccak256(
            abi.encode(
                ALTERNATIVE_OUTCOME_TYPEHASH, PositionId.unwrap(positionId), uint8(terminalStatus), transitionReference
            )
        );
        lifecycle.terminalOutcomeReference = outcomeReference;
        PositionEconomics storage economics = _economics[positionId];
        _setFlatLiability(economics.longLiabilityKey, outcomeReference);
        _setFlatLiability(economics.shortLiabilityKey, outcomeReference);
        _setStatus(positionId, lifecycle, terminalStatus, outcomeReference);
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
        return (_economics[positionId], _lifecycles[positionId]);
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
        return _lifecycleSnapshot(positionId);
    }

    function isLifecycleActionEligible(PositionId positionId, LifecycleActionKind kind) external view returns (bool) {
        PositionLifecycle storage lifecycle = _lifecycles[positionId];
        if (lifecycle.status != PositionStatus.Live || kind == LifecycleActionKind.Unspecified) return false;
        SeriesVersion memory series =
            _seriesRegistry.getSeries(_economics[positionId].seriesId, _economics[positionId].seriesVersion);
        if (kind == LifecycleActionKind.Exercise) {
            return block.timestamp >= series.definition.exerciseOpensAt
                && block.timestamp < series.definition.exerciseCutoffAt;
        }
        if (kind == LifecycleActionKind.Lapse) return block.timestamp >= series.definition.exerciseCutoffAt;
        if (kind == LifecycleActionKind.PartialUnwind) return false;
        return true;
    }

    function getCompressionPosition(PositionId positionId) external view returns (CompressionPosition memory position) {
        LifecyclePositionSnapshot memory snapshot = _lifecycleSnapshot(positionId);
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

    function _lifecycleSnapshot(PositionId positionId)
        private
        view
        returns (LifecyclePositionSnapshot memory snapshot)
    {
        _requirePositionView(positionId);
        PositionEconomics storage economics = _economics[positionId];
        PositionLifecycle storage lifecycle = _lifecycles[positionId];
        SeriesVersion memory series = _seriesRegistry.getSeries(economics.seriesId, economics.seriesVersion);
        CollateralId collateralId =
            _collateralVault.deriveCollateralId(economics.settlementAssetId, economics.settlementAssetVersion);
        bytes32 economicsHash = _economicsHash(economics);
        bytes32 lifecycleHash = keccak256(
            abi.encode(
                POSITION_LIFECYCLE_HASH_TYPEHASH,
                uint8(lifecycle.status),
                lifecycle.finalFixingReference,
                lifecycle.finalFixingsHash,
                lifecycle.terminalOutcomeReference,
                lifecycle.terminalTransferMinor
            )
        );
        bytes32 immutableHash = keccak256(
            abi.encode(
                POSITION_IMMUTABLE_HASH_TYPEHASH,
                positionEngineId,
                PositionId.unwrap(positionId),
                economicsHash,
                economics.longAccountId,
                economics.shortAccountId,
                economics.longReservationId,
                economics.shortReservationId,
                keccak256(_payoffTerms[positionId])
            )
        );
        snapshot = LifecyclePositionSnapshot({
            positionId: positionId,
            immutableHash: immutableHash,
            lifecycleHash: lifecycleHash,
            seriesId: economics.seriesId,
            seriesVersion: economics.seriesVersion,
            longAccountId: economics.longAccountId,
            shortAccountId: economics.shortAccountId,
            riskDomainId: economics.riskDomainId,
            riskDomainVersion: economics.riskDomainVersion,
            feeScheduleId: economics.feeScheduleId,
            feeScheduleVersion: economics.feeScheduleVersion,
            collateralId: collateralId,
            positionLots: economics.lots,
            remainingExerciseLots: economics.lots,
            entryPriceTicks: economics.entryPriceTicks,
            economicsHash: economicsHash,
            packageProvenanceHash: bytes32(0),
            exercisePolicyId: series.definition.exercisePolicyId,
            expiryAt: series.definition.expiryAt,
            exerciseOpensAt: series.definition.exerciseOpensAt,
            exerciseCutoffAt: series.definition.exerciseCutoffAt,
            lapseEligibleAt: series.definition.exerciseCutoffAt,
            longTerminalLiabilityBaseUnits: economics.maxLongDebitMinor,
            shortTerminalLiabilityBaseUnits: economics.maxShortDebitMinor
        });
    }

    function _economicsHash(PositionEconomics storage economics) private view returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    POSITION_ECONOMICS_HASH_TYPEHASH,
                    economics.seriesId,
                    economics.seriesVersionHash,
                    economics.marketId,
                    economics.instrumentId,
                    economics.payoffModuleId,
                    economics.payoffModule,
                    economics.payoffModuleCodeHash,
                    economics.settlementAssetId,
                    economics.riskDomainId,
                    economics.feeScheduleId,
                    economics.payoffTermsHash,
                    economics.fixingSlotsHash
                ),
                abi.encode(
                    economics.seriesVersion,
                    economics.marketVersion,
                    economics.instrumentVersion,
                    economics.payoffModuleVersion,
                    economics.settlementAssetVersion,
                    economics.riskDomainVersion,
                    economics.feeScheduleVersion,
                    economics.fixingWindowOpen,
                    economics.finalResolutionAt,
                    economics.settlementDeadline,
                    economics.maxEvaluationGas,
                    economics.lots,
                    economics.entryPriceTicks,
                    economics.maxLongDebitMinorPerLot,
                    economics.maxShortDebitMinorPerLot,
                    economics.maxLongDebitMinor,
                    economics.maxShortDebitMinor,
                    economics.terminalDisruptionTransferMinorPerLot
                )
            )
        );
    }

    function _createReservation(
        bytes32 liabilityKey,
        AccountId payerAccountId,
        MarketVersion memory market,
        uint128 amount,
        PositionFunding calldata funding
    ) private returns (TerminalLiabilityReservationId reservationId) {
        if (amount == 0) {
            if (!_isEmptyFunding(funding)) {
                revert UnexpectedPositionFunding(liabilityKey, funding.lockId);
            }
            return TerminalLiabilityReservationId.wrap(bytes32(0));
        }
        if (CollateralLockId.unwrap(funding.lockId) == bytes32(0)) {
            if (!_isEmptyFunding(funding)) revert PositionFundingMismatch(liabilityKey, funding.lockId);
            reservationId = _collateralVault.createTerminalLiabilityReservation(
                liabilityKey,
                payerAccountId,
                market.definition.settlementAssetId,
                market.definition.settlementAssetVersion,
                market.definition.riskDomainId,
                market.definition.riskDomainVersion,
                amount,
                address(this)
            );
        } else {
            _requireAdoptableFunding(liabilityKey, payerAccountId, market, amount, funding);
            reservationId = _collateralVault.convertLockToTerminalLiabilityReservation(
                funding.lockId,
                liabilityKey,
                market.definition.riskDomainId,
                market.definition.riskDomainVersion,
                amount
            );
            if (funding.expectedRemainingAmount == amount) delete _positionFundingRequesters[funding.lockId];
        }
        TerminalLiabilityReservationId expected =
            _collateralVault.deriveTerminalLiabilityReservationId(address(this), positionEngineId, liabilityKey);
        if (TerminalLiabilityReservationId.unwrap(reservationId) != TerminalLiabilityReservationId.unwrap(expected)) {
            revert ReservationMismatch(
                liabilityKey,
                TerminalLiabilityReservationId.unwrap(expected),
                TerminalLiabilityReservationId.unwrap(reservationId)
            );
        }
        TerminalLiabilityReservation memory reservation = _collateralVault.terminalLiabilityReservationOf(reservationId);
        if (
            reservation.positionId != liabilityKey
                || AccountId.unwrap(reservation.payerAccountId) != AccountId.unwrap(payerAccountId)
                || reservation.positionEngine != address(this) || reservation.positionEngineId != positionEngineId
                || AssetId.unwrap(reservation.assetId) != AssetId.unwrap(market.definition.settlementAssetId)
                || reservation.bindingVersion != market.definition.settlementAssetVersion
                || reservation.riskDomainId != market.definition.riskDomainId
                || reservation.riskDomainVersion != market.definition.riskDomainVersion
                || reservation.settlementDeadline != _liabilityDeadline(liabilityKey, true)
                || reservation.finalResolutionAt != _liabilityDeadline(liabilityKey, false)
                || reservation.initialAmount != amount || reservation.remainingAmount != amount
                || reservation.status != TerminalLiabilityReservationStatus.Active
        ) revert ReservationRecordMismatch(TerminalLiabilityReservationId.unwrap(reservationId));
    }

    function _requireAdoptableFunding(
        bytes32 liabilityKey,
        AccountId payerAccountId,
        MarketVersion memory market,
        uint128 amount,
        PositionFunding calldata funding
    ) private view {
        CollateralLock memory lock = _collateralVault.getLock(funding.lockId);
        CollateralId expectedCollateral = _collateralVault.deriveCollateralId(
            market.definition.settlementAssetId, market.definition.settlementAssetVersion
        );
        if (
            funding.lockReference == bytes32(0) || funding.expectedRemainingAmount < amount
                || funding.expectedExpiry <= block.timestamp || lock.status != LockStatus.Active
                || lock.operator != address(this) || lock.settlementOperator != address(this)
                || lock.lockReference != funding.lockReference
                || CollateralLockId.unwrap(funding.lockId)
                    != CollateralLockId.unwrap(_collateralVault.deriveLockId(address(this), funding.lockReference))
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(payerAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(market.definition.settlementAssetId)
                || lock.bindingVersion != market.definition.settlementAssetVersion
                || lock.remainingAmount != funding.expectedRemainingAmount || lock.expiry != funding.expectedExpiry
        ) revert PositionFundingMismatch(liabilityKey, funding.lockId);
    }

    function _isEmptyFunding(PositionFunding calldata funding) private pure returns (bool) {
        return CollateralLockId.unwrap(funding.lockId) == bytes32(0) && funding.lockReference == bytes32(0)
            && funding.expectedRemainingAmount == 0 && funding.expectedExpiry == 0;
    }

    function _liabilityDeadline(bytes32 liabilityKey, bool settlement) private view returns (uint64) {
        LiabilityState storage liability = _liabilityStates[liabilityKey];
        return settlement ? liability.settlementDeadline : liability.finalResolutionAt;
    }

    function _evaluatePayoff(PositionId positionId, PositionEconomics storage economics, bytes calldata finalFixings)
        private
        view
        returns (int256 transferMinorPerLot)
    {
        bytes32 actualCodeHash = economics.payoffModule.codehash;
        if (actualCodeHash != economics.payoffModuleCodeHash) {
            revert PayoffModuleRuntimeMismatch(economics.payoffModule, economics.payoffModuleCodeHash, actualCodeHash);
        }

        bytes memory payload =
            abi.encodeCall(IPositionPayoffModuleV1.evaluatePosition, (_payoffTerms[positionId], finalFixings));
        bytes4 selector = IPositionPayoffModuleV1.evaluatePosition.selector;
        bool success;
        uint256 returnLength;
        uint64 gasLimit = economics.maxEvaluationGas;
        address implementation = economics.payoffModule;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, implementation, add(payload, 0x20), mload(payload), 0, 0)
            returnLength := returndatasize()
        }
        if (!success) revert PayoffModuleCallFailed(selector);
        if (returnLength != 32) revert InvalidPayoffModuleReturn(selector, returnLength);
        bytes memory returnData = new bytes(32);
        assembly ("memory-safe") {
            returndatacopy(add(returnData, 0x20), 0, 32)
        }
        transferMinorPerLot = abi.decode(returnData, (int256));
        if (
            transferMinorPerLot < -int256(uint256(economics.maxLongDebitMinorPerLot))
                || transferMinorPerLot > int256(uint256(economics.maxShortDebitMinorPerLot))
        ) {
            revert PayoffOutsideDebitBounds(
                transferMinorPerLot, economics.maxLongDebitMinorPerLot, economics.maxShortDebitMinorPerLot
            );
        }
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

    function _stageLiability(
        bytes32 liabilityKey,
        PositionId positionId,
        PositionLiabilitySide side,
        AccountId payerAccountId,
        uint64 settlementDeadline,
        uint64 finalResolutionAt
    ) private {
        LiabilityState storage liability = _liabilityStates[liabilityKey];
        liability.positionId = positionId;
        liability.side = side;
        liability.payerAccountId = payerAccountId;
        liability.settlementDeadline = settlementDeadline;
        liability.finalResolutionAt = finalResolutionAt;
        liability.exists = true;
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

    function _validateCreation(PositionCreation calldata creation) private pure {
        if (creation.fillIdentity == bytes32(0)) revert ZeroFillIdentity();
        if (
            AccountId.unwrap(creation.longAccountId) == bytes32(0)
                || AccountId.unwrap(creation.shortAccountId) == bytes32(0)
        ) revert ZeroAccount();
        if (AccountId.unwrap(creation.longAccountId) == AccountId.unwrap(creation.shortAccountId)) {
            revert IdenticalPositionAccounts();
        }
        if (LotsLib.isZero(creation.lots)) revert ZeroLots();
    }

    function _requirePosition(PositionId positionId) private view returns (PositionLifecycle storage lifecycle) {
        lifecycle = _lifecycles[positionId];
        if (lifecycle.status == PositionStatus.Unspecified) revert UnknownPosition(positionId);
    }

    function _requirePositionView(PositionId positionId) private view {
        if (_lifecycles[positionId].status == PositionStatus.Unspecified) revert UnknownPosition(positionId);
    }

    function _isFallbackSource(PositionStatus status) private pure returns (bool) {
        return status == PositionStatus.Live || status == PositionStatus.Fixing
            || status == PositionStatus.SettlementReady || status == PositionStatus.Defaulted;
    }

    function _isZeroLiabilityAlternative(PositionStatus status) private pure returns (bool) {
        return status == PositionStatus.ClosedByUnwind || status == PositionStatus.Replaced
            || status == PositionStatus.Lapsed || status == PositionStatus.CancelledByDisruption;
    }

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
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
