// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IRiskDomainRegistry} from "../../src/interfaces/IRiskDomainRegistry.sol";
import {MarketDefinitionLib} from "../../src/libraries/MarketDefinitionLib.sol";
import {RiskDomainDefinitionLib} from "../../src/libraries/RiskDomainDefinitionLib.sol";
import {SeriesDefinitionLib} from "../../src/libraries/SeriesDefinitionLib.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {MarketId, RiskDomainId, SeriesId} from "../../src/types/Identifiers.sol";
import {MarketDefinition, MarketVersion} from "../../src/types/MarketDefinition.sol";
import {RiskDomainDefinition, RiskDomainVersion} from "../../src/types/RiskDomainDefinition.sol";
import {SeriesDefinition, SeriesVersion} from "../../src/types/SeriesDefinition.sol";

contract PackageRiskDomainRegistryMock {
    mapping(RiskDomainId riskDomainId => mapping(uint32 version => RiskDomainVersion record)) private _records;

    function setRiskDomain(RiskDomainDefinition calldata definition, uint32 version)
        external
        returns (RiskDomainId riskDomainId)
    {
        riskDomainId = RiskDomainDefinitionLib.deriveRiskDomainId(definition);
        bytes32 definitionHash = RiskDomainDefinitionLib.hashDefinition(definition, block.chainid);
        _records[riskDomainId][version] = RiskDomainVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: RiskDomainDefinitionLib.hashVersion(riskDomainId, version, definitionHash, block.chainid),
            version: version,
            status: RegistryStatus.Active
        });
    }

    function getRiskDomain(RiskDomainId riskDomainId, uint32 version) external view returns (RiskDomainVersion memory) {
        return _records[riskDomainId][version];
    }

    function corruptVersion(RiskDomainId riskDomainId, uint32 version, uint32 storedVersion) external {
        _records[riskDomainId][version].version = storedVersion;
    }
}

contract PackageMarketRegistryMock {
    IRiskDomainRegistry public immutable riskDomainRegistry;
    mapping(MarketId marketId => mapping(uint32 version => MarketVersion record)) private _records;

    constructor(IRiskDomainRegistry riskDomainRegistry_) {
        riskDomainRegistry = riskDomainRegistry_;
    }

    function setMarket(MarketDefinition calldata definition, uint32 version) external returns (MarketId marketId) {
        marketId = MarketDefinitionLib.deriveMarketId(definition);
        bytes32 definitionHash = MarketDefinitionLib.hashDefinition(definition, block.chainid);
        _records[marketId][version] = MarketVersion({
            definition: definition,
            definitionHash: definitionHash,
            versionHash: MarketDefinitionLib.hashVersion(marketId, version, definitionHash, block.chainid),
            version: version,
            status: RegistryStatus.Active
        });
    }

    function getMarket(MarketId marketId, uint32 version) external view returns (MarketVersion memory) {
        return _records[marketId][version];
    }

    function corruptVersion(MarketId marketId, uint32 version, uint32 storedVersion) external {
        _records[marketId][version].version = storedVersion;
    }
}

contract PackageSeriesRegistryMock {
    IMarketRegistry public immutable marketRegistry;

    mapping(SeriesId seriesId => mapping(uint32 version => SeriesVersion record)) private _records;
    mapping(SeriesId seriesId => mapping(uint32 version => bool value)) private _lifecycle;
    mapping(SeriesId seriesId => mapping(uint32 version => bool value)) private _open;

    constructor(IMarketRegistry marketRegistry_) {
        marketRegistry = marketRegistry_;
    }

    function setSeries(SeriesDefinition calldata definition, uint32 version, bool lifecycle, bool open)
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
        _open[seriesId][version] = open;
    }

    function setOpen(SeriesId seriesId, uint32 version, bool open) external {
        _open[seriesId][version] = open;
    }

    function getSeries(SeriesId seriesId, uint32 version) external view returns (SeriesVersion memory) {
        return _records[seriesId][version];
    }

    function isLifecycleEnabled(SeriesId seriesId, uint32 version) external view returns (bool) {
        return _lifecycle[seriesId][version];
    }

    function isOpenForNewRisk(SeriesId seriesId, uint32 version, uint32) external view returns (bool) {
        return _open[seriesId][version];
    }

    function corruptVersion(SeriesId seriesId, uint32 version, uint32 storedVersion) external {
        _records[seriesId][version].version = storedVersion;
    }
}

