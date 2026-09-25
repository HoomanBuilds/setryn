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
import {IExactLotsPayoffModuleV1} from "../interfaces/IExactLotsPayoffModuleV1.sol";
import {PositionTerminalState} from "../interfaces/IPositionEngineTerminalState.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {CollateralLock, TerminalLiabilityReplacement, TerminalLiabilityReservation} from "../types/CollateralTypes.sol";
import {LockStatus, TerminalLiabilityReservationStatus, TerminalOutcomeKind} from "../types/Enums.sol";
import {
    AccountId,
    AdapterId,
    AssetId,
    CollateralId,
    CollateralLockId,
    ExercisePolicyId,
    PackageId,
    PositionId,
    RiskDomainId,
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
    PositionExerciseState,
    PositionLiabilitySide,
    PositionLifecycle,
    PositionProvenance,
    PositionStatus
} from "../types/PositionTypes.sol";
import {CompressionPosition} from "../types/CompressionTypes.sol";
import {LifecycleActionKind, LifecyclePositionSnapshot} from "../types/LifecycleTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots, LotsLib} from "../types/Units.sol";
import {PortfolioPositionWitness, PositionRiskSnapshot} from "../types/RiskTypes.sol";

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

    struct PositionInitializationContext {
        PositionId positionId;
        SeriesVersion series;
        MarketVersion market;
        InstrumentVersion instrument;
        PositionProvenance provenance;
        bytes32 termsHash;
        address payoffModule;
        bytes32 payoffModuleCodeHash;
        uint128 longMaximum;
        uint128 shortMaximum;
        bytes32 longLiabilityKey;
        bytes32 shortLiabilityKey;
        TerminalLiabilityReservationId longReservationId;
        TerminalLiabilityReservationId shortReservationId;
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
        _validateCreation(creation);
        _validateProvenance(provenance);
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
        PositionInitializationContext memory context = _preparePositionInitialization(creation, positionId, provenance);
        _stagePositionLiabilities(creation, context);
        context.longReservationId = _createReservation(
            context.longLiabilityKey, creation.longAccountId, context.market, context.longMaximum, creation.longFunding
        );
        context.shortReservationId = _createReservation(
            context.shortLiabilityKey,
            creation.shortAccountId,
            context.market,
            context.shortMaximum,
            creation.shortFunding
        );
        _storePositionEconomics(creation, context);
        _storePositionLifecycle(creation, context);
        _payoffTerms[positionId] = creation.payoffTerms;
        _positionCount += 1;
        _emitPositionCreated(creation, context);
    }

    function _preparePositionInitialization(
        PositionCreation calldata creation,
        PositionId positionId,
        PositionProvenance memory provenance
    ) private view returns (PositionInitializationContext memory context) {
        context.positionId = positionId;
        context.provenance = provenance;
        context.series = _seriesRegistry.getSeries(creation.seriesId, creation.seriesVersion);
        context.market =
            _marketRegistry.getMarket(context.series.definition.marketId, context.series.definition.marketVersion);
        context.instrument = _instrumentRegistry.getInstrument(
            context.series.definition.instrumentId, context.series.definition.instrumentVersion
        );
        context.termsHash =
            _seriesRegistry.hashPayoffTerms(context.instrument.definition.termsSchemaHash, creation.payoffTerms);
        if (context.termsHash != context.series.definition.payoffTermsHash) {
            revert PayoffTermsHashMismatch(context.series.definition.payoffTermsHash, context.termsHash);
        }
        AdapterVersion memory adapter = _adapterRegistry.getAdapter(
            context.instrument.definition.payoffModuleId, context.instrument.definition.payoffModuleVersion
        );
        context.payoffModule = adapter.definition.implementation;
        context.payoffModuleCodeHash = context.payoffModule.codehash;
        if (
            !_adapterRegistry.runtimeMatches(
                    context.instrument.definition.payoffModuleId, context.instrument.definition.payoffModuleVersion
                ) || context.payoffModuleCodeHash != adapter.definition.expectedRuntimeCodeHash
        ) {
            revert PayoffModuleRuntimeMismatch(
                context.payoffModule, adapter.definition.expectedRuntimeCodeHash, context.payoffModuleCodeHash
            );
        }
        bytes32 exactLotsCapability =
            _readExactLotsCapability(context.payoffModule, context.instrument.definition.maxEvaluationGas);
        if (exactLotsCapability != EXACT_LOTS_CAPABILITY) {
            revert ExactLotsCapabilityMismatch(context.payoffModule, exactLotsCapability);
        }
        context.longMaximum =
            PositionMathLib.checkedAmount(context.series.definition.maxLongDebitMinorPerLot, creation.lots);
        context.shortMaximum =
            PositionMathLib.checkedAmount(context.series.definition.maxShortDebitMinorPerLot, creation.lots);
        context.longLiabilityKey = _deriveLiabilityKey(positionId, PositionLiabilitySide.Long);
        context.shortLiabilityKey = _deriveLiabilityKey(positionId, PositionLiabilitySide.Short);
    }

    function _stagePositionLiabilities(PositionCreation calldata creation, PositionInitializationContext memory context)
        private
    {
        _stageLiability(
            context.longLiabilityKey,
            context.positionId,
            PositionLiabilitySide.Long,
            creation.longAccountId,
            context.series.definition.settlementDeadline,
            context.series.definition.finalResolutionAt
        );
        _stageLiability(
            context.shortLiabilityKey,
            context.positionId,
            PositionLiabilitySide.Short,
            creation.shortAccountId,
            context.series.definition.settlementDeadline,
            context.series.definition.finalResolutionAt
        );
    }

    function _storePositionEconomics(PositionCreation calldata creation, PositionInitializationContext memory context)
        private
    {
        PositionEconomics storage economics = _economics[context.positionId];
        economics.positionId = context.positionId;
        economics.fillIdentity = creation.fillIdentity;
        economics.seriesId = creation.seriesId;
        economics.seriesVersionHash = context.series.versionHash;
        economics.marketId = context.series.definition.marketId;
        economics.instrumentId = context.series.definition.instrumentId;
        economics.longAccountId = creation.longAccountId;
        economics.shortAccountId = creation.shortAccountId;
        economics.payoffModuleId = context.instrument.definition.payoffModuleId;
        economics.payoffModule = context.payoffModule;
        economics.payoffModuleCodeHash = context.payoffModuleCodeHash;
        economics.settlementAssetId = context.market.definition.settlementAssetId;
        economics.riskDomainId = context.market.definition.riskDomainId;
        economics.feeScheduleId = context.market.definition.feeScheduleId;
        economics.payoffTermsHash = context.termsHash;
        economics.fixingSlotsHash = context.series.definition.fixingSlotsHash;
        economics.seriesVersion = creation.seriesVersion;
        economics.marketVersion = context.series.definition.marketVersion;
        economics.instrumentVersion = context.series.definition.instrumentVersion;
        economics.payoffModuleVersion = context.instrument.definition.payoffModuleVersion;
        economics.settlementAssetVersion = context.market.definition.settlementAssetVersion;
        economics.riskDomainVersion = context.market.definition.riskDomainVersion;
        economics.feeScheduleVersion = context.market.definition.feeScheduleVersion;
        economics.ordinal = creation.ordinal;
        economics.fixingWindowOpen = context.series.definition.fixingWindowOpen;
        economics.finalResolutionAt = context.series.definition.finalResolutionAt;
        economics.settlementDeadline = context.series.definition.settlementDeadline;
        economics.maxEvaluationGas = context.instrument.definition.maxEvaluationGas;
        economics.exerciseOpensAt = context.series.definition.exerciseOpensAt;
        economics.exerciseCutoffAt = context.series.definition.exerciseCutoffAt;
        economics.exercisePolicyId = context.series.definition.exercisePolicyId;
        economics.automaticExerciseThresholdMinor = context.series.definition.automaticExerciseThresholdMinor;
        economics.lots = creation.lots;
        economics.originalLots = creation.lots;
        economics.entryPriceTicks = creation.entryPriceTicks;
        economics.maxLongDebitMinorPerLot = context.series.definition.maxLongDebitMinorPerLot;
        economics.maxShortDebitMinorPerLot = context.series.definition.maxShortDebitMinorPerLot;
        economics.maxLongDebitMinor = context.longMaximum;
        economics.maxShortDebitMinor = context.shortMaximum;
        economics.terminalDisruptionTransferMinorPerLot =
        context.series.definition.terminalDisruptionTransferMinorPerLot;
        economics.longLiabilityKey = context.longLiabilityKey;
        economics.shortLiabilityKey = context.shortLiabilityKey;
        economics.longReservationId = context.longReservationId;
        economics.shortReservationId = context.shortReservationId;
        economics.packageId = context.provenance.packageId;
        economics.packageVersion = context.provenance.packageVersion;
        economics.packageOrdinal = context.provenance.packageOrdinal;
        economics.packageProvenanceHash = context.provenance.packageProvenanceHash;
    }

    function _storePositionLifecycle(PositionCreation calldata creation, PositionInitializationContext memory context)
        private
    {
        PositionLifecycle storage lifecycle = _lifecycles[context.positionId];
        lifecycle.status = PositionStatus.Live;
        lifecycle.exerciseState = ExercisePolicyId.unwrap(context.series.definition.exercisePolicyId)
            == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC)
            ? PositionExerciseState.AwaitingFixing
            : PositionExerciseState.ElectionOpen;
        lifecycle.remainingLots = creation.lots;
        lifecycle.lifecycleOwnerAccountId = creation.longAccountId;
    }

    function _emitPositionCreated(PositionCreation calldata creation, PositionInitializationContext memory context)
        private
    {
        emit PositionCreated(
            context.positionId,
            creation.fillIdentity,
            SeriesId.unwrap(creation.seriesId),
            creation.seriesVersion,
            AccountId.unwrap(creation.longAccountId),
            AccountId.unwrap(creation.shortAccountId),
            Lots.unwrap(creation.lots),
            TerminalLiabilityReservationId.unwrap(context.longReservationId),
            TerminalLiabilityReservationId.unwrap(context.shortReservationId),
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

        lifecycle.finalFixingReference = fixingReference;
        lifecycle.finalFixingsHash = keccak256(finalFixings);
        bytes32 policy = ExercisePolicyId.unwrap(economics.exercisePolicyId);
        if (policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)) {
            _setStatus(positionId, lifecycle, PositionStatus.Live, fixingReference);
            return;
        }
        if (
            policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
                && block.timestamp <= economics.exerciseCutoffAt
        ) revert FixingWindowNotOpen(positionId, economics.exerciseCutoffAt + 1, nowTs);

        uint128 evaluatedLots = Lots.unwrap(lifecycle.remainingLots);
        int256 total = _evaluatePayoff(positionId, economics, finalFixings, evaluatedLots);
        if (
            policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
                && _absoluteTransfer(total) < economics.automaticExerciseThresholdMinor
        ) {
            lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + evaluatedLots);
            lifecycle.remainingLots = Lots.wrap(0);
            lifecycle.exerciseState = PositionExerciseState.Lapsed;
            lifecycle.terminalTransferMinor = 0;
            bytes32 lapseReference = keccak256(
                abi.encode(
                    ALTERNATIVE_OUTCOME_TYPEHASH,
                    PositionId.unwrap(positionId),
                    uint8(PositionStatus.Lapsed),
                    fixingReference
                )
            );
            lifecycle.terminalOutcomeReference = lapseReference;
            _writeTerminalLiabilities(economics, 0, lapseReference, false);
            _setStatus(positionId, lifecycle, PositionStatus.Lapsed, lapseReference);
            _emitQuantity(positionId, lifecycle, lapseReference);
            return;
        }
        lifecycle.exercisedLots = Lots.wrap(Lots.unwrap(lifecycle.exercisedLots) + evaluatedLots);
        lifecycle.remainingLots = Lots.wrap(0);
        lifecycle.exerciseState = PositionExerciseState.FullyExercised;
        lifecycle.terminalTransferMinor = _checkedAddTransfer(lifecycle.terminalTransferMinor, total);
        _setStatus(positionId, lifecycle, PositionStatus.SettlementReady, fixingReference);

        emit PositionExactPayoffComputed(
            positionId, fixingReference, lifecycle.finalFixingsHash, evaluatedLots, lifecycle.terminalTransferMinor
        );
        _emitQuantity(positionId, lifecycle, fixingReference);
    }

    function exercisePositionQuantity(
        PositionId positionId,
        Lots exerciseLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        bytes32 fixingReference,
        bytes calldata finalFixings
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        if (fixingReference == bytes32(0) || finalFixings.length == 0) {
            revert ZeroReference();
        }
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.SettlementReady);
        }
        _requireLifecycleAuthority(positionId, lifecycle, actorAccountId, expectedLifecycleNonce);
        PositionEconomics storage economics = _economics[positionId];
        if (
            ExercisePolicyId.unwrap(economics.exercisePolicyId)
                != ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)
        ) revert UnsupportedTerminalAlternative(PositionStatus.SettlementReady);
        if (block.timestamp < economics.exerciseOpensAt || block.timestamp > economics.exerciseCutoffAt) {
            revert FixingWindowNotOpen(positionId, economics.exerciseOpensAt, uint64(block.timestamp));
        }
        uint128 quantity = _requireQuantity(positionId, lifecycle, exerciseLots);
        bytes32 suppliedFixingsHash = keccak256(finalFixings);
        if (
            lifecycle.finalFixingReference == bytes32(0) || lifecycle.finalFixingsHash == bytes32(0)
                || lifecycle.finalFixingReference != fixingReference
                || lifecycle.finalFixingsHash != suppliedFixingsHash
        ) {
            revert ZeroReference();
        }
        int256 transfer = _evaluatePayoff(positionId, economics, finalFixings, quantity);
        lifecycle.terminalTransferMinor = _checkedAddTransfer(lifecycle.terminalTransferMinor, transfer);
        lifecycle.remainingLots = Lots.wrap(Lots.unwrap(lifecycle.remainingLots) - quantity);
        lifecycle.exercisedLots = Lots.wrap(Lots.unwrap(lifecycle.exercisedLots) + quantity);
        lifecycle.exerciseState = Lots.unwrap(lifecycle.remainingLots) == 0
            ? PositionExerciseState.FullyExercised
            : PositionExerciseState.PartiallyExercised;
        lifecycle.lifecycleNonce += 1;
        emit PositionExactPayoffComputed(positionId, fixingReference, suppliedFixingsHash, quantity, transfer);
        if (Lots.unwrap(lifecycle.remainingLots) == 0) {
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
        _emitQuantity(positionId, lifecycle, fixingReference);
    }

    function abandonPositionQuantity(
        PositionId positionId,
        Lots abandonLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        bytes32 transitionReference
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        if (transitionReference == bytes32(0)) revert ZeroReference();
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Abandoned);
        }
        _requireLifecycleAuthority(positionId, lifecycle, actorAccountId, expectedLifecycleNonce);
        PositionEconomics storage economics = _economics[positionId];
        if (
            ExercisePolicyId.unwrap(economics.exercisePolicyId)
                    != ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
                || block.timestamp < economics.exerciseOpensAt || block.timestamp > economics.exerciseCutoffAt
        ) revert FixingWindowNotOpen(positionId, economics.exerciseOpensAt, uint64(block.timestamp));
        uint128 quantity = _requireQuantity(positionId, lifecycle, abandonLots);
        lifecycle.remainingLots = Lots.wrap(Lots.unwrap(lifecycle.remainingLots) - quantity);
        lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + quantity);
        lifecycle.lifecycleNonce += 1;
        lifecycle.exerciseState = Lots.unwrap(lifecycle.remainingLots) == 0
            ? PositionExerciseState.Abandoned
            : PositionExerciseState.ElectionOpen;
        if (Lots.unwrap(lifecycle.remainingLots) == 0) {
            bytes32 outcomeReference = keccak256(
                abi.encode(
                    ALTERNATIVE_OUTCOME_TYPEHASH,
                    PositionId.unwrap(positionId),
                    uint8(PositionStatus.Abandoned),
                    transitionReference
                )
            );
            lifecycle.terminalOutcomeReference = outcomeReference;
            _writeTerminalLiabilities(economics, 0, outcomeReference, false);
            _setStatus(positionId, lifecycle, PositionStatus.Abandoned, outcomeReference);
        }
        _emitQuantity(positionId, lifecycle, transitionReference);
    }

    function closePositionQuantity(
        PositionId positionId,
        Lots closeLots,
        AccountId actorAccountId,
        uint64 expectedLifecycleNonce,
        PositionStatus terminalStatus,
        bytes32 transitionReference
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        if (transitionReference == bytes32(0)) revert ZeroReference();
        if (!_isZeroLiabilityAlternative(terminalStatus)) revert UnsupportedTerminalAlternative(terminalStatus);
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert InvalidPositionTransition(positionId, lifecycle.status, terminalStatus);
        }
        if (terminalStatus == PositionStatus.Lapsed) _requireLapseOpen(positionId);
        _requireLifecycleAuthority(positionId, lifecycle, actorAccountId, expectedLifecycleNonce);
        uint128 quantity = _requireQuantity(positionId, lifecycle, closeLots);
        lifecycle.remainingLots = Lots.wrap(Lots.unwrap(lifecycle.remainingLots) - quantity);
        lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + quantity);
        lifecycle.lifecycleNonce += 1;
        if (terminalStatus == PositionStatus.Lapsed) lifecycle.exerciseState = PositionExerciseState.Lapsed;
        if (terminalStatus == PositionStatus.Abandoned) lifecycle.exerciseState = PositionExerciseState.Abandoned;
        if (Lots.unwrap(lifecycle.remainingLots) == 0) {
            bytes32 outcomeReference = keccak256(
                abi.encode(
                    ALTERNATIVE_OUTCOME_TYPEHASH,
                    PositionId.unwrap(positionId),
                    uint8(terminalStatus),
                    transitionReference,
                    lifecycle.terminalTransferMinor
                )
            );
            lifecycle.terminalOutcomeReference = outcomeReference;
            PositionEconomics storage economics = _economics[positionId];
            _writeTerminalLiabilities(economics, lifecycle.terminalTransferMinor, outcomeReference, false);
            PositionStatus resolved = lifecycle.terminalTransferMinor == 0 ? terminalStatus : PositionStatus.Settled;
            _setStatus(positionId, lifecycle, resolved, outcomeReference);
        }
        _emitQuantity(positionId, lifecycle, transitionReference);
    }

    function transferLifecycleOwner(
        PositionId positionId,
        AccountId currentOwnerAccountId,
        AccountId newOwnerAccountId,
        uint64 expectedOwnerNonce,
        bytes32 transitionReference
    ) external onlyRole(LIFECYCLE_ENGINE_ROLE) {
        if (AccountId.unwrap(newOwnerAccountId) == bytes32(0) || transitionReference == bytes32(0)) {
            revert ZeroReference();
        }
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (lifecycle.status != PositionStatus.Live) {
            revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Live);
        }
        if (AccountId.unwrap(lifecycle.lifecycleOwnerAccountId) != AccountId.unwrap(currentOwnerAccountId)) {
            revert LifecycleOwnerMismatch(positionId, lifecycle.lifecycleOwnerAccountId, currentOwnerAccountId);
        }
        if (lifecycle.ownerNonce != expectedOwnerNonce) {
            revert LifecycleNonceMismatch(positionId, lifecycle.ownerNonce, expectedOwnerNonce);
        }
        lifecycle.lifecycleOwnerAccountId = newOwnerAccountId;
        lifecycle.ownerNonce += 1;
        lifecycle.lifecycleNonce += 1;
        _emitQuantity(positionId, lifecycle, transitionReference);
    }

    function settle(PositionId positionId) external {
        PositionLifecycle storage lifecycle = _requirePosition(positionId);
        if (lifecycle.status != PositionStatus.SettlementReady) {
            revert InvalidPositionTransition(positionId, lifecycle.status, PositionStatus.Settled);
        }
        if (lifecycle.exerciseState != PositionExerciseState.FullyExercised) {
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

        uint128 unresolvedLots = Lots.unwrap(lifecycle.remainingLots);
        int256 disruption;
        bytes32 policy = ExercisePolicyId.unwrap(economics.exercisePolicyId);
        bool applies = policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC);
        if (policy == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)) {
            int256 candidate =
                PositionMathLib.scaleTransfer(economics.terminalDisruptionTransferMinorPerLot, lifecycle.remainingLots);
            applies = _absoluteTransfer(candidate) >= economics.automaticExerciseThresholdMinor;
            if (applies) disruption = candidate;
        }
        if (applies && disruption == 0) {
            disruption =
                PositionMathLib.scaleTransfer(economics.terminalDisruptionTransferMinorPerLot, lifecycle.remainingLots);
        }
        int256 total = _checkedAddTransfer(lifecycle.terminalTransferMinor, disruption);
        bytes32 outcomeReference = keccak256(
            abi.encode(FALLBACK_OUTCOME_TYPEHASH, PositionId.unwrap(positionId), economics.finalResolutionAt, total)
        );
        lifecycle.terminalTransferMinor = total;
        lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + unresolvedLots);
        lifecycle.remainingLots = Lots.wrap(0);
        lifecycle.exerciseState = applies ? PositionExerciseState.FullyExercised : PositionExerciseState.Lapsed;
        lifecycle.terminalOutcomeReference = outcomeReference;
        _writeTerminalLiabilities(economics, total, outcomeReference, true);
        PositionStatus terminalStatus = total == 0 ? PositionStatus.Settled : PositionStatus.TerminalClaim;
        _setStatus(positionId, lifecycle, terminalStatus, outcomeReference);
        _emitQuantity(positionId, lifecycle, outcomeReference);
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
        if (terminalStatus == PositionStatus.Lapsed) _requireLapseOpen(positionId);

        uint128 remaining = Lots.unwrap(lifecycle.remainingLots);
        lifecycle.closedLots = Lots.wrap(Lots.unwrap(lifecycle.closedLots) + remaining);
        lifecycle.remainingLots = Lots.wrap(0);
        lifecycle.lifecycleNonce += 1;
        if (terminalStatus == PositionStatus.Lapsed) lifecycle.exerciseState = PositionExerciseState.Lapsed;
        if (terminalStatus == PositionStatus.Abandoned) lifecycle.exerciseState = PositionExerciseState.Abandoned;
        bytes32 outcomeReference = keccak256(
            abi.encode(
                ALTERNATIVE_OUTCOME_TYPEHASH,
                PositionId.unwrap(positionId),
                uint8(terminalStatus),
                transitionReference,
                lifecycle.terminalTransferMinor
            )
        );
        lifecycle.terminalOutcomeReference = outcomeReference;
        PositionEconomics storage economics = _economics[positionId];
        _writeTerminalLiabilities(economics, lifecycle.terminalTransferMinor, outcomeReference, false);
        PositionStatus resolved = lifecycle.terminalTransferMinor == 0 ? terminalStatus : PositionStatus.Settled;
        _setStatus(positionId, lifecycle, resolved, outcomeReference);
        _emitQuantity(positionId, lifecycle, transitionReference);
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
        _requirePositionView(positionId);
        PositionEconomics storage economics = _economics[positionId];
        PositionLifecycle storage lifecycle = _lifecycles[positionId];
        bool isLong = AccountId.unwrap(economics.longAccountId) == AccountId.unwrap(accountId);
        if (!isLong && AccountId.unwrap(economics.shortAccountId) != AccountId.unwrap(accountId)) {
            revert PositionRiskAccountMismatch(positionId, accountId);
        }
        uint128 remaining = Lots.unwrap(lifecycle.remainingLots);
        if (remaining > uint128(type(int128).max)) revert PositionRiskLotsOverflow(positionId, remaining);
        PortfolioPositionWitness memory witness = _riskWitness(positionId, economics, lifecycle, isLong, remaining);
        snapshot = PositionRiskSnapshot({
            witness: witness,
            accountId: accountId,
            riskDomainId: economics.riskDomainId,
            riskDomainVersion: economics.riskDomainVersion,
            remainingLots: remaining,
            finalResolutionAt: economics.finalResolutionAt,
            settlementDeadline: economics.settlementDeadline,
            lifecycleNonce: lifecycle.lifecycleNonce,
            status: lifecycle.status,
            terminalOutcomeReference: lifecycle.terminalOutcomeReference,
            stateHash: _riskStateHash(witness, accountId, economics, lifecycle, remaining)
        });
    }

    function _riskWitness(
        PositionId positionId,
        PositionEconomics storage economics,
        PositionLifecycle storage lifecycle,
        bool isLong,
        uint128 remaining
    ) private view returns (PortfolioPositionWitness memory witness) {
        witness = PortfolioPositionWitness({
            positionId: positionId,
            seriesId: economics.seriesId,
            seriesVersion: economics.seriesVersion,
            signedLots: isLong ? int128(remaining) : -int128(remaining),
            entryPriceTicks: economics.entryPriceTicks,
            maximumTerminalLiabilityBaseUnits: _currentAccountLiability(economics, lifecycle, isLong),
            economicsHash: _economicsHash(economics)
        });
    }

    function _currentAccountLiability(
        PositionEconomics storage economics,
        PositionLifecycle storage lifecycle,
        bool isLong
    ) private view returns (uint128) {
        (uint128 longLiability, uint128 shortLiability) = _currentLiabilityBounds(economics, lifecycle);
        return isLong ? longLiability : shortLiability;
    }

    function _riskStateHash(
        PortfolioPositionWitness memory witness,
        AccountId accountId,
        PositionEconomics storage economics,
        PositionLifecycle storage lifecycle,
        uint128 remaining
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                RISK_SNAPSHOT_TYPEHASH,
                witness,
                accountId,
                economics.riskDomainId,
                economics.riskDomainVersion,
                remaining,
                economics.finalResolutionAt,
                economics.settlementDeadline,
                lifecycle.lifecycleNonce,
                lifecycle.status,
                lifecycle.terminalOutcomeReference
            )
        );
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
        if (
            lifecycle.status != PositionStatus.Live || Lots.unwrap(lifecycle.remainingLots) == 0
                || kind == LifecycleActionKind.Unspecified
        ) return false;
        SeriesVersion memory series =
            _seriesRegistry.getSeries(_economics[positionId].seriesId, _economics[positionId].seriesVersion);
        if (kind == LifecycleActionKind.Exercise) {
            return ExercisePolicyId.unwrap(series.definition.exercisePolicyId)
                    == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)
                && block.timestamp >= series.definition.exerciseOpensAt
                && block.timestamp <= series.definition.exerciseCutoffAt;
        }
        if (kind == LifecycleActionKind.Abandon) {
            return ExercisePolicyId.unwrap(series.definition.exercisePolicyId)
                    == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC_UNLESS_ABANDONED)
                && block.timestamp >= series.definition.exerciseOpensAt
                && block.timestamp <= series.definition.exerciseCutoffAt;
        }
        if (kind == LifecycleActionKind.Lapse) {
            return ExercisePolicyId.unwrap(series.definition.exercisePolicyId)
                    == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION)
                && block.timestamp > series.definition.exerciseCutoffAt;
        }
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
                uint8(lifecycle.exerciseState),
                lifecycle.finalFixingReference,
                lifecycle.finalFixingsHash,
                lifecycle.terminalOutcomeReference,
                lifecycle.terminalTransferMinor,
                lifecycle.remainingLots,
                lifecycle.exercisedLots,
                lifecycle.closedLots,
                lifecycle.lifecycleOwnerAccountId,
                lifecycle.ownerNonce,
                lifecycle.lifecycleNonce
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
        snapshot.positionId = positionId;
        snapshot.immutableHash = immutableHash;
        snapshot.lifecycleHash = lifecycleHash;
        snapshot.seriesId = economics.seriesId;
        snapshot.seriesVersion = economics.seriesVersion;
        snapshot.longAccountId = economics.longAccountId;
        snapshot.shortAccountId = economics.shortAccountId;
        snapshot.riskDomainId = economics.riskDomainId;
        snapshot.riskDomainVersion = economics.riskDomainVersion;
        snapshot.feeScheduleId = economics.feeScheduleId;
        snapshot.feeScheduleVersion = economics.feeScheduleVersion;
        snapshot.collateralId = collateralId;
        snapshot.positionLots = lifecycle.remainingLots;
        snapshot.remainingExerciseLots = lifecycle.remainingLots;
        snapshot.entryPriceTicks = economics.entryPriceTicks;
        snapshot.economicsHash = economicsHash;
        snapshot.packageProvenanceHash = economics.packageProvenanceHash;
        snapshot.exercisePolicyId = series.definition.exercisePolicyId;
        snapshot.exerciseState = lifecycle.exerciseState;
        snapshot.automaticExerciseThresholdMinor = economics.automaticExerciseThresholdMinor;
        snapshot.expiryAt = series.definition.expiryAt;
        snapshot.exerciseOpensAt = series.definition.exerciseOpensAt;
        snapshot.exerciseCutoffAt = series.definition.exerciseCutoffAt;
        snapshot.lapseEligibleAt = series.definition.exerciseCutoffAt;
        (snapshot.longTerminalLiabilityBaseUnits, snapshot.shortTerminalLiabilityBaseUnits) =
            _currentLiabilityBounds(economics, lifecycle);
    }

    function _currentLiabilityBounds(PositionEconomics storage economics, PositionLifecycle storage lifecycle)
        private
        view
        returns (uint128 longLiability, uint128 shortLiability)
    {
        uint256 remaining = Lots.unwrap(lifecycle.remainingLots);
        uint256 longBound = uint256(economics.maxLongDebitMinorPerLot) * remaining;
        uint256 shortBound = uint256(economics.maxShortDebitMinorPerLot) * remaining;
        if (lifecycle.terminalTransferMinor < 0) longBound += uint256(-lifecycle.terminalTransferMinor);
        if (lifecycle.terminalTransferMinor > 0) shortBound += uint256(lifecycle.terminalTransferMinor);
        if (longBound > type(uint128).max || shortBound > type(uint128).max) {
            revert TerminalAmountOverflow(longBound > shortBound ? longBound : shortBound);
        }
        return (uint128(longBound), uint128(shortBound));
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
                    economics.exerciseOpensAt,
                    economics.exerciseCutoffAt,
                    economics.exercisePolicyId,
                    economics.automaticExerciseThresholdMinor,
                    economics.originalLots,
                    economics.entryPriceTicks,
                    economics.maxLongDebitMinorPerLot,
                    economics.maxShortDebitMinorPerLot,
                    economics.maxLongDebitMinor,
                    economics.maxShortDebitMinor,
                    economics.terminalDisruptionTransferMinorPerLot
                ),
                abi.encode(
                    economics.packageId,
                    economics.packageVersion,
                    economics.packageOrdinal,
                    economics.packageProvenanceHash
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
        TerminalLiabilityReservationId expected =
            _collateralVault.deriveTerminalLiabilityReservationId(address(this), positionEngineId, liabilityKey);
        if (CollateralLockId.unwrap(funding.lockId) == bytes32(0)) {
            if (!_isEmptyFunding(funding)) revert PositionFundingMismatch(liabilityKey, funding.lockId);
            if (
                _collateralVault.terminalLiabilityReservationStatusOf(expected)
                    == TerminalLiabilityReservationStatus.Active
            ) {
                reservationId = expected;
            } else {
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
            }
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
                || RiskDomainId.unwrap(reservation.riskDomainId) != RiskDomainId.unwrap(market.definition.riskDomainId)
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

    function _evaluatePayoff(
        PositionId positionId,
        PositionEconomics storage economics,
        bytes calldata finalFixings,
        uint128 lots
    ) private view returns (int256 terminalTransferMinor) {
        bytes32 actualCodeHash = economics.payoffModule.codehash;
        if (actualCodeHash != economics.payoffModuleCodeHash) {
            revert PayoffModuleRuntimeMismatch(economics.payoffModule, economics.payoffModuleCodeHash, actualCodeHash);
        }

        bytes memory payload = abi.encodeCall(
            IExactLotsPayoffModuleV1.evaluatePositionLots, (_payoffTerms[positionId], finalFixings, lots)
        );
        bytes4 selector = IExactLotsPayoffModuleV1.evaluatePositionLots.selector;
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
        terminalTransferMinor = abi.decode(returnData, (int256));
        uint256 longMaximum = uint256(economics.maxLongDebitMinorPerLot) * lots;
        uint256 shortMaximum = uint256(economics.maxShortDebitMinorPerLot) * lots;
        if (
            longMaximum > uint256(type(int256).max) || shortMaximum > uint256(type(int256).max)
                || terminalTransferMinor < -int256(longMaximum) || terminalTransferMinor > int256(shortMaximum)
        ) {
            revert PayoffOutsideDebitBounds(
                terminalTransferMinor, economics.maxLongDebitMinorPerLot, economics.maxShortDebitMinorPerLot
            );
        }
    }

    function _readExactLotsCapability(address implementation, uint64 gasLimit)
        private
        view
        returns (bytes32 capability)
    {
        bytes memory payload = abi.encodeCall(IExactLotsPayoffModuleV1.exactLotsCapability, ());
        bool success;
        uint256 returnLength;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, implementation, add(payload, 0x20), mload(payload), 0, 0)
            returnLength := returndatasize()
        }
        if (!success || returnLength != 32) return bytes32(0);
        assembly ("memory-safe") {
            returndatacopy(0x00, 0, 32)
            capability := mload(0x00)
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

    function _validateProvenance(PositionProvenance memory provenance) private pure {
        bool empty = PackageId.unwrap(provenance.packageId) == bytes32(0);
        if (empty) {
            if (
                provenance.packageVersion != 0 || provenance.packageOrdinal != 0
                    || provenance.packageProvenanceHash != bytes32(0)
            ) revert ZeroReference();
        } else {
            bytes32 expected = keccak256(
                abi.encode(
                    PACKAGE_PROVENANCE_TYPEHASH,
                    provenance.packageId,
                    provenance.packageVersion,
                    provenance.packageOrdinal
                )
            );
            if (provenance.packageVersion == 0 || provenance.packageProvenanceHash != expected) {
                revert ZeroReference();
            }
        }
    }

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

    function _requireDependency(address dependency) private view {
        if (dependency == address(0)) revert ZeroDependency(dependency);
        if (dependency.code.length == 0) revert DependencyHasNoCode(dependency);
    }
}
