// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {AdapterKindId} from "../types/Identifiers.sol";
import {
    ExecutionGuaranteeClass,
    ExternalVenueRequest,
    OperationalActionState,
    OperationalBinding
} from "../types/OperationalAdapterTypes.sol";

library OperationalAdapterLib {
    AdapterKindId internal constant KIND_SEQUENCER =
        AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:SequencerHealth"));
    AdapterKindId internal constant KIND_SESSION = AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:TradingSession"));
    AdapterKindId internal constant KIND_CURVE = AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Curve"));
    AdapterKindId internal constant KIND_CORPORATE_ACTION =
        AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:CorporateAction"));
    AdapterKindId internal constant KIND_NATIVE_LEDGER =
        AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:NativeLedger"));
    AdapterKindId internal constant KIND_VENUE = AdapterKindId.wrap(keccak256("SetrynAdapterKindV1:Venue"));

    bytes32 internal constant INTERFACE_SEQUENCER = keccak256("SetrynSequencerHealthAdapterV1");
    bytes32 internal constant INTERFACE_SESSION = keccak256("SetrynTradingSessionProofAdapterV1");
    bytes32 internal constant INTERFACE_CURVE = keccak256("SetrynCurveRateSnapshotAdapterV1");
    bytes32 internal constant INTERFACE_CORPORATE_ACTION = keccak256("SetrynCorporateActionAdapterV1");
    bytes32 internal constant INTERFACE_NATIVE_LEDGER = keccak256("SetrynNativeLedgerExecutionAdapterV1");
    bytes32 internal constant INTERFACE_EXTERNAL_VENUE = keccak256("SetrynExternalVenueExecutionAdapterV1");

    bytes32 internal constant CAPABILITY_SEQUENCER = keccak256("SetrynCapabilityV1:SequencerHealth:ProxyFree");
    bytes32 internal constant CAPABILITY_SESSION = keccak256("SetrynCapabilityV1:TradingSession:ProxyFree");
    bytes32 internal constant CAPABILITY_CURVE = keccak256("SetrynCapabilityV1:CurveRate:ProxyFree");
    bytes32 internal constant CAPABILITY_CORPORATE_ACTION =
        keccak256("SetrynCapabilityV1:CorporateActionNormalization:ProxyFree");
    bytes32 internal constant CAPABILITY_NATIVE_LEDGER =
        keccak256("SetrynCapabilityV1:NativeLedgerExecution:ProxyFree");
    bytes32 internal constant CAPABILITY_EXTERNAL_ATOMIC =
        keccak256("SetrynCapabilityV1:ExternalVenue:AtomicSameDomain:ProxyFree");
    bytes32 internal constant CAPABILITY_EXTERNAL_ASYNC =
        keccak256("SetrynCapabilityV1:ExternalVenue:BoundedAsync:ProxyFree");

    function hashBinding(OperationalBinding memory binding) internal pure returns (bytes32) {
        return keccak256(abi.encode(binding));
    }

    function hashExternalRequest(ExternalVenueRequest memory request) internal pure returns (bytes32) {
        return keccak256(abi.encode(request));
    }

    function capabilityFor(ExecutionGuaranteeClass guaranteeClass) internal pure returns (bytes32) {
        if (guaranteeClass == ExecutionGuaranteeClass.AtomicSameDomain) return CAPABILITY_EXTERNAL_ATOMIC;
        if (guaranteeClass == ExecutionGuaranteeClass.BoundedAsync) return CAPABILITY_EXTERNAL_ASYNC;
        return bytes32(0);
    }

    function isAsyncProgression(OperationalActionState previous, OperationalActionState next)
        internal
        pure
        returns (bool)
    {
        if (previous == OperationalActionState.Submitted) {
            return next == OperationalActionState.Included || next == OperationalActionState.Unknown
                || next == OperationalActionState.Reconciling || next == OperationalActionState.Complete
                || next == OperationalActionState.Recovering || next == OperationalActionState.Recovered
                || next == OperationalActionState.NoEffect;
        }
        if (previous == OperationalActionState.Included || previous == OperationalActionState.Unknown) {
            return next == OperationalActionState.Reconciling || next == OperationalActionState.Complete
                || next == OperationalActionState.Recovering || next == OperationalActionState.Recovered
                || next == OperationalActionState.NoEffect;
        }
        if (previous == OperationalActionState.Reconciling) {
            return next == OperationalActionState.Complete || next == OperationalActionState.Recovering
                || next == OperationalActionState.Recovered || next == OperationalActionState.NoEffect;
        }
        if (previous == OperationalActionState.Recovering) {
            return next == OperationalActionState.Recovered || next == OperationalActionState.NoEffect;
        }
        return false;
    }

    function terminal(OperationalActionState state) internal pure returns (bool) {
        return state == OperationalActionState.Complete || state == OperationalActionState.Recovered
            || state == OperationalActionState.NoEffect;
    }
}
