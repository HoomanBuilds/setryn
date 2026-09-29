// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {IExactLotsPayoffModuleV1} from "../interfaces/IExactLotsPayoffModuleV1.sol";
import {PositionMathLib} from "../libraries/PositionMathLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {CollateralLock, TerminalLiabilityReservation} from "../types/CollateralTypes.sol";
import {LockStatus, TerminalLiabilityReservationStatus} from "../types/Enums.sol";
import {
    AccountId,
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
import {Lots, LotsLib} from "../types/Units.sol";

import {PositionEngineDependencies, LiabilityState, PositionInitializationContext} from "./PositionEngineTypes.sol";

/// Linked logic for the position engine: position initialization, liability staging, and funding locks.
/// Runs through DELEGATECALL in the position engine's context against its storage.
library PositionCreationLib {
    bytes32 internal constant EXACT_LOTS_CAPABILITY = keccak256("SETRYN_EXACT_LOTS_PAYOFF_V1");
    bytes32 internal constant LIABILITY_KEY_TYPEHASH =
        keccak256("SetrynPositionLiabilityV1(bytes32 positionId,uint8 side)");
    bytes32 internal constant PACKAGE_PROVENANCE_TYPEHASH =
        keccak256("SetrynPositionPackageProvenanceV1(bytes32 packageId,uint32 packageVersion,uint32 packageOrdinal)");
    bytes32 internal constant POSITION_ID_TYPEHASH = keccak256(
        "SetrynPositionIdV1(bytes32 positionEngineId,uint256 chainId,address positionEngine,bytes32 fillIdentity,bytes32 seriesId,uint32 seriesVersion,bytes32 longAccountId,bytes32 shortAccountId,uint32 ordinal)"
    );

    function createPositionFundingLock(
        PositionEngineDependencies memory deps,
        mapping(CollateralLockId lockId => address requester) storage $positionFundingRequesters,
        bytes32 lockReference,
        AccountId accountId,
        AssetId assetId,
        uint32 bindingVersion,
        uint128 amount,
        uint64 expiry
    ) external returns (CollateralLockId lockId) {
        if (lockReference == bytes32(0) || AccountId.unwrap(accountId) == bytes32(0) || amount == 0) {
            revert IPositionEngine.PositionFundingMismatch(bytes32(0), CollateralLockId.wrap(bytes32(0)));
        }
        lockId = deps.collateralVault
            .createLock(lockReference, accountId, assetId, bindingVersion, amount, expiry, address(this));
        CollateralLock memory lock = deps.collateralVault.getLock(lockId);
        CollateralId expectedCollateral = deps.collateralVault.deriveCollateralId(assetId, bindingVersion);
        if (
            CollateralLockId.unwrap(lockId)
                    != CollateralLockId.unwrap(deps.collateralVault.deriveLockId(address(this), lockReference))
                || lock.status != LockStatus.Active || lock.operator != address(this)
                || lock.settlementOperator != address(this) || lock.lockReference != lockReference
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(accountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(assetId) || lock.bindingVersion != bindingVersion
                || lock.initialAmount != amount || lock.remainingAmount != amount || lock.expiry != expiry
        ) revert IPositionEngine.PositionFundingMismatch(bytes32(0), lockId);
        $positionFundingRequesters[lockId] = msg.sender;
        emit IPositionEngine.PositionFundingLockCreated(
            lockId, lockReference, accountId, assetId, bindingVersion, amount, expiry, msg.sender
        );
    }

    function initializePosition(
        PositionEngineDependencies memory deps,
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        mapping(PositionId positionId => bytes terms) storage $payoffTerms,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        mapping(CollateralLockId lockId => address requester) storage $positionFundingRequesters,
        PositionCreation calldata creation,
        bool requireOpenForNewRisk,
        PositionProvenance memory provenance
    ) external returns (PositionId positionId) {
        _validateCreation(creation);
        _validateProvenance(provenance);
        positionId = _derivePositionId(deps, creation);
        if ($lifecycles[positionId].status != PositionStatus.Unspecified) {
            revert IPositionEngine.PositionAlreadyExists(positionId);
        }
        if (
            requireOpenForNewRisk
                && !deps.seriesRegistry.isOpenForNewRisk(creation.seriesId, creation.seriesVersion, _currentDay())
        ) {
            revert IPositionEngine.SeriesClosedForNewRisk(
                bytes32(SeriesId.unwrap(creation.seriesId)), creation.seriesVersion
            );
        }
        if (
            !requireOpenForNewRisk && !deps.seriesRegistry.isLifecycleEnabled(creation.seriesId, creation.seriesVersion)
        ) {
            revert IPositionEngine.SeriesClosedForNewRisk(
                bytes32(SeriesId.unwrap(creation.seriesId)), creation.seriesVersion
            );
        }
        PositionInitializationContext memory context =
            _preparePositionInitialization(deps, creation, positionId, provenance);
        _stagePositionLiabilities($liabilityStates, creation, context);
        context.longReservationId = _createReservation(
            deps,
            $liabilityStates,
            $positionFundingRequesters,
            context.longLiabilityKey,
            creation.longAccountId,
            context.market,
            context.longMaximum,
            creation.longFunding
        );
        context.shortReservationId = _createReservation(
            deps,
            $liabilityStates,
            $positionFundingRequesters,
            context.shortLiabilityKey,
            creation.shortAccountId,
            context.market,
            context.shortMaximum,
            creation.shortFunding
        );
        _storePositionEconomics($economics, creation, context);
        _storePositionLifecycle($lifecycles, creation, context);
        $payoffTerms[positionId] = creation.payoffTerms;
        _emitPositionCreated(creation, context);
    }

    function _preparePositionInitialization(
        PositionEngineDependencies memory deps,
        PositionCreation calldata creation,
        PositionId positionId,
        PositionProvenance memory provenance
    ) internal view returns (PositionInitializationContext memory context) {
        context.positionId = positionId;
        context.provenance = provenance;
        context.series = deps.seriesRegistry.getSeries(creation.seriesId, creation.seriesVersion);
        context.market =
            deps.marketRegistry.getMarket(context.series.definition.marketId, context.series.definition.marketVersion);
        context.instrument = deps.instrumentRegistry
            .getInstrument(context.series.definition.instrumentId, context.series.definition.instrumentVersion);
        context.termsHash =
            deps.seriesRegistry.hashPayoffTerms(context.instrument.definition.termsSchemaHash, creation.payoffTerms);
        if (context.termsHash != context.series.definition.payoffTermsHash) {
            revert IPositionEngine.PayoffTermsHashMismatch(context.series.definition.payoffTermsHash, context.termsHash);
        }
        AdapterVersion memory adapter = deps.adapterRegistry
            .getAdapter(context.instrument.definition.payoffModuleId, context.instrument.definition.payoffModuleVersion);
        context.payoffModule = adapter.definition.implementation;
        context.payoffModuleCodeHash = context.payoffModule.codehash;
        if (
            !deps.adapterRegistry
                    .runtimeMatches(
                        context.instrument.definition.payoffModuleId, context.instrument.definition.payoffModuleVersion
                    ) || context.payoffModuleCodeHash != adapter.definition.expectedRuntimeCodeHash
        ) {
            revert IPositionEngine.PayoffModuleRuntimeMismatch(
                context.payoffModule, adapter.definition.expectedRuntimeCodeHash, context.payoffModuleCodeHash
            );
        }
        bytes32 exactLotsCapability =
            _readExactLotsCapability(context.payoffModule, context.instrument.definition.maxEvaluationGas);
        if (exactLotsCapability != EXACT_LOTS_CAPABILITY) {
            revert IPositionEngine.ExactLotsCapabilityMismatch(context.payoffModule, exactLotsCapability);
        }
        context.longMaximum =
            PositionMathLib.checkedAmount(context.series.definition.maxLongDebitMinorPerLot, creation.lots);
        context.shortMaximum =
            PositionMathLib.checkedAmount(context.series.definition.maxShortDebitMinorPerLot, creation.lots);
        context.longLiabilityKey = _deriveLiabilityKey(positionId, PositionLiabilitySide.Long);
        context.shortLiabilityKey = _deriveLiabilityKey(positionId, PositionLiabilitySide.Short);
    }

    function _stagePositionLiabilities(
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        PositionCreation calldata creation,
        PositionInitializationContext memory context
    ) internal {
        _stageLiability(
            $liabilityStates,
            context.longLiabilityKey,
            context.positionId,
            PositionLiabilitySide.Long,
            creation.longAccountId,
            context.series.definition.settlementDeadline,
            context.series.definition.finalResolutionAt
        );
        _stageLiability(
            $liabilityStates,
            context.shortLiabilityKey,
            context.positionId,
            PositionLiabilitySide.Short,
            creation.shortAccountId,
            context.series.definition.settlementDeadline,
            context.series.definition.finalResolutionAt
        );
    }

    function _storePositionEconomics(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        PositionCreation calldata creation,
        PositionInitializationContext memory context
    ) internal {
        PositionEconomics storage economics = $economics[context.positionId];
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

    function _storePositionLifecycle(
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        PositionCreation calldata creation,
        PositionInitializationContext memory context
    ) internal {
        PositionLifecycle storage lifecycle = $lifecycles[context.positionId];
        lifecycle.status = PositionStatus.Live;
        lifecycle.exerciseState = ExercisePolicyId.unwrap(context.series.definition.exercisePolicyId)
            == ExercisePolicyId.unwrap(SeriesDefinitionLib.EXERCISE_POLICY_AUTOMATIC)
            ? PositionExerciseState.AwaitingFixing
            : PositionExerciseState.ElectionOpen;
        lifecycle.remainingLots = creation.lots;
        lifecycle.lifecycleOwnerAccountId = creation.longAccountId;
    }

    function _emitPositionCreated(PositionCreation calldata creation, PositionInitializationContext memory context)
        internal
    {
        emit IPositionEngine.PositionCreated(
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

    function _createReservation(
        PositionEngineDependencies memory deps,
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        mapping(CollateralLockId lockId => address requester) storage $positionFundingRequesters,
        bytes32 liabilityKey,
        AccountId payerAccountId,
        MarketVersion memory market,
        uint128 amount,
        PositionFunding calldata funding
    ) internal returns (TerminalLiabilityReservationId reservationId) {
        if (amount == 0) {
            if (!_isEmptyFunding(funding)) {
                revert IPositionEngine.UnexpectedPositionFunding(liabilityKey, funding.lockId);
            }
            return TerminalLiabilityReservationId.wrap(bytes32(0));
        }
        TerminalLiabilityReservationId expected = deps.collateralVault
        .deriveTerminalLiabilityReservationId(address(this), deps.positionEngineId, liabilityKey);
        if (CollateralLockId.unwrap(funding.lockId) == bytes32(0)) {
            if (!_isEmptyFunding(funding)) {
                revert IPositionEngine.PositionFundingMismatch(liabilityKey, funding.lockId);
            }
            if (
                deps.collateralVault.terminalLiabilityReservationStatusOf(expected)
                    == TerminalLiabilityReservationStatus.Active
            ) {
                reservationId = expected;
            } else {
                reservationId = deps.collateralVault
                    .createTerminalLiabilityReservation(
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
            _requireAdoptableFunding(deps, liabilityKey, payerAccountId, market, amount, funding);
            reservationId = deps.collateralVault
                .convertLockToTerminalLiabilityReservation(
                    funding.lockId,
                    liabilityKey,
                    market.definition.riskDomainId,
                    market.definition.riskDomainVersion,
                    amount
                );
            if (funding.expectedRemainingAmount == amount) delete $positionFundingRequesters[funding.lockId];
        }
        if (TerminalLiabilityReservationId.unwrap(reservationId) != TerminalLiabilityReservationId.unwrap(expected)) {
            revert IPositionEngine.ReservationMismatch(
                liabilityKey,
                TerminalLiabilityReservationId.unwrap(expected),
                TerminalLiabilityReservationId.unwrap(reservationId)
            );
        }
        TerminalLiabilityReservation memory reservation =
            deps.collateralVault.terminalLiabilityReservationOf(reservationId);
        if (
            reservation.positionId != liabilityKey
                || AccountId.unwrap(reservation.payerAccountId) != AccountId.unwrap(payerAccountId)
                || reservation.positionEngine != address(this) || reservation.positionEngineId != deps.positionEngineId
                || AssetId.unwrap(reservation.assetId) != AssetId.unwrap(market.definition.settlementAssetId)
                || reservation.bindingVersion != market.definition.settlementAssetVersion
                || RiskDomainId.unwrap(reservation.riskDomainId) != RiskDomainId.unwrap(market.definition.riskDomainId)
                || reservation.riskDomainVersion != market.definition.riskDomainVersion
                || reservation.settlementDeadline != _liabilityDeadline($liabilityStates, liabilityKey, true)
                || reservation.finalResolutionAt != _liabilityDeadline($liabilityStates, liabilityKey, false)
                || reservation.initialAmount != amount || reservation.remainingAmount != amount
                || reservation.status != TerminalLiabilityReservationStatus.Active
        ) revert IPositionEngine.ReservationRecordMismatch(TerminalLiabilityReservationId.unwrap(reservationId));
    }

    function _requireAdoptableFunding(
        PositionEngineDependencies memory deps,
        bytes32 liabilityKey,
        AccountId payerAccountId,
        MarketVersion memory market,
        uint128 amount,
        PositionFunding calldata funding
    ) internal view {
        CollateralLock memory lock = deps.collateralVault.getLock(funding.lockId);
        CollateralId expectedCollateral = deps.collateralVault
            .deriveCollateralId(market.definition.settlementAssetId, market.definition.settlementAssetVersion);
        if (
            funding.lockReference == bytes32(0) || funding.expectedRemainingAmount < amount
                || funding.expectedExpiry <= block.timestamp || lock.status != LockStatus.Active
                || lock.operator != address(this) || lock.settlementOperator != address(this)
                || lock.lockReference != funding.lockReference
                || CollateralLockId.unwrap(funding.lockId)
                    != CollateralLockId.unwrap(deps.collateralVault.deriveLockId(address(this), funding.lockReference))
                || AccountId.unwrap(lock.accountId) != AccountId.unwrap(payerAccountId)
                || CollateralId.unwrap(lock.collateralId) != CollateralId.unwrap(expectedCollateral)
                || AssetId.unwrap(lock.assetId) != AssetId.unwrap(market.definition.settlementAssetId)
                || lock.bindingVersion != market.definition.settlementAssetVersion
                || lock.remainingAmount != funding.expectedRemainingAmount || lock.expiry != funding.expectedExpiry
        ) revert IPositionEngine.PositionFundingMismatch(liabilityKey, funding.lockId);
    }

    function _isEmptyFunding(PositionFunding calldata funding) internal pure returns (bool) {
        return CollateralLockId.unwrap(funding.lockId) == bytes32(0) && funding.lockReference == bytes32(0)
            && funding.expectedRemainingAmount == 0 && funding.expectedExpiry == 0;
    }

    function _liabilityDeadline(
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        bytes32 liabilityKey,
        bool settlement
    ) internal view returns (uint64) {
        LiabilityState storage liability = $liabilityStates[liabilityKey];
        return settlement ? liability.settlementDeadline : liability.finalResolutionAt;
    }

    function _readExactLotsCapability(address implementation, uint64 gasLimit)
        internal
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

    function _stageLiability(
        mapping(bytes32 liabilityKey => LiabilityState state) storage $liabilityStates,
        bytes32 liabilityKey,
        PositionId positionId,
        PositionLiabilitySide side,
        AccountId payerAccountId,
        uint64 settlementDeadline,
        uint64 finalResolutionAt
    ) internal {
        LiabilityState storage liability = $liabilityStates[liabilityKey];
        liability.positionId = positionId;
        liability.side = side;
        liability.payerAccountId = payerAccountId;
        liability.settlementDeadline = settlementDeadline;
        liability.finalResolutionAt = finalResolutionAt;
        liability.exists = true;
    }

    function _validateCreation(PositionCreation calldata creation) internal pure {
        if (creation.fillIdentity == bytes32(0)) revert IPositionEngine.ZeroFillIdentity();
        if (
            AccountId.unwrap(creation.longAccountId) == bytes32(0)
                || AccountId.unwrap(creation.shortAccountId) == bytes32(0)
        ) revert IPositionEngine.ZeroAccount();
        if (AccountId.unwrap(creation.longAccountId) == AccountId.unwrap(creation.shortAccountId)) {
            revert IPositionEngine.IdenticalPositionAccounts();
        }
        if (LotsLib.isZero(creation.lots)) revert IPositionEngine.ZeroLots();
    }

    function _validateProvenance(PositionProvenance memory provenance) internal pure {
        bool empty = PackageId.unwrap(provenance.packageId) == bytes32(0);
        if (empty) {
            if (
                provenance.packageVersion != 0 || provenance.packageOrdinal != 0
                    || provenance.packageProvenanceHash != bytes32(0)
            ) revert IPositionEngine.ZeroReference();
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
                revert IPositionEngine.ZeroReference();
            }
        }
    }

    function _derivePositionId(PositionEngineDependencies memory deps, PositionCreation calldata creation)
        internal
        view
        returns (PositionId)
    {
        return PositionId.wrap(
            keccak256(
                abi.encode(
                    POSITION_ID_TYPEHASH,
                    deps.positionEngineId,
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

    function _deriveLiabilityKey(PositionId positionId, PositionLiabilitySide side) internal pure returns (bytes32) {
        return keccak256(abi.encode(LIABILITY_KEY_TYPEHASH, PositionId.unwrap(positionId), uint8(side)));
    }

    function _currentDay() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }
}
