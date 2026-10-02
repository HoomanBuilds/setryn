// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Vm} from "forge-std/Vm.sol";

import {BootstrapSetrynMarkets} from "./BootstrapSetrynMarkets.s.sol";
import {NetworkListing, NetworkMarketPolicy} from "./NetworkListing.sol";
import {NetworkSeriesQualification} from "./NetworkSeriesQualification.sol";

import {
    AccountId,
    AdapterId,
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    RiskDomainId,
    SeriesId,
    SessionId,
    WindowKindId
} from "../src/types/Identifiers.sol";
import {SessionDay, SessionWindow} from "../src/types/SessionDefinition.sol";

/// @notice Writes what BootstrapSetrynMarkets registered: the runtime file (schema 11) every product surface reads, and
/// the session-day proofs file anyone uses to publish later session days.
/// @dev Schema 11 keeps every field the schema 9 devnet runtime writes under the same name, so existing readers work;
/// the primary market (top-level single-series fields) is the first listing market. It adds the network fields of
/// docs/plans/network-runtime-real-data.md section 3 and, per market, the listing economics and the series schedule.
library NetworkRuntimeOutput {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant RUNTIME_SCHEMA_VERSION = 11;
    uint256 internal constant SESSION_DAYS_SCHEMA_VERSION = 1;
    uint32 internal constant VERSION = 1;

    error InvalidRuntimeAddress(string field, address value);

    /// The deployed core the runtime names, in the schema 9 field order.
    struct CoreAddresses {
        address assetRegistry;
        address adapterRegistry;
        address calendarRegistry;
        address sessionRegistry;
        address settlementAssetRegistry;
        address benchmarkRegistry;
        address feeScheduleRegistry;
        address riskDomainRegistry;
        address instrumentRegistry;
        address marketRegistry;
        address seriesRegistry;
        address canonicalStrategyCompiler;
        address cappedForwardPayoffModule;
        address collateralVault;
        address fundedFeeEngine;
        address portfolioRiskEngine;
        address riskAdmissionBindingRegistry;
        address executionPolicyRegistry;
        address tradingSessionPolicy;
        address orderState;
        address atomicClearingEngine;
        address privateRfqValidationGate;
        address privateRfqBook;
        address publicOrderBook;
        address positionEngine;
        address lifecyclePolicyValidator;
        address signedLifecycleEngine;
    }

    /// Contracts and evidence the runtime names when the deployment provides them: the first block of the core
    /// deployment (where event scans start), the execution venues, and the terminal lifecycle contracts. Zero omits.
    struct Extras {
        uint256 deploymentBlock;
        address registryStatusController;
        address fixingEngine;
        address cashSettlementCoordinator;
        address positionLifecycleExecutor;
        address sealedAuctionHouse;
        address streamingQuoteEngine;
        address batchClearingEngine;
        address quoteSettlementRouter;
        address streamCapacityManager;
    }

    /// Reads the optional extras from the environment `scripts/network-bootstrap-env.mjs` prints.
    function extrasFromEnvironment() internal view returns (Extras memory extras) {
        extras.deploymentBlock = vm.envOr("SETRYN_DEPLOYMENT_BLOCK", uint256(0));
        extras.registryStatusController = vm.envOr("SETRYN_REGISTRY_STATUS_CONTROLLER", address(0));
        extras.fixingEngine = vm.envOr("SETRYN_FIXING_ENGINE", address(0));
        extras.cashSettlementCoordinator = vm.envOr("SETRYN_CASH_SETTLEMENT_COORDINATOR", address(0));
        extras.positionLifecycleExecutor = vm.envOr("SETRYN_POSITION_LIFECYCLE_EXECUTOR", address(0));
        extras.sealedAuctionHouse = vm.envOr("SETRYN_SEALED_AUCTION_HOUSE", address(0));
        extras.streamingQuoteEngine = vm.envOr("SETRYN_STREAMING_QUOTE_ENGINE", address(0));
        extras.batchClearingEngine = vm.envOr("SETRYN_BATCH_CLEARING_ENGINE", address(0));
        extras.quoteSettlementRouter = vm.envOr("SETRYN_QUOTE_SETTLEMENT_ROUTER", address(0));
        extras.streamCapacityManager = vm.envOr("SETRYN_STREAM_CAPACITY_MANAGER", address(0));
    }

    function writeRuntime(
        CoreAddresses memory core,
        Extras memory extras,
        BootstrapSetrynMarkets.Runtime memory runtime,
        address operator,
        NetworkListing.Listing memory listing,
        string memory sessionDaysPath,
        string memory output
    ) internal {
        string memory key = "setryn-network-runtime";
        vm.serializeUint(key, "schemaVersion", RUNTIME_SCHEMA_VERSION);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeString(key, "network", listing.network);
        vm.serializeUint(key, "day", runtime.day);
        vm.serializeUint(key, "listedAt", listing.listedAt);
        vm.serializeUint(key, "referenceChainId", NetworkListing.REFERENCE_CHAIN_ID);
        vm.serializeAddress(key, "operator", operator);
        vm.serializeAddress(key, "settlementToken", runtime.settlementToken);
        vm.serializeBool(key, "settlementTokenMintable", runtime.settlementTokenMintable);
        // Schema 9 readers name the devnet market adapter here; on a network it is the risk adapter.
        vm.serializeAddress(key, "marketAdapter", address(runtime.riskAdapter));
        vm.serializeAddress(key, "riskAdapter", address(runtime.riskAdapter));
        vm.serializeAddress(key, "fixingAdapter", address(runtime.fixingAdapter));
        vm.serializeString(key, "fixingAdapterKind", "signed-observation");
        vm.serializeAddress(key, "oracleSigners", runtime.oracleSigners);
        vm.serializeUint(key, "oracleThreshold", runtime.oracleThreshold);
        vm.serializeString(key, "sessionDaysPath", sessionDaysPath);
        _serializeCore(key, core);
        _serializeExtras(key, extras);
        _serializeIds(key, runtime);
        vm.serializeAddress(key, "treasuryController", runtime.treasuryController);
        vm.serializeUint(key, "feeScheduleVersion", runtime.feeScheduleVersion);
        vm.serializeUint(key, "makerFeeRatePpm", NetworkMarketPolicy.MAKER_FEE_RATE_PPM);
        vm.serializeUint(key, "takerFeeRatePpm", NetworkMarketPolicy.TAKER_FEE_RATE_PPM);
        vm.serializeUint(key, "calendarVersion", VERSION);
        vm.serializeUint(key, "sessionVersion", VERSION);
        vm.serializeUint(key, "calendarFromDay", runtime.horizon.fromDay);
        vm.serializeUint(key, "calendarThroughDay", runtime.horizon.throughDay);
        _serializePrimary(key, runtime);
        vm.serializeBytes32(key, "executionModeSetHash", NetworkMarketPolicy.EXECUTION_MODE_SET);
        vm.serializeBytes32(key, "executionModeId", NetworkMarketPolicy.EXECUTION_MODE_PUBLIC_BOOK);
        vm.serializeBytes32(key, "privateRfqExecutionModeId", NetworkMarketPolicy.EXECUTION_MODE_PRIVATE_RFQ);
        vm.serializeBytes32(key, "privateRfqPrivacyModeId", NetworkMarketPolicy.PRIVACY_MODE_BLIND);
        vm.serializeBytes32(key, "privateRfqDisclosurePolicyHash", NetworkMarketPolicy.DISCLOSURE_BLIND_QUALIFIED);
        vm.serializeBytes32(
            key, "privateRfqEligibleMakerSetHash", keccak256(bytes.concat(keccak256(abi.encode(operator))))
        );
        vm.serializeString(key, "markets", _serializeMarkets(runtime, listing));
        string memory json = vm.serializeBytes32(key, "enterActionId", NetworkMarketPolicy.ENTER_ACTION);
        vm.writeJson(json, output);
    }

    /// The session id and version and, for every day the session covers, the leaf data and the proof
    /// TradingSessionPolicy.publishSessionDay verifies against the registered day-schedule root.
    function writeSessionDays(
        CoreAddresses memory core,
        BootstrapSetrynMarkets.Runtime memory runtime,
        string memory output
    ) internal {
        NetworkSeriesQualification.Horizon memory horizon = runtime.horizon;
        bytes32[][] memory tree = NetworkSeriesQualification.sessionTree(runtime.sessionId, horizon);
        string[] memory entries = new string[](uint256(horizon.throughDay - horizon.fromDay) + 1);
        for (uint256 i; i < entries.length; ++i) {
            entries[i] = _serializeDay(horizon, tree, horizon.fromDay + uint32(i));
        }
        string memory key = "setryn-session-days";
        vm.serializeUint(key, "schemaVersion", SESSION_DAYS_SCHEMA_VERSION);
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "tradingSessionPolicy", core.tradingSessionPolicy);
        vm.serializeAddress(key, "sessionRegistry", core.sessionRegistry);
        vm.serializeBytes32(key, "sessionId", SessionId.unwrap(runtime.sessionId));
        vm.serializeUint(key, "sessionVersion", VERSION);
        vm.serializeBytes32(key, "calendarId", CalendarId.unwrap(runtime.calendarId));
        vm.serializeUint(key, "fromDay", horizon.fromDay);
        vm.serializeUint(key, "throughDay", horizon.throughDay);
        vm.serializeBytes32(key, "dayScheduleRoot", tree[tree.length - 1][0]);
        vm.serializeUint(key, "publishedThroughDay", runtime.lastPublishedDay);
        string memory json = vm.serializeString(key, "days", entries);
        vm.writeJson(json, output);
    }

    function _serializeDay(NetworkSeriesQualification.Horizon memory horizon, bytes32[][] memory tree, uint32 day)
        private
        returns (string memory)
    {
        SessionDay memory sessionDay = NetworkSeriesQualification.sessionDay(day);
        SessionWindow[] memory windows = NetworkSeriesQualification.sessionWindows(day);
        string[] memory windowEntries = new string[](windows.length);
        for (uint256 i; i < windows.length; ++i) {
            string memory windowKey = string.concat("setryn-session-window-", vm.toString(day), "-", vm.toString(i));
            vm.serializeBytes32(windowKey, "kindId", WindowKindId.unwrap(windows[i].kindId));
            vm.serializeUint(windowKey, "opensAt", windows[i].opensAt);
            vm.serializeUint(windowKey, "closesAt", windows[i].closesAt);
            windowEntries[i] = vm.serializeBytes32(windowKey, "policyHash", windows[i].policyHash);
        }
        string memory key = string.concat("setryn-session-day-", vm.toString(day));
        vm.serializeUint(key, "day", day);
        vm.serializeBytes32(key, "windowsHash", sessionDay.windowsHash);
        vm.serializeBytes32(key, "evidenceHash", sessionDay.evidenceHash);
        vm.serializeString(key, "windows", windowEntries);
        return vm.serializeBytes32(key, "proof", NetworkSeriesQualification.sessionDayProof(horizon, tree, day));
    }

    function _serializeCore(string memory key, CoreAddresses memory core) private {
        vm.serializeAddress(key, "assetRegistry", core.assetRegistry);
        vm.serializeAddress(key, "adapterRegistry", core.adapterRegistry);
        vm.serializeAddress(key, "calendarRegistry", core.calendarRegistry);
        vm.serializeAddress(key, "sessionRegistry", core.sessionRegistry);
        vm.serializeAddress(key, "settlementAssetRegistry", core.settlementAssetRegistry);
        vm.serializeAddress(key, "benchmarkRegistry", core.benchmarkRegistry);
        vm.serializeAddress(key, "feeScheduleRegistry", core.feeScheduleRegistry);
        vm.serializeAddress(key, "riskDomainRegistry", core.riskDomainRegistry);
        vm.serializeAddress(key, "instrumentRegistry", core.instrumentRegistry);
        vm.serializeAddress(key, "marketRegistry", core.marketRegistry);
        vm.serializeAddress(key, "seriesRegistry", core.seriesRegistry);
        vm.serializeAddress(key, "canonicalStrategyCompiler", core.canonicalStrategyCompiler);
        vm.serializeAddress(key, "cappedForwardPayoffModule", core.cappedForwardPayoffModule);
        vm.serializeAddress(key, "collateralVault", core.collateralVault);
        vm.serializeAddress(key, "fundedFeeEngine", core.fundedFeeEngine);
        vm.serializeAddress(key, "portfolioRiskEngine", core.portfolioRiskEngine);
        vm.serializeAddress(key, "riskAdmissionBindingRegistry", core.riskAdmissionBindingRegistry);
        vm.serializeAddress(key, "executionPolicyRegistry", core.executionPolicyRegistry);
        vm.serializeAddress(key, "tradingSessionPolicy", core.tradingSessionPolicy);
        vm.serializeAddress(key, "orderState", core.orderState);
        vm.serializeAddress(key, "atomicClearingEngine", core.atomicClearingEngine);
        vm.serializeAddress(key, "privateRfqValidationGate", core.privateRfqValidationGate);
        vm.serializeAddress(key, "privateRfqBook", core.privateRfqBook);
        vm.serializeAddress(key, "publicOrderBook", core.publicOrderBook);
        vm.serializeAddress(key, "positionEngine", core.positionEngine);
        vm.serializeAddress(key, "lifecyclePolicyValidator", core.lifecyclePolicyValidator);
        vm.serializeAddress(key, "signedLifecycleEngine", core.signedLifecycleEngine);
    }

    function _serializeExtras(string memory key, Extras memory extras) private {
        if (extras.deploymentBlock != 0) vm.serializeUint(key, "deploymentBlock", extras.deploymentBlock);
        _serializeOptional(key, "registryStatusController", extras.registryStatusController);
        _serializeOptional(key, "fixingEngine", extras.fixingEngine);
        _serializeOptional(key, "cashSettlementCoordinator", extras.cashSettlementCoordinator);
        _serializeOptional(key, "positionLifecycleExecutor", extras.positionLifecycleExecutor);
        _serializeOptional(key, "sealedAuctionHouse", extras.sealedAuctionHouse);
        _serializeOptional(key, "streamingQuoteEngine", extras.streamingQuoteEngine);
        _serializeOptional(key, "batchClearingEngine", extras.batchClearingEngine);
        _serializeOptional(key, "quoteSettlementRouter", extras.quoteSettlementRouter);
        _serializeOptional(key, "streamCapacityManager", extras.streamCapacityManager);
    }

    function _serializeOptional(string memory key, string memory field, address value) private {
        if (value == address(0)) return;
        if (value.code.length == 0) revert InvalidRuntimeAddress(field, value);
        vm.serializeAddress(key, field, value);
    }

    function _serializeIds(string memory key, BootstrapSetrynMarkets.Runtime memory runtime) private {
        vm.serializeBytes32(key, "baseAssetId", AssetId.unwrap(runtime.baseAssetId));
        vm.serializeBytes32(key, "settlementAssetId", AssetId.unwrap(runtime.settlementAssetId));
        vm.serializeBytes32(key, "benchmarkAdapterId", AdapterId.unwrap(runtime.benchmarkAdapterId));
        vm.serializeBytes32(key, "riskAdapterId", AdapterId.unwrap(runtime.riskAdapterId));
        vm.serializeBytes32(key, "payoffAdapterId", AdapterId.unwrap(runtime.payoffAdapterId));
        vm.serializeBytes32(key, "calendarId", CalendarId.unwrap(runtime.calendarId));
        vm.serializeBytes32(key, "sessionId", SessionId.unwrap(runtime.sessionId));
        vm.serializeBytes32(key, "benchmarkId", BenchmarkId.unwrap(runtime.benchmarkId));
        vm.serializeBytes32(key, "feeScheduleId", FeeScheduleId.unwrap(runtime.feeScheduleId));
        vm.serializeBytes32(key, "feeRecipientAccountId", AccountId.unwrap(runtime.feeRecipientAccountId));
        vm.serializeBytes32(key, "riskDomainId", RiskDomainId.unwrap(runtime.riskDomainId));
        vm.serializeBytes32(key, "instrumentId", InstrumentId.unwrap(runtime.instrumentId));
    }

    /// The single-series fields schema 9 readers use, naming the first listing market.
    function _serializePrimary(string memory key, BootstrapSetrynMarkets.Runtime memory runtime) private {
        BootstrapSetrynMarkets.SeriesRecord memory primary = runtime.series[0];
        vm.serializeBytes32(key, "marketId", MarketId.unwrap(primary.marketId));
        vm.serializeUint(key, "marketVersion", primary.marketVersion);
        vm.serializeBytes32(key, "seriesId", SeriesId.unwrap(primary.seriesId));
        vm.serializeUint(key, "seriesVersion", primary.seriesVersion);
        vm.serializeBytes(key, "payoffTerms", primary.payoffTerms);
        vm.serializeUint(key, "maxLongDebitMinorPerLot", primary.maxLongDebitMinorPerLot);
        vm.serializeUint(key, "maxShortDebitMinorPerLot", primary.maxShortDebitMinorPerLot);
        // Market economics the terminal previews against: consideration is lots x price ticks x tick size.
        vm.serializeUint(key, "tickSizeMinor", primary.spec.tickSizeMinor);
        vm.serializeUint(key, "maxOrderLots", primary.spec.maxOrderLots);
    }

    /// Every listing market in listing order with the identifiers, economics and schedule an order on it carries.
    function _serializeMarkets(BootstrapSetrynMarkets.Runtime memory runtime, NetworkListing.Listing memory listing)
        private
        returns (string[] memory entries)
    {
        entries = new string[](runtime.series.length);
        for (uint256 i; i < runtime.series.length; ++i) {
            BootstrapSetrynMarkets.SeriesRecord memory record = runtime.series[i];
            NetworkListing.Family memory family = listing.families[record.spec.family];
            string memory key = string.concat("setryn-network-market-", vm.toString(i));
            vm.serializeString(key, "marketKey", record.spec.marketKey);
            vm.serializeBytes32(key, "marketId", MarketId.unwrap(record.marketId));
            vm.serializeUint(key, "marketVersion", record.marketVersion);
            vm.serializeBytes32(key, "instrumentId", InstrumentId.unwrap(runtime.instrumentId));
            vm.serializeBytes32(key, "seriesId", SeriesId.unwrap(record.seriesId));
            vm.serializeUint(key, "seriesVersion", record.seriesVersion);
            vm.serializeBytes32(key, "benchmarkId", BenchmarkId.unwrap(record.benchmarkId));
            vm.serializeBytes(key, "payoffTerms", record.payoffTerms);
            vm.serializeUint(key, "tickSizeMinor", record.spec.tickSizeMinor);
            vm.serializeUint(key, "priceScale", record.spec.priceScale);
            vm.serializeUint(key, "maxLongDebitMinorPerLot", record.maxLongDebitMinorPerLot);
            vm.serializeUint(key, "maxShortDebitMinorPerLot", record.maxShortDebitMinorPerLot);
            vm.serializeUint(key, "maxOrderLots", record.spec.maxOrderLots);
            vm.serializeUint(key, "minPriceTicks", 0);
            vm.serializeUint(key, "maxPriceTicks", record.spec.bandMinor / record.spec.tickSizeMinor);
            vm.serializeString(key, "bandMinor", vm.toString(record.spec.bandMinor));
            _serializeListingFields(key, record.spec, family);
            entries[i] = _serializeSchedule(key, record.schedule);
        }
    }

    function _serializeListingFields(
        string memory key,
        NetworkListing.Market memory spec,
        NetworkListing.Family memory family
    ) private {
        vm.serializeString(key, "underlying", family.underlying);
        vm.serializeString(key, "feedKey", family.feedKey);
        vm.serializeString(key, "strategyKind", family.strategyKind);
        vm.serializeAddress(key, "referenceFeed", family.referenceFeed);
        vm.serializeString(key, "displayName", spec.displayName);
        vm.serializeString(key, "floor", spec.floor);
        vm.serializeString(key, "cap", spec.cap);
        vm.serializeString(key, "floorE8", vm.toString(spec.floorE8));
        vm.serializeString(key, "capE8", vm.toString(spec.capE8));
        vm.serializeString(key, "lotSize", spec.lotSize);
        vm.serializeString(key, "tickPrice", spec.tickPrice);
        vm.serializeUint(key, "priceDecimals", spec.priceDecimals);
        // Zero ticks is the floor: price = priceOffset + ticks / priceScale.
        vm.serializeString(key, "priceOffset", spec.floor);
    }

    function _serializeSchedule(string memory key, NetworkSeriesQualification.Schedule memory schedule)
        private
        returns (string memory)
    {
        vm.serializeUint(key, "tradingStartsAt", schedule.tradingStartsAt);
        vm.serializeUint(key, "lastTradingAt", schedule.lastTradingAt);
        vm.serializeUint(key, "expiryAt", schedule.expiryAt);
        vm.serializeUint(key, "fixingWindowOpen", schedule.fixingWindowOpen);
        vm.serializeUint(key, "fixingWindowClose", schedule.fixingWindowClose);
        vm.serializeUint(key, "primaryEvidenceDeadline", schedule.primaryEvidenceDeadline);
        vm.serializeUint(key, "correctionCutoffAt", schedule.correctionCutoffAt);
        vm.serializeUint(key, "exerciseOpensAt", schedule.exerciseOpensAt);
        vm.serializeUint(key, "exerciseCutoffAt", schedule.exerciseCutoffAt);
        vm.serializeUint(key, "finalResolutionAt", schedule.finalResolutionAt);
        return vm.serializeUint(key, "settlementDeadline", schedule.settlementDeadline);
    }
}
