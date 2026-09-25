#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trackedManifestPaths = [
  "deployments/arbitrum-sepolia/manifest.json",
  "deployments/arbitrum-one/manifest.json",
];
const manifestArgumentIndex = process.argv.indexOf("--manifest");
if (manifestArgumentIndex !== -1 && !process.argv[manifestArgumentIndex + 1]) {
  throw new Error("--manifest requires a path");
}
const manifestPaths =
  manifestArgumentIndex === -1 ? trackedManifestPaths : [process.argv[manifestArgumentIndex + 1]];
const phase2Inventory = readJson("deployments/phase2-contract-inventory.json");
const phase2ContractNames = phase2Inventory.contracts.map(({ name }) => name);
const requiredContracts = [
  "AssetRegistry",
  "AdapterRegistry",
  "CalendarRegistry",
  "SessionRegistry",
  "SettlementAssetRegistry",
  "BenchmarkRegistry",
  "FeeScheduleRegistry",
  "RiskDomainRegistry",
  "InstrumentRegistry",
  "MarketRegistry",
  "SeriesRegistry",
  "CollateralVault",
];
const vaultRoles = [
  ["COLLATERAL_LOCKER_ROLE", "SETRYN_COLLATERAL_LOCKER_ROLE"],
  ["COLLATERAL_SETTLER_ROLE", "SETRYN_COLLATERAL_SETTLER_ROLE"],
  ["TERMINAL_RESERVATION_CREATOR_ROLE", "SETRYN_TERMINAL_RESERVATION_CREATOR_ROLE"],
  ["TERMINAL_RESERVATION_RESOLVER_ROLE", "SETRYN_TERMINAL_RESERVATION_RESOLVER_ROLE"],
  ["EXCESS_RECOVERY_ROLE", "SETRYN_EXCESS_RECOVERY_ROLE"],
];

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8"));
}

function roleId(label) {
  return execFileSync("cast", ["keccak", label], { encoding: "utf8" }).trim().toLowerCase();
}

function artifactConstructor(contract) {
  const path = resolve(repositoryRoot, contract.artifact);
  if (!existsSync(path)) {
    return null;
  }
  const artifact = readJson(contract.artifact);
  return artifact.abi.find((item) => item.type === "constructor")?.inputs ?? [];
}

function validateConstructor(contract, manifestPath) {
  const inputs = artifactConstructor(contract);
  if (inputs === null) {
    return;
  }
  const declared = contract.constructorArguments.map(({ name, type }) => ({ name: name.replace(/_+$/, ""), type }));
  const actual = inputs.map(({ name, type }) => ({ name: name.replace(/_+$/, ""), type }));
  if (JSON.stringify(declared) !== JSON.stringify(actual)) {
    throw new Error(`${manifestPath}: ${contract.name} constructor arguments drifted from its artifact`);
  }
}

function validateManifest(manifestPath) {
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== "1.0.0") {
    throw new Error(`${manifestPath}: unsupported schema version`);
  }
  const allowedChainIds = {
    local: [1337, 31337],
    "arbitrum-sepolia": [421614],
    "arbitrum-one": [42161],
  };
  if (!allowedChainIds[manifest.environment]?.includes(manifest.chainId)) {
    throw new Error(`${manifestPath}: environment and chain ID do not match`);
  }
  if (
    manifest.phase2?.inventoryFile !== "../phase2-contract-inventory.json" ||
    JSON.stringify(manifest.phase2.contracts) !== JSON.stringify(phase2ContractNames) ||
    manifest.phase2.mainnetBroadcastAllowed !== false ||
    manifest.phase2.bootstrapAuthority?.postWiringRevocationRequired !== true
  ) {
    throw new Error(`${manifestPath}: Phase 2 inventory or authority policy drifted`);
  }
  const phase2Deployments = manifest.phase2.deployments;
  const deployedPhase2Names = phase2Deployments.map(({ name }) => name);
  if (new Set(deployedPhase2Names).size !== deployedPhase2Names.length) {
    throw new Error(`${manifestPath}: duplicate Phase 2 deployment evidence`);
  }
  for (const name of deployedPhase2Names) {
    if (!phase2ContractNames.includes(name)) {
      throw new Error(`${manifestPath}: unknown Phase 2 deployed contract ${name}`);
    }
  }
  if ((manifest.status === "planned" || manifest.status === "disabled") && phase2Deployments.length !== 0) {
    throw new Error(`${manifestPath}: non-broadcast manifest contains Phase 2 deployment evidence`);
  }
  const contracts = new Map(manifest.contracts.map((contract) => [contract.name, contract]));
  if (contracts.size !== manifest.contracts.length) {
    throw new Error(`${manifestPath}: contract names must be unique`);
  }
  const names = [...contracts.keys()];
  if (JSON.stringify(names) !== JSON.stringify(requiredContracts)) {
    throw new Error(`${manifestPath}: contract order or membership drifted from the Phase 1 deployment graph`);
  }
  if (
    manifest.environment === "arbitrum-sepolia" &&
    manifest.status === "planned" &&
    (manifest.broadcast.enabled || manifest.broadcast.signed || manifest.broadcast.transactionCount !== 0)
  ) {
    throw new Error(`${manifestPath}: planned Sepolia deployment must keep broadcast disabled and unsigned`);
  }
  if (manifest.environment === "arbitrum-one" && (manifest.status !== "disabled" || manifest.broadcast.enabled)) {
    throw new Error(`${manifestPath}: Arbitrum One broadcast must remain disabled`);
  }
  if (manifest.status === "broadcast" && (!manifest.broadcast.enabled || manifest.broadcast.transactionCount === 0)) {
    throw new Error(`${manifestPath}: broadcast evidence must record broadcast transactions`);
  }

  const vault = contracts.get("CollateralVault");
  if (!vault.owner?.source) {
    throw new Error(`${manifestPath}: CollateralVault owner authority is missing`);
  }
  if (JSON.stringify(vault.dependencies) !== JSON.stringify(["SettlementAssetRegistry", "RiskDomainRegistry"])) {
    throw new Error(`${manifestPath}: CollateralVault dependencies drifted`);
  }
  const actualRoles = new Map(vault.roles.map((role) => [role.name, role]));
  if (actualRoles.size !== vaultRoles.length) {
    throw new Error(`${manifestPath}: CollateralVault role set is incomplete`);
  }
  for (const [name, label] of vaultRoles) {
    const role = actualRoles.get(name);
    if (!role || role.id?.toLowerCase() !== roleId(label)) {
      throw new Error(`${manifestPath}: CollateralVault role ${name} drifted`);
    }
    if (
      manifest.environment === "arbitrum-sepolia" &&
      (role.members.length !== 1 || role.members[0]?.source !== "SETRYN_INITIAL_ADMIN")
    ) {
      throw new Error(`${manifestPath}: CollateralVault role ${name} bootstrap authority drifted`);
    }
  }

  for (const contract of manifest.contracts) {
    const expectedArtifact = `contracts/out/${contract.name}.sol/${contract.name}.json`;
    if (contract.artifact !== expectedArtifact) {
      throw new Error(`${manifestPath}: ${contract.name} artifact path drifted`);
    }
    validateConstructor(contract, manifestPath);
    const declaredDependencies = contract.constructorArguments
      .map((argument) =>
        typeof argument.value === "string"
          ? /^\$contracts\.([A-Za-z][A-Za-z0-9]*)\.address$/.exec(argument.value)?.[1]
          : undefined,
      )
      .filter(Boolean);
    if (JSON.stringify(contract.dependencies) !== JSON.stringify(declaredDependencies)) {
      throw new Error(`${manifestPath}: ${contract.name} dependency declarations drifted from constructor wiring`);
    }
    if (new Set(contract.dependencies).size !== contract.dependencies.length) {
      throw new Error(`${manifestPath}: ${contract.name} declares duplicate dependencies`);
    }
    for (const dependency of contract.dependencies) {
      if (!contracts.has(dependency)) {
        throw new Error(`${manifestPath}: ${contract.name} has unknown dependency ${dependency}`);
      }
    }
  }
}

for (const manifestPath of manifestPaths) {
  validateManifest(manifestPath);
}

process.stdout.write("Deployment manifests match the Phase 1 graph and Phase 2 inventory.\n");
