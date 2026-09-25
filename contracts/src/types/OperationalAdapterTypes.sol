// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AccountId, AdapterId, MarketId, PackageId, SeriesId} from "./Identifiers.sol";

enum OperationalActionState {
    Unspecified,
    Submitted,
    Included,
    Unknown,
    Reconciling,
    Complete,
    Recovering,
    Recovered,
    NoEffect
}

enum ExecutionGuaranteeClass {
    Unspecified,
    AtomicSameDomain,
    BoundedAsync
}

struct AdapterReference {
    AdapterId adapterId;
    uint32 adapterVersion;
}

struct OperationalBinding {
    uint256 chainId;
    bytes32 deploymentId;
    AccountId accountId;
    MarketId marketId;
    SeriesId seriesId;
    uint32 seriesVersion;
    PackageId packageId;
    uint32 packageVersion;
    bytes32 actionHash;
    uint64 nonce;
    uint64 deadline;
    int256 minValue;
    int256 maxValue;
    bytes32 recipientPolicyHash;
    bytes32 expectedPostconditionsHash;
}

struct AdapterRuntimeDescriptor {
    address self;
    uint256 chainId;
    bytes32 interfaceHash;
    bytes32 capabilityHash;
    bool proxyFree;
    bool valueMoving;
}

struct SequencerHealthResult {
    bool up;
    bool inRecoveryGrace;
    uint64 observedAt;
    uint64 publishedAt;
    uint64 recoveryGraceEndsAt;
    bytes32 evidenceHash;
}

struct TradingSessionResult {
    bool open;
    uint64 sessionOpenedAt;
    uint64 sessionClosesAt;
    uint64 observedAt;
    bytes32 proofHash;
}

struct CurveRateResult {
    int256 value;
    uint8 decimals;
    uint64 observedAt;
    uint64 publishedAt;
    bytes32 curvePointHash;
    bytes32 evidenceHash;
}

struct CorporateActionResult {
    int256 normalizedValue;
    uint8 decimals;
    uint64 effectiveAt;
    bytes32 actionReference;
    bytes32 evidenceHash;
}

struct NativeLedgerExecutionResult {
    OperationalActionState state;
    int256 realizedValue;
    bytes32 postconditionsHash;
    bytes32 executionHash;
}

struct ExternalVenueRequest {
    OperationalBinding binding;
    ExecutionGuaranteeClass guaranteeClass;
    uint64 timeoutAt;
    uint64 recoveryDeadline;
    AccountId interimExposureOwner;
    bytes32 recoveryPolicyHash;
    bytes32 reservationHash;
    uint256 maximumResidual;
    ExternalTerminalFallback terminalFallback;
}

struct ExternalVenueResult {
    OperationalActionState state;
    int256 realizedValue;
    int256 residualValue;
    bytes32 postconditionsHash;
    bytes32 venueActionReference;
    bytes32 evidenceHash;
    bytes32 recoveryOutcomeHash;
}

struct ExternalTerminalFallback {
    OperationalActionState state;
    int256 realizedValue;
    int256 residualValue;
    bytes32 postconditionsHash;
    bytes32 outcomeHash;
}

struct ExternalActionRecord {
    bytes32 requestHash;
    AdapterId adapterId;
    uint32 adapterVersion;
    ExecutionGuaranteeClass guaranteeClass;
    OperationalActionState state;
    uint64 timeoutAt;
    uint64 recoveryDeadline;
    AccountId interimExposureOwner;
    bytes32 recoveryPolicyHash;
    int256 minValue;
    int256 maxValue;
    uint256 maximumResidual;
    bytes32 expectedPostconditionsHash;
    ExternalTerminalFallback terminalFallback;
    bytes32 resultHash;
}
