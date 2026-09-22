// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

type AssetId is bytes32;

type BenchmarkId is bytes32;

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

type MarketId is bytes32;

type InstrumentId is bytes32;

type SeriesId is bytes32;

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
