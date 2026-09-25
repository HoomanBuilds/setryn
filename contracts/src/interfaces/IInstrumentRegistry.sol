// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "./IAdapterRegistry.sol";
import {InstrumentDefinition, InstrumentVersion} from "../types/InstrumentDefinition.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AdapterId, AdapterKindId, InstrumentId} from "../types/Identifiers.sol";

interface IInstrumentRegistry {
    event InstrumentRegistered(
        InstrumentId indexed instrumentId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        InstrumentDefinition definition,
        uint256 chainId,
        RegistryStatus initialStatus,
        address operator
    );

    event InstrumentStatusChanged(
        InstrumentId indexed instrumentId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    event InstrumentActiveVersionChanged(
        InstrumentId indexed instrumentId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();
    error ZeroAdapterRegistry();
    error AdapterRegistryHasNoCode(address adapterRegistry);
    error ZeroEvaluationGasHardCap();
    error DuplicateInstrumentDefinition(InstrumentId instrumentId, bytes32 definitionHash, uint32 existingVersion);
    error InstrumentVersionExhausted(InstrumentId instrumentId);
    error UnknownInstrumentVersion(InstrumentId instrumentId, uint32 version);
    error InvalidInstrumentTransition(
        InstrumentId instrumentId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );
    error AnotherInstrumentVersionActive(InstrumentId instrumentId, uint32 activeVersion);
    error UnknownPayoffModuleDependency(AdapterId adapterId, uint32 adapterVersion);
    error PayoffModuleKindMismatch(
        AdapterId adapterId, uint32 adapterVersion, AdapterKindId expectedKindId, AdapterKindId actualKindId
    );
    error PayoffModuleInterfaceMismatch(
        AdapterId adapterId, uint32 adapterVersion, bytes32 requiredInterfaceHash, bytes32 actualInterfaceHash
    );
    error PayoffModuleCapabilityMismatch(
        AdapterId adapterId, uint32 adapterVersion, bytes32 requiredCapabilityHash, bytes32 actualCapabilityHash
    );
    error PayoffModuleDependencyNotOpen(AdapterId adapterId, uint32 adapterVersion);

    function adapterRegistry() external view returns (IAdapterRegistry);
    function evaluationGasHardCap() external view returns (uint64);
    function registerInstrument(InstrumentDefinition calldata definition)
        external
        returns (InstrumentId instrumentId, uint32 version);
    function activateInstrument(InstrumentId instrumentId, uint32 version) external;
    function pauseInstrument(InstrumentId instrumentId, uint32 version) external;
    function deprecateInstrument(InstrumentId instrumentId, uint32 version) external;
    function getInstrument(InstrumentId instrumentId, uint32 version)
        external
        view
        returns (InstrumentVersion memory record);
    function latestVersion(InstrumentId instrumentId) external view returns (uint32);
    function activeVersion(InstrumentId instrumentId) external view returns (uint32);
    function statusOf(InstrumentId instrumentId, uint32 version) external view returns (RegistryStatus);
    function instrumentCount() external view returns (uint256);
    function exists(InstrumentId instrumentId, uint32 version) external view returns (bool);
    function isOpenForNewRisk(InstrumentId instrumentId, uint32 version) external view returns (bool);
    function isLifecycleEnabled(InstrumentId instrumentId, uint32 version) external view returns (bool);
    function deriveInstrumentId(InstrumentDefinition calldata definition) external pure returns (InstrumentId);
}
