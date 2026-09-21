// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Eip712Lib} from "../../../src/libraries/Eip712Lib.sol";
import {IdLib} from "../../../src/libraries/IdLib.sol";
import {
    AdapterId,
    AssetId,
    BenchmarkId,
    CalendarId,
    InstrumentId,
    MarketId,
    PackageId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../../../src/types/Identifiers.sol";

contract KernelHarness {
    function deriveAssetId(bytes32 definitionHash) external pure returns (AssetId) {
        return IdLib.deriveAssetId(definitionHash);
    }

    function deriveBenchmarkId(bytes32 definitionHash) external pure returns (BenchmarkId) {
        return IdLib.deriveBenchmarkId(definitionHash);
    }

    function deriveCalendarId(bytes32 definitionHash) external pure returns (CalendarId) {
        return IdLib.deriveCalendarId(definitionHash);
    }

    function deriveSessionId(bytes32 definitionHash) external pure returns (SessionId) {
        return IdLib.deriveSessionId(definitionHash);
    }

    function deriveAdapterId(bytes32 definitionHash) external pure returns (AdapterId) {
        return IdLib.deriveAdapterId(definitionHash);
    }

    function deriveRiskDomainId(bytes32 definitionHash) external pure returns (RiskDomainId) {
        return IdLib.deriveRiskDomainId(definitionHash);
    }

    function deriveMarketId(bytes32 definitionHash) external pure returns (MarketId) {
        return IdLib.deriveMarketId(definitionHash);
    }

    function deriveInstrumentId(bytes32 definitionHash) external pure returns (InstrumentId) {
        return IdLib.deriveInstrumentId(definitionHash);
    }

    function deriveSeriesId(bytes32 definitionHash) external pure returns (SeriesId) {
        return IdLib.deriveSeriesId(definitionHash);
    }

    function derivePackageId(bytes32 definitionHash) external pure returns (PackageId) {
        return IdLib.derivePackageId(definitionHash);
    }

    function domainSeparator(uint256 chainId, address verifyingContract) external pure returns (bytes32) {
        return Eip712Lib.domainSeparator(chainId, verifyingContract);
    }

    function validateActionHeader(Eip712Lib.ActionHeader memory header, uint64 nowTs) external pure {
        Eip712Lib.validateActionHeader(header, nowTs);
    }
}
