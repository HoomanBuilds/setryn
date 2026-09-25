// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {Script, console2} from "forge-std/Script.sol";

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
import {PrivacyCommitmentRegistry} from "../src/privacy/PrivacyCommitmentRegistry.sol";
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
            maximumRiskAdapterGas,
            maximumRiskObservationAge
        );
        deployment.positionLifecycleExecutor = new PositionLifecycleExecutor(
            defaultAdminDelay, initialAdmin, IPositionEngine(address(deployment.positionEngine))
        );
        deployment.cashSettlementCoordinator = new CashSettlementCoordinator(
            IPositionEngine(address(deployment.positionEngine)), deployment.fixingEngine, deployment.fundedFeeEngine
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

        _wireInternalRoles(deployment);
        vm.stopBroadcast();

        _logDeployment(deployment);
    }

    function _wireInternalRoles(Deployment memory deployment) private {
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
        deployment.fundedFeeEngine
            .grantRole(
                deployment.fundedFeeEngine.FEE_ACTION_CONSUMER_ROLE(), address(deployment.cashSettlementCoordinator)
            );
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
