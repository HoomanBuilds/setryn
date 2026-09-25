// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAdapterRegistry} from "../../src/interfaces/IAdapterRegistry.sol";
import {IBenchmarkRegistry} from "../../src/interfaces/IBenchmarkRegistry.sol";
import {IFixingObservationAdapterV1} from "../../src/interfaces/IFixingObservationAdapterV1.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {AdapterDefinitionLib} from "../../src/libraries/AdapterDefinitionLib.sol";
import {BenchmarkDefinitionLib} from "../../src/libraries/BenchmarkDefinitionLib.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {AdapterDefinition, AdapterVersion} from "../../src/types/AdapterDefinition.sol";
import {BenchmarkDefinition, BenchmarkVersion} from "../../src/types/BenchmarkDefinition.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {ObservationBatchValidation, ObservationValidationContext} from "../../src/types/FixingTypes.sol";
import {AdapterId, BenchmarkId, EvidenceOriginId, SeriesId} from "../../src/types/Identifiers.sol";
import {SeriesDefinition, SeriesVersion} from "../../src/types/SeriesDefinition.sol";
import {FixingSlot} from "../../src/types/SeriesQualification.sol";

contract FixingObservationAdapterMock is IFixingObservationAdapterV1 {
    EvidenceOriginId public originId;
    uint64 public batchSequence = 1;
    bool public complete = true;
    bool public outageIndependent;
    bool public shouldRevert;

    function configure(EvidenceOriginId originId_, uint64 batchSequence_, bool complete_, bool outageIndependent_)
        external
    {
        originId = originId_;
        batchSequence = batchSequence_;
        complete = complete_;
        outageIndependent = outageIndependent_;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function validateObservationBatch(ObservationValidationContext calldata context, bytes calldata evidence)
        external
        view
        returns (ObservationBatchValidation memory validation)
    {
        if (shouldRevert) revert();
        return ObservationBatchValidation({
            observationsHash: context.observationsHash,
            evidenceOriginId: originId,
            feedKey: context.feedKey,
            capabilityHash: context.requiredCapabilityHash,
            completenessHash: complete ? keccak256(abi.encode(context.selectionParametersHash, evidence)) : bytes32(0),
            evidenceHash: keccak256(evidence),
            batchSequence: batchSequence,
            complete: complete,
            outageIndependent: outageIndependent
        });
    }
}

contract FixingAdapterRegistryMock {
    mapping(AdapterId adapterId => mapping(uint32 version => AdapterVersion record)) private _records;
    mapping(AdapterId adapterId => mapping(uint32 version => bool value)) private _lifecycle;
    mapping(AdapterId adapterId => mapping(uint32 version => bool value)) private _runtime;

    function setAdapter(AdapterDefinition calldata definition, uint32 version, bool lifecycle, bool runtime)
        external
        returns (AdapterId adapterId)
    {
        adapterId = AdapterDefinitionLib.deriveAdapterId(definition);
        bytes32 definitionHash = AdapterDefinitionLib.hashDefinition(definition, block.chainid);
        _records[adapterId][version] = AdapterVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: AdapterDefinitionLib.hashVersion(adapterId, version, definitionHash, block.chainid),
            version: version,
            status: lifecycle ? RegistryStatus.Paused : RegistryStatus.Unspecified
        });
        _lifecycle[adapterId][version] = lifecycle;
        _runtime[adapterId][version] = runtime;
    }

    function getAdapter(AdapterId adapterId, uint32 version) external view returns (AdapterVersion memory) {
        return _records[adapterId][version];
    }

    function isLifecycleEnabled(AdapterId adapterId, uint32 version) external view returns (bool) {
        return _lifecycle[adapterId][version];
    }

    function runtimeMatches(AdapterId adapterId, uint32 version) external view returns (bool) {
        return _runtime[adapterId][version];
    }
}

contract FixingBenchmarkRegistryMock {
    IAdapterRegistry public immutable adapterRegistry;
    mapping(BenchmarkId benchmarkId => mapping(uint32 version => BenchmarkVersion record)) private _records;
    mapping(BenchmarkId benchmarkId => mapping(uint32 version => bool value)) private _lifecycle;

    constructor(IAdapterRegistry adapterRegistry_) {
        adapterRegistry = adapterRegistry_;
    }

    function setBenchmark(BenchmarkDefinition calldata definition, uint32 version, bool lifecycle)
        external
        returns (BenchmarkId benchmarkId)
    {
        benchmarkId = BenchmarkDefinitionLib.deriveBenchmarkId(definition);
        bytes32 definitionHash = BenchmarkDefinitionLib.hashDefinition(definition, block.chainid);
        _records[benchmarkId][version] = BenchmarkVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: BenchmarkDefinitionLib.hashVersion(benchmarkId, version, definitionHash, block.chainid),
            version: version,
            status: lifecycle ? RegistryStatus.Paused : RegistryStatus.Unspecified
        });
        _lifecycle[benchmarkId][version] = lifecycle;
    }

    function getBenchmark(BenchmarkId benchmarkId, uint32 version) external view returns (BenchmarkVersion memory) {
        return _records[benchmarkId][version];
    }

    function isLifecycleEnabled(BenchmarkId benchmarkId, uint32 version) external view returns (bool) {
        return _lifecycle[benchmarkId][version];
    }
}

contract FixingMarketRegistryMock {
    IBenchmarkRegistry public immutable benchmarkRegistry;

    constructor(IBenchmarkRegistry benchmarkRegistry_) {
        benchmarkRegistry = benchmarkRegistry_;
    }
}

contract FixingSeriesRegistryMock {
    IMarketRegistry public immutable marketRegistry;
    mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) private _records;
    mapping(SeriesId seriesId => mapping(uint32 version => bool value)) private _lifecycle;

    constructor(IMarketRegistry marketRegistry_) {
        marketRegistry = marketRegistry_;
    }

    function hashFixingSlots(SeriesDefinition calldata definition, FixingSlot[] calldata slots)
        external
        pure
        returns (bytes32)
    {
        return SeriesDefinitionLib.hashFixingSlots(definition, slots, 16);
    }

    function setSeries(SeriesDefinition calldata definition, uint32 version, bool lifecycle)
        external
        returns (SeriesId seriesId)
    {
        seriesId = SeriesDefinitionLib.deriveSeriesId(definition);
        bytes32 definitionHash = SeriesDefinitionLib.hashDefinition(definition, block.chainid);
        _records[seriesId][version] = SeriesVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: SeriesDefinitionLib.hashVersion(seriesId, version, definitionHash, block.chainid),
            version: version,
            status: lifecycle ? RegistryStatus.Paused : RegistryStatus.Unspecified
        });
        _lifecycle[seriesId][version] = lifecycle;
    }

    function getSeries(SeriesId seriesId, uint32 version) external view returns (SeriesVersion memory) {
        return _records[seriesId][version];
    }

    function isLifecycleEnabled(SeriesId seriesId, uint32 version) external view returns (bool) {
        return _lifecycle[seriesId][version];
    }
}

