// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ZeroDefinitionHash} from "../types/Errors.sol";
import {
    AdapterId,
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PackageId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../types/Identifiers.sol";

library IdLib {
    /// @dev Identifiers deliberately exclude chainId and verifyingContract so that one canonical
    /// definition keeps one identity across Arbitrum Sepolia and Arbitrum One. Replay separation is
    /// the job of the EIP-712 domain, not of identity.
    ///
    /// @dev Each tag carries its version inside the hashed literal. A derivation rule may never be
    /// edited in place; it is replaced by a new V2 tag, so previously derived identifiers can never
    /// silently re-derive to different values.
    bytes32 internal constant ASSET_ID_TYPE_TAG = keccak256("SetrynAssetIdV1(bytes32 definitionHash)");
    bytes32 internal constant BENCHMARK_ID_TYPE_TAG = keccak256("SetrynBenchmarkIdV1(bytes32 definitionHash)");
    bytes32 internal constant CALENDAR_ID_TYPE_TAG = keccak256("SetrynCalendarIdV1(bytes32 definitionHash)");
    bytes32 internal constant SESSION_ID_TYPE_TAG = keccak256("SetrynSessionIdV1(bytes32 definitionHash)");
    bytes32 internal constant ADAPTER_ID_TYPE_TAG = keccak256("SetrynAdapterIdV1(bytes32 definitionHash)");
    bytes32 internal constant RISK_DOMAIN_ID_TYPE_TAG = keccak256("SetrynRiskDomainIdV1(bytes32 definitionHash)");
    bytes32 internal constant MARKET_ID_TYPE_TAG = keccak256("SetrynMarketIdV1(bytes32 definitionHash)");
    bytes32 internal constant INSTRUMENT_ID_TYPE_TAG = keccak256("SetrynInstrumentIdV1(bytes32 definitionHash)");
    bytes32 internal constant SERIES_ID_TYPE_TAG = keccak256("SetrynSeriesIdV1(bytes32 definitionHash)");
    bytes32 internal constant PACKAGE_ID_TYPE_TAG = keccak256("SetrynPackageIdV1(bytes32 definitionHash)");
    bytes32 internal constant FEE_SCHEDULE_ID_TYPE_TAG = keccak256("SetrynFeeScheduleIdV1(bytes32 definitionHash)");

    function deriveAssetId(bytes32 definitionHash) internal pure returns (AssetId) {
        return AssetId.wrap(_derive(ASSET_ID_TYPE_TAG, definitionHash));
    }

    function deriveBenchmarkId(bytes32 definitionHash) internal pure returns (BenchmarkId) {
        return BenchmarkId.wrap(_derive(BENCHMARK_ID_TYPE_TAG, definitionHash));
    }

    function deriveCalendarId(bytes32 definitionHash) internal pure returns (CalendarId) {
        return CalendarId.wrap(_derive(CALENDAR_ID_TYPE_TAG, definitionHash));
    }

    function deriveSessionId(bytes32 definitionHash) internal pure returns (SessionId) {
        return SessionId.wrap(_derive(SESSION_ID_TYPE_TAG, definitionHash));
    }

    function deriveAdapterId(bytes32 definitionHash) internal pure returns (AdapterId) {
        return AdapterId.wrap(_derive(ADAPTER_ID_TYPE_TAG, definitionHash));
    }

    function deriveRiskDomainId(bytes32 definitionHash) internal pure returns (RiskDomainId) {
        return RiskDomainId.wrap(_derive(RISK_DOMAIN_ID_TYPE_TAG, definitionHash));
    }

    function deriveMarketId(bytes32 definitionHash) internal pure returns (MarketId) {
        return MarketId.wrap(_derive(MARKET_ID_TYPE_TAG, definitionHash));
    }

    function deriveInstrumentId(bytes32 definitionHash) internal pure returns (InstrumentId) {
        return InstrumentId.wrap(_derive(INSTRUMENT_ID_TYPE_TAG, definitionHash));
    }

    function deriveSeriesId(bytes32 definitionHash) internal pure returns (SeriesId) {
        return SeriesId.wrap(_derive(SERIES_ID_TYPE_TAG, definitionHash));
    }

    function derivePackageId(bytes32 definitionHash) internal pure returns (PackageId) {
        return PackageId.wrap(_derive(PACKAGE_ID_TYPE_TAG, definitionHash));
    }

    function deriveFeeScheduleId(bytes32 definitionHash) internal pure returns (FeeScheduleId) {
        return FeeScheduleId.wrap(_derive(FEE_SCHEDULE_ID_TYPE_TAG, definitionHash));
    }

    function _derive(bytes32 typeTag, bytes32 definitionHash) private pure returns (bytes32) {
        if (definitionHash == bytes32(0)) {
            revert ZeroDefinitionHash();
        }
        return keccak256(abi.encode(typeTag, definitionHash));
    }
}
