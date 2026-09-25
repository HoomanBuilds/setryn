// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IAdapterRegistry} from "../interfaces/IAdapterRegistry.sol";
import {IInstrumentRegistry} from "../interfaces/IInstrumentRegistry.sol";
import {AdapterDefinitionLib} from "../libraries/AdapterDefinitionLib.sol";
import {InstrumentDefinitionLib} from "../libraries/InstrumentDefinitionLib.sol";
import {AdapterVersion} from "../types/AdapterDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AdapterId, AdapterKindId, InstrumentId} from "../types/Identifiers.sol";
import {InstrumentDefinition, InstrumentVersion} from "../types/InstrumentDefinition.sol";

contract InstrumentRegistry is IInstrumentRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant INSTRUMENT_QUALIFIER_ROLE = keccak256("SETRYN_INSTRUMENT_QUALIFIER_ROLE");
    bytes32 public constant INSTRUMENT_STATUS_MANAGER_ROLE = keccak256("SETRYN_INSTRUMENT_STATUS_MANAGER_ROLE");

    uint32 private constant NO_VERSION = 0;

    IAdapterRegistry private immutable _adapterRegistry;
    uint64 private immutable _evaluationGasHardCap;

    mapping(InstrumentId instrumentId => mapping(uint32 version => InstrumentVersion record)) private _versions;
    mapping(InstrumentId instrumentId => uint32 version) private _latestVersion;
    mapping(InstrumentId instrumentId => uint32 version) private _activeVersion;
    mapping(InstrumentId instrumentId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;
    uint256 private _instrumentCount;

    constructor(
        uint48 defaultAdminDelay,
        address initialAdmin,
        IAdapterRegistry adapterRegistry_,
        uint64 evaluationGasHardCap_
    ) AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin)) {
        if (address(adapterRegistry_) == address(0)) revert ZeroAdapterRegistry();
        if (address(adapterRegistry_).code.length == 0) {
            revert AdapterRegistryHasNoCode(address(adapterRegistry_));
        }
        if (evaluationGasHardCap_ == 0) revert ZeroEvaluationGasHardCap();

        _adapterRegistry = adapterRegistry_;
        _evaluationGasHardCap = evaluationGasHardCap_;
        _grantRole(INSTRUMENT_QUALIFIER_ROLE, initialAdmin);
        _grantRole(INSTRUMENT_STATUS_MANAGER_ROLE, initialAdmin);
    }

    function registerInstrument(InstrumentDefinition calldata definition)
        external
        onlyRole(INSTRUMENT_QUALIFIER_ROLE)
        returns (InstrumentId instrumentId, uint32 version)
    {
        InstrumentDefinitionLib.validate(definition, _evaluationGasHardCap);
        _requireCompatiblePayoffModule(definition);

        instrumentId = InstrumentDefinitionLib.deriveInstrumentId(definition);
        bytes32 definitionHash = InstrumentDefinitionLib.hashDefinition(definition, block.chainid);
        uint32 existingVersion = _definitionVersion[instrumentId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicateInstrumentDefinition(instrumentId, definitionHash, existingVersion);
        }

        version = _latestVersion[instrumentId];
        if (version == type(uint32).max) revert InstrumentVersionExhausted(instrumentId);
        version += 1;

        bytes32 versionHash = InstrumentDefinitionLib.hashVersion(instrumentId, version, definitionHash, block.chainid);
        _writeVersion(definition, instrumentId, version, definitionHash, versionHash);

        emit InstrumentRegistered(
            instrumentId,
            version,
            versionHash,
            definitionHash,
            definition,
            block.chainid,
            RegistryStatus.Paused,
            msg.sender
        );
    }

    function activateInstrument(InstrumentId instrumentId, uint32 version)
        external
        onlyRole(INSTRUMENT_STATUS_MANAGER_ROLE)
    {
        InstrumentVersion storage record = _requireVersion(instrumentId, version);
        _requireTransition(instrumentId, version, record.status, RegistryStatus.Active);
        uint32 currentActive = _activeVersion[instrumentId];
        if (currentActive != NO_VERSION) revert AnotherInstrumentVersionActive(instrumentId, currentActive);

        _requireCompatiblePayoffModule(record.definition);
        if (!_adapterRegistry.isOpenForNewRisk(record.definition.payoffModuleId, record.definition.payoffModuleVersion))
        {
            revert PayoffModuleDependencyNotOpen(
                record.definition.payoffModuleId, record.definition.payoffModuleVersion
            );
        }

        _setStatus(instrumentId, version, record, RegistryStatus.Active);
        _setActiveVersion(instrumentId, version);
    }

    function pauseInstrument(InstrumentId instrumentId, uint32 version)
        external
        onlyRole(INSTRUMENT_STATUS_MANAGER_ROLE)
    {
        _transition(instrumentId, version, RegistryStatus.Paused);
    }

    function deprecateInstrument(InstrumentId instrumentId, uint32 version)
        external
        onlyRole(INSTRUMENT_STATUS_MANAGER_ROLE)
    {
        _transition(instrumentId, version, RegistryStatus.Deprecated);
    }

    function adapterRegistry() external view returns (IAdapterRegistry) {
        return _adapterRegistry;
    }

    function evaluationGasHardCap() external view returns (uint64) {
        return _evaluationGasHardCap;
    }

    function getInstrument(InstrumentId instrumentId, uint32 version) external view returns (InstrumentVersion memory) {
        return _requireVersion(instrumentId, version);
    }

    function latestVersion(InstrumentId instrumentId) external view returns (uint32) {
        return _latestVersion[instrumentId];
    }

    function activeVersion(InstrumentId instrumentId) external view returns (uint32) {
        return _activeVersion[instrumentId];
    }

    function statusOf(InstrumentId instrumentId, uint32 version) external view returns (RegistryStatus) {
        return _versions[instrumentId][version].status;
    }

    function instrumentCount() external view returns (uint256) {
        return _instrumentCount;
    }

    function exists(InstrumentId instrumentId, uint32 version) external view returns (bool) {
        return _versions[instrumentId][version].status != RegistryStatus.Unspecified;
    }

    function isOpenForNewRisk(InstrumentId instrumentId, uint32 version) external view returns (bool) {
        InstrumentVersion storage record = _versions[instrumentId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[instrumentId] != version) return false;
        if (!_payoffModuleCompatible(record.definition)) return false;
        return
            _adapterRegistry.isOpenForNewRisk(record.definition.payoffModuleId, record.definition.payoffModuleVersion);
    }

    function isLifecycleEnabled(InstrumentId instrumentId, uint32 version) external view returns (bool) {
        return _versions[instrumentId][version].status != RegistryStatus.Unspecified;
    }

    function deriveInstrumentId(InstrumentDefinition calldata definition) external pure returns (InstrumentId) {
        return InstrumentDefinitionLib.deriveInstrumentId(definition);
    }

    function _requireCompatiblePayoffModule(InstrumentDefinition memory definition) private view {
        AdapterId adapterId = definition.payoffModuleId;
        uint32 adapterVersion = definition.payoffModuleVersion;
        if (!_adapterRegistry.exists(adapterId, adapterVersion)) {
            revert UnknownPayoffModuleDependency(adapterId, adapterVersion);
        }

        AdapterVersion memory record = _adapterRegistry.getAdapter(adapterId, adapterVersion);
        if (AdapterKindId.unwrap(record.definition.kindId) != AdapterKindId.unwrap(definition.requiredAdapterKindId)) {
            revert PayoffModuleKindMismatch(
                adapterId, adapterVersion, definition.requiredAdapterKindId, record.definition.kindId
            );
        }
        if (record.definition.interfaceHash != definition.requiredInterfaceHash) {
            revert PayoffModuleInterfaceMismatch(
                adapterId, adapterVersion, definition.requiredInterfaceHash, record.definition.interfaceHash
            );
        }
        if (record.definition.capabilityHash != definition.requiredCapabilityHash) {
            revert PayoffModuleCapabilityMismatch(
                adapterId, adapterVersion, definition.requiredCapabilityHash, record.definition.capabilityHash
            );
        }
    }

    function _payoffModuleCompatible(InstrumentDefinition storage definition) private view returns (bool) {
        if (!_adapterRegistry.exists(definition.payoffModuleId, definition.payoffModuleVersion)) return false;
        AdapterVersion memory record =
            _adapterRegistry.getAdapter(definition.payoffModuleId, definition.payoffModuleVersion);
        return AdapterKindId.unwrap(record.definition.kindId) == AdapterKindId.unwrap(definition.requiredAdapterKindId)
            && record.definition.interfaceHash == definition.requiredInterfaceHash
            && record.definition.capabilityHash == definition.requiredCapabilityHash;
    }

    function _writeVersion(
        InstrumentDefinition calldata definition,
        InstrumentId instrumentId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        InstrumentVersion storage record = _versions[instrumentId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;
        _latestVersion[instrumentId] = version;
        _definitionVersion[instrumentId][definitionHash] = version;
        _instrumentCount += 1;
    }

    function _transition(InstrumentId instrumentId, uint32 version, RegistryStatus newStatus) private {
        InstrumentVersion storage record = _requireVersion(instrumentId, version);
        _requireTransition(instrumentId, version, record.status, newStatus);
        _setStatus(instrumentId, version, record, newStatus);
        if (_activeVersion[instrumentId] == version) _setActiveVersion(instrumentId, NO_VERSION);
    }

    function _setStatus(
        InstrumentId instrumentId,
        uint32 version,
        InstrumentVersion storage record,
        RegistryStatus newStatus
    ) private {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;
        emit InstrumentStatusChanged(instrumentId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(InstrumentId instrumentId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[instrumentId];
        _activeVersion[instrumentId] = newVersion;
        emit InstrumentActiveVersionChanged(instrumentId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(InstrumentId instrumentId, uint32 version)
        private
        view
        returns (InstrumentVersion storage record)
    {
        record = _versions[instrumentId][version];
        if (record.status == RegistryStatus.Unspecified) revert UnknownInstrumentVersion(instrumentId, version);
    }

    function _requireTransition(
        InstrumentId instrumentId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidInstrumentTransition(instrumentId, version, previousStatus, newStatus);
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

    function _requireInitialAdmin(address initialAdmin) private pure returns (address) {
        if (initialAdmin == address(0)) revert ZeroInitialAdmin();
        return initialAdmin;
    }
}
