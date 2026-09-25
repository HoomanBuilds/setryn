// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IOrderState} from "../../src/interfaces/IOrderState.sol";
import {IPackageRegistry} from "../../src/interfaces/IPackageRegistry.sol";
import {ISeriesRegistry} from "../../src/interfaces/ISeriesRegistry.sol";
import {PackageDefinitionLib} from "../../src/libraries/PackageDefinitionLib.sol";
import {BookEligibility} from "../../src/types/BookTypes.sol";
import {PackageClearingRequest, SeriesClearingRequest} from "../../src/types/ClearingTypes.sol";
import {RegistryStatus} from "../../src/types/Enums.sol";
import {AssetId, BookId, FeeScheduleId, FillId, MarketId, PackageId, SeriesId} from "../../src/types/Identifiers.sol";
import {MarketVersion} from "../../src/types/MarketDefinition.sol";
import {OrderRecord, OrderStatus, PublicOrder} from "../../src/types/OrderTypes.sol";
import {PackageLeg, PackageVersion} from "../../src/types/PackageDefinition.sol";
import {SeriesVersion} from "../../src/types/SeriesDefinition.sol";
import {Lots} from "../../src/types/Units.sol";

contract MockBookOrderState {
    mapping(bytes32 orderHash => OrderRecord record) private _orders;

    function setOrder(bytes32 orderHash, OrderRecord calldata record) external {
        _orders[orderHash] = record;
    }

    function getOrder(bytes32 orderHash) external view returns (OrderRecord memory) {
        return _orders[orderHash];
    }

    function statusOf(bytes32 orderHash) external view returns (OrderStatus) {
        return _orders[orderHash].status;
    }

    function remainingLots(bytes32 orderHash) external view returns (Lots) {
        OrderRecord storage record = _orders[orderHash];
        return Lots.wrap(Lots.unwrap(record.order.lots) - Lots.unwrap(record.filledLots));
    }

    function expireOrder(bytes32 orderHash) external {
        _orders[orderHash].status = OrderStatus.Expired;
    }
}

contract MockBookMarketRegistry {
    mapping(bytes32 key => MarketVersion record) private _markets;

    function setMarket(
        MarketId marketId,
        uint32 version,
        AssetId settlementAssetId,
        uint32 settlementVersion,
        FeeScheduleId feeScheduleId,
        uint32 feeVersion
    ) external {
        MarketVersion storage record = _markets[keccak256(abi.encode(marketId, version))];
        record.definition.settlementAssetId = settlementAssetId;
        record.definition.settlementAssetVersion = settlementVersion;
        record.definition.feeScheduleId = feeScheduleId;
        record.definition.feeScheduleVersion = feeVersion;
        record.version = version;
        record.status = RegistryStatus.Active;
    }

    function getMarket(MarketId marketId, uint32 version) external view returns (MarketVersion memory) {
        return _markets[keccak256(abi.encode(marketId, version))];
    }
}

contract MockBookSeriesRegistry {
    address public immutable marketRegistry;
    mapping(bytes32 key => SeriesVersion record) private _series;

    constructor(address marketRegistry_) {
        marketRegistry = marketRegistry_;
    }

    function setSeries(SeriesId seriesId, uint32 version, MarketId marketId, uint32 marketVersion) external {
        SeriesVersion storage record = _series[keccak256(abi.encode(seriesId, version))];
        record.definition.marketId = marketId;
        record.definition.marketVersion = marketVersion;
        record.version = version;
        record.status = RegistryStatus.Active;
    }

    function isOpenForNewRisk(SeriesId seriesId, uint32 version, uint32) external view returns (bool) {
        return _series[keccak256(abi.encode(seriesId, version))].status == RegistryStatus.Active;
    }

    function getSeries(SeriesId seriesId, uint32 version) external view returns (SeriesVersion memory) {
        return _series[keccak256(abi.encode(seriesId, version))];
    }
}

contract MockBookPackageRegistry {
    ISeriesRegistry public immutable seriesRegistry;
    mapping(bytes32 key => PackageVersion record) private _packages;

    constructor(ISeriesRegistry seriesRegistry_) {
        seriesRegistry = seriesRegistry_;
    }

    function hashLegs(PackageLeg[] calldata legs) external pure returns (bytes32) {
        return PackageDefinitionLib.hashLegs(legs);
    }

    function isOpenForNewRisk(PackageId packageId, uint32 version, PackageLeg[] calldata legs, uint32)
        external
        view
        returns (bool)
    {
        PackageVersion storage record = _packages[keccak256(abi.encode(packageId, version))];
        return
            record.status == RegistryStatus.Active && record.definition.legsHash == PackageDefinitionLib.hashLegs(legs);
    }

    function getPackage(PackageId packageId, uint32 version) external view returns (PackageVersion memory) {
        return _packages[keccak256(abi.encode(packageId, version))];
    }
}

contract MockBookClearingEngine {
    IOrderState public immutable orderState;
    ISeriesRegistry public immutable seriesRegistry;
    IPackageRegistry public immutable packageRegistry;

    constructor(IOrderState orderState_, ISeriesRegistry seriesRegistry_, IPackageRegistry packageRegistry_) {
        orderState = orderState_;
        seriesRegistry = seriesRegistry_;
        packageRegistry = packageRegistry_;
    }

    function clearSeries(SeriesClearingRequest calldata request) external pure returns (FillId) {
        return FillId.wrap(keccak256(abi.encode(request.matchData.takerOrderHash, request.matchData.makerOrderHash)));
    }

    function clearPackage(PackageClearingRequest calldata request) external pure returns (FillId) {
        return FillId.wrap(keccak256(abi.encode(request.matchData.takerOrderHash, request.matchData.makerOrderHash)));
    }
}

contract MockPublicBookEligibilityGate {
    bool public eligible = true;

    function setEligible(bool eligible_) external {
        eligible = eligible_;
    }

    function checkOrder(PublicOrder calldata, bytes32, BookId) external view returns (BookEligibility memory) {
        return BookEligibility({eligible: eligible, reason: eligible ? bytes32(0) : keccak256("ineligible")});
    }
}
