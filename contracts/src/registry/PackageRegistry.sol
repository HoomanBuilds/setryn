// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IPackageRegistry} from "../interfaces/IPackageRegistry.sol";
import {IRiskDomainRegistry} from "../interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../interfaces/ISeriesRegistry.sol";
import {MarketDefinitionLib} from "../libraries/MarketDefinitionLib.sol";
import {PackageDefinitionLib} from "../libraries/PackageDefinitionLib.sol";
import {RiskDomainDefinitionLib} from "../libraries/RiskDomainDefinitionLib.sol";
import {SeriesDefinitionLib} from "../libraries/SeriesDefinitionLib.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AssetId, MarketId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {MarketVersion} from "../types/MarketDefinition.sol";
import {PackageDefinition, PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";
import {RiskDomainVersion} from "../types/RiskDomainDefinition.sol";
import {SeriesVersion} from "../types/SeriesDefinition.sol";
import {Lots} from "../types/Units.sol";

contract PackageRegistry is IPackageRegistry, AccessControlDefaultAdminRules {
    bytes32 public constant PACKAGE_QUALIFIER_ROLE = keccak256("SETRYN_PACKAGE_QUALIFIER_ROLE");
    bytes32 public constant PACKAGE_STATUS_MANAGER_ROLE = keccak256("SETRYN_PACKAGE_STATUS_MANAGER_ROLE");

    uint32 private constant NO_VERSION = 0;

    ISeriesRegistry private immutable _seriesRegistry;
    IMarketRegistry private immutable _marketRegistry;

    mapping(PackageId packageId => mapping(uint32 version => PackageVersion record)) private _versions;
    mapping(PackageId packageId => uint32 version) private _latestVersion;
    mapping(PackageId packageId => uint32 version) private _activeVersion;
    mapping(PackageId packageId => mapping(bytes32 definitionHash => uint32 version)) private _definitionVersion;
    uint256 private _packageCount;

    constructor(uint48 defaultAdminDelay, address initialAdmin, ISeriesRegistry seriesRegistry_)
        AccessControlDefaultAdminRules(defaultAdminDelay, _requireInitialAdmin(initialAdmin))
    {
        if (address(seriesRegistry_) == address(0)) revert ZeroSeriesRegistry();
        if (address(seriesRegistry_).code.length == 0) revert SeriesRegistryHasNoCode(address(seriesRegistry_));

        IMarketRegistry marketRegistry_ = seriesRegistry_.marketRegistry();
        if (address(marketRegistry_) == address(0)) revert ZeroMarketRegistry();
        if (address(marketRegistry_).code.length == 0) {
            revert MarketRegistryHasNoCode(address(marketRegistry_));
        }

        _seriesRegistry = seriesRegistry_;
        _marketRegistry = marketRegistry_;
        _grantRole(PACKAGE_QUALIFIER_ROLE, initialAdmin);
        _grantRole(PACKAGE_STATUS_MANAGER_ROLE, initialAdmin);
    }

    function registerPackage(PackageDefinition calldata definition, PackageLeg[] calldata legs)
        external
        onlyRole(PACKAGE_QUALIFIER_ROLE)
        returns (PackageId packageId, uint32 version)
    {
        PackageDefinitionLib.validate(definition, legs);
        _validateDependenciesAndEconomics(definition, legs, false, 0);

        packageId = PackageDefinitionLib.derivePackageId(definition);
        bytes32 definitionHash = PackageDefinitionLib.hashDefinition(definition, block.chainid);
        uint32 existingVersion = _definitionVersion[packageId][definitionHash];
        if (existingVersion != NO_VERSION) {
            revert DuplicatePackageDefinition(packageId, definitionHash, existingVersion);
        }

        version = _latestVersion[packageId];
        if (version == type(uint32).max) revert PackageVersionExhausted(packageId);
        version += 1;

        bytes32 versionHash = PackageDefinitionLib.hashVersion(packageId, version, definitionHash, block.chainid);
        _writeVersion(definition, packageId, version, definitionHash, versionHash);

        emit PackageRegistered(
            packageId,
            version,
            versionHash,
            definitionHash,
            definition,
            legs,
            block.chainid,
            RegistryStatus.Paused,
            msg.sender
        );
    }

    function activatePackage(PackageId packageId, uint32 version, PackageLeg[] calldata legs)
        external
        onlyRole(PACKAGE_STATUS_MANAGER_ROLE)
    {
        PackageVersion storage record = _requireVersion(packageId, version);
        _requireTransition(packageId, version, record.status, RegistryStatus.Active);
        uint32 currentActive = _activeVersion[packageId];
        if (currentActive != NO_VERSION) revert AnotherPackageVersionActive(packageId, currentActive);

        bytes32 actualLegsHash = PackageDefinitionLib.hashLegs(legs);
        if (actualLegsHash != record.definition.legsHash) {
            revert PackageLegCommitmentMismatch(record.definition.legsHash, actualLegsHash);
        }

        PackageDefinition memory definition = record.definition;
        _validateDependenciesAndEconomics(definition, legs, true, _currentDay());

        _setStatus(packageId, version, record, RegistryStatus.Active);
        _setActiveVersion(packageId, version);
    }

    function pausePackage(PackageId packageId, uint32 version) external onlyRole(PACKAGE_STATUS_MANAGER_ROLE) {
        _transition(packageId, version, RegistryStatus.Paused);
    }

    function deprecatePackage(PackageId packageId, uint32 version) external onlyRole(PACKAGE_STATUS_MANAGER_ROLE) {
        _transition(packageId, version, RegistryStatus.Deprecated);
    }

    function seriesRegistry() external view returns (ISeriesRegistry) {
        return _seriesRegistry;
    }

    function getPackage(PackageId packageId, uint32 version) external view returns (PackageVersion memory) {
        return _requireVersion(packageId, version);
    }

    function latestVersion(PackageId packageId) external view returns (uint32) {
        return _latestVersion[packageId];
    }

    function activeVersion(PackageId packageId) external view returns (uint32) {
        return _activeVersion[packageId];
    }

    function statusOf(PackageId packageId, uint32 version) external view returns (RegistryStatus) {
        return _versions[packageId][version].status;
    }

    function packageCount() external view returns (uint256) {
        return _packageCount;
    }

    function exists(PackageId packageId, uint32 version) external view returns (bool) {
        return _versions[packageId][version].status != RegistryStatus.Unspecified;
    }

    function isOpenForNewRisk(PackageId packageId, uint32 version, PackageLeg[] calldata legs, uint32 day)
        external
        view
        returns (bool)
    {
        PackageVersion storage record = _versions[packageId][version];
        if (record.status != RegistryStatus.Active || _activeVersion[packageId] != version) return false;
        if (legs.length < PackageDefinitionLib.MIN_PACKAGE_LEGS || legs.length > PackageDefinitionLib.MAX_PACKAGE_LEGS)
        {
            return false;
        }
        if (PackageDefinitionLib.hashLegsUnchecked(legs) != record.definition.legsHash) return false;
        for (uint256 i; i < legs.length; ++i) {
            if (!_seriesRegistry.isOpenForNewRisk(legs[i].seriesId, legs[i].seriesVersion, day)) return false;
        }
        return true;
    }

    function isLifecycleEnabled(PackageId packageId, uint32 version) external view returns (bool) {
        return _versions[packageId][version].status != RegistryStatus.Unspecified;
    }

    function derivePackageId(PackageDefinition calldata definition) external pure returns (PackageId) {
        return PackageDefinitionLib.derivePackageId(definition);
    }

    function hashLegs(PackageLeg[] calldata legs) external pure returns (bytes32) {
        return PackageDefinitionLib.hashLegs(legs);
    }

    function _validateDependenciesAndEconomics(
        PackageDefinition memory definition,
        PackageLeg[] calldata legs,
        bool requireOpen,
        uint32 day
    ) private view {
        uint128[] memory longBounds = new uint128[](legs.length);
        uint128[] memory shortBounds = new uint128[](legs.length);
        RiskDomainId commonRiskDomainId;
        uint32 commonRiskDomainVersion;

        for (uint256 i; i < legs.length; ++i) {
            PackageLeg calldata leg = legs[i];
            (SeriesVersion memory series, MarketVersion memory market) = _requireExactLeg(i, leg);
            if (requireOpen && !_seriesRegistry.isOpenForNewRisk(leg.seriesId, leg.seriesVersion, day)) {
                revert SeriesDependencyNotOpen(i, leg.seriesId, leg.seriesVersion, day);
            }

            if (
                AssetId.unwrap(market.definition.settlementAssetId) != AssetId.unwrap(definition.settlementAssetId)
                    || market.definition.settlementAssetVersion != definition.settlementAssetVersion
            ) {
                revert PackageSettlementMismatch(
                    i,
                    definition.settlementAssetId,
                    definition.settlementAssetVersion,
                    market.definition.settlementAssetId,
                    market.definition.settlementAssetVersion
                );
            }

            if (i == 0) {
                commonRiskDomainId = market.definition.riskDomainId;
                commonRiskDomainVersion = market.definition.riskDomainVersion;
            } else if (
                RiskDomainId.unwrap(market.definition.riskDomainId) != RiskDomainId.unwrap(commonRiskDomainId)
                    || market.definition.riskDomainVersion != commonRiskDomainVersion
            ) {
                revert PackageRiskDomainMismatch(
                    i,
                    commonRiskDomainId,
                    commonRiskDomainVersion,
                    market.definition.riskDomainId,
                    market.definition.riskDomainVersion
                );
            }

            longBounds[i] = series.definition.maxLongDebitMinorPerLot;
            shortBounds[i] = series.definition.maxShortDebitMinorPerLot;
        }

        (uint128 derivedLong, uint128 derivedShort) =
            PackageDefinitionLib.deriveTerminalDebitBounds(legs, longBounds, shortBounds);
        if (
            derivedLong != definition.maxLongDebitMinorPerPackageLot
                || derivedShort != definition.maxShortDebitMinorPerPackageLot
        ) {
            revert PackageTerminalDebitBoundsMismatch(
                definition.maxLongDebitMinorPerPackageLot,
                derivedLong,
                definition.maxShortDebitMinorPerPackageLot,
                derivedShort
            );
        }

        _validateRiskCaps(definition, commonRiskDomainId, commonRiskDomainVersion);
    }

    function _requireExactLeg(uint256 legIndex, PackageLeg calldata leg)
        private
        view
        returns (SeriesVersion memory series, MarketVersion memory market)
    {
        if (!_seriesRegistry.isLifecycleEnabled(leg.seriesId, leg.seriesVersion)) {
            revert UnknownSeriesDependency(legIndex, leg.seriesId, leg.seriesVersion);
        }
        series = _seriesRegistry.getSeries(leg.seriesId, leg.seriesVersion);
        if (
            series.version != leg.seriesVersion
                || SeriesId.unwrap(SeriesDefinitionLib.deriveSeriesId(series.definition))
                    != SeriesId.unwrap(leg.seriesId)
                || series.definitionHash != SeriesDefinitionLib.hashDefinition(series.definition, block.chainid)
                || series.versionHash
                    != SeriesDefinitionLib.hashVersion(
                        leg.seriesId, leg.seriesVersion, series.definitionHash, block.chainid
                    )
        ) revert SeriesDependencyRecordMismatch(legIndex, leg.seriesId, leg.seriesVersion);

        market = _marketRegistry.getMarket(series.definition.marketId, series.definition.marketVersion);
        if (
            market.version != series.definition.marketVersion
                || MarketId.unwrap(MarketDefinitionLib.deriveMarketId(market.definition))
                    != MarketId.unwrap(series.definition.marketId)
                || market.definitionHash != MarketDefinitionLib.hashDefinition(market.definition, block.chainid)
                || market.versionHash
                    != MarketDefinitionLib.hashVersion(
                        series.definition.marketId,
                        series.definition.marketVersion,
                        market.definitionHash,
                        block.chainid
                    )
        ) revert MarketDependencyRecordMismatch(legIndex);
    }

    function _validateRiskCaps(PackageDefinition memory definition, RiskDomainId riskDomainId, uint32 riskDomainVersion)
        private
        view
    {
        IRiskDomainRegistry risks = _marketRegistry.riskDomainRegistry();
        RiskDomainVersion memory risk = risks.getRiskDomain(riskDomainId, riskDomainVersion);
        if (
            risk.version != riskDomainVersion
                || RiskDomainId.unwrap(RiskDomainDefinitionLib.deriveRiskDomainId(risk.definition))
                    != RiskDomainId.unwrap(riskDomainId)
                || risk.definitionHash != RiskDomainDefinitionLib.hashDefinition(risk.definition, block.chainid)
                || risk.versionHash
                    != RiskDomainDefinitionLib.hashVersion(
                        riskDomainId, riskDomainVersion, risk.definitionHash, block.chainid
                    )
                || AssetId.unwrap(risk.definition.collateralAssetId) != AssetId.unwrap(definition.settlementAssetId)
                || risk.definition.collateralAssetVersion != definition.settlementAssetVersion
        ) revert PackageRiskDomainRecordMismatch(riskDomainId, riskDomainVersion);

        uint256 packageLots = Lots.unwrap(definition.maxOrderLots);
        _requireLiabilityWithinCaps(
            packageLots * uint256(definition.maxLongDebitMinorPerPackageLot),
            risk.definition.maxAccountLiabilityBaseUnits,
            risk.definition.maxAggregateLiabilityBaseUnits
        );
        _requireLiabilityWithinCaps(
            packageLots * uint256(definition.maxShortDebitMinorPerPackageLot),
            risk.definition.maxAccountLiabilityBaseUnits,
            risk.definition.maxAggregateLiabilityBaseUnits
        );
    }

    function _requireLiabilityWithinCaps(uint256 liability, uint128 accountCap, uint128 aggregateCap) private pure {
        if (liability > accountCap || liability > aggregateCap) {
            revert PackageLiabilityExceedsRiskCap(liability, accountCap, aggregateCap);
        }
    }

    function _writeVersion(
        PackageDefinition calldata definition,
        PackageId packageId,
        uint32 version,
        bytes32 definitionHash,
        bytes32 versionHash
    ) private {
        PackageVersion storage record = _versions[packageId][version];
        record.definition = definition;
        record.definitionHash = definitionHash;
        record.versionHash = versionHash;
        record.version = version;
        record.status = RegistryStatus.Paused;
        _latestVersion[packageId] = version;
        _definitionVersion[packageId][definitionHash] = version;
        _packageCount += 1;
    }

    function _transition(PackageId packageId, uint32 version, RegistryStatus newStatus) private {
        PackageVersion storage record = _requireVersion(packageId, version);
        _requireTransition(packageId, version, record.status, newStatus);
        _setStatus(packageId, version, record, newStatus);
        if (_activeVersion[packageId] == version) _setActiveVersion(packageId, NO_VERSION);
    }

    function _setStatus(PackageId packageId, uint32 version, PackageVersion storage record, RegistryStatus newStatus)
        private
    {
        RegistryStatus previousStatus = record.status;
        record.status = newStatus;
        emit PackageStatusChanged(packageId, version, previousStatus, newStatus, msg.sender);
    }

    function _setActiveVersion(PackageId packageId, uint32 newVersion) private {
        uint32 previousVersion = _activeVersion[packageId];
        _activeVersion[packageId] = newVersion;
        emit PackageActiveVersionChanged(packageId, previousVersion, newVersion, msg.sender);
    }

    function _requireVersion(PackageId packageId, uint32 version) private view returns (PackageVersion storage record) {
        record = _versions[packageId][version];
        if (record.status == RegistryStatus.Unspecified) revert UnknownPackageVersion(packageId, version);
    }

    function _requireTransition(
        PackageId packageId,
        uint32 version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus
    ) private pure {
        if (!_isPermittedTransition(previousStatus, newStatus)) {
            revert InvalidPackageTransition(packageId, version, previousStatus, newStatus);
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

    function _currentDay() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }
}

