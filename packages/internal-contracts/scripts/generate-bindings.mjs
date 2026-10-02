import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const outputPath = resolve(packageRoot, "src/generated/contracts.generated.ts");
const checkOnly = process.argv.includes("--check");
const allowPartial = process.argv.includes("--allow-partial");

const contracts = [
  ["AssetRegistry", "contracts/out/AssetRegistry.sol/AssetRegistry.json"],
  ["SettlementAssetRegistry", "contracts/out/SettlementAssetRegistry.sol/SettlementAssetRegistry.json"],
  ["AdapterRegistry", "contracts/out/AdapterRegistry.sol/AdapterRegistry.json"],
  ["CalendarRegistry", "contracts/out/CalendarRegistry.sol/CalendarRegistry.json"],
  ["SessionRegistry", "contracts/out/SessionRegistry.sol/SessionRegistry.json"],
  ["BenchmarkRegistry", "contracts/out/BenchmarkRegistry.sol/BenchmarkRegistry.json"],
  ["FeeScheduleRegistry", "contracts/out/FeeScheduleRegistry.sol/FeeScheduleRegistry.json"],
  ["RiskDomainRegistry", "contracts/out/RiskDomainRegistry.sol/RiskDomainRegistry.json"],
  ["InstrumentRegistry", "contracts/out/InstrumentRegistry.sol/InstrumentRegistry.json"],
  ["MarketRegistry", "contracts/out/MarketRegistry.sol/MarketRegistry.json"],
  ["SeriesRegistry", "contracts/out/SeriesRegistry.sol/SeriesRegistry.json"],
  ["CollateralVault", "contracts/out/CollateralVault.sol/CollateralVault.json"],
  ["PackageRegistry", "contracts/out/PackageRegistry.sol/PackageRegistry.json"],
  ["CanonicalStrategyCompiler", "contracts/out/CanonicalStrategyCompiler.sol/CanonicalStrategyCompiler.json"],
  ["PositionEngine", "contracts/out/PositionEngine.sol/PositionEngine.json"],
  ["FixingEngine", "contracts/out/FixingEngine.sol/FixingEngine.json"],
  ["FundedFeeEngine", "contracts/out/FundedFeeEngine.sol/FundedFeeEngine.json"],
  ["PortfolioRiskEngine", "contracts/out/PortfolioRiskEngine.sol/PortfolioRiskEngine.json"],
  ["PositionLifecycleExecutor", "contracts/out/PositionLifecycleExecutor.sol/PositionLifecycleExecutor.json"],
  ["CashSettlementCoordinator", "contracts/out/CashSettlementCoordinator.sol/CashSettlementCoordinator.json"],
  ["PrivacyCommitmentRegistry", "contracts/out/PrivacyCommitmentRegistry.sol/PrivacyCommitmentRegistry.json"],
  ["OperationalAdapterExecutor", "contracts/out/OperationalAdapterExecutor.sol/OperationalAdapterExecutor.json"],
  ["DevnetSequencerUptimeFeed", "contracts/out/DevnetSequencerUptimeFeed.sol/DevnetSequencerUptimeFeed.json"],
  ["ExecutionPolicyRegistry", "contracts/out/ExecutionPolicyRegistry.sol/ExecutionPolicyRegistry.json"],
  ["TradingSessionPolicy", "contracts/out/TradingSessionPolicy.sol/TradingSessionPolicy.json"],
  ["PackageWitnessRegistry", "contracts/out/PackageWitnessRegistry.sol/PackageWitnessRegistry.json"],
  ["RiskAdmissionBindingRegistry", "contracts/out/RiskAdmissionBindingRegistry.sol/RiskAdmissionBindingRegistry.json"],
  ["OrderValidationGate", "contracts/out/OrderValidationGate.sol/OrderValidationGate.json"],
  ["ClearingAdmissionGate", "contracts/out/ClearingAdmissionGate.sol/ClearingAdmissionGate.json"],
  ["PublicBookEligibilityGate", "contracts/out/PublicBookEligibilityGate.sol/PublicBookEligibilityGate.json"],
  ["OrderState", "contracts/out/OrderState.sol/OrderState.json"],
  ["AtomicClearingEngine", "contracts/out/AtomicClearingEngine.sol/AtomicClearingEngine.json"],
  ["PublicOrderBook", "contracts/out/PublicOrderBook.sol/PublicOrderBook.json"],
  ["PrivateRfqValidationGate", "contracts/out/PrivateRfqValidationGate.sol/PrivateRfqValidationGate.json"],
  ["PrivateRfqBook", "contracts/out/PrivateRfqBook.sol/PrivateRfqBook.json"],
  ["CapacityReservationRegistry", "contracts/out/CapacityReservationRegistry.sol/CapacityReservationRegistry.json"],
  ["VaultBackedStreamCapacityManager", "contracts/out/VaultBackedStreamCapacityManager.sol/VaultBackedStreamCapacityManager.json"],
  ["VaultBackedBatchCapacityManager", "contracts/out/VaultBackedBatchCapacityManager.sol/VaultBackedBatchCapacityManager.json"],
  ["AuctionValidationGate", "contracts/out/AuctionValidationGate.sol/AuctionValidationGate.json"],
  ["SealedAuctionHouse", "contracts/out/SealedAuctionHouse.sol/SealedAuctionHouse.json"],
  ["StreamingQuoteEngine", "contracts/out/StreamingQuoteEngine.sol/StreamingQuoteEngine.json"],
  ["QuoteSettlementRouter", "contracts/out/QuoteSettlementRouter.sol/QuoteSettlementRouter.json"],
  ["BatchClearingEngine", "contracts/out/BatchClearingEngine.sol/BatchClearingEngine.json"],
  ["ProtocolRouteLiquiditySource", "contracts/out/ProtocolRouteLiquiditySource.sol/ProtocolRouteLiquiditySource.json"],
  ["CollateralAwareRouteEngine", "contracts/out/CollateralAwareRouteEngine.sol/CollateralAwareRouteEngine.json"],
  ["AccountPolicyAuthority", "contracts/out/AccountPolicyAuthority.sol/AccountPolicyAuthority.json"],
  ["LifecyclePolicyValidator", "contracts/out/LifecyclePolicyValidator.sol/LifecyclePolicyValidator.json"],
  ["DefaultBidderGate", "contracts/out/DefaultBidderGate.sol/DefaultBidderGate.json"],
  ["SignedLifecycleEngine", "contracts/out/SignedLifecycleEngine.sol/SignedLifecycleEngine.json"],
  ["CompressionCoordinator", "contracts/out/CompressionCoordinator.sol/CompressionCoordinator.json"],
  ["OffsetUnwindCoordinator", "contracts/out/OffsetUnwindCoordinator.sol/OffsetUnwindCoordinator.json"],
  ["DefaultProcessEngine", "contracts/out/DefaultProcessEngine.sol/DefaultProcessEngine.json"],
  ["OrderReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/OrderReceiptAuthority.json"],
  ["RfqReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/RfqReceiptAuthority.json"],
  ["BookOrderReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/BookOrderReceiptAuthority.json"],
  ["AuctionReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/AuctionReceiptAuthority.json"],
  ["SolverReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/SolverReceiptAuthority.json"],
  ["FillReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/FillReceiptAuthority.json"],
  ["FixingReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/FixingReceiptAuthority.json"],
  ["SettlementReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/SettlementReceiptAuthority.json"],
  ["DefaultReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/DefaultReceiptAuthority.json"],
  ["RecoveryReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/RecoveryReceiptAuthority.json"],
  ["LifecycleReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/LifecycleReceiptAuthority.json"],
  ["StreamReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/StreamReceiptAuthority.json"],
  ["RouteReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/RouteReceiptAuthority.json"],
  ["PositionReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/PositionReceiptAuthority.json"],
  ["FeeReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/FeeReceiptAuthority.json"],
  ["RiskReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/RiskReceiptAuthority.json"],
  ["PrivacyReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/PrivacyReceiptAuthority.json"],
  ["AsyncReceiptAuthority", "contracts/out/ProtocolReceiptAuthorities.sol/AsyncReceiptAuthority.json"],
  ["VerifiableReceiptLedger", "contracts/out/VerifiableReceiptLedger.sol/VerifiableReceiptLedger.json"],
  ["RegistryStatusController", "contracts/out/RegistryStatusController.sol/RegistryStatusController.json"],
  ["CappedForwardPayoffModule", "contracts/out/ProductionPayoffModules.sol/CappedForwardPayoffModule.json"],
  ["NdfPayoffModule", "contracts/out/ProductionPayoffModules.sol/NdfPayoffModule.json"],
  ["EuropeanCallPayoffModule", "contracts/out/ProductionPayoffModules.sol/EuropeanCallPayoffModule.json"],
  ["EuropeanPutPayoffModule", "contracts/out/ProductionPayoffModules.sol/EuropeanPutPayoffModule.json"],
  ["CollarPayoffModule", "contracts/out/ProductionPayoffModules.sol/CollarPayoffModule.json"],
  ["RateForwardPayoffModule", "contracts/out/ProductionPayoffModules.sol/RateForwardPayoffModule.json"],
  ["RateCapPayoffModule", "contracts/out/ProductionPayoffModules.sol/RateCapPayoffModule.json"],
  ["RateFloorPayoffModule", "contracts/out/ProductionPayoffModules.sol/RateFloorPayoffModule.json"],
  ["RateCollarPayoffModule", "contracts/out/ProductionPayoffModules.sol/RateCollarPayoffModule.json"],
  ["BasisSpreadPayoffModule", "contracts/out/ProductionPayoffModules.sol/BasisSpreadPayoffModule.json"],
  ["CalendarSpreadPayoffModule", "contracts/out/ProductionPayoffModules.sol/CalendarSpreadPayoffModule.json"],
  ["WindowAverageScalarPayoffModule", "contracts/out/ProductionPayoffModules.sol/WindowAverageScalarPayoffModule.json"],
  ["CorrelationDispersionScalarPayoffModule", "contracts/out/ProductionPayoffModules.sol/CorrelationDispersionScalarPayoffModule.json"],
];

const bindings = {};
for (const [contractName, artifactPath] of contracts) {
  const absolutePath = resolve(repositoryRoot, artifactPath);
  let artifact;
  try {
    artifact = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      if (allowPartial) {
        continue;
      }
      throw new Error(`Missing Foundry artifact ${artifactPath}. Run the contract build before binding generation.`);
    }
    throw error;
  }
  const metadata = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
  if (!Array.isArray(artifact.abi) || typeof metadata?.settings?.compilationTarget !== "object") {
    throw new Error(`Malformed Foundry artifact ${artifactPath}`);
  }
  const [sourceName] = Object.keys(metadata.settings.compilationTarget);
  bindings[contractName] = {
    artifact: artifactPath,
    sourceName,
    contractName,
    abi: artifact.abi,
  };
}

if (Object.keys(bindings).length === 0) {
  throw new Error("No Foundry artifacts were available for internal binding generation.");
}

const serialized = JSON.stringify(bindings, null, 2);
const hash = createHash("sha256").update(serialized).digest("hex");
const generated = [
  'import type { InternalContractBinding } from "../types.ts";',
  "",
  `export const generatedBindingsHash = \"sha256:${hash}\";`,
  "",
  `export const contractBindings = ${serialized} as const satisfies Record<string, InternalContractBinding>;`,
  "",
].join("\n");

if (checkOnly) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write("Internal contract bindings are stale. Run pnpm internal:bindings:generate after forge build.\n");
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated);
}
