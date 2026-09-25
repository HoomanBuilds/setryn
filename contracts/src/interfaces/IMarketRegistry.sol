// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IAssetRegistry} from "./IAssetRegistry.sol";
import {ICollateralVault} from "./ICollateralVault.sol";
import {IBenchmarkRegistry} from "./IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "./ICalendarRegistry.sol";
import {IFeeScheduleRegistry} from "./IFeeScheduleRegistry.sol";
import {IRiskDomainRegistry} from "./IRiskDomainRegistry.sol";
import {ISessionRegistry} from "./ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "./ISettlementAssetRegistry.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    MarketId,
    RiskDomainId,
    SessionId
} from "../types/Identifiers.sol";
import {MarketDefinition, MarketVersion} from "../types/MarketDefinition.sol";

interface IMarketRegistry {
    event MarketRegistered(
        MarketId indexed marketId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        MarketDefinition definition,
        uint256 chainId,
        RegistryStatus initialStatus,
        address operator
    );

    event MarketStatusChanged(
        MarketId indexed marketId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    event MarketActiveVersionChanged(
        MarketId indexed marketId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();
    error ZeroRegistryDependency();
    error RegistryDependencyHasNoCode(address dependency);
    error DependencyGraphMismatch(address expectedRegistry, address actualRegistry);
    error DuplicateMarketDefinition(MarketId marketId, bytes32 definitionHash, uint32 existingVersion);
    error MarketVersionExhausted(MarketId marketId);
    error UnknownMarketVersion(MarketId marketId, uint32 version);
    error InvalidMarketTransition(
        MarketId marketId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );
    error AnotherMarketVersionActive(MarketId marketId, uint32 activeVersion);
    error UnknownAssetDependency(AssetId assetId);
    error UnknownSettlementAssetDependency(AssetId assetId, uint32 version);
    error UnknownBenchmarkDependency(BenchmarkId benchmarkId, uint32 version);
    error UnknownCalendarDependency(CalendarId calendarId, uint32 version);
    error UnknownSessionDependency(SessionId sessionId, uint32 version);
    error UnknownRiskDomainDependency(RiskDomainId riskDomainId, uint32 version);
    error UnknownFeeScheduleDependency(FeeScheduleId feeScheduleId, uint32 version);
    error BenchmarkPairMismatch(BenchmarkId benchmarkId, uint32 version);
    error SessionCalendarMismatch(SessionId sessionId, uint32 version);
    error RiskDomainSettlementMismatch(RiskDomainId riskDomainId, uint32 version);
    error FeeScheduleSettlementMismatch(FeeScheduleId feeScheduleId, uint32 version);
    error AssetDependencyNotActive(AssetId assetId, RegistryStatus status);
    error SettlementAssetDependencyNotOpen(AssetId assetId, uint32 version);
    error BenchmarkDependencyNotOpen(BenchmarkId benchmarkId, uint32 version, uint32 day);
    error CalendarDependencyNotOpen(CalendarId calendarId, uint32 version, uint32 day);
    error SessionDependencyNotOpen(SessionId sessionId, uint32 version, uint32 day);
    error RiskDomainDependencyNotOpen(RiskDomainId riskDomainId, uint32 version);
    error FeeScheduleDependencyNotOpen(FeeScheduleId feeScheduleId, uint32 version);
    error TerminalReservationCapabilityMismatch(uint32 required, uint32 actual);
    error TerminalReservationCapabilityNotSupported(uint32 required);

    function assetRegistry() external view returns (IAssetRegistry);
    function settlementAssetRegistry() external view returns (ISettlementAssetRegistry);
    function collateralVault() external view returns (ICollateralVault);
    function benchmarkRegistry() external view returns (IBenchmarkRegistry);
    function calendarRegistry() external view returns (ICalendarRegistry);
    function sessionRegistry() external view returns (ISessionRegistry);
    function riskDomainRegistry() external view returns (IRiskDomainRegistry);
    function feeScheduleRegistry() external view returns (IFeeScheduleRegistry);
    function registerMarket(MarketDefinition calldata definition) external returns (MarketId marketId, uint32 version);
    function activateMarket(MarketId marketId, uint32 version) external;
    function pauseMarket(MarketId marketId, uint32 version) external;
    function deprecateMarket(MarketId marketId, uint32 version) external;
    function getMarket(MarketId marketId, uint32 version) external view returns (MarketVersion memory record);
    function latestVersion(MarketId marketId) external view returns (uint32);
    function activeVersion(MarketId marketId) external view returns (uint32);
    function statusOf(MarketId marketId, uint32 version) external view returns (RegistryStatus);
    function marketCount() external view returns (uint256);
    function exists(MarketId marketId, uint32 version) external view returns (bool);
    function isOpenForNewRisk(MarketId marketId, uint32 version, uint32 day) external view returns (bool);
    function isLifecycleEnabled(MarketId marketId, uint32 version) external view returns (bool);
    function deriveMarketId(MarketDefinition calldata definition) external pure returns (MarketId);
}
