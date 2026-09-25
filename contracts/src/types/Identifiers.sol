// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

type AssetId is bytes32;

type BenchmarkId is bytes32;

type EvidenceOriginId is bytes32;

/// @dev An open, namespaced category for one kind of economic reference benchmark, never a closed
/// enum, so a spot, perpetual mark, index, NAV, redemption, reference rate, settlement fixing, or
/// not-yet-invented benchmark kind can be qualified without redeploying or reordering anything. It
/// is a component of the benchmark lineage key rather than a lineage identifier itself, so IdLib
/// deliberately publishes no derivation for it: a producer namespaces its own kind offchain. Any
/// nonzero value is accepted at registration and hashing, and a consumer must explicitly recognize
/// the kinds it supports and fail closed on the rest.
type BenchmarkKindId is bytes32;

type CalendarId is bytes32;

type SessionId is bytes32;

/// @dev An open, namespaced capability tag for one kind of session window, never a closed enum, so
/// a new window kind can be committed without redeploying or reordering anything. It is not a
/// registry lineage identifier, so IdLib deliberately publishes no derivation for it: a producer
/// namespaces its own tag offchain. Any nonzero value is accepted at registration and hashing, and a
/// consumer must explicitly recognize the kinds it supports and fail closed on the rest.
type WindowKindId is bytes32;

type AdapterId is bytes32;

/// @dev An open, namespaced capability category for one kind of adapter, never a closed enum, so a
/// benchmark, venue, settlement, delivery, curve, risk, privacy, or not-yet-invented adapter kind
/// can be qualified without redeploying or reordering anything. It is a component of the adapter
/// lineage key rather than a lineage identifier itself, so IdLib deliberately publishes no
/// derivation for it: a producer namespaces its own kind offchain. Any nonzero value is accepted at
/// registration and hashing, and a consumer must explicitly recognize the kinds and capabilities it
/// supports and fail closed on the rest.
type AdapterKindId is bytes32;

type RiskDomainId is bytes32;

/// @dev An open, namespaced identifier for one risk model, never a closed enum, so isolated margin,
/// portfolio margin, a scenario grid, a fully collateralized domain, or a model invented after this
/// deployment all qualify through the same path. It is risk policy rather than identity, so it lives
/// in the immutable version and not in the domain lineage key, and IdLib deliberately publishes no
/// derivation for it: a producer namespaces its own model offchain. Any nonzero value is accepted at
/// registration and hashing, and a risk engine must explicitly recognize the exact models it
/// implements and fail closed on the rest.
type RiskModelId is bytes32;

type MarketId is bytes32;

type InstrumentId is bytes32;

type PayoffFamilyId is bytes32;

type QuoteUnitId is bytes32;

type SettlementClassId is bytes32;

type SeriesId is bytes32;

/// @dev A chain-local bilateral position identifier namespaced by the immutable position engine
/// deployment that created it. Position identifiers are derived by PositionEngine from the chain,
/// engine identity, fill identity, exact series version, both accounts, and fill ordinal.
type PositionId is bytes32;

type FillId is bytes32;

type BookId is bytes32;

type SettlementId is bytes32;

/// @dev An open, namespaced identifier for a holder action policy. Consumers must recognize the
/// exact policy they implement and fail closed on unsupported policies.
type ExercisePolicyId is bytes32;

/// @dev An open, namespaced identifier for the finite terminal outcome used when fixing evidence
/// cannot complete. Consumers must recognize the exact outcome they implement and fail closed.
type DisruptionOutcomeId is bytes32;

type PackageId is bytes32;

type FeeScheduleId is bytes32;

/// @dev An open, namespaced identifier for one fee model, never a closed enum, so a flat per-action
/// charge, an ad valorem rate, a maker-taker split, a volume-tiered ladder, or a model invented
/// after this deployment all qualify through the same path. It is economic policy rather than
/// identity, so it lives in the immutable version and not in the schedule lineage key, and IdLib
/// deliberately publishes no derivation for it: a producer namespaces its own model offchain. Any
/// nonzero value is accepted at registration and hashing, and a consumer must explicitly recognize
/// the exact models it implements and fail closed on the rest.
type FeeModelId is bytes32;

/// @dev An open, namespaced tag for one chargeable or rebatable action, never a closed enum, so a
/// maker fill, taker fill, settlement, exercise, assignment, liquidation, funding payment, or a not
/// yet invented action can be priced without redeploying or reordering anything. It never appears in
/// a stored fee schedule: the schedule commits to a rules hash, and a fee model proves concrete
/// per-action data against that commitment at charge time. Any nonzero value is meaningful, and a
/// consumer must explicitly recognize the exact actions it supports and fail closed on the rest.
type FeeActionId is bytes32;

type FeeRemainderPolicyId is bytes32;

/// @dev A chain-local custody account handle, never a cross-chain identity. It is derived from the
/// vault address and chainId precisely so the same creator and salt name different accounts in two
/// deployments, which is the opposite of what IdLib guarantees. That is why these three identifiers
/// are derived by CollateralIdLib and must never be routed through IdLib.
type AccountId is bytes32;

/// @dev The exact settlement binding one balance is denominated in: one canonical AssetId at one
/// immutable binding version of one chain-local settlement registry. Two binding versions naming the
/// same physical ERC-20 are two different CollateralIds, so a replacement or requalification can
/// never silently merge an older balance into a newer binding.
type CollateralId is bytes32;

/// @dev A chain-local handle for one collateral lock, derived by the vault from the lock operator
/// and that operator's own nonzero reference. The operator address is hashed in precisely so one
/// lock manager can never claim, and therefore can never grief, a handle another manager was going
/// to use: two managers may pick the same reference and still get two different locks. A manager
/// keeps its own correlation key in the reference, and the vault enforces that each derived handle
/// is claimed exactly once. Like AccountId and CollateralId it is derived by CollateralIdLib, never
/// by IdLib, because it is scoped to one deployment on one chain.
type CollateralLockId is bytes32;

/// @dev A chain-local handle for the one non-expiring terminal liability reservation bound to a
/// canonical position. The position identifier is globally namespaced by its owning position engine,
/// while the chain and vault keep the resulting custody handle deployment specific.
type TerminalLiabilityReservationId is bytes32;

/// @dev A chain-local handle for immutable claim backing produced by terminalizing one reservation.
/// It is derived from the reservation and its nonzero terminal outcome reference.
type TerminalClaimId is bytes32;
