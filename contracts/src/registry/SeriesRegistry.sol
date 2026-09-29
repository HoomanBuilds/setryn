// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {SeriesId} from "../types/Identifiers.sol";
import {SeriesDefinition, SeriesVersion} from "../types/SeriesDefinition.sol";
import {FixingSlot, SeriesDateProof, SeriesQualificationData} from "../types/SeriesQualification.sol";

import {SeriesValidationLib} from "./SeriesValidationLib.sol";
import {SeriesLifecycleLib} from "./SeriesLifecycleLib.sol";
import {SeriesRegistryDependencies} from "./SeriesRegistryTypes.sol";

import {ISeriesRegistryLinkedErrors} from "./ISeriesRegistryLinkedErrors.sol";

contract SeriesRegistry is ISeriesRegistryLinkedErrors, ISeriesRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant SERIES_QUALIFIER_ROLE = keccak256("SETRYN_SERIES_QUALIFIER_ROLE");
    bytes32 public constant SERIES_STATUS_MANAGER_ROLE = keccak256("SETRYN_SERIES_STATUS_MANAGER_ROLE");

    uint32 private constant NO_VERSION = 0;

    IMarketRegistry private immutable _marketRegistry;
    IInstrumentRegistry private immutable _instrumentRegistry;

    mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) private _versions;
    mapping(SeriesId seriesId => uint32 version) private _latestVersion;
    mapping(SeriesId seriesId => uint32 version) private _activeVersion;
    mapping(SeriesId seriesId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;
    uint256 private _seriesCount;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IMarketRegistry marketRegistry_,
        IInstrumentRegistry instrumentRegistry_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        _requireRegistry(address(marketRegistry_));
        _requireRegistry(address(instrumentRegistry_));

        _marketRegistry = marketRegistry_;
        _instrumentRegistry = instrumentRegistry_;

        _grantRole(SERIES_QUALIFIER_ROLE, initialAdmin);
        _grantRole(SERIES_STATUS_MANAGER_ROLE, initialAdmin);
    }

    function registerSeries(SeriesDefinition calldata definition, SeriesQualificationData calldata qualification)
        external
        onlyRole(SERIES_QUALIFIER_ROLE)
        returns (SeriesId seriesId, uint32 version)
    {
        return SeriesLifecycleLib.registerSeries(
            _dependencies(),
            _versions,
            _latestVersion,
            _definitionVersion,
            _seriesCountSlot(),
            definition,
            qualification
        );
    }

    function activateSeries(SeriesId seriesId, uint32 version, SeriesQualificationData calldata qualification)
        external
        onlyRole(SERIES_STATUS_MANAGER_ROLE)
    {
        SeriesLifecycleLib.activateSeries(_dependencies(), _versions, _activeVersion, seriesId, version, qualification);
    }

    function pauseSeries(SeriesId seriesId, uint32 version) external onlyRole(SERIES_STATUS_MANAGER_ROLE) {
        _transition(seriesId, version, RegistryStatus.Paused);
    }

    function deprecateSeries(SeriesId seriesId, uint32 version) external onlyRole(SERIES_STATUS_MANAGER_ROLE) {
        _transition(seriesId, version, RegistryStatus.Deprecated);
    }

    function marketRegistry() external view returns (IMarketRegistry) {
        return _marketRegistry;
    }

    function instrumentRegistry() external view returns (IInstrumentRegistry) {
        return _instrumentRegistry;
    }

    function getSeries(SeriesId seriesId, uint32 version) external view returns (SeriesVersion memory) {
        return _requireVersion(seriesId, version);
    }

    function latestVersion(SeriesId seriesId) external view returns (uint32) {
        return _latestVersion[seriesId];
    }

    function activeVersion(SeriesId seriesId) external view returns (uint32) {
        return _activeVersion[seriesId];
    }

    function statusOf(SeriesId seriesId, uint32 version) external view returns (RegistryStatus) {
        return _versions[seriesId][version].status;
    }

    function seriesCount() external view returns (uint256) {
        return _seriesCount;
    }

    function exists(SeriesId seriesId, uint32 version) external view returns (bool) {
        return _versions[seriesId][version].status != RegistryStatus.Unspecified;
    }

    function isOpenForNewRisk(SeriesId seriesId, uint32 version, uint32 day) external view returns (bool) {
        SeriesVersion storage record = _versions[seriesId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[seriesId] != version) return false;
        if (block.timestamp < record.definition.tradingStartsAt || block.timestamp > record.definition.lastTradingAt) {
            return false;
        }
        return SeriesValidationLib.dependenciesOpen(_dependencies(), record.definition, day);
    }

    function isLifecycleEnabled(SeriesId seriesId, uint32 version) external view returns (bool) {
        return _versions[seriesId][version].status != RegistryStatus.Unspecified;
    }

    function deriveSeriesId(SeriesDefinition calldata definition) external pure returns (SeriesId) {
        return SeriesDefinitionLib.deriveSeriesId(definition);
    }

    function hashPayoffTerms(bytes32 termsSchemaHash, bytes calldata terms) external pure returns (bytes32) {
        return SeriesDefinitionLib.hashPayoffTerms(termsSchemaHash, terms);
    }

    function hashFixingSlots(SeriesDefinition calldata definition, FixingSlot[] calldata slots, uint16 maximumSlots)
        external
        pure
        returns (bytes32)
    {
        return SeriesDefinitionLib.hashFixingSlots(definition, slots, maximumSlots);
    }

    function hashDateProofs(SeriesDefinition calldata definition, SeriesDateProof[] calldata dateProofs)
        external
        pure
        returns (bytes32)
    {
        return SeriesDefinitionLib.hashDateProofs(definition, dateProofs);
    }

    function _transition(SeriesId seriesId, uint32 version, RegistryStatus newStatus) private {
        SeriesVersion storage record = _requireVersion(seriesId, version);
        _requireTransition(seriesId, version, record.status, newStatus);
        _setStatus(seriesId, version, record, newStatus);
        if (_activeVersion[seriesId] == version) _setActiveVersion(seriesId, NO_VERSION);
    }

    function _setStatus(SeriesId seriesId, uint32 version, SeriesVersion storage record, RegistryStatus newStatus)
        private
    {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;
        emit SeriesStatusChanged(seriesId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(SeriesId seriesId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[seriesId];
        _activeVersion[seriesId] = newVersion;
        emit SeriesActiveVersionChanged(seriesId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(SeriesId seriesId, uint32 version) private view returns (SeriesVersion storage record) {
        record = _versions[seriesId][version];
        if (record.status == RegistryStatus.Unspecified) revert UnknownSeriesVersion(seriesId, version);
    }

    function _requireTransition(
        SeriesId seriesId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidSeriesTransition(seriesId, version, previousStatus, newStatus);
        }
    }

    function _isPermittedTransition(RegistryStatus previousStatus, RegistryStatus newStatus)
        private
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

    function _requireRegistry(address dependency) private view {
        if (dependency == address(0)) revert ZeroRegistryDependency();
        if (dependency.code.length == 0) revert RegistryDependencyHasNoCode(dependency);
    }

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    /// Linked libraries execute in this contract's context and receive the immutable dependency graph explicitly.
    function _dependencies() private view returns (SeriesRegistryDependencies memory) {
        return SeriesRegistryDependencies({marketRegistry: _marketRegistry, instrumentRegistry: _instrumentRegistry});
    }

    function _seriesCountSlot() private pure returns (bytes32 slot) {
        assembly ("memory-safe") {
            slot := _seriesCount.slot
        }
    }

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
