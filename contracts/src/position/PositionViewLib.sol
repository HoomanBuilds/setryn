// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IPositionEngine} from "../interfaces/IPositionEngine.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {AccountId, CollateralId, ExercisePolicyId, PositionId} from "../types/Identifiers.sol";
import {PositionEconomics, PositionLifecycle, PositionStatus} from "../types/PositionTypes.sol";
import {LifecycleActionKind, LifecyclePositionSnapshot} from "../types/LifecycleTypes.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots} from "../types/Units.sol";
import {PortfolioPositionWitness, PositionRiskSnapshot} from "../types/RiskTypes.sol";

import {PositionEngineDependencies} from "./PositionEngineTypes.sol";

/// Linked read logic for the position engine: risk snapshots, lifecycle and compression views, and hashes.
/// Runs through DELEGATECALL in the position engine's context against its storage.
library PositionViewLib {
    bytes32 internal constant POSITION_ECONOMICS_HASH_TYPEHASH = keccak256("SetrynPositionEconomicsHashV1");
    bytes32 internal constant POSITION_IMMUTABLE_HASH_TYPEHASH = keccak256("SetrynPositionImmutableHashV1");
    bytes32 internal constant POSITION_LIFECYCLE_HASH_TYPEHASH = keccak256("SetrynPositionLifecycleHashV1");
    bytes32 internal constant RISK_SNAPSHOT_TYPEHASH = keccak256("SetrynPositionRiskSnapshotV1");

    function positionRiskSnapshot(
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(
            PositionId positionId => PositionLifecycle lifecycle
        ) storage $lifecycles,
        PositionId positionId,
        AccountId accountId
    ) external view returns (PositionRiskSnapshot memory snapshot) {
        _requirePositionView($lifecycles, positionId);
        PositionEconomics storage economics = $economics[positionId];
        PositionLifecycle storage lifecycle = $lifecycles[positionId];
        bool isLong = AccountId.unwrap(economics.longAccountId) == AccountId.unwrap(accountId);
        if (!isLong && AccountId.unwrap(economics.shortAccountId) != AccountId.unwrap(accountId)) {
            revert IPositionEngine.PositionRiskAccountMismatch(positionId, accountId);
        }
        uint128 remaining = Lots.unwrap(lifecycle.remainingLots);
        if (remaining > uint128(type(int128).max)) {
            revert IPositionEngine.PositionRiskLotsOverflow(positionId, remaining);
        }
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

    function isLifecycleActionEligible(
        PositionEngineDependencies memory deps,
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        PositionId positionId,
        LifecycleActionKind kind
    ) external view returns (bool) {
        PositionLifecycle storage lifecycle = $lifecycles[positionId];
        if (
            lifecycle.status != PositionStatus.Live || Lots.unwrap(lifecycle.remainingLots) == 0
                || kind == LifecycleActionKind.Unspecified
        ) return false;
        SeriesVersion memory series =
            deps.seriesRegistry.getSeries($economics[positionId].seriesId, $economics[positionId].seriesVersion);
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

    function _riskWitness(
        PositionId positionId,
        PositionEconomics storage economics,
        PositionLifecycle storage lifecycle,
        bool isLong,
        uint128 remaining
    ) internal view returns (PortfolioPositionWitness memory witness) {
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
    ) internal view returns (uint128) {
        (uint128 longLiability, uint128 shortLiability) = _currentLiabilityBounds(economics, lifecycle);
        return isLong ? longLiability : shortLiability;
    }

    function _riskStateHash(
        PortfolioPositionWitness memory witness,
        AccountId accountId,
        PositionEconomics storage economics,
        PositionLifecycle storage lifecycle,
        uint128 remaining
    ) internal view returns (bytes32) {
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

    function lifecycleSnapshot(
        PositionEngineDependencies memory deps,
        mapping(PositionId positionId => PositionEconomics economics) storage $economics,
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        mapping(PositionId positionId => bytes terms) storage $payoffTerms,
        PositionId positionId
    ) external view returns (LifecyclePositionSnapshot memory snapshot) {
        _requirePositionView($lifecycles, positionId);
        PositionEconomics storage economics = $economics[positionId];
        PositionLifecycle storage lifecycle = $lifecycles[positionId];
        SeriesVersion memory series = deps.seriesRegistry.getSeries(economics.seriesId, economics.seriesVersion);
        CollateralId collateralId =
            deps.collateralVault.deriveCollateralId(economics.settlementAssetId, economics.settlementAssetVersion);
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
                deps.positionEngineId,
                PositionId.unwrap(positionId),
                economicsHash,
                economics.longAccountId,
                economics.shortAccountId,
                economics.longReservationId,
                economics.shortReservationId,
                keccak256($payoffTerms[positionId])
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
        internal
        view
        returns (uint128 longLiability, uint128 shortLiability)
    {
        uint256 remaining = Lots.unwrap(lifecycle.remainingLots);
        uint256 longBound = uint256(economics.maxLongDebitMinorPerLot) * remaining;
        uint256 shortBound = uint256(economics.maxShortDebitMinorPerLot) * remaining;
        if (lifecycle.terminalTransferMinor < 0) longBound += uint256(-lifecycle.terminalTransferMinor);
        if (lifecycle.terminalTransferMinor > 0) shortBound += uint256(lifecycle.terminalTransferMinor);
        if (longBound > type(uint128).max || shortBound > type(uint128).max) {
            revert IPositionEngine.TerminalAmountOverflow(longBound > shortBound ? longBound : shortBound);
        }
        return (uint128(longBound), uint128(shortBound));
    }

    function _economicsHash(PositionEconomics storage economics) internal view returns (bytes32) {
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

    function _requirePositionView(
        mapping(PositionId positionId => PositionLifecycle lifecycle) storage $lifecycles,
        PositionId positionId
    ) internal view {
        if ($lifecycles[positionId].status == PositionStatus.Unspecified) {
            revert IPositionEngine.UnknownPosition(positionId);
        }
    }
}
