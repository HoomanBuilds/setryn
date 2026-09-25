// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ISeriesRegistry} from "./ISeriesRegistry.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {AssetId, PackageId, RiskDomainId, SeriesId} from "../types/Identifiers.sol";
import {PackageDefinition, PackageLeg, PackageVersion} from "../types/PackageDefinition.sol";

interface IPackageRegistry {
    event PackageRegistered(
        PackageId indexed packageId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        PackageDefinition definition,
        PackageLeg[] legs,
        uint256 chainId,
        RegistryStatus initialStatus,
        address operator
    );

    event PackageStatusChanged(
        PackageId indexed packageId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    event PackageActiveVersionChanged(
        PackageId indexed packageId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();
    error ZeroSeriesRegistry();
    error SeriesRegistryHasNoCode(address seriesRegistry);
    error ZeroMarketRegistry();
    error MarketRegistryHasNoCode(address marketRegistry);
    error DependencyGraphMismatch(address expectedRegistry, address actualRegistry);
    error DuplicatePackageDefinition(PackageId packageId, bytes32 definitionHash, uint32 existingVersion);
    error PackageVersionExhausted(PackageId packageId);
    error UnknownPackageVersion(PackageId packageId, uint32 version);
    error InvalidPackageTransition(
        PackageId packageId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );
    error AnotherPackageVersionActive(PackageId packageId, uint32 activeVersion);
    error UnknownSeriesDependency(uint256 legIndex, SeriesId seriesId, uint32 seriesVersion);
    error SeriesDependencyNotOpen(uint256 legIndex, SeriesId seriesId, uint32 seriesVersion, uint32 day);
    error SeriesDependencyRecordMismatch(uint256 legIndex, SeriesId seriesId, uint32 seriesVersion);
    error MarketDependencyRecordMismatch(uint256 legIndex);
    error PackageSettlementMismatch(
        uint256 legIndex, AssetId expectedAssetId, uint32 expectedVersion, AssetId actualAssetId, uint32 actualVersion
    );
    error PackageRiskDomainMismatch(
        uint256 legIndex,
        RiskDomainId expectedRiskDomainId,
        uint32 expectedVersion,
        RiskDomainId actualRiskDomainId,
        uint32 actualVersion
    );
    error PackageTerminalDebitBoundsMismatch(
        uint128 expectedLong, uint128 actualLong, uint128 expectedShort, uint128 actualShort
    );
    error PackageRiskDomainRecordMismatch(RiskDomainId riskDomainId, uint32 version);
    error PackageLiabilityExceedsRiskCap(uint256 liability, uint128 accountCap, uint128 aggregateCap);
    error PackageLegCommitmentMismatch(bytes32 expected, bytes32 actual);

    function seriesRegistry() external view returns (ISeriesRegistry);
    function registerPackage(PackageDefinition calldata definition, PackageLeg[] calldata legs)
        external
        returns (PackageId packageId, uint32 version);
    function activatePackage(PackageId packageId, uint32 version, PackageLeg[] calldata legs) external;
    function pausePackage(PackageId packageId, uint32 version) external;
    function deprecatePackage(PackageId packageId, uint32 version) external;
    function getPackage(PackageId packageId, uint32 version) external view returns (PackageVersion memory record);
    function latestVersion(PackageId packageId) external view returns (uint32);
    function activeVersion(PackageId packageId) external view returns (uint32);
    function statusOf(PackageId packageId, uint32 version) external view returns (RegistryStatus);
    function packageCount() external view returns (uint256);
    function exists(PackageId packageId, uint32 version) external view returns (bool);
    function isOpenForNewRisk(PackageId packageId, uint32 version, PackageLeg[] calldata legs, uint32 day)
        external
        view
        returns (bool);
    function isLifecycleEnabled(PackageId packageId, uint32 version) external view returns (bool);
    function derivePackageId(PackageDefinition calldata definition) external pure returns (PackageId);
    function hashLegs(PackageLeg[] calldata legs) external pure returns (bytes32);
}

