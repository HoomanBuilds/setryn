// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {RegistryStatus} from "./Enums.sol";
import {AdapterId, AdapterKindId, AssetId, RiskModelId} from "./Identifiers.sol";

/// @dev A risk domain definition is one immutable isolated clearing perimeter, qualified against the
/// exact collateral binding it is margined in and the exact risk adapter it was reviewed against.
/// Identity is namespaceId and domainKey alone, so retuning margin, replacing the scenario set,
/// moving to a newer risk model, repointing at a newer collateral binding or adapter version, or
/// deploying on another chain never mints a second lineage. Everything economic in this struct is
/// policy, and policy belongs to a version rather than to an identity.
///
/// @dev riskModelId is an open namespaced identifier rather than an enum, so isolated margin,
/// portfolio margin, a scenario grid, a fully collateralized domain, and a model invented after this
/// deployment all encode identically. This registry never branches on it; a risk engine must require
/// the exact model it implements and fail closed on every other one.
///
/// @dev collateralAssetId and collateralAssetVersion name an exact immutable settlement binding
/// rather than a lineage, so a domain can never be silently repointed at a replacement token. Every
/// cap below is denominated in the base units of that exact binding, which is why the pair is
/// qualified and not merely recorded.
///
/// @dev riskAdapterId and riskAdapterVersion name an exact adapter version, and
/// requiredAdapterKindId, requiredInterfaceHash, and requiredCapabilityHash are the exact
/// commitments this domain demands of it. The registry compares all three for equality against the
/// referenced adapter version and fails closed; it never accepts a superset, a subset, or a
/// best-effort match. The adapter is qualification evidence, never an implicit call target: this
/// registry never calls the implementation, and a risk engine that does must re-require the exact
/// interface and capability commitments itself.
///
/// @dev The six commitments are anchors, never computation inputs, and every one of them must be
/// nonzero:
/// - marginRulesHash commits the initial and maintenance margin rule set and its parameters;
/// - scenarioSetHash commits the stress scenario grid the rules are evaluated over;
/// - concentrationRulesHash commits the per-account and per-instrument concentration limits;
/// - defaultProcessHash commits the liquidation, auction, and loss allocation waterfall;
/// - insurancePolicyHash commits the insurance or backstop policy the waterfall terminates in;
/// - qualificationEvidenceHash commits the offchain risk committee review behind the whole domain.
/// A new margin rule, a new scenario, a revised default waterfall, or a different insurance policy
/// enters the protocol as a new domain version rather than as a redeployment of this registry.
///
/// @dev The five caps are the outer monetary envelope this registry enforces on whatever those
/// commitments later resolve to, all denominated in the base units of the referenced collateral
/// binding. They are independent risk dimensions, not one quantity expressed five ways. Open
/// interest, aggregate liability, and account liability must each be nonzero, because a domain that
/// may carry no notional exposure or absorb no loss can never carry the risk it was qualified for.
///
/// @dev The two reservation caps are the whole-domain and the single-account outstanding reservation
/// envelopes, and they are the only optional part of the envelope. Reservations are an optional
/// execution capability, so maxAggregateReservationBaseUnits and maxAccountReservationBaseUnits may
/// both be zero together, which disables reservation-backed quote modes for this domain entirely: a
/// consumer that is asked for such a mode inside a zero-zero domain must fail closed rather than
/// fall back to an unreserved path. One cap zero while the other is nonzero is refused, because a
/// whole-domain envelope with no per-account envelope, or a per-account envelope with no whole-domain
/// envelope, is an incoherent partial envelope rather than a policy.
///
/// @dev The asserted relationships are all containment of one measure inside a wider one.
/// maxAccountLiabilityBaseUnits <= maxAggregateLiabilityBaseUnits always, because one account can
/// never owe more than the whole domain may owe. When reservations are enabled, additionally
/// maxAccountReservationBaseUnits <= maxAggregateReservationBaseUnits, because one account can never
/// reserve more than the whole domain may reserve; maxAggregateReservationBaseUnits <=
/// maxAggregateLiabilityBaseUnits and maxAccountReservationBaseUnits <=
/// maxAccountLiabilityBaseUnits, because a reservation is a pre-commitment against liability
/// headroom at its own scope. No relationship is asserted between open interest and any liability or
/// reservation cap: notional exposure and loss exposure are different risk measures, and inventing an
/// ordering between them would be a fabricated constraint.
///
/// @dev Nothing here is a solvency proof. These caps do not show that the insurance fund is funded,
/// that margin is sufficient for the scenario set, that the default waterfall terminates, or that
/// the market behaves. They are ceilings a clearing engine must additionally respect, and a clearing
/// engine must compute and enforce actual margin, actual liability, and actual funding itself.
struct RiskDomainDefinition {
    bytes32 namespaceId;
    bytes32 domainKey;
    RiskModelId riskModelId;
    AssetId collateralAssetId;
    uint32 collateralAssetVersion;
    AdapterId riskAdapterId;
    uint32 riskAdapterVersion;
    AdapterKindId requiredAdapterKindId;
    bytes32 requiredInterfaceHash;
    bytes32 requiredCapabilityHash;
    bytes32 marginRulesHash;
    bytes32 scenarioSetHash;
    bytes32 concentrationRulesHash;
    bytes32 defaultProcessHash;
    bytes32 insurancePolicyHash;
    bytes32 qualificationEvidenceHash;
    uint128 maxOpenInterestBaseUnits;
    uint128 maxAggregateLiabilityBaseUnits;
    uint128 maxAccountLiabilityBaseUnits;
    uint128 maxAggregateReservationBaseUnits;
    uint128 maxAccountReservationBaseUnits;
}

/// @dev One immutable chain-local version of a risk domain lineage. Status is the only mutable field
/// and it gates future qualification only; a version is never edited and never deleted, so an open
/// position, a default in progress, a settlement, a recovery, a receipt replay, and an audit under a
/// retired domain stay resolvable forever.
struct RiskDomainVersion {
    RiskDomainDefinition definition;
    bytes32 definitionHash;
    bytes32 versionHash;
    uint32 version;
    RegistryStatus status;
}
