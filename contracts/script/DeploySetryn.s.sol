// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script, console2} from "forge-std/Script.sol";
import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

import {CollateralVault} from "../src/collateral/CollateralVault.sol";
import {CanonicalStrategyCompiler} from "../src/compiler/CanonicalStrategyCompiler.sol";
import {OperationalAdapterExecutor} from "../src/adapters/operational/OperationalAdapterExecutor.sol";
import {FundedFeeEngine} from "../src/fees/FundedFeeEngine.sol";
import {FixingEngine} from "../src/fixing/FixingEngine.sol";
import {IAdapterRegistry} from "../src/interfaces/IAdapterRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {IBenchmarkRegistry} from "../src/interfaces/IBenchmarkRegistry.sol";
import {ICalendarRegistry} from "../src/interfaces/ICalendarRegistry.sol";
import {ICollateralVault} from "../src/interfaces/ICollateralVault.sol";
import {IFeeScheduleRegistry} from "../src/interfaces/IFeeScheduleRegistry.sol";
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
import {CashSettlementCoordinator} from "../src/settlement/CashSettlementCoordinator.sol";
import {PositionLifecycleExecutor} from "../src/lifecycle/PositionLifecycleExecutor.sol";
import {SignedLifecycleEngine} from "../src/lifecycle/SignedLifecycleEngine.sol";
import {CompressionCoordinator} from "../src/lifecycle/CompressionCoordinator.sol";
import {PrivacyCommitmentRegistry} from "../src/privacy/PrivacyCommitmentRegistry.sol";
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

contract DeploySetryn is Script {
    uint256 private constant ARBITRUM_ONE_CHAIN_ID = 42161;
    uint256 private constant ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
    uint256 private constant ANVIL_CHAIN_ID = 31337;
    uint256 private constant GANACHE_CHAIN_ID = 1337;

    bytes32 private constant LOCAL_ENVIRONMENT = keccak256("local");
    bytes32 private constant ARBITRUM_SEPOLIA_ENVIRONMENT = keccak256("arbitrum-sepolia");

    error ArbitrumOneDeploymentDisabled();
    error EnvironmentChainMismatch(string environment, uint256 chainId);
    error UnsupportedDeploymentEnvironment(string environment);
    error BootstrapAdminMismatch(address deployer, address initialAdmin);
    error InvalidDeploymentPrincipal(address principal);
    error PrincipalSeparationRequired(address governanceAdmin, address operationalPrincipal);
    error Uint48EnvironmentValueOutOfRange(string name, uint256 value);
    error Uint64EnvironmentValueOutOfRange(string name, uint256 value);

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
        bytes32 deploymentId = vm.envBytes32("SETRYN_DEPLOYMENT_ID");

        vm.startBroadcast(deployer);

        deployment.assetRegistry = new AssetRegistry(defaultAdminDelay, initialAdmin);
        deployment.adapterRegistry = new AdapterRegistry(defaultAdminDelay, initialAdmin);
        deployment.calendarRegistry = new CalendarRegistry(defaultAdminDelay, initialAdmin);
        deployment.sessionRegistry = new SessionRegistry(
            defaultAdminDelay, initialAdmin, ICalendarRegistry(address(deployment.calendarRegistry))
        );
        deployment.settlementAssetRegistry = new SettlementAssetRegistry(
            defaultAdminDelay, initialAdmin, IAssetRegistry(address(deployment.assetRegistry))
        );
        deployment.benchmarkRegistry = new BenchmarkRegistry(
            defaultAdminDelay,
            initialAdmin,
            IAssetRegistry(address(deployment.assetRegistry)),
            IAdapterRegistry(address(deployment.adapterRegistry)),
            ICalendarRegistry(address(deployment.calendarRegistry)),
            ISessionRegistry(address(deployment.sessionRegistry))
        );
        deployment.feeScheduleRegistry = new FeeScheduleRegistry(
            defaultAdminDelay, initialAdmin, ISettlementAssetRegistry(address(deployment.settlementAssetRegistry))
        );
        deployment.riskDomainRegistry = new RiskDomainRegistry(
            defaultAdminDelay,
            initialAdmin,
            ISettlementAssetRegistry(address(deployment.settlementAssetRegistry)),
            IAdapterRegistry(address(deployment.adapterRegistry))
        );
        deployment.instrumentRegistry = new InstrumentRegistry(
            defaultAdminDelay, initialAdmin, IAdapterRegistry(address(deployment.adapterRegistry)), evaluationGasHardCap
        );
        deployment.collateralVault = new CollateralVault(
            defaultAdminDelay,
            initialAdmin,
            ISettlementAssetRegistry(address(deployment.settlementAssetRegistry)),
            IRiskDomainRegistry(address(deployment.riskDomainRegistry)),
            maxLockDuration
        );
        deployment.marketRegistry = new MarketRegistry(
            defaultAdminDelay,
            initialAdmin,
            IAssetRegistry(address(deployment.assetRegistry)),
            ISettlementAssetRegistry(address(deployment.settlementAssetRegistry)),
            ICollateralVault(address(deployment.collateralVault)),
            IBenchmarkRegistry(address(deployment.benchmarkRegistry)),
            ICalendarRegistry(address(deployment.calendarRegistry)),
            ISessionRegistry(address(deployment.sessionRegistry)),
            IRiskDomainRegistry(address(deployment.riskDomainRegistry)),
            IFeeScheduleRegistry(address(deployment.feeScheduleRegistry))
        );
        deployment.seriesRegistry = new SeriesRegistry(
            defaultAdminDelay,
            initialAdmin,
            IMarketRegistry(address(deployment.marketRegistry)),
            IInstrumentRegistry(address(deployment.instrumentRegistry))
        );
        deployment.packageRegistry =
            new PackageRegistry(defaultAdminDelay, initialAdmin, ISeriesRegistry(address(deployment.seriesRegistry)));
        deployment.strategyCompiler = new CanonicalStrategyCompiler();
        deployment.positionEngine = new PositionEngine(
            defaultAdminDelay,
            initialAdmin,
            ISeriesRegistry(address(deployment.seriesRegistry)),
            ICollateralVault(address(deployment.collateralVault))
        );
        deployment.fixingEngine = new FixingEngine(ISeriesRegistry(address(deployment.seriesRegistry)));
        deployment.fundedFeeEngine = new FundedFeeEngine(
            defaultAdminDelay,
            initialAdmin,
            IFeeScheduleRegistry(address(deployment.feeScheduleRegistry)),
            ICollateralVault(address(deployment.collateralVault))
        );
        deployment.portfolioRiskEngine = new PortfolioRiskEngine(
            defaultAdminDelay,
            initialAdmin,
            IRiskDomainRegistry(address(deployment.riskDomainRegistry)),
            IAdapterRegistry(address(deployment.adapterRegistry)),
            ICollateralVault(address(deployment.collateralVault)),
            IPositionEngine(address(deployment.positionEngine)),
            maximumRiskAdapterGas,
            maximumRiskObservationAge
        );
        deployment.positionLifecycleExecutor = new PositionLifecycleExecutor(
            defaultAdminDelay,
            initialAdmin,
            IPositionEngine(address(deployment.positionEngine)),
            deployment.portfolioRiskEngine
        );
        deployment.accountPolicyAuthority =
            new AccountPolicyAuthority(ICollateralVault(address(deployment.collateralVault)));
        deployment.lifecyclePolicyValidator = new LifecyclePolicyValidator(
            IPositionEngine(address(deployment.positionEngine)), deployment.packageRegistry
        );
        deployment.signedLifecycleEngine = new SignedLifecycleEngine(
            defaultAdminDelay,
            initialAdmin,
            deployment.positionEngine,
            deployment.accountPolicyAuthority,
            deployment.lifecyclePolicyValidator,
            deployment.positionLifecycleExecutor,
            IRiskDomainRegistry(address(deployment.riskDomainRegistry))
        );
        deployment.compressionCoordinator = new CompressionCoordinator(
            defaultAdminDelay,
            initialAdmin,
            deployment.positionEngine,
            deployment.accountPolicyAuthority,
            deployment.positionLifecycleExecutor,
            IRiskDomainRegistry(address(deployment.riskDomainRegistry))
        );
        deployment.defaultBidderGate = new DefaultBidderGate(
            IRiskDomainRegistry(address(deployment.riskDomainRegistry)),
            ICollateralVault(address(deployment.collateralVault))
        );
        deployment.defaultProcessEngine = new DefaultProcessEngine(
            deployment.portfolioRiskEngine, deployment.defaultBidderGate, deployment.positionLifecycleExecutor
        );
        deployment.cashSettlementCoordinator = new CashSettlementCoordinator(
            IPositionEngine(address(deployment.positionEngine)),
            deployment.fixingEngine,
            deployment.fundedFeeEngine,
            deployment.portfolioRiskEngine
        );
        deployment.privacyCommitmentRegistry = new PrivacyCommitmentRegistry(defaultAdminDelay, initialAdmin);
        deployment.operationalAdapterExecutor = new OperationalAdapterExecutor(
            IAdapterRegistry(address(deployment.adapterRegistry)),
            deploymentId,
            operationalReadGas,
            operationalExecutionGas
        );
        deployment.cappedForwardPayoffModule = new CappedForwardPayoffModule();
        deployment.ndfPayoffModule = new NdfPayoffModule();
        deployment.europeanCallPayoffModule = new EuropeanCallPayoffModule();
        deployment.europeanPutPayoffModule = new EuropeanPutPayoffModule();
        deployment.collarPayoffModule = new CollarPayoffModule();
        deployment.rateForwardPayoffModule = new RateForwardPayoffModule();
        deployment.rateCapPayoffModule = new RateCapPayoffModule();
        deployment.rateFloorPayoffModule = new RateFloorPayoffModule();
        deployment.rateCollarPayoffModule = new RateCollarPayoffModule();
        deployment.basisSpreadPayoffModule = new BasisSpreadPayoffModule();
        deployment.calendarSpreadPayoffModule = new CalendarSpreadPayoffModule();
        deployment.windowAverageScalarPayoffModule = new WindowAverageScalarPayoffModule();
        deployment.correlationDispersionScalarPayoffModule = new CorrelationDispersionScalarPayoffModule();

        _wireInternalRoles(
            deployment,
            deployer,
            governanceAdmin,
            governanceOperator,
            guardian,
            excessRecovery,
            privacyKeyPublisher,
            lifecycleWitnessStager
        );
        bytes32 postWiringEvidence = _postWiringEvidence(
            deployment,
            deployer,
            governanceAdmin,
            governanceOperator,
            guardian,
            excessRecovery,
            privacyKeyPublisher,
            lifecycleWitnessStager
        );
        vm.stopBroadcast();

        _logDeployment(deployment);
        console2.log("POST_WIRING_EVIDENCE_HASH");
        console2.logBytes32(postWiringEvidence);
    }

    function _wireInternalRoles(
        Deployment memory deployment,
        address bootstrapAdmin,
        address governanceAdmin,
        address governanceOperator,
        address guardian,
        address excessRecovery,
        address privacyKeyPublisher,
        address lifecycleWitnessStager
    ) private {
        _wireRegistryRoles(deployment, bootstrapAdmin, governanceOperator);
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_LOCKER_ROLE(), address(deployment.positionEngine));
        deployment.collateralVault
            .grantRole(deployment.collateralVault.COLLATERAL_SETTLER_ROLE(), address(deployment.fundedFeeEngine));
        deployment.collateralVault
            .grantRole(
                deployment.collateralVault.TERMINAL_RESERVATION_CREATOR_ROLE(), address(deployment.positionEngine)
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
            .grantRole(deployment.privacyCommitmentRegistry.POLICY_ACTIVATOR_ROLE(), governanceOperator);
        deployment.privacyCommitmentRegistry
            .grantRole(deployment.privacyCommitmentRegistry.EPOCH_KEY_PUBLISHER_ROLE(), privacyKeyPublisher);

        _revokeBootstrapOperationalRoles(deployment, bootstrapAdmin);
        _beginAdminTransfers(deployment, governanceAdmin);
    }

    function _wireRegistryRoles(Deployment memory d, address bootstrap, address operator) private {
        d.assetRegistry.grantRole(d.assetRegistry.REGISTRAR_ROLE(), operator);
        d.assetRegistry.grantRole(d.assetRegistry.STATUS_MANAGER_ROLE(), operator);
        d.adapterRegistry.grantRole(d.adapterRegistry.ADAPTER_QUALIFIER_ROLE(), operator);
        d.adapterRegistry.grantRole(d.adapterRegistry.ADAPTER_STATUS_MANAGER_ROLE(), operator);
        d.calendarRegistry.grantRole(d.calendarRegistry.CALENDAR_REGISTRAR_ROLE(), operator);
        d.calendarRegistry.grantRole(d.calendarRegistry.CALENDAR_STATUS_MANAGER_ROLE(), operator);
        d.sessionRegistry.grantRole(d.sessionRegistry.SESSION_REGISTRAR_ROLE(), operator);
        d.sessionRegistry.grantRole(d.sessionRegistry.SESSION_STATUS_MANAGER_ROLE(), operator);
        d.settlementAssetRegistry.grantRole(d.settlementAssetRegistry.QUALIFIER_ROLE(), operator);
        d.settlementAssetRegistry.grantRole(d.settlementAssetRegistry.STATUS_MANAGER_ROLE(), operator);
        d.benchmarkRegistry.grantRole(d.benchmarkRegistry.BENCHMARK_QUALIFIER_ROLE(), operator);
        d.benchmarkRegistry.grantRole(d.benchmarkRegistry.BENCHMARK_STATUS_MANAGER_ROLE(), operator);
        d.feeScheduleRegistry.grantRole(d.feeScheduleRegistry.FEE_SCHEDULE_QUALIFIER_ROLE(), operator);
        d.feeScheduleRegistry.grantRole(d.feeScheduleRegistry.FEE_SCHEDULE_STATUS_MANAGER_ROLE(), operator);
        d.riskDomainRegistry.grantRole(d.riskDomainRegistry.RISK_DOMAIN_QUALIFIER_ROLE(), operator);
        d.riskDomainRegistry.grantRole(d.riskDomainRegistry.RISK_DOMAIN_STATUS_MANAGER_ROLE(), operator);
        d.instrumentRegistry.grantRole(d.instrumentRegistry.INSTRUMENT_QUALIFIER_ROLE(), operator);
        d.instrumentRegistry.grantRole(d.instrumentRegistry.INSTRUMENT_STATUS_MANAGER_ROLE(), operator);
        d.marketRegistry.grantRole(d.marketRegistry.MARKET_QUALIFIER_ROLE(), operator);
        d.marketRegistry.grantRole(d.marketRegistry.MARKET_STATUS_MANAGER_ROLE(), operator);
        d.seriesRegistry.grantRole(d.seriesRegistry.SERIES_QUALIFIER_ROLE(), operator);
        d.seriesRegistry.grantRole(d.seriesRegistry.SERIES_STATUS_MANAGER_ROLE(), operator);
        d.packageRegistry.grantRole(d.packageRegistry.PACKAGE_QUALIFIER_ROLE(), operator);
        d.packageRegistry.grantRole(d.packageRegistry.PACKAGE_STATUS_MANAGER_ROLE(), operator);

        d.assetRegistry.revokeRole(d.assetRegistry.REGISTRAR_ROLE(), bootstrap);
        d.assetRegistry.revokeRole(d.assetRegistry.STATUS_MANAGER_ROLE(), bootstrap);
        d.adapterRegistry.revokeRole(d.adapterRegistry.ADAPTER_QUALIFIER_ROLE(), bootstrap);
        d.adapterRegistry.revokeRole(d.adapterRegistry.ADAPTER_STATUS_MANAGER_ROLE(), bootstrap);
        d.calendarRegistry.revokeRole(d.calendarRegistry.CALENDAR_REGISTRAR_ROLE(), bootstrap);
        d.calendarRegistry.revokeRole(d.calendarRegistry.CALENDAR_STATUS_MANAGER_ROLE(), bootstrap);
        d.sessionRegistry.revokeRole(d.sessionRegistry.SESSION_REGISTRAR_ROLE(), bootstrap);
        d.sessionRegistry.revokeRole(d.sessionRegistry.SESSION_STATUS_MANAGER_ROLE(), bootstrap);
        d.settlementAssetRegistry.revokeRole(d.settlementAssetRegistry.QUALIFIER_ROLE(), bootstrap);
        d.settlementAssetRegistry.revokeRole(d.settlementAssetRegistry.STATUS_MANAGER_ROLE(), bootstrap);
        d.benchmarkRegistry.revokeRole(d.benchmarkRegistry.BENCHMARK_QUALIFIER_ROLE(), bootstrap);
        d.benchmarkRegistry.revokeRole(d.benchmarkRegistry.BENCHMARK_STATUS_MANAGER_ROLE(), bootstrap);
        d.feeScheduleRegistry.revokeRole(d.feeScheduleRegistry.FEE_SCHEDULE_QUALIFIER_ROLE(), bootstrap);
        d.feeScheduleRegistry.revokeRole(d.feeScheduleRegistry.FEE_SCHEDULE_STATUS_MANAGER_ROLE(), bootstrap);
        d.riskDomainRegistry.revokeRole(d.riskDomainRegistry.RISK_DOMAIN_QUALIFIER_ROLE(), bootstrap);
        d.riskDomainRegistry.revokeRole(d.riskDomainRegistry.RISK_DOMAIN_STATUS_MANAGER_ROLE(), bootstrap);
        d.instrumentRegistry.revokeRole(d.instrumentRegistry.INSTRUMENT_QUALIFIER_ROLE(), bootstrap);
        d.instrumentRegistry.revokeRole(d.instrumentRegistry.INSTRUMENT_STATUS_MANAGER_ROLE(), bootstrap);
        d.marketRegistry.revokeRole(d.marketRegistry.MARKET_QUALIFIER_ROLE(), bootstrap);
        d.marketRegistry.revokeRole(d.marketRegistry.MARKET_STATUS_MANAGER_ROLE(), bootstrap);
        d.seriesRegistry.revokeRole(d.seriesRegistry.SERIES_QUALIFIER_ROLE(), bootstrap);
        d.seriesRegistry.revokeRole(d.seriesRegistry.SERIES_STATUS_MANAGER_ROLE(), bootstrap);
        d.packageRegistry.revokeRole(d.packageRegistry.PACKAGE_QUALIFIER_ROLE(), bootstrap);
        d.packageRegistry.revokeRole(d.packageRegistry.PACKAGE_STATUS_MANAGER_ROLE(), bootstrap);
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
        d.privacyCommitmentRegistry.revokeRole(d.privacyCommitmentRegistry.POLICY_ACTIVATOR_ROLE(), bootstrap);
        d.privacyCommitmentRegistry.revokeRole(d.privacyCommitmentRegistry.EPOCH_KEY_PUBLISHER_ROLE(), bootstrap);
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
        return keccak256(
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
    }
}
