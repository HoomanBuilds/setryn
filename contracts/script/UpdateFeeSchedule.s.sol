// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";

import {DevnetSeriesQualification} from "./DevnetSeriesQualification.sol";
import {NetworkSeriesQualification} from "./NetworkSeriesQualification.sol";
import {ICalendarRegistry} from "../src/interfaces/ICalendarRegistry.sol";
import {IFeeScheduleRegistry} from "../src/interfaces/IFeeScheduleRegistry.sol";
import {IFundedFeeEngine} from "../src/interfaces/IFundedFeeEngine.sol";
import {IMarketRegistry} from "../src/interfaces/IMarketRegistry.sol";
import {IRegistryStatusController} from "../src/interfaces/IRegistryStatusController.sol";
import {ISeriesRegistry} from "../src/interfaces/ISeriesRegistry.sol";
import {FeeEngineLib} from "../src/libraries/FeeEngineLib.sol";
import {FeeScheduleDefinitionLib} from "../src/libraries/FeeScheduleDefinitionLib.sol";
import {FeeRecipientSet, FeeRule} from "../src/types/FeeEngineTypes.sol";
import {FeeScheduleDefinition, FeeScheduleVersion} from "../src/types/FeeScheduleDefinition.sol";
import {BenchmarkId, FeeActionId, FeeScheduleId, MarketId, SeriesId} from "../src/types/Identifiers.sol";
import {MarketDefinition, MarketVersion} from "../src/types/MarketDefinition.sol";
import {SeriesDefinition, SeriesVersion} from "../src/types/SeriesDefinition.sol";
import {CalendarDefinition} from "../src/types/CalendarDefinition.sol";
import {SeriesQualificationData} from "../src/types/SeriesQualification.sol";
import {FeeRatePpm, PPM_DENOMINATOR} from "../src/types/Units.sol";

/// @notice Reprices a fee schedule lineage by registering version n+1 with new maker and taker charge rates.
///
/// @dev FeeScheduleRegistry never edits a version. A rate change registers a new Paused version whose definition
/// differs only in its rule commitment (and, when asked, its charge ceiling) and a fresh evidence hash, installs the
/// matching rule witness in FundedFeeEngine, retires the active version, and activates the new one; activation refuses
/// while any sibling version is active, and there is no activation delay beyond the governance timelock.
///
/// @dev Markets pin an exact fee schedule version and series pin an exact market version, and every new-risk gate
/// (MarketRegistry, series registry, book, clearing, fee engine) requires that exact version to be the active one. So
/// retiring version n closes every market and series pinned to it for new risk, and an order signed under version n can
/// no longer clear. On a local devnet this script therefore also re-versions each runtime market onto version n+1 and
/// each series onto its new market version, so trading resumes under new series versions (orders sign the new series
/// `targetVersion` and the new `feeScheduleVersion`). Positions opened under the old versions keep settling, lapsing,
/// and resolving: those paths only require the versions they were written under to exist.
///
/// @dev The successor series carries a byte-identical qualification witness, rebuilt from the same shared library that
/// first qualified it: DevnetSeriesQualification for a schema 9/10 devnet runtime (one published day), and
/// NetworkSeriesQualification for a schema 11 network runtime (the multi-day calendar horizon, read from the market's
/// calendar version onchain). The script refuses to register a successor whose fixing slots or date proofs differ.
///
/// @dev Local chains (31337, 1337) broadcast as the operator, who holds the registries' qualifier and status roles only
/// there. Every other chain never broadcasts: the script prints the unsigned calldata for the qualifier, the
/// permissionless witness install, and the governance timelock's RegistryStatusController.govern calls.
contract UpdateFeeSchedule is Script {
    uint256 private constant ANVIL_CHAIN_ID = 31_337;
    uint256 private constant GANACHE_CHAIN_ID = 1_337;
    uint16 private constant MAXIMUM_FIXING_SLOTS = 4;
    bytes32 private constant UPDATE_EVIDENCE_TYPEHASH = keccak256(
        "SetrynFeeScheduleUpdateEvidenceV1(bytes32 feeScheduleId,uint32 version,bytes32 previousVersionHash,uint32 makerChargeRatePpm,uint32 takerChargeRatePpm)"
    );

    error LocalChainRequired(uint256 chainId);
    error BroadcastRefusedOnPublicChain(uint256 chainId);
    error FeeRateOutOfRange(uint32 rate);
    error FeeRateAboveCeiling(uint32 rate, uint32 ceiling);
    error NoBaseFeeScheduleVersion(FeeScheduleId feeScheduleId);
    error MissingFillRule(FeeActionId actionId);
    error UnexpectedFeeScheduleRegistration(FeeScheduleId feeScheduleId, uint32 version);
    error MarketNotOnFeeScheduleVersion(MarketId marketId, uint32 marketVersion);
    error SeriesNotOnMarketVersion(SeriesId seriesId, uint32 seriesVersion);
    error FeeScheduleNotActivated(FeeScheduleId feeScheduleId, uint32 version);
    error InvalidStatusController(address controller);
    error EnvironmentValueOutOfRange(string name, uint256 value);
    error QualificationNotReproduced(SeriesId seriesId, uint32 seriesVersion);

    struct FeeUpdate {
        IFeeScheduleRegistry fees;
        IFundedFeeEngine feeEngine;
        FeeScheduleId feeScheduleId;
        uint32 makerFeeRatePpm;
        uint32 takerFeeRatePpm;
        /// Zero keeps the current charge ceiling; a nonzero value replaces it. A rate above the ceiling is refused
        /// rather than silently widening the governance-approved envelope.
        uint32 maxChargeRatePpm;
        /// Zero derives a unique evidence hash from the lineage, the new version, the previous version, and the rates.
        bytes32 evidenceHash;
    }

    /// One runtime market and the series that trades on it, with the data its devnet qualification is rebuilt from.
    struct SeriesTarget {
        MarketId marketId;
        SeriesId seriesId;
        BenchmarkId benchmarkId;
        bytes payoffTerms;
    }

    struct Cascade {
        IMarketRegistry markets;
        ISeriesRegistry series;
        /// The devnet day the series were qualified on (runtime `day`), or zero for a network runtime (schema 11),
        /// whose multi-day qualification is rebuilt from the market's calendar horizon onchain.
        uint32 day;
        SeriesTarget[] targets;
    }

    struct Plan {
        uint32 activeVersion;
        uint32 baseVersion;
        uint32 nextVersion;
        FeeScheduleDefinition definition;
        FeeRule[] rules;
        FeeRecipientSet recipients;
    }

    struct Result {
        uint32 previousVersion;
        uint32 version;
        uint32[] marketVersions;
        uint32[] seriesVersions;
    }

    function run() external {
        FeeUpdate memory update = FeeUpdate({
            fees: IFeeScheduleRegistry(vm.envAddress("SETRYN_FEE_SCHEDULE_REGISTRY")),
            feeEngine: IFundedFeeEngine(vm.envAddress("SETRYN_FUNDED_FEE_ENGINE")),
            feeScheduleId: FeeScheduleId.wrap(vm.envBytes32("SETRYN_FEE_SCHEDULE_ID")),
            makerFeeRatePpm: _envUint32("SETRYN_MAKER_FEE_RATE_PPM"),
            takerFeeRatePpm: _envUint32("SETRYN_TAKER_FEE_RATE_PPM"),
            maxChargeRatePpm: uint32(_envOrUint32("SETRYN_FEE_MAX_CHARGE_RATE_PPM")),
            evidenceHash: vm.envOr("SETRYN_FEE_SCHEDULE_EVIDENCE_HASH", bytes32(0))
        });

        if (_isLocalChain()) {
            Cascade memory cascade = _cascadeFromRuntime(vm.readFile(vm.envString("SETRYN_RUNTIME")));
            Result memory result = applyLocal(update, cascade, vm.envAddress("SETRYN_GOVERNANCE_OPERATOR"));
            _logResult(update.feeScheduleId, result);
            return;
        }

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            revert BroadcastRefusedOnPublicChain(block.chainid);
        }
        _printUnsigned(
            update, planUpdate(update), IRegistryStatusController(vm.envAddress("SETRYN_REGISTRY_STATUS_CONTROLLER"))
        );
    }

    /// Reads the current version and its installed witness and derives version n+1. Nothing is written.
    function planUpdate(FeeUpdate memory update) public view returns (Plan memory plan) {
        if (update.makerFeeRatePpm > PPM_DENOMINATOR) revert FeeRateOutOfRange(update.makerFeeRatePpm);
        if (update.takerFeeRatePpm > PPM_DENOMINATOR) revert FeeRateOutOfRange(update.takerFeeRatePpm);
        if (update.maxChargeRatePpm > PPM_DENOMINATOR) revert FeeRateOutOfRange(update.maxChargeRatePpm);

        FeeScheduleId feeScheduleId = update.feeScheduleId;
        uint32 latest = update.fees.latestVersion(feeScheduleId);
        plan.activeVersion = update.fees.activeVersion(feeScheduleId);
        plan.baseVersion = plan.activeVersion != 0 ? plan.activeVersion : latest;
        if (plan.baseVersion == 0) revert NoBaseFeeScheduleVersion(feeScheduleId);
        plan.nextVersion = latest + 1;

        FeeScheduleVersion memory base = update.fees.getFeeSchedule(feeScheduleId, plan.baseVersion);
        (plan.rules, plan.recipients) = update.feeEngine.getScheduleWitness(feeScheduleId, plan.baseVersion);
        _setChargeRate(plan.rules, FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL, update.makerFeeRatePpm);
        _setChargeRate(plan.rules, FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL, update.takerFeeRatePpm);

        plan.definition = base.definition;
        if (update.maxChargeRatePpm != 0) plan.definition.maxChargeRatePpm = FeeRatePpm.wrap(update.maxChargeRatePpm);
        uint32 ceiling = FeeRatePpm.unwrap(plan.definition.maxChargeRatePpm);
        if (update.makerFeeRatePpm > ceiling) revert FeeRateAboveCeiling(update.makerFeeRatePpm, ceiling);
        if (update.takerFeeRatePpm > ceiling) revert FeeRateAboveCeiling(update.takerFeeRatePpm, ceiling);
        plan.definition.feeRulesHash = FeeEngineLib.hashRules(plan.rules);
        plan.definition.evidenceHash = update.evidenceHash != bytes32(0)
            ? update.evidenceHash
            : keccak256(
                abi.encode(
                    UPDATE_EVIDENCE_TYPEHASH,
                    FeeScheduleId.unwrap(feeScheduleId),
                    plan.nextVersion,
                    base.versionHash,
                    update.makerFeeRatePpm,
                    update.takerFeeRatePpm
                )
            );
    }

    /// Local devnet only: registers and activates version n+1 and moves every runtime market and series onto it, all as
    /// the operator. Every precondition is read before the first write, so a mismatched runtime sends nothing.
    function applyLocal(FeeUpdate memory update, Cascade memory cascade, address operator)
        public
        returns (Result memory result)
    {
        if (!_isLocalChain()) revert LocalChainRequired(block.chainid);
        Plan memory plan = planUpdate(update);
        uint256 count = cascade.targets.length;
        MarketVersion[] memory markets = new MarketVersion[](count);
        SeriesVersion[] memory series = new SeriesVersion[](count);
        for (uint256 i; i < count; ++i) {
            (markets[i], series[i]) = _requireCascadeTarget(update.feeScheduleId, plan.baseVersion, cascade, i);
        }

        result.previousVersion = plan.activeVersion;
        result.marketVersions = new uint32[](count);
        result.seriesVersions = new uint32[](count);

        vm.startBroadcast(operator);
        (FeeScheduleId registeredId, uint32 version) = update.fees.registerFeeSchedule(plan.definition);
        if (
            FeeScheduleId.unwrap(registeredId) != FeeScheduleId.unwrap(update.feeScheduleId)
                || version != plan.nextVersion
        ) {
            revert UnexpectedFeeScheduleRegistration(registeredId, version);
        }
        update.feeEngine.installScheduleWitness(update.feeScheduleId, version, plan.rules, plan.recipients);
        for (uint256 i; i < count; ++i) {
            MarketDefinition memory definition = markets[i].definition;
            definition.feeScheduleVersion = version;
            (, result.marketVersions[i]) = cascade.markets.registerMarket(definition);
        }
        if (plan.activeVersion != 0) update.fees.pauseFeeSchedule(update.feeScheduleId, plan.activeVersion);
        update.fees.activateFeeSchedule(update.feeScheduleId, version);
        for (uint256 i; i < count; ++i) {
            MarketId marketId = cascade.targets[i].marketId;
            cascade.markets.pauseMarket(marketId, markets[i].version);
            cascade.markets.activateMarket(marketId, result.marketVersions[i]);
        }
        for (uint256 i; i < count; ++i) {
            result.seriesVersions[i] = _reversionSeries(cascade, i, series[i], markets[i], result.marketVersions[i]);
        }
        vm.stopBroadcast();

        result.version = version;
        if (update.fees.activeVersion(update.feeScheduleId) != version) {
            revert FeeScheduleNotActivated(update.feeScheduleId, version);
        }
    }

    function _requireCascadeTarget(
        FeeScheduleId feeScheduleId,
        uint32 feeVersion,
        Cascade memory cascade,
        uint256 index
    ) private view returns (MarketVersion memory market, SeriesVersion memory series) {
        SeriesTarget memory target = cascade.targets[index];
        uint32 marketVersion = cascade.markets.activeVersion(target.marketId);
        if (marketVersion == 0) revert MarketNotOnFeeScheduleVersion(target.marketId, 0);
        market = cascade.markets.getMarket(target.marketId, marketVersion);
        if (
            FeeScheduleId.unwrap(market.definition.feeScheduleId) != FeeScheduleId.unwrap(feeScheduleId)
                || market.definition.feeScheduleVersion != feeVersion
        ) revert MarketNotOnFeeScheduleVersion(target.marketId, marketVersion);

        uint32 seriesVersion = cascade.series.activeVersion(target.seriesId);
        if (seriesVersion == 0) revert SeriesNotOnMarketVersion(target.seriesId, 0);
        series = cascade.series.getSeries(target.seriesId, seriesVersion);
        if (
            MarketId.unwrap(series.definition.marketId) != MarketId.unwrap(target.marketId)
                || series.definition.marketVersion != marketVersion
        ) revert SeriesNotOnMarketVersion(target.seriesId, seriesVersion);
    }

    /// Registers the series' successor version on its new market version with the same qualification witness, then
    /// swaps the active version. The payoff terms, schedule, and risk caps are unchanged.
    function _reversionSeries(
        Cascade memory cascade,
        uint256 index,
        SeriesVersion memory current,
        MarketVersion memory market,
        uint32 marketVersion
    ) private returns (uint32 version) {
        SeriesTarget memory target = cascade.targets[index];
        SeriesDefinition memory definition = current.definition;
        definition.marketVersion = marketVersion;
        SeriesQualificationData memory qualification = seriesQualification(cascade, target, definition, market);
        definition.fixingSlotsHash =
            cascade.series.hashFixingSlots(definition, qualification.fixingSlots, MAXIMUM_FIXING_SLOTS);
        definition.dateAdjustmentEvidenceHash = cascade.series.hashDateProofs(definition, qualification.dateProofs);
        if (
            definition.fixingSlotsHash != current.definition.fixingSlotsHash
                || definition.dateAdjustmentEvidenceHash != current.definition.dateAdjustmentEvidenceHash
        ) revert QualificationNotReproduced(target.seriesId, current.version);
        (, version) = cascade.series.registerSeries(definition, qualification);
        cascade.series.pauseSeries(target.seriesId, current.version);
        cascade.series.activateSeries(target.seriesId, version, qualification);
    }

    /// The qualification witness the series was first registered with: the devnet's one-day witness, or the network
    /// listing's multi-day witness over the calendar horizon of the market's calendar version.
    function seriesQualification(
        Cascade memory cascade,
        SeriesTarget memory target,
        SeriesDefinition memory definition,
        MarketVersion memory market
    ) public view returns (SeriesQualificationData memory) {
        if (cascade.day != 0) {
            return DevnetSeriesQualification.qualification(
                cascade.day, target.benchmarkId, definition, target.payoffTerms
            );
        }
        ICalendarRegistry calendars = cascade.markets.calendarRegistry();
        CalendarDefinition memory calendar =
        calendars.getCalendar(market.definition.tradingCalendarId, market.definition.tradingCalendarVersion).definition;
        NetworkSeriesQualification.Horizon memory horizon = NetworkSeriesQualification.Horizon({
            calendarId: market.definition.tradingCalendarId,
            fromDay: calendar.validFromDay,
            throughDay: calendar.validThroughDay
        });
        return NetworkSeriesQualification.qualification(
            horizon,
            NetworkSeriesQualification.calendarTree(horizon),
            target.benchmarkId,
            definition,
            target.payoffTerms
        );
    }

    function _setChargeRate(FeeRule[] memory rules, FeeActionId actionId, uint32 rate) private pure {
        for (uint256 i; i < rules.length; ++i) {
            if (FeeActionId.unwrap(rules[i].actionId) == FeeActionId.unwrap(actionId)) {
                rules[i].chargeRatePpm = FeeRatePpm.wrap(rate);
                return;
            }
        }
        revert MissingFillRule(actionId);
    }

    function _cascadeFromRuntime(string memory json) private view returns (Cascade memory cascade) {
        cascade.markets = IMarketRegistry(vm.parseJsonAddress(json, ".marketRegistry"));
        cascade.series = ISeriesRegistry(vm.parseJsonAddress(json, ".seriesRegistry"));
        // A schema 11 network runtime qualifies over its calendar horizon; older devnet runtimes over one day.
        cascade.day = vm.parseJsonUint(json, ".schemaVersion") >= 11 ? 0 : uint32(vm.parseJsonUint(json, ".day"));
        uint256 count;
        while (vm.keyExistsJson(json, string.concat(".markets[", vm.toString(count), "]"))) ++count;
        cascade.targets = new SeriesTarget[](count);
        for (uint256 i; i < count; ++i) {
            string memory path = string.concat(".markets[", vm.toString(i), "]");
            cascade.targets[i] = SeriesTarget({
                marketId: MarketId.wrap(vm.parseJsonBytes32(json, string.concat(path, ".marketId"))),
                seriesId: SeriesId.wrap(vm.parseJsonBytes32(json, string.concat(path, ".seriesId"))),
                benchmarkId: BenchmarkId.wrap(vm.parseJsonBytes32(json, string.concat(path, ".benchmarkId"))),
                payoffTerms: vm.parseJsonBytes(json, string.concat(path, ".payoffTerms"))
            });
        }
    }

    /// Public chains: the four protocol steps as unsigned calldata. Status changes run only through the registry status
    /// controller: the governance timelock may activate and deprecate; only the guardian may pause, so governance
    /// retires the old version by deprecating it. Queue both govern calls in one timelock batch.
    function _printUnsigned(FeeUpdate memory update, Plan memory plan, IRegistryStatusController controller)
        private
        view
    {
        if (
            address(controller).code.length == 0
                || controller.registryKind(address(update.fees)) != IRegistryStatusController.RegistryKind.FeeSchedule
        ) revert InvalidStatusController(address(controller));

        console2.log("UNSIGNED fee schedule update; nothing is broadcast. chainId:", block.chainid);
        console2.log("feeScheduleId:");
        console2.logBytes32(FeeScheduleId.unwrap(update.feeScheduleId));
        console2.log("active version:", plan.activeVersion);
        console2.log("new version:", plan.nextVersion);
        console2.log("maker ppm:", update.makerFeeRatePpm);
        console2.log("taker ppm:", update.takerFeeRatePpm);

        console2.log("1. from a FEE_SCHEDULE_QUALIFIER_ROLE holder, to FeeScheduleRegistry:", address(update.fees));
        console2.logBytes(abi.encodeCall(IFeeScheduleRegistry.registerFeeSchedule, (plan.definition)));

        console2.log("2. from any sender, to FundedFeeEngine:", address(update.feeEngine));
        console2.logBytes(
            abi.encodeCall(
                IFundedFeeEngine.installScheduleWitness,
                (update.feeScheduleId, plan.nextVersion, plan.rules, plan.recipients)
            )
        );

        console2.log("3. from the governance timelock:", controller.governance());
        console2.log("   to RegistryStatusController:", address(controller));
        if (plan.activeVersion != 0) {
            console2.log("   3a. govern(deprecateFeeSchedule(active version)):");
            console2.logBytes(
                abi.encodeCall(
                    IRegistryStatusController.govern,
                    (
                        address(update.fees),
                        abi.encodeCall(
                            IFeeScheduleRegistry.deprecateFeeSchedule, (update.feeScheduleId, plan.activeVersion)
                        )
                    )
                )
            );
        }
        console2.log("   3b. govern(activateFeeSchedule(new version)):");
        console2.logBytes(
            abi.encodeCall(
                IRegistryStatusController.govern,
                (
                    address(update.fees),
                    abi.encodeCall(IFeeScheduleRegistry.activateFeeSchedule, (update.feeScheduleId, plan.nextVersion))
                )
            )
        );
        console2.log(
            "WARNING: every market version pinned to the retired fee version closes for new risk. Register successor market versions pinned to the new fee version and successor series versions, and activate them through govern, in the same batch."
        );
    }

    function _logResult(FeeScheduleId feeScheduleId, Result memory result) private pure {
        console2.log("FEE_SCHEDULE_ID");
        console2.logBytes32(FeeScheduleId.unwrap(feeScheduleId));
        console2.log("PREVIOUS_FEE_SCHEDULE_VERSION", result.previousVersion);
        console2.log("FEE_SCHEDULE_VERSION", result.version);
        for (uint256 i; i < result.marketVersions.length; ++i) {
            console2.log("MARKET_SERIES_VERSION", i, result.marketVersions[i], result.seriesVersions[i]);
        }
    }

    function _isLocalChain() private view returns (bool) {
        return block.chainid == ANVIL_CHAIN_ID || block.chainid == GANACHE_CHAIN_ID;
    }

    function _envUint32(string memory name) private view returns (uint32) {
        uint256 value = vm.envUint(name);
        if (value > type(uint32).max) revert EnvironmentValueOutOfRange(name, value);
        return uint32(value);
    }

    function _envOrUint32(string memory name) private view returns (uint32) {
        uint256 value = vm.envOr(name, uint256(0));
        if (value > type(uint32).max) revert EnvironmentValueOutOfRange(name, value);
        return uint32(value);
    }
}
