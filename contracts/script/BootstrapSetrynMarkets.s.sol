// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {MerkleTreeLib} from "./MerkleTreeLib.sol";
import {NetworkListing, NetworkMarketPolicy} from "./NetworkListing.sol";
import {NetworkRuntimeOutput} from "./NetworkRuntimeOutput.sol";
import {NetworkSeriesQualification} from "./NetworkSeriesQualification.sol";

import {SignedObservationFixingAdapter} from "../src/adapters/oracle/SignedObservationFixingAdapter.sol";
import {CanonicalStrategyCompiler} from "../src/compiler/CanonicalStrategyCompiler.sol";
import {DevnetSettlementToken} from "../src/devnet/DevnetSettlementToken.sol";
import {FundedFeeEngine} from "../src/fees/FundedFeeEngine.sol";
import {IAdapterRegistry} from "../src/interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../src/interfaces/ICalendarRegistry.sol";
import {ICollateralVault} from "../src/interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../src/interfaces/IFeeScheduleRegistry.sol";
import {IInstrumentRegistry} from "../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../src/interfaces/IMarketRegistry.sol";
import {IRegistryStatusController} from "../src/interfaces/IRegistryStatusController.sol";
import {IRiskDomainRegistry} from "../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../src/interfaces/ISeriesRegistry.sol";
import {ISessionRegistry} from "../src/interfaces/ISessionRegistry.sol";
import {ISettlementAssetRegistry} from "../src/interfaces/ISettlementAssetRegistry.sol";
import {ITradingSessionPolicy} from "../src/interfaces/ITradingSessionPolicy.sol";
import {AdapterDefinitionLib} from "../src/libraries/AdapterDefinitionLib.sol";
import {BenchmarkDefinitionLib} from "../src/libraries/BenchmarkDefinitionLib.sol";
import {CalendarDefinitionLib} from "../src/libraries/CalendarDefinitionLib.sol";
import {FeeEngineLib} from "../src/libraries/FeeEngineLib.sol";
import {FeeScheduleDefinitionLib} from "../src/libraries/FeeScheduleDefinitionLib.sol";
import {InstrumentDefinitionLib} from "../src/libraries/InstrumentDefinitionLib.sol";
import {MarketDefinitionLib} from "../src/libraries/MarketDefinitionLib.sol";
import {RiskDomainDefinitionLib} from "../src/libraries/RiskDomainDefinitionLib.sol";
import {SeriesDefinitionLib} from "../src/libraries/SeriesDefinitionLib.sol";
import {SessionDefinitionLib} from "../src/libraries/SessionDefinitionLib.sol";
import {CappedForwardPayoffModule} from "../src/payoff/ProductionPayoffModules.sol";
import {ExecutionPolicyRegistry} from "../src/policy/ExecutionPolicyRegistry.sol";
import {FullyCollateralizedRiskAdapter} from "../src/risk/FullyCollateralizedRiskAdapter.sol";
import {AdapterDefinition} from "../src/types/AdapterDefinition.sol";
import {AssetDefinition} from "../src/types/AssetDefinition.sol";
import {BenchmarkDefinition} from "../src/types/BenchmarkDefinition.sol";
import {CalendarDefinition} from "../src/types/CalendarDefinition.sol";
import {AssetClass} from "../src/types/Enums.sol";
import {FeeRecipient, FeeRecipientSet, FeeRule, FeeTier} from "../src/types/FeeEngineTypes.sol";
import {FeeScheduleDefinition} from "../src/types/FeeScheduleDefinition.sol";
import {
    AccountId,
    AdapterId,
    AdapterKindId,
    AssetId,
    BenchmarkId,
    CalendarId,
    FeeActionId,
    FeeRemainderPolicyId,
    FeeScheduleId,
    InstrumentId,
    MarketId,
    PayoffFamilyId,
    RiskDomainId,
    SeriesId,
    SessionId
} from "../src/types/Identifiers.sol";
import {InstrumentDefinition} from "../src/types/InstrumentDefinition.sol";
import {MarketDefinition} from "../src/types/MarketDefinition.sol";
import {OrderActionId} from "../src/types/OrderTypes.sol";
import {
    CanonicalFixing,
    PayoffFixingRequirement,
    PayoffKind,
    StrategyCompileInput,
    StrategyCompileResult,
    StrategyInputMode
} from "../src/types/PayoffTypes.sol";
import {RiskDomainDefinition} from "../src/types/RiskDomainDefinition.sol";
import {SeriesDefinition} from "../src/types/SeriesDefinition.sol";
import {SeriesQualificationData} from "../src/types/SeriesQualification.sol";
import {SessionDefinition, SessionWindow} from "../src/types/SessionDefinition.sol";
import {SettlementAssetDefinition} from "../src/types/SettlementAssetDefinition.sol";
import {FeeRatePpm, Lots, PriceTicks, TickSizeMinor} from "../src/types/Units.sol";

/// @notice Registers a network market listing (`deployments/<network>/markets.json`) on a deployed Setryn core and writes
/// the runtime file (schema 11) and the session-day proofs the app, the operator, and anyone else use to trade it.
///
/// @dev Each listing market becomes one market and one series of a cash-settled dated range forward: the long receives
/// lot x clamp(S_T - floor, 0, cap - floor) in USDC at expiry. The series is compiled as a CappedForward on the family's
/// benchmark struck at the floor with multiplier lot (in USDC minor units per 1e8 of the fixing), a minimum transfer of
/// zero and a maximum transfer of the band lot x (cap - floor): the long's terminal debit is zero (it pays the forward
/// price at the fill), the short's is the band. Prices are quoted as the forward level F; onchain ticks are
/// (F - floor) / tick price, bounded to [0, band / tick size], so consideration per lot is lot x (F - floor).
///
/// @dev Fixings come from a SignedObservationFixingAdapter over the configured publisher set: the last observation at or
/// before 07:59:59 UTC on the expiry day, attested by at least `threshold` publishers (the operator relays the Chainlink
/// Arbitrum One answer in force at that instant). Risk is the FullyCollateralizedRiskAdapter. The calendar and session
/// are continuous UTC from the listing day to two days after the last expiry, committed as Merkle roots of one leaf per
/// day; the session days from today through three days ahead are published here, and later days by anyone (the keeper
/// sweep, or PublishSessionDays.s.sol) from the session-day proofs file.
///
/// @dev Chains: the local devnet (31337, 1337) deploys DevnetSettlementToken as its mintable USDC unless
/// SETRYN_SETTLEMENT_TOKEN names one; Arbitrum Sepolia (421614) requires SETRYN_SETTLEMENT_TOKEN to be Circle's test USDC;
/// Arbitrum One is refused until mainnet work is explicitly authorized. Every registration is broadcast by the governance
/// operator. Activations go directly from the operator where it holds the registries' status roles (local devnets) and
/// otherwise through RegistryStatusController.govern from its governance principal, which must be able to sign in this run.
contract BootstrapSetrynMarkets is Script {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42_161;
    uint256 private constant ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;
    uint256 private constant ANVIL_CHAIN_ID = 31_337;
    uint256 private constant GANACHE_CHAIN_ID = 1_337;
    /// Circle's USDC on Arbitrum Sepolia, the only settlement token the Sepolia listing accepts.
    address internal constant ARBITRUM_SEPOLIA_USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    uint8 private constant USDC_DECIMALS = 6;
    uint32 private constant VERSION = 1;
    uint32 private constant PUBLISHED_DAYS_AHEAD = 3;

    bytes32 private constant NAMESPACE = keccak256("SETRYN_NETWORK_MARKETS_V1");
    /// The fixing engine admits only adapters registered under its observation-batch interface.
    bytes32 private constant BENCHMARK_INTERFACE =
        keccak256("SetrynFixingObservationAdapterV1.validateObservationBatch");
    bytes32 private constant RISK_INTERFACE = keccak256("SETRYN_PORTFOLIO_RISK_INTERFACE_V1");
    bytes32 private constant RISK_CAPABILITY = keccak256("SETRYN_FULLY_COLLATERALIZED_RISK_V1");
    bytes32 private constant PAYOFF_INTERFACE = keccak256("SETRYN_SERIES_PAYOFF_INTERFACE_V1");
    bytes32 private constant PAYOFF_CAPABILITY = keccak256("SETRYN_EXACT_LOTS_PAYOFF_V1");
    uint8 private constant FIXING_DECIMALS = 8;
    bytes32 private constant FEE_RECIPIENT_ACCOUNT_SALT = keccak256("SETRYN_PROTOCOL_FEES_NETWORK_V1");
    /// Anvil development account #9, the local treasury controller (see BootstrapSetrynDevnet).
    address private constant DEFAULT_LOCAL_TREASURY_CONTROLLER = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720;

    error MainnetBootstrapDisabled(uint256 chainId);
    error UnsupportedChain(uint256 chainId);
    error InvalidSettlementToken(address token);
    error InvalidTreasuryController(address treasuryController, address operator);
    error InvalidOracleSigners(uint256 count, uint256 threshold);
    error DuplicateOracleSigner(address signer);
    error InvalidDependency(string name);
    error InvalidStatusController(address controller);
    error UnexpectedVersion(string name, uint32 version);
    error SessionWindowHashMismatch(bytes32 registry, bytes32 local);
    error UnexpectedRegistration(string name);

    struct Contracts {
        IAssetRegistry assets;
        IAdapterRegistry adapters;
        ICalendarRegistry calendars;
        ISessionRegistry sessions;
        ISettlementAssetRegistry settlementAssets;
        IBenchmarkRegistry benchmarks;
        IFeeScheduleRegistry fees;
        IRiskDomainRegistry risks;
        IInstrumentRegistry instruments;
        IMarketRegistry markets;
        ISeriesRegistry series;
        CanonicalStrategyCompiler compiler;
        CappedForwardPayoffModule payoffModule;
        ExecutionPolicyRegistry executionPolicy;
        ITradingSessionPolicy tradingSessionPolicy;
        ICollateralVault collateralVault;
        FundedFeeEngine fundedFeeEngine;
        address portfolioRiskEngine;
        address riskAdmissionBindingRegistry;
        address orderState;
        address atomicClearingEngine;
        address privateRfqValidationGate;
        address privateRfqBook;
        address publicOrderBook;
        address positionEngine;
        address lifecyclePolicyValidator;
        address signedLifecycleEngine;
    }

    /// Everything the bootstrap needs, resolved from the environment by `run` or supplied directly by a test.
    struct BootstrapInput {
        Contracts contracts;
        address operator;
        /// Controller of the protocol fee recipient account. The operator creates the account and proposes this
        /// address; with `acceptTreasuryControl` the treasury accepts in the same run (it must be able to sign here).
        address treasuryController;
        bool acceptTreasuryControl;
        uint64 observationAge;
        /// Zero deploys the mintable devnet USDC (local chains only).
        address settlementToken;
        address[] oracleSigners;
        uint8 oracleThreshold;
        /// Zero when the operator holds every registry status role (local devnets); otherwise the controller whose
        /// governance principal activates each registration through `govern`.
        IRegistryStatusController statusController;
        NetworkListing.Listing listing;
    }

    /// One registered listing market: its onchain identities and the economics and schedule an order on it carries.
    struct SeriesRecord {
        NetworkListing.Market spec;
        MarketId marketId;
        uint32 marketVersion;
        SeriesId seriesId;
        uint32 seriesVersion;
        BenchmarkId benchmarkId;
        bytes payoffTerms;
        uint128 maxLongDebitMinorPerLot;
        uint128 maxShortDebitMinorPerLot;
        NetworkSeriesQualification.Schedule schedule;
    }

    struct Runtime {
        address settlementToken;
        SignedObservationFixingAdapter fixingAdapter;
        FullyCollateralizedRiskAdapter riskAdapter;
        address[] oracleSigners;
        uint8 oracleThreshold;
        AssetId settlementAssetId;
        AssetId baseAssetId;
        AdapterId benchmarkAdapterId;
        AdapterId riskAdapterId;
        AdapterId payoffAdapterId;
        CalendarId calendarId;
        SessionId sessionId;
        BenchmarkId benchmarkId;
        FeeScheduleId feeScheduleId;
        RiskDomainId riskDomainId;
        InstrumentId instrumentId;
        AccountId feeRecipientAccountId;
        address treasuryController;
        uint32 feeScheduleVersion;
        /// The UTC day the bootstrap ran.
        uint32 day;
        NetworkSeriesQualification.Horizon horizon;
        /// The days this run published, [firstPublishedDay, lastPublishedDay].
        uint32 firstPublishedDay;
        uint32 lastPublishedDay;
        SeriesRecord[] series;
    }

    /// Signing principals of one run. `governance` is zero when the operator activates directly.
    struct Principals {
        address operator;
        address governance;
        IRegistryStatusController controller;
    }

    function run() external returns (Runtime memory runtime) {
        BootstrapInput memory input;
        input.contracts = _loadContracts();
        input.operator = vm.envAddress("SETRYN_GOVERNANCE_OPERATOR");
        bool localChain = _isLocalChain();
        input.treasuryController = localChain
            ? vm.envOr("SETRYN_TREASURY_CONTROLLER", DEFAULT_LOCAL_TREASURY_CONTROLLER)
            : vm.envAddress("SETRYN_TREASURY_CONTROLLER");
        input.acceptTreasuryControl = vm.envOr("SETRYN_TREASURY_ACCEPT_CONTROL", localChain);
        input.observationAge = uint64(vm.envOr("SETRYN_MAXIMUM_RISK_OBSERVATION_AGE", uint256(5 minutes)));
        input.settlementToken = vm.envOr("SETRYN_SETTLEMENT_TOKEN", address(0));
        address[] memory defaultSigners = new address[](1);
        defaultSigners[0] = input.operator;
        input.oracleSigners = localChain
            ? vm.envOr("SETRYN_ORACLE_SIGNERS", ",", defaultSigners)
            : vm.envAddress("SETRYN_ORACLE_SIGNERS", ",");
        input.oracleThreshold = uint8(vm.envOr("SETRYN_ORACLE_THRESHOLD", uint256(1)));
        input.statusController = IRegistryStatusController(vm.envOr("SETRYN_REGISTRY_STATUS_CONTROLLER", address(0)));
        input.listing = NetworkListing.read(vm.readFile(vm.envString("SETRYN_MARKET_LISTING")));

        runtime = bootstrap(input);
        NetworkRuntimeOutput.CoreAddresses memory core = _runtimeAddresses(input.contracts);
        NetworkRuntimeOutput.writeRuntime(
            core,
            NetworkRuntimeOutput.extrasFromEnvironment(),
            runtime,
            input.operator,
            input.listing,
            vm.envOr("SETRYN_SESSION_DAYS_RELATIVE_PATH", string("session-days.json")),
            vm.envString("SETRYN_RUNTIME_OUTPUT")
        );
        NetworkRuntimeOutput.writeSessionDays(core, runtime, vm.envString("SETRYN_SESSION_DAYS_OUTPUT"));
    }

    /// Qualifies the listing as the operator, activates it through the status path, publishes the next session days,
    /// and hands the fee recipient account to the treasury.
    function bootstrap(BootstrapInput memory input) public returns (Runtime memory runtime) {
        string memory network = _requireSupportedChain();
        if (input.treasuryController == address(0) || input.treasuryController == input.operator) {
            revert InvalidTreasuryController(input.treasuryController, input.operator);
        }
        NetworkListing.validate(input.listing, network, block.timestamp);
        Contracts memory c = input.contracts;
        Principals memory principals = _principals(c, input);
        runtime.oracleSigners = _sortedSigners(input.oracleSigners, input.oracleThreshold);
        runtime.oracleThreshold = input.oracleThreshold;
        runtime.day = uint32(block.timestamp / 1 days);
        runtime.horizon = _horizon(input.listing, runtime.day);

        vm.startBroadcast(input.operator);
        runtime.settlementToken = _settlementToken(input.settlementToken);
        runtime.fixingAdapter = new SignedObservationFixingAdapter(
            runtime.oracleSigners, runtime.oracleThreshold, NetworkMarketPolicy.SIGNED_FIXING_CAPABILITY
        );
        runtime.riskAdapter = new FullyCollateralizedRiskAdapter(c.risks, c.adapters, input.observationAge);
        _registerSettlementAsset(c, principals, runtime);
        _registerAdapters(c, principals, runtime);
        _registerCalendarAndSession(c, principals, runtime);
        BenchmarkId[] memory familyBenchmarks = new BenchmarkId[](input.listing.families.length);
        AssetId[] memory familyAssets = new AssetId[](input.listing.families.length);
        for (uint256 i; i < input.listing.families.length; ++i) {
            (familyAssets[i], familyBenchmarks[i]) = _registerFamily(c, principals, runtime, input.listing.families[i]);
        }
        runtime.baseAssetId = familyAssets[input.listing.markets[0].family];
        runtime.benchmarkId = familyBenchmarks[input.listing.markets[0].family];
        // The operator creates the protocol fee account, so its id stays derivable from the operator and the salt, and
        // immediately proposes the treasury as its controller. Fees credit the account whoever controls it; only the
        // controller can withdraw them.
        runtime.feeRecipientAccountId = c.collateralVault.createAccount(FEE_RECIPIENT_ACCOUNT_SALT);
        c.collateralVault.proposeController(runtime.feeRecipientAccountId, input.treasuryController);
        runtime.treasuryController = input.treasuryController;
        _registerFeeSchedule(c, principals, runtime);
        runtime.riskDomainId = _registerRiskDomain(c, principals, runtime);
        runtime.instrumentId = _registerInstrument(c, principals, runtime);

        bytes32[][] memory calendar = NetworkSeriesQualification.calendarTree(runtime.horizon);
        runtime.series = new SeriesRecord[](input.listing.markets.length);
        for (uint256 i; i < input.listing.markets.length; ++i) {
            NetworkListing.Market memory spec = input.listing.markets[i];
            runtime.series[i] = _registerMarketSeries(
                c,
                principals,
                runtime,
                calendar,
                spec,
                input.listing.listedAt,
                familyAssets[spec.family],
                familyBenchmarks[spec.family]
            );
        }
        c.executionPolicy
            .setExecutionMode(
                NetworkMarketPolicy.EXECUTION_MODE_SET, NetworkMarketPolicy.EXECUTION_MODE_PUBLIC_BOOK, true
            );
        c.executionPolicy
            .setExecutionMode(
                NetworkMarketPolicy.EXECUTION_MODE_SET, NetworkMarketPolicy.EXECUTION_MODE_PRIVATE_RFQ, true
            );
        c.executionPolicy
            .setPolicyTag(NetworkMarketPolicy.PRIVACY_MODE_POLICY, NetworkMarketPolicy.PRIVACY_MODE_BLIND, true);
        c.executionPolicy
            .setPolicyTag(NetworkMarketPolicy.DISCLOSURE_POLICY, NetworkMarketPolicy.DISCLOSURE_BLIND_QUALIFIED, true);
        c.executionPolicy.setOrderAction(OrderActionId.wrap(NetworkMarketPolicy.ENTER_ACTION), true);
        _publishSessionDays(c, runtime);
        vm.stopBroadcast();

        if (input.acceptTreasuryControl) {
            vm.startBroadcast(input.treasuryController);
            c.collateralVault.acceptController(runtime.feeRecipientAccountId);
            vm.stopBroadcast();
            (address controller,) = c.collateralVault.getAccount(runtime.feeRecipientAccountId);
            if (controller != input.treasuryController) revert InvalidTreasuryController(controller, input.operator);
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Chain, principals and inputs

    function _requireSupportedChain() private view returns (string memory network) {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID) revert MainnetBootstrapDisabled(block.chainid);
        if (block.chainid == ARBITRUM_SEPOLIA_CHAIN_ID) return "arbitrum-sepolia";
        if (_isLocalChain()) return "local";
        revert UnsupportedChain(block.chainid);
    }

    function _isLocalChain() private view returns (bool) {
        return block.chainid == ANVIL_CHAIN_ID || block.chainid == GANACHE_CHAIN_ID;
    }

    /// The local devnet mints its own USDC; Arbitrum Sepolia settles in Circle's test USDC and nothing else.
    function _settlementToken(address configured) private returns (address token) {
        if (configured == address(0)) {
            if (!_isLocalChain()) revert InvalidSettlementToken(configured);
            return address(new DevnetSettlementToken());
        }
        if (block.chainid == ARBITRUM_SEPOLIA_CHAIN_ID && configured != ARBITRUM_SEPOLIA_USDC) {
            revert InvalidSettlementToken(configured);
        }
        if (configured.code.length == 0 || IERC20Metadata(configured).decimals() != USDC_DECIMALS) {
            revert InvalidSettlementToken(configured);
        }
        return configured;
    }

    /// Activates directly when the operator holds the status roles; otherwise through the status controller.
    function _principals(Contracts memory c, BootstrapInput memory input)
        private
        view
        returns (Principals memory principals)
    {
        principals.operator = input.operator;
        bytes32 statusRole = keccak256("SETRYN_ADAPTER_STATUS_MANAGER_ROLE");
        if (IAccessControl(address(c.adapters)).hasRole(statusRole, input.operator)) return principals;
        IRegistryStatusController controller = input.statusController;
        if (
            address(controller).code.length == 0
                || controller.registryKind(address(c.series)) != IRegistryStatusController.RegistryKind.Series
                || !IAccessControl(address(c.adapters)).hasRole(statusRole, address(controller))
        ) revert InvalidStatusController(address(controller));
        principals.controller = controller;
        principals.governance = controller.governance();
    }

    /// The oracle publishers in the strictly increasing order the adapter requires.
    function _sortedSigners(address[] memory signers, uint8 threshold) private pure returns (address[] memory sorted) {
        if (signers.length == 0 || signers.length > 16 || threshold == 0 || threshold > signers.length) {
            revert InvalidOracleSigners(signers.length, threshold);
        }
        sorted = new address[](signers.length);
        for (uint256 i; i < signers.length; ++i) {
            address signer = signers[i];
            uint256 j = i;
            while (j > 0 && sorted[j - 1] > signer) {
                sorted[j] = sorted[j - 1];
                --j;
            }
            sorted[j] = signer;
        }
        for (uint256 i = 1; i < sorted.length; ++i) {
            if (sorted[i] == sorted[i - 1]) revert DuplicateOracleSigner(sorted[i]);
        }
    }

    /// From the listing day (or today, if earlier) to two days after the last expiry.
    function _horizon(NetworkListing.Listing memory listing, uint32 today)
        private
        pure
        returns (NetworkSeriesQualification.Horizon memory horizon)
    {
        uint32 listingDay = uint32(listing.listedAt / 1 days);
        horizon.fromDay = listingDay < today ? listingDay : today;
        for (uint256 i; i < listing.markets.length; ++i) {
            uint32 expiryDay = uint32(listing.markets[i].expiryAt / 1 days);
            if (expiryDay > horizon.throughDay) horizon.throughDay = expiryDay;
        }
        horizon.throughDay += NetworkSeriesQualification.HORIZON_TAIL_DAYS;
    }

    /// Sends one status call: as the operator on a local devnet, else as status governance through the controller.
    function _activate(Principals memory principals, address registry, bytes memory data) private {
        if (address(principals.controller) == address(0)) {
            (bool success, bytes memory result) = registry.call(data);
            if (!success) {
                assembly ("memory-safe") {
                    revert(add(result, 0x20), mload(result))
                }
            }
            return;
        }
        vm.stopBroadcast();
        vm.broadcast(principals.governance);
        principals.controller.govern(registry, data);
        vm.startBroadcast(principals.operator);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Registrations

    function _registerSettlementAsset(Contracts memory c, Principals memory principals, Runtime memory runtime)
        private
    {
        runtime.settlementAssetId = c.assets
            .registerAsset(
                AssetDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256("SETRYN_ASSET_USDC"),
                    symbol: bytes32("USDC"),
                    assetClass: AssetClass.Stablecoin,
                    decimals: USDC_DECIMALS
                })
            );
        uint32 version = c.settlementAssets
            .registerBinding(
                SettlementAssetDefinition({
                    assetId: runtime.settlementAssetId,
                    token: runtime.settlementToken,
                    expectedRuntimeCodeHash: runtime.settlementToken.codehash,
                    qualificationHash: keccak256(
                        abi.encode("SETRYN_USDC_SETTLEMENT_BINDING_V1", block.chainid, runtime.settlementToken)
                    )
                })
            );
        _requireVersion("settlement asset", version);
        _activate(
            principals,
            address(c.settlementAssets),
            abi.encodeCall(ISettlementAssetRegistry.activateBinding, (runtime.settlementAssetId, version))
        );
    }

    function _registerAdapters(Contracts memory c, Principals memory principals, Runtime memory runtime) private {
        bytes32 fixingConfiguration = runtime.fixingAdapter.configurationHash();
        (runtime.benchmarkAdapterId,) = c.adapters
            .registerAdapter(
                _adapter(
                    keccak256("SETRYN_ADAPTER_SIGNED_OBSERVATION_FIXING"),
                    AdapterDefinitionLib.ADAPTER_KIND_BENCHMARK,
                    address(runtime.fixingAdapter),
                    BENCHMARK_INTERFACE,
                    NetworkMarketPolicy.SIGNED_FIXING_CAPABILITY,
                    runtime.fixingAdapter.CONFIGURATION_TYPEHASH(),
                    fixingConfiguration
                )
            );
        (runtime.riskAdapterId,) = c.adapters
            .registerAdapter(
                _adapter(
                    keccak256("SETRYN_ADAPTER_FULLY_COLLATERALIZED_RISK"),
                    AdapterDefinitionLib.ADAPTER_KIND_RISK,
                    address(runtime.riskAdapter),
                    RISK_INTERFACE,
                    RISK_CAPABILITY,
                    keccak256(
                        "SetrynFullyCollateralizedRiskConfigurationV1(address riskDomainRegistry,address adapterRegistry,uint64 maximumObservationAge)"
                    ),
                    keccak256(
                        abi.encode(
                            address(runtime.riskAdapter.riskDomainRegistry()),
                            address(runtime.riskAdapter.adapterRegistry()),
                            runtime.riskAdapter.maximumObservationAge()
                        )
                    )
                )
            );
        (runtime.payoffAdapterId,) = c.adapters
            .registerAdapter(
                _adapter(
                    keccak256("SETRYN_ADAPTER_CAPPED_FORWARD"),
                    AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
                    address(c.payoffModule),
                    PAYOFF_INTERFACE,
                    PAYOFF_CAPABILITY,
                    keccak256("SETRYN_CAPPED_FORWARD_PAYOFF_CONFIGURATION_V1"),
                    keccak256(abi.encode(address(c.payoffModule)))
                )
            );
        AdapterId[3] memory ids = [runtime.benchmarkAdapterId, runtime.riskAdapterId, runtime.payoffAdapterId];
        for (uint256 i; i < ids.length; ++i) {
            _activate(
                principals, address(c.adapters), abi.encodeCall(IAdapterRegistry.activateAdapter, (ids[i], VERSION))
            );
        }
    }

    function _registerCalendarAndSession(Contracts memory c, Principals memory principals, Runtime memory runtime)
        private
    {
        CalendarDefinition memory calendar = CalendarDefinition({
            namespaceId: NAMESPACE,
            referenceId: keccak256("SETRYN_CALENDAR_CONTINUOUS_UTC"),
            timeZoneId: keccak256("Etc/UTC"),
            weekendMask: 0,
            validFromDay: runtime.horizon.fromDay,
            validThroughDay: runtime.horizon.throughDay,
            dayStatusRoot: bytes32(uint256(1)),
            ruleSetHash: keccak256("SETRYN_CONTINUOUS_CALENDAR_RULES_V1"),
            sourceHash: keccak256("SETRYN_UTC_CLOCK_V1")
        });
        runtime.horizon.calendarId = CalendarDefinitionLib.deriveCalendarId(calendar);
        calendar.dayStatusRoot = MerkleTreeLib.root(NetworkSeriesQualification.calendarTree(runtime.horizon));
        uint32 version;
        (runtime.calendarId, version) = c.calendars.registerCalendar(calendar);
        if (CalendarId.unwrap(runtime.calendarId) != CalendarId.unwrap(runtime.horizon.calendarId)) {
            revert UnexpectedRegistration("calendar");
        }
        _requireVersion("calendar", version);
        _activate(
            principals,
            address(c.calendars),
            abi.encodeCall(ICalendarRegistry.activateCalendar, (runtime.calendarId, version))
        );

        // The registry's canonical window hash must be the one the local tree commits.
        SessionWindow[] memory windows = NetworkSeriesQualification.sessionWindows(runtime.horizon.fromDay);
        bytes32 registryHash = c.sessions.hashWindows(windows);
        bytes32 localHash = NetworkSeriesQualification.hashWindows(windows);
        if (registryHash != localHash) revert SessionWindowHashMismatch(registryHash, localHash);

        SessionDefinition memory session = SessionDefinition({
            namespaceId: NAMESPACE,
            referenceId: keccak256("SETRYN_SESSION_CONTINUOUS_UTC"),
            calendarId: runtime.calendarId,
            calendarVersion: version,
            validFromDay: runtime.horizon.fromDay,
            validThroughDay: runtime.horizon.throughDay,
            dayScheduleRoot: bytes32(uint256(1)),
            windowKindSetHash: keccak256(
                abi.encode(SessionDefinitionLib.WINDOW_KIND_TRADING, SessionDefinitionLib.WINDOW_KIND_FIXING)
            ),
            ruleSetHash: keccak256("SETRYN_CONTINUOUS_SESSION_DAILY_FIXING_RULES_V1"),
            sourceHash: keccak256("SETRYN_UTC_CLOCK_V1")
        });
        SessionId sessionId = SessionDefinitionLib.deriveSessionId(session);
        session.dayScheduleRoot = MerkleTreeLib.root(NetworkSeriesQualification.sessionTree(sessionId, runtime.horizon));
        (runtime.sessionId, version) = c.sessions.registerSession(session);
        if (SessionId.unwrap(runtime.sessionId) != SessionId.unwrap(sessionId)) {
            revert UnexpectedRegistration("session");
        }
        _requireVersion("session", version);
        _activate(
            principals,
            address(c.sessions),
            abi.encodeCall(ISessionRegistry.activateSession, (runtime.sessionId, version))
        );
    }

    /// One base asset and one settlement fixing benchmark served by the signed-observation adapter.
    function _registerFamily(
        Contracts memory c,
        Principals memory principals,
        Runtime memory runtime,
        NetworkListing.Family memory family
    ) private returns (AssetId assetId, BenchmarkId benchmarkId) {
        assetId = c.assets
            .registerAsset(
                AssetDefinition({
                    namespaceId: NAMESPACE,
                    referenceId: keccak256(abi.encodePacked("SETRYN_ASSET_", family.symbol)),
                    symbol: bytes32(bytes(family.symbol)),
                    assetClass: AssetClass(family.assetClass),
                    decimals: FIXING_DECIMALS
                })
            );
        string memory pair = string.concat(family.symbol, "_USD");
        BenchmarkDefinition memory definition = BenchmarkDefinition({
            namespaceId: NAMESPACE,
            referenceId: keccak256(abi.encodePacked("SETRYN_BENCHMARK_", pair)),
            kindId: BenchmarkDefinitionLib.BENCHMARK_KIND_SETTLEMENT_FIXING,
            baseAssetId: assetId,
            quoteAssetId: runtime.settlementAssetId,
            adapterId: runtime.benchmarkAdapterId,
            adapterVersion: VERSION,
            calendarId: runtime.calendarId,
            calendarVersion: VERSION,
            sessionId: runtime.sessionId,
            sessionVersion: VERSION,
            feedKey: keccak256(bytes(family.feedKey)),
            requiredInterfaceHash: BENCHMARK_INTERFACE,
            requiredCapabilityHash: NetworkMarketPolicy.SIGNED_FIXING_CAPABILITY,
            outputDecimals: FIXING_DECIMALS,
            // The reference aggregators update on deviation with up to a one-day heartbeat.
            maxStalenessSeconds: 1 days,
            maxFutureSkewSeconds: 5,
            maxConfidenceBps: 100,
            // The methodology publishers attest: the answer of this Chainlink aggregator on Arbitrum One in force at the
            // candidate's target time. The benchmark version hash commits it, and every signed batch commits that hash.
            observationRuleHash: keccak256(
                abi.encode(
                    "SETRYN_CHAINLINK_REFERENCE_IN_FORCE_AT_TARGET_V1",
                    NetworkListing.REFERENCE_CHAIN_ID,
                    family.referenceFeed,
                    FIXING_DECIMALS
                )
            ),
            fallbackPolicyHash: keccak256(abi.encodePacked("SETRYN_", pair, "_TERMINAL_FALLBACK_FLAT_V1")),
            disruptionPolicyHash: keccak256(abi.encodePacked("SETRYN_", pair, "_DISRUPTION_FLAT_V1")),
            dataRightsHash: keccak256("SETRYN_CHAINLINK_PUBLIC_REFERENCE_DATA_V1"),
            evidenceHash: keccak256(abi.encode("SETRYN_NETWORK_BENCHMARK_EVIDENCE_V1", pair, family.referenceFeed))
        });
        uint32 version;
        (benchmarkId, version) = c.benchmarks.registerBenchmark(definition);
        _requireVersion("benchmark", version);
        _activate(
            principals,
            address(c.benchmarks),
            abi.encodeCall(IBenchmarkRegistry.activateBenchmark, (benchmarkId, version))
        );
    }

    function _registerFeeSchedule(Contracts memory c, Principals memory principals, Runtime memory runtime) private {
        (FeeRule[] memory rules, FeeRecipientSet memory recipients) = _feeWitness(runtime.feeRecipientAccountId);
        FeeScheduleDefinition memory definition = FeeScheduleDefinition({
            namespaceId: NAMESPACE,
            scheduleKey: keccak256("SETRYN_FEE_SCHEDULE_STANDARD_V1"),
            feeModelId: FeeScheduleDefinitionLib.FEE_MODEL_MAKER_TAKER,
            settlementAssetId: runtime.settlementAssetId,
            settlementAssetVersion: VERSION,
            feeRulesHash: FeeEngineLib.hashRules(rules),
            recipientsHash: FeeEngineLib.hashRecipients(recipients),
            maxChargeRatePpm: FeeRatePpm.wrap(10_000),
            maxRebateRatePpm: FeeRatePpm.wrap(5_000),
            maxFlatChargeBaseUnits: 10e6,
            maxFlatRebateBaseUnits: 5e6,
            evidenceHash: keccak256("SETRYN_FEE_SCHEDULE_EVIDENCE_V1")
        });
        uint32 version;
        (runtime.feeScheduleId, version) = c.fees.registerFeeSchedule(definition);
        _requireVersion("fee schedule", version);
        _activate(
            principals,
            address(c.fees),
            abi.encodeCall(IFeeScheduleRegistry.activateFeeSchedule, (runtime.feeScheduleId, version))
        );
        runtime.feeScheduleVersion = version;
        c.fundedFeeEngine.installScheduleWitness(runtime.feeScheduleId, version, rules, recipients);
    }

    function _feeWitness(AccountId recipientAccountId)
        private
        pure
        returns (FeeRule[] memory rules, FeeRecipientSet memory recipients)
    {
        rules = new FeeRule[](2);
        rules[0] = FeeRule({
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_MAKER_FILL,
            requiresOpenSchedule: true,
            chargeRatePpm: FeeRatePpm.wrap(NetworkMarketPolicy.MAKER_FEE_RATE_PPM),
            rebateRatePpm: FeeRatePpm.wrap(0),
            flatChargeMinor: 0,
            flatRebateMinor: 0,
            tiers: new FeeTier[](0)
        });
        rules[1] = FeeRule({
            actionId: FeeScheduleDefinitionLib.FEE_ACTION_TAKER_FILL,
            requiresOpenSchedule: true,
            chargeRatePpm: FeeRatePpm.wrap(NetworkMarketPolicy.TAKER_FEE_RATE_PPM),
            rebateRatePpm: FeeRatePpm.wrap(0),
            flatChargeMinor: 0,
            flatRebateMinor: 0,
            tiers: new FeeTier[](0)
        });
        if (FeeActionId.unwrap(rules[0].actionId) > FeeActionId.unwrap(rules[1].actionId)) {
            FeeRule memory first = rules[0];
            rules[0] = rules[1];
            rules[1] = first;
        }
        FeeRecipient[] memory entries = new FeeRecipient[](1);
        entries[0] = FeeRecipient({accountId: recipientAccountId, sharePpm: 1_000_000});
        recipients = FeeRecipientSet({
            remainderPolicyId: FeeRemainderPolicyId.wrap(keccak256("SetrynFeeRemainderPolicyV1:DesignatedRecipient")),
            remainderRecipientIndex: 0,
            recipients: entries
        });
    }

    /// Testnet-sized caps: each series' maximum order at its band fits well inside the account cap.
    function _registerRiskDomain(Contracts memory c, Principals memory principals, Runtime memory runtime)
        private
        returns (RiskDomainId id)
    {
        RiskDomainDefinition memory definition = RiskDomainDefinition({
            namespaceId: NAMESPACE,
            domainKey: keccak256("SETRYN_RISK_DOMAIN_RANGE_FORWARDS_ISOLATED_V1"),
            riskModelId: RiskDomainDefinitionLib.RISK_MODEL_ISOLATED_MARGIN,
            collateralAssetId: runtime.settlementAssetId,
            collateralAssetVersion: VERSION,
            riskAdapterId: runtime.riskAdapterId,
            riskAdapterVersion: VERSION,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_RISK,
            requiredInterfaceHash: RISK_INTERFACE,
            requiredCapabilityHash: RISK_CAPABILITY,
            marginRulesHash: keccak256("SETRYN_FULLY_COLLATERALIZED_MARGIN_RULES_V1"),
            scenarioSetHash: keccak256("SETRYN_BOUNDED_PAYOFF_SCENARIO_SET_V1"),
            concentrationRulesHash: keccak256("SETRYN_RANGE_FORWARD_CONCENTRATION_RULES_V1"),
            defaultProcessHash: keccak256("SETRYN_RANGE_FORWARD_DEFAULT_PROCESS_V1"),
            insurancePolicyHash: keccak256("SETRYN_RANGE_FORWARD_NO_INSURANCE_V1"),
            qualificationEvidenceHash: keccak256("SETRYN_RANGE_FORWARD_RISK_EVIDENCE_V1"),
            maxOpenInterestBaseUnits: 100_000_000e6,
            maxAggregateLiabilityBaseUnits: 25_000_000e6,
            maxAccountLiabilityBaseUnits: 2_500_000e6,
            maxAggregateReservationBaseUnits: 10_000_000e6,
            maxAccountReservationBaseUnits: 1_000_000e6
        });
        uint32 version;
        (id, version) = c.risks.registerRiskDomain(definition);
        _requireVersion("risk domain", version);
        _activate(principals, address(c.risks), abi.encodeCall(IRiskDomainRegistry.activateRiskDomain, (id, version)));
    }

    function _registerInstrument(Contracts memory c, Principals memory principals, Runtime memory runtime)
        private
        returns (InstrumentId id)
    {
        InstrumentDefinition memory definition = InstrumentDefinition({
            namespaceId: NAMESPACE,
            instrumentKey: keccak256("SETRYN_INSTRUMENT_DATED_RANGE_FORWARD_V1"),
            payoffFamilyId: PayoffFamilyId.wrap(keccak256("SETRYN_CAPPED_FORWARD_V1")),
            settlementClassId: InstrumentDefinitionLib.SETTLEMENT_CLASS_CASH,
            payoffModuleId: runtime.payoffAdapterId,
            payoffModuleVersion: VERSION,
            requiredAdapterKindId: AdapterDefinitionLib.ADAPTER_KIND_PAYOFF,
            requiredInterfaceHash: PAYOFF_INTERFACE,
            requiredCapabilityHash: PAYOFF_CAPABILITY,
            termsSchemaHash: NetworkSeriesQualification.TERMS_SCHEMA,
            maxFixingSlots: 4,
            maxTermsBytes: 2_048,
            maxEvaluationGas: 500_000,
            lifecyclePolicyHash: keccak256("SETRYN_DATED_RANGE_FORWARD_LIFECYCLE_V1"),
            qualificationEvidenceHash: keccak256("SETRYN_DATED_RANGE_FORWARD_INSTRUMENT_EVIDENCE_V1")
        });
        uint32 version;
        (id, version) = c.instruments.registerInstrument(definition);
        _requireVersion("instrument", version);
        _activate(
            principals, address(c.instruments), abi.encodeCall(IInstrumentRegistry.activateInstrument, (id, version))
        );
    }

    function _registerMarketSeries(
        Contracts memory c,
        Principals memory principals,
        Runtime memory runtime,
        bytes32[][] memory calendar,
        NetworkListing.Market memory spec,
        uint64 listedAt,
        AssetId baseAssetId,
        BenchmarkId benchmarkId
    ) private returns (SeriesRecord memory record) {
        record.spec = spec;
        record.benchmarkId = benchmarkId;
        record.schedule = NetworkSeriesQualification.schedule(listedAt, spec.expiryAt);
        record.marketId = _registerMarket(c, principals, runtime, spec, baseAssetId, benchmarkId);
        record.marketVersion = VERSION;
        StrategyCompileResult memory compiled = _compile(c, spec, benchmarkId);
        record.payoffTerms = compiled.canonicalTerms;
        record.maxLongDebitMinorPerLot = compiled.maxLongDebitMinorPerLot;
        record.maxShortDebitMinorPerLot = compiled.maxShortDebitMinorPerLot;

        SeriesDefinition memory definition = _seriesDefinition(runtime, record, compiled);
        SeriesQualificationData memory qualification = NetworkSeriesQualification.qualification(
            runtime.horizon, calendar, benchmarkId, definition, compiled.canonicalTerms
        );
        definition.payoffTermsHash =
            c.series.hashPayoffTerms(NetworkSeriesQualification.TERMS_SCHEMA, qualification.payoffTerms);
        definition.fixingSlotsHash = c.series.hashFixingSlots(definition, qualification.fixingSlots, 4);
        definition.dateAdjustmentEvidenceHash = c.series.hashDateProofs(definition, qualification.dateProofs);
        uint32 version;
        (record.seriesId, version) = c.series.registerSeries(definition, qualification);
        _requireVersion("series", version);
        _activate(
            principals,
            address(c.series),
            abi.encodeCall(ISeriesRegistry.activateSeries, (record.seriesId, version, qualification))
        );
        record.seriesVersion = version;
    }

    /// The range forward's tick grid: zero ticks is the floor, the last tick is the cap.
    function _registerMarket(
        Contracts memory c,
        Principals memory principals,
        Runtime memory runtime,
        NetworkListing.Market memory spec,
        AssetId baseAssetId,
        BenchmarkId benchmarkId
    ) private returns (MarketId id) {
        MarketDefinition memory definition = MarketDefinition({
            namespaceId: NAMESPACE,
            marketKey: keccak256(abi.encodePacked("SETRYN_MARKET_", spec.marketKey, "_RANGE_FORWARD_V1")),
            baseAssetId: baseAssetId,
            quoteAssetId: runtime.settlementAssetId,
            settlementAssetId: runtime.settlementAssetId,
            settlementAssetVersion: VERSION,
            markBenchmarkId: benchmarkId,
            markBenchmarkVersion: VERSION,
            tradingCalendarId: runtime.calendarId,
            tradingCalendarVersion: VERSION,
            tradingSessionId: runtime.sessionId,
            tradingSessionVersion: VERSION,
            riskDomainId: runtime.riskDomainId,
            riskDomainVersion: VERSION,
            feeScheduleId: runtime.feeScheduleId,
            feeScheduleVersion: runtime.feeScheduleVersion,
            quoteUnitId: MarketDefinitionLib.QUOTE_UNIT_SETTLEMENT_MINOR_PER_LOT,
            tickSizeMinor: TickSizeMinor.wrap(spec.tickSizeMinor),
            lotStep: Lots.wrap(1),
            minOrderLots: Lots.wrap(1),
            maxOrderLots: Lots.wrap(spec.maxOrderLots),
            minPriceTicks: PriceTicks.wrap(0),
            maxPriceTicks: PriceTicks.wrap(int128(uint128(spec.bandMinor / spec.tickSizeMinor))),
            executionModeSetHash: NetworkMarketPolicy.EXECUTION_MODE_SET,
            qualificationEvidenceHash: keccak256(
                abi.encode("SETRYN_RANGE_FORWARD_MARKET_EVIDENCE_V1", spec.marketKey, spec.floorE8, spec.capE8)
            )
        });
        uint32 version;
        (id, version) = c.markets.registerMarket(definition);
        _requireVersion("market", version);
        _activate(principals, address(c.markets), abi.encodeCall(IMarketRegistry.activateMarket, (id, version)));
    }

    /// CappedForward struck at the floor: transfer to the long per lot is (S - floor) x lot, clamped to [0, band].
    function _compile(Contracts memory c, NetworkListing.Market memory spec, BenchmarkId benchmarkId)
        private
        pure
        returns (StrategyCompileResult memory compiled)
    {
        PayoffFixingRequirement[] memory requirements = new PayoffFixingRequirement[](1);
        requirements[0] = PayoffFixingRequirement({
            slot: 0,
            benchmarkId: benchmarkId,
            benchmarkVersion: NetworkSeriesQualification.BENCHMARK_VERSION,
            windowKindId: SessionDefinitionLib.WINDOW_KIND_FIXING,
            decimals: FIXING_DECIMALS
        });
        compiled = c.compiler
            .compileStrategy(
                StrategyCompileInput({
                    kind: PayoffKind.CappedForward,
                    inputMode: StrategyInputMode.Outright,
                    valueDecimals: FIXING_DECIMALS,
                    primaryInput: int256(spec.floorE8),
                    secondaryInput: 0,
                    premiumMinorPerLot: 0,
                    multiplierNumerator: spec.payoffMultiplierNumerator,
                    multiplierDenominator: spec.payoffMultiplierDenominator,
                    minimumTransferMinorPerLot: 0,
                    maximumTransferMinorPerLot: int256(uint256(spec.bandMinor)),
                    disruptionTransferMinorPerLot: 0,
                    fixingRequirements: requirements,
                    previewFixings: new CanonicalFixing[](0),
                    previewLots: Lots.wrap(0),
                    cashPriceTicks: PriceTicks.wrap(0),
                    cashTickSizeMinor: TickSizeMinor.wrap(0)
                })
            );
        if (compiled.maxLongDebitMinorPerLot != 0 || compiled.maxShortDebitMinorPerLot != spec.bandMinor) {
            revert UnexpectedRegistration(spec.marketKey);
        }
    }

    function _seriesDefinition(
        Runtime memory runtime,
        SeriesRecord memory record,
        StrategyCompileResult memory compiled
    ) private pure returns (SeriesDefinition memory) {
        NetworkSeriesQualification.Schedule memory schedule = record.schedule;
        return SeriesDefinition({
            namespaceId: NAMESPACE,
            seriesKey: keccak256(abi.encodePacked("SETRYN_SERIES_", record.spec.marketKey, "_RANGE_FORWARD_V1")),
            marketId: record.marketId,
            marketVersion: record.marketVersion,
            instrumentId: runtime.instrumentId,
            instrumentVersion: VERSION,
            tradingStartsAt: schedule.tradingStartsAt,
            lastTradingAt: schedule.lastTradingAt,
            expiryAt: schedule.expiryAt,
            exerciseOpensAt: schedule.exerciseOpensAt,
            exerciseCutoffAt: schedule.exerciseCutoffAt,
            fixingWindowOpen: schedule.fixingWindowOpen,
            fixingWindowClose: schedule.fixingWindowClose,
            primaryEvidenceDeadline: schedule.primaryEvidenceDeadline,
            correctionCutoffAt: schedule.correctionCutoffAt,
            finalResolutionAt: schedule.finalResolutionAt,
            settlementDeadline: schedule.settlementDeadline,
            exercisePolicyId: SeriesDefinitionLib.EXERCISE_POLICY_HOLDER_ELECTION,
            automaticExerciseThresholdMinor: 0,
            disruptionOutcomeId: SeriesDefinitionLib.DISRUPTION_OUTCOME_FLAT,
            terminalDisruptionTransferMinorPerLot: 0,
            payoffTermsHash: bytes32(uint256(1)),
            fixingSlotsHash: bytes32(uint256(1)),
            dateAdjustmentEvidenceHash: bytes32(uint256(1)),
            maxLongDebitMinorPerLot: compiled.maxLongDebitMinorPerLot,
            maxShortDebitMinorPerLot: compiled.maxShortDebitMinorPerLot,
            qualificationEvidenceHash: keccak256(
                abi.encode("SETRYN_RANGE_FORWARD_SERIES_EVIDENCE_V1", record.spec.marketKey, record.spec.expiryAt)
            )
        });
    }

    /// Publishes today through three days ahead (from the horizon start if it is later), within the horizon.
    function _publishSessionDays(Contracts memory c, Runtime memory runtime) private {
        bytes32[][] memory tree = NetworkSeriesQualification.sessionTree(runtime.sessionId, runtime.horizon);
        uint32 first = runtime.day > runtime.horizon.fromDay ? runtime.day : runtime.horizon.fromDay;
        uint32 last = first + PUBLISHED_DAYS_AHEAD;
        if (last > runtime.horizon.throughDay) last = runtime.horizon.throughDay;
        for (uint32 day = first; day <= last; ++day) {
            c.tradingSessionPolicy
                .publishSessionDay(
                    runtime.sessionId,
                    VERSION,
                    NetworkSeriesQualification.sessionDay(day),
                    NetworkSeriesQualification.sessionWindows(day),
                    NetworkSeriesQualification.sessionDayProof(runtime.horizon, tree, day)
                );
        }
        runtime.firstPublishedDay = first;
        runtime.lastPublishedDay = last;
    }

    function _adapter(
        bytes32 referenceId,
        AdapterKindId kindId,
        address implementation,
        bytes32 interfaceHash,
        bytes32 capabilityHash,
        bytes32 configurationSchemaHash,
        bytes32 configurationHash
    ) private view returns (AdapterDefinition memory) {
        return AdapterDefinition({
            namespaceId: NAMESPACE,
            referenceId: referenceId,
            kindId: kindId,
            implementation: implementation,
            expectedRuntimeCodeHash: implementation.codehash,
            interfaceHash: interfaceHash,
            capabilityHash: capabilityHash,
            configurationSchemaHash: configurationSchemaHash,
            evidenceHash: keccak256(
                abi.encode("SETRYN_NETWORK_ADAPTER_EVIDENCE_V1", referenceId, implementation, configurationHash)
            )
        });
    }

    function _requireVersion(string memory name, uint32 version) private pure {
        if (version != VERSION) revert UnexpectedVersion(name, version);
    }

    function _loadContracts() private view returns (Contracts memory c) {
        c.assets = IAssetRegistry(_dependency("SETRYN_ASSET_REGISTRY"));
        c.adapters = IAdapterRegistry(_dependency("SETRYN_ADAPTER_REGISTRY"));
        c.calendars = ICalendarRegistry(_dependency("SETRYN_CALENDAR_REGISTRY"));
        c.sessions = ISessionRegistry(_dependency("SETRYN_SESSION_REGISTRY"));
        c.settlementAssets = ISettlementAssetRegistry(_dependency("SETRYN_SETTLEMENT_ASSET_REGISTRY"));
        c.benchmarks = IBenchmarkRegistry(_dependency("SETRYN_BENCHMARK_REGISTRY"));
        c.fees = IFeeScheduleRegistry(_dependency("SETRYN_FEE_SCHEDULE_REGISTRY"));
        c.risks = IRiskDomainRegistry(_dependency("SETRYN_RISK_DOMAIN_REGISTRY"));
        c.instruments = IInstrumentRegistry(_dependency("SETRYN_INSTRUMENT_REGISTRY"));
        c.markets = IMarketRegistry(_dependency("SETRYN_MARKET_REGISTRY"));
        c.series = ISeriesRegistry(_dependency("SETRYN_SERIES_REGISTRY"));
        c.compiler = CanonicalStrategyCompiler(_dependency("SETRYN_CANONICAL_STRATEGY_COMPILER"));
        c.payoffModule = CappedForwardPayoffModule(_dependency("SETRYN_CAPPED_FORWARD_PAYOFF_MODULE"));
        c.executionPolicy = ExecutionPolicyRegistry(_dependency("SETRYN_EXECUTION_POLICY_REGISTRY"));
        c.tradingSessionPolicy = ITradingSessionPolicy(_dependency("SETRYN_TRADING_SESSION_POLICY"));
        c.collateralVault = ICollateralVault(_dependency("SETRYN_COLLATERAL_VAULT"));
        c.fundedFeeEngine = FundedFeeEngine(_dependency("SETRYN_FUNDED_FEE_ENGINE"));
        c.portfolioRiskEngine = _dependency("SETRYN_PORTFOLIO_RISK_ENGINE");
        c.riskAdmissionBindingRegistry = _dependency("SETRYN_RISK_ADMISSION_BINDING_REGISTRY");
        c.orderState = _dependency("SETRYN_ORDER_STATE");
        c.atomicClearingEngine = _dependency("SETRYN_ATOMIC_CLEARING_ENGINE");
        c.privateRfqValidationGate = _dependency("SETRYN_PRIVATE_RFQ_VALIDATION_GATE");
        c.privateRfqBook = _dependency("SETRYN_PRIVATE_RFQ_BOOK");
        c.publicOrderBook = _dependency("SETRYN_PUBLIC_ORDER_BOOK");
        c.positionEngine = _dependency("SETRYN_POSITION_ENGINE");
        c.lifecyclePolicyValidator = _dependency("SETRYN_LIFECYCLE_POLICY_VALIDATOR");
        c.signedLifecycleEngine = _dependency("SETRYN_SIGNED_LIFECYCLE_ENGINE");
    }

    function _dependency(string memory name) private view returns (address dependency) {
        dependency = vm.envAddress(name);
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidDependency(name);
    }

    function _runtimeAddresses(Contracts memory c)
        private
        pure
        returns (NetworkRuntimeOutput.CoreAddresses memory addresses)
    {
        addresses = NetworkRuntimeOutput.CoreAddresses({
            assetRegistry: address(c.assets),
            adapterRegistry: address(c.adapters),
            calendarRegistry: address(c.calendars),
            sessionRegistry: address(c.sessions),
            settlementAssetRegistry: address(c.settlementAssets),
            benchmarkRegistry: address(c.benchmarks),
            feeScheduleRegistry: address(c.fees),
            riskDomainRegistry: address(c.risks),
            instrumentRegistry: address(c.instruments),
            marketRegistry: address(c.markets),
            seriesRegistry: address(c.series),
            canonicalStrategyCompiler: address(c.compiler),
            cappedForwardPayoffModule: address(c.payoffModule),
            collateralVault: address(c.collateralVault),
            fundedFeeEngine: address(c.fundedFeeEngine),
            portfolioRiskEngine: c.portfolioRiskEngine,
            riskAdmissionBindingRegistry: c.riskAdmissionBindingRegistry,
            executionPolicyRegistry: address(c.executionPolicy),
            tradingSessionPolicy: address(c.tradingSessionPolicy),
            orderState: c.orderState,
            atomicClearingEngine: c.atomicClearingEngine,
            privateRfqValidationGate: c.privateRfqValidationGate,
            privateRfqBook: c.privateRfqBook,
            publicOrderBook: c.publicOrderBook,
            positionEngine: c.positionEngine,
            lifecyclePolicyValidator: c.lifecyclePolicyValidator,
            signedLifecycleEngine: c.signedLifecycleEngine
        });
    }
}
