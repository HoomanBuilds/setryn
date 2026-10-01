#!/usr/bin/env node
// Prints the environment BootstrapSetrynMarkets.s.sol reads, taken from a deployment manifest written by
// scripts/generate-deployment-evidence.mjs and, when given, the DeploySetryn broadcast record (for the first deployment
// block). Every address must name exactly one deployed contract in the manifest. Output is `export NAME=value` lines:
//
//   eval "$(node scripts/network-bootstrap-env.mjs --manifest deployments/<network>/manifest.json \
//     [--broadcast contracts/broadcast/DeploySetryn.s.sol/<chainId>/run-latest.json])"
//
// Nothing is read from or sent to a chain.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Bootstrap dependencies (required) and the venue and lifecycle contracts the runtime also names (optional). */
const REQUIRED = {
  AssetRegistry: "SETRYN_ASSET_REGISTRY",
  AdapterRegistry: "SETRYN_ADAPTER_REGISTRY",
  CalendarRegistry: "SETRYN_CALENDAR_REGISTRY",
  SessionRegistry: "SETRYN_SESSION_REGISTRY",
  SettlementAssetRegistry: "SETRYN_SETTLEMENT_ASSET_REGISTRY",
  BenchmarkRegistry: "SETRYN_BENCHMARK_REGISTRY",
  FeeScheduleRegistry: "SETRYN_FEE_SCHEDULE_REGISTRY",
  RiskDomainRegistry: "SETRYN_RISK_DOMAIN_REGISTRY",
  InstrumentRegistry: "SETRYN_INSTRUMENT_REGISTRY",
  MarketRegistry: "SETRYN_MARKET_REGISTRY",
  SeriesRegistry: "SETRYN_SERIES_REGISTRY",
  CanonicalStrategyCompiler: "SETRYN_CANONICAL_STRATEGY_COMPILER",
  CappedForwardPayoffModule: "SETRYN_CAPPED_FORWARD_PAYOFF_MODULE",
  CollateralVault: "SETRYN_COLLATERAL_VAULT",
  FundedFeeEngine: "SETRYN_FUNDED_FEE_ENGINE",
  PortfolioRiskEngine: "SETRYN_PORTFOLIO_RISK_ENGINE",
  RiskAdmissionBindingRegistry: "SETRYN_RISK_ADMISSION_BINDING_REGISTRY",
  ExecutionPolicyRegistry: "SETRYN_EXECUTION_POLICY_REGISTRY",
  TradingSessionPolicy: "SETRYN_TRADING_SESSION_POLICY",
  OrderState: "SETRYN_ORDER_STATE",
  AtomicClearingEngine: "SETRYN_ATOMIC_CLEARING_ENGINE",
  PrivateRfqValidationGate: "SETRYN_PRIVATE_RFQ_VALIDATION_GATE",
  PrivateRfqBook: "SETRYN_PRIVATE_RFQ_BOOK",
  PublicOrderBook: "SETRYN_PUBLIC_ORDER_BOOK",
  PositionEngine: "SETRYN_POSITION_ENGINE",
  LifecyclePolicyValidator: "SETRYN_LIFECYCLE_POLICY_VALIDATOR",
  SignedLifecycleEngine: "SETRYN_SIGNED_LIFECYCLE_ENGINE",
  RegistryStatusController: "SETRYN_REGISTRY_STATUS_CONTROLLER",
};
const OPTIONAL = {
  FixingEngine: "SETRYN_FIXING_ENGINE",
  CashSettlementCoordinator: "SETRYN_CASH_SETTLEMENT_COORDINATOR",
  PositionLifecycleExecutor: "SETRYN_POSITION_LIFECYCLE_EXECUTOR",
  SealedAuctionHouse: "SETRYN_SEALED_AUCTION_HOUSE",
  StreamingQuoteEngine: "SETRYN_STREAMING_QUOTE_ENGINE",
  BatchClearingEngine: "SETRYN_BATCH_CLEARING_ENGINE",
};

function argument(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

const manifestPath = argument("manifest");
if (!manifestPath) {
  process.stderr.write("usage: network-bootstrap-env.mjs --manifest <manifest.json> [--broadcast <run-latest.json>]\n");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
const deployments = [...(manifest.contracts ?? []), ...(manifest.phase2?.deployments ?? [])];
const lines = [];
for (const [names, required] of [[REQUIRED, true], [OPTIONAL, false]]) {
  for (const [name, variable] of Object.entries(names)) {
    const matches = deployments.filter((deployment) => deployment.name === name);
    if (matches.length !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(matches[0].address ?? "")) {
      if (required) throw new Error(`manifest ${manifestPath} must name exactly one deployed ${name}`);
      continue;
    }
    lines.push(`export ${variable}=${matches[0].address}`);
  }
}

const broadcastPath = argument("broadcast");
if (broadcastPath) {
  const broadcast = JSON.parse(readFileSync(resolve(broadcastPath), "utf8"));
  if (Number(broadcast.chain) !== Number(manifest.chainId)) {
    throw new Error(`broadcast ${broadcastPath} is for chain ${broadcast.chain}, the manifest for ${manifest.chainId}`);
  }
  const blocks = (broadcast.receipts ?? []).map((receipt) => Number(BigInt(receipt.blockNumber)));
  if (blocks.length === 0 || blocks.some((block) => !Number.isSafeInteger(block))) {
    throw new Error(`broadcast ${broadcastPath} has no receipts`);
  }
  lines.push(`export SETRYN_DEPLOYMENT_BLOCK=${Math.min(...blocks)}`);
}
process.stdout.write(`${lines.join("\n")}\n`);
