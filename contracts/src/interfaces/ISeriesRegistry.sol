// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IInstrumentRegistry} from "./IInstrumentRegistry.sol";
import {IMarketRegistry} from "./IMarketRegistry.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {InstrumentId, MarketId, SeriesId} from "../types/Identifiers.sol";
import {SeriesDefinition, SeriesVersion} from "../types/SeriesDefinition.sol";
import {FixingSlot, SeriesDateProof, SeriesQualificationData} from "../types/SeriesQualification.sol";

interface ISeriesRegistry {
    event SeriesRegistered(
        SeriesId indexed seriesId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        SeriesDefinition definition,
        uint256 chainId,
        RegistryStatus initialStatus,
        address operator
    );

    event SeriesStatusChanged(
        SeriesId indexed seriesId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    event SeriesActiveVersionChanged(
        SeriesId indexed seriesId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    event SeriesQualificationPublished(
        SeriesId indexed seriesId, uint32 indexed version, SeriesQualificationData qualification
    );

    error ZeroInitialAdmin();
    error ZeroRegistryDependency();
    error RegistryDependencyHasNoCode(address dependency);
    error DuplicateSeriesDefinition(SeriesId seriesId, bytes32 definitionHash, uint32 existingVersion);
    error SeriesVersionExhausted(SeriesId seriesId);
    error UnknownSeriesVersion(SeriesId seriesId, uint32 version);
    error InvalidSeriesTransition(
        SeriesId seriesId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );
    error AnotherSeriesVersionActive(SeriesId seriesId, uint32 activeVersion);
    error UnknownMarketDependency(MarketId marketId, uint32 version);
    error UnknownInstrumentDependency(InstrumentId instrumentId, uint32 version);
    error MarketDependencyNotOpen(MarketId marketId, uint32 version, uint32 day);
    error InstrumentDependencyNotOpen(InstrumentId instrumentId, uint32 version);
    error MarketDependencyRecordMismatch(MarketId marketId, uint32 version);
    error InstrumentDependencyRecordMismatch(InstrumentId instrumentId, uint32 version);
    error SeriesTradingEnded(uint64 lastTradingAt, uint256 currentTimestamp);
    error UnknownBenchmarkCandidate(uint8 slot, uint256 candidate);
    error BenchmarkCandidatePairMismatch(uint8 slot, uint256 candidate);
    error BenchmarkCandidateHorizonTooNarrow(uint8 slot, uint256 candidate);
    error BenchmarkCandidateNotOpen(uint8 slot, uint256 candidate);
    error InvalidCalendarDayProof(uint256 dateIndex, uint256 dayIndex);
    error CalendarDateHorizonTooNarrow(uint256 dateIndex, uint32 day);
    error SessionDateHorizonTooNarrow(uint256 dateIndex, uint32 day);
    error CalendarDateNotOpen(uint256 dateIndex, uint32 day);
    error SessionDateNotOpen(uint256 dateIndex, uint32 day);
    error PayoffModuleRuntimeMismatch();
    error PayoffModuleCallFailed(bytes4 selector);
    error InvalidPayoffModuleReturn(bytes4 selector, uint256 length);
    error PayoffFamilyMismatch(bytes32 expected, bytes32 actual);
    error PayoffDebitBoundsMismatch(
        uint128 expectedLong, uint128 actualLong, uint128 expectedShort, uint128 actualShort
    );
    error PayoffDisruptionTransferMismatch(int256 expected, int256 actual);
    error PayoffDisruptionTransferOutsideBounds(int256 transfer, uint128 maxLongDebit, uint128 maxShortDebit);
    error RiskDomainRecordMismatch();
    error SeriesLiabilityExceedsRiskCap(uint256 liability, uint128 accountCap, uint128 aggregateCap);

    function marketRegistry() external view returns (IMarketRegistry);
    function instrumentRegistry() external view returns (IInstrumentRegistry);
    function registerSeries(SeriesDefinition calldata definition, SeriesQualificationData calldata qualification)
        external
        returns (SeriesId seriesId, uint32 version);
    function activateSeries(SeriesId seriesId, uint32 version, SeriesQualificationData calldata qualification) external;
    function pauseSeries(SeriesId seriesId, uint32 version) external;
    function deprecateSeries(SeriesId seriesId, uint32 version) external;
    function getSeries(SeriesId seriesId, uint32 version) external view returns (SeriesVersion memory record);
    function latestVersion(SeriesId seriesId) external view returns (uint32);
    function activeVersion(SeriesId seriesId) external view returns (uint32);
    function statusOf(SeriesId seriesId, uint32 version) external view returns (RegistryStatus);
    function seriesCount() external view returns (uint256);
    function exists(SeriesId seriesId, uint32 version) external view returns (bool);
    function isOpenForNewRisk(SeriesId seriesId, uint32 version, uint32 day) external view returns (bool);
    function isLifecycleEnabled(SeriesId seriesId, uint32 version) external view returns (bool);
    function deriveSeriesId(SeriesDefinition calldata definition) external pure returns (SeriesId);
    function hashPayoffTerms(bytes32 termsSchemaHash, bytes calldata terms) external pure returns (bytes32);
    function hashFixingSlots(SeriesDefinition calldata definition, FixingSlot[] calldata slots, uint16 maximumSlots)
        external
        pure
        returns (bytes32);
    function hashDateProofs(SeriesDefinition calldata definition, SeriesDateProof[] calldata dateProofs)
        external
        pure
        returns (bytes32);
}
