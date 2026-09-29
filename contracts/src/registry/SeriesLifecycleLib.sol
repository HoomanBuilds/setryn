// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {SeriesId} from "../types/Identifiers.sol";
import {InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {SeriesDefinition, SeriesVersion} from "../types/SeriesDefinition.sol";
import {SeriesQualificationData} from "../types/SeriesQualification.sol";
import {SeriesRegistryDependencies} from "./SeriesRegistryTypes.sol";
import {SeriesValidationLib} from "./SeriesValidationLib.sol";
import {StorageSlot} from "@openzeppelin/contracts/utils/StorageSlot.sol";

/// Linked logic for the series registry: series registration and activation. Callers are authorized by the
/// registry before this runs through DELEGATECALL in its context against its storage.
library SeriesLifecycleLib {
    uint32 internal constant NO_VERSION = 0;

    function registerSeries(
        SeriesRegistryDependencies memory deps,
        mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) storage $versions,
        mapping(SeriesId seriesId => uint32 version) storage $latestVersion,
        mapping(SeriesId seriesId => mapping(bytes32 definitionHash => uint32 version)) storage $definitionVersion,
        bytes32 $seriesCountSlot,
        SeriesDefinition calldata definition,
        SeriesQualificationData calldata qualification
    ) external returns (SeriesId seriesId, uint32 version) {
        SeriesDefinitionLib.validate(definition);
        (MarketVersion memory market, InstrumentVersion memory instrument) =
            SeriesValidationLib.requireDependencies(deps, definition);
        SeriesDefinitionLib.validateQualificationData(definition, instrument.definition, qualification);
        SeriesValidationLib.validateDates(deps, market, qualification.dateProofs, false);
        SeriesValidationLib.validateCandidates(deps, market, qualification.fixingSlots, false);
        SeriesValidationLib.validatePayoff(deps, definition, market, instrument, qualification);
        SeriesValidationLib.validateRiskCaps(deps, definition, market);

        seriesId = SeriesDefinitionLib.deriveSeriesId(definition);
        bytes32 definitionHash = SeriesDefinitionLib.hashDefinition(definition, block.chainid);
        uint32 existingVersion = $definitionVersion[seriesId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert ISeriesRegistry.DuplicateSeriesDefinition(seriesId, definitionHash, existingVersion);
        }

        version = $latestVersion[seriesId];
        if (version == type(uint32).max) revert ISeriesRegistry.SeriesVersionExhausted(seriesId);
        version += 1;

        bytes32 versionHash = SeriesDefinitionLib.hashVersion(seriesId, version, definitionHash, block.chainid);
        _writeVersion(
            $versions,
            $latestVersion,
            $definitionVersion,
            $seriesCountSlot,
            definition,
            seriesId,
            version,
            definitionHash,
            versionHash
        );

        emit ISeriesRegistry.SeriesRegistered(
            seriesId, version, versionHash, definitionHash, definition, block.chainid, RegistryStatus.Paused, msg.sender
        );
        emit ISeriesRegistry.SeriesQualificationPublished(seriesId, version, qualification);
    }

    function activateSeries(
        SeriesRegistryDependencies memory deps,
        mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) storage $versions,
        mapping(SeriesId seriesId => uint32 version) storage $activeVersion,
        SeriesId seriesId,
        uint32 version,
        SeriesQualificationData calldata qualification
    ) external {
        SeriesVersion storage record = _requireVersion($versions, seriesId, version);
        _requireTransition(seriesId, version, record.status, RegistryStatus.Active);
        uint32 currentActive = $activeVersion[seriesId];
        if (currentActive != NO_VERSION) revert ISeriesRegistry.AnotherSeriesVersionActive(seriesId, currentActive);
        if (block.timestamp > record.definition.lastTradingAt) {
            revert ISeriesRegistry.SeriesTradingEnded(record.definition.lastTradingAt, block.timestamp);
        }

        SeriesDefinition memory definition = record.definition;
        (MarketVersion memory market, InstrumentVersion memory instrument) =
            SeriesValidationLib.requireDependencies(deps, definition);
        SeriesDefinitionLib.validateQualificationData(definition, instrument.definition, qualification);
        SeriesValidationLib.requireDependenciesOpen(deps, definition, _currentDay());
        SeriesValidationLib.validateDates(deps, market, qualification.dateProofs, true);
        SeriesValidationLib.validateCandidates(deps, market, qualification.fixingSlots, true);
        SeriesValidationLib.validatePayoff(deps, definition, market, instrument, qualification);
        SeriesValidationLib.validateRiskCaps(deps, definition, market);

        _setStatus(seriesId, version, record, RegistryStatus.Active);
        _setActiveVersion($activeVersion, seriesId, version);
    }

    function _writeVersion(
        mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) storage $versions,
        mapping(SeriesId seriesId => uint32 version) storage $latestVersion,
        mapping(SeriesId seriesId => mapping(bytes32 definitionHash => uint32 version)) storage $definitionVersion,
        bytes32 $seriesCountSlot,
        SeriesDefinition calldata definition,
        SeriesId seriesId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) internal {
        SeriesVersion storage record = $versions[seriesId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;
        $latestVersion[seriesId] = version;
        $definitionVersion[seriesId][definitionHash] = version;
        StorageSlot.getUint256Slot($seriesCountSlot).value += 1;
    }

    function _currentDay() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _setStatus(SeriesId seriesId, uint32 version, SeriesVersion storage record, RegistryStatus newStatus)
        internal
    {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;
        emit ISeriesRegistry.SeriesStatusChanged(seriesId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(
        mapping(SeriesId seriesId => uint32 version) storage $activeVersion,
        SeriesId seriesId,
        uint32 newVersion
    ) internal {
        uint32 previousVersion = $activeVersion[seriesId];
        $activeVersion[seriesId] = newVersion;
        emit ISeriesRegistry.SeriesActiveVersionChanged(seriesId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(
        mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) storage $versions,
        SeriesId seriesId,
        uint32 version
    ) internal view returns (SeriesVersion storage record) {
        record = $versions[seriesId][version];
        if (record.status == RegistryStatus.Unspecified) {
            revert ISeriesRegistry.UnknownSeriesVersion(seriesId, version);
        }
    }

    function _requireTransition(
        SeriesId seriesId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) internal pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert ISeriesRegistry.InvalidSeriesTransition(seriesId, version, previousStatus, newStatus);
        }
    }

    function _isPermittedTransition(RegistryStatus previousStatus, RegistryStatus newStatus)
        internal
        pure
        returns (bool)
    {
        if (newStatus == RegistryStatus.Paused) return previousStatus == RegistryStatus.Active;
        if (newStatus == RegistryStatus.Active) return previousStatus == RegistryStatus.Paused;
        if (newStatus == RegistryStatus.Deprecated) {
            return previousStatus == RegistryStatus.Active || previousStatus == RegistryStatus.Paused;
        }
        return false;
    }
}
