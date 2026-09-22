// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

type AssetId is bytes32;

type BenchmarkId is bytes32;

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
