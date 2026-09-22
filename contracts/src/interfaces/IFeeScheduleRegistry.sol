// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "../types/Enums.sol";
import {FeeScheduleDefinition, FeeScheduleVersion} from "../types/FeeScheduleDefinition.sol";
import {AssetId, FeeScheduleId} from "../types/Identifiers.sol";
import {ISettlementAssetRegistry} from "./ISettlementAssetRegistry.sol";

/// @dev The canonical fee schedule registry. It qualifies which immutable economic policy a market
/// may charge under, binds that policy to the exact settlement asset binding version it is
/// denominated in, and gates which version may price new risk right now.
///
/// @dev It charges nothing. There is no token transfer, no approval, no balance, no value custody,
/// no delegatecall, and no call into caller-supplied code anywhere in this contract. A fee model and
/// a settlement engine consume these commitments later, at charge time. Its only external calls are
/// view reads of its one immutable registry dependency, and every one of them completes before any
/// storage write.
///
/// @dev The model space is open. Any nonzero FeeModelId is accepted, so a flat per-action charge, an
/// ad valorem rate, a maker-taker split, a volume-tiered ladder, and a model invented after this
/// deployment all qualify through the same path. A consumer must require the exact model it
/// implements and fail closed on every other one; this registry never branches on the value.
///
/// @dev The action space is open and is not stored here at all. Which actions a schedule prices, at
/// what tiers, and to which recipients lives behind feeRulesHash and recipientsHash, which a fee
/// model proves concrete data against at charge time. That is what lets a new FeeActionId, a new
/// tier ladder, or a new recipient set enter the protocol as a new schedule version rather than as a
/// redeployment of this registry.
///
/// @dev Qualification is not funding. The four maxima are an outer per-event policy envelope, and
/// the charge and rebate envelopes are independent: a rebate-only schedule and a rebate envelope
/// wider than the charge envelope both qualify, because maker rebate and market incentive programs
/// are funded from a separately reserved protocol or incentive budget rather than from the charge
/// side of the same event. This registry has no event amount, no notional, and no budget balance, so
/// it proves no solvency and reserves nothing. A consuming fee engine must reserve and verify rebate
/// funding before settlement, and must never pay out merely because this registry accepted the
/// policy envelope.
interface IFeeScheduleRegistry {
    /// @dev Carries every definition field of the version so an indexer can rebuild the complete
    /// fee schedule set from logs alone. The registry keeps no enumerable array; these events are
    /// the enumeration source.
    ///
    /// @dev The definition rides as a whole tuple rather than as twelve flattened parameters, which
    /// keeps the emit site inside the EVM stack and matches the pattern the other registries use.
    /// The ABI encoding carries exactly the same twelve fields either way.
    ///
    /// @dev chainId is logged because qualification is chain-local, and initialStatus is logged
    /// rather than assumed so an indexer never has to hardcode the registration landing state.
    event FeeScheduleRegistered(
        FeeScheduleId indexed feeScheduleId,
        uint32 indexed version,
        bytes32 indexed versionHash,
        bytes32 definitionHash,
        FeeScheduleDefinition definition,
        uint256 chainId,
        RegistryStatus initialStatus,
        address operator
    );

    event FeeScheduleStatusChanged(
        FeeScheduleId indexed feeScheduleId,
        uint32 indexed version,
        RegistryStatus previousStatus,
        RegistryStatus newStatus,
        address indexed operator
    );

    /// @dev Emitted whenever the single active pointer for a schedule moves, including when it is
    /// cleared to zero. Zero is the no-active-version sentinel, because versions start at one.
    event FeeScheduleActiveVersionChanged(
        FeeScheduleId indexed feeScheduleId, uint32 previousVersion, uint32 newVersion, address indexed operator
    );

    error ZeroInitialAdmin();

    error ZeroSettlementAssetRegistry();

    error SettlementAssetRegistryHasNoCode(address settlementAssetRegistry);

    error DuplicateFeeScheduleDefinition(FeeScheduleId feeScheduleId, bytes32 definitionHash, uint32 existingVersion);

    /// @dev Raised instead of an arithmetic panic when a schedule has already consumed every uint32
    /// version. Unreachable in practice, but a named error keeps the exhausted case a stated
    /// protocol outcome rather than an opaque Panic(0x11).
    error FeeScheduleVersionExhausted(FeeScheduleId feeScheduleId);

    error UnknownFeeScheduleVersion(FeeScheduleId feeScheduleId, uint32 version);

    error InvalidFeeScheduleTransition(
        FeeScheduleId feeScheduleId, uint32 version, RegistryStatus previousStatus, RegistryStatus newStatus
    );

    error AnotherFeeScheduleVersionActive(FeeScheduleId feeScheduleId, uint32 activeVersion);

    /// @dev The exact settlement binding version named by the definition was never registered, so
    /// the base units every flat bound is denominated in do not resolve. A schedule may never commit
    /// to money it cannot name, not even while it is only Paused.
    error UnknownSettlementAssetDependency(AssetId settlementAssetId, uint32 settlementAssetVersion);

    /// @dev Activation is refused because the settlement binding is not currently open for new risk.
    /// Registration against a paused or deprecated binding stays legal, because it opens no risk.
    error SettlementAssetDependencyNotOpen(AssetId settlementAssetId, uint32 settlementAssetVersion);

    /// @dev The exact denominator both stored rate bounds are written against, published in the ABI
    /// so an offchain quoting engine never has to assume the scale. It is the canonical
    /// PPM_DENOMINATOR and neither rate may exceed it.
    function FEE_RATE_PPM_DENOMINATOR() external view returns (uint256);

    /// @dev The immutable chain-local source of qualified settlement tokens. Every flat bound in
    /// every schedule is denominated in the base units of a binding resolved through it.
    function settlementAssetRegistry() external view returns (ISettlementAssetRegistry);

    /// @dev Registration lands the version in Paused, so the qualifier who proposes a rate card is
    /// never the party that opens new risk against it. It proves the exact settlement binding
    /// version exists and is historically resolvable, but deliberately does not require it to be
    /// open: qualification grants no risk authority at all, and a rate card is often published ahead
    /// of the binding it will eventually be switched on against.
    function registerFeeSchedule(FeeScheduleDefinition calldata definition)
        external
        returns (FeeScheduleId feeScheduleId, uint32 version);

    /// @dev Every mutation reverts UnknownFeeScheduleVersion for a version that was never
    /// registered. A mutation must never treat an absent record as a Paused one and quietly create
    /// it.
    ///
    /// @dev Activation revalidates that the exact settlement binding is open for new risk, so a
    /// schedule can never be switched on against a token that has since been paused or deprecated.
    function activateFeeSchedule(FeeScheduleId feeScheduleId, uint32 version) external;

    function pauseFeeSchedule(FeeScheduleId feeScheduleId, uint32 version) external;

    function deprecateFeeSchedule(FeeScheduleId feeScheduleId, uint32 version) external;

    /// @dev The one read that reverts UnknownFeeScheduleVersion rather than answering with a
    /// sentinel, because a zeroed FeeScheduleVersion names the zero model and the zero settlement
    /// asset and would read as a usable free schedule. Callers that want a total function gate on
    /// isLifecycleEnabled.
    function getFeeSchedule(FeeScheduleId feeScheduleId, uint32 version)
        external
        view
        returns (FeeScheduleVersion memory record);

    /// @dev Zero means no version was ever registered for the schedule. Versions start at one.
    function latestVersion(FeeScheduleId feeScheduleId) external view returns (uint32);

    /// @dev Zero means no version is active right now, whether because none was ever registered or
    /// because the active one was paused or deprecated.
    function activeVersion(FeeScheduleId feeScheduleId) external view returns (uint32);

    /// @dev RegistryStatus.Unspecified is the never-registered sentinel. It is not a reachable
    /// stored state, so it is an unambiguous answer for an unknown version.
    function statusOf(FeeScheduleId feeScheduleId, uint32 version) external view returns (RegistryStatus);

    /// @dev Counts immutable versions, not unique schedule lineages. Two versions of one schedule
    /// count as two.
    function feeScheduleCount() external view returns (uint256);

    function exists(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool);

    /// @dev The only gate a consumer may use to price new risk under a schedule. True only when the
    /// version is the active pointer, its status is Active, and the exact settlement binding it is
    /// denominated in is itself open for new risk. False for an unknown version rather than a
    /// revert, so a router may probe blind.
    ///
    /// @dev It does not say that the schedule is of the model the caller implements: the caller must
    /// read the definition, require its exact feeModelId, and fail closed on every other one. Nor
    /// does it say that any particular FeeActionId is priced; only a fee model that resolves
    /// feeRulesHash can answer that, and it must fail closed on an action the rules do not cover.
    function isOpenForNewRisk(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool);

    /// @dev Historical resolvability. True for every registered version, including Paused and
    /// Deprecated ones, and regardless of the current status of the settlement binding. Charging a
    /// fee already accrued, verifying a receipt, replaying a signed order, unwinding a position, and
    /// auditing an accounting entry priced under a retired schedule must never require current
    /// Active status. False for an unknown version.
    function isLifecycleEnabled(FeeScheduleId feeScheduleId, uint32 version) external view returns (bool);

    /// @dev The stable chain-portable lineage identity of a definition, derived from the V1 key of
    /// namespaceId and scheduleKey alone. Exposed so a deployer or a consuming module can compute
    /// the identity it intends to depend on without having registered anything.
    function deriveFeeScheduleId(FeeScheduleDefinition calldata definition) external pure returns (FeeScheduleId);
}
