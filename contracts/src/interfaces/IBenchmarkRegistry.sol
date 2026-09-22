// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {BenchmarkDefinition, BenchmarkVersion} from "../types/BenchmarkDefinition.sol";
import {AdapterKindId, AdapterId, AssetId, BenchmarkId, CalendarId, SessionId} from "../types/Identifiers.sol";
import {RegistryStatus} from "../types/Enums.sol";
import {IAdapterRegistry} from "./IAdapterRegistry.sol";
import {IAssetRegistry} from "./IAssetRegistry.sol";
import {ICalendarRegistry} from "./ICalendarRegistry.sol";
import {ISessionRegistry} from "./ISessionRegistry.sol";

/// @dev The canonical benchmark registry. It qualifies which economic reference a market may price,
/// mark, or settle against, binding that reference to exact asset, adapter, calendar, and session
/// versions, and gates which version may take new risk right now.
///
/// @dev It reads no prices. There is no oracle read, no feed lookup, no vendor integration, and no
/// validity check against live market data anywhere in this contract. `feedKey`, `outputDecimals`,
/// `maxStalenessSeconds`, `maxFutureSkewSeconds`, and `maxConfidenceBps` are stored commitments that
/// a benchmark adapter and the fixing engine consume later, at observation time.
///
/// @dev It holds no funds, grants no approvals, never delegatecalls, and never calls an adapter
/// implementation or accepts caller-supplied call data. Its only external calls are view reads of
/// its four immutable registry dependencies, and every one of them completes before any storage
/// write.
///
/// @dev The kind space is open. Any nonzero BenchmarkKindId is accepted, so FX, crypto, commodity,
/// rate, index, NAV, redemption, perpetual mark, and a kind invented after this deployment all
/// qualify through the same path. A consumer must require the exact kind it supports and fail closed
/// on every other one.
///
/// @dev Adapter compatibility is exact: the referenced adapter version must carry the benchmark
/// adapter kind and its interfaceHash and capabilityHash must equal the ones this definition
/// requires. There is no superset, subset, or best-effort acceptance.
interface IBenchmarkRegistry {
    /// @dev Carries every definition field of the version so an indexer can rebuild the complete
    /// benchmark set from logs alone. The registry keeps no enumerable array; these events are the
    /// enumeration source.
    ///
    /// @dev The definition rides as a whole tuple rather than as twenty-three flattened parameters,
    /// because flattening them alongside the commitments exhausts the EVM stack at the emit site.
    /// The ABI encoding carries exactly the same twenty-three fields either way.
    ///
    /// @dev chainId is logged because qualification is chain-local, and initialStatus is logged
    /// rather than assumed so an indexer never has to hardcode the registration landing state.
    event BenchmarkRegistered(
        BenchmarkId indexed benchmarkId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        BenchmarkDefinition definition,
        uint256 chainId,
        RegistryStatus initialStatus,
        address operator
    );

    event BenchmarkStatusChanged(
        BenchmarkId indexed benchmarkId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    /// @dev Emitted whenever the single active pointer for a benchmark moves, including when it is
    /// cleared to zero. Zero is the no-active-version sentinel, because versions start at one.
    event BenchmarkActiveVersionChanged(
        BenchmarkId indexed benchmarkId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();

    error ZeroAssetRegistry();

    error AssetRegistryHasNoCode(address assetRegistry);

    error ZeroAdapterRegistry();

    error AdapterRegistryHasNoCode(address adapterRegistry);

    error ZeroCalendarRegistry();

    error CalendarRegistryHasNoCode(address calendarRegistry);

    error ZeroSessionRegistry();

    error SessionRegistryHasNoCode(address sessionRegistry);

    /// @dev The supplied session registry resolves its business days against a different calendar
    /// registry than the one supplied here, so a benchmark could commit to a calendar version that
    /// its own session was never checked against. The deployment is refused rather than wired into a
    /// dependency graph that does not close.
    error DependencyGraphMismatch(address expectedCalendarRegistry, address sessionCalendarRegistry);

    error DuplicateBenchmarkDefinition(BenchmarkId benchmarkId, bytes32 definitionHash, uint32 existingVersion);

    /// @dev Raised instead of an arithmetic panic when a benchmark has already consumed every uint32
    /// version. Unreachable in practice, but a named error keeps the exhausted case a stated
    /// protocol outcome rather than an opaque Panic(0x11).
    error BenchmarkVersionExhausted(BenchmarkId benchmarkId);

    error UnknownBenchmarkVersion(BenchmarkId benchmarkId, uint32 version);

    error InvalidBenchmarkTransition(
        BenchmarkId benchmarkId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );

    error AnotherBenchmarkVersionActive(BenchmarkId benchmarkId, uint32 activeVersion);

    /// @dev One leg of the pair was never registered as a canonical asset. A benchmark may never
    /// quote an identity that does not exist, not even while it is only Paused.
    error UnknownAssetDependency(AssetId assetId);

    error UnknownAdapterDependency(AdapterId adapterId, uint32 adapterVersion);

    error UnknownCalendarDependency(CalendarId calendarId, uint32 calendarVersion);

    error UnknownSessionDependency(SessionId sessionId, uint32 sessionVersion);

    /// @dev The referenced adapter version exists but was qualified under a different capability
    /// category, so it is not an oracle adapter at all.
    error AdapterKindMismatch(
        AdapterId adapterId, uint32 adapterVersion, AdapterKindId expectedKindId, AdapterKindId actualKindId
    );

    /// @dev The referenced adapter version was qualified against a different ABI revision than the
    /// one this benchmark requires. Compatibility is exact equality, never a best-effort match.
    error AdapterInterfaceMismatch(
        AdapterId adapterId, uint32 adapterVersion, bytes32 requiredInterfaceHash, bytes32 actualInterfaceHash
    );

    /// @dev The referenced adapter version was qualified with a different capability set than the
    /// one this benchmark requires. Compatibility is exact equality, never a superset or a subset.
    error AdapterCapabilityMismatch(
        AdapterId adapterId, uint32 adapterVersion, bytes32 requiredCapabilityHash, bytes32 actualCapabilityHash
    );

    /// @dev The referenced session version resolves its business days against a different calendar
    /// version than the one this benchmark commits to, so the two dependencies disagree about which
    /// days exist. The session horizon is the benchmark operating horizon, and it may only be read
    /// through a calendar the session itself was built on.
    error SessionCalendarMismatch(
        SessionId sessionId,
        uint32 sessionVersion,
        CalendarId benchmarkCalendarId,
        uint32 benchmarkCalendarVersion,
        CalendarId sessionCalendarId,
        uint32 sessionCalendarVersion
    );

    /// @dev Activation is refused because a leg of the pair is not currently Active. Registration
    /// against a paused or deprecated asset stays legal, because it opens no risk.
    error AssetDependencyNotActive(AssetId assetId, RegistryStatus status);

    error AdapterDependencyNotOpen(AdapterId adapterId, uint32 adapterVersion);

    /// @dev Activation is refused because the calendar dependency is not open for new risk across
    /// both endpoints of the session horizon. The benchmark stays registered and resolvable.
    error CalendarDependencyNotOpen(
        CalendarId calendarId, uint32 calendarVersion, uint32 validFromDay, uint32 validThroughDay
    );

    error SessionDependencyNotOpen(
        SessionId sessionId, uint32 sessionVersion, uint32 validFromDay, uint32 validThroughDay
    );

    /// @dev The immutable canonical identity source both legs of every pair must exist in.
    function assetRegistry() external view returns (IAssetRegistry);

    /// @dev The immutable chain-local source of qualified oracle adapter implementations.
    function adapterRegistry() external view returns (IAdapterRegistry);

    /// @dev The immutable business-day source. It is required to be the same instance the session
    /// registry depends on, so the dependency graph closes.
    function calendarRegistry() external view returns (ICalendarRegistry);

    /// @dev The immutable schedule source. Its horizon is the benchmark operating horizon; this
    /// registry stores no horizon fields of its own.
    function sessionRegistry() external view returns (ISessionRegistry);

    /// @dev Registration lands the version in Paused, so the qualifier who proposes a reference is
    /// never the party that opens new risk against it. It proves every dependency version exists and
    /// that the adapter is exactly compatible, but deliberately does not require any dependency to
    /// be active: registration grants no risk authority at all.
    function registerBenchmark(BenchmarkDefinition calldata definition)
        external
        returns (BenchmarkId benchmarkId, uint32 version);

    /// @dev Every mutation reverts UnknownBenchmarkVersion for a version that was never registered.
    /// A mutation must never treat an absent record as a Paused one and quietly create it.
    ///
    /// @dev Activation revalidates the exact dependency records and their compatibility, then
    /// additionally requires both assets to be Active, the adapter version to be open for new risk,
    /// and the calendar and session versions to be open for new risk at both endpoints of the
    /// session horizon. It fails closed with an error naming the dependency that refused.
    function activateBenchmark(BenchmarkId benchmarkId, uint32 version) external;

    function pauseBenchmark(BenchmarkId benchmarkId, uint32 version) external;

    function deprecateBenchmark(BenchmarkId benchmarkId, uint32 version) external;

    /// @dev The one read that reverts UnknownBenchmarkVersion rather than answering with a sentinel,
    /// because a zeroed BenchmarkVersion names the zero asset pair and would read as a usable
    /// record. Callers that want a total function gate on isLifecycleEnabled.
    function getBenchmark(BenchmarkId benchmarkId, uint32 version)
        external
        view
        returns (BenchmarkVersion memory record);

    /// @dev Zero means no version was ever registered for the benchmark. Versions start at one.
    function latestVersion(BenchmarkId benchmarkId) external view returns (uint32);

    /// @dev Zero means no version is active right now, whether because none was ever registered or
    /// because the active one was paused or deprecated.
    function activeVersion(BenchmarkId benchmarkId) external view returns (uint32);

    /// @dev RegistryStatus.Unspecified is the never-registered sentinel. It is not a reachable
    /// stored state, so it is an unambiguous answer for an unknown version.
    function statusOf(BenchmarkId benchmarkId, uint32 version) external view returns (RegistryStatus);

    /// @dev Counts immutable versions, not unique benchmark lineages. Two versions of one benchmark
    /// count as two.
    function benchmarkCount() external view returns (uint256);

    function exists(BenchmarkId benchmarkId, uint32 version) external view returns (bool);

    /// @dev Whether the day falls inside the operating horizon, which is read from the session
    /// version this benchmark depends on rather than from a horizon of its own. It says nothing
    /// about whether the day is open. False for an unknown version.
    function coversDay(BenchmarkId benchmarkId, uint32 version, uint32 day) external view returns (bool);

    /// @dev The only gate a consumer may use to route new risk through a benchmark. True only when
    /// the version is the active pointer, its status is Active, both assets are Active, the adapter
    /// version is open for new risk, the day is inside the session horizon, and both the calendar
    /// and the session version are open for new risk on that day. False for an unknown version.
    ///
    /// @dev It does not say that the benchmark is of the kind the caller needs: the caller must read
    /// the definition and require its exact kindId, failing closed on every other one.
    function isOpenForNewRisk(BenchmarkId benchmarkId, uint32 version, uint32 day) external view returns (bool);

    /// @dev Historical resolvability. True for every registered version, including Paused and
    /// Deprecated ones, and regardless of the current status of any dependency. Fixing, settlement,
    /// unwind, receipt replay, and audit of positions already opened against a retired benchmark
    /// must never require current Active status. False for an unknown version.
    function isLifecycleEnabled(BenchmarkId benchmarkId, uint32 version) external view returns (bool);

    /// @dev The stable chain-portable lineage identity of a definition, derived from the V1 key of
    /// namespaceId, referenceId, kindId, baseAssetId, and quoteAssetId alone. Exposed so a deployer
    /// or a consuming module can compute the identity it intends to depend on without having
    /// registered anything.
    function deriveBenchmarkId(BenchmarkDefinition calldata definition) external pure returns (BenchmarkId);
}
