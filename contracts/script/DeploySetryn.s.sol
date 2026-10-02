// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {console2} from "forge-std/Script.sol";

import {ArtifactDeployer} from "./ArtifactDeployer.sol";
import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {CollateralVault} from "../src/collateral/CollateralVault.sol";
import {CapacityReservationRegistry} from "../src/capacity/CapacityReservationRegistry.sol";
import {VaultBackedBatchCapacityManager} from "../src/capacity/VaultBackedBatchCapacityManager.sol";
import {VaultBackedStreamCapacityManager} from "../src/capacity/VaultBackedStreamCapacityManager.sol";
import {SealedAuctionHouse} from "../src/auction/SealedAuctionHouse.sol";
import {BatchClearingEngine} from "../src/batch/BatchClearingEngine.sol";
import {StreamingQuoteEngine} from "../src/stream/StreamingQuoteEngine.sol";
import {QuoteSettlementRouter} from "../src/quote/QuoteSettlementRouter.sol";
import {CollateralAwareRouteEngine} from "../src/routing/CollateralAwareRouteEngine.sol";
import {ProtocolRouteLiquiditySource} from "../src/routing/ProtocolRouteLiquiditySource.sol";
import {AuctionValidationGate} from "../src/policy/AuctionValidationGate.sol";
import {IAuctionVault} from "../src/interfaces/IAuctionVault.sol";
import {VerifiableReceiptLedger} from "../src/evidence/VerifiableReceiptLedger.sol";
import {
    AsyncReceiptAuthority,
    AuctionReceiptAuthority,
    BookOrderReceiptAuthority,
    DefaultReceiptAuthority,
    FeeReceiptAuthority,
    FillReceiptAuthority,
    FixingReceiptAuthority,
    LifecycleReceiptAuthority,
    OrderReceiptAuthority,
    PositionReceiptAuthority,
    PrivacyReceiptAuthority,
    RecoveryReceiptAuthority,
    RfqReceiptAuthority,
    RiskReceiptAuthority,
    RouteReceiptAuthority,
    SettlementReceiptAuthority,
    SolverReceiptAuthority,
    StreamReceiptAuthority
} from "../src/evidence/ProtocolReceiptAuthorities.sol";
import {IAtomicClearingEngine} from "../src/interfaces/IAtomicClearingEngine.sol";
import {ICashSettlementCoordinator} from "../src/interfaces/ICashSettlementCoordinator.sol";
import {ICollateralAwareRouteEngine} from "../src/interfaces/ICollateralAwareRouteEngine.sol";
import {IDefaultProcessEngine} from "../src/interfaces/IDefaultProcessEngine.sol";
import {IFixingEngine} from "../src/interfaces/IFixingEngine.sol";
import {IFundedFeeEngine} from "../src/interfaces/IFundedFeeEngine.sol";
import {IOperationalAdapterExecutor} from "../src/interfaces/IOperationalAdapterExecutor.sol";
import {IOrderState} from "../src/interfaces/IOrderState.sol";
import {IPortfolioRiskEngine} from "../src/interfaces/IPortfolioRiskEngine.sol";
import {IPrivacyCommitmentRegistry} from "../src/interfaces/IPrivacyCommitmentRegistry.sol";
import {IPrivateRfqBook} from "../src/interfaces/IPrivateRfqBook.sol";
import {IPublicOrderBook} from "../src/interfaces/IPublicOrderBook.sol";
import {ISealedAuctionHouse} from "../src/interfaces/ISealedAuctionHouse.sol";
import {ISignedLifecycleEngine} from "../src/interfaces/ISignedLifecycleEngine.sol";
import {IStreamingQuoteEngine} from "../src/interfaces/IStreamingQuoteEngine.sol";
import {ReceiptAuthorityBinding} from "../src/types/EvidenceTypes.sol";
import {CanonicalStrategyCompiler} from "../src/compiler/CanonicalStrategyCompiler.sol";
import {DevnetSequencerUptimeFeed} from "../src/devnet/DevnetSequencerUptimeFeed.sol";
import {OperationalAdapterExecutor} from "../src/adapters/operational/OperationalAdapterExecutor.sol";
import {AtomicClearingEngine} from "../src/execution/AtomicClearingEngine.sol";
import {FundedFeeEngine} from "../src/fees/FundedFeeEngine.sol";
import {FixingEngine} from "../src/fixing/FixingEngine.sol";
import {ISequencerUptimeFeed} from "../src/interfaces/ISequencerUptimeFeed.sol";
import {IAdapterRegistry} from "../src/interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../src/interfaces/ICalendarRegistry.sol";
import {ICollateralVault} from "../src/interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../src/interfaces/IFeeScheduleRegistry.sol";
import {IFirmCapacityVault} from "../src/interfaces/IFirmCapacityVault.sol";
import {IInstrumentRegistry} from "../src/interfaces/IInstrumentRegistry.sol";
import {IMarketRegistry} from "../src/interfaces/IMarketRegistry.sol";
import {IPositionEngine} from "../src/interfaces/IPositionEngine.sol";
import {IRiskDomainRegistry} from "../src/interfaces/IRiskDomainRegistry.sol";
import {ISeriesRegistry} from "../src/interfaces/ISeriesRegistry.sol";
import {ISettlementAssetRegistry} from "../src/interfaces/ISettlementAssetRegistry.sol";
import {ISessionRegistry} from "../src/interfaces/ISessionRegistry.sol";
import {AdapterRegistry} from "../src/registry/AdapterRegistry.sol";
import {AssetRegistry} from "../src/registry/AssetRegistry.sol";
import {BenchmarkRegistry} from "../src/registry/BenchmarkRegistry.sol";
import {CalendarRegistry} from "../src/registry/CalendarRegistry.sol";
import {FeeScheduleRegistry} from "../src/registry/FeeScheduleRegistry.sol";
import {InstrumentRegistry} from "../src/registry/InstrumentRegistry.sol";
import {MarketRegistry} from "../src/registry/MarketRegistry.sol";
import {RiskDomainRegistry} from "../src/registry/RiskDomainRegistry.sol";
import {SeriesRegistry} from "../src/registry/SeriesRegistry.sol";
import {PackageRegistry} from "../src/registry/PackageRegistry.sol";
import {SessionRegistry} from "../src/registry/SessionRegistry.sol";
import {SettlementAssetRegistry} from "../src/registry/SettlementAssetRegistry.sol";
import {PositionEngine} from "../src/position/PositionEngine.sol";
import {PortfolioRiskEngine} from "../src/risk/PortfolioRiskEngine.sol";
import {PublicOrderBook} from "../src/book/PublicOrderBook.sol";
import {PrivateRfqBook} from "../src/rfq/PrivateRfqBook.sol";
import {OrderState} from "../src/orders/OrderState.sol";
import {ClearingAdmissionGate} from "../src/policy/ClearingAdmissionGate.sol";
import {ExecutionPolicyRegistry} from "../src/policy/ExecutionPolicyRegistry.sol";
import {OrderValidationGate} from "../src/policy/OrderValidationGate.sol";
import {PackageWitnessRegistry} from "../src/policy/PackageWitnessRegistry.sol";
import {PrivateRfqValidationGate} from "../src/policy/PrivateRfqValidationGate.sol";
import {PublicBookEligibilityGate} from "../src/policy/PublicBookEligibilityGate.sol";
import {RiskAdmissionBindingRegistry} from "../src/policy/RiskAdmissionBindingRegistry.sol";
import {TradingSessionPolicy} from "../src/policy/TradingSessionPolicy.sol";
import {CashSettlementCoordinator} from "../src/settlement/CashSettlementCoordinator.sol";
import {PositionLifecycleExecutor} from "../src/lifecycle/PositionLifecycleExecutor.sol";
import {SignedLifecycleEngine} from "../src/lifecycle/SignedLifecycleEngine.sol";
import {CompressionCoordinator} from "../src/lifecycle/CompressionCoordinator.sol";
import {PrivacyCommitmentRegistry} from "../src/privacy/PrivacyCommitmentRegistry.sol";
import {IRegistryStatusController} from "../src/interfaces/IRegistryStatusController.sol";
import {RegistryStatusController} from "../src/policy/RegistryStatusController.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {AccountPolicyAuthority} from "../src/policy/AccountPolicyAuthority.sol";
import {DefaultBidderGate} from "../src/policy/DefaultBidderGate.sol";
import {LifecyclePolicyValidator} from "../src/policy/LifecyclePolicyValidator.sol";
import {DefaultProcessEngine} from "../src/default/DefaultProcessEngine.sol";
import {
    BasisSpreadPayoffModule,
    CalendarSpreadPayoffModule,
    CappedForwardPayoffModule,
    CollarPayoffModule,
    CorrelationDispersionScalarPayoffModule,
    EuropeanCallPayoffModule,
    EuropeanPutPayoffModule,
    NdfPayoffModule,
    RateCapPayoffModule,
    RateCollarPayoffModule,
    RateFloorPayoffModule,
    RateForwardPayoffModule,
    WindowAverageScalarPayoffModule
} from "../src/payoff/ProductionPayoffModules.sol";
import {WindowKindId} from "../src/types/Identifiers.sol";
import {ClearingChannelKind} from "../src/types/ClearingTypes.sol";

contract DeploySetryn is ArtifactDeployer {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42161;
    uint256 private constant ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
    uint256 private constant ANVIL_CHAIN_ID = 31337;
    uint256 private constant GANACHE_CHAIN_ID = 1337;

    bytes32 private constant LOCAL_ENVIRONMENT = keccak256("local");
    bytes32 private constant ARBITRUM_SEPOLIA_ENVIRONMENT = keccak256("arbitrum-sepolia");
    /// SETRYN_SEQUENCER_UPTIME_FEED value that deploys the static DevnetSequencerUptimeFeed. Accepted on Arbitrum Sepolia
    /// only, which has no Chainlink L2 sequencer uptime feed; every other public chain must name a real feed.
    bytes32 private constant TESTNET_STATIC_SEQUENCER_FEED = keccak256("testnet-static");
    bytes32 private constant PRIVATE_RFQ_CLEARING_CAPABILITY = keccak256("SetrynPrivateRfqClearingChannelV1");
    bytes32 private constant SEALED_AUCTION_CLEARING_CAPABILITY = keccak256("SetrynSealedAuctionClearingChannelV1");

    error ArbitrumOneDeploymentDisabled();
    error EnvironmentChainMismatch(string environment, uint256 chainId);
    error UnsupportedDeploymentEnvironment(string environment);
    error BootstrapAdminMismatch(address deployer, address initialAdmin);
    error InvalidDeploymentPrincipal(address principal);
    error PrincipalSeparationRequired(address governanceAdmin, address operationalPrincipal);
    error Uint48EnvironmentValueOutOfRange(string name, uint256 value);
    error Uint64EnvironmentValueOutOfRange(string name, uint256 value);
    error InvalidSequencerUptimeFeed(address feed);
    error TestnetStaticSequencerFeedRefused(uint256 chainId);
    error InvalidStatusGovernance(address statusGovernance);
    error LocalOnlyStatusShortcut(uint256 chainId);
    error RegistryStatusRoleMisassigned(address registry, bytes32 role, address holder);
    error InvalidTreasuryController(address treasuryController);

    struct Deployment {
        AssetRegistry assetRegistry;
        AdapterRegistry adapterRegistry;
        CalendarRegistry calendarRegistry;
        SessionRegistry sessionRegistry;
        SettlementAssetRegistry settlementAssetRegistry;
        BenchmarkRegistry benchmarkRegistry;
        FeeScheduleRegistry feeScheduleRegistry;
        RiskDomainRegistry riskDomainRegistry;
        InstrumentRegistry instrumentRegistry;
        MarketRegistry marketRegistry;
        SeriesRegistry seriesRegistry;
        CollateralVault collateralVault;
        PackageRegistry packageRegistry;
        CanonicalStrategyCompiler strategyCompiler;
        PositionEngine positionEngine;
        FixingEngine fixingEngine;
        FundedFeeEngine fundedFeeEngine;
        PortfolioRiskEngine portfolioRiskEngine;
        ISequencerUptimeFeed sequencerUptimeFeed;
        ExecutionPolicyRegistry executionPolicyRegistry;
        TradingSessionPolicy tradingSessionPolicy;
        PackageWitnessRegistry packageWitnessRegistry;
        RiskAdmissionBindingRegistry riskAdmissionBindingRegistry;
        OrderValidationGate orderValidationGate;
        OrderState orderState;
        ClearingAdmissionGate clearingAdmissionGate;
        AtomicClearingEngine atomicClearingEngine;
        PrivateRfqValidationGate privateRfqValidationGate;
        PrivateRfqBook privateRfqBook;
        PublicBookEligibilityGate publicBookEligibilityGate;
        PublicOrderBook publicOrderBook;
        PositionLifecycleExecutor positionLifecycleExecutor;
        AccountPolicyAuthority accountPolicyAuthority;
        LifecyclePolicyValidator lifecyclePolicyValidator;
        SignedLifecycleEngine signedLifecycleEngine;
        CompressionCoordinator compressionCoordinator;
        DefaultBidderGate defaultBidderGate;
        DefaultProcessEngine defaultProcessEngine;
        CashSettlementCoordinator cashSettlementCoordinator;
        PrivacyCommitmentRegistry privacyCommitmentRegistry;
        OperationalAdapterExecutor operationalAdapterExecutor;
        CappedForwardPayoffModule cappedForwardPayoffModule;
        NdfPayoffModule ndfPayoffModule;
        EuropeanCallPayoffModule europeanCallPayoffModule;
        EuropeanPutPayoffModule europeanPutPayoffModule;
        CollarPayoffModule collarPayoffModule;
        RateForwardPayoffModule rateForwardPayoffModule;
        RateCapPayoffModule rateCapPayoffModule;
        RateFloorPayoffModule rateFloorPayoffModule;
        RateCollarPayoffModule rateCollarPayoffModule;
        BasisSpreadPayoffModule basisSpreadPayoffModule;
        CalendarSpreadPayoffModule calendarSpreadPayoffModule;
        WindowAverageScalarPayoffModule windowAverageScalarPayoffModule;
        CorrelationDispersionScalarPayoffModule correlationDispersionScalarPayoffModule;
        CapacityReservationRegistry capacityReservationRegistry;
        VaultBackedStreamCapacityManager streamCapacityManager;
        VaultBackedBatchCapacityManager batchCapacityManager;
        AuctionValidationGate auctionValidationGate;
        SealedAuctionHouse sealedAuctionHouse;
        StreamingQuoteEngine streamingQuoteEngine;
        QuoteSettlementRouter quoteSettlementRouter;
        BatchClearingEngine batchClearingEngine;
        ProtocolRouteLiquiditySource routeLiquiditySource;
        CollateralAwareRouteEngine routeEngine;
        address[18] receiptAuthorities;
        VerifiableReceiptLedger receiptLedger;
        RegistryStatusController registryStatusController;
    }

    struct DeploymentConfig {
        address bootstrapAdmin;
        address governanceAdmin;
        address governanceOperator;
        address guardian;
        address excessRecovery;
        address privacyKeyPublisher;
        address lifecycleWitnessStager;
        uint48 defaultAdminDelay;
        uint64 maxLockDuration;
        uint64 evaluationGasHardCap;
        uint64 maximumRiskAdapterGas;
        uint64 maximumRiskObservationAge;
        uint64 operationalReadGas;
        uint64 operationalExecutionGas;
        uint64 maximumOrderLifetime;
        uint64 maximumRfqCapacityTail;
        uint64 sequencerRecoveryGrace;
        bytes32 deploymentId;
        ISequencerUptimeFeed sequencerFeed;
        /// Governance principal of the registry status controller: the governance timelock (`governanceAdmin`) on
        /// every public environment. Local devnets may use `governanceOperator` so one sender drives bootstrap.
        address statusGovernance;
        /// Local devnet only: the governance operator also keeps every direct registry status role, so the current
        /// devnet bootstrap keeps activating registries directly until it routes through the controller.
        bool retainOperatorStatusRoles;
        /// Controller of the protocol fee recipient vault account: the Treasury Safe on every public environment, a
        /// dedicated local account on a devnet. The fee schedule qualification step creates or hands over that account
        /// to this address; the deployment itself sends no transaction for it, so it only pins and separates it here.
        address treasuryController;
    }

    function run() external returns (Deployment memory deployment) {
        string memory environment = vm.envString("SETRYN_DEPLOYMENT_ENVIRONMENT");
        _requireAllowedTarget(environment);

        address deployer = vm.envAddress("SETRYN_DEPLOYER_ADDRESS");
        address initialAdmin = vm.envAddress("SETRYN_INITIAL_ADMIN");
        if (deployer != initialAdmin) revert BootstrapAdminMismatch(deployer, initialAdmin);
        address governanceAdmin = vm.envAddress("SETRYN_GOVERNANCE_ADMIN");
        address governanceOperator = vm.envAddress("SETRYN_GOVERNANCE_OPERATOR");
        address guardian = vm.envAddress("SETRYN_GUARDIAN");
        address excessRecovery = vm.envAddress("SETRYN_EXCESS_RECOVERY_OPERATOR");
        address privacyKeyPublisher = vm.envAddress("SETRYN_PRIVACY_KEY_PUBLISHER");
        address lifecycleWitnessStager = vm.envAddress("SETRYN_LIFECYCLE_WITNESS_STAGER");
        _requireSeparatedPrincipal(deployer, governanceAdmin, governanceOperator);
        _requireSeparatedPrincipal(deployer, governanceAdmin, guardian);
        _requireSeparatedPrincipal(deployer, governanceAdmin, excessRecovery);
        _requireSeparatedPrincipal(deployer, governanceAdmin, privacyKeyPublisher);
        _requireSeparatedPrincipal(deployer, governanceAdmin, lifecycleWitnessStager);
        _requireDistinctOperationalPrincipals(
            governanceOperator, guardian, excessRecovery, privacyKeyPublisher, lifecycleWitnessStager
        );
        uint48 defaultAdminDelay = _envUint48("SETRYN_DEFAULT_ADMIN_DELAY", 2 days);
        uint64 maxLockDuration = _envUint64("SETRYN_MAX_LOCK_DURATION", 30 days);
        uint64 evaluationGasHardCap = _envUint64("SETRYN_EVALUATION_GAS_HARD_CAP");
        uint64 maximumRiskAdapterGas = _envUint64("SETRYN_MAXIMUM_RISK_ADAPTER_GAS", 500_000);
        uint64 maximumRiskObservationAge = _envUint64("SETRYN_MAXIMUM_RISK_OBSERVATION_AGE", 5 minutes);
        uint64 operationalReadGas = _envUint64("SETRYN_OPERATIONAL_READ_GAS", 500_000);
        uint64 operationalExecutionGas = _envUint64("SETRYN_OPERATIONAL_EXECUTION_GAS", 800_000);
        uint64 maximumOrderLifetime = _envUint64("SETRYN_MAXIMUM_ORDER_LIFETIME", 30 days);
        uint64 maximumRfqCapacityTail = _envUint64("SETRYN_MAXIMUM_RFQ_CAPACITY_TAIL", 1 days);
        uint64 sequencerRecoveryGrace = _envUint64("SETRYN_SEQUENCER_RECOVERY_GRACE", 1 hours);
        bytes32 deploymentId = vm.envBytes32("SETRYN_DEPLOYMENT_ID");
        // Required everywhere, with no default: a public deployment names its Treasury Safe explicitly.
        address treasuryController = vm.envAddress("SETRYN_TREASURY_CONTROLLER");

        ISequencerUptimeFeed sequencerFeed;
        bool localEnvironment = keccak256(bytes(environment)) == LOCAL_ENVIRONMENT;
        if (localEnvironment) {
            sequencerFeed = ISequencerUptimeFeed(address(0));
        } else {
            // Zero only for Arbitrum Sepolia's explicit `testnet-static` choice; the static feed is then deployed below.
            sequencerFeed = _deployOrResolveSequencerFeed(environment);
        }

        DeploymentConfig memory config = DeploymentConfig({
            bootstrapAdmin: deployer,
            governanceAdmin: governanceAdmin,
            governanceOperator: governanceOperator,
            guardian: guardian,
            excessRecovery: excessRecovery,
            privacyKeyPublisher: privacyKeyPublisher,
            lifecycleWitnessStager: lifecycleWitnessStager,
            defaultAdminDelay: defaultAdminDelay,
            maxLockDuration: maxLockDuration,
            evaluationGasHardCap: evaluationGasHardCap,
            maximumRiskAdapterGas: maximumRiskAdapterGas,
            maximumRiskObservationAge: maximumRiskObservationAge,
            operationalReadGas: operationalReadGas,
            operationalExecutionGas: operationalExecutionGas,
            maximumOrderLifetime: maximumOrderLifetime,
            maximumRfqCapacityTail: maximumRfqCapacityTail,
            sequencerRecoveryGrace: sequencerRecoveryGrace,
            deploymentId: deploymentId,
            sequencerFeed: sequencerFeed,
            statusGovernance: localEnvironment ? governanceOperator : governanceAdmin,
            retainOperatorStatusRoles: localEnvironment,
            treasuryController: treasuryController
        });

        vm.startBroadcast(deployer);
        bytes32 postWiringEvidence;
        (deployment, postWiringEvidence) = _deployAndWire(config);
        vm.stopBroadcast();

        _logDeployment(deployment);
        console2.log("TREASURY_CONTROLLER", config.treasuryController);
        console2.log("POST_WIRING_EVIDENCE_HASH");
        console2.logBytes32(postWiringEvidence);
    }

    function _deployAndWire(DeploymentConfig memory config)
        internal
        returns (Deployment memory deployment, bytes32 postWiringEvidence)
    {
        if (config.bootstrapAdmin == address(0)) revert InvalidDeploymentPrincipal(address(0));
        _requireSeparatedPrincipal(config.bootstrapAdmin, config.governanceAdmin, config.governanceOperator);
        _requireSeparatedPrincipal(config.bootstrapAdmin, config.governanceAdmin, config.guardian);
        _requireSeparatedPrincipal(config.bootstrapAdmin, config.governanceAdmin, config.excessRecovery);
        _requireSeparatedPrincipal(config.bootstrapAdmin, config.governanceAdmin, config.privacyKeyPublisher);
        _requireSeparatedPrincipal(config.bootstrapAdmin, config.governanceAdmin, config.lifecycleWitnessStager);
        _requireDistinctOperationalPrincipals(
            config.governanceOperator,
            config.guardian,
            config.excessRecovery,
            config.privacyKeyPublisher,
            config.lifecycleWitnessStager
        );
        _requireStatusControlTopology(config);
        _requireTreasuryController(config);

        ISequencerUptimeFeed resolvedFeed;
        if (address(config.sequencerFeed) == address(0)) {
            resolvedFeed =
                ISequencerUptimeFeed(address(DevnetSequencerUptimeFeed(_create("DevnetSequencerUptimeFeed", ""))));
        } else {
            if (address(config.sequencerFeed).code.length == 0) {
                revert InvalidSequencerUptimeFeed(address(config.sequencerFeed));
            }
            resolvedFeed = config.sequencerFeed;
        }

        deployment.assetRegistry =
            AssetRegistry(_create("AssetRegistry", abi.encode(config.defaultAdminDelay, config.bootstrapAdmin)));
        deployment.adapterRegistry =
            AdapterRegistry(_create("AdapterRegistry", abi.encode(config.defaultAdminDelay, config.bootstrapAdmin)));
        deployment.calendarRegistry =
            CalendarRegistry(_create("CalendarRegistry", abi.encode(config.defaultAdminDelay, config.bootstrapAdmin)));
        deployment.sessionRegistry = SessionRegistry(
            _create(
                "SessionRegistry",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    ICalendarRegistry(address(deployment.calendarRegistry))
                )
            )
        );
        deployment.settlementAssetRegistry = SettlementAssetRegistry(
            _create(
                "SettlementAssetRegistry",
                abi.encode(
                    config.defaultAdminDelay, config.bootstrapAdmin, IAssetRegistry(address(deployment.assetRegistry))
                )
            )
        );
        deployment.benchmarkRegistry = BenchmarkRegistry(
            _create(
                "BenchmarkRegistry",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    IAssetRegistry(address(deployment.assetRegistry)),
                    IAdapterRegistry(address(deployment.adapterRegistry)),
                    ICalendarRegistry(address(deployment.calendarRegistry)),
                    ISessionRegistry(address(deployment.sessionRegistry))
                )
            )
        );
        deployment.feeScheduleRegistry = FeeScheduleRegistry(
            _create(
                "FeeScheduleRegistry",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    ISettlementAssetRegistry(address(deployment.settlementAssetRegistry))
                )
            )
        );
        deployment.riskDomainRegistry = RiskDomainRegistry(
            _create(
                "RiskDomainRegistry",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    ISettlementAssetRegistry(address(deployment.settlementAssetRegistry)),
                    IAdapterRegistry(address(deployment.adapterRegistry))
                )
            )
        );
        deployment.instrumentRegistry = InstrumentRegistry(
            _create(
                "InstrumentRegistry",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    IAdapterRegistry(address(deployment.adapterRegistry)),
                    config.evaluationGasHardCap
                )
            )
        );
        deployment.collateralVault = CollateralVault(
            _create(
                "CollateralVault",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    ISettlementAssetRegistry(address(deployment.settlementAssetRegistry)),
                    IRiskDomainRegistry(address(deployment.riskDomainRegistry)),
                    config.maxLockDuration
                )
            )
        );
        deployment.marketRegistry = MarketRegistry(
            _create(
                "MarketRegistry",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    IAssetRegistry(address(deployment.assetRegistry)),
                    ISettlementAssetRegistry(address(deployment.settlementAssetRegistry)),
                    ICollateralVault(address(deployment.collateralVault)),
                    IBenchmarkRegistry(address(deployment.benchmarkRegistry)),
                    ICalendarRegistry(address(deployment.calendarRegistry)),
                    ISessionRegistry(address(deployment.sessionRegistry)),
                    IRiskDomainRegistry(address(deployment.riskDomainRegistry)),
                    IFeeScheduleRegistry(address(deployment.feeScheduleRegistry))
                )
            )
        );
        deployment.seriesRegistry = SeriesRegistry(
            _create(
                "SeriesRegistry",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    IMarketRegistry(address(deployment.marketRegistry)),
                    IInstrumentRegistry(address(deployment.instrumentRegistry))
                )
            )
        );
        deployment.packageRegistry = PackageRegistry(
            _create(
                "PackageRegistry",
                abi.encode(
                    config.defaultAdminDelay, config.bootstrapAdmin, ISeriesRegistry(address(deployment.seriesRegistry))
                )
            )
        );
        deployment.strategyCompiler = CanonicalStrategyCompiler(_create("CanonicalStrategyCompiler", ""));
        deployment.positionEngine = PositionEngine(
            _create(
                "PositionEngine",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    ISeriesRegistry(address(deployment.seriesRegistry)),
                    ICollateralVault(address(deployment.collateralVault))
                )
            )
        );
        deployment.fixingEngine =
            FixingEngine(_create("FixingEngine", abi.encode(ISeriesRegistry(address(deployment.seriesRegistry)))));
        deployment.fundedFeeEngine = FundedFeeEngine(
            _create(
                "FundedFeeEngine",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    IFeeScheduleRegistry(address(deployment.feeScheduleRegistry)),
                    ICollateralVault(address(deployment.collateralVault))
                )
            )
        );
        deployment.portfolioRiskEngine = PortfolioRiskEngine(
            _create(
                "PortfolioRiskEngine",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    IRiskDomainRegistry(address(deployment.riskDomainRegistry)),
                    IAdapterRegistry(address(deployment.adapterRegistry)),
                    ICollateralVault(address(deployment.collateralVault)),
                    IPositionEngine(address(deployment.positionEngine)),
                    config.maximumRiskAdapterGas,
                    config.maximumRiskObservationAge
                )
            )
        );
        deployment.sequencerUptimeFeed = resolvedFeed;
        deployment.executionPolicyRegistry = ExecutionPolicyRegistry(
            _create("ExecutionPolicyRegistry", abi.encode(config.defaultAdminDelay, config.bootstrapAdmin))
        );
        deployment.tradingSessionPolicy = TradingSessionPolicy(
            _create(
                "TradingSessionPolicy",
                abi.encode(
                    ISessionRegistry(address(deployment.sessionRegistry)),
                    deployment.sequencerUptimeFeed,
                    WindowKindId.wrap(keccak256("SetrynWindowKindV1:Trading")),
                    WindowKindId.wrap(keccak256("SetrynWindowKindV1:Maintenance")),
                    config.sequencerRecoveryGrace
                )
            )
        );
        deployment.packageWitnessRegistry =
            PackageWitnessRegistry(_create("PackageWitnessRegistry", abi.encode(deployment.packageRegistry)));
        deployment.riskAdmissionBindingRegistry = RiskAdmissionBindingRegistry(
            _create("RiskAdmissionBindingRegistry", abi.encode(deployment.portfolioRiskEngine, address(0)))
        );
        deployment.orderValidationGate = OrderValidationGate(
            _create(
                "OrderValidationGate",
                abi.encode(
                    deployment.seriesRegistry,
                    deployment.packageRegistry,
                    deployment.executionPolicyRegistry,
                    deployment.tradingSessionPolicy,
                    deployment.packageWitnessRegistry,
                    deployment.riskAdmissionBindingRegistry
                )
            )
        );
        deployment.orderState = OrderState(
            _create(
                "OrderState",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    deployment.orderValidationGate,
                    config.maximumOrderLifetime
                )
            )
        );
        deployment.riskAdmissionBindingRegistry.bindOrderVerifyingContract(address(deployment.orderState));
        deployment.clearingAdmissionGate = ClearingAdmissionGate(
            _create(
                "ClearingAdmissionGate",
                abi.encode(
                    deployment.seriesRegistry,
                    deployment.packageRegistry,
                    deployment.executionPolicyRegistry,
                    deployment.tradingSessionPolicy,
                    deployment.packageWitnessRegistry,
                    deployment.riskAdmissionBindingRegistry
                )
            )
        );
        deployment.atomicClearingEngine = AtomicClearingEngine(
            _create(
                "AtomicClearingEngine",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    deployment.orderState,
                    deployment.seriesRegistry,
                    deployment.packageRegistry,
                    deployment.positionEngine,
                    deployment.collateralVault,
                    deployment.clearingAdmissionGate,
                    deployment.fundedFeeEngine
                )
            )
        );
        deployment.privateRfqValidationGate = PrivateRfqValidationGate(
            _create(
                "PrivateRfqValidationGate",
                abi.encode(
                    deployment.seriesRegistry,
                    deployment.packageRegistry,
                    deployment.executionPolicyRegistry,
                    deployment.tradingSessionPolicy,
                    deployment.packageWitnessRegistry
                )
            )
        );
        deployment.privateRfqBook = PrivateRfqBook(
            _create(
                "PrivateRfqBook",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    IFirmCapacityVault(address(deployment.collateralVault)),
                    deployment.privateRfqValidationGate,
                    address(deployment.atomicClearingEngine),
                    config.maximumRfqCapacityTail
                )
            )
        );
        deployment.atomicClearingEngine
            .activateClearingChannel(
                ClearingChannelKind.PrivateRfq, deployment.privateRfqBook, PRIVATE_RFQ_CLEARING_CAPABILITY
            );
        deployment.publicBookEligibilityGate = PublicBookEligibilityGate(
            _create(
                "PublicBookEligibilityGate",
                abi.encode(
                    deployment.orderState,
                    deployment.seriesRegistry,
                    deployment.packageRegistry,
                    deployment.executionPolicyRegistry,
                    deployment.tradingSessionPolicy,
                    deployment.packageWitnessRegistry
                )
            )
        );
        deployment.publicOrderBook = PublicOrderBook(
            _create(
                "PublicOrderBook",
                abi.encode(deployment.orderState, deployment.atomicClearingEngine, deployment.publicBookEligibilityGate)
            )
        );
        deployment.positionLifecycleExecutor = PositionLifecycleExecutor(
            _create(
                "PositionLifecycleExecutor",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    IPositionEngine(address(deployment.positionEngine)),
                    deployment.portfolioRiskEngine
                )
            )
        );
        deployment.accountPolicyAuthority = AccountPolicyAuthority(
            _create("AccountPolicyAuthority", abi.encode(ICollateralVault(address(deployment.collateralVault))))
        );
        deployment.lifecyclePolicyValidator = LifecyclePolicyValidator(
            _create(
                "LifecyclePolicyValidator",
                abi.encode(IPositionEngine(address(deployment.positionEngine)), deployment.packageRegistry)
            )
        );
        deployment.signedLifecycleEngine = SignedLifecycleEngine(
            _create(
                "SignedLifecycleEngine",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    deployment.positionEngine,
                    deployment.accountPolicyAuthority,
                    deployment.lifecyclePolicyValidator,
                    deployment.positionLifecycleExecutor,
                    IRiskDomainRegistry(address(deployment.riskDomainRegistry))
                )
            )
        );
        deployment.compressionCoordinator = CompressionCoordinator(
            _create(
                "CompressionCoordinator",
                abi.encode(
                    config.defaultAdminDelay,
                    config.bootstrapAdmin,
                    deployment.positionEngine,
                    deployment.accountPolicyAuthority,
                    deployment.positionLifecycleExecutor,
                    IRiskDomainRegistry(address(deployment.riskDomainRegistry))
                )
            )
        );
        deployment.defaultBidderGate = DefaultBidderGate(
            _create(
                "DefaultBidderGate",
                abi.encode(
                    IRiskDomainRegistry(address(deployment.riskDomainRegistry)),
                    ICollateralVault(address(deployment.collateralVault))
                )
            )
        );
        deployment.defaultProcessEngine = DefaultProcessEngine(
            _create(
                "DefaultProcessEngine",
                abi.encode(
                    deployment.portfolioRiskEngine, deployment.defaultBidderGate, deployment.positionLifecycleExecutor
                )
            )
        );
        deployment.cashSettlementCoordinator = CashSettlementCoordinator(
            _create(
                "CashSettlementCoordinator",
                abi.encode(
                    IPositionEngine(address(deployment.positionEngine)),
                    deployment.fixingEngine,
                    deployment.fundedFeeEngine,
                    deployment.portfolioRiskEngine
                )
            )
        );
        deployment.privacyCommitmentRegistry = PrivacyCommitmentRegistry(
            _create("PrivacyCommitmentRegistry", abi.encode(config.defaultAdminDelay, config.bootstrapAdmin))
        );
        deployment.operationalAdapterExecutor = OperationalAdapterExecutor(
            _create(
                "OperationalAdapterExecutor",
                abi.encode(
                    IAdapterRegistry(address(deployment.adapterRegistry)),
                    config.deploymentId,
                    config.operationalReadGas,
                    config.operationalExecutionGas
                )
            )
        );
        deployment.cappedForwardPayoffModule = CappedForwardPayoffModule(_create("CappedForwardPayoffModule", ""));
        deployment.ndfPayoffModule = NdfPayoffModule(_create("NdfPayoffModule", ""));
        deployment.europeanCallPayoffModule = EuropeanCallPayoffModule(_create("EuropeanCallPayoffModule", ""));
        deployment.europeanPutPayoffModule = EuropeanPutPayoffModule(_create("EuropeanPutPayoffModule", ""));
        deployment.collarPayoffModule = CollarPayoffModule(_create("CollarPayoffModule", ""));
        deployment.rateForwardPayoffModule = RateForwardPayoffModule(_create("RateForwardPayoffModule", ""));
        deployment.rateCapPayoffModule = RateCapPayoffModule(_create("RateCapPayoffModule", ""));
        deployment.rateFloorPayoffModule = RateFloorPayoffModule(_create("RateFloorPayoffModule", ""));
        deployment.rateCollarPayoffModule = RateCollarPayoffModule(_create("RateCollarPayoffModule", ""));
        deployment.basisSpreadPayoffModule = BasisSpreadPayoffModule(_create("BasisSpreadPayoffModule", ""));
        deployment.calendarSpreadPayoffModule = CalendarSpreadPayoffModule(_create("CalendarSpreadPayoffModule", ""));
        deployment.windowAverageScalarPayoffModule =
            WindowAverageScalarPayoffModule(_create("WindowAverageScalarPayoffModule", ""));
        deployment.correlationDispersionScalarPayoffModule =
            CorrelationDispersionScalarPayoffModule(_create("CorrelationDispersionScalarPayoffModule", ""));
        _deployExecutionVenues(deployment, config.defaultAdminDelay, config.bootstrapAdmin);
        _deployReceiptLedger(deployment, config.deploymentId);
        deployment.registryStatusController = RegistryStatusController(
            _create(
                "RegistryStatusController",
                abi.encode(config.guardian, config.statusGovernance, _statusRegistryBindings(deployment))
            )
        );

        _wireInternalRoles(
            deployment,
            config.bootstrapAdmin,
            config.governanceAdmin,
            config.governanceOperator,
            config.guardian,
            config.excessRecovery,
            config.privacyKeyPublisher,
            config.lifecycleWitnessStager,
            config.retainOperatorStatusRoles
        );
        postWiringEvidence = keccak256(
            abi.encode(
                _postWiringEvidence(
                    deployment,
                    config.bootstrapAdmin,
                    config.governanceAdmin,
                    config.governanceOperator,
                    config.guardian,
                    config.excessRecovery,
                    config.privacyKeyPublisher,
                    config.lifecycleWitnessStager
                ),
                _statusControlEvidence(deployment, config)
            )
        );
    }

    /// Status principals: the guardian may only pause, the timelock may only activate, resume, or deprecate, and the
    /// operator shortcut exists only on a local devnet chain.
    function _requireStatusControlTopology(DeploymentConfig memory config) private view {
        bool localChain = block.chainid == ANVIL_CHAIN_ID || block.chainid == GANACHE_CHAIN_ID;
        if (config.statusGovernance != config.governanceAdmin) {
            if (!localChain || config.statusGovernance != config.governanceOperator) {
                revert InvalidStatusGovernance(config.statusGovernance);
            }
        }
        if (config.retainOperatorStatusRoles && !localChain) revert LocalOnlyStatusShortcut(block.chainid);
    }

    /// Every registry whose activation, pause, and deprecation share one status role, with its kind.
    function _statusRegistryBindings(Deployment memory d)
        private
        view
        returns (IRegistryStatusController.RegistryBinding[] memory bindings)
    {
        (address[13] memory registries,) = _statusRoles(d);
        IRegistryStatusController.RegistryKind[13] memory kinds = [
            IRegistryStatusController.RegistryKind.Asset,
            IRegistryStatusController.RegistryKind.Adapter,
            IRegistryStatusController.RegistryKind.Calendar,
            IRegistryStatusController.RegistryKind.Session,
            IRegistryStatusController.RegistryKind.SettlementAsset,
            IRegistryStatusController.RegistryKind.Benchmark,
            IRegistryStatusController.RegistryKind.FeeSchedule,
            IRegistryStatusController.RegistryKind.RiskDomain,
            IRegistryStatusController.RegistryKind.Instrument,
            IRegistryStatusController.RegistryKind.Market,
            IRegistryStatusController.RegistryKind.Series,
            IRegistryStatusController.RegistryKind.Package,
            IRegistryStatusController.RegistryKind.PrivacyPolicy
        ];
        bindings = new IRegistryStatusController.RegistryBinding[](registries.length);
        for (uint256 i; i < registries.length; ++i) {
            bindings[i] = IRegistryStatusController.RegistryBinding({kind: kinds[i], registry: registries[i]});
        }
    }

    /// The combined status role of each controller-held registry, in `_statusRegistryBindings` order.
    function _statusRoles(Deployment memory d)
        private
        view
        returns (address[13] memory registries, bytes32[13] memory roles)
    {
        registries = [
            address(d.assetRegistry),
            address(d.adapterRegistry),
            address(d.calendarRegistry),
            address(d.sessionRegistry),
            address(d.settlementAssetRegistry),
            address(d.benchmarkRegistry),
            address(d.feeScheduleRegistry),
            address(d.riskDomainRegistry),
            address(d.instrumentRegistry),
            address(d.marketRegistry),
            address(d.seriesRegistry),
            address(d.packageRegistry),
            address(d.privacyCommitmentRegistry)
        ];
        roles = [
            d.assetRegistry.STATUS_MANAGER_ROLE(),
            d.adapterRegistry.ADAPTER_STATUS_MANAGER_ROLE(),
            d.calendarRegistry.CALENDAR_STATUS_MANAGER_ROLE(),
            d.sessionRegistry.SESSION_STATUS_MANAGER_ROLE(),
            d.settlementAssetRegistry.STATUS_MANAGER_ROLE(),
            d.benchmarkRegistry.BENCHMARK_STATUS_MANAGER_ROLE(),
            d.feeScheduleRegistry.FEE_SCHEDULE_STATUS_MANAGER_ROLE(),
            d.riskDomainRegistry.RISK_DOMAIN_STATUS_MANAGER_ROLE(),
            d.instrumentRegistry.INSTRUMENT_STATUS_MANAGER_ROLE(),
            d.marketRegistry.MARKET_STATUS_MANAGER_ROLE(),
            d.seriesRegistry.SERIES_STATUS_MANAGER_ROLE(),
            d.packageRegistry.PACKAGE_STATUS_MANAGER_ROLE(),
            d.privacyCommitmentRegistry.POLICY_ACTIVATOR_ROLE()
        ];
    }

    /// Proves from direct reads that the controller alone (plus the local operator shortcut) holds every combined
    /// status role, that the guardian and bootstrap hold none, and that the controller is bound to exact principals.
    function _statusControlEvidence(Deployment memory d, DeploymentConfig memory config)
        private
        view
        returns (bytes32)
    {
        RegistryStatusController controller = d.registryStatusController;
        if (controller.guardian() != config.guardian || controller.governance() != config.statusGovernance) {
            revert InvalidStatusGovernance(controller.governance());
        }
        (address[13] memory registries, bytes32[13] memory roles) = _statusRoles(d);
        for (uint256 i; i < registries.length; ++i) {
            IAccessControl registry = IAccessControl(registries[i]);
            if (!registry.hasRole(roles[i], address(controller))) {
                revert RegistryStatusRoleMisassigned(registries[i], roles[i], address(controller));
            }
            if (registry.hasRole(roles[i], config.guardian)) {
                revert RegistryStatusRoleMisassigned(registries[i], roles[i], config.guardian);
            }
            if (registry.hasRole(roles[i], config.bootstrapAdmin)) {
                revert RegistryStatusRoleMisassigned(registries[i], roles[i], config.bootstrapAdmin);
            }
            if (registry.hasRole(roles[i], config.governanceOperator) != config.retainOperatorStatusRoles) {
                revert RegistryStatusRoleMisassigned(registries[i], roles[i], config.governanceOperator);
            }
        }
        return keccak256(
            abi.encode(
                address(controller),
                config.guardian,
                config.statusGovernance,
                config.retainOperatorStatusRoles,
                registries,
                roles
            )
        );
    }

    /// Capacity-backed execution venues: sealed auctions, request-for-stream quotes, batch clearing, and the
    /// collateral-aware route engine with its protocol liquidity source and shared capacity reservation registry.
    function _deployExecutionVenues(Deployment memory d, uint48 defaultAdminDelay, address bootstrapAdmin) private {
        d.capacityReservationRegistry = CapacityReservationRegistry(
            _create("CapacityReservationRegistry", abi.encode(defaultAdminDelay, bootstrapAdmin))
        );
        d.streamCapacityManager = VaultBackedStreamCapacityManager(
            _create(
                "VaultBackedStreamCapacityManager",
                abi.encode(
                    defaultAdminDelay,
                    bootstrapAdmin,
                    IPositionEngine(address(d.positionEngine)),
                    d.capacityReservationRegistry
                )
            )
        );
        d.batchCapacityManager = VaultBackedBatchCapacityManager(
            _create(
                "VaultBackedBatchCapacityManager",
                abi.encode(
                    defaultAdminDelay,
                    bootstrapAdmin,
                    IPositionEngine(address(d.positionEngine)),
                    d.capacityReservationRegistry
                )
            )
        );
        d.auctionValidationGate = AuctionValidationGate(
            _create(
                "AuctionValidationGate",
                abi.encode(
                    d.seriesRegistry,
                    d.packageRegistry,
                    d.executionPolicyRegistry,
                    d.tradingSessionPolicy,
                    d.packageWitnessRegistry
                )
            )
        );
        d.sealedAuctionHouse = SealedAuctionHouse(
            _create(
                "SealedAuctionHouse",
                abi.encode(
                    defaultAdminDelay,
                    bootstrapAdmin,
                    IAuctionVault(address(d.collateralVault)),
                    d.auctionValidationGate,
                    address(d.atomicClearingEngine)
                )
            )
        );
        d.atomicClearingEngine
            .activateClearingChannel(
                ClearingChannelKind.SealedAuction, d.sealedAuctionHouse, SEALED_AUCTION_CLEARING_CAPABILITY
            );
        d.streamingQuoteEngine = StreamingQuoteEngine(
            _create("StreamingQuoteEngine", abi.encode(d.atomicClearingEngine, d.streamCapacityManager))
        );
        d.quoteSettlementRouter = QuoteSettlementRouter(
            _create("QuoteSettlementRouter", abi.encode(d.atomicClearingEngine, d.streamCapacityManager))
        );
        d.batchClearingEngine = BatchClearingEngine(
            _create(
                "BatchClearingEngine", abi.encode(d.atomicClearingEngine, d.sealedAuctionHouse, d.batchCapacityManager)
            )
        );
        d.routeLiquiditySource = ProtocolRouteLiquiditySource(
            _create(
                "ProtocolRouteLiquiditySource",
                abi.encode(
                    defaultAdminDelay,
                    bootstrapAdmin,
                    d.publicOrderBook,
                    d.packageRegistry,
                    d.privateRfqBook,
                    d.streamingQuoteEngine,
                    d.sealedAuctionHouse,
                    ICollateralVault(address(d.collateralVault)),
                    ISessionRegistry(address(d.sessionRegistry)),
                    d.capacityReservationRegistry
                )
            )
        );
        d.routeEngine = CollateralAwareRouteEngine(
            _create(
                "CollateralAwareRouteEngine",
                abi.encode(defaultAdminDelay, bootstrapAdmin, d.routeLiquiditySource, d.portfolioRiskEngine)
            )
        );
    }

    /// Every receipt subject kind binds one terminal-state authority over its authoritative source, so receipts are
    /// accepted only against objective protocol state. Bindings are immutable and sorted by subject kind.
    function _deployReceiptLedger(Deployment memory d, bytes32 deploymentId) private {
        address[18] memory authorities = [
            address(
                OrderReceiptAuthority(
                    _create("OrderReceiptAuthority", abi.encode(_kind("Order"), IOrderState(address(d.orderState))))
                )
            ),
            address(
                RfqReceiptAuthority(
                    _create("RfqReceiptAuthority", abi.encode(_kind("RFQ"), IPrivateRfqBook(address(d.privateRfqBook))))
                )
            ),
            address(
                BookOrderReceiptAuthority(
                    _create(
                        "BookOrderReceiptAuthority",
                        abi.encode(_kind("Book"), IPublicOrderBook(address(d.publicOrderBook)))
                    )
                )
            ),
            address(
                AuctionReceiptAuthority(
                    _create(
                        "AuctionReceiptAuthority",
                        abi.encode(_kind("Auction"), ISealedAuctionHouse(address(d.sealedAuctionHouse)))
                    )
                )
            ),
            address(
                SolverReceiptAuthority(
                    _create(
                        "SolverReceiptAuthority",
                        abi.encode(_kind("Solver"), ISealedAuctionHouse(address(d.sealedAuctionHouse)))
                    )
                )
            ),
            address(
                FillReceiptAuthority(
                    _create(
                        "FillReceiptAuthority",
                        abi.encode(_kind("Fill"), IAtomicClearingEngine(address(d.atomicClearingEngine)))
                    )
                )
            ),
            address(
                FixingReceiptAuthority(
                    _create(
                        "FixingReceiptAuthority", abi.encode(_kind("Fixing"), IFixingEngine(address(d.fixingEngine)))
                    )
                )
            ),
            address(
                SettlementReceiptAuthority(
                    _create(
                        "SettlementReceiptAuthority",
                        abi.encode(
                            _kind("Settlement"), ICashSettlementCoordinator(address(d.cashSettlementCoordinator))
                        )
                    )
                )
            ),
            address(
                    DefaultReceiptAuthority(
                        _create(
                            "DefaultReceiptAuthority",
                            abi.encode(_kind("Default"), IDefaultProcessEngine(address(d.defaultProcessEngine)))
                        )
                    )
                ),
            address(
                RecoveryReceiptAuthority(
                    _create(
                        "RecoveryReceiptAuthority",
                        abi.encode(
                            _kind("Recovery"), IOperationalAdapterExecutor(address(d.operationalAdapterExecutor))
                        )
                    )
                )
            ),
            address(
                    LifecycleReceiptAuthority(
                        _create(
                            "LifecycleReceiptAuthority",
                            abi.encode(_kind("Lifecycle"), ISignedLifecycleEngine(address(d.signedLifecycleEngine)))
                        )
                    )
                ),
            address(
                StreamReceiptAuthority(
                    _create(
                        "StreamReceiptAuthority",
                        abi.encode(_kind("Stream"), IStreamingQuoteEngine(address(d.streamingQuoteEngine)))
                    )
                )
            ),
            address(
                RouteReceiptAuthority(
                    _create(
                        "RouteReceiptAuthority",
                        abi.encode(_kind("Route"), ICollateralAwareRouteEngine(address(d.routeEngine)))
                    )
                )
            ),
            address(
                PositionReceiptAuthority(
                    _create(
                        "PositionReceiptAuthority",
                        abi.encode(_kind("Position"), IPositionEngine(address(d.positionEngine)))
                    )
                )
            ),
            address(
                FeeReceiptAuthority(
                    _create(
                        "FeeReceiptAuthority", abi.encode(_kind("Fee"), IFundedFeeEngine(address(d.fundedFeeEngine)))
                    )
                )
            ),
            address(
                RiskReceiptAuthority(
                    _create(
                        "RiskReceiptAuthority",
                        abi.encode(_kind("Risk"), IPortfolioRiskEngine(address(d.portfolioRiskEngine)))
                    )
                )
            ),
            address(
                PrivacyReceiptAuthority(
                    _create(
                        "PrivacyReceiptAuthority",
                        abi.encode(_kind("Privacy"), IPrivacyCommitmentRegistry(address(d.privacyCommitmentRegistry)))
                    )
                )
            ),
            address(
                AsyncReceiptAuthority(
                    _create(
                        "AsyncReceiptAuthority",
                        abi.encode(_kind("Async"), IOperationalAdapterExecutor(address(d.operationalAdapterExecutor)))
                    )
                )
            )
        ];
        string[18] memory kinds = [
            "Order",
            "RFQ",
            "Book",
            "Auction",
            "Solver",
            "Fill",
            "Fixing",
            "Settlement",
            "Default",
            "Recovery",
            "Lifecycle",
            "Stream",
            "Route",
            "Position",
            "Fee",
            "Risk",
            "Privacy",
            "Async"
        ];
        ReceiptAuthorityBinding[] memory bindings = new ReceiptAuthorityBinding[](authorities.length);
        for (uint256 i; i < authorities.length; ++i) {
            ReceiptAuthorityBinding memory binding = ReceiptAuthorityBinding({
                subjectKindId: _kind(kinds[i]), authority: authorities[i], deploymentHash: deploymentId
            });
            uint256 j = i;
            while (j > 0 && bindings[j - 1].subjectKindId > binding.subjectKindId) {
                bindings[j] = bindings[j - 1];
                --j;
            }
            bindings[j] = binding;
        }
        d.receiptAuthorities = authorities;
        d.receiptLedger = VerifiableReceiptLedger(
            _create(
                "VerifiableReceiptLedger",
                abi.encode(bindings, IPrivacyCommitmentRegistry(address(d.privacyCommitmentRegistry)))
            )
        );
    }

    function _kind(string memory name) private pure returns (bytes32) {
        return keccak256(bytes(string.concat("SetrynReceiptSubjectV1:", name)));
    }

    function _wireExecutionVenueRoles(
        Deployment memory d,
        address bootstrap,
        address governanceAdmin,
        address governanceOperator,
        address guardian
    ) private {
        address liquiditySource = address(d.routeLiquiditySource);
        d.positionEngine.grantRole(d.positionEngine.FUNDING_REQUESTER_ROLE(), address(d.privateRfqBook));
        d.positionEngine.grantRole(d.positionEngine.FUNDING_REQUESTER_ROLE(), address(d.sealedAuctionHouse));
        d.positionEngine.grantRole(d.positionEngine.FUNDING_REQUESTER_ROLE(), address(d.streamCapacityManager));
        d.positionEngine.grantRole(d.positionEngine.FUNDING_REQUESTER_ROLE(), address(d.batchCapacityManager));
        d.collateralVault.grantRole(d.collateralVault.COLLATERAL_LOCKER_ROLE(), address(d.sealedAuctionHouse));
        d.collateralVault.grantRole(d.collateralVault.COLLATERAL_SETTLER_ROLE(), address(d.sealedAuctionHouse));
        d.capacityReservationRegistry
            .grantRole(d.capacityReservationRegistry.CAPACITY_CLAIMANT_ROLE(), address(d.streamCapacityManager));
        d.capacityReservationRegistry
            .grantRole(d.capacityReservationRegistry.CAPACITY_CLAIMANT_ROLE(), address(d.batchCapacityManager));
        d.capacityReservationRegistry.grantRole(d.capacityReservationRegistry.CAPACITY_CLAIMANT_ROLE(), liquiditySource);
        d.streamCapacityManager.grantRole(d.streamCapacityManager.STREAM_ENGINE_ROLE(), address(d.streamingQuoteEngine));
        // The quote settlement router settles offchain firm quotes for any caller, so it holds the capacity, execution,
        // risk-consumer and collateral roles itself and no submitter needs one. It has no admin of its own.
        address quoteRouter = address(d.quoteSettlementRouter);
        d.streamCapacityManager.grantRole(d.streamCapacityManager.STREAM_ENGINE_ROLE(), quoteRouter);
        d.atomicClearingEngine.grantRole(d.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), quoteRouter);
        d.portfolioRiskEngine.grantRole(d.portfolioRiskEngine.RISK_CONSUMER_ROLE(), quoteRouter);
        d.collateralVault.grantRole(d.collateralVault.COLLATERAL_LOCKER_ROLE(), quoteRouter);
        d.collateralVault.grantRole(d.collateralVault.COLLATERAL_SETTLER_ROLE(), quoteRouter);
        d.streamCapacityManager.revokeRole(d.streamCapacityManager.STREAM_ENGINE_ROLE(), bootstrap);
        d.batchCapacityManager.grantRole(d.batchCapacityManager.BATCH_ENGINE_ROLE(), address(d.batchClearingEngine));
        d.batchCapacityManager.revokeRole(d.batchCapacityManager.BATCH_ENGINE_ROLE(), bootstrap);
        d.atomicClearingEngine.grantRole(d.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), address(d.streamingQuoteEngine));
        d.atomicClearingEngine.grantRole(d.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), address(d.batchClearingEngine));
        d.sealedAuctionHouse.grantRole(d.sealedAuctionHouse.CLEARING_ENGINE_ROLE(), address(d.batchClearingEngine));
        d.sealedAuctionHouse.grantRole(d.sealedAuctionHouse.AUCTION_SCHEDULER_ROLE(), governanceOperator);
        d.sealedAuctionHouse.grantRole(d.sealedAuctionHouse.AUCTION_GUARDIAN_ROLE(), guardian);
        d.sealedAuctionHouse.revokeRole(d.sealedAuctionHouse.AUCTION_SCHEDULER_ROLE(), bootstrap);
        d.sealedAuctionHouse.revokeRole(d.sealedAuctionHouse.AUCTION_GUARDIAN_ROLE(), bootstrap);

        // The protocol liquidity source is the only route reserver on every venue.
        d.publicOrderBook.grantRole(d.publicOrderBook.ROUTE_RESERVER_ROLE(), liquiditySource);
        d.privateRfqBook.grantRole(d.privateRfqBook.ROUTE_RESERVER_ROLE(), liquiditySource);
        d.streamingQuoteEngine.grantRole(d.streamingQuoteEngine.ROUTE_RESERVER_ROLE(), liquiditySource);
        d.sealedAuctionHouse.grantRole(d.sealedAuctionHouse.ROUTE_RESERVER_ROLE(), liquiditySource);
        d.streamingQuoteEngine.revokeRole(d.streamingQuoteEngine.ROUTE_RESERVER_ROLE(), bootstrap);
        d.sealedAuctionHouse.revokeRole(d.sealedAuctionHouse.ROUTE_RESERVER_ROLE(), bootstrap);
        d.routeLiquiditySource.grantRole(d.routeLiquiditySource.ROUTE_ENGINE_ROLE(), address(d.routeEngine));
        d.routeLiquiditySource.revokeRole(d.routeLiquiditySource.ROUTE_ENGINE_ROLE(), bootstrap);
        d.routeEngine.grantRole(d.routeEngine.ROUTE_CONSUMER_ROLE(), governanceOperator);
        d.routeEngine.revokeRole(d.routeEngine.ROUTE_CONSUMER_ROLE(), bootstrap);
        d.portfolioRiskEngine.grantRole(d.portfolioRiskEngine.RISK_CONSUMER_ROLE(), address(d.routeEngine));

        // StreamingQuoteEngine uses plain AccessControl, so its admin moves directly to governance.
        d.streamingQuoteEngine.grantRole(d.streamingQuoteEngine.DEFAULT_ADMIN_ROLE(), governanceAdmin);
        d.streamingQuoteEngine.revokeRole(d.streamingQuoteEngine.DEFAULT_ADMIN_ROLE(), bootstrap);
    }

    function _wireInternalRoles(
        Deployment memory deployment,
        address bootstrapAdmin,
        address governanceAdmin,
        address governanceOperator,
        address guardian,
        address excessRecovery,
        address privacyKeyPublisher,
        address lifecycleWitnessStager,
        bool retainOperatorStatusRoles
    ) private {
        _wireRegistryRoles(deployment, bootstrapAdmin, governanceOperator, retainOperatorStatusRoles);
        _wireExecutionVenueRoles(deployment, bootstrapAdmin, governanceAdmin, governanceOperator, guardian);
        deployment.executionPolicyRegistry
            .grantRole(deployment.executionPolicyRegistry.POLICY_ADMIN_ROLE(), governanceOperator);
        deployment.orderState
            .grantRole(deployment.orderState.ORDER_CONSUMER_ROLE(), address(deployment.atomicClearingEngine));
        deployment.atomicClearingEngine
            .grantRole(deployment.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), address(deployment.publicOrderBook));
        deployment.atomicClearingEngine
            .grantRole(deployment.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), governanceOperator);
        deployment.positionEngine
            .grantRole(deployment.positionEngine.CLEARING_ENGINE_ROLE(), address(deployment.atomicClearingEngine));
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_LOCKER_ROLE(), address(deployment.atomicClearingEngine));
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_SETTLER_ROLE(), address(deployment.atomicClearingEngine));
        deployment.fundedFeeEngine
            .grantRole(deployment.fundedFeeEngine.FEE_ACTION_CONSUMER_ROLE(), address(deployment.atomicClearingEngine));
        deployment.portfolioRiskEngine
            .grantRole(deployment.portfolioRiskEngine.RISK_CONSUMER_ROLE(), address(deployment.atomicClearingEngine));
        deployment.portfolioRiskEngine
            .grantRole(deployment.portfolioRiskEngine.RISK_CONSUMER_ROLE(), governanceOperator);
        deployment.portfolioRiskEngine
            .grantRole(
                deployment.portfolioRiskEngine.RISK_CONSUMER_ROLE(), address(deployment.riskAdmissionBindingRegistry)
            );
        deployment.publicOrderBook.grantRole(deployment.publicOrderBook.DEFAULT_ADMIN_ROLE(), governanceAdmin);
        deployment.publicOrderBook.revokeRole(deployment.publicOrderBook.ROUTE_RESERVER_ROLE(), bootstrapAdmin);
        deployment.publicOrderBook.revokeRole(deployment.publicOrderBook.DEFAULT_ADMIN_ROLE(), bootstrapAdmin);
        deployment.privateRfqBook.revokeRole(deployment.privateRfqBook.ROUTE_RESERVER_ROLE(), bootstrapAdmin);
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_LOCKER_ROLE(), address(deployment.positionEngine));
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_SETTLER_ROLE(), address(deployment.positionEngine));
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_SETTLER_ROLE(), address(deployment.fundedFeeEngine));
        deployment.collateralVault
            .grantRole(
                deployment.collateralVault.TERMINAL_RESERVATION_CREATOR_ROLE(), address(deployment.positionEngine)
            );
        deployment.collateralVault
            .grantRole(
                deployment.collateralVault.TERMINAL_RESERVATION_RESOLVER_ROLE(), address(deployment.positionEngine)
            );
        deployment.collateralVault
            .grantRole(
                deployment.collateralVault.TERMINAL_RESERVATION_RESOLVER_ROLE(),
                address(deployment.cashSettlementCoordinator)
            );
        deployment.collateralVault
            .grantRole(
                deployment.collateralVault.TERMINAL_RESERVATION_RESOLVER_ROLE(),
                address(deployment.positionLifecycleExecutor)
            );
        deployment.positionEngine
            .grantRole(deployment.positionEngine.FIXING_ENGINE_ROLE(), address(deployment.cashSettlementCoordinator));
        deployment.positionEngine
            .grantRole(deployment.positionEngine.LIFECYCLE_ENGINE_ROLE(), address(deployment.positionLifecycleExecutor));
        deployment.positionEngine
            .grantRole(deployment.positionEngine.DEFAULT_ENGINE_ROLE(), address(deployment.positionLifecycleExecutor));
        deployment.positionLifecycleExecutor
            .grantRole(
                deployment.positionLifecycleExecutor.SIGNED_LIFECYCLE_ENGINE_ROLE(),
                address(deployment.signedLifecycleEngine)
            );
        deployment.positionLifecycleExecutor
            .grantRole(
                deployment.positionLifecycleExecutor.COMPRESSION_COORDINATOR_ROLE(),
                address(deployment.compressionCoordinator)
            );
        deployment.positionLifecycleExecutor
            .grantRole(
                deployment.positionLifecycleExecutor.DEFAULT_PROCESS_ENGINE_ROLE(),
                address(deployment.defaultProcessEngine)
            );
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_LOCKER_ROLE(), address(deployment.defaultProcessEngine));
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_SETTLER_ROLE(), address(deployment.defaultProcessEngine));
        deployment.collateralVault.grantRole(deployment.collateralVault.EXCESS_RECOVERY_ROLE(), excessRecovery);
        deployment.fundedFeeEngine
            .grantRole(
                deployment.fundedFeeEngine.FEE_ACTION_CONSUMER_ROLE(), address(deployment.cashSettlementCoordinator)
            );
        deployment.portfolioRiskEngine
            .grantRole(
                deployment.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(deployment.positionLifecycleExecutor)
            );
        deployment.portfolioRiskEngine
            .grantRole(
                deployment.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(deployment.cashSettlementCoordinator)
            );
        deployment.portfolioRiskEngine
            .grantRole(deployment.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(deployment.defaultProcessEngine));
        deployment.positionLifecycleExecutor
            .grantRole(deployment.positionLifecycleExecutor.WITNESS_STAGER_ROLE(), lifecycleWitnessStager);
        deployment.signedLifecycleEngine.grantRole(deployment.signedLifecycleEngine.LIFECYCLE_GUARDIAN_ROLE(), guardian);
        deployment.compressionCoordinator
            .grantRole(deployment.compressionCoordinator.COMPRESSION_GUARDIAN_ROLE(), guardian);
        deployment.privacyCommitmentRegistry
            .grantRole(deployment.privacyCommitmentRegistry.POLICY_QUALIFIER_ROLE(), governanceOperator);
        deployment.privacyCommitmentRegistry
            .grantRole(deployment.privacyCommitmentRegistry.EPOCH_KEY_PUBLISHER_ROLE(), privacyKeyPublisher);

        _revokeBootstrapOperationalRoles(deployment, bootstrapAdmin);
        _beginAdminTransfers(deployment, governanceAdmin);
    }

    function _wireRegistryRoles(Deployment memory d, address bootstrap, address operator, bool retainOperatorStatus)
        private
    {
        d.assetRegistry.grantRole(d.assetRegistry.REGISTRAR_ROLE(), operator);
        d.adapterRegistry.grantRole(d.adapterRegistry.ADAPTER_QUALIFIER_ROLE(), operator);
        d.calendarRegistry.grantRole(d.calendarRegistry.CALENDAR_REGISTRAR_ROLE(), operator);
        d.sessionRegistry.grantRole(d.sessionRegistry.SESSION_REGISTRAR_ROLE(), operator);
        d.settlementAssetRegistry.grantRole(d.settlementAssetRegistry.QUALIFIER_ROLE(), operator);
        d.benchmarkRegistry.grantRole(d.benchmarkRegistry.BENCHMARK_QUALIFIER_ROLE(), operator);
        d.feeScheduleRegistry.grantRole(d.feeScheduleRegistry.FEE_SCHEDULE_QUALIFIER_ROLE(), operator);
        d.riskDomainRegistry.grantRole(d.riskDomainRegistry.RISK_DOMAIN_QUALIFIER_ROLE(), operator);
        d.instrumentRegistry.grantRole(d.instrumentRegistry.INSTRUMENT_QUALIFIER_ROLE(), operator);
        d.marketRegistry.grantRole(d.marketRegistry.MARKET_QUALIFIER_ROLE(), operator);
        d.seriesRegistry.grantRole(d.seriesRegistry.SERIES_QUALIFIER_ROLE(), operator);
        d.packageRegistry.grantRole(d.packageRegistry.PACKAGE_QUALIFIER_ROLE(), operator);

        // Combined activate, pause, and deprecate roles belong to the status controller, which gives the guardian
        // only pause selectors and governance only activate and deprecate selectors. Never grant them to the guardian.
        (address[13] memory registries, bytes32[13] memory statusRoles) = _statusRoles(d);
        address controller = address(d.registryStatusController);
        for (uint256 i; i < registries.length; ++i) {
            IAccessControl(registries[i]).grantRole(statusRoles[i], controller);
            if (retainOperatorStatus) IAccessControl(registries[i]).grantRole(statusRoles[i], operator);
            IAccessControl(registries[i]).revokeRole(statusRoles[i], bootstrap);
        }

        d.assetRegistry.revokeRole(d.assetRegistry.REGISTRAR_ROLE(), bootstrap);
        d.adapterRegistry.revokeRole(d.adapterRegistry.ADAPTER_QUALIFIER_ROLE(), bootstrap);
        d.calendarRegistry.revokeRole(d.calendarRegistry.CALENDAR_REGISTRAR_ROLE(), bootstrap);
        d.sessionRegistry.revokeRole(d.sessionRegistry.SESSION_REGISTRAR_ROLE(), bootstrap);
        d.settlementAssetRegistry.revokeRole(d.settlementAssetRegistry.QUALIFIER_ROLE(), bootstrap);
        d.benchmarkRegistry.revokeRole(d.benchmarkRegistry.BENCHMARK_QUALIFIER_ROLE(), bootstrap);
        d.feeScheduleRegistry.revokeRole(d.feeScheduleRegistry.FEE_SCHEDULE_QUALIFIER_ROLE(), bootstrap);
        d.riskDomainRegistry.revokeRole(d.riskDomainRegistry.RISK_DOMAIN_QUALIFIER_ROLE(), bootstrap);
        d.instrumentRegistry.revokeRole(d.instrumentRegistry.INSTRUMENT_QUALIFIER_ROLE(), bootstrap);
        d.marketRegistry.revokeRole(d.marketRegistry.MARKET_QUALIFIER_ROLE(), bootstrap);
        d.seriesRegistry.revokeRole(d.seriesRegistry.SERIES_QUALIFIER_ROLE(), bootstrap);
        d.packageRegistry.revokeRole(d.packageRegistry.PACKAGE_QUALIFIER_ROLE(), bootstrap);
    }

    function _revokeBootstrapOperationalRoles(Deployment memory d, address bootstrap) private {
        d.collateralVault.revokeRole(d.collateralVault.COLLATERAL_LOCKER_ROLE(), bootstrap);
        d.collateralVault.revokeRole(d.collateralVault.COLLATERAL_SETTLER_ROLE(), bootstrap);
        d.collateralVault.revokeRole(d.collateralVault.TERMINAL_RESERVATION_CREATOR_ROLE(), bootstrap);
        d.collateralVault.revokeRole(d.collateralVault.TERMINAL_RESERVATION_RESOLVER_ROLE(), bootstrap);
        d.collateralVault.revokeRole(d.collateralVault.EXCESS_RECOVERY_ROLE(), bootstrap);
        d.positionEngine.revokeRole(d.positionEngine.CLEARING_ENGINE_ROLE(), bootstrap);
        d.positionEngine.revokeRole(d.positionEngine.FUNDING_REQUESTER_ROLE(), bootstrap);
        d.positionEngine.revokeRole(d.positionEngine.FIXING_ENGINE_ROLE(), bootstrap);
        d.positionEngine.revokeRole(d.positionEngine.LIFECYCLE_ENGINE_ROLE(), bootstrap);
        d.positionEngine.revokeRole(d.positionEngine.DEFAULT_ENGINE_ROLE(), bootstrap);
        d.fundedFeeEngine.revokeRole(d.fundedFeeEngine.FEE_ACTION_CONSUMER_ROLE(), bootstrap);
        d.portfolioRiskEngine.revokeRole(d.portfolioRiskEngine.RISK_CONSUMER_ROLE(), bootstrap);
        d.portfolioRiskEngine.revokeRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), bootstrap);
        d.positionLifecycleExecutor.revokeRole(d.positionLifecycleExecutor.SIGNED_LIFECYCLE_ENGINE_ROLE(), bootstrap);
        d.positionLifecycleExecutor.revokeRole(d.positionLifecycleExecutor.COMPRESSION_COORDINATOR_ROLE(), bootstrap);
        d.positionLifecycleExecutor.revokeRole(d.positionLifecycleExecutor.DEFAULT_PROCESS_ENGINE_ROLE(), bootstrap);
        d.positionLifecycleExecutor.revokeRole(d.positionLifecycleExecutor.WITNESS_STAGER_ROLE(), bootstrap);
        d.signedLifecycleEngine.revokeRole(d.signedLifecycleEngine.LIFECYCLE_GUARDIAN_ROLE(), bootstrap);
        d.compressionCoordinator.revokeRole(d.compressionCoordinator.COMPRESSION_GUARDIAN_ROLE(), bootstrap);
        d.privacyCommitmentRegistry.revokeRole(d.privacyCommitmentRegistry.POLICY_QUALIFIER_ROLE(), bootstrap);
        d.privacyCommitmentRegistry.revokeRole(d.privacyCommitmentRegistry.EPOCH_KEY_PUBLISHER_ROLE(), bootstrap);
        d.executionPolicyRegistry.revokeRole(d.executionPolicyRegistry.POLICY_ADMIN_ROLE(), bootstrap);
        d.orderState.revokeRole(d.orderState.ORDER_CONSUMER_ROLE(), bootstrap);
        d.atomicClearingEngine.revokeRole(d.atomicClearingEngine.MATCH_EXECUTOR_ROLE(), bootstrap);
    }

    function _beginAdminTransfers(Deployment memory d, address governanceAdmin) private {
        _beginAdminTransfer(address(d.assetRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.adapterRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.calendarRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.sessionRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.settlementAssetRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.benchmarkRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.feeScheduleRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.riskDomainRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.instrumentRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.marketRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.seriesRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.collateralVault), governanceAdmin);
        _beginAdminTransfer(address(d.packageRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.positionEngine), governanceAdmin);
        _beginAdminTransfer(address(d.fundedFeeEngine), governanceAdmin);
        _beginAdminTransfer(address(d.portfolioRiskEngine), governanceAdmin);
        _beginAdminTransfer(address(d.positionLifecycleExecutor), governanceAdmin);
        _beginAdminTransfer(address(d.signedLifecycleEngine), governanceAdmin);
        _beginAdminTransfer(address(d.compressionCoordinator), governanceAdmin);
        _beginAdminTransfer(address(d.privacyCommitmentRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.executionPolicyRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.orderState), governanceAdmin);
        _beginAdminTransfer(address(d.atomicClearingEngine), governanceAdmin);
        _beginAdminTransfer(address(d.privateRfqBook), governanceAdmin);
        _beginAdminTransfer(address(d.capacityReservationRegistry), governanceAdmin);
        _beginAdminTransfer(address(d.streamCapacityManager), governanceAdmin);
        _beginAdminTransfer(address(d.batchCapacityManager), governanceAdmin);
        _beginAdminTransfer(address(d.sealedAuctionHouse), governanceAdmin);
        _beginAdminTransfer(address(d.routeLiquiditySource), governanceAdmin);
        _beginAdminTransfer(address(d.routeEngine), governanceAdmin);
    }

    function _beginAdminTransfer(address target, address governanceAdmin) private {
        AccessControlDefaultAdminRules(target).beginDefaultAdminTransfer(governanceAdmin);
    }

    function _postWiringEvidence(
        Deployment memory d,
        address bootstrap,
        address governanceAdmin,
        address governanceOperator,
        address guardian,
        address excessRecovery,
        address privacyKeyPublisher,
        address lifecycleWitnessStager
    ) private view returns (bytes32) {
        (address registryPendingAdmin, uint48 registryAcceptSchedule) = d.assetRegistry.pendingDefaultAdmin();
        (address privacyPendingAdmin, uint48 privacyAcceptSchedule) = d.privacyCommitmentRegistry.pendingDefaultAdmin();
        if (registryPendingAdmin != governanceAdmin || privacyPendingAdmin != governanceAdmin) {
            revert InvalidDeploymentPrincipal(governanceAdmin);
        }
        bytes32 coreEvidence = keccak256(
            abi.encode(
                block.chainid,
                governanceAdmin,
                governanceOperator,
                guardian,
                excessRecovery,
                privacyKeyPublisher,
                lifecycleWitnessStager,
                !d.portfolioRiskEngine.hasRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), bootstrap),
                d.portfolioRiskEngine
                    .hasRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(d.positionLifecycleExecutor)),
                d.portfolioRiskEngine
                    .hasRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(d.cashSettlementCoordinator)),
                d.portfolioRiskEngine
                    .hasRole(d.portfolioRiskEngine.EXPOSURE_REDUCER_ROLE(), address(d.defaultProcessEngine)),
                registryPendingAdmin,
                registryAcceptSchedule,
                privacyPendingAdmin,
                privacyAcceptSchedule
            )
        );
        return keccak256(abi.encode(coreEvidence, _venueWiringEvidence(d, bootstrap)));
    }

    function _venueWiringEvidence(Deployment memory d, address bootstrap) private view returns (bytes32) {
        address liquiditySource = address(d.routeLiquiditySource);
        return keccak256(
            abi.encode(
                d.positionEngine.hasRole(d.positionEngine.FUNDING_REQUESTER_ROLE(), address(d.privateRfqBook)),
                d.positionEngine.hasRole(d.positionEngine.FUNDING_REQUESTER_ROLE(), address(d.sealedAuctionHouse)),
                d.capacityReservationRegistry
                    .hasRole(d.capacityReservationRegistry.CAPACITY_CLAIMANT_ROLE(), liquiditySource),
                d.publicOrderBook.hasRole(d.publicOrderBook.ROUTE_RESERVER_ROLE(), liquiditySource),
                d.privateRfqBook.hasRole(d.privateRfqBook.ROUTE_RESERVER_ROLE(), liquiditySource),
                d.streamingQuoteEngine.hasRole(d.streamingQuoteEngine.ROUTE_RESERVER_ROLE(), liquiditySource),
                d.sealedAuctionHouse.hasRole(d.sealedAuctionHouse.ROUTE_RESERVER_ROLE(), liquiditySource),
                d.routeLiquiditySource.hasRole(d.routeLiquiditySource.ROUTE_ENGINE_ROLE(), address(d.routeEngine)),
                !d.streamingQuoteEngine.hasRole(d.streamingQuoteEngine.DEFAULT_ADMIN_ROLE(), bootstrap),
                !d.routeEngine.hasRole(d.routeEngine.ROUTE_CONSUMER_ROLE(), bootstrap)
            )
        );
    }

    /// The treasury controller holds protocol revenue, so it may never be the zero address, the bootstrap key, or one of
    /// the operational hot principals. It may be the governance timelock, which can act as a treasury.
    function _requireTreasuryController(DeploymentConfig memory config) private pure {
        address treasury = config.treasuryController;
        if (
            treasury == address(0) || treasury == config.bootstrapAdmin || treasury == config.governanceOperator
                || treasury == config.guardian || treasury == config.excessRecovery
                || treasury == config.privacyKeyPublisher || treasury == config.lifecycleWitnessStager
        ) revert InvalidTreasuryController(treasury);
    }

    function _requireSeparatedPrincipal(address bootstrap, address governanceAdmin, address operational) private pure {
        if (governanceAdmin == address(0) || operational == address(0)) revert InvalidDeploymentPrincipal(address(0));
        if (governanceAdmin == bootstrap || operational == bootstrap || operational == governanceAdmin) {
            revert PrincipalSeparationRequired(governanceAdmin, operational);
        }
    }

    function _requireDistinctOperationalPrincipals(
        address governanceOperator,
        address guardian,
        address excessRecovery,
        address privacyKeyPublisher,
        address lifecycleWitnessStager
    ) private pure {
        address[5] memory principals = [
            governanceOperator, guardian, excessRecovery, privacyKeyPublisher, lifecycleWitnessStager
        ];
        for (uint256 i; i < principals.length; ++i) {
            for (uint256 j = i + 1; j < principals.length; ++j) {
                if (principals[i] == principals[j]) {
                    revert PrincipalSeparationRequired(principals[i], principals[j]);
                }
            }
        }
    }

    /// Public environments name their Chainlink L2 sequencer uptime feed. Arbitrum Sepolia has none, so it alone may
    /// pass `testnet-static`: the zero feed this returns makes `_deployAndWire` create the always-up
    /// DevnetSequencerUptimeFeed exactly as on a local devnet. The choice is refused on every other chain.
    function _deployOrResolveSequencerFeed(string memory environment) private view returns (ISequencerUptimeFeed feed) {
        if (keccak256(bytes(vm.envOr("SETRYN_SEQUENCER_UPTIME_FEED", string("")))) == TESTNET_STATIC_SEQUENCER_FEED) {
            if (
                keccak256(bytes(environment)) != ARBITRUM_SEPOLIA_ENVIRONMENT
                    || block.chainid != ARBITRUM_SEPOLIA_CHAIN_ID
            ) revert TestnetStaticSequencerFeedRefused(block.chainid);
            return ISequencerUptimeFeed(address(0));
        }
        address configuredFeed = vm.envAddress("SETRYN_SEQUENCER_UPTIME_FEED");
        if (configuredFeed == address(0) || configuredFeed.code.length == 0) {
            revert InvalidSequencerUptimeFeed(configuredFeed);
        }
        return ISequencerUptimeFeed(configuredFeed);
    }

    function _requireAllowedTarget(string memory environment) private view {
        if (block.chainid == ARBITRUM_ONE_CHAIN_ID) {
            revert ArbitrumOneDeploymentDisabled();
        }

        bytes32 environmentHash = keccak256(bytes(environment));
        if (environmentHash == LOCAL_ENVIRONMENT) {
            if (block.chainid != ANVIL_CHAIN_ID && block.chainid != GANACHE_CHAIN_ID) {
                revert EnvironmentChainMismatch(environment, block.chainid);
            }
            return;
        }

        if (environmentHash == ARBITRUM_SEPOLIA_ENVIRONMENT) {
            if (block.chainid != ARBITRUM_SEPOLIA_CHAIN_ID) {
                revert EnvironmentChainMismatch(environment, block.chainid);
            }
            return;
        }

        revert UnsupportedDeploymentEnvironment(environment);
    }

    function _envUint48(string memory name, uint256 defaultValue) private view returns (uint48 value) {
        uint256 rawValue = vm.envOr(name, defaultValue);
        if (rawValue > type(uint48).max) {
            revert Uint48EnvironmentValueOutOfRange(name, rawValue);
        }
        value = uint48(rawValue);
    }

    function _envUint64(string memory name, uint256 defaultValue) private view returns (uint64 value) {
        uint256 rawValue = vm.envOr(name, defaultValue);
        if (rawValue > type(uint64).max) {
            revert Uint64EnvironmentValueOutOfRange(name, rawValue);
        }
        value = uint64(rawValue);
    }

    function _envUint64(string memory name) private view returns (uint64 value) {
        uint256 rawValue = vm.envUint(name);
        if (rawValue > type(uint64).max) {
            revert Uint64EnvironmentValueOutOfRange(name, rawValue);
        }
        value = uint64(rawValue);
    }

    function _logDeployment(Deployment memory deployment) private pure {
        console2.log("AssetRegistry", address(deployment.assetRegistry));
        console2.log("AdapterRegistry", address(deployment.adapterRegistry));
        console2.log("CalendarRegistry", address(deployment.calendarRegistry));
        console2.log("SessionRegistry", address(deployment.sessionRegistry));
        console2.log("SettlementAssetRegistry", address(deployment.settlementAssetRegistry));
        console2.log("BenchmarkRegistry", address(deployment.benchmarkRegistry));
        console2.log("FeeScheduleRegistry", address(deployment.feeScheduleRegistry));
        console2.log("RiskDomainRegistry", address(deployment.riskDomainRegistry));
        console2.log("InstrumentRegistry", address(deployment.instrumentRegistry));
        console2.log("MarketRegistry", address(deployment.marketRegistry));
        console2.log("SeriesRegistry", address(deployment.seriesRegistry));
        console2.log("CollateralVault", address(deployment.collateralVault));
        console2.log("PackageRegistry", address(deployment.packageRegistry));
        console2.log("CanonicalStrategyCompiler", address(deployment.strategyCompiler));
        console2.log("PositionEngine", address(deployment.positionEngine));
        console2.log("FixingEngine", address(deployment.fixingEngine));
        console2.log("FundedFeeEngine", address(deployment.fundedFeeEngine));
        console2.log("PortfolioRiskEngine", address(deployment.portfolioRiskEngine));
        console2.log("SequencerUptimeFeed", address(deployment.sequencerUptimeFeed));
        console2.log("ExecutionPolicyRegistry", address(deployment.executionPolicyRegistry));
        console2.log("TradingSessionPolicy", address(deployment.tradingSessionPolicy));
        console2.log("PackageWitnessRegistry", address(deployment.packageWitnessRegistry));
        console2.log("RiskAdmissionBindingRegistry", address(deployment.riskAdmissionBindingRegistry));
        console2.log("OrderValidationGate", address(deployment.orderValidationGate));
        console2.log("OrderState", address(deployment.orderState));
        console2.log("ClearingAdmissionGate", address(deployment.clearingAdmissionGate));
        console2.log("AtomicClearingEngine", address(deployment.atomicClearingEngine));
        console2.log("PrivateRfqValidationGate", address(deployment.privateRfqValidationGate));
        console2.log("PrivateRfqBook", address(deployment.privateRfqBook));
        console2.log("PublicBookEligibilityGate", address(deployment.publicBookEligibilityGate));
        console2.log("PublicOrderBook", address(deployment.publicOrderBook));
        console2.log("PositionLifecycleExecutor", address(deployment.positionLifecycleExecutor));
        console2.log("AccountPolicyAuthority", address(deployment.accountPolicyAuthority));
        console2.log("LifecyclePolicyValidator", address(deployment.lifecyclePolicyValidator));
        console2.log("SignedLifecycleEngine", address(deployment.signedLifecycleEngine));
        console2.log("CompressionCoordinator", address(deployment.compressionCoordinator));
        console2.log("DefaultBidderGate", address(deployment.defaultBidderGate));
        console2.log("DefaultProcessEngine", address(deployment.defaultProcessEngine));
        console2.log("CashSettlementCoordinator", address(deployment.cashSettlementCoordinator));
        console2.log("PrivacyCommitmentRegistry", address(deployment.privacyCommitmentRegistry));
        console2.log("OperationalAdapterExecutor", address(deployment.operationalAdapterExecutor));
        console2.log("CappedForwardPayoffModule", address(deployment.cappedForwardPayoffModule));
        console2.log("NdfPayoffModule", address(deployment.ndfPayoffModule));
        console2.log("EuropeanCallPayoffModule", address(deployment.europeanCallPayoffModule));
        console2.log("EuropeanPutPayoffModule", address(deployment.europeanPutPayoffModule));
        console2.log("CollarPayoffModule", address(deployment.collarPayoffModule));
        console2.log("RateForwardPayoffModule", address(deployment.rateForwardPayoffModule));
        console2.log("RateCapPayoffModule", address(deployment.rateCapPayoffModule));
        console2.log("RateFloorPayoffModule", address(deployment.rateFloorPayoffModule));
        console2.log("RateCollarPayoffModule", address(deployment.rateCollarPayoffModule));
        console2.log("BasisSpreadPayoffModule", address(deployment.basisSpreadPayoffModule));
        console2.log("CalendarSpreadPayoffModule", address(deployment.calendarSpreadPayoffModule));
        console2.log("WindowAverageScalarPayoffModule", address(deployment.windowAverageScalarPayoffModule));
        console2.log(
            "CorrelationDispersionScalarPayoffModule", address(deployment.correlationDispersionScalarPayoffModule)
        );
        console2.log("CapacityReservationRegistry", address(deployment.capacityReservationRegistry));
        console2.log("VaultBackedStreamCapacityManager", address(deployment.streamCapacityManager));
        console2.log("VaultBackedBatchCapacityManager", address(deployment.batchCapacityManager));
        console2.log("AuctionValidationGate", address(deployment.auctionValidationGate));
        console2.log("SealedAuctionHouse", address(deployment.sealedAuctionHouse));
        console2.log("StreamingQuoteEngine", address(deployment.streamingQuoteEngine));
        console2.log("BatchClearingEngine", address(deployment.batchClearingEngine));
        console2.log("ProtocolRouteLiquiditySource", address(deployment.routeLiquiditySource));
        console2.log("CollateralAwareRouteEngine", address(deployment.routeEngine));
        console2.log("VerifiableReceiptLedger", address(deployment.receiptLedger));
        console2.log("RegistryStatusController", address(deployment.registryStatusController));
    }
}
